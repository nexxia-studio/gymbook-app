# Recette — Cockpit B2B, lot 2 · Fiche salle et gestes

> Un lot, un fichier. Voir `docs/recettes/README.md`.

🔴 **AUCUN DÉPLOIEMENT.** Migration dans le dépôt, **non appliquée**. WEB uniquement.

## Ce que le lot pose

| fichier | changement |
|---|---|
| `supabase/migrations/20260921140000_cockpit_lot2_actions.sql` | **nouveau** — `audit_logs` en ajout seul + 4 RPC de geste |
| `apps/dashboard/src/hooks/useCockpitGymDetail.ts` | **nouveau** — les 4 gestes, le journal, les refus distingués |
| `apps/dashboard/src/pages/CockpitGym.tsx` | **nouveau** — la fiche salle |
| `apps/dashboard/src/App.tsx` · `pages/Cockpit.tsx` | route `/cockpit/:gymId`, lignes cliquables |
| `apps/dashboard/src/locales/fr.json` · `en.json` | 29 entrées `cockpit` (⚠️ **libellés à valider**) |

---

## § 1 — 🔴 L'intégrité du journal : le défaut était réel

`gym_admin_actions` porte une politique gérant `ALL` dont le **`WITH CHECK` est nul** —
PostgreSQL réutilise alors le `USING` comme contrôle d'écriture. Ajoutés aux droits de
table (`DELETE, INSERT, UPDATE, TRUNCATE` pour `authenticated`) et à l'absence de trigger,
**un gérant peut modifier et supprimer les lignes de sa salle.**

Mais le vrai problème était en amont : les 5 lignes existantes sont toutes des
`booking_create`. **C'est le journal d'exploitation de la salle**, que son gérant a toute
légitimité à écrire. Y consigner les actions de la plateforme aurait été une erreur de
catégorie.

### Décision : `audit_logs`

`0 ligne`, jamais servi, et exactement la bonne forme — `old_data` / `new_data` sont l'état
avant et l'état après. Ses deux politiques sont en **`SELECT`** : côté client, elle est déjà
en ajout seul.

✅ **Le dépôt avait déjà tranché pareil** : `admin-replay-mollie-webhook` écrit dans
`audit_logs` et explique pourquoi pas `gym_admin_actions` (CHECK sur une liste fermée
d'`action_type`, et geste de gérant sur un membre). On ne fait que suivre.

### 🔴 L'ajout seul, y compris pour qui contourne la RLS

Un trigger `BEFORE UPDATE OR DELETE` lève `42501`. C'est la différence entre « la RLS
l'interdit » et « c'est impossible » : les RPC `SECURITY DEFINER` s'exécutent en
propriétaire et contournent la RLS — sans lui, une RPC future mal écrite pourrait réécrire
l'histoire.

**Vérifié au banc : un `UPDATE` et un `DELETE` par le PROPRIÉTAIRE de la table sont refusés.**

### Les droits dormants, fermés

```sql
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM anon, authenticated;
```

✅ **Vérifié avant de révoquer** : aucun code applicatif n'écrit `audit_logs` depuis un
client. Le seul écrivain est `admin-replay-mollie-webhook`, via un client `service_role` —
que la révocation ne concerne pas.

⚠️ **`TRUNCATE` mérite sa mention** : il ne déclenche **pas** un trigger `FOR EACH ROW`. Le
retirer est donc la *seule* protection contre un vidage de table par un porteur de jeton.

### ⚠️ Hors lot, signalé comme demandé

**`gym_admin_actions` reste modifiable par son gérant** : il peut effacer la trace d'une
réservation qu'il a faite pour un membre. C'est **son** journal, donc acceptable — mais
c'est écrit ici pour que personne ne le découvre par surprise.

---

## § 2 — Les gestes

Quatre RPC, une par geste. Toutes suivent la même forme :

1. `is_super_admin()` ou **42501** ;
2. **motif obligatoire** (22023 si vide) ;
3. `SELECT … FOR UPDATE` — l'état avant est capturé **sous verrou**, donc cohérent avec
   l'écriture qui suit ; deux gestes simultanés ne peuvent pas journaliser le même « avant » ;
4. **refus des non-changements** (23505) — un double-clic ne produit pas deux lignes ;
5. `UPDATE` ;
6. `INSERT` dans `audit_logs`, **même transaction** : si le journal échoue, le geste est
   annulé. C'est ce qui rend le journal non contournable.

| geste | validation |
|---|---|
| **plan** | contre `nexxia_plan_limits`, **la grille vivante** — jamais une liste écrite dans le code. Le CHECK de la colonne est le second filet |
| **statut** | les 4 valeurs du CHECK, refusées *avant* de prendre le verrou, avec un message lisible |
| **essai** | `NULL` clôt, une date prolonge ; borne à 1 an — au-delà c'est un plan, pas un essai |
| **commission** | **les deux taux ensemble ou aucun** ; fraction bornée à `[0, 0.5]` — « 1.5 » prélèverait 150 % |

⚠️ **Les dérogations vivent sur `nexxia_gyms`** (`commission_sepa_rate_override`,
`commission_cb_rate_override`), **pas dans `nexxia_features`** — relevé sur la base.
`nexxia_features` porte des drapeaux booléens par salle ; les taux n'y ont pas leur place.

### Le retour arrière

`old_data` ne porte **que** l'état avant ; le motif vit dans `new_data`. C'est ce qui rend
le retour mécanique : **rejouer la même RPC avec la valeur lue dans `old_data` ramène
exactement l'état précédent** — prouvé au banc.

⚠️ **Pas de bouton « annuler » dédié, et c'est voulu** : revenir en arrière est un geste
comme un autre — même RPC, même motif obligatoire, et **sa propre ligne au journal**. Une
annulation silencieuse serait un trou dans l'histoire, exactement ce que ce journal existe
pour empêcher.

---

## § 3 — L'écran

Clic sur une ligne de « Mes salles » → `/cockpit/:gymId`. L'état du lot 1 en détail, les
quatre gestes, **une confirmation explicite avec motif obligatoire**, et le journal de la
salle.

⚠️ **La salle vient de `cockpit_list_gyms()`, réutilisée** — aucune seconde RPC de lecture :
deux sources pour la même fiche finiraient par se contredire. À deux ou trois salles le
surcoût est nul ; à cent, ce sera le moment d'ajouter `cockpit_get_gym`.

Le journal se lit **en direct**, sans RPC : contrairement à la liste — où une lecture
directe aurait *servi* un gérant au lieu de le refuser — un gérant qui lit `audit_logs` de
SA salle est dans son droit. C'est même voulu : une intervention de l'éditeur sur une salle
doit être visible par elle.

---

## § 4 — Lot 2b : l'onboarding de Jeff (proposition, non codée)

**Aucune combinaison des fonctions existantes ne marche** : `create_gym_self_serve` promeut
**l'appelant** en `gym_admin` — Antoine y perdrait son `super_admin`, `profiles.role` étant
une seule colonne. `invite-team-member` exige d'être déjà gérant de la salle. Et
`team-access` rétrograde en `member`, ce qui laisserait Antoine **dans le décompte des
membres** de la salle de Jeff.

**Proposition — et tu as raison, une RPC ne suffit pas.** Une RPC ne sait ni créer un compte
auth ni envoyer une invitation. Il faut **deux pièces** :

1. **Edge Function `cockpit-create-gym`** (`service_role`) : vérifie le JWT super-admin,
   appelle `auth.admin.inviteUserByEmail`, puis la RPC ci-dessous.
2. **RPC `cockpit_create_gym_for(p_name, p_owner_id, p_plan, p_reason)** (`SECURITY DEFINER`) :
   crée la salle — en réutilisant la génération de slug et les slugs réservés de
   `create_gym_self_serve`, **sans la promotion de l'appelant** — rattache le gérant via
   `attach_profile_to_gym` (déjà `SECURITY DEFINER`, déjà réservée à `service_role`), et
   journalise dans `audit_logs`. **Le tout en une transaction.**

⚠️ **Antoine n'apparaît nulle part dans la salle créée** : ni gérant, ni membre, ni dans
aucun décompte. C'est la propriété qui manque à tous les chemins actuels.

### Ce que je fais des deux verrous que tu signales

- **GYM-341 — consentement du gérant.** Je ne le contournerais **pas**. Le gérant invité
  arrive par le parcours normal et accepte les conditions à sa première connexion, comme
  tout le monde. Une salle créée par la plateforme ne doit pas dispenser son gérant d'un
  consentement — ce serait précisément le genre de raccourci qui se paie en audit.
- **GYM-121 — identité légale.** Elle **bloque la vente**, pas la création. Je créerais donc
  la salle sans identité légale, et j'afficherais l'indicateur du lot 1 (`identite_legale_ok`)
  en rouge sur la fiche : c'est déjà le signal qu'il manque quelque chose, et il devient la
  liste de choses à faire pour que Jeff puisse encaisser.

**Lot 2b après le lot 2**, comme convenu.

---

## Preuves

### 🔴 Le banc, joué sur staging DANS UNE TRANSACTION ANNULÉE

⚠️ **Ce n'est pas un déploiement** : `BEGIN … ROLLBACK`, et l'étanchéité a été vérifiée
d'abord (une fonction sonde créée puis annulée n'existe plus après). La migration est jouée
verbatim, les cas exécutés avec de **vraies identités** via `request.jwt.claims`, puis tout
est annulé. Rien ne persiste sur staging.

**20 cas verts sur 21** :

| | cas | attendu | obtenu |
|---|---|---|---|
| 1 | `audit_logs` UPDATE **par le propriétaire** | refus | **42501** ✅ |
| 2 | `audit_logs` DELETE **par le propriétaire** | refus | **42501** ✅ |
| 3 | `anon` peut-il exécuter `cockpit_*` ? | non | **0** ✅ |
| 4 | super-admin `set_plan` pro→premium | succès | premium ✅ |
| 5 | **retour arrière via `old_data`** | pro | **pro** ✅ |
| 6 | non-changement | 23505 | 23505 ✅ |
| 7 | motif vide | 22023 | 22023 ✅ |
| 8 | plan hors grille | 22023 | 22023 ✅ |
| 9 | super-admin `set_status` → suspended | suspended | suspended ✅ |
| 10 | statut hors CHECK | 22023 | 22023 ✅ |
| 11 | super-admin `set_trial_end` +30 j | succès | succès ✅ |
| 12 | essai > 1 an | 22023 | 22023 ✅ |
| 13 | super-admin commission 1 % / 1,5 % | succès | succès ✅ |
| 14 | retrait dérogation (NULL, NULL) | succès | succès ✅ |
| 15 | un seul taux | 22023 | 22023 ✅ |
| 16 | taux > 0.5 | 22023 | 22023 ✅ |
| 17 | lignes journalisées | ~~7~~ **6** | 6 |
| 18–21 | **GÉRANT** sur les 4 RPC | 42501 | **42501** ✅ (×4) |

⚠️ **Le cas 17 est une erreur de MON attendu, pas du code.** J'avais écrit 7 ; il y a 6
gestes réussis (plan aller, plan retour, statut, essai, commission posée, commission
retirée) donc 6 lignes. **Et les 8 gestes refusés n'ont écrit AUCUNE ligne** — ce qui est
en soi la preuve qu'un refus ne laisse pas de trace parasite.

### Le reste

- `tsc --build` dashboard **exit 0** · `tsc` mobile **exit 0** · `deno check` **35/35**
- **Banc RLS #293 : 32/32, exit 0** — inchangé
- ⚠️ **`tsc --build` a REFUSÉ le lot au premier essai** : les 4 RPC absentes de
  `types/database.ts`, généré depuis la base. Le contrôle a attrapé une vraie absence,
  **pour la seconde fois**. Façade typée **en un seul point**, documentée, à retirer à la
  régénération — comme au lot 1, qui l'a soldée
- ⚠️ **Migration NON APPLIQUÉE** · ⚠️ **l'écran n'a pas été ouvert dans un navigateur**
- ⚠️ **Les 29 libellés attendent validation**
- **Aucun déploiement**

## À faire par le cockpit

1. appliquer la migration **sur staging** ;
2. rejouer le banc hors transaction, et vérifier le journal à l'écran ;
3. régénérer `types/database.ts`, retirer la façade de `useCockpitGymDetail.ts` ;
4. puis production.
