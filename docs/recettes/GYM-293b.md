# Recette — GYM-293b · le résolveur débloqué, et l'inscription lisible

⚠️ **Exige la migration `20260831100000_gym293b_plan_core.sql` appliquée.** Sans elle, Q1
à Q8 échouent tous de la même façon : le rattachement est refusé côté serveur, et rien de
ce que montre l'écran n'en dit la cause.

> **GYM-293 était INJOUABLE en l'état, et ce lot est ce qui le rend recettable.**
> `join_gym_self_serve` demandait le plan de la salle à `get_effective_plan`, dont l'ACL
> n'admet qu'un profil dont la salle ACTIVE est déjà celle qu'on interroge. Un candidat ne
> l'a jamais. Les questions Q4–Q8 de `GYM-293.md` échouaient donc à tous les coups, en
> affichant un message d'indisponibilité pour un refus structurel.

## 1. Le rattachement passe (la preuve serveur)

| # | geste | attendu |
|---|---|---|
| B1 | 🔴 SQL, sous l'identité d'un compte **non membre** : `select public.join_gym_self_serve('studio-test-staging')` | un jsonb **`"created": true`**. Avant : `ERROR 42501` |
| B2 | Rejouer B1 | `"created": false` — l'idempotence de GYM-293, pas un échec |
| B3 | Sous la même identité : `select public.get_effective_plan(<id studio-test>)` | **toujours 42501**. L'ACL n'a pas bougé — c'est le CŒUR qui a été ouvert, pas la porte |
| B4 | `select public.get_effective_plan_core(<id>)` en tant que membre connecté | **refus** : la fonction est privée, révoquée de `authenticated` |
| B5 | Le dashboard (plan, limites, quotas), un gérant connecté | **inchangé** — même signature, mêmes codes, même jsonb |

Puis **rejouer intégralement `GYM-293.md`** : Q4 à Q8 et Q13 à Q17 n'avaient jamais pu
l'être.

## 2. L'écran d'inscription (les finitions de recette Q3/Q5)

Sur **Studio Test Staging** (carte rose `#F2D6DE`) et sur **Studio Yoga Test 1** (sombre).

| # | geste | attendu |
|---|---|---|
| B6 | 🔴 Ouvrir l'inscription depuis la connexion brandée | l'en-tête porte **le nom de la salle**, jamais « Dopamine Performance Club » |
| B7 | 🔴 Regarder les six champs | chacun se **détache de la carte** : un creux et un contour visibles. Avant : la carte et le champ avaient la **même** couleur (1,00:1), et le trait 1,01:1 |
| B8 | Taper dans un champ, puis l'effacer | texte saisi et **placeholder** lisibles tous les deux |
| B9 | 🔴 Les deux cases **CGV** et **confidentialité**, décochées | **visibles sans les chercher**. Avant : case de la couleur de la carte, trait à 1,01:1 |
| B10 | Les cocher | ✓ contrasté sur la couleur d'action — inchangé, ce cas allait déjà |
| B11 | Valider sans cocher | l'erreur désigne une case **qu'on voit** |

## 3. Les textes légaux (jamais ceux d'un autre club)

| # | geste | attendu |
|---|---|---|
| B12 | 🔴 Inscription → lien **« Conditions Générales »** | article 1 : « l'application **Viniz** », « auprès de **Studio Test Staging**, *sa commune* ». **Aucune** occurrence de « Dopamine » |
| B13 | Lien **« Politique de Confidentialité »** | Nexxia / Viniz — inchangé, ce texte ne nommait aucun club |
| B14 | Les mêmes écrans **connecté**, chez une autre salle | l'identité suit la salle **active** |
| B15 | 🔴 Un compte **sans salle** (B-suite de Q13) → CGV | « auprès de **votre salle** » — neutre, sans virgule orpheline. Jamais un nom de client |

## 4. Ce qui ne doit PAS bouger

| # | geste | attendu |
|---|---|---|
| B16 | 🔴 Build **Dopamine** (single) → inscription, connexion, mot de passe oublié | **identique au pixel** : champs blancs, trait `#E8E6E0`, placeholder `#9A9890` |
| B17 | 🔴 Dopamine → Profil → **Conditions Générales** | texte **identique au caractère** : « l'application Dopamine … auprès de **Dopamine Performance Club**, Neupré » |
| B18 | Dopamine, n'importe quel écran à formulaire (recherche, filtres, profil) | inchangé — les jetons de champ y valent ce qu'ils valaient |
| B19 | Multi, **compte sans salle** | l'en-tête dit **« Viniz »**, jamais un nom de client |

> B16–B18 sont tenus mécaniquement par `verify-theme-parity`, `verify-screen-parity`,
> `verify-cgv-salle` et `verify-nom-salle-contexte` — la recette les **confirme** sur
> appareil, elle ne les remplace pas.
