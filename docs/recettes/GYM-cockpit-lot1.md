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

### b. Les 17 politiques : **16 accordent l'ÉCRITURE**

| portée | nombre | tables |
|---|---|---|
| 🔴 `ALL` (lecture **et** écriture) | **16** | `nexxia_gyms`, `nexxia_subscriptions`, `nexxia_invoices`, `nexxia_plan_limits`, `nexxia_features`, `profiles`, `audit_logs`, `consent_history`, `gdpr_requests`, `gym_admin_actions`, `gym_communications`, `gym_mollie_connections`, `impersonation_logs`, `login_attempts`, `medical_notes`, `super_admin_proxy_actions` |
| ✅ `SELECT` | 1 | `credit_adjustments` |

**Le lot 1 est en lecture seule par l'interface, pas par la base.** Le compte
super-administrateur, une fois créé, pourra écrire partout via la RLS — y compris sur
`profiles`, donc **promouvoir d'autres super-administrateurs**.

⚠️ **Non modifié, comme demandé.** Mais c'est un arbitrage à prendre avant le lot 2 : soit
les politiques restent `ALL` et le lot 2 s'y appuie, soit on les restreint et le lot 2
passe par des RPC `SECURITY DEFINER` journalisées. La seconde voie est celle que le lot 2
annonce déjà (`gym_admin_actions`).

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

---

## § 3 — Ce que le lot ne fait pas

Aucune action — plan, commission, essai : c'est le **lot 2**, par RPC journalisées dans
`gym_admin_actions`. Pas d'impersonation (tables présentes, 0 ligne, hors périmètre).

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
