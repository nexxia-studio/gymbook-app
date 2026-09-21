# GYM-250 (PR 1) — L'essai de 14 jours : les prérequis

> **Rien ne change pour personne.** `v_trial_enabled` reste `false` : le plan effectif est
> toujours la colonne, et pas un centime de commission ne bouge. Cette PR ne fait que
> **désarmer les pièges** que l'allumage aurait déclenchés. L'allumage est la **PR 2**.

**Branche** `gym-trial-prereqs` · **base** `develop` · **aucun déploiement**, aucun build Expo.

---

## a. 🔴 La commission lit le plan EFFECTIF, plus la colonne

### Ce que le défaut aurait coûté

`_shared/commission.ts` lisait `nexxia_gyms.plan` — **la colonne**. Pendant un essai, la
colonne vaut encore `free`, dont les deux taux sont à **0**. Or dans
`mollie-subscription-webhook`, l'`applicationFee` est **scellée à la création de
l'abonnement Mollie** et ne change plus jamais :

> **Tout abonnement récurrent vendu pendant les 14 jours d'essai aurait porté 0 % de
> commission pour toute sa vie** — y compris après le passage de la salle à un plan payant.
> Mesuré au banc : **10,68 € perdus par abonnement de 89 €**, sur douze échéances.

Ce n'est pas un défaut que l'allumage *révèle* : c'est un défaut que l'allumage **arme**, et
qu'aucune migration ne peut rattraper ensuite — la valeur est chez Mollie.

### Une seule source, et elle ne recalcule rien

`get_effective_plan` résout **déjà** les commissions : `dérogation ?? taux du plan effectif`,
avec `0` comme dérogation valide. Le module ne refait plus ce calcul à côté — il le **lit**.

```ts
export function commissionFromPlan(plan: EffectivePlan): EffectiveCommission
export async function getEffectiveCommission(admin, gymId): Promise<EffectiveCommission | null>
```

| Appelant | Avant | Après |
|---|---|---|
| `create-payment` | 2ᵉ lecture (`getEffectiveCommission`) | `commissionFromPlan(effectivePlan)` — **0 requête** |
| `create-subscription` | 2ᵉ lecture | `commissionFromPlan(effectivePlan)` — **0 requête** |
| `mollie-subscription-webhook` | **deux** lectures séparées | **une seule**, réutilisée aux deux endroits |

Les deux premiers tiennent déjà leur `EffectivePlan` depuis la garde `payments_enabled`,
quelques lignes plus haut. Re-résoudre aurait été une seconde lecture pouvant répondre
autre chose que la première : **la salle facturée sur un taux qu'elle n'avait pas quand on
a décidé qu'elle pouvait vendre**.

Dans le webhook, les deux lectures servaient à deux choses qui doivent être **le même
chiffre** : l'`applicationFee` réellement prélevée, et le `nexxia_fee` qui en garde la
trace dans `payments`. Deux lectures pouvaient diverger — on aurait alors *enregistré un
montant que Mollie n'a pas prélevé*.

### 🔴 Changement de contrat : `null` veut dire « on ne sait pas »

| | Avant | Après |
|---|---|---|
| Résolution du plan en échec | `{ cbRate: 0, sepaRate: 0 }` — **facturé comme une exonération** | `null` — l'appelant refuse |

Sur un abonnement récurrent, ce zéro-là était **scellé pour douze mois**. Le webhook
enregistre désormais une lettre morte (`stage: 'commission_resolution'`) et rend **503** :
Mollie réessaie, et le rappel est idempotent — un retry ne recrée rien.

Même doctrine que GYM-246 pour `PLAN_RESOLUTION_FAILED` : *une panne ne se dégrade jamais
en refus de droit — ni en cadeau commercial.*

---

## b. Les `DEFAULT` qui décidaient d'un droit disparaissent

```sql
ALTER TABLE public.nexxia_gyms ALTER COLUMN trial_ends_at DROP DEFAULT;  -- était now() + 14 days
ALTER TABLE public.nexxia_gyms ALTER COLUMN status        SET DEFAULT 'active';  -- était 'trialing'
```

### L'inventaire demandé, mesuré sur les deux bases

| | Salles | Avec une `trial_ends_at` | Dont **date future** | En `status = 'trialing'` |
|---|---|---|---|---|
| **Production** | 2 | **0** | 0 | 0 |
| **Staging** | 3 | **3** | **1** | 0 |

**La production est propre** — tu avais raison. Les deux salles sont antérieures à ce
chemin et portent `NULL`.

**Staging ne l'est pas.** Les trois salles portent une date héritée du `DEFAULT`, sans
qu'aucune n'ait jamais eu d'essai :

| Salle | `trial_ends_at` | créée |
|---|---|---|
| Studio Test Staging | **2026-10-05 — dans le futur** | 02/07 |
| Studio Yoga Test 1 | 2026-09-06 (passé) | 23/08 |
| Dopamine (Staging Clone) | 2026-07-17 (passé) | 03/07 |

🔴 **Pourquoi c'est urgent et pas cosmétique.** Le cockpit (lot 2) sait déjà poser
`status = 'trialing'` depuis la fiche salle. Le jour de l'allumage, ce geste aurait
distribué du Pro **au hasard des dates héritées** : instantanément à « Studio Test
Staging », jamais aux deux autres — et personne n'aurait su pourquoi.

⚠️ **La purge n'est pas dans cette PR** : ces trois dates sont le jeu d'essai du banc de la
PR 2, qui les purgera ensuite (décision 4). Retirer le `DEFAULT` empêche d'en créer de
nouvelles ; c'est tout ce que cette PR doit faire.

---

## c. `create_gym_self_serve` pose l'essai explicitement

```sql
plan, status,     trial_ends_at,
'free', 'trialing', now() + interval '14 days',
```

Corps **repris à l'identique** de GYM-338 (version déployée, relue sur la base le 21/09) —
seuls l'`INSERT` et son commentaire changent.

Même argument que **GYM-308 pour la TVA**, quelques lignes plus bas dans cette même
fonction : *un `DEFAULT` est invisible depuis le code, s'applique à tout `INSERT` et se
modifie sans que personne ne relise cette RPC.*

### ⚠️ Un état transitoire, assumé — et il faut le savoir

Entre cette PR et la PR 2, une salle créée en libre-service sera `trialing` **avec une vraie
date**, tout en recevant les limites de `free`. Concrètement :

- `trial_active` rend `false`, le plan effectif reste `free` — **aucun droit ne change** ;
- `status` n'est lu par **aucune politique RLS** (0 sur 85), aucun écran, aucune fonction —
  vérifié ;
- le **cockpit** affichera ce désaccord (statut `trialing`, essai inactif). C'est le seul
  endroit où il se voit, et c'est toi qui le regardes ;
- **à l'allumage, ces salles récupèrent leur essai** si la date n'est pas passée. C'est
  voulu : elles auront été créées sous la promesse des 14 jours.

---

## d. Le tableau comparatif ne promet plus ce que le code ne tient pas

Quatre lignes retirées de `CATALOG_FEATURE_KEYS` (et leurs libellés fr/en) :
`qr_checkin_enabled`, `ios_app_enabled`, `android_app_enabled`, `api_access_enabled`.

Recensement du 21/09 sur les 35 fonctions Edge, tout `apps/dashboard/src` et toute l'app
mobile : **aucun code ne les lit**. Le check-in QR n'a même aucune implémentation.

> Le tableau mentait dans les **deux** sens : il refusait à Free l'application iOS que Free
> a en réalité, et il promettait à Pro un check-in QR qui n'existe pas.

⚠️ **On ne les branche pas** (décision 2). Dans Viniz toutes les salles vivent dans la
**même** application : couper l'app selon le plan couperait l'accès à des membres qui ont
payé — c'est-à-dire casserait l'extinction. Le lot A vient de retirer cette faute de la
réservation ; la rajouter ici serait la remettre à une autre porte.

⚠️ **Les colonnes restent lues et typées** : `CatalogPlan` décrit la table, pas cet écran.
Le jour où l'une de ces fonctionnalités existe, une ligne la remet.

📋 **Signalé, non touché** (hors décision du 21/09) : `custom_domain` n'est appliqué nulle
part non plus, et `multi_site_enabled` — lui bien appliqué (`CoachModal`) — est à `false`
sur les **quatre** plans. Aucune des deux ne ment ; elles n'informent simplement personne.

---

## Les preuves

### `deno check` — 35 / 35

```
deno check : 35 contrôlées · 0 en échec
```

### `tsc --build` (dashboard) — exit 0

```
tsconfig.app.json : 156 · tsconfig.node.json : 1 · tsconfig.tests.json : 2
```

Parité i18n : **fr 1374 clés / en 1374 clés**, aucune divergence.

### Banc SQL de commission — staging, transactionnel, **9 / 9**

`supabase/tests/gym_trial_commission.sql`, en `BEGIN … ROLLBACK`.

| # | Cas | Obtenu |
|---|---|---|
| ① | Balayage salle × plan × dérogation | **0 écart sur 72 comparaisons** ✅ |
| ② | Le balayage a bien eu lieu | 72, pas 0 ✅ |
| ③ | Les salles telles qu'elles sont | 0 écart sur 3 ✅ |
| ④ | Constante déployée relue avant remplacement | `false` ✅ |
| ⑤ | **Sous essai** : l'ancien chemin lit la colonne `free` | `0,0000` ✅ |
| ⑥ | **Sous essai** : le nouveau sert le plan effectif | `0,0100` ✅ |
| ⑦ | 🔴 **Les deux divergent** | `0,0000` contre `0,0100` ✅ |
| ⑧ | Ce que l'écart coûte | **10,68 €** par abo de 89 €, × 12 échéances ✅ |
| ⑨ | Sous essai, une dérogation à 0 % l'emporte encore | `0` ✅ |

Les 3 dérogations balayées sont `NULL`, `0` et `0,03` : le `0` est le cas **Dopamine**,
celui qu'un `coalesce` naïf écraserait.

**⑦ est joué en remplaçant la fonction dans la transaction**, à partir de son propre code
source déployé (`pg_get_functiondef`, `replace(false → true)`) : le banc ne peut pas se
tromper sur le corps. Le DDL est transactionnel — le `ROLLBACK` l'annule.

**Étanchéité revérifiée après coup**, pas supposée : `v_trial_enabled` est de nouveau
`false` dans la fonction déployée, et les trois salles sont revenues à `pro`/`active` avec
leurs dérogations à `NULL`.

⚠️ **① et ⑦ se falsifient l'un l'autre.** Un banc qui rendrait toujours « égal » ne
prouverait rien ; ⑦ montre le **même** couple de chemins en désaccord, sur la même base, à
la seule différence de la constante.

### Banc TypeScript — 11 assertions, **falsifié à exit 1**

`supabase/functions/_shared/commission_test.ts` : les taux viennent des `commissions` et
non du nom de plan · `numeric` traversé en chaîne reste un nombre · `0 %` reste `0 %` · **une
panne rend `null`, pas `{0, 0}`**.

**Falsification** : en rétablissant le repli `{ cbRate: 0, sepaRate: 0 }`, le banc passe à
**2 échecs et exit 1**. Restauré, exit 0.

### Contrôle d'application, dans la migration

Trois `RAISE EXCEPTION` si l'application n'a pas fait ce qu'elle annonce — plus une
**ceinture** : la migration **échoue** si `v_trial_enabled` n'est plus `false`. L'allumage
est la PR 2, et cette migration refuse de servir de cheval de Troie.

---

## Ce qui reste

- **Rien n'est appliqué.** Ni migration, ni fonction Edge déployée.
- **L'ordre de déploiement compte** : la migration *puis* les trois fonctions Edge, ou
  l'inverse — c'est indifférent ici, puisque rien ne change tant que la constante est
  éteinte. C'est précisément ce que le banc établit.
- **PR 2 (`gym-trial-on`)** : cron de fin d'essai, relances J-3 / J-0 / J+7 idempotentes,
  bandeau dashboard, libellé membre, purge des dates héritées, et l'allumage dans une
  migration à part.
