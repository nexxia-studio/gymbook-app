# GYM-369 — le checkout s'ouvre dans le navigateur du système

**Branche** `gym-369-navigateur-systeme` · **base** `develop` · aucun déploiement, **aucun
build EAS**. Compilation locale avant tout build.

> « Do this in the native browser of the device and **NOT in an in-app browser view**, since
> the operating systems will reject opening the bank apps from these views. »
> — documentation Mollie, *Accepting payments in your app*, étape 3

---

## Ce que ça tranche

🔴 **`openAuthSessionAsync` n'était pas la solution** — c'est encore une vue intégrée. Elle
aurait peut-être réglé le démontage du navigateur ; elle n'aurait **jamais** levé le refus
d'ouvrir une application bancaire. On aurait dépensé le dernier build EAS pour découvrir la
même panne sous un autre nom.

⚠️ **Et ce n'est pas théorique.** Mesuré sur la **production** le 24/09 à 20 h 37 : un
paiement de 20 € d'une membre réelle est `open` chez Mollie avec **`method: "bancontact"`**.
Le premier paiement Bancontact ne va pas arriver : **il est en cours**. Dans une vue
intégrée, il était condamné.

---

## 1. Ce que devient le suivi

`Linking.openURL` ne rend rien sur le paiement : l'app passe en arrière-plan, il n'y a plus
ni promesse de fermeture, ni `type`, ni durée.

| Ce qui disparaît | Pourquoi |
|---|---|
| 🔴 **le seuil de 400 ms** | Heuristique — « un `cancel` rendu trop vite = jamais présenté ». Elle a **masqué l'échec de François** : la vue s'affichait, elle affichait simplement autre chose que la page Mollie. Une mesure qui déclare « présenté » ce que le membre n'a jamais vu ne mesure pas ce qu'elle prétend. |
| **le verrou `'locked'` et `dismissBrowser`** | Sans objet : il n'y a plus de session `WebBrowser` à verrouiller. **Retiré, pas neutralisé** — fermer un navigateur qu'on n'ouvre plus ne se comprendrait plus dans six mois. |
| **le réessai unique** | Il rattrapait un échec de *présentation*. Si le système refuse l'URL, il la refusera à l'identique au second appel. |

**Ce qui reste, et qui est désormais le seul fait** : la résolution de `Linking.openURL` est
un **accusé de réception du système** — il a accepté de passer la main. Ce n'est pas une
déduction, c'est un retour d'API. **C'est à cet instant, et à aucun autre, qu'on sait que le
membre est parti payer.**

**Ce qu'on journalise :**

- **succès → aucun événement Sentry**, une **miette** (`breadcrumb`). 76 paiements réussis
  noieraient les quelques-uns qui échouent ; mais si une erreur survient ensuite, la trace
  montrera que la main était passée, et à quelle heure. Une miette ne crée pas d'issue.
- **refus → un `captureMessage` de niveau `error`**, avec les mêmes étiquettes qu'avant
  (`checkout_screen`, `checkout_result`, `platform`) pour que ça se **compte**.

⚠️ **Ce qu'on ne sait toujours pas, et qu'il faut dire** : qu'il a **vu** la page, qu'il a
**payé**, qu'il est **revenu**. Aucune de ces trois choses n'est observable depuis l'app.
Elles le sont par le poll de `payment/success.tsx` et par le webhook.

---

## 2. Les trois défenses de GYM-352b

| Défense | Verdict |
|---|---|
| ① **désarmement du verrou** (`dismissBrowser` avant présentation) | **CADUQUE** — retirée. Plus de session à désarmer. |
| ② **attendre `Modal.onDismiss` avant d'ouvrir** | **CONSERVÉE, pour une autre raison.** Sa raison d'origine meurt (voir ci-dessous) ; mais la feuille de consentement doit être partie de l'écran avant que l'app passe en arrière-plan, sinon le membre revient derrière une feuille périmée. Le filet de 2 s et son alerte Sentry restent. |
| ③ **réessai unique de présentation** | **CADUQUE** — retiré. |

🔴 **Pourquoi la raison d'être de ② meurt.** La feuille était la vue **qui présentait**
Safari, et UIKit dismisse un contrôleur présenté *avec son présentateur* : tout démontage
emportait la page Mollie. Avec `Linking.openURL`, **la cible est une autre application** —
rien de ce que cet écran démonte ou pousse ne peut plus l'atteindre. La contrainte d'ordre
n'est pas contournée : **elle n'a plus d'objet.**

⚠️ **`PaymentRequiredSheet` A ÉTÉ TOUCHÉ, et je le dis.** Deux blocs de commentaire et **un
seul identifiant** : `outcome.presented` → `outcome.handedOff`. **Aucun changement d'ordre,
aucun changement de comportement** — c'est l'écran qui marchait, et les deux achats réussis
des 21–22/09 en viennent.

---

## 3. Quand monte-t-on l'écran de vérification

**Immédiatement après la prise en main par le système**, avant que l'app passe en
arrière-plan.

Avant, cette ligne s'exécutait à la **fermeture** du navigateur, parce que c'est là que la
promesse résolvait. `Linking.openURL` résout en quelques millisecondes : l'écran est donc
monté, **son poll et son filet `AppState` armés, pendant que le membre paie**.

🔴 **C'est ce qui rend le retour indifférent au chemin emprunté** — lien universel honoré,
schéma personnalisé tenté par la page de retour (GYM-368), ou simple retour manuel par le
sélecteur d'apps. Dans les trois cas l'écran est déjà là et le poll a déjà tourné. C'est
l'intention de GYM-96, enfin tenue au bon instant.

---

## 4. GYM-371 — le lien perdu au démarrage à froid

**Mesuré** : app fermée, lien touché → l'app s'ouvre sur **l'accueil**. Le lien n'est pas mal
routé, il est **perdu**.

**La cause est structurelle, et elle est voulue ailleurs** : `LegalAcceptanceGate` ne monte
pas `<Slot />` tant que le consentement n'est pas résolu — « le contournement n'est pas
interdit, il est impossible ». Au démarrage à froid, expo-router résout l'URL initiale alors
qu'**aucune route n'existe encore**.

**Le traitement, en deux pièces :**

1. `lib/pendingDeepLink.ts` — **se souvient, et se tait.** Mémorise l'URL initiale (et toute
   URL reçue **porte fermée**). Il ne monte rien, n'affiche rien, ne navigue nulle part.
2. `components/DeepLinkReplay.tsx` — monté **comme frère de `<Slot />`, SOUS la porte** : il
   n'existe qu'une fois le consentement résolu. Il rejoue alors, une fois.

⚠️ **La porte n'est pas affaiblie, et c'est le point qui compte.** Le lien **attend** derrière
elle. Si le membre refuse les conditions, il n'est **jamais** joué. La porte reste la seule
chose qui décide.

⚠️ **Il attend aussi la session.** Le magasin d'auth mobile n'expose aucun drapeau de
démarrage (`isLoading` ne couvre que connexion et inscription) : le `_layout` fabrique ce
point d'arrivée avec `initialize().finally(…)`. `finally` et non `then` — une initialisation
en échec est résolue elle aussi, et laisser le lien en suspens pour toujours serait pire.

⚠️ **En mémoire, pas sur le disque.** Un lien persisté survivrait à l'app : on rejouerait au
lancement suivant — demain, la semaine prochaine — un retour de paiement périmé.

⚠️ **Aucune seconde table de routes.** Les chemins de nos liens **sont déjà** ceux de l'app :
`dopamine://payment/success` → `/payment/success` ; `links.viniz.app/dopamine/payment-success`
→ `/dopamine/payment-success` (le fichier existe) ; une autre salle → `/[gymSlug]/[screen]`,
qui résout la salle. En recopier une seconde ici garantirait qu'un jour les deux divergent.

⚠️ **Un lien non routable ne fait RIEN** — pas de `+not-found`. L'app s'ouvre sur l'accueil,
comme avant, et Sentry reçoit la **forme** de l'URL, jamais son contenu (un lien de
réinitialisation porte un jeton dans son fragment).

---

## 5. Android — le retour fonctionne, et pas par où on croit

⚠️ **Il n'y a ni `assetlinks.json` ni `intentFilters`** : les **App Links n'existent pas**,
et ce lot ne les crée pas.

✅ **Le retour marche quand même**, et c'est **vérifié dans le code du plugin Expo** :
`@expo/config-plugins@54.0.4`, `android/Scheme.js`, écrit au prebuild un `intent-filter`
`VIEW` + `DEFAULT` + `BROWSABLE` portant `android:scheme` tiré de `config.scheme`. Le schéma
`dopamine://` **est donc déclaré au manifeste**, sans rien ajouter.

**Le chemin Android est donc** : `Linking.openURL` → navigateur par défaut → paiement →
Mollie redirige vers la page de retour → **la page tente `dopamine://payment/success`**
(livré en GYM-368) → l'app rouvre sur l'écran de vérification.

🔴 **Autrement dit, sans GYM-368, Android n'avait AUCUN retour automatique** — ni App Link, ni
tentative de schéma. Les deux lots se tiennent.

⚠️ **Ce n'est pas un lot séparé, mais ce n'est pas mesuré non plus** : aucun build, aucun
appareil Android dans ce lot. Ce qui est établi l'est **par lecture du plugin**, pas par un
manifeste généré.

---

## `mobileAppCheckout` — il EXISTE, et il est inutilisable tel quel

Mesuré sur la **vraie réponse Mollie**, pour **deux de nos paiements** (lecture seule ; le
jeton n'a jamais quitté la base — `pg_net` construit l'en-tête depuis le coffre) :

| paiement | `method` | `_links` |
|---|---|---|
| expiré (personne n'a choisi) | *aucune* | `dashboard`, `documentation`, `self` — **pas de `mobileAppCheckout`** |
| `open` du 24/09 20 h 37 | **`bancontact`** | `checkout`, `dashboard`, `documentation`, **`mobileAppCheckout`**, `self` |

Son contenu : `href` de schéma **`bepgenapp://…`**, `type: application/x-deeplink` — le lien
direct vers l'app bancaire.

🔴 **Il n'apparaît qu'une fois la méthode CONNUE.** Notre `create-payment` n'envoie pas de
`method` : Mollie rend une page de choix, et la réponse de création **ne peut pas** le
contenir. Ce n'est pas une omission de la référence API — c'est une conséquence du moment.

**Ce qu'il faudrait pour s'en servir** : choisir la méthode **dans notre app** (notre propre
sélecteur), l'envoyer à `create-payment`, puis ouvrir `_links.mobileAppCheckout` avec
`Linking.openURL` — l'app bancaire s'ouvrirait **directement**, sans passer par le navigateur.
C'est un lot produit à part entière (un écran de choix de méthode, la liste des méthodes de
la salle, le repli quand l'app bancaire est absente). **Pas celui-ci.**

⚠️ Et il n'y en a **pas besoin** pour ce lot : depuis le navigateur du système, la page Mollie
ouvre déjà l'app bancaire elle-même. `mobileAppCheckout` fait gagner un écran, pas une panne.

---

## Le chemin, avant / après

| | AVANT (1.2.2) | APRÈS |
|---|---|---|
| ouverture | `WebBrowser.openBrowserAsync` → `SFSafariViewController` | **`Linking.openURL`** → navigateur du système |
| app bancaire (Bancontact) | **refusée par le système** | ouverte normalement |
| ce qu'on sait | « présenté » — heuristique de 400 ms | **« le système a pris la main »** — retour d'API |
| écran de vérification | monté à la **fermeture** du navigateur | monté **au départ**, poll armé pendant le paiement |
| retour iOS | la page reste, il faut toucher « Terminé » | lien universel honoré (mesuré dans Safari) |
| retour Android | aucun retour automatique | schéma tenté par la page (GYM-368) |
| démarrage à froid | **lien perdu → accueil** | lien mémorisé, rejoué une fois la porte ouverte |

---

## Ce que voit le membre s'il revient sans avoir payé

**Depuis « Mon abonnement »** : il retrouve l'écran de vérification, déjà monté. Le poll
interroge la ligne toutes les 2,5 s pendant 5 minutes ; elle reste `open`/`pending`, donc
`timeoutKind = 'not_finalized'` :

> **PAIEMENT NON FINALISÉ** — « Tu n'as pas terminé le paiement. Aucun montant n'a été débité
> — tu peux reprendre quand tu veux. »

**Depuis la feuille d'un cours** : la feuille est toujours montée, son poll tourne 5 minutes,
ne voit ni crédit ni abonnement, et affiche son message d'attente. **L'intention de
réservation est sur le disque** : le cours n'est pas perdu.

⚠️ **Et s'il revient APRÈS avoir payé, mais que le webhook tarde** (mesuré à 2 min 33 s le
04/08) : le filet `AppState` re-poll à chaque retour au premier plan, y compris après le
délai. Il n'a rien à faire.

---

## Ce qui n'a PAS été touché

- ✅ **`redirectUrl` reste l'URL https** `links.viniz.app/<slug>/payment-success`. Ni
  `buildPaymentReturnUrl`, ni `create-payment`. Mollie a déjà refusé (422, 14/09) une URL
  absente des domaines enregistrés du profil : passer à un schéma personnalisé rouvrirait un
  risque écarté.
- ✅ **`expo-web-browser` reste** — `lib/oauth.ts` s'en sert pour la connexion sociale, et le
  greffon reste dans `app.config.ts`. Seul le chemin de PAIEMENT change.
- ⚠️ **`PaymentRequiredSheet`** : un identifiant et deux commentaires (§2).

---

## Les preuves

| | |
|---|---|
| **`tsc --noEmit`** | **0 erreur sur 167 fichiers** du projet mobile (hors `node_modules`), dont les 6 fichiers de ce lot |
| **Falsification** | le même contrôle sur du code volontairement faux → **2 erreurs**, dont `Property 'presented' does not exist on type 'CheckoutOpenOutcome'` — **aucun appelant ne peut plus lire l'ancienne heuristique** |
| **Reste de la vue intégrée** | `openBrowserAsync`, `dismissBrowser`, `PRESENTATION_FLOOR_MS`, `onPresented`, `outcome.presented` : **0 occurrence de code** sur le chemin de paiement (il ne reste que des commentaires qui expliquent leur disparition, et `lib/oauth.ts` qui n'est pas concerné) |
| **Mollie** | deux lectures réelles de l'API sur nos paiements — `mobileAppCheckout` absent sans méthode, présent avec `bancontact` |
| **Android** | `@expo/config-plugins@54.0.4/android/Scheme.js` lu : l'`intent-filter` `BROWSABLE` du schéma est écrit au prebuild |

### Ce que je n'ai pas

⚠️ **Aucun build, aucun appareil.** Rien de ce lot n'a tourné sur un téléphone : `tsc` prouve
que le code tient, pas que le système ouvre la page. **La compilation locale d'Antoine est la
prochaine étape, et c'est elle qui tranche.**

⚠️ **Le paiement Bancontact du 24/09 n'est pas un test de ce lot** : il prouve que le cas
Bancontact est réel et déjà là, pas que ce correctif le règle.

⚠️ **`checkout_opened` est un paramètre mort** : plus aucun appelant ne le pose, et avec ce
lot plus rien ne peut le produire. Il est conservé (un lien profond ancien pourrait le
porter) et son commentaire, qui affirmait une chose désormais fausse, est corrigé.
