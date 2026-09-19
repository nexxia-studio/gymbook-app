# Recette — GYM-352 · L'intention de réservation survit au paiement

> Un lot, un fichier. Voir `docs/recettes/README.md`.

🔴 **AUCUN DÉPLOIEMENT.** · ⚠️ **`create_booking_atomic` N'EST PAS TOUCHÉ** — le débit du
crédit reste atomique. Ce lot ne change que le PARCOURS qui mène à l'appel.

## Ce que le lot pose

| fichier | changement |
|---|---|
| `apps/mobile/lib/bookingIntent.ts` | **nouveau** — l'intention persistée |
| `apps/mobile/app/session/[id].tsx` | 🔴 pose l'intention, arme le bouton, rend le crédit visible |
| `apps/mobile/lib/gymUrls.ts` | 🔴 `slot_id` dans l'URL de retour — il manquait |
| `apps/mobile/components/session/PaymentRequiredSheet.tsx` | 🔴 poll 60 s → 5 min · fin de la réservation silencieuse |
| `apps/mobile/app/payment/success.tsx` | 🔴 « PAIEMENT CONFIRMÉ » → « IL RESTE UN GESTE » · destination corrigée |
| `apps/mobile/lib/gymProfile.ts` | expose `waitlistConfirmationMinutes` (jamais 30 en dur) |
| `apps/mobile/locales/fr.json` · `en.json` | 12 libellés (⚠️ **à valider**) |

---

## § 1 — Trois défauts superposés

### ① L'intention n'était écrite nulle part

`session/[id].tsx` : le `slotId` ne vivait qu'en mémoire du composant.

### ② 🔴 `slot_id` n'était jamais mis dans l'URL de retour

```ts
// avant
return `${LINKS_BASE}/${slug}/payment-success?source=${source}`
```

Or `payment/success.tsx` ne monte son écran de reprise que si
`source === 'drop_in' && !!slot_id`. **Cette condition n'a jamais pu être vraie :
`DropInRetryScreen` — 90 lignes de logique de reprise — n'a jamais tourné en production.**
La route de relais Dopamine transmet bien `slot_id` *s'il est présent* ; il ne l'était jamais.

### ③ 🔴 Le poll durait 60 s pour un crédit qui met 2 min 33 s

`30` tentatives × `2000 ms` = **60 secondes**. La latence réelle du webhook de crédit est
mesurée dans ce dépôt à **2 min 33 s** (GYM-207, constat prod du 04/08 — c'est la raison du
plafond à 5 min de l'écran de vérification).

**La seule continuation vivante était 2,5 fois plus courte que le délai qu'elle devait
couvrir.** C'est l'explication quantitative des 25 achats sur 70 sans réservation : tout
paiement crédité après une minute perdait le cours, systématiquement.

**Nouveau plafond : 5 min**, aligné sur celui de `payment/success.tsx`. Ce n'est pas un
chiffre choisi ici — c'est le précédent du dépôt, établi sur une mesure de production.

⚠️ **ET LE POLL N'EST PLUS CRITIQUE.** L'intention est sur le disque : s'il expire, le membre
retrouve son cours à la reprise de l'écran ou au prochain lancement. Le poll est devenu un
confort, plus une condition.

---

## § 2 — 🔴 Le cœur du malentendu

L'écran de retour annonçait « **PAIEMENT CONFIRMÉ !** », puis proposait « **Voir mes
réservations** » — qui mène à `/(tabs)/bookings`.

**L'app félicitait le membre et l'envoyait vers une liste où son cours n'était pas.** Le
malentendu n'est pas une inattention de sa part : c'est ce que l'app lui disait de faire.

Quand une intention existe, les trois éléments changent :

| | sans intention | avec intention |
|---|---|---|
| titre | PAIEMENT CONFIRMÉ ! | **IL RESTE UN GESTE** |
| corps | — | Ton crédit est bien là. Ta place n'est pas encore prise. |
| bouton | Voir mes réservations | **Confirmer ma réservation** |
| destination | `/(tabs)/bookings` | **la fiche du cours** |

⚠️ **L'intention prime sur `returnTo`** : un membre parti d'un cours revient au cours, même
si l'achat a transité par l'écran des formules.

---

## § 3 — L'architecture : une seule pose, au `PAYMENT_REQUIRED`

L'intention est écrite dans `session/[id].tsx`, **au refus serveur**, avant que le parcours
ne se ramifie. C'est le seul endroit qui voit les deux branches :

- **séance à l'unité** — reste dans `PaymentRequiredSheet` ;
- **abonnement** — `goToSubscription()` fait `onClose()` puis push vers
  `/profile/subscription`, **démontant cette fiche**. La poser dans la feuille laisserait
  cette branche sans intention.

### Deux signaux qui ne tombent pas en panne de la même façon

`lib/bookingIntent.ts` (AsyncStorage, survit au redémarrage) **et** `slot_id` dans l'URL de
retour. Un disque qui refuse d'écrire n'emporte pas l'URL ; une URL tronquée n'emporte pas
l'intention. Même doctrine que les deux signaux de l'écran de vérification.

### Stockage — AsyncStorage, sur le motif exact de `signupIntent.ts`

Clé `viniz.*`, `try/catch` best-effort, **lecture destructrice** pour la consommation,
`__reset` pour les tests. Le dépôt avait déjà un module d'intention persistée ; en inventer
un second dialecte aurait fini par diverger.

---

## § 4 — Validité : bornée par le créneau, plafonnée à 24 h

Une durée fixe se trompe **dans les deux sens** :

- réservé à 8 h pour un cours de **19 h**, retour à midi → « quelques heures » jetterait une
  intention parfaitement valide ;
- réservé pour un cours de **9 h**, paiement à 8 h 55, retour à 9 h 10 → trois heures de
  validité proposeraient un cours déjà commencé, que le serveur refuse (`SLOT_PAST`).

**Le créneau porte sa propre date de péremption : c'est elle qui fait foi.** Le plafond de
24 h est la seule part arbitraire, et il ne mord que sur un cours réservé très à l'avance.

---

## § 5 — Cours complet au retour

Le bouton dit déjà « LISTE D'ATTENTE » quand `isFull`. Le lot ajoute ce que le membre a
besoin de savoir, en **second geste explicite**, jamais coché d'avance :

- ⚠️ **le délai vient de la salle** — `notify-waitlist` lit
  `gym.waitlist_confirmation_minutes ?? 30`, **configurable par salle**. Écrire « 30 minutes »
  mentirait à toute salle qui l'a changée. `gymProfile` expose désormais la valeur, et
  `null` quand on ne la connaît pas encore : une variante sans délai plutôt qu'un chiffre
  inventé ;
- ✅ **le crédit reste entier** — `create-booking` le dit : « le débit du crédit est déplacé
  APRÈS la confirmation du siège. Aucun débit ici, ni sur le chemin waitlist ». Le membre
  vient de payer, il doit savoir qu'il ne perd rien.

---

## § 6 — Abonnement : même intention, et deux pièges levés

`create-booking` : `if (!activeSubscription && !creditsAvailable) → PAYMENT_REQUIRED`.
Abonnement et crédit ouvrent **exactement** le même droit.

Deux pièges que le code posait :

1. **Les polls ne regardaient que `member_credits`** — un abonnement n'y apparaît jamais, et
   le membre restait devant un spinner jusqu'au bout. Les deux polls interrogent désormais
   **le droit**, avec `ACTIVE_SUBSCRIPTION_STATUSES` / `isSubscriptionActive`, le prédicat
   déjà partagé par le résumé du profil — pas une seconde vérité.
2. **L'achat d'abonnement quitte la fiche** — d'où la pose de l'intention en amont (§ 3).

La ligne « crédit visible » s'appuie sur `useSubscriptionSummary`, qui lit déjà les deux
sources et rend `isActive = hasSubscription || hasCredits`.

---

## § 7 — Plus de réservation silencieuse, et la boucle évitée

`DropInRetryScreen` **réservait automatiquement** (`create-booking` puis redirection), et le
poll de la feuille faisait de même. Les deux sont supprimés : **tout finit sur la fiche du
cours, où le membre confirme lui-même** — un seul endroit décide, quel que soit le chemin de
retour (poll, deep link, retour manuel).

🔴 **Et une boucle que le correctif aurait créée sans ce garde-fou** : le membre revient, tape
« Confirmer ma réservation », le crédit n'est pas encore arrivé, le serveur rend
`PAYMENT_REQUIRED` — et l'app lui **rouvrait la feuille d'achat**. On lui aurait fait payer
deux fois le même cours. Quand une intention est armée, ce refus affiche « Crédit en route,
ton cours est gardé » et **conserve** l'intention.

---

## § 8 — Les autres cas limites

| cas | traitement |
|---|---|
| **le cours a commencé** | `estValide` borne par `startsAt` : l'intention est jetée à la lecture. Le serveur refusait déjà (`SLOT_PAST`) ; on ne laisse plus le membre taper « Confirmer » pour récolter une erreur |
| **paiement abandonné / échoué** | effacée sur `TERMINAL_FAILURE` (`failed`/`canceled`/`cancelled`/`expired`) — prédicat déjà présent dans l'écran. Pas de fantôme au prochain lancement |
| **un autre cours réservé avant de confirmer** | **une seule intention, jamais une liste** : la nouvelle remplace l'ancienne, rien à arbitrer. Et effacement sur toute réservation confirmée, quel qu'en soit le créneau |

---

## Preuves

- **Les deux points d'entrée traités d'un coup** : `(tabs)/index.tsx` et `(tabs)/schedule.tsx`
  poussent tous deux vers `/session/[id]` — corriger la fiche les couvre, et l'onglet
  Réservations avec
- **`DropInRetryScreen` n'avait jamais tourné** : sa condition exige `slot_id`, que
  `buildPaymentReturnUrl` n'émettait pas. Aucune habitude de membre à désapprendre
- **Poll : 60 s → 5 min**, aligné sur le plafond existant, et rendu **non critique** par
  l'intention persistée
- **Le droit, pas le crédit** : les deux polls lisent désormais abonnement ET crédits, avec
  le prédicat partagé `isSubscriptionActive`
- **Délai de liste d'attente lu sur la salle**, jamais 30 en dur ; `null` = pas de chiffre annoncé
- **Boucle de double paiement fermée** (§ 7)
- `tsc` mobile **exit 0 — 165 fichiers projet** · `tsc --build` dashboard **exit 0**
- `deno check` **35/35** · les **4** bancs Deno passent
- ⚠️ **Les 12 libellés attendent validation** (`session.*`, `payment.intent_*`,
  `payment_required.errors.not_confirmed`)
- ⚠️ **Pas d'essai sur appareil** — pas de simulateur depuis cette machine
- **`create_booking_atomic` non touché** · aucun déploiement
