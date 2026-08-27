# GYM-300 — Pourquoi le choix de salle n'était pas soumis

> **Conclusion, en une phrase.** La soumission n'a pas échoué : elle n'avait pas lieu
> d'être. Le compte incriminé n'a **qu'une seule adhésion** en base — les deux
> `server_wins` étaient corrects, et le bouton « Changer de salle » avait raison de rester
> caché. Ce que le lot corrige, c'est le **silence** qui a rendu ce fonctionnement correct
> indiscernable d'un défaut pendant une journée de QA.

---

## 1. La mesure qui tranche

La prémisse du ticket — « admin.dopamine@staging.test, membre des 3 salles staging » — est
la seule chose qui n'a pas été vérifiée avant l'enquête. Elle est fausse.

```sql
select u.email,
       (select count(*) from member_gyms mg where mg.member_id = u.id) as nb_adhesions,
       (select string_agg(g.slug, ', ')
          from member_gyms mg join nexxia_gyms g on g.id = mg.gym_id
         where mg.member_id = u.id)                                    as adhesions
from auth.users u where u.email like '%staging.test';
```

| compte | adhésions | salles |
|---|---|---|
| `admin.dopamine@staging.test` | **1** | `dopamine-staging` |
| `member.dopamine@staging.test` | 1 | `dopamine-staging` |
| `member.studiotest@staging.test` | 1 | `studio-test-staging` |
| `member.yoga@staging.test` | 1 | `studio-yoga-test-1` |
| `qa.train3@staging.test` | 1 | `dopamine-staging` |

Et le constat général, qui va plus loin que ces cinq comptes :

```
comptes par nombre d'adhésions : 1 adhésion → 19 comptes.   (aucune autre ligne)
```

🔴 **Aucun des 19 comptes de staging n'appartient à plus d'une salle.** Le parcours
multi-salles n'a donc jamais pu être exercé — ni la bascule, ni l'écran de changement de
salle, ni le bouton qui y mène.

---

## 2. Les quatre candidats, éliminés un par un

### (a) La lecture d'adhésions revient-elle vide, ou en erreur avalée ?

**Non.** La RPC a été exécutée *en tant que le compte incriminé* :

```sql
do $$ begin perform set_config('request.jwt.claims',
     json_build_object('sub', (select id from auth.users
                               where email='admin.dopamine@staging.test'),
                       'role','authenticated')::text, true); end $$;
set local role authenticated;
select gym_id, slug, name, is_active from public.my_gym_memberships();
```

```
a0000000-…-05ba | dopamine-staging | Dopamine (Staging Clone) | true
```

Une ligne, le bon slug, `is_active` juste. Pas de sous-retour, pas de RLS qui filtre, pas
d'erreur. Le `catch` large de `listMyGyms` (`lib/gymSwitch.ts:78`) n'a pas été emprunté —
et il n'aurait de toute façon pas produit `server_wins` mais `unavailable`
(`lib/activeGymSession.ts:159-163`).

### (b) `switch_active_gym` est-elle tentée ? refusée ? avec quel code ?

**Elle n'est pas tentée**, et c'est correct. `lib/activeGymSession.ts:188` court-circuite
la soumission quand le slug choisi n'est pas dans les adhésions.

La supposition du ticket — « `switch_active_gym` aurait réussi » — est fausse elle aussi :
les deux fonctions lisent **exactement la même table avec le même prédicat**.

| | prédicat d'adhésion |
|---|---|
| `switch_active_gym` (20260826160000, l. 181-184) | `EXISTS (SELECT 1 FROM member_gyms WHERE member_id = v_uid AND gym_id = p_gym_id)` |
| `my_gym_memberships` (20260827100000, l. 47-52) | `FROM member_gyms mg … WHERE mg.member_id = auth.uid()` |

Soumettre aurait donc rendu **PT403**, c'est-à-dire le même verdict par un aller-retour de
plus. Le court-circuit est une optimisation, pas une divergence de règle.

> Deux écarts existent malgré tout entre les deux prédicats, sans effet ici mais réels :
> `my_gym_memberships` filtre `g.deleted_at is null` et joint `profiles`. Une salle
> supprimée en douceur serait donc **absente de la liste mais acceptée par la bascule**.
> Reporté au cockpit, § *À REMONTER*.

### (c) La décision se prend-elle avant que la liste soit revenue ?

**Non.** `const memberships = await listMyGyms()` (l. 158) précède le calcul de `choisie`
(l. 175) et toutes les branches qui s'en servent. Aucune course : un seul `await`, une
seule lecture, et la décision après.

### (d) Le bouton de switch partage-t-il la même source ?

**Oui — et c'est la confirmation, pas la panne.** `useCanSwitchGym`
(`app/(tabs)/profile.tsx:66-77`) affiche le bouton si et seulement si
`res.status === 'ok' && res.gyms.length > 1`.

Avec une adhésion : `length > 1` est faux, le bouton se cache. **Une seule cause, deux
symptômes** — exactement l'hypothèse du ticket. Mais la cause est la **donnée**, pas le
code : les deux comportements sont ceux que la spécification demande.

---

## 3. Ce qui restait donc à corriger — et qui l'est

| # | Défaut réel | Correctif |
|---|---|---|
| §4 | `server_wins` ne disait pas POURQUOI. Deux chemins, un seul nom. | `reason`, ensemble fermé de 7 valeurs, une par sortie. |
| §2 | Un échec de lecture était bien distinct… et parfaitement muet. | Annoncé au membre, au point de passage unique. |
| 3a | Le `server_wins` légitime ne disait rien du tout. | « Tu n'es pas membre de X — te voilà chez Y ». |
| 3b | La marque survivait au changement de slug, **indéfiniment**. | Marque solidaire de son slug. |
| 3c | Le nom de la salle en blanc fixe, invisible sur fond clair. | Encre résolue, alpha conservé. |

---

## 4. À REMONTER AU COCKPIT

1. 🔴 **Staging ne peut pas recetter le multi-salles.** Les 19 comptes ont une adhésion
   chacun. Les blocs B et C de la recette, le bouton « Changer de salle », l'écran
   `profile/gym-switch` et l'issue `switched` sont **inexerçables en l'état**. Il faut
   ajouter au moins une adhésion à un compte de test — c'est une écriture en base sur un
   environnement partagé, donc une décision cockpit, pas une initiative de ce lot.
2. **La prémisse du ticket était fausse**, et rien dans l'outillage ne permettait de s'en
   apercevoir. C'est ce que `reason` corrige pour la prochaine fois.
3. **`my_gym_memberships` et `switch_active_gym` divergent sur deux filtres**
   (`deleted_at`, jointure `profiles`). Une salle supprimée en douceur serait absente de la
   liste mais acceptée par la bascule. Sans conséquence connue aujourd'hui ; à trancher.
4. **Aucune infrastructure de test dans `apps/mobile`** — ni jest, ni vitest, ni script
   `test`. Les garanties de ce lot tiennent à des scripts de vérification maison. C'est
   signalé à chaque lot depuis GYM-286.
