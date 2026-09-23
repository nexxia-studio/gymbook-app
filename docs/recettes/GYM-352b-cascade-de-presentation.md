# 🔴 GYM-352b — Safari était présenté par une vue qui disparaissait

**Branche** `gym-352b-cascade` · **base** `develop` · **1.2.3** (build ≥ 28).
La 1.2.2 (build 27) **ne corrige pas** — mesuré en TestFlight le 23/09 à 10 h 51.

---

## ① D'abord : ton raisonnement tient. Avec une nuance qui ne le renverse pas.

Tu m'as demandé de vérifier avant de coder. Voici les cinq points, vérifiés un par un.

| Vérification | Résultat |
|---|---|
| `journaliser` peut-il se taire autrement ? | **Non** — le seul `return` anticipé est `if (reussi && tentatives.length === 1)` |
| `beforeSend` filtre-t-il le message ? | **Non.** Il vaut `isExpectedEdgeError(hint?.originalException) ? null : event`. Sur un `captureMessage`, `originalException` est `undefined`, et `undefined instanceof EdgeError` est `false` → l'événement passe |
| Échantillonnage ? | **Non.** Aucun `sampleRate` n'est déclaré (défaut 1.0). `tracesSampleRate: 0` ne porte que sur les **transactions**, pas sur les événements |
| DSN présent en production ? | **Oui** — `EXPO_PUBLIC_SENTRY_DSN` figure dans l'environnement EAS `production` |
| Init atteinte avant l'achat ? | **Oui** — `Sentry.init` est au niveau module de `app/_layout.tsx` |

**→ Aucun mécanisme de Sentry n'explique le silence.** Ton indice est bon.

### ⚠️ La nuance : il y a une SECONDE branche, et tu ne l'as pas listée

`journaliser` n'est appelé qu'au **retour** de la promesse. Or si Safari est démonté avec son
présentateur, le délégué de `SFSafariViewController` peut ne jamais se déclencher — et alors
**la promesse ne résout jamais**. `journaliser` n'est jamais atteint, et `presented` n'est
jamais calculé.

Le silence a donc **deux** lectures :

| | Ce qui se passe | Sentry |
|---|---|---|
| **(a) — la tienne** | la promesse résout avec `elapsed ≥ 400 ms` → `presented = true` → succès au 1ᵉʳ essai | muet |
| **(b)** | la promesse **ne résout jamais** | muet |

**Les deux s'accordent sur le point décisif**, et c'est ce qui sauve ton raisonnement : le
minuteur de 400 ms **est parti** — c'est lui qui a monté l'écran « Vérification… » que tu as
vu. Donc `openBrowserAsync` n'avait pas rendu la main à 400 ms. **Donc Safari a bien été
présenté.**

La seule chose qui change entre (a) et (b) est de savoir si Safari a été refermé ou s'il s'est
volatilisé sans que personne ne l'apprenne. **Le correctif est le même dans les deux cas.**

📋 *Un dernier mute possible, pour être complet* : le transport de Sentry est asynchrone — un
événement peut se perdre si l'app est **tuée** avant l'envoi. Sans objet ici : l'app est restée
vivante sur « Vérification… ».

---

## ② Ce que les données de ce matin ajoutent — et une correction à ma PR précédente

| Heure | Membre | Formule | Crédits | Écran | Statut |
|---|---|---|---|---|---|
| 06 h 54 | Martina | One-Shot 20 € | 1 | feuille | ✅ **payé** |
| 08 h 15 → 08 h 28 | Pierre ×4 | Illimité 12 mois | — | Profil | ❌ |
| 08 h 34, 08 h 39 | Emma ×2 | Carte 10 séances | 10 | Profil | ❌ |
| **10 h 51** | **Antoine** | **Séance d'essai 15 €** | **1** | **Profil** | ❌ *pending* |

🔴 **Ton test corrige une erreur de cadrage de ma PR #315.** J'y avais écrit que les succès
étaient « les deux seuls achats à 1 crédit ». C'était **la bonne corrélation lue par le mauvais
bout** : ta Séance d'essai est **aussi** un plan à 1 crédit, et elle a échoué — parce qu'elle
a été achetée depuis **Profil → Abonnement**.

> **La variable n'a jamais été la formule. C'est l'écran.** Le total est désormais de
> **15 échecs, tous depuis Profil → Abonnement** ; les **3 succès** viennent tous de la
> feuille de réservation.

C'est ce qui rend ton diagnostic décisif plutôt que plausible.

---

## ③ Pourquoi la 1.2.2 n'a rien corrigé

La 1.2.2 déplaçait le démontage **après** la présentation, via `onPresented` à 400 ms :

```
1.2.1   setPendingPlan(null) → router.push() → openCheckout()      [même tic]
1.2.2   openCheckout() … 400 ms … onPresented → setPendingPlan(null) → router.push()
```

Or `setPendingPlan(null)` **démonte** `PurchaseConsentSheet` — la vue **qui présente Safari**.
Et UIKit dismisse un contrôleur présenté **avec son présentateur**.

> **On n'avait pas supprimé la cascade. On l'avait décalée de 400 ms.**

Et il y avait pire, que le correctif révèle : la feuille était rendue **conditionnellement**.

```tsx
{pendingPlan && <PurchaseConsentSheet visible … />}
```

Mettre `pendingPlan` à `null` ne **ferme** pas la `Modal` : elle la **supprime**. UIKit ne joue
alors **aucun dismiss**, `onDismiss` ne part jamais — et Safari disparaît avec elle, sans que
quoi que ce soit ne l'apprenne. **C'est aussi l'explication de la branche (b) du § ①.**

---

## ④ Le correctif

### La feuille reste montée pendant sa fermeture

```tsx
{pendingPlan && (
  <PurchaseConsentSheet
    visible={sheetVisible}          // ← c'est LUI qui ferme, pas le démontage
    onDismissed={apresFermeture}    // ← Modal.onDismiss : UIKit a FINI
  />
)}
```

`pendingPlan` n'est libérée **qu'une fois la fermeture constatée**.

### L'enchaînement

| | |
|---|---|
| **Confirmation** | ne lance **rien**. Elle demande la fermeture : `setSheetVisible(false)` |
| **`onDismissed`** | UIKit a fini. **C'est là** que `runCheckout` part |
| **`openCheckout`** | plus aucun rappel — rien ne bouge pendant la présentation |
| **Au retour de la promesse** | sur iOS, à la **fermeture** du navigateur → on navigue |

**Ce qui garantit que la modale est fermée avant la présentation** — et c'est ta question :
c'est **`Modal.onDismiss`**, transmis tel quel par React Native. Il se déclenche **après** que
UIKit a terminé le dismiss, pas au changement d'état React. **Ce n'est pas un délai deviné :
c'est le système qui dit qu'il a fini.**

### L'intention de GYM-96 est tenue, autrement

L'écran de vérification doit être monté pour que son poll et son filet `AppState` soient armés
**quel que soit le mode de retour**. Il l'est désormais **au retour de la promesse, quel que
soit le type** — `cancel` comme `dismiss`. Un membre qui referme sans payer atterrit sur le
même écran qu'un membre qui a payé : **c'est voulu**, puisque c'est précisément le cas où l'on
ne sait pas encore lequel des deux c'était. Le poll tranche.

### Android

`Modal.onDismiss` **n'existe pas** sur Android. Ce n'est pas une lacune à contourner : le
navigateur y est une **activité séparée**, pas un contrôleur présenté par une vue — rien ne
peut l'emporter en disparaissant. On y enchaîne donc directement, ce qui **préserve le
comportement Android existant**.

### Un filet, qui n'est pas le mécanisme

Si `onDismiss` ne venait jamais (version de React Native, cas non prévu), le membre resterait
devant un écran qui ne fait rien — le défaut qu'on corrige, sous une autre forme. Au bout de
**2 s** on enchaîne quand même, **et on le dit à Sentry** (`level: 'error'`).

⚠️ **Ce filet n'est pas le signal.** Le départ reste donné par UIKit. S'il se déclenche un
jour, on l'apprendra — au lieu de croire que `onDismiss` fonctionne.

---

## ⑤ Ce qui n'est pas touché

**`PaymentRequiredSheet` : zéro ligne modifiée** — vérifié au diff. C'est le seul chemin qui
marche (3 succès sur 3), et il ne démonte rien avant de présenter. Il garde son ordre, son
`void openCheckout(...)`, et son poll.

`onPresented` est **retiré de `openCheckout`** : plus aucun appelant, et c'était la cause.

---

## Le chemin, avant / après

```
1.2.1   confirmation → setPendingPlan(null) + router.push() + openCheckout()   [même tic]
                       └─ démonte la Modal qui présente Safari

1.2.2   confirmation → openCheckout() … 400 ms … onPresented → démonte + navigue
                                                  └─ même démontage, 400 ms plus tard

1.2.3   confirmation → setSheetVisible(false)
        UIKit ferme la feuille ………………………………→ onDismiss
                                               └─ runCheckout → openCheckout()
                                                  (rien ne bouge pendant la présentation)
        fermeture du navigateur ……………………………→ la promesse résout
                                               └─ router.push('/payment/success')
```

---

## Les preuves

- **`tsc` mobile — exit 0**
- **`PaymentRequiredSheet` : 0 ligne modifiée**
- **2 appelants d'`openCheckout`**, recensés : `subscription.tsx` et `PaymentRequiredSheet`
- Les cinq vérifications Sentry du § ①, faites **avant** d'écrire une ligne

### ⚠️ Ce que je ne peux pas prouver ici

**Aucun téléphone, aucun build.** Le défaut est une interaction **UIKit** — présentation et
dismiss de contrôleurs — qui ne se reproduit ni en simulateur de logique ni en banc SQL.

**Ce qui est vérifiable l'est** : la `Modal` n'est plus démontée pour être fermée (ça se lit au
diff), le départ vient de `onDismiss` et non d'un minuteur (ça se lit au diff), et plus rien
n'est appelé entre la présentation et la fermeture (il n'y a plus de rappel à appeler).

**Ce qu'il faudra regarder au build 28** : `checkout_result:never_presented` doit rester vide,
et le message `onDismiss jamais reçu` ne doit jamais apparaître. S'il apparaissait, le signal
choisi serait le mauvais — et on le saurait tout de suite, au lieu de le déduire d'un silence.
