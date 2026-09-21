# LOT A — La limite de membres ne bloque plus la réservation

> **Décision produit (Antoine, 21/09).** On ne casse jamais ce qu'un membre a déjà payé.
> La limite de membres borne l'**ARRIVÉE** d'un nouveau membre, jamais la **RÉSERVATION**
> d'un membre existant.

**Branche** `gym-booking-quota` · **base** `develop` · **aucun déploiement**, aucun build Expo.

---

## 1. Ce qui était mesuré, et ce que ça produisait

`_shared/booking-guards.ts → checkMemberQuota`, appelée par `create-booking` (chemin membre)
et `admin-book-member` (chemin gérant), rejouait à **chaque réservation** le quota de
membres du plan Viniz. Trois défauts, mesurés au banc :

| # | Le défaut | Ce que ça faisait |
|---|---|---|
| 1 | Le quota est revérifié **à la réservation** | Une salle de 40 membres retombée en Free (15) ne refusait pas le 41ᵉ **arrivant** : elle refusait **les 40 déjà là**, abonnés en cours compris. Et leurs prélèvements SEPA continuaient — aucun webhook de renouvellement ne regarde le plan. **Débité et bloqué.** |
| 2 | Elle lisait `nexxia_gyms.plan`, la **colonne** | Pas `get_effective_plan`. Elle ignore donc l'essai : allumer les 14 jours de Pro bloquerait une salle en essai de plus de 15 membres **pendant** son essai, par la colonne `free` qu'elle porte encore. |
| 3 | `>=` au lieu de `>` | Une salle Free à **exactement 15** membres — le nombre que le plan autorise — ne pouvait plus rien réserver. |

**Le défaut n°3 ne se corrige pas : il disparaît.** Sur une garde d'**arrivée**, `>=` est
juste (on refuse le 16ᵉ). Sur un chemin qui n'ajoute personne, il n'y a pas de 16ᵉ — le
membre est déjà compté dans les 15.

---

## 2. Ce qui a été fait

`checkMemberQuota` est **retirée des deux chemins à la fois**. Cette simultanéité est la
règle, pas une commodité : `_shared/booking-guards.ts` existe pour que les deux ne divergent
jamais. La retirer d'un seul aurait rendu une salle au-delà de sa limite réservable par son
gérant et pas par ses membres — une asymétrie que personne n'aurait su expliquer au comptoir.

### Les deux choses qu'elle rendait ont été séparées

`checkMemberQuota` rendait un **verdict** (le quota) *et* une **valeur** (`max_active_bookings`,
le plafond de réservations à venir, GYM-196), au seul motif que la ligne `nexxia_gyms` était
de toute façon lue. Supprimer la fonction entière aurait emporté GYM-196 avec le quota.

→ `getMaxActiveBookings(supabase, gymId): Promise<number | null>` — une lecture, sans verdict.
Même table, même ligne, **une colonne en moins** : `plan` n'est plus lue du tout.

### Un changement de repli, assumé

| | Avant | Après |
|---|---|---|
| Lecture de `nexxia_gyms` en échec | `PLAN_NOT_FOUND` → **403, réservation refusée** | `null` → aucun plafond, **la réservation passe** |

Une panne de lecture passagère ne doit pas fermer la salle à des membres qui ont payé. C'est
déjà la politique que le décompte de membres appliquait (documentée depuis GYM-283), et
c'est la décision du 21/09 appliquée jusqu'au bout. **Contrepartie nommée :** pendant une
telle panne, le plafond GYM-196 ne mord pas non plus.

---

## 3. Vérification demandée : les quatre gardes d'arrivée lisent-elles le plan EFFECTIF ?

**Oui, les quatre. Aucune ne porte le défaut n°2** — vérifié sur le **déployé**, pas sur le
dépôt (`pg_get_functiondef` en production *et* en staging pour les deux fonctions SQL).

| Garde | Lecture du plan | Décompte |
|---|---|---|
| `handle_new_user` (trigger) | `get_effective_plan` | `member_gyms ⋈ profiles`, `>=` |
| `join_gym_self_serve` (RPC) | `get_effective_plan_core` | idem, `>=` |
| `admin-create-member` (Edge) | `getEffectivePlan` → `PLAN_MEMBER_LIMIT` | idem, `>=` |
| `invite-team-member` (Edge) | `getEffectivePlan` | **`max_admins`, pas `max_members`** |

⚠️ **`invite-team-member` n'est pas une garde de `max_members`**, et c'est volontaire : un
gérant ou un coach relève de `max_admins`. L'invité passe bien par le chemin membre du
trigger (et peut en ressortir non rattaché sur une salle pleine), mais l'`UPDATE` explicite
de l'étape 6 rétablit le rattachement voulu. Rien à corriger.

Les trois gardes qui comptent des membres le font avec le **même prédicat, à la lettre** :

```sql
FROM member_gyms mg JOIN profiles p ON p.id = mg.member_id
WHERE mg.gym_id = <salle> AND p.role = 'member' AND p.deleted_at IS NULL
```

**Retirer le contrôle de la réservation ne rouvre donc aucune porte d'entrée : il n'en
gardait aucune. Il gardait la sortie.**

---

## 4. Les preuves

### `deno check` — 35 / 35

```
contrôlées: 35 · en échec: 0
```

Sur **toutes** les fonctions, pas seulement les deux touchées (convention GYM-350).

### `tsc --build` (dashboard) — exit 0

```
tsconfig.app.json : 156 fichiers · tsconfig.node.json : 1 · tsconfig.tests.json : 2
```

`--build`, jamais `--noEmit` (qui contrôle 0 fichier ici).

### Banc SQL — staging, transactionnel, **12 verts / 13**

`supabase/tests/gym_booking_quota.sql`, joué en `BEGIN … ROLLBACK`. **Ce n'est pas un
déploiement** : la mise en scène (grille Free abaissée à 10, « Dopamine (Staging Clone) »
retombée en `free`) est écrite puis annulée. Étanchéité **vérifiée après coup** : grille de
retour à 15, salle de retour en `pro`, 2 créneaux futurs, 0 réservation future pour le membre
témoin, 0 rattachement pour le témoin extérieur.

Mise en scène mesurée : **12 membres pour 10 autorisés**.

| # | Cas | Obtenu |
|---|---|---|
| ① | La salle est strictement au-delà de sa limite | 12 / 10 ✅ |
| ② | L'ANCIENNE garde refusait tout membre existant | `MEMBER_QUOTA_REACHED` ✅ |
| ③ | Colonne vs plan effectif | `free` / `free`, `trial_active=false` — **LATENT** |
| ④ | À la borne exacte 12/12 | `>=` REFUSE · `>` passe ✅ |
| ⑤ | **Un membre existant réserve malgré le dépassement** | `confirmed` ✅ |
| ⑥ | La réservation existe vraiment en base | trouvée ✅ |
| ⑦ | GYM-196 : le plafond est toujours lu | 3 ✅ |
| ⑧ | GYM-196 mord encore | 3 à venir / plafond 3 ✅ |
| ⑨ | **Un NOUVEAU membre est refusé** | `PT409 — salle complète` ✅ |
| ⑩ | À la borne exacte, l'arrivée est refusée aussi | `PT409` ✅ |
| ⑪ | La place revenue, le même appel rattache | rattaché ✅ |
| ⑫ | `join_gym_self_serve` passe par `get_effective_plan_core` | présent ✅ |
| ⑬ | `handle_new_user` passe par `get_effective_plan` | présent ✅ |

**Le ③ n'est pas un rouge, c'est un aveu.** L'essai étant éteint (`v_trial_enabled CONSTANT
false` — sujet du lot B), la colonne et le plan effectif disent la même chose aujourd'hui.
Le défaut n°2 n'est donc **pas observable** : il s'arme le jour où l'essai s'allume. Le
marquer LATENT plutôt que VERT est la seule lecture honnête — et c'est précisément pourquoi
ce lot est un **prérequis** du lot B.

**⑨ / ⑩ / ⑪ sont leur propre falsification** : même appel, même identité, verdicts opposés
selon la seule grille. Un banc qui rendrait toujours vert ne ferait pas ça.

### Banc TypeScript — 13 assertions, 0 échec, **falsifié à exit 1**

`supabase/functions/_shared/booking-guards_test.ts`. Le banc SQL ne peut pas exécuter le
TypeScript des Edge Functions ; celui-ci exécute le module que les deux fonctions importent
réellement, avec un faux client qui **enregistre la requête** :

- `checkMemberQuota` n'est plus **exporté** — pas seulement plus appelé ;
- **aucun export ne peut plus dire « cette salle est pleine »** (c'est ce qui empêche la
  garde de revenir par la fenêtre) ;
- la lecture porte sur `nexxia_gyms`, colonne `max_active_bookings` **et elle seule** —
  `plan` n'y est plus ;
- salle introuvable, ligne vide, plafond `NULL` → `null`, **jamais un refus** ;
- un plafond de `0` est conservé, pas confondu avec « aucune limite » (le piège de `||`).

**Falsification :** en rétablissant `.select('plan, max_active_bookings')`, le banc passe à
**2 échecs et exit 1**. Restauré, exit 0.

---

## 5. Ce qui reste, et ce que ça implique

- **Rien n'est déployé.** Tant que la production sert l'ancienne version des deux fonctions,
  le comportement décrit en §1 reste celui des salles en production. Aujourd'hui aucune des
  deux salles de prod n'est concernée (Dopamine : `premium`, `max_members = null` ; Pace :
  `free`, 1 membre sur 15) — mais c'est un état, pas une garantie.
- **`MEMBER_QUOTA_REACHED` reste listé** dans `apps/dashboard/src/lib/edgeErrors.ts`, **à
  dessein** : pendant la fenêtre de déploiement, l'ancienne fonction peut encore le
  renvoyer, et le retirer maintenant ferait retomber un refus clair sur le message de repli.
  À retirer une fois les deux fonctions déployées.
- **Le message de « salle pleine » n'est pas perdu** : il reste servi là où il a un sens,
  par `admin-create-member` sous `PLAN_MEMBER_LIMIT` (avec `current` / `max`, que l'upsell
  GYM-247 affiche).
- **Remarque, hors lot :** côté app mobile, `MEMBER_QUOTA_REACHED` n'a **jamais** eu de
  traduction (`apps/mobile/locales/*.json` ne le connaît pas). Le membre bloqué par ce quota
  voyait donc un message générique. Le problème disparaît avec le code lui-même ; il est noté
  ici parce qu'il dit quelque chose du défaut : personne n'avait prévu que ce refus atteigne
  un membre.
