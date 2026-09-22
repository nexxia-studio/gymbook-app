# Parcours gérant (PR B) — le logo, le retour à l'assistant, et trois retours de prod

**Branche** `gym-logo-et-retour-assistant` · **base** `develop` · aucun déploiement, **aucun
build Expo**. Dashboard + une lecture de grille — rien de serveur.

---

## 5–7. Le logo

### Le téléversement remplace l'URL

L'étape 1 demandait « **Colle l'URL d'une image déjà en ligne** » : autrement dit, résous un
problème d'hébergement avant de pouvoir poser ton logo, à la première étape de ta
configuration.

C'est désormais `MediaUpload` — **le composant qui existait déjà** (GYM-305/215), celui de
Réglages → Apparence. Le wizard était le seul écran à ne pas l'utiliser. Il apporte, sans
qu'on écrive une ligne : clic **et** glisser-déposer, contraintes du bucket dites **avant**
l'envoi, chemin déterministe `{gym_id}/logo.{ext}`, nettoyage des frères d'extension, `?v=`
anti-cache.

⚠️ **`logo_url` se persiste à l'envoi**, plus au clic sur « Enregistrer » — contrat de
`MediaUpload`, et la même règle qu'`AppearanceCard`. Le réécrire à la soumission reposerait
la valeur lue au chargement et **annulerait** un logo posé entre-temps.

### 7. Formats, poids, transparence, monochrome — ce que ça donne

| | |
|---|---|
| **Formats** | **PNG · JPEG · WebP**. Le SVG a été **retiré du bucket** par décision cockpit (GYM-305b) et `MediaUpload` le refuse avant l'envoi. |
| **Poids** | **2 Mo**, la limite réelle du bucket (`file_size_limit = 2097152`), rejouée côté client pour refuser **sans aller-retour**. |
| **Transparent** | **Recommandé, et c'est déjà géré** : l'aperçu se pose sur fond sombre, et l'extraction **ignore les pixels dont l'alpha < 128**. Sans cela, un PNG transparent serait majoritairement « du noir » et toutes les propositions vaudraient `#000000`. |
| **Monochrome** | **Aucune couleur n'est proposée.** Un logo noir et blanc n'a pas de couleur de marque — seulement du contraste. On n'en invente pas : l'écran ne montre rien et la palette Viniz reste suggérée. |

### 6. Les couleurs se déduisent du logo — proposées, jamais posées

Canvas 64 × 64, regroupement des teintes par paquets de 24 (sans quoi un dégradé ou une
compression JPEG éparpille une même couleur sur des centaines de valeurs voisines et aucune
ne ressort), puis :

- **l'action** = la couleur dominante réellement *colorée* (saturation ≥ 0,25) ;
- **le fond** = une dominante sombre du logo, sinon une version assombrie de l'action.

🔴 **Le garde-fou décide, pas le goût.** Chaque couple candidat passe par `forecastBrand`
(GYM-285), qui rejoue les deux conditions du garde-fou mobile. **On ne propose qu'un couple
qui ne déclenche aucun repli** — proposer « à peu près » ferait accepter au gérant des
couleurs que sa propre app ignorerait. C'est très exactement le cas nommé par GYM-102 :
*deux tons clairs doivent déclencher l'alerte*.

🔴 **`NULL` reste `NULL`.** Aucune couleur ne part en base sans un clic sur « Utiliser ces
couleurs ». Décision GYM-102, à ne jamais défaire — et le libellé le dit à l'écran :
« *Rien n'est enregistré tant que tu n'as pas cliqué* ».

⚠️ **Le canvas peut échouer** (URL externe posée à la main, en-tête CORS manquant) :
`getImageData` lève, on rend `null`, et l'écran ne montre rien. Un logo qui se pose mais
dont les couleurs ne se lisent pas reste un logo qui se pose.

⚠️ **Le module est scindé en deux**, et c'est structurel : `logoColors.ts` (la **décision**,
pure) et `logoColorsFromImage.ts` (le **canvas**). `src/tests` est compilé avec les types
**node**, sans `dom` (GYM-350, trois projets) : un banc qui importerait `Image` ferait
échouer `tsc --build`.

---

## 3. Le retour à l'assistant — les deux volets

### ② Étapes 2 et 3 : la modale s'ouvre au-dessus du dashboard

`ActivityModal` et `CoachModal` — **les composants de Réglages, avec les mêmes gestionnaires
de création**. Aucune seconde version d'un formulaire qui existe déjà. Le gérant ne quitte
plus le fil.

🔴 **Et ça a cassé une hypothèse qu'il fallait réparer.** `useOnboarding` documentait
explicitement l'absence de `refresh()` : « *quitter le dashboard démonte le wizard, y revenir
le remonte — `load()` rejoue donc la détection tout seul* ». L'argument était **bon** tant
qu'on partait. On ne part plus : la détection ne se rejouerait **jamais**, et l'assistant
continuerait de proposer de créer une activité qui existe. `refresh()` est donc exposé, et le
commentaire corrigé plutôt que laissé à mentir.

### ① Étapes 4 à 6 : le bandeau de retour

`OnboardingReturnBanner`, monté dans `DashboardLayout` : « **Étape 4 sur 6** · Reviens à la
configuration quand c'est fait » + « Reprendre la configuration ».

⚠️ **Il ne s'affiche pas sur `/dashboard`** — l'assistant y est déjà. Et **pas avant l'étape
4** : 2 et 3 n'envoient plus nulle part.

⚠️ **Planning, politique d'absences et membres restent des navigations**, délibérément : ce
sont de **vrais écrans**, pas des formulaires. Les enfermer dans une modale serait pire que
le voyage.

### ③ L'étape n'avance jamais au clic

Inchangé, et protégé : la modale appelle `refresh()`, **jamais `advance()`**. Une étape n'est
franchie que parce que **la chose existe**. C'est la règle tirée du premier parcours E2E, et
elle survit intacte.

---

## 1a. La photo du coach s'affiche enfin

La PR précédente a branché le téléversement ; `photo_url` se remplit bien (vérifié en base) —
et **la liste des coachs montrait toujours la bulle d'initiales**. Aucun composant hors de la
modale ne lisait `photoUrl`.

`CoachAvatar` : **photo si elle existe, initiales colorées sinon**. Une seule règle, un seul
composant — deux rendus d'avatar auraient divergé au premier ajustement (motif de
`ColorField`, GYM-285).

📋 **Recensé, et il n'y avait qu'un endroit.** Les vues de planning (`SlotCard`,
`SlotDrawer`, `PlanningCalendar`) affichent le **nom** du coach, jamais d'avatar. Y ajouter
une photo serait un changement de maquette, pas une correction — **non fait**, signalé.

---

## 2. Le cockpit — ta décision remplace la mienne

> Plan **servi** en bleu, et à la ligne, en **orange**, le plan **souscrit**. Rien d'autre.

La phrase grise « *essai jusqu'au 06/10 · souscrit : Free* » que j'avais posée en PR A est
**retirée** : elle répétait deux colonnes voisines — la date est dans « Fin d'essai », le
statut dans « Statut ». La clé i18n `cockpit.plan_trial` est supprimée avec elle.

Même règle sur la fiche salle (`Champ` reçoit un drapeau `bleu`).

⚠️ **L'orange n'est plus une alerte ici, c'est un code** : « voici ce qui est souscrit ». Le
cockpit n'a qu'un lecteur, et il connaît sa convention.

---

## 3'. « Ouvrir l'app » — le lien devient intelligent

**Deux niveaux, et l'ordre est le point :**

**① Le lien universel d'abord** — `links.viniz.app/<slug>/bookings`. Si l'app est installée,
le système l'ouvre **sans passer par le navigateur** : c'est la seule issue qui marche pour
un membre déjà équipé, et c'est la plupart d'entre eux.

⚠️ **`/<slug>/bookings` et non `/<slug>`** : l'AASA réclame `/dopamine/*` et `/*`, donc un
**sous-chemin**. Un slug nu n'est revendiqué par aucune app **et n'est servi par aucune
réécriture** (`apps/links/vercel.json`) — il rendrait le 404 brut de l'hébergeur. `bookings`
est réécrit vers la page Viniz de repli (GYM-287), qui dit d'ouvrir l'application.

**② Les magasins ensuite**, et seulement ceux du visiteur (iOS / Android / les deux sur
ordinateur).

### 🔴 La vérification que tu demandais : le Play Store n'est PAS public

```
https://play.google.com/store/apps/details?id=be.dopamineclub.app  →  HTTP 404
```

**Mesuré le 22/09.** La fiche attend bien la validation de Google. `android` vaut donc
**`null`** dans `lib/memberApp.ts`, **aucun bouton Android ne s'affiche**, et le commentaire
porte la mesure et la date. Le jour où elle est publique, une seule ligne à remplir — l'écran
suit sans autre changement.

⚠️ Un bouton vers une page d'erreur serait exactement le défaut qu'on vient de corriger
ailleurs.

⚠️ **La règle GYM-303 tient** : une table `slug → app`, une seule entrée (Dopamine est la
seule app publiée), et **le neutre Viniz par défaut**.

---

## Les preuves

### `tsc --build` — exit 0

```
tsconfig.app.json : 165 · tsconfig.node.json : 1 · tsconfig.tests.json : 5
```

`tests` passe de 2 à 5 fichiers : le nouveau banc y entre, avec `logoColors` et
`brandContrast`. Parité i18n : **1406 / 1406**.

### Banc des couleurs — 8 assertions, **falsifié à exit 1**

`apps/dashboard/src/tests/logo-colors.test.ts` (`npm run test:logo-colors`) :

| # | Cas |
|---|---|
| 1 | un logo coloré rend un couple, **et ce couple passe le garde-fou** |
| 2 | un logo **monochrome** ne propose **rien** |
| 3 | liste vide → `null` |
| 4 | **deux pastels voisins** : le couple fautif n'est jamais rendu |
| 5 | **balayage de 24 teintes** — 19 couples proposés, **0 fautif** |

**Falsification** : en retirant `if (!forecastBrand(...).hasWarning)`, le balayage passe à
**24 couples proposés dont 10 fautifs** et le banc sort en **exit 1**. Le garde-fou n'est pas
décoratif.

⚠️ Le cas 5 existe parce qu'**un banc qui n'essaie qu'un cas ne prouve rien** (GYM-350) : on
exige l'invariant sur toute la roue des teintes, pas sur une couleur choisie.

### `deno check` — 36 / 36

Aucune fonction Edge touchée ; la convention ne fait pas d'exception.

### Ce que je n'ai pas

⚠️ **Aucun navigateur ouvert.** Le banc éprouve la **décision** (quel couple, et passe-t-il
le garde-fou) ; la lecture du canvas, le glisser-déposer et le rendu se lisent au diff et se
contrôlent par `tsc --build`. **`MediaUpload` est déjà en service** sur deux écrans — c'est
ce qui rend son branchement peu risqué.

---

## Ce qui reste

- **Rien n'est déployé.** Ce lot est entièrement dashboard : aucune migration, aucune Edge.
- **1b — la photo du coach dans l'app membre** : livrée dans une **PR séparée** (c'est du
  mobile, elle partira avec la 1.2.2), pour que le dashboard ne l'attende pas.
- **Le Play Store** : remplir `android` dans `lib/memberApp.ts` dès que la fiche est
  publique. Une ligne.
