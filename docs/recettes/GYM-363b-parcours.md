# GYM-363b — retours du parcours réel (28/09)

**Branche** `gym-363b-parcours` · **base** `develop` · aucun déploiement, **aucun build
Expo**. Dashboard uniquement — **aucune migration**.

---

## ① L'étape 5 ne se valide pas — la cause, avant la correction

### Ce qui autorise le passage de l'étape 5

Rien de particulier : comme les étapes 2, 3, 4 et 6, elle se franchit **parce que l'objet
existe** — ici, une ligne `noshow_rules` pour la salle (`detectSatisfiedSteps`). Le wizard
n'exige aucune valeur modifiée, et rien n'échoue en silence.

### 🔴 La cause, une ligne

`NoshowPolicyCard.tsx` : `disabled={!dirty || saving}`, avec
`dirty = JSON.stringify(form) !== JSON.stringify(rules)`.

Or, **tant qu'aucune ligne n'existe**, `useNoshowRules` présente `DEFAULT_NOSHOW_RULES` —
et `rules` vaut exactement la même chose. Un gérant qui **accepte la politique par défaut**
a donc `form === rules`, `dirty === false`, et **un bouton grisé pour toujours**. Aucune
ligne n'est créée, l'assistant ne voit jamais son objet, l'étape ne se valide pas.

> **Ni valeur modifiée exigée par dessein, ni sauvegarde en échec.** Le garde `dirty` a été
> écrit pour un formulaire qui **modifie** une ligne existante ; il est faux pour un
> formulaire qui doit la **créer**. C'est le cas le plus fréquent — accepter les valeurs
> proposées — qui était le seul bloqué.

### La trace en base confirme le récit, ligne pour ligne

| salle | créée | étape | terminé | horaires | lignes `noshow_rules` |
|---|---|---|---|---|---|
| Dopamine | 11/05 | 1 | ✅ | ✅ | **1** |
| Pace | 24/08 | 1 | ❌ | ❌ | **0** |
| The Pulse Box | 22/09 | 6 | ✅ | ❌ | **0** |
| Iner Studio | 22/09 | 1 | ❌ | ❌ | **0** |
| **Asana** (essai du 28/09, 12:50) | 28/09 | **7** | ✅ | **✅** | **0** |

La salle d'essai du 28/09 a **les horaires enregistrés** et **zéro ligne `noshow_rules`** :
la carte des horaires n'a pas de garde `dirty` (son bouton est toujours actif), celle de la
politique d'absences en a un. Le gérant a donc pu enregistrer les unes et pas l'autre, puis
sauter l'étape — exactement ce qui est rapporté.

⚠️ **Une seule salle sur cinq a une ligne `noshow_rules`** — Dopamine, dont les valeurs
diffèrent des défauts. Toutes celles qui ont accepté la politique proposée n'en ont aucune.

### La correction

`useNoshowRules` expose désormais **`exists`** — la distinction qui manquait entre « la salle
a une ligne » et « la salle lit les valeurs de repli ». Le bouton s'active quand
`dirty || exists === false`, et son libellé devient **« Confirmer cette politique »** : le
geste dit ce qu'il fait, et accepter les valeurs proposées redevient une décision qui compte.

⚠️ `exists === null` (lecture en cours ou en échec) **n'active pas** le bouton : dans le
doute, on ne propose pas d'écrire.

### Les autres étapes — vérifiées une par une

| étape | objet | même condition ? |
|---|---|---|
| 1 · marque | aucun objet — bouton propre, toujours actif | ❌ non |
| 2 · activité | une activité doit être **créée** | ❌ non |
| 3 · coach | un coach doit être **créé** | ❌ non |
| 4 · créneau | un créneau doit être **créé** | ❌ non |
| **5 · politique d'absences** | une ligne `noshow_rules` — **par un formulaire qu'on peut laisser tel quel** | 🔴 **oui** |
| 6 · membre | un membre doit être **invité** | ❌ non |
| 7 · identité légale | bouton propre, toujours actif | ❌ non |

**L'étape 5 est la seule concernée, et pour une raison structurelle** : c'est la seule dont
l'objet est produit par un formulaire dont toutes les valeurs existent déjà par défaut. Les
autres exigent de créer une chose qui n'existe pas.

⚠️ **À signaler, non corrigé** : `GymSettingsCard` (règles de réservation, sur la même page)
porte le **même garde `!dirty`**. Aucune étape n'en dépend, donc rien n'est bloqué — mais un
gérant qui voudrait « valider » les règles par défaut se heurte au même bouton gris. Même
motif, conséquence nulle aujourd'hui.

---

## ② L'étape 7 parlait au développeur

### La cause, et c'est une régression de GYM-363

Le texte affiché était :

> « Il manque encore : legal_name, vat_number, legal_address, legal_postal_code, legal_city,
> **email de contact**. »

**Un seul mot traduit sur six** — et cette signature dit toute la cause. Les clés i18n
avaient été écrites pour les noms du **front** (`field_legalName`, camelCase), et GYM-363 a
fait basculer la source vers `gym_legal_identity_missing`, qui rend des noms de **colonnes**
(`legal_name`, snake_case). Seul `email` s'écrit pareil des deux côtés.

### La correction — une seule table, trois écrans

`LEGAL_FIELD_LABEL_KEYS` + `legalFieldLabelKey()` dans `lib/gymLegalIdentity.ts`, utilisée
par **l'étape 7**, **le bandeau de Réglages** et **la carte Mollie**.

| colonne | fr | en |
|---|---|---|
| `legal_name` | dénomination légale | legal name |
| `vat_number` | numéro de TVA | VAT number |
| `legal_address` | adresse du siège | registered address |
| `legal_postal_code` | code postal du siège | registered postcode |
| `legal_city` | ville du siège | registered city |
| `email` | email de contact | contact email |
| `vat_exempt_mention` | mention de franchise de TVA | VAT exemption notice |

⚠️ **« du siège » est ajouté aux trois champs d'adresse**, seul écart aux mots donnés. La
même liste s'affiche dans Réglages → Infos légales, **au-dessus de deux adresses** — siège
et établissement : « adresse » seul y désignerait l'une ou l'autre, au moment précis où le
gérant doit savoir laquelle corriger.

⚠️ **`vat_exempt_mention` n'avait AUCUN libellé, nulle part.** Le serveur l'exige dès qu'une
salle coche la franchise de TVA : la première à le faire aurait lu `vat_exempt_mention`.

### Deux défauts trouvés en chemin

- **Le bandeau de Réglages n'avait pas de `defaultValue`** : il n'affichait pas le nom de
  colonne, il affichait la **clé i18n brute** — `settings.legal.field_legal_name`. Pire
  encore que l'étape 7.
- **La carte Mollie portait sa propre table de libellés, en français dur dans le composant.**
  Elle n'était donc pas traduisible, et ses clés étaient celles du front : depuis GYM-363,
  elle n'affichait plus rien de lisible non plus. Elle est supprimée.

⚠️ Les clés camelCase sont **retirées** de `fr` et `en` (plus rien ne les nomme) et
**renommées** dans les ébauches `de` et `nl`, pour qu'elles ne soient pas mortes le jour où
ces langues seront complétées.

---

## ③ Les horaires d'ouverture — proposition, non codée

### D'abord : à quoi servent-ils RÉELLEMENT ?

**À une seule chose.** Relevé exhaustif :

| lecteur | verdict |
|---|---|
| `OpenGymModal` → `useOpenGym` → `planOpenGymSlots` | ✅ **le seul usage réel** : générer les créneaux d'accès libre |
| app mobile (`apps/mobile`) | ❌ **aucune** occurrence |
| Edge Functions | ❌ **aucune** occurrence |
| fonctions et vues SQL | ❌ **aucune** (vérifié sur la base) |

Le commentaire de `OpeningHoursCard` annonce qu'ils « serviront aussi à l'afficher au membre
et à vérifier qu'un cours ne déborde pas » : **les deux usages sont encore au futur**.
Antoine a donc raison, et la mesure le dit : **hors accès libre, ces horaires ne sont lus par
personne.**

⚠️ **Et la salle d'essai du 28/09 en est la démonstration** : horaires enregistrés, **zéro
activité en accès libre**. Elle a rempli sept champs qui ne serviront à rien.

### La proposition — le critère existe déjà, ne pas en inventer un second

🔴 **Ne pas ajouter la question « proposes-tu de l'accès libre ? ».** Le dépôt a déjà sa
définition, posée en GYM-228 après une QA d'Antoine : une activité en accès libre est une
activité **sans coach** (`requires_coach = false`) — « une activité sans coach est PAR NATURE
un accès libre ». Une case à cocher de plus créerait une seconde vérité sur la même question,
et c'est exactement ce que ce lot passe son temps à défaire.

**Ce que je propose, par ordre de préférence :**

1. ✅ **Lier la saisie à l'existence d'une activité sans coach.** La carte des horaires reste
   dans Réglages → Salle, mais **repliée par défaut** tant que la salle n'a aucune activité
   `requires_coach = false`, avec une phrase : « ces horaires servent à générer les créneaux
   d'accès libre ». Elle se déplie d'elle-même dès qu'une telle activité existe. Zéro
   question posée, zéro nouvelle colonne, et le gérant d'un studio de yoga ne la voit jamais.
2. **La demander au moment où elle sert** — dans `OpenGymModal`, qui sait déjà lire
   `openingHours === null` et pourrait proposer de les saisir sur place plutôt que de
   renvoyer en Réglages. C'est le moment où le gérant comprend à quoi ça sert, parce qu'il
   vient de demander la chose que ça produit.
3. **Ne rien conditionner, mais le dire** : garder la carte et ajouter la phrase
   d'explication. Le moins coûteux, et le moins efficace — la carte reste dans le parcours.

**(1) et (2) se complètent** : (1) retire le bruit de l'installation, (2) met la saisie là où
elle a un sens. Aucune des trois ne touche à l'assistant, où les horaires **ne sont déjà pas
une étape** — ils sont simplement visibles sur la page de l'étape 5.

---

## ④ À signaler, non codé — le gérant qui revient

**Le mécanisme, vérifié dans le code.** L'aiguillage d'un compte `signup_intent =
'gym_owner'` sans salle vers l'écran de création vit dans `PendingOrCreateGym` (`App.tsx`),
qui n'est atteint que **sur `/pending`**. Or :

- `homePathForRole('member')` envoie vers `/member` (« Ton espace est dans l'application ») ;
- `ProtectedRoute` redirige **aussi** tout `role === 'member'` vers `MEMBER_PATH`, **avant**
  toute logique de `/pending`.

Un compte en rôle `member` — ce que `attach_profile_to_gym` laisse quand on lui passe `NULL`
— **n'atteint donc jamais** l'aiguillage prévu pour lui.

**Le discriminant existe déjà** : `!gymId && intent === 'gym_owner'`, calculé dans
`PendingOrCreateGym`. Il est simplement évalué trop tard. Le porter dans `homePathForRole`
et dans la garde de rôle de `ProtectedRoute` suffirait — **mais c'est un lot à part** : il
touche l'aiguillage de **110 comptes membres** en production, et ça ne se glisse pas dans une
PR de retours de parcours.

---

## Les preuves

**`tsc --build --force`** (jamais `--noEmit`, GYM-350) — **0 erreur**, code de sortie 0, sur
les **trois projets référencés** : `tsconfig.app.json` **167 fichiers**, `tsconfig.node.json`
1, `tsconfig.tests.json` 5.

✅ **Falsification** — le même contrôle sur du code volontairement faux : **5 erreurs**, dont
`Cannot find name 'existsQuiNExistePas'`, `'exists' is declared but its value is never read`,
et **trois** `Argument of type 'string' is not assignable to parameter of type 'number'` —
une par écran. Ces trois-là prouvent au passage que **les trois écrans partagent bien la même
table** : casser sa signature les allume tous les trois.

✅ **Parité i18n fr/en** : **1419 clés chacune**, aucun écart dans les deux sens.

✅ **Aucune clé camelCase ne subsiste** dans le code ni dans `fr`/`en` ; `de`/`nl` (ébauches
de 25 clés, hors parité) sont renommées.

### Le parcours d'un gérant qui ne modifie AUCUNE valeur par défaut

1. **Étape 1** — logo facultatif, couleurs laissées vides : « Enregistrer » est actif
   (aucun garde `dirty`), l'étape avance. ✅
2. **2 · 3 · 4 · 6** — il doit créer une activité, un coach, un créneau, inviter un membre :
   des actes, pas des valeurs par défaut. Inchangé. ✅
3. **Étape 5** — il ouvre Réglages → Salle, ne touche à rien. Le bouton affiche
   **« Confirmer cette politique »** et il est **actif**. Un clic crée la ligne
   `noshow_rules` ; au retour sur le dashboard, la détection voit l'objet et l'étape passe.
   🔴 **C'est le seul point qui change, et c'est le blocage.**
4. **Étape 7** — la liste des champs manquants se lit en français : « dénomination légale,
   numéro de TVA, adresse du siège, code postal du siège, ville du siège, email de contact ».
   Il remplit, enregistre, l'assistant se termine. ✅

### Ce que je n'ai pas

⚠️ **Rien n'a été ouvert dans un navigateur.** `tsc` prouve que le code tient ; le parcours
ci-dessus est lu dans le code et recoupé avec la base, pas rejoué à l'écran. Le point ① se
vérifiera en une minute : ouvrir Réglages → Salle sur une salle neuve, ne rien toucher, et
regarder si le bouton est cliquable.

⚠️ **Aucune migration, aucune donnée corrigée.** Les quatre salles sans ligne `noshow_rules`
en auront une au premier passage de leur gérant sur la carte — elles n'en ont pas besoin
avant : le serveur applique déjà ces valeurs en l'absence de ligne.
