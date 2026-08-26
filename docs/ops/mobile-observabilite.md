# GYM-276 — Observabilité des deux apps mobiles

## 1. La question du lot : d'où viennent les variables en production ?

**Réponse : des variables d'environnement EAS, côté serveur** — pas d'un fichier local, pas d'`eas.json`.

Établi par `eas env:list` (lecture seule) :

```
Environment: production
  EXPO_PUBLIC_POSTHOG_KEY      = phc_Bz2n…            ← identique à la clé fournie par le cockpit ✓
  EXPO_PUBLIC_SENTRY_DSN       = https://948d0a4b…@o4511371891572736.ingest.de.sentry.io/4511761404854352
  EXPO_PUBLIC_SUPABASE_ANON_KEY / _URL                ← projet prod fcjupgvmjkqztxtwymdb
  SENTRY_AUTH_TOKEN            = ***** (secret)

Environment: preview
  SENTRY_AUTH_TOKEN            = ***** (secret)       ← ET RIEN D'AUTRE

Environment: development
  SENTRY_AUTH_TOKEN            = ***** (secret)
```

### ✅ Bonne nouvelle : la production ne dépend PAS du poste d'Antoine

L'hypothèse à écarter en priorité — « et si les builds de prod tiraient leurs clés d'un `.env.local` non versionné ? » — est **fausse**, et vérifiée :

`apps/mobile/.env.local` existe bien sur le poste, est bien gitignoré (`.env*.local`), mais ne contient **que trois variables** : `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_GYM_ID`. **Ni le DSN Sentry, ni la clé PostHog.** Il sert au développement local, pas aux builds.

Les builds EAS lisent l'environnement **du serveur**. Une build de production lancée depuis n'importe quelle machine obtient les mêmes valeurs.

### 🔴 La cause exacte du silence de l'app staging

Le profil `preview-staging` résout vers l'**environnement EAS `preview`**, qui ne contient aucune variable `EXPO_PUBLIC_*`. C'est le message vu en build :

> No environment variables with visibility Plain text and Sensitive found for the **preview** environment

L'app staging n'obtenait donc que les 5 variables déclarées dans le bloc `env` d'`eas.json`. Ni DSN, ni clé PostHog → et le code est **no-op par conception** sans elles :

```ts
if (sentryDsn) { Sentry.init(…) }                  // app/_layout.tsx
const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY // lib/analytics.ts
export const posthog = apiKey ? new PostHog(…) : null
```

Zéro événement en deux heures : le comportement attendu, pas une panne.

## 2. Ce que ce lot pose, et où

| Variable | Production | Staging |
|---|---|---|
| `EXPO_PUBLIC_SENTRY_DSN` | **inchangé** — env EAS serveur | **ajouté** dans `eas.json`, profil `preview-staging` |
| `EXPO_PUBLIC_POSTHOG_KEY` | **inchangé** — env EAS serveur | **ajoutée** dans `eas.json` — **la même clé** (plan gratuit : un seul projet, cf. §4) |

⚠️ **La production n'est pas touchée, et c'est délibéré.** Recopier le DSN et la clé PostHog dans `eas.json` aurait créé **deux sources de vérité** : le jour où Antoine ferait tourner une clé côté EAS, `eas.json` l'écraserait silencieusement avec la valeur périmée. Ce qui marche déjà reste là où il marche.

Pour le staging, `eas.json` **est** déjà le mécanisme en place (ses 5 variables y sont, y compris la clé anon Supabase). On y ajoute les deux nouvelles, du même statut : **un DSN Sentry et une clé de projet PostHog sont publiables** — ils partent dans le bundle client, exactement comme une clé anon. Ce ne sont pas des secrets ; le secret, c'est `SENTRY_AUTH_TOKEN`, qui reste côté serveur EAS.

## 3. Séparer les deux apps dans Sentry

```ts
environment: process.env.EXPO_PUBLIC_APP_VARIANT === 'staging' ? 'staging' : 'production'
```

**Un seul projet Sentry suffit**, et c'est un choix : `environment` y est un filtre de **premier rang** — sélecteur global, alertes, taux de régression. Contrairement à PostHog (§4), il n'y a pas de risque qu'une analyse existante l'ignore par accident.

⚠️ **Asymétrie avec PostHog, à connaître avant de « corriger » cette section par analogie** : côté Sentry, `environment = production` est **juste**, y compris pour les builds antérieurs à ce lot — le SDK pose `production` par défaut quand l'option n'est pas fournie (c'est ce qui avait été constaté dans les tags à GYM-276). Côté PostHog, la propriété n'existait pas du tout : ses anciens événements sont à `null`, d'où le filtre `IS NOT staging` du §4. Même mot, deux comportements.

**Deuxième séparation, gratuite** : la release porte l'identifiant natif du bundle, et GYM-258 les distingue déjà —

```
be.dopamineclub.app@1.0.5+22     (Dopamine)
app.viniz.staging@1.0.5+N        (Viniz Staging)
```

Les deux apps ne peuvent donc pas se confondre, même à environnement égal.

## 4. 🔴 PostHog : un seul projet, une super-propriété — ET LA DETTE QUI VA AVEC

> ## ⚠️ TOUTE ANALYSE POSTHOG DOIT FILTRER `environment IS NOT staging`.
> ## Un chiffre lu sans ce filtre inclut les tests d'Antoine.
>
> ### 🔴 Et surtout : **PAS** `environment = production`.
> La propriété n'existe **que depuis ce lot**. Tous les événements déjà en base, et tous
> ceux qu'émet l'app de production tant qu'elle tourne sur un build antérieur, ont
> `environment` **à null** — constaté sur les données. Filtrer sur « = production »
> **exclurait toute la production actuelle et tout l'historique**, c'est-à-dire l'inverse
> exact du but recherché.
>
> « IS NOT staging » retient le `null` **et** le `production` : c'est le seul filtre juste
> aujourd'hui. « = production » ne le redeviendra que lorsque la **totalité** de la base
> installée aura une build postérieure à ce lot — donc pas avant longtemps, personne ne
> contrôlant la date de mise à jour des téléphones des membres.

C'est la contrepartie assumée du **plan gratuit**, qui n'autorise qu'un seul projet — et
c'est l'unique projet de l'organisation. La séparation par construction (un projet dédié
au staging, retenue par GYM-276) n'est **pas disponible**.

Cela vaut pour les analyses **déjà écrites** : taux de remplissage, conversions, rétention,
tout tableau de bord existant compte aujourd'hui les événements des deux apps. Aucune ne
se met à jour toute seule.

### Ce qui rend cette dette dangereuse

| | Séparation par projet | **Étiquetage (retenu par contrainte)** |
|---|---|---|
| Pollution possible | non, par construction | **oui** — même magasin |
| Analyses existantes | inchangées | **toutes à reprendre** |
| Mode d'échec | bruyant : la clé manque, rien ne part | **silencieux** : un oubli de filtre donne un chiffre faux qui se lit exactement comme un chiffre juste |

Le mode d'échec est le point : rien ne signalera jamais qu'une analyse a oublié le filtre.
C'est pourquoi cette section ouvre sur un avertissement plutôt que sur une explication.

### Le mécanisme : une super-propriété persistante

```ts
posthog?.register({ environment: ANALYTICS_ENVIRONMENT })   // 'staging' | 'production'
```

**Pourquoi `register()` et pas une propriété passée à chaque appel** : nos `captureEvent`
ne sont pas les seuls événements envoyés. Le `PostHogProvider` du `_layout` racine produit
de l'**autocapture** (écrans, navigation) et des événements de **cycle de vie** que
personne n'appelle à la main — et ce sont eux qui font le volume. Une propriété passée à
`capture()` ne les couvrirait pas, et le tri serait faux là où il compte le plus.

**Vérifié dans le code de la version installée** (`@posthog/core`, `posthog-core.js`), pas
supposé :

- `register()` écrit dans les propriétés persistées (`PostHogPersistedProperty.Props`) ;
- `enrichProperties()` les étale **en premier** dans chaque événement :
  `{ ...this.props, ...this.sessionProps, ...userProperties, ...common, $session_id }` ;
- et `enrichProperties()` est appelé par `capture()`, `autocapture()`, `screen()`,
  `alias()` et l'identification. **Couverture complète.**

**Ceinture** : `captureEvent` pose *aussi* `environment` explicitement. Ce n'est pas
redondant — `register()` écrit de façon asynchrone dans un stockage persistant, et les tout
premiers événements d'un démarrage à froid peuvent partir avant que l'écriture ne soit
visible. Les événements **métier**, ceux dont on tire les chiffres, portent donc
l'étiquette de façon inconditionnelle. Même constante des deux côtés : aucune divergence
possible.

### Le jour où le plan le permettra

Repasser à un projet dédié est un changement d'une ligne dans `lib/analytics.ts` (choisir
la clé selon `isStaging`) plus une variable dans `eas.json`. La super-propriété peut rester
— elle ne gêne pas, et elle documente l'origine de chaque événement.

## 4bis. GYM-272/273 — Catalogue des écrans et des événements

### Écrans (`$screen`)

Le nom vient des **segments** d'Expo Router, pas de l'URL : `useSegments()` rend le motif
(`['session', '[id]']`), donc **aucun identifiant ne peut entrer dans un nom d'écran**.
C'est anonyme par construction, pas par assainissement.

Règles : les groupes `(auth)` / `(tabs)` sont retirés · un segment dynamique `[x]` devient
`detail` · les tirets deviennent des underscores · racine → `home`.

| Route | Nom d'écran |
|---|---|
| `/` | `index` |
| `/(tabs)/` | `home` |
| `/(tabs)/schedule` · `bookings` · `studio` · `profile` | `schedule` · `bookings` · `studio` · `profile` |
| `/(auth)/login` · `signup` · `forgot-password` · `verify-email` | `login` · `signup` · `forgot_password` · `verify_email` |
| `/session/[id]` | **`session_detail`** — jamais l'UUID |
| `/payment/success` · `/payment/cancel` | `payment_success` · `payment_cancel` |
| `/profile/edit` · `payments` · `subscription` · `security` · `preferences` · `export-data` · `delete-account` | `profile_edit` · `profile_payments` · `profile_subscription` · `profile_security` · `profile_preferences` · `profile_export_data` · `profile_delete_account` |
| `/profile/legal/cgu` · `/profile/legal/privacy` | `profile_legal_cgu` · `profile_legal_privacy` |
| `/dopamine/confirm-waitlist` · `payment-success` · `reset-password` | `dopamine_confirm_waitlist` · `dopamine_payment_success` · `dopamine_reset_password` |
| `/auth/callback` · `/+not-found` | `auth_callback` · `not_found` |

### Événements

Toutes les propriétés ci-dessous **s'ajoutent** aux super-propriétés `environment` et
`gym_id`, portées par chaque événement sans intervention de l'appelant.

| Événement | Propriétés | Émis depuis |
|---|---|---|
| `booking_created` | `status` | `stores/useBookingStore` |
| `booking_cancelled` | — | `stores/useBookingStore` |
| **`booking_failed`** | `code`, `status`, `offline` | **`lib/edgeInvoke`** |
| **`waitlist_joined`** | `position` | `stores/useBookingStore` |
| **`waitlist_promoted`** | — | `stores/useBookingStore` |
| **`waitlist_expired`** | — | `app/session/[id]` |
| `payment_initiated` | `kind` | `lib/payments` |
| **`payment_completed`** | `amount_cents`, `currency`, `kind`, `credits_granted` | `app/payment/success` |
| **`payment_failed`** | `status` | `app/payment/success` |
| **`subscription_started`** | `amount_cents`, `currency` | `app/payment/success` |
| **`subscription_cancelled`** | — | `app/profile/subscription` |
| **`login_succeeded`** | — | `stores/useAuthStore` |
| **`login_failed`** | `reason` (clé i18n, ensemble fermé) | `stores/useAuthStore` |
| **`signup_completed`** | `needs_confirmation` | `stores/useAuthStore` |
| `secure_store_read_failed` | `reason` (`locked` / `not_found` / `other`) | `lib/supabase` |

**Conventions** : `objet_action` au passé · propriétés en `snake_case` · montants en
**centimes** + `currency` séparée · **jamais** d'email, de nom ni de texte libre.

### ⚠️ Limite connue : `payment_completed` sous-estime la conversion

Il est capturé **côté client**, sur l'écran de retour de paiement. Un membre qui paie puis
ferme le navigateur sans revenir dans l'app ne déclenche rien — alors que son paiement a
réussi et que ses crédits sont bien délivrés par le webhook.

**La mesure exacte viendrait du webhook Mollie** : un envoi serveur vers PostHog, avec
`distinct_id` = l'id du profil, au moment où le paiement est confirmé. C'est une évolution
identifiée, **hors de ce lot** — le webhook de paiement n'a pas été touché.

En attendant : `payment_completed` est un **plancher**, pas un compte exact. `/revenus` et
la table `payments` restent la source de vérité de l'argent encaissé.

## 5. Message hors ligne

Défaut observé : réseau coupé, le bouton de réservation ne faisait **rien**. Aucun message.

`lib/edgeInvoke.ts` détecte désormais l'échec **avant** d'atteindre le serveur — `FunctionsFetchError` / `FunctionsRelayError` (classes de supabase-js), `TypeError` de `fetch`, ou absence de réponse exploitable — et rend le code `NETWORK_OFFLINE`, mappé sur « Pas de connexion — vérifie ta connexion et réessaie ».

⚠️ **Jamais envoyé à Sentry.** Une coupure réseau n'est pas un défaut de l'app : doctrine de GYM-270, déjà tranchée par GYM-240. Le tunnel du métro de chaque membre n'a pas à réveiller qui que ce soit.

Trois chemins de l'écran de séance sont couverts :

| Chemin | Avant | Après |
|---|---|---|
| Réserver | rien ne se passe | alerte « Pas de connexion » |
| **Annuler** | **promesse rejetée non gérée** (`cancelBooking` lève et rien ne l'attrapait), modale figée | alerte, modale rendue |
| Confirmer une place en liste d'attente | rien ne se passe | alerte |

Le cas « annuler » n'était pas dans le signalement : il est apparu en suivant le code, et c'était le même défaut sur l'autre moitié du parcours.

## 6. Gestes restant à Antoine

| # | Geste | Bloquant pour |
|---|---|---|
| 1 | **Rien.** DSN Sentry et clé PostHog sont dans `eas.json` : la prochaine build `preview-staging` envoie dans les deux outils | — |
| 2 | **Reprendre les analyses PostHog existantes** pour y ajouter `environment IS NOT staging` — ⚠️ **pas** `= production`, qui exclurait tout l'historique (cf. §4) | l'exactitude des chiffres |
| 3 | *(optionnel)* Basculer ces deux variables de `eas.json` vers l'environnement EAS `preview`, pour aligner staging sur le mécanisme de la prod | — |

Aucune commande `eas` de création ou de modification n'a été exécutée par ces lots ; seul
`eas env:list`, en lecture.

## 7. Recette

1. **Build `preview-staging`** → installer l'app « Viniz Staging ».
2. **Sentry** : provoquer une erreur. L'événement doit arriver avec `environment: staging` et une release `app.viniz.staging@…`. Vérifier au passage qu'un événement de l'app Dopamine porte bien `environment: production` — c'est la moitié qui protège Nico.
3. **PostHog** : les événements de l'app staging arrivent dans le projet GymBook, **tous porteurs de `environment = staging`** — y compris les `$screen` et les événements de cycle de vie, que personne n'émet à la main.
   ⚠️ **Ne PAS s'attendre à `environment = production` sur les événements de Dopamine** : l'app de production tourne encore sur un build antérieur à ce lot et n'émet pas la propriété — ses événements ont `environment` à **null**. C'est normal, et ça le restera jusqu'à ce que toute la base installée ait migré.
   ⚠️ Puis **ajouter le filtre `environment IS NOT staging` aux analyses existantes** — et surtout pas `= production`, qui les viderait de tout l'historique (§4).
4. **Hors ligne** : mode avion, puis réserver / annuler / confirmer une place. Trois messages « Pas de connexion ». Et **aucun** événement correspondant dans Sentry.
