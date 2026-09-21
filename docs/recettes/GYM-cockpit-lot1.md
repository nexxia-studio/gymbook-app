# Recette — Cockpit B2B, lot 1 · « Mes salles », lecture seule

> Un lot, un fichier. Voir `docs/recettes/README.md`.

🔴 **AUCUN DÉPLOIEMENT.** La migration est dans le dépôt, **non appliquée**. C'est du WEB
(dashboard, Vercel) — aucun build Expo.

## Ce que le lot pose

| fichier | changement |
|---|---|
| `supabase/migrations/20260921100000_cockpit_lot1_liste_salles.sql` | **nouveau** — `cockpit_list_gyms()`, lecture seule, refus `42501` |
| `apps/dashboard/src/hooks/useCockpitGyms.ts` | **nouveau** — appel de la RPC, refus distingué de la panne |
| `apps/dashboard/src/pages/Cockpit.tsx` | **nouveau** — la liste |
| `apps/dashboard/src/App.tsx` | route `/cockpit` |
| `apps/dashboard/src/components/layout/Sidebar.tsx` | entrée de menu, affichée au seul super-admin |
| `apps/dashboard/src/locales/fr.json` · `en.json` | section `cockpit` + `nav.cockpit` |

---

## § 0 — La dérive (GYM-348)

Méthode : pour chaque fonction, la date de déploiement en prod comparée au dernier commit
sur `main` touchant **son dossier ou les modules `_shared` qu'elle importe réellement**
(clôture transitive du graphe d'imports, lue sur `main`).

⚠️ Une comparaison naïve — « `_shared` a bougé le 10/09 » — signalait **28 fonctions sur
35**. C'est faux : la plupart n'importent pas le module modifié. Par graphe réel, il en
reste **5**.

| fonction | déployée | `main` | cause |
|---|---|---|---|
| `cancel-subscription` | 27/07 16:58 | 26/08 17:43 | `_shared/gym-branding.ts` |
| `confirm-waitlist` | 19/08 11:49 | 26/08 17:43 | `_shared/gym-branding.ts` |
| `process-failed-renewals` | 25/08 12:16 | 26/08 17:43 | `_shared/gym-branding.ts` |
| `cancel-booking` | 26/08 12:13 | 26/08 17:43 | `_shared/gym-branding.ts` |
| `send-notification` | 06/09 21:42 | 11/09 17:05 | **son propre code** |

**Ce que contiennent ces écarts :**

- 🔴 **`gym-branding.ts` — GYM-284, « Le lime de Dopamine cesse d'être le défaut de toutes
  les salles ».** Les quatre fonctions concernées envoient des **emails** : en production,
  elles habillent encore toute salle aux couleurs de Dopamine. C'est un défaut
  **multi-salles**, exactement le chantier en cours.
- 🟠 **`send-notification` — GYM-337**, « Firebase référencé, canal Android déclaré, et fin
  du silence ». Les notifications Android de production sont antérieures à ce correctif.

✅ **`create-payment` (v49) et `create-subscription` (v39)** sont désormais à jour — le
cockpit les a redéployées ce matin à 10:17.

---

## § 1 — Le besoin, et ce que la route rend

Une route, `/cockpit`, **en lecture seule**. Par salle : plan **effectif**, statut, fin
d'essai, membres, créneaux à venir, Mollie, identité légale, dernière activité.

### Le décompte des membres — prédicat de GYM-348, à la lettre

```sql
FROM member_gyms mg JOIN profiles p ON p.id = mg.member_id
WHERE mg.gym_id = <salle> AND p.role = 'member' AND p.deleted_at IS NULL
```

Recopié de `_shared/booking-guards.ts`, qui le tient de `handle_new_user`. **Jamais
`profiles.gym_id`** : depuis GYM-283 cette colonne est la salle *active*, et un membre de
deux salles disparaîtrait du décompte de la première en basculant sur la seconde.

### Le plan affiché est l'EFFECTIF

`get_effective_plan_core` — essai et dérogations `nexxia_features` comprises. La colonne
brute n'apparaît **que lorsqu'elle diffère**. Ce n'est pas théorique : Dopamine est
`premium` en colonne mais `nexxia_features` lui retire `multi_site`.

⚠️ `get_effective_plan_core` rend du **jsonb**, pas un composite — `(f(x)).champ` y échoue
(`42809`), vérifié sur la base. D'où les accesseurs `->>`.

---

## § 2 — 🔴 La sécurité

### a. Aucun chemin client ne peut poser `role='super_admin'` — prouvé

| vérification | résultat |
|---|---|
| liste blanche `UPDATE` sur `profiles` (24 colonnes, `authenticated`) | ✅ **`role` n'y est pas** |
| politique `INSERT` sur `profiles` | ✅ **il n'y en a AUCUNE**, et la RLS est active → tout INSERT client est refusé |
| `handle_new_user` | ✅ `v_role := 'member';` — **un littéral**. Lit `raw_user_meta_data` pour le nom, le téléphone, la langue, **jamais pour le rôle** |
| `create_gym_self_serve` | ✅ `role = 'gym_admin'` — littéral |
| `join_gym_self_serve` | ✅ ne lit `role` que dans un `WHERE` |
| `attach_profile_to_gym` | ⚠️ **`SET role = p_role`** — un paramètre. Mais `EXECUTE` accordé à `postgres` et `service_role` **seulement** : aucun client ne l'atteint |
| son unique appelant, `invite-team-member` | ✅ `INVITABLE_ROLES = ['gym_admin']` — liste fermée d'un élément, validée avant l'appel |
| `team-access` | ✅ n'écrit que `REVOKED_ROLE = 'member'` |

**Aucun chemin client ne mène à `super_admin`.**

#### Deux constats à signaler, non corrigés

- 🟠 **`INSERT(role)` est accordé à `anon` ET `authenticated`** sur `profiles`. Inerte
  aujourd'hui — il n'existe aucune politique `INSERT`, donc la RLS refuse tout. Mais c'est
  une mine : le jour où quelqu'un ajoute une politique `INSERT`, la colonne `role` devient
  écrivable par le client sans que personne ne s'en aperçoive. **C'est exactement la forme
  du piège de gym203.**
- 🟠 **`UPDATE(gym_id)` est toujours accordé au client** — la colonne même de gym203.

### b. Les 17 politiques : **16 accordaient l'ÉCRITURE — corrigé dans ce lot**

| portée | nombre | tables |
|---|---|---|
| 🔴 `ALL` (lecture **et** écriture) | **16** | `nexxia_gyms`, `nexxia_subscriptions`, `nexxia_invoices`, `nexxia_plan_limits`, `nexxia_features`, `profiles`, `audit_logs`, `consent_history`, `gdpr_requests`, `gym_admin_actions`, `gym_communications`, `gym_mollie_connections`, `impersonation_logs`, `login_attempts`, `medical_notes`, `super_admin_proxy_actions` |
| ✅ `SELECT` | 1 | `credit_adjustments` |

**Le lot 1 est en lecture seule par l'interface, pas par la base.** Le compte
super-administrateur, une fois créé, pourra écrire partout via la RLS — y compris sur
`profiles`, donc **promouvoir d'autres super-administrateurs**.

🔴 **CORRIGÉ DANS CE LOT** (décision du 21/09). Principe retenu : **le super-administrateur
LIT par la RLS, il n'ÉCRIT que par des RPC `SECURITY DEFINER` qui journalisent dans
`gym_admin_actions` dans la même transaction** (lot 2). Un journal qu'on peut contourner
n'est pas un journal.

#### Aucun gérant ne perd de droit — et ce n'est pas une opinion

Les 17 politiques ont **toutes** `USING (is_super_admin())` **seul** : relevé sur la
production, **aucune ne combine** `gym_admin` et `super_admin`. Or une politique
`USING (is_super_admin())` n'accorde **jamais rien** à un gérant — le prédicat est faux
pour lui. La passer en `SELECT` ne peut donc lui retirer aucun droit. Les droits des
gérants vivent dans des politiques **séparées**, intactes.

| table | autres politiques (gérant/membre) |
|---|---|
| `nexxia_gyms` · `profiles` | 3 chacune (SELECT, UPDATE) |
| `medical_notes` | 2 (SELECT, UPDATE) |
| `gym_admin_actions` · `gym_communications` | 1 `ALL` chacune — **les gérants gardent leurs écritures** |
| 8 autres | 1 `SELECT` chacune |
| `impersonation_logs` · `login_attempts` · `super_admin_proxy_actions` | **0** — voir ci-dessous |

⚠️ Ces trois dernières n'ont que la politique super-admin : elles deviennent en lecture
seule **pour la RLS**. Elles sont vides (0 ligne) et ne sont écrites que par `service_role`,
**qui contourne la RLS**. Rien ne se ferme qui était ouvert à quelqu'un.

#### La migration se vérifie elle-même

Elle ne convertit **que** les politiques dont le `USING` vaut **exactement**
`is_super_admin()` et qui n'ont **aucun** `WITH CHECK`. Une politique combinée ne
correspondrait pas au motif et serait laissée intacte — **même si la base avait changé
depuis mon relevé**. C'est la leçon de GYM-350 : une migration qui fait confiance à un
instantané est une migration qui ment un jour.

Elle avertit si le compte converti n'est pas 16, et contrôle après coup qu'aucune politique
super-admin n'accorde plus l'écriture.

### c. Le compte — à créer par le cockpit, pas par moi

⚠️ **NE PAS promouvoir `nexxia.studio@gmail.com`** : il est `gym_admin` sur Dopamine, et
`profiles.role` est **une seule colonne**. Le promouvoir lui ferait perdre son rôle de
gérant — et le dashboard de la salle avec.

Compte dédié proposé : **`admin@viniz.app`**. Le mode opératoire est en fin de migration :
créer l'utilisateur dans l'interface Supabase, puis `UPDATE profiles SET role =
'super_admin', gym_id = NULL`.

⚠️ **`gym_id = NULL`** : un super-administrateur n'appartient à aucune salle. Lui en
laisser une le ferait apparaître dans le décompte des membres de cette salle.

### d. Le refus est SERVEUR

Une lecture directe de `nexxia_gyms` **ne refuserait pas** un `gym_admin` : elle le
servirait, avec sa propre salle, et sa politique RLS aurait raison. Le refus ne peut donc
pas venir de la RLS de la table — il vient de la porte unique :

```sql
IF NOT public.is_super_admin() THEN
  RAISE EXCEPTION 'cockpit_list_gyms: réservé au super-administrateur' USING ERRCODE = '42501';
END IF;
```

Le filtre du menu latéral est **un confort, pas une protection**, et c'est écrit dans le
code : le retirer ne ferait fuir aucune donnée.

### 🔴 Les deux révocations demandées : NON FAITES, les deux garde-fous ont sauté

#### ① `INSERT(role)` — un appelant client le pose

`apps/mobile/lib/ensureProfile.ts:151` fait bien `.from('profiles').insert({…})`, et la
ligne **156 y pose `role: 'member'`**. La consigne était « s'il en pose un, dis-le au lieu
de révoquer ». Il en pose un.

⚠️ **Mais ce chemin est déjà mort**, et c'est ce qui rend la décision facile : `profiles`
porte **quatre** politiques — une `ALL`, deux `SELECT`, une `UPDATE` — et **aucune
`INSERT`**. RLS active ⇒ PostgreSQL refuse tout INSERT client, quel que soit le droit de
colonne. Le repli ne peut pas s'exécuter aujourd'hui.

*(J'ai cherché confirmation dans Sentry sous le tag `gym338_fallback_insert` : la recherche
n'a pas appliqué mon filtre de tag, je la tiens donc pour **non concluante**. La preuve
structurelle suffit.)*

🔴 **Le risque reste intact** : le jour où quelqu'un ajoute une politique `INSERT` — pour
faire revivre ce repli, par exemple — `role` devient écrivable **par le client**, `anon`
compris. Forme exacte du piège de gym203.

**Recommandation :** supprimer d'abord le repli mort, **puis** révoquer. Dans cet ordre,
rien ne casse.

#### ② `UPDATE(gym_id)` — la prémisse du cadrage est inexacte

Le cadrage disait « les anciennes versions sont déjà refusées par le trigger de GYM-338 ».
**Le trigger déployé dit autre chose** :

```sql
IF NEW.gym_id IS DISTINCT FROM OLD.gym_id THEN
  IF NEW.gym_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM member_gyms mg WHERE mg.member_id = NEW.id AND mg.gym_id = NEW.gym_id
  ) THEN RETURN NEW;  -- ← PASSE
  END IF;
  RAISE EXCEPTION 'GYM_ID_IMMUTABLE…' USING ERRCODE = '42501';
END IF;
```

Il **laisse passer** un client qui bascule vers une salle **dont il est déjà membre**. Ce
n'est pas un trou — c'est la bascule de salle active, et le trigger porte déjà la propriété
de sécurité qui compte. Une ancienne version basculant par PATCH direct **fonctionne donc
encore aujourd'hui**.

Côté dépôt, plus aucun appelant : `switch_active_gym` et `claim_app_gym`, toutes deux
`SECURITY DEFINER` (vérifié), donc indifférentes aux droits de colonne.

**Recommandation :** ne pas révoquer tant que le parc mobile n'est pas connu. Révoquer ne
casserait rien de ce qu'on compile, mais casserait les binaires en circulation utilisant le
chemin direct — **sans gain de sécurité**, puisque le trigger garde déjà la porte.

---

## § 4 — 🔴 Le super-administrateur n'atteignait pas le cockpit

**Constaté dans le navigateur** (staging, 21/09) : connecté en super-admin, Antoine
atterrissait sur `/pending` — « en attente d'activation ».

**Cause** : `ProtectedRoute.tsx` testait `if (!gymId) → /pending` **avant** le contrôle de
rôle. Or un super-administrateur a délibérément `gym_id = NULL` : il n'appartient à aucune
salle, sinon il gonflerait le décompte de ses membres.

### a. Le mécanisme retenu : une prop `requireGym`, défaut `true`

**Pourquoi pas un réordonnancement global.** Déplacer le contrôle de rôle avant celui de la
salle changerait le parcours de **toutes** les routes — y compris celui d'un compte sans
profil résolu, qui doit continuer d'atterrir sur `/pending`. Avec la prop, chaque
`<ProtectedRoute>` existant garde le défaut et reste **strictement équivalent** ; seule la
route qui tolère l'absence de salle le déclare, **à son point d'appel, où on peut le lire**.

### b. ✅ Le rôle EST chargé quand `gym_id` est NULL — vérifié

`role` et `gym_id` viennent du **même `.select('gym_id, role')`**, dans les trois chemins du
store : `signIn`, `initialize`, `refreshProfile`. Le rôle se résout donc indépendamment de
la salle. **Pas de loader infini.**

⚠️ Et le loader `role === null` ne s'applique désormais **qu'au parcours qui exige une
salle**. Sans salle exigée, un rôle nul après `initialized` n'est plus une attente mais un
fait — `initialized` n'est posé qu'**après** le fetch du profil (`useAuthStore:252`). On
tombe alors dans la garde de rôle, qui refuse. Un loader éternel serait la pire des réponses.

### c. La destination après connexion

`lib/homePath.ts` — **une seule source** pour les trois points de redirection (route `/`,
route `/login`, et `Login.tsx` après `signIn`). Trois littéraux `'/dashboard'` recopiés
auraient divergé au premier oubli.

⚠️ Rediriger n'interdit rien : `/cockpit` reste gardé par la RPC.

### d. Les écrans qui supposent une salle

Un super-administrateur ne voit **que** le cockpit. Planning, Membres, Formules, Revenus,
Communications et Réglages supposent tous une salle : les lui montrer l'enverrait sur des
écrans vides — ou sur `/pending`, puisqu'ils sont gardés par `requireGym`.

⚠️ **Rien ne change pour un gérant** : la branche n'est prise que pour `super_admin`.

---

## § 3 — Ce que le lot ne fait pas

Aucune action — plan, commission, essai : c'est le **lot 2**, par RPC journalisées dans
`gym_admin_actions`. Pas d'impersonation (tables présentes, 0 ligne, hors périmètre).

---

## § 5 — Alignement sur ce qui a été appliqué

Le cockpit a appliqué la migration en staging avec **deux changements**. Le registre les
porte désormais — sinon il mentirait.

**① `identite_legale_ok` = `public.gym_legal_identity_complete(g.id)`.** Ma version exigeait
`legal_form`, que Dopamine n'a pas — et n'a pas à avoir : une personne physique n'a pas de
forme juridique. Elle aurait affiché **en rouge une salle qui encaisse légalement**, et Pace
avec elle. Vérifié sur la production : avec la règle GYM-121, **les deux sont complètes**.
Une seule règle, et elle vit déjà en base.

**② `REVOKE EXECUTE … FROM anon`.** Toute fonction de `public` naît exécutable par tous, et
PostgREST expose `anon` comme un rôle à part entière : `REVOKE … FROM public` retire le
droit du pseudo-rôle PUBLIC, **pas** celui accordé nommément à `anon`. Sans cette ligne,
`anon` gardait l'EXECUTE — refusé par le garde interne, mais la porte lui restait ouverte.
Vérifié après application : les droits sont `postgres | authenticated | service_role`.

---

## § 6 — Types régénérés

`types/database.ts` régénéré depuis staging (`supabase gen types`). Le cast temporaire de
`useCockpitGyms.ts` est **retiré** — l'appel est typé sans contournement.

⚠️ Le fichier passe de 3160 à **3397 lignes**, et **aucune table n'est perdue** (vérifié par
comparaison). Il était **périmé** : il manquait `claim_app_gym`, `get_effective_plan_core`,
`gym_legal_identity_complete`, `accept_legal_terms`, `attach_profile_to_gym` — toutes
déployées depuis longtemps.

---

## Preuves

- **§ 0** — dérive par graphe d'imports réel : **5 fonctions périmées sur 35** (et non 28
  comme le dirait une comparaison naïve sur `_shared`)
- **§ 2a** — sept vérifications, toutes sur la base de production : aucun chemin client ne
  mène à `super_admin`
- **§ 2b** — 16 politiques sur 17 accordent l'écriture ; signalé, **non modifié**
- 🔴 **Le garde refuse, vérifié avec de VRAIES sessions** sur staging :

  ```
  ✓ admin.clone@staging.test            role=gym_admin  is_super_admin=false → REFUSÉ
  ✓ nexxia.studio+salletest1@gmail.com  role=gym_admin  is_super_admin=false → REFUSÉ
  ✓ member.studiotest@staging.test      role=member     is_super_admin=false → REFUSÉ
  ```

  ⚠️ **Ce qui est testé est le GARDE (`is_super_admin()`), pas la RPC elle-même** — elle
  n'est pas déployée. Le corps du refus est `IF NOT is_super_admin() THEN RAISE`, donc le
  garde est la seule variable ; mais la RPC complète reste à rejouer après application.
- **Les expressions de la RPC validées sur la production** avant écriture : elles rendent
  Dopamine (premium, 109 membres, 139 créneaux à venir, Mollie ✓) et Pace (free, 1 membre,
  19 créneaux, pas de Mollie)
- 🔴 **Banc RLS #293 : 32/32, exit 0 AVANT et APRÈS application.** La migration étant
  désormais appliquée sur staging, ce n'est plus un raisonnement mais une mesure.
- 🔴 **Les trois parcours, avec de VRAIES sessions sur staging :**

  | compte | rôle | salle | après connexion | `/dashboard` | `/cockpit` | données RPC |
  |---|---|---|---|---|---|---|
  | `admin.cockpit@staging.test` | `super_admin` | **NULL** | **`/cockpit`** | `/pending` *(normal, masqué du menu)* | **écran rendu** | **3 salles** |
  | `admin.clone@staging.test` | `gym_admin` | posé | `/dashboard` | écran rendu | écran rendu | **REFUS 42501** |
  | `member.studiotest@staging.test` | `member` | posé | `/dashboard` | Accès réservé | Accès réservé | **REFUS 42501** |

  ✅ **Rien ne change pour le gérant ni pour le membre.** Le super-administrateur, lui,
  n'atterrit plus sur `/pending` et lit bien les trois salles.
- **Aucune politique combinée** : les 17 ont `is_super_admin()` seul — relevé sur la
  production. La migration le revérifie d'elle-même à l'exécution
- **`tsc --build` exit 0** (jamais `--noEmit`, GYM-350)
- ⚠️ **`tsc --build` a d'abord REFUSÉ le lot** : `cockpit_list_gyms` n'existe pas dans
  `types/database.ts`, qui est généré depuis la base. Le contrôle a donc attrapé une vraie
  absence. Contourné par un cast **en un seul point**, documenté et à retirer à la
  régénération des types
- ⚠️ **Migration NON APPLIQUÉE** · ⚠️ **l'écran n'a pas été ouvert dans un navigateur** —
  il n'y a pas de compte super-administrateur pour le faire
- **Aucun déploiement**

---

## À faire par le cockpit, dans cet ordre

1. appliquer la migration **sur staging** ;
2. y créer un compte super-administrateur d'essai, vérifier que la liste s'affiche ;
3. rejouer le refus avec `admin.clone@staging.test` — attendu : écran « Accès réservé », zéro donnée ;
4. régénérer `types/database.ts` et retirer le cast de `useCockpitGyms.ts` ;
5. puis production, et créer `admin@viniz.app`.
