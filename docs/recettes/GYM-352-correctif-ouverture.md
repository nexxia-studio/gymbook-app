# 🔴 GYM-352 — Les membres de Dopamine ne pouvaient plus payer

**Branche** `gym-352-open-checkout-fix` · **base** `develop` · **1.2.2** — correctif d'app,
rien de serveur, aucune migration.

---

## ⚠️ D'abord : d'où viennent les échecs, et d'où vient le succès

Tu demandais si un seul écran est en cause. **Oui, et la base le dit sans ambiguïté.**

| Membre | Formule | Crédits | Statut |
|---|---|---|---|
| Pierre Molmy · 21/09 11 h 02 | Séance d'essai 15 € | **1** | ✅ **payé** |
| Emma Uhoda · 21/09 ×3 | Carte 10 séances 170 € | 10 | ❌ expiré |
| Pierre Molmy · 22/09 ×4 | Illimité 12 mois 90 € | — (récurrent) | ❌ expiré |
| François Quoilin · 22/09 ×2 | Carte 10 séances 170 € | 10 | ❌ expiré |
| kupper lora · 22/09 21 h 03 | One-Shot 20 € | **1** | ✅ **payé** |

**Les deux succès sont les deux seuls achats à 1 crédit.** Et `PaymentRequiredSheet`
sélectionne précisément la formule à 1 crédit la moins chère :

```ts
const dropInPlan = creditPlans.filter((p) => p.creditCount === 1).sort(…)[0]
```

> **Les 11 achats se répartissent parfaitement : les 2 réussis viennent de la feuille de
> réservation, les 9 échoués viennent de `Profil → Abonnement`.**

Ce n'est pas une corrélation faible : c'est **tous** les cas, des deux côtés.

---

## Ce que ça change au diagnostic — et ce qui reste vrai de ta remarque (a)

### La différence entre les deux écrans, ligne à ligne

**`profile/subscription.tsx` — les 9 échecs.** Trois choses **dans le même tic** :

```ts
setPendingPlan(null)                                 // démonte la modale de consentement
router.push('/payment/success', …)                   // navigue
await openCheckout(result.checkoutUrl)               // présente le navigateur
```

**`PaymentRequiredSheet` — les 2 succès.** La feuille **reste montée**, rien ne navigue :

```ts
void openCheckout(result.checkoutUrl).then(…)
```

Et le code natif explique pourquoi ça compte. `WebBrowserSession.open()` fait
`currentViewController?.present(...)` — **ce `?` avale silencieusement** le cas où il n'y a
pas de contrôleur présentable, c'est-à-dire l'état exact d'une hiérarchie qui démonte une
modale et pousse un écran. Si la présentation n'aboutit jamais :
`vcDidPresent` reste `false`, `currentWebBrowserSession` reste non nul, et **tous les appels
suivants rendent `locked`, instantanément, jusqu'au redémarrage**.

### Ta remarque (a) : l'écart de 2 h d'Emma

Elle reste entièrement valable, et elle **change la forme du correctif**. Une session fraîche
échoue **aussi**, dès la première tentative. Deux lectures compatibles :

- la cascade frappe **dès le premier achat** — elle ne dépend d'aucun verrou hérité ;
- **et** un verrou peut en plus être hérité d'une session précédente de l'app.

C'est pourquoi le verrou est désarmé **avant chaque essai**, pas seulement avant le second.

### 🔴 Ta remarque (b) : l'instrumentation. Deux raisons, dont une que je dois dire

Tu as raison qu'elle écrit dans la console et que Sentry ne capture pas la console. **Mais
la raison principale est plus simple, et c'est ma responsabilité** :

```
7347df4  2026-09-16  chore: version marketing 1.2.0 → 1.2.1
640d1e2  2026-09-17  GYM-352 — openCheckout dit enfin ce qui s'est passé
→ 640d1e2 n'est PAS un ancêtre de 7347df4
```

**L'instrumentation de GYM-352 n'est pas dans la 1.2.1.** Elle a été écrite **le lendemain**
du gel de version, et `app.config.ts` n'a plus bougé depuis. `openCheckout` appelait pourtant
bien `Sentry.captureException` en cas de non-présentation — **ce code n'a jamais tourné sur
un téléphone**.

> **L'absence d'événement Sentry ne prouvait donc rien.** Nous n'étions pas aveugles parce
> que la mesure était mal faite : nous étions aveugles parce qu'elle **n'était pas embarquée**.

Et c'est ce qui **invalide l'argument que j'avais écrit** dans ce même fichier — « *ne pas
corriger avant d'avoir mesuré* ». Attendre une mesure qui ne peut pas arriver, c'est ne rien
attendre du tout. Le commentaire a été corrigé plutôt que laissé à mentir.

---

## Le correctif — les cinq points

### 1. `dismissBrowser()` avant chaque présentation

`dismiss` sur un contrôleur non présenté appelle **quand même** sa complétion — donc `finish`,
donc la remise à `nil` de `currentWebBrowserSession`. Un verrou hérité est désarmé **avant**
de faire échouer l'ouverture.

⚠️ **iOS seulement, et ne lève jamais.** `dismissBrowser` n'existe pas sur Android, et sur iOS
elle rejette quand il n'y a rien à fermer — c'est-à-dire **dans le cas normal**. Une exception
ici empêcherait le paiement qu'on essaie de sauver.

### 2. Le navigateur d'abord, la navigation ensuite

`openCheckout` reçoit un rappel `onPresented`, appelé **au plus une fois**, **dès que la page
est à l'écran**. C'est là — et seulement là — que `subscription.tsx` démonte la modale et
pousse l'écran de vérification.

⚠️ **L'intention de GYM-96 est conservée, pas abandonnée.** L'écran de vérification doit être
monté pour que son poll et son filet `AppState` soient armés quel que soit le mode de retour :
il l'est toujours, simplement **un tic plus tard**, une fois la présentation confirmée.

⚠️ **`onPresented` ne peut pas attendre la promesse.** Sur iOS, `openBrowserAsync` ne résout
qu'à la **fermeture** du navigateur : attendre pour savoir si la page s'est ouverte
reviendrait à attendre la fin du paiement. La présentation est donc **inférée au passage du
seuil** de 400 ms — si la promesse n'a pas résolu, c'est qu'il y a quelque chose à l'écran.
Même heuristique que `presented`, prise dans l'autre sens.

### 3. Un réessai, et un seul

Sur `locked` ou sur une résolution sous **400 ms** : `dismissBrowser()` puis **une** nouvelle
tentative. **Un échec de présentation n'est pas un refus du membre.**

⚠️ **`threw` n'est pas réessayé.** Une exception vient d'une URL invalide ou d'un module
absent : recommencer donnerait la même exception.

### 4. Sentry — `captureMessage`, avec de quoi compter

| | |
|---|---|
| **Étiquettes** (filtrables, comptables) | `checkout_screen`, `checkout_result`, `checkout_last_type`, `platform` |
| **Extras** | `payment_id`, `plan_id`, `attempts`, le détail de chaque tentative (`type`, `ms`) |
| **Niveau** | `error` sur l'échec définitif · `info` sur un succès **obtenu au 2ᵉ essai** |

⚠️ **Un succès du premier coup n'envoie rien** : le noyer dans les issues rendrait le tableau
illisible. Un succès **au deuxième essai**, lui, est l'information qui compte — le correctif a
rattrapé une vente.

⚠️ **`payment_id` est là pour qu'un événement se raccroche à une ligne `payments`.** Sans lui,
on ne peut ni compter les échecs ni vérifier qu'un correctif a marché — exactement ce qui a
manqué les 21 et 22/09.

### 5. Ce que voit le membre, dans chaque cas d'échec

| Écran | Avant | Après |
|---|---|---|
| **Profil → Abonnement** | écran « Vérification… » qui tourne **5 minutes**, puis un paiement « bien enregistré » qui n'a pas eu lieu | l'écran n'est **jamais monté** ; une alerte dit « **La page de paiement ne s'est pas ouverte — rien n'a été débité** » avec **Réessayer** |
| **Feuille de réservation** | poll de crédits pendant 60 s, puis un message d'attente | inchangé : retour aux options + « la page ne s'est pas ouverte » |

⚠️ **« Réessayer » relance LE MÊME achat.** Redemander au membre quelle formule il voulait,
après un échec qui n'est pas de son fait, serait le punir deux fois.

⚠️ **Le message ne dit pas « erreur ».** Rien n'a été débité, rien n'est perdu : il dit ce qui
s'est passé, et ce qu'on propose. Il ajoute l'issue de dernier recours — *ferme et rouvre
l'application* — qui est exactement ce qui débloque un `locked` non rattrapé.

---

## ⚠️ Ce qui n'est PAS touché

**`PaymentRequiredSheet` garde son ordre.** C'est l'écran qui marche : les deux achats réussis
en viennent. Il reçoit seulement le **contexte de journalisation** et les deux défenses
internes (désarmement, réessai). **Aucune inversion n'y est nécessaire, et en faire une
serait risquer le seul chemin dont on sait qu'il fonctionne.**

---

## Les preuves

### `tsc` mobile — exit 0

165 fichiers projet (hors `node_modules` — le chiffre honnête, GYM-350 §2).
Parité i18n mobile : **672 / 672**.

### Le chemin, avant / après, sur les deux écrans d'achat

**`profile/subscription.tsx`**

```
AVANT   setPendingPlan(null) → router.push(…) → openCheckout(url)      [même tic]
APRÈS   openCheckout(url, ctx, onPresented)
          └─ onPresented →  setPendingPlan(null) → router.push(…)      [après présentation]
          └─ !presented  →  alerte + Réessayer                         [rien n'est monté]
```

**`PaymentRequiredSheet`**

```
AVANT   void openCheckout(url).then(…)
APRÈS   void openCheckout(url, ctx).then(…)        ← ordre inchangé
```

### Ce que je n'ai pas

⚠️ **Aucun téléphone, aucun build.** Ce correctif ne peut pas être prouvé sur cette machine :
les trois défauts qu'il vise sont **natifs iOS** et ne se reproduisent ni dans un simulateur
de logique ni dans un banc SQL. Ce qui est vérifiable l'est — l'ordre des appels se lit au
diff, les types compilent, les deux appelants sont recensés (il n'y en a que deux).

**La mesure viendra de Sentry, dès la 1.2.2** — et cette fois elle sera embarquée. C'est
l'objet du point 4, et c'est la leçon de la 1.2.1.

---

## Ce qu'il faut surveiller après la mise en ligne

1. **`checkout_result:never_presented`** — doit tomber à zéro. S'il persiste, `checkout_last_type` dira lequel des trois cas résiste.
2. **`checkout_result:presented` en niveau `info`** — chaque occurrence est **une vente rattrapée par le réessai**. C'est la mesure directe de l'efficacité du correctif.
3. **`checkout_screen`** — si les échecs restants venaient encore tous de `profile_subscription`, l'inversion d'ordre n'aurait pas suffi et il faudrait regarder la modale de consentement elle-même.
