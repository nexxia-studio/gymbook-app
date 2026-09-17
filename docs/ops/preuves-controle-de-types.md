# GYM-350 — Ce qui vaut preuve, et ce qui n'en est pas une

> **La règle en une ligne :** une commande qui rend `exit 0` sans dire **combien de fichiers**
> elle a contrôlés n'est pas une preuve. Exiger le nombre, pas le code de sortie.

Ce document existe parce que, pendant une semaine, des lots dashboard ont été validés sur
`npx tsc --noEmit` — une commande qui, dans ce dépôt, **ne contrôle aucun fichier**.

---

## 1. Dashboard — `tsc -b`, JAMAIS `--noEmit`

### Le piège

`apps/dashboard/tsconfig.json` porte `"files": []` et ne fait que **référencer** d'autres
projets. C'est le gabarit standard Vite React-TS, et c'est **délibéré** : le découpage donne
à `vite.config.ts` les types Node et au code applicatif les types DOM.

Conséquence : `npx tsc --noEmit` charge le tsconfig racine, y trouve zéro fichier, et rend
`exit 0`. **Mesuré :** `npx tsc --noEmit --listFiles` rend **0 ligne**.

```
❌ npx tsc --noEmit      → exit 0 sur 0 fichier.  NE PROUVE RIEN.
✅ npx tsc --build       → exit 0 sur 154 fichiers.
```

`package.json` l'a toujours dit : `"build": "tsc -b && vite build"`.

### Les trois projets référencés

| Projet | Périmètre | Types | Fichiers |
|---|---|---|---|
| `tsconfig.app.json` | `src` (hors `src/tests`) | `vite/client`, DOM | 151 |
| `tsconfig.node.json` | `vite.config.ts` | `node` | 1 |
| `tsconfig.tests.json` | `src/tests` | `node` | 2 |

`tsconfig.app.json` garde son `"exclude": ["src/tests"]` : ces fichiers appartiennent
désormais au troisième projet, et l'exclusion évite la double inclusion. **Ne pas la lever.**

Le troisième projet a été ajouté par GYM-350 parce que `src/tests` n'était contrôlé par
**rien** — et que c'est précisément là que se cachait une assertion de sécurité vide.

### Vérifier soi-même que la couverture est complète

```bash
cd apps/dashboard
for p in tsconfig.app.json tsconfig.node.json tsconfig.tests.json; do
  echo "$p : $(npx tsc -p $p --noEmit --listFiles 2>/dev/null | grep -v node_modules | wc -l)"
done
```

La somme doit couvrir tout `src` + `vite.config.ts`. Si un fichier ajouté n'entre dans aucun
projet, il n'est contrôlé par personne et `tsc -b` restera vert.

---

## 2. Mobile — `tsc --noEmit` est valable ici

`apps/mobile/tsconfig.json` a un `include` réel. Pas de piège.

⚠️ **Mais ne pas citer le total `--listFiles` comme mesure de couverture** : il compte
`node_modules`. Le 17/09/2026 il annonçait **1952** pour **164 fichiers projet** — douze fois
la réalité. Le chiffre honnête :

```bash
cd apps/mobile
npx tsc --noEmit --listFiles | grep -v node_modules | wc -l   # → 164
```

---

## 3. Fonctions Edge — `deno check` sur LES 35, pas sur les seules touchées

`deno check` est une **bonne** preuve : elle suit le graphe d'imports jusqu'à `_shared`
(vérifié par injection délibérée d'une erreur de type), et elle **nomme le fichier**
qu'elle contrôle — elle s'atteste elle-même.

Son défaut n'était pas la commande, mais son périmètre. Lancée « sur les fonctions
concernées » par chaque lot, elle n'a jamais vu `get-progression`, restée non compilable
**des semaines** après GYM-57.

```bash
fail=0
for f in supabase/functions/*/index.ts; do
  deno check "$f" >/dev/null 2>&1 || { fail=$((fail+1)); echo "ECHEC: $f"; }
done
echo "en échec: $fail"   # → attendu : 0 sur 35
```

---

## 4. Bancs Deno — lire le compte, pas le `ok`

Les bancs du dépôt sont des **scripts à corps de module**, pas des `Deno.test()`. Sous
`deno test`, l'affichage indique `0 passed | 0 failed` : c'est **trompeur mais pas creux**.
Le corps s'exécute en « pre-test output », et un échec rend bien `exit 1` (vérifié en
cassant délibérément la fonction testée).

Ce qu'il faut regarder : **la sortie du banc** (`✅ banc complet — 0 échec`) et le **code de
sortie**, pas la ligne `N passed`.

---

## 5. Bancs SQL — dire quand ils n'ont pas tourné

Cette machine n'a pas de serveur PostgreSQL (client libpq seul, pas de Docker). Un banc SQL
écrit mais non joué **doit le déclarer**, en tête de fichier et dans sa recette, avec la
raison — comme le fait `supabase/tests/gym338_adhesion_a_la_source.sql`.

Un attendu dérivé du code n'est pas un attendu observé. Le dire n'affaiblit pas le lot ;
le taire le rend invérifiable.

---

## 6. Bancs RLS — la cible doit exister ET contenir des données

Un banc d'isolation qui interroge une salle **inexistante** rend 0 ligne : il est vert, et il
ne prouve rien. C'est ce qui est arrivé — le banc pointait sur `a0000000-…-0001`, salle de
**production**, absente de staging.

Un banc qui interroge une salle **vide** a le même défaut, en plus discret.

Trois règles, appliquées dans `apps/dashboard/src/tests/rls-isolation.test.ts` :

1. **Aucun compteur en dur.** « L'admin voit 8 activités » périme au premier changement de
   jeu de données. La formulation qui tient : **toutes les lignes vues portent SON `gym_id`**.
2. **La vacuité est marquée, pas tue.** Chaque assertion dont la cible est vide sort
   `<< À VIDE — ne prouve rien` et est comptée à part :
   `32/32 passed | dont 28 qui prouvent quelque chose | 4 à vide`.
3. **Exiger le bon motif d'échec.** Un INSERT inter-locataires doit être refusé avec le code
   **42501** (refus RLS). Une violation `NOT NULL` ou de clé étrangère passerait sinon pour
   une preuve d'isolation.

⚠️ **Les tentatives destructrices visent « Studio Yoga Test 1 »** (1 activité, 1 coach,
0 réservation), jamais « Dopamine (Staging Clone) » dont les 2 activités portent 293 créneaux
et 28 réservations. Le sens Yoga → Dopamine se limite donc à un INSERT.

⚠️ **`admin.dopamine@staging.test` est gérant de Studio Test Staging, pas de Dopamine.** Le
nom ment. Le gérant de Dopamine (Staging Clone) est `admin.clone@staging.test`.

---

## 7. Le motif à retenir

Les quatre cas ci-dessus se ressemblent : **une commande verte dont le périmètre réel est
plus étroit qu'on ne croit.** Avant d'accepter une preuve, se demander non pas « est-ce
vert ? » mais :

1. **Combien** de fichiers / cas / lignes ont été contrôlés ?
2. Ce nombre couvre-t-il ce que le lot a **touché** ?
3. La commande **échouerait-elle** si le défaut était présent ? — en cas de doute, casser
   délibérément le code et vérifier qu'elle passe au rouge. C'est le seul test d'un test.

La question 3 est celle qui a démasqué l'assertion RLS vide : elle passait au vert avec les
RLS grandes ouvertes. Elle a servi trois fois dans GYM-350 — sur `deno check`, sur le banc
`early-performance`, et sur le banc RLS réécrit (attaquant pointé sur sa propre salle :
**exit 1, 6 échecs critiques**).
