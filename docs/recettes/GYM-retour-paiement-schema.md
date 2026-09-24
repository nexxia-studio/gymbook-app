# Après paiement, revenir à l'app sans toucher « Terminé » — lot A (`apps/links`)

**Branche** `gym-retour-paiement` · **base** `develop` · aucun déploiement, **aucun build Expo**.
Site statique uniquement : deux pages, un rewrite, la doc des routes.

> 24/09, production, 1.2.2, iPhone : **le paiement aboutit** — email, facture et crédit reçus
> pendant l'attente — et la page de retour reste affichée dans le navigateur intégré. Il faut
> toucher « Terminé », en haut à gauche, pour revenir à l'app et voir l'écran de félicitations.

---

## 1. Le diagnostic est bon, et le fichier mentait

Le commentaire de `apps/links/public/dopamine/payment-success/index.html` annonçait deux cas,
dont le premier comme le cas normal sur iPhone :

> « CIBLE Universal Link : iOS intercepte l'URL AVANT le chargement et ouvre l'écran natif.
> **La page n'est alors PAS rendue.** »

🔴 **Ce cas 1 ne se produit JAMAIS sur ce chemin.** Le checkout Mollie est présenté par l'app
elle-même dans un `SFSafariViewController` (`WebBrowser.openBrowserAsync`,
`apps/mobile/lib/payments.ts:399`). iOS n'honore pas un lien universel quand la navigation a
lieu dans le navigateur intégré présenté par l'app qui revendique ce lien. La page est donc
**toujours** rendue ici — ce que la production montre.

### Ce que j'ai éliminé avant de conclure

| Autre explication | Verdict |
|---|---|
| L'appariement AASA est cassé | ❌ **Mesuré** : `/.well-known/apple-app-site-association` répond **200 · `application/json`**, et `associatedDomains: ['applinks:links.viniz.app']` est bien dans le binaire de production (`app.config.ts:321`). |
| L'app ne déclare pas la route | ❌ `apps/mobile/app/dopamine/payment-success.tsx` existe et transfère `id`, `source`, `slot_id` à l'écran de vérification. |
| Le `?id=` manque | ❌ `create-payment` l'ajoute (`index.ts:353`) ; et le symptôme serait un mauvais écran, pas une page affichée. |
| Règle Apple « même domaine » | ❌ Ne s'applique pas : on vient de `mollie.com`, pas de `links.viniz.app`. |

### Une seconde raison, indépendante — et moins certaine

Mollie revient par une **redirection HTTP**, pas par un lien touché. Un lien universel se
déclenche sur un **geste**. Même hors du navigateur intégré, rien ne garantit qu'une
redirection l'armerait.

⚠️ **Je donne les deux raisons dans cet ordre parce qu'elles n'ont pas le même statut** : la
première est mesurée et suffit à elle seule ; la seconde est une règle documentée d'Apple
dont je n'ai pas pu vérifier l'application exacte sur ce chemin. Si demain on supprimait la
première (par exemple avec `openAuthSessionAsync`), la seconde resterait sans effet, car le
retour ne passerait plus par un lien universel du tout.

---

## 2. Ce que fait le lot

Les deux pages **tentent le schéma de l'app dès le chargement**, sans attendre un clic, en
conservant la query (`id` arme le poll, `source` et `slot_id` portent la reprise de
réservation) :

| page | schéma tenté |
|---|---|
| `/dopamine/payment-success` | `dopamine://payment/success` + query |
| `/<slug>/payment-success` (**nouvelle**) | `viniz://payment/success` + query |

⚠️ **Le bouton RESTE, en repli visible.** La tentative échoue en silence — aucun événement,
aucun message. Si elle ne passe pas, le bouton est la seule chose qui distingue une page utile
d'une page morte.

⚠️ **Le texte dit maintenant, en premier et en lime, que le crédit est DÉJÀ accordé** :
« Tes séances sont déjà créditées. » Suivi du geste de secours : « touche « Terminé » en haut
à gauche ». En production, un membre a cru son paiement échoué alors qu'il était crédité.

### 🔴 La page Viniz n'existait pas — et son absence était pire que le défaut

`vercel.json` renvoyait `/:slug/payment-success` vers **`_viniz/404.html`**. Vérifié en
production, à l'instant :

```
https://links.viniz.app/studio-yoga-test-1/payment-success
  → 200 · <h1>Cette page n'existe pas</h1>
  → sha256 IDENTIQUE à /studio-yoga-test-1/bookings : c'est bien le 404 générique
```

Toute salle autre que Dopamine aurait affiché **« Cette page n'existe pas »** à un membre qui
venait de payer et dont le compte était déjà crédité.

⚠️ **Le défaut est LATENT, pas actif**, et c'est vérifiable : la seule chose qui fabrique cette
URL est `apps/mobile/lib/gymUrls.ts` (`buildPaymentReturnUrl`) — donc l'app mobile — et la
seule app publiée est celle de Dopamine, servie par ses propres fichiers sous `/dopamine/`.
**Il se déclenche au premier paiement passé depuis l'app Viniz**, c'est-à-dire chez Jeff.

⚠️ `viniz` est bien le schéma de l'app white-label (`app.config.ts:597`). Le commentaire de
`_viniz/confirm.html` affirme encore qu'elle n'a « ni scheme, ni fiche de store » : c'était
vrai le 07/09, ça ne l'est plus pour le schéma. La fiche de store, elle, n'existe toujours
pas — d'où l'absence de lien d'installation sur la nouvelle page.

### 🔴 Ce que le banc m'a appris sur mon propre code

Première version : la tentative était déclenchée par un double `requestAnimationFrame`, pour
que la page se peigne d'abord (si la tentative échoue bruyamment, le membre aura au moins lu
que ses séances sont créditées).

**Mesuré : elle n'est jamais partie.** Une page **masquée** ne reçoit **aucun** rAF — il n'est
pas ralenti, il ne part pas du tout (`visibilityState: 'hidden'`, `rafFonctionne: false`).
Le rAF est conservé pour le confort, mais **il n'est plus la seule condition** : un
`setTimeout(…, 120)` sert de filet et un drapeau garantit une tentative et une seule.

---

## 3. Ce que je n'ai pas pu trancher, et je le livre quand même

**Le navigateur intégré bloque-t-il encore les schémas custom ?** C'était vrai des premières
versions de `SFSafariViewController`. Ça ne l'est plus de façon générale, et **rien dans ce
dépôt ne permet d'en décider** — il faut un iPhone. On livre : l'échec est silencieux, le
bouton demeure, et le membre n'est jamais moins bien loti qu'avant.

🔴 **Et même si le schéma passe, il n'est peut-être pas suffisant.** Ouvrir l'app depuis le
navigateur intégré **ne démonte pas ce navigateur** : l'app peut recevoir le lien et naviguer
*derrière* la page. Dans ce cas, le membre verrait toujours la page — mais il retrouverait
son écran de félicitations déjà prêt en touchant « Terminé », au lieu d'un écran générique.
**Le gain serait réel mais partiel, et c'est pourquoi le lot suivant existe.**

⚠️ **Android n'a jamais eu de lien universel du tout** : ni `assetlinks.json` dans ce site, ni
`intentFilters` dans `app.config.ts`. Cette page y a toujours été le seul retour, et la
tentative automatique y est un **gain net**, sans réserve.

---

## 4. `openAuthSessionAsync` — ce que le prochain train implique

C'est probablement la vraie solution : `ASWebAuthenticationSession` **se referme d'elle-même**
quand la navigation atteint l'adresse de retour déclarée. C'est exactement le démontage qui
manque.

| Ce qu'il faut savoir | Détail |
|---|---|
| 🔴 **L'alerte système au premier usage** | iOS affiche « **"Dopamine" souhaite utiliser "mollie.com" pour se connecter** ». Sur un écran de **paiement**, cette phrase parle de *connexion* et de partage de données. Un membre qui répond « Annuler » voit la session se fermer **sans jamais ouvrir le checkout** — la promesse rend `cancel`, et on retombe sur le défaut de GYM-352. C'est le vrai risque du lot, et il est sur le chemin de l'argent. |
| **L'adresse de retour à déclarer** | `ASWebAuthenticationSession` compare sur un **schéma** (`callbackURLScheme`), pas sur une URL https. Il faudrait donc déclarer `dopamine` / `viniz`. **Et c'est là que ce lot-ci sert de prérequis** : la page tentant déjà `dopamine://payment/success`, la session se fermera sur cette redirection **sans toucher ni `create-payment`, ni `buildPaymentReturnUrl`, ni l'URL enregistrée chez Mollie.** |
| **Android** | Pas d'alerte système : `openAuthSessionAsync` y ouvre un Chrome Custom Tab et rend la main quand l'app est rouverte par le schéma. Comme Android n'a aucun App Link déclaré, **c'est déjà la page qui déclenche ce retour** — même mécanique, mêmes pages. |
| **Le coût** | Un build EAS, et il n'en reste **qu'un jusqu'au 01/10**. |

⚠️ **Ce qu'il faudra mesurer, et pas supposer** : que l'alerte n'apparaît qu'**une fois** par
app et par domaine, et ce que voit un membre qui a répondu « Annuler » la première fois. Le
correctif de GYM-352 a déjà montré qu'un échec de présentation du navigateur ne se voit nulle
part.

---

## Les preuves

**Banc navigateur**, sur les pages livrées (copie instrumentée : la ligne
`window.location.href = DEST` remplacée par une écriture dans le DOM — une navigation vers un
schéma custom n'est pas observable en JS). **Écart page livrée ↔ page du banc : 2 lignes**, la
ligne avant et la ligne après.

| Mesure | `/dopamine` | `/_viniz` |
|---|---|---|
| tentative faite **sans clic** | ✅ | ✅ |
| schéma tenté | `dopamine://payment/success` | `viniz://payment/success` |
| query conservée (`id`, `source`, `slot_id`) | ✅ | ✅ |
| page toujours affichée après la tentative | ✅ « Paiement reçu » | ✅ « Paiement reçu » |
| bouton de repli présent et armé | ✅ 1 bouton | ✅ 1 bouton |
| « Tes séances sont déjà créditées. » | ✅ | ✅ |

**Falsification** — la même page **privée du bloc de tentative** (c'est-à-dire la page d'avant
ce lot) : **aucune tentative après 2,5 s**, bouton toujours là et armé. Le banc distingue donc
bien les deux états ; il ne mesure pas le vide.

**Production, avant le lot** — `bash apps/links/scripts-verif-aasa.sh` :
AASA **200 · `application/json`** ; les **5** pages Dopamine en 200 ; et
`/studio-yoga-test-1/payment-success` = **2965 octets, sha256 identique au 404 générique**.

### Ce que je n'ai pas

⚠️ **Rien n'a été vérifié sur un iPhone.** Le banc prouve que la tentative part, avec le bon
schéma et la bonne query ; il ne peut pas prouver que `SFSafariViewController` l'honore. C'est
la seule question qui reste, et elle se tranche en un paiement de test.

⚠️ Le banc tourne dans un onglet **masqué** : les minuteurs y sont bridés à ~1 s, d'où le
`data-tentative-ms` mesuré à ~1028 ms. Sur une page visible, le rAF part en ~16 ms.

⚠️ **Rien n'est déployé.** Après merge, Vercel publie `apps/links` ; rejouer
`scripts-verif-aasa.sh` et vérifier que les cinq pages Dopamine et l'AASA sont **inchangées**,
et que `/studio-yoga-test-1/payment-success` ne rend plus 2965 octets.
