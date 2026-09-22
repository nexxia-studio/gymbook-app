# Parcours gérant (PR A) — ce qui induit en erreur ou casse

Retours du **premier vrai parcours gérant** (22/09, production, « The Pulse Box »).
**Branche** `gym-onboarding-verites` · **base** `develop` · aucun déploiement, aucun build Expo.

---

## 1. 🔴 Le bandeau d'essai mentait

### Ce qui était affiché

L'écran de bienvenue disait « **Tu es sur le plan Free** — voici ce qu'il comprend », puis
listait **200 membres, 5 comptes gérants**. Les deux affirmations sont exactes *séparément* :
le plan **contractuel** est bien `free`, les limites **servies** sont bien celles de `pro`.
Leur juxtaposition, elle, est un mensonge — le gérant en déduit que Free offre 200 membres,
et le découvrira le quinzième jour.

Réglages → Abonnement portait le **même** défaut, en pire : un badge « free » au-dessus de
barres « 0 / 200 membres ».

### Ce qui s'affiche maintenant — `TrialPlanNotice`, trois blocs, dans cet ordre

| | |
|---|---|
| ① | « **Tu es en Free. Nous t'offrons 14 jours de Pro.** » |
| ② | Ce que Pro apporte : 200 membres · 5 comptes gérants · paiements en ligne… |
| ③ | « **Sans action de ta part d'ici le 6 octobre 2026, tu repasses en Free :** 15 membres · 1 compte gérant · sans paiement en ligne. » |

**L'ordre est la correction.** Dire l'offre avant la limite, et la date avant la
conséquence. Un gérant qui lit « tu vas perdre » avant « on t'offre » retient la perte — et
il n'a encore rien reçu.

**Aucun chiffre, aucun nom de plan n'est écrit dans le code.** L'encart lit **deux** lignes
de `nexxia_plan_limits` : celle du plan **servi** (bloc ②) et celle du plan **souscrit**
(bloc ③). C'est très exactement ce qui manquait — la seconde n'était lue nulle part.

⚠️ **La liste des fonctionnalités se calcule par différence de grille**, jamais à la main :
ce que l'essai ajoute est ce qui est `true` chez Pro et pas chez Free. Le jour où un drapeau
change de plan, la phrase suit. Et `CATALOG_FEATURE_KEYS` ne contient plus que des drapeaux
réellement appliqués par le code (PR #305) : l'encart ne peut plus promettre un check-in QR
qui n'existe pas.

⚠️ **Le badge de Réglages nomme désormais le plan SERVI**, et une mention dit lequel est
souscrit. L'information manquante était celle-là.

⚠️ **L'encart est le MÊME aux deux endroits**, délibérément : le gérant qui revient des
semaines plus tard doit lire exactement la même chose, avec la date à jour. Et il disparaît
hors essai — un encart permanent redevient du décor.

---

## 2. 🔴 La photo du coach : ce n'était pas une politique Storage

### Le diagnostic

**Le composant n'était pas branché. Du tout.**

| | Constat |
|---|---|
| Le bouton | un `<button>` **sans `onClick`** |
| L'input fichier | **absent** |
| La zone de dépôt | **absente** |
| `CoachFormData` | **pas de champ photo** |
| `useCoaches` | `photo_url` **jamais écrite**, ni en création ni en édition |

`CoachItem.photoUrl` était pourtant *lu* depuis `coaches.photo_url`. La colonne existe,
l'affichage la lisait — rien ne pouvait l'écrire.

### Et côté serveur, rien ne manquait — vérifié, pas supposé

Le bucket `gym-media` existe, public en lecture, plafonné à **2 Mo**, avec quatre politiques.
Sous l'identité d'un **vrai `gym_admin`** :

| # | Cas | Résultat |
|---|---|---|
| ⑥ | `<sa salle>/coaches/…` | **accepté** |
| ⑦ | `<sa salle>/logo/…` | **accepté** |
| ⑧ | `<une autre salle>/coaches/…` | **refusé — 42501** |

La politique compare le **premier segment du chemin** au `gym_id` du gérant. Elle ne regarde
**ni l'âge de la salle, ni le sous-dossier**. → **Une salle neuve n'est pas refusée**, et
**le logo n'est pas bloqué non plus** (c'est la même règle — utile pour la PR B).

### 🔴 Ce que j'ai trouvé en le corrigeant : la zone de dépôt existait déjà

`components/ui/MediaUpload.tsx` (GYM-305/215) fait déjà **tout** : clic, glisser-déposer,
contraintes du bucket dites **avant** l'envoi, nommage déterministe, nettoyage des frères
d'extension, aperçu, `?v=` anti-cache. Son propre en-tête met en garde contre l'écriture
d'une seconde implémentation.

**J'en avais commencé une. Je l'ai supprimée et branché la sienne.** Le composant n'avait
simplement jamais été appelé depuis la fiche coach.

⚠️ **Une contrepartie nouvelle, et elle est nommée.** `MediaUpload` exige un chemin
**déterministe** (`<gym>/coaches/<id>`), donc un identifiant *avant* l'enregistrement : la
modale en tire un à l'ouverture et le passe à l'`INSERT`. Conséquence : un gérant qui dépose
une photo puis ferme sans enregistrer laisse **un fichier seul** dans le bucket (2 Mo au
pire). Les deux autres usages n'ont pas ce cas — l'objet y existe avant la photo. Le choix
inverse (n'envoyer qu'à la soumission) priverait l'écran de tout aperçu, c'est-à-dire de ce
qu'on vient de corriger.

---

## 3. 📋 L'étape 2 renvoie dans Réglages — rapport et proposition

### Ce qui se passe réellement

`handleGo()` appelle `dismiss()` **puis** navigue. Et `dismiss()` ferme l'assistant **pour
cette session seulement, sans perdre l'étape** — il réapparaît au retour sur `/dashboard`.
L'étape, elle, est validée **par l'objet** (`satisfied`), pas par le clic : une correction
déjà tirée du premier parcours E2E, et elle est bonne.

**Donc rien n'est perdu. Mais rien ne ramène non plus.** Après avoir créé son activité dans
Réglages → Activités, le gérant reste dans Réglages. Il doit penser à cliquer « Tableau de
bord » dans la barre latérale pour retrouver l'assistant. **Rien à l'écran ne le lui dit.**

C'est le même schéma aux étapes **2, 3, 4, 5 et 6** — cinq étapes sur six.

### Ce que je propose (non codé — tu avais demandé « rapporte, et propose »)

**① Le moins cher et le plus efficace : un retour dans l'écran de destination.**
Un bandeau en tête de l'écran visé — « *Étape 2 sur 6 · reviens à la configuration quand
c'est fait* » + un lien. L'assistant connaît déjà l'étape et la destination
(`STEP_TARGETS`) ; il manque le chemin inverse. C'est une bande, pas un flux.

**② Mieux, si tu veux investir : ne plus quitter l'assistant.**
Les étapes 2 et 3 ouvrent une *modale* de création (`ActivityModal`, `CoachModal` existent
déjà) **au-dessus** du dashboard, au lieu de naviguer. Le gérant ne quitte jamais le fil.
Les étapes 4 à 6 (planning, politique, membres) resteraient des navigations : ce sont de
vrais écrans, pas des formulaires.

**③ À ne pas faire : avancer l'étape au clic.** C'est ce que faisait la première version, et
le premier parcours E2E l'a réfuté — « Configurer » ressemblait à « Passer ».

**Mon avis** : ① tout de suite (une journée), ② pour les deux étapes qui ont déjà leur
modale. Le risque d'abandon est réel — c'est **cinq** allers-retours sur six étapes.

---

## 4. Le cockpit

### a. Un écart expliqué n'est plus une anomalie

L'orange signalait « ces deux valeurs ne devraient pas différer ». Vrai pour Dopamine
(dérogations `nexxia_features`) ; **faux pour une salle en essai**, où l'écart est le
fonctionnement normal.

> Depuis l'allumage de l'essai, **toute salle neuve serait apparue en alerte dès sa
> création**.

Désormais, quand l'écart vient d'un essai :
`Pro — essai jusqu'au 06/10 · souscrit : Free`, en gris.
**L'orange reste** pour l'écart qu'on ne sait pas expliquer. Même règle en liste et sur la
fiche.

### b. 🔴 « Dernière activité » ne comptait que les membres

Mesuré sur **The Pulse Box**, créée le matin même : 2 activités, 1 coach, 2 créneaux, dernier
créneau posé à **10 h 27**. Le cockpit affichait **« — »**.

**Et le relevé a révélé un terme mort.** Le troisième terme lisait `profiles.last_seen_at` —
or **personne n'écrit cette colonne** : une lecture dans `useMembers`, une note de GYM-203
(« télémétrie serveur ; aucune écriture client »), et rien d'autre. `NULL` sur les trois
salles de production. Le terme n'était pas faux, il était **vide** : la « dernière activité »
reposait sur **deux** termes, pas trois.

**Sept termes désormais**, en deux familles :

| Les membres | Le gérant |
|---|---|
| réservations · paiements · visite d'un membre | activités **créées** · créneaux **créés** · coachs **créés** · **sa visite au dashboard** |

⚠️ **`created_at`, jamais `updated_at`.** Un `updated_at` bouge aussi quand un *trigger*
touche la ligne (`trg_update_bookings_count` sur les créneaux) : la « dernière activité » se
mettrait à jour toute seule au premier membre qui réserve, et dirait « le gérant est venu »
alors qu'il n'est pas venu. On ne compte que des **créations**, qui sont toujours des gestes
humains.

**Et la visite est enfin enregistrée** : `touch_last_seen()`, une RPC sans paramètre qui
écrit `now()` sur `auth.uid()`, avec un anti-battement de 5 minutes. Par RPC et non par
`UPDATE` : `last_seen_at` est hors de la liste blanche GYM-203, et c'est très bien — une
télémétrie que son sujet peut forger ne vaut rien. Le dashboard l'appelle une fois par
session, best-effort, jamais bloquant.

### Le résultat, mesuré en production (lecture seule, rien n'a été appliqué)

| Salle | Avant | Après |
|---|---|---|
| Dopamine | 22/09 10:18 | 22/09 10:18 *(inchangé — une vraie réservation)* |
| **Pace** | **—** | **07/09 13:27** |
| **The Pulse Box** | **—** | **22/09 10:27** |

⚠️ **Pace paraissait morte et ne l'était pas.** Le défaut ne concernait pas que la salle
neuve.

⚠️ **Corps repris sur le DÉPLOYÉ**, pas sur le fichier du dépôt : la version installée
appelle `public.gym_legal_identity_complete(g.id)` (la règle canonique GYM-121) là où le
fichier portait un prédicat écrit à la main. **Cette correction est conservée**, et un
contrôle d'application **échoue** si elle disparaissait d'une réécriture future.

---

## ① ② ③ — La boucle du dashboard

### ① La boucle — une ligne

`SignupConfirmed.handleSubmit` n'appelait `refreshProfile()` que sur le **chemin de succès**.
Or `PT409 / already-has-gym` est la **seule** réponse du serveur qui *prouve* que le magasin
client est périmé.

```
/signup/confirmed → PT409 → lien « tableau de bord » → /dashboard
      ↑                                                     ↓
      └── /pending ←── ProtectedRoute lit le magasin PÉRIMÉ ─┘
```

Le profil est désormais relu **avant** d'afficher le lien — l'afficher d'abord le rendrait
cliquable pendant l'aller-retour, c'est-à-dire dans la fenêtre où il reboucle encore.

### ② `homePathForRole('member')` ne rend plus `/dashboard`

Il rend `/member`. Le défaut renvoyait **toute** connexion de membre vers un écran qui le
refuse.

⚠️ **`role === null` garde `/dashboard`** : le rôle pas encore résolu n'est pas un membre, et
`ProtectedRoute` sait attendre. Rediriger un rôle inconnu afficherait « votre salle vit dans
l'application » à un gérant dont le profil met une seconde à charger.

### ③ Le refus devient une orientation

`ProtectedRoute` redirige un membre vers `/member` au lieu d'afficher le cul-de-sac. La page
dit le **nom de sa salle** — ce qui lui confirme que ce n'est pas son compte le problème —
et propose **l'app de SA salle**.

**La règle GYM-303 est tenue par `lib/memberApp.ts`** : une seule table `slug → app`, une
seule entrée aujourd'hui (Dopamine est la seule app publiée), et **le neutre Viniz par
défaut**. Retomber sur Dopamine « au cas où » reproduirait exactement le défaut d'origine —
*« envoyer un membre de Studio Kama sur la fiche App Store de Dopamine, c'est l'envoyer
télécharger une app où il n'a pas de compte »*.

⚠️ Un **gérant** qui arrive sur `/member` par l'URL est renvoyé sur son dashboard : la page
est atteignable, elle ne doit pas égarer celui qui n'est pas concerné.

---

## ⚠️ Ta question : un autre appelant peut-il produire « rattaché mais resté membre » ?

**Réponse : non, plus depuis le 22/09 — et l'accès était déjà fermé.**

`attach_profile_to_gym` a un `EXECUTE` limité à **`postgres` et `service_role`**. Aucun
chemin client ne l'atteint. Ses appelants :

| Appelant | Rôle passé | Verdict |
|---|---|---|
| `member_gyms_autoheal` | **`NULL`** → le rôle ne bouge pas | 🔴 **le producteur**, désormais interdit aux `gym_owner` (PR #309) |
| `invite-team-member` | `requestedRole`, validé contre `INVITABLE_ROLES = ['gym_admin']` | jamais `NULL` |
| banc `gym338` | `'gym_admin'` | test |

📋 **Un second chemin attache sans poser de rôle, et il faut le connaître** :
`claim_app_gym` est accordée à **`authenticated`**, ne passe **pas** par
`attach_profile_to_gym`, et **ne touche jamais au rôle**. Pour sa population — un membre de
l'app mono-salle qui réclame la salle dédiée — c'est **correct** : il doit rester membre.
Elle ne produit donc pas l'état fautif, elle produit l'état **voulu**. Mais si un jour un
gérant en cours d'inscription atteignait l'app mobile, elle le rattacherait sans le
promouvoir, exactement comme le filet le faisait. **Signalé, non touché.**

---

## Les preuves

- **`tsc --build` dashboard — exit 0** (161 + 1 + 2 fichiers) · parité i18n **1398 / 1398**
- **`deno check` 36 / 36** (aucune fonction Edge touchée ; la convention ne fait pas d'exception)
- **Banc du parcours — staging, transactionnel, 8 / 8** :
  ①-⑤ les quatre chiffres des blocs ② et ③ viennent bien de `nexxia_plan_limits` ;
  ⑥-⑧ la politique Storage accepte `coaches/`, accepte `logo/`, refuse une autre salle (42501).
  **Étanchéité revérifiée** : salle rendue à `pro`/`active`/`NULL`, `gym-media` réduit à ses
  deux objets du 28/08.
- **Migration cockpit appliquée en transaction sur staging** : contrôles passés, et la
  fonction répond sous une **vraie identité super-admin**.
- **Requête cockpit sur « The Pulse Box »** (production, lecture seule) : `—` → **22/09 10:27**.

⚠️ **Aucun navigateur n'a été ouvert.** Le banc établit les **données** que les écrans
lisent ; le rendu se lit au diff et se contrôle par `tsc --build`.

---

## Ce qui reste

- **Rien n'est appliqué ni déployé.** Ordre : la migration, puis le dashboard.
- **Une dette nommée** : `touch_last_seen` n'est pas dans `types/database.ts` (généré depuis
  la base). Façade typée en un seul point dans `useAuthStore`, **à retirer** à la
  régénération — même dette que les lots cockpit, au même endroit.
- **PR B** (le logo) : la politique Storage est déjà prouvée bonne pour `logo/` (cas ⑦), et
  `MediaUpload` est le composant à réutiliser — il gère déjà le nommage déterministe et le
  nettoyage. Restera la déduction des couleurs et le garde-fou de contraste.
- **Point 3 non codé**, comme demandé : rapport + proposition ci-dessus.
