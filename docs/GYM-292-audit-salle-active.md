# GYM-292 — Audit : le cycle de vie de la salle active côté client

> Branche `gym-292-291-coherence-salle-active` · base `develop` @ `e321e26`
> Rapport écrit **avant** toute correction, conformément à la phase 1 du ticket.

---

## 0. Verdict, en une phrase

**L'hypothèse d'une course est écartée : il n'y a pas de course, parce qu'il n'y a pas
de seconde écriture.** Choisir une salle dans la recherche n'appelle **jamais**
`switch_active_gym` — la sélection n'écrit qu'un slug local, qui commande la MARQUE. Le
serveur ne l'apprend pas. Les trois symptômes découlent de là et d'un second fait :
`gym_id` reste `null` après la connexion en mode multi, jusqu'à ce qu'un écran appelle
`refreshProfile()` — et **le seul qui le fasse au montage est `/profil`**.

---

## 1. Le cycle de vie de la salle active

### Qui la détient

| | où | quoi |
|---|---|---|
| **autorité** | `stores/useAuthStore.ts:79` — champ `gym_id` | la salle **active**, celle qui filtre les données |
| exposition | `lib/activeGym.ts:33` `useActiveGymId()` / `:43` `getActiveGymId()` | ne calcule rien, nomme et expose |
| **marque** | `lib/gymResolver.ts:137` `writeSelectedGymSlug` → AsyncStorage | le slug, qui commande le **thème** |
| cache marque | `lib/theme/brand.ts:25` `viniz.gym_brand` | indexé par slug (`brand.ts:42`) ✅ |
| cache identité salle | `lib/gymProfile.ts:55` `let cached` | **sans clé de salle** 🔴 |

🔴 **Il y a donc DEUX sources, pas une** : `gym_id` (données) et le slug (marque). Elles
sont réconciliées à un seul endroit — `app/_layout.tsx:212-226` — et cette réconciliation
ne se déclenche **que si `gym_id` est déjà résolu**.

### Qui l'écrit

| chemin | fichier:ligne | écrit `gym_id` | écrit le slug | appelle `switch_active_gym` |
|---|---|---|---|---|
| état initial du store | `useAuthStore.ts:106` | `single`→const, `multi`→**null** | — | — |
| connexion | `useAuthStore.ts:124` | idem (**null** en multi) | — | — |
| inscription | `useAuthStore.ts:161` | idem | — | — |
| restauration de session | `useAuthStore.ts:240` | idem | — | — |
| **`onAuthStateChange`** | `useAuthStore.ts:244-249` | **idem — réécrit à `null`** 🔴 | — | — |
| `refreshProfile` | `useAuthStore.ts:216` | `profiles.gym_id` (multi seul) | — | — |
| **sélection après recherche** | `app/gym/select.tsx:74` | **rien** 🔴 | oui | **non** 🔴 |
| lien profond | `app/[gymSlug]/[screen].tsx:103,148` | rien | oui | non |
| **switch GYM-288** | `lib/gymSwitch.ts:93-137` | via `refreshProfile` (l. 126) | oui (l. 115) | **oui** (l. 98) ✅ |
| réconciliation racine | `app/_layout.tsx:224` | — | oui, **non attendu** (`void`) | — |
| déconnexion | `useAuthStore.ts:183,188` | retour à l'initial | efface | — |

### L'ordre, au démarrage

1. `app/_layout.tsx:230` → `initialize()` → `useAuthStore.ts:238` `getSession()` →
   `set({ gym_id: initialSessionGymId() })` = **`null` en multi**.
2. `app/_layout.tsx:190-198` → lit le slug mémorisé → **la marque s'affiche**.
3. `app/_layout.tsx:213` — l'effet de réconciliation **sort immédiatement** :
   `if (GYM_MODE === 'single' || !sessionGymId) return`. `gym_id` est `null`.
4. Les écrans de données lisent `useActiveGymId()` → `null` → **ils s'abstiennent**
   (`useSchedule.ts:84`, `useHomeSchedule.ts`, `useGymPlans.ts`).
5. …et **rien ne déclenche `refreshProfile()`**. L'app reste dans cet état.
6. Le membre ouvre `/profil` → `app/(tabs)/profile.tsx:92-98` `useFocusEffect` →
   `refreshProfile()` → `gym_id` prend la valeur **serveur** → tout bascule d'un coup.

🔴 **`/profil` n'a rien de particulier : c'est le SEUL écran qui appelle `refreshProfile`
au montage.** Les deux autres appels sont `app/profile/edit.tsx:269` (après un
enregistrement) et `lib/gymSwitch.ts:126` (dans le switch lui-même).

---

## 2. Les trois symptômes, expliqués

### R1 — salle sélectionnée ≠ salle du serveur → `/profil` fait tout basculer

| | |
|---|---|
| sélection | slug = `studio-test-staging` → **marque** = Studio Test Staging |
| serveur | `profiles.gym_id` = **Dopamine** — jamais informé du choix |
| avant `/profil` | `gym_id` = `null` → données absentes, marque juste |
| **au montage de `/profil`** | `refreshProfile()` → `gym_id` = **Dopamine** → données Dopamine |
| **dans la foulée** | `sessionGymId` change → `_layout.tsx:212` s'exécute → `listMyGyms()` → `writeSelectedGymSlug('dopamine…')` → **marque Dopamine** |

Le thème ET les données basculent **parce que c'est exactement ce que le code prescrit** :
la règle GYM-288 « le profil serveur fait foi » s'applique — mais avec un retard qui la
rend incompréhensible. Elle devait s'appliquer à la connexion ; elle s'applique à la
première ouverture du Profil.

### R2 — « Studio Yoga Test 1 » sain de bout en bout

**Ce n'est pas un autre chemin de code, c'est une coïncidence d'état.** À ce moment-là
`profiles.gym_id` valait déjà Studio Yoga Test 1 (c'est la dernière salle qu'un
`switch_active_gym` réussi avait posée, ou celle du compte). Sélection et serveur
concordaient : la réconciliation n'avait rien à corriger.

**R2 est donc la preuve la plus utile de l'audit** — elle montre que le défaut ne dépend
pas de la salle, mais de l'ÉCART entre le choix local et l'état serveur. C'est ce qui
écarte l'explication « `/profil` adopte la salle du compte » : `/profil` n'adopte rien, il
**révèle** un désaccord qui existait déjà.

### R3 — « Dopamine (Staging Clone) » : marque juste, 0 cours

Même mécanique, vue par l'autre bout. Ici la sélection **concorde** avec le serveur, donc
rien ne bascule — mais `gym_id` vaut toujours `null` faute de `refreshProfile`, et les
hooks de planning s'abstiennent : `useSchedule.ts:84` `if (!gymId) { setIsLoading(false);
return }`. **Zéro cours n'est pas un cache périmé, c'est une requête jamais partie.**
Passer par `/profil` la déclenche.

🔴 **L'hypothèse « clés de cache sans gym_id » ne produit donc PAS R3.** Elle décrit un
vrai défaut, listé au § 4, mais un autre.

---

## 3. `switch_active_gym` : attendu ? que se passe-t-il s'il échoue ?

**Un seul appel dans toute l'app** : `lib/gymSwitch.ts:98`.

| question | réponse |
|---|---|
| attendu avant les requêtes ? | **oui** — `await` l. 98, et rien n'est purgé avant que le serveur ait tranché (l. 95-97) |
| ordre des purges | caches sans rendu (l. 108-109) → slug (l. 115) → réservations (l. 119) → `gym_id` (l. 126) → rechargements (l. 129-132) |
| échec `PT403` | `{ status: 'not_a_member' }`, **rien n'est purgé** ✅ |
| échec réseau / autre | `{ status: 'offline' \| 'error' }`, **rien n'est purgé** ✅ |
| ce que l'écran en fait | `app/profile/gym-switch.tsx:49-68` — `setRefused(true)`, message affiché, liste rechargée |

**Ce chemin-là est sain.** Le défaut de GYM-292 n'est pas dans le switch : il est dans le
chemin qui ne passe **pas** par lui.

⚠️ Une réserve tout de même : `gymSwitch.ts:126` appelle `refreshProfile()`, qui relit
`profiles.gym_id`. Si un `onAuthStateChange` survient entre la RPC et ce refresh
(`useAuthStore.ts:244`), `gym_id` est remis à `null` — l'app se retrouve sans salle
jusqu'au refresh suivant. C'est la seule vraie fenêtre de course de l'app, et elle est
étroite ; elle est traitée avec le reste.

---

## 4. Les clés de cache

Cette app **n'utilise pas React Query**. Ce qui joue le rôle d'une clé de cache est
double : le **tableau de dépendances** d'un effet qui lit des données, et les **caches de
module**. La liste est produite par outil, pas à la main :

```bash
cd apps/mobile && node scripts/audit-cles-cache.mjs
```

La liste des tables « de salle » est elle-même relevée, pas devinée :

```bash
grep -roh --include='*.ts' --include='*.tsx' -E "\.from\('[a-z_]+'\)" hooks lib stores app components | sort -u
```

`profiles` et `avatars` en sont volontairement exclues : elles sont indexées par MEMBRE,
et un filtrage par membre y est le bon.

### État AVANT correction — 7 clés sur 16 portent `gym_id`

| fichier:ligne | nature | clé | porte `gym_id` | verdict |
|---|---|---|---|---|
| `hooks/useSchedule.ts:80` | `useCallback` | `gymId` | **oui** | ✅ |
| `hooks/useHomeSchedule.ts:62` | `useCallback` | `gymId` | **oui** | ✅ |
| `hooks/useGymPlans.ts:76` | `useCallback` | `gymId` | **oui** | ✅ |
| `hooks/useLegalParams.ts:26` | `useCallback` | `gymId` | **oui** | ✅ |
| `app/(tabs)/bookings.tsx:142` | `useEffect` | `favorites, t, gymId` | **oui** | ✅ |
| `app/payment/success.tsx:92` | `useEffect` | `user, gymId, slotId, router` | **oui** | ✅ |
| `app/session/[id].tsx:203` | `useEffect` | `slotId, duration, days, months, gymId` | **oui** | ✅ |
| **`lib/gymProfile.ts:55`** | cache module | `let cached` | 🔴 **NON** | **défaut** — nom, adresse et horizon de la salle **quittée** survivent à tout changement de salle qui ne passe pas par `switchGym` |
| **`hooks/useSubscriptionSummary.ts:34`** | `useCallback` | `t` | 🔴 **NON** | **défaut** — `member_credits` + `member_subscriptions` filtrés par `member_id` SEUL : un membre de 3 salles voit les crédits des 3 sous la marque d'une |
| **`app/profile/subscription.tsx:168`** | `useCallback` | *(vide)* | 🔴 **NON** | **défaut** — même requête, même mélange, et l'effet ne se rejoue pas au changement de salle |
| **`app/profile/payments.tsx:63`** | `useEffect` | *(vide)* | 🔴 **NON** | **défaut** — `payments` par `member_id` seul |
| **`hooks/useProfileStats.ts:35`** | `useCallback` | *(vide)* | 🔴 **NON** | **défaut** — `bookings` par `member_id` seul : les statistiques agrègent les séances de toutes les salles |
| `hooks/useHomeSchedule.ts:182` | `useEffect` | `slots` | 🔴 non | **acceptable** — `slots` change quand la salle change, la clé est transitive ; à documenter, pas à corriger |
| `app/session/[id].tsx:98` | `useEffect` | `slotId` | 🔴 non | **acceptable** — un créneau appartient à une seule salle par construction ⚠️ mais rien ne vérifie qu'il appartient à la salle ACTIVE (cf. « à remonter ») |
| `app/payment/success.tsx:264` | `useCallback` | `rowId, mollieId, stopPolling` | 🔴 non | **acceptable** — sondage d'une ligne de paiement par son identifiant |
| `app/profile/delete-account.tsx:56` | `useEffect` | `userId` | 🔴 non | **acceptable** — engagement du MEMBRE, la salle n'entre pas dans la question |

**Cinq défauts réels**, dont quatre invisibles dans les trois symptômes rapportés : ils ne
se manifestent que chez un membre de plusieurs salles qui consulte son abonnement, ses
paiements ou ses statistiques. Le ticket demandait précisément de les signaler « même sans
symptôme vu ».

---

## 5. Point d'arrêt — vérification

| décision d'architecture | le correctif la contredit-il ? |
|---|---|
| `profiles.gym_id` = salle active | **non** — le correctif l'ÉCRIT par la RPC sanctionnée, il ne la contourne pas |
| vérité du rattachement dans `member_gyms` | **non** — `switch_active_gym` refuse (PT403) une salle non rattachée, et c'est ce refus qui valide la sélection |
| résolveur 2 modes intouchable | **non** — `lib/gymResolver.ts` et `EXPO_PUBLIC_GYM_MODE` ne sont pas modifiés |

**Pas de point d'arrêt.** La correction peut être écrite.

⚠️ Une précision sur « la sélection initiale **validée serveur** » : la sélection a lieu
**avant la connexion**, quand `auth.uid()` n'existe pas — `switch_active_gym` y est
impossible. La validation serveur ne peut donc avoir lieu qu'**à l'ouverture de session**,
première fois où l'app peut demander « ce choix est-il légitime ? ». C'est là que le
correctif la place.

---

# GYM-292b — La régression : le choix soumis **après** avoir été abandonné

> Ajouté après recette sur build neuf. Le correctif de #227 posait le bon chemin mais
> **dans le mauvais ordre** — et le silence de la réconciliation a rendu le diagnostic long.

## Ce qui n'allait pas

La logique de `reconcileActiveGym` était **juste branche par branche** — vérifié en
compilant le module et en substituant ses trois dépendances : les quatre cas rendaient le
bon verdict. **Le défaut n'était pas dans le QUOI, il était dans le QUAND.**

| # | défaut | où |
|---|---|---|
| 1 | le slug lu **en troisième**, après deux allers-retours réseau | `activeGymSession.ts:17` (version fusionnée) |
| 2 | la salle du serveur **adoptée avant** qu'on regarde le choix | `:7` `refreshProfile()` vs `:36` `switchGym()` |
| 3 | la garde « écriture en vol » **ne couvrait pas ce chemin** | `refreshProfile` hors de `withActiveGymWrite` |
| 4 | 🔴 **toute issue non-`ok` détruisait le choix** — coupure réseau comprise | `:38` « Refusée ou injoignable → le serveur fait foi » |
| 5 | 🔴 **aucune trace** de la branche prise | six sorties, zéro événement |

**Le n° 4 produit exactement le symptôme.** Rejoué sur le code de `develop` :

```
switchGym(studio-test-staging) → offline → writeSlug(dopamine-staging)
obtenu : server_wins / salle g-dopa / slug dopamine-staging
```

Marque **et** données sur Dopamine, et le choix effacé **définitivement** : le membre ne
pouvait plus le retrouver qu'en repassant par la recherche.

⚠️ **Ce que je ne peux pas prouver sans l'appareil** : *pourquoi* `switchGym` rendait
non-`ok`. Deux candidats lisibles — la RPC elle-même, ou son `try/catch` **unique** qui
englobait aussi `fetchBookings` et `loadFavorites`, exécutés juste après la connexion :
une erreur de rechargement **postérieure** à une bascule réussie était rapportée comme un
échec de bascule. Les deux sont corrigés ; et un incident ne détruit plus rien, donc la
question devient sans conséquence.

## L'ordre, désormais

```
1. lire le choix local        AVANT tout réseau — c'est ce qu'on est venu défendre
2. charger le profil          SANS la salle : la garde englobe toute la réconciliation
3. soumettre le choix         AVANT toute adoption de profiles.gym_id
4. le serveur ne gagne QUE    sans choix local, ou sur refus EXPLICITE (PT403)
   incident réseau            → rien n'est touché, la prochaine session réessaie
```

## Le silence était le cinquième défaut, et le plus coûteux

La réconciliation tranche entre le choix du membre et l'état du serveur **à chaque
ouverture de session**, et rien ne disait laquelle des six branches avait été prise. Le
défaut n'a été vu que parce qu'un humain a comparé des couleurs sur trois appareils.

Chaque sortie émet désormais `active_gym_reconciled` : un `outcome` d'un ensemble **fermé**
(`single` · `aligned` · `switched` · `server_wins` · `unavailable`) et `had_local_choice`.
**Aucune donnée personnelle** — ni slug, ni identifiant de salle (convention GYM-273).

## La preuve qu'elle aurait été attrapée

```bash
cd apps/mobile && node scripts/verify-course-salle-active.mjs
```

13 vérifications, dont les **six branches** de la réconciliation et **l'assertion d'ordre
elle-même** (« aucune adoption du serveur avant la soumission du choix »).

Rejoué contre le code de `develop`, il **échoue sur cinq cas**. C'est ce qui manquait : la
fonction n'avait aucun test, et son silence empêchait de voir laquelle des branches
s'exécutait.

---

# GYM-293 / GYM-298 — Compléments

## GYM-293 (mitigation) — l'inscription retirée en mode multi

En `multi`, `signupGymId()` rend `null` : le profil est créé **sans salle**, la session
s'ouvre, et l'app est vide — aucune requête ne matche, rien ne l'explique. Deux verrous,
parce qu'un seul ne tient pas :

| verrou | où | pourquoi |
|---|---|---|
| le **lien** disparaît | `components/viniz/BrandedLogin.tsx` | cet écran n'existe qu'en multi ; l'écran de Dopamine est un composant distinct, intact |
| la **route** est fermée | `app/(auth)/signup.tsx` — `<Redirect>` | le routeur enregistre le fichier dans **tous** les builds : un lien profond rouvrirait ce que le masquage ferme |

⚠️ Vérifié : **aucun autre chemin n'y mène en multi.** L'écran de connexion brandé ne porte
pas les boutons OAuth — ils créeraient un compte de la même façon. Les deux autres liens
vers l'inscription vivent dans des composants **single uniquement**.

## GYM-298 — rejouer la réconciliation au retour de veille

292b a remplacé une **perte définitive** par une **attente indéfinie** : un membre hors
ligne au lancement restait sans salle jusqu'à ce qu'il relance l'app. La reprise est armée
par la **seule** issue indécise :

| issue | reprise |
|---|---|
| `switched` · `aligned` · `server_wins` | **au repos** — ce sont des décisions, pas des incidents |
| `unavailable` | **armée** |

🔴 **Aucune nouvelle source de vérité** : `derniereIssue` dit si la dernière tentative a
abouti, jamais quelle est la salle. Et la garde compteur d'`activeGymWrites.ts` est
**consultée**, pas dupliquée — un retour de veille pendant une bascule manuelle ne relance
rien.

---

# RECETTE — version consolidée (#228 + #293 + #298)

Build **multi**, app réinstallée entre les blocs A et B.
Comptes : `member.studiotest@`, `member.yoga@`, `member.dopamine@` et `admin.dopamine@`,
tous `@staging.test`.

> ## ✅ Le compte multi-salles existe — mesuré, et daté
>
> `admin.dopamine@staging.test` est membre des **trois** salles staging :
> `dopamine-staging`, `studio-test-staging`, `studio-yoga-test-1`. Adhésion posée par le
> cockpit le **27/08 à 11:58:38 UTC** (13h58), et déjà exercée en QA — `choice_accepted`
> en télémétrie, et `profiles.gym_id` pointant sur `studio-test-staging`.
>
> **Le bloc B est exerçable**, ainsi que le bouton « Changer de salle », l'écran
> `profile/gym-switch`, l'issue `switched` et tout le bloc **J** de GYM-301.
>
> ⚠️ **CE FAIT NE CONTREDIT PAS L'AUDIT GYM-300, IL LE DATE.** La QA du 27/08 s'est
> déroulée de **12h33 à 13h21** — soit **avant** 13h58. À cet instant le compte n'avait
> qu'une adhésion, et ses deux `server_wins` étaient donc bien LÉGITIMES. La chronologie
> confirme le diagnostic au lieu de l'infirmer : ce n'était pas un défaut de soumission,
> c'était une adhésion absente. Voir `docs/GYM-300-audit-choix-multi.md`.

## A — Comptes à salle unique

| # | geste | attendu |
|---|---|---|
| A1 | Recherche → **Studio Test Staging** → login `member.studiotest@` | connexion brandée → accueil **Studio Test, avec ses cours**. /profil : **rien ne bouge**. |
| A2 | Réinstaller → **Studio Yoga Test 1** → `member.yoga@` | idem en Yoga |
| A3 | Réinstaller → **Dopamine** → `member.dopamine@` | idem. Cours présents **immédiatement**, sans passer par /profil |
| A4 | 🔴 Réinstaller → **Studio Test Staging** → `member.yoga@` (membre de Yoga **seulement**) | le serveur **refuse** (PT403) : bascule sur **Yoga**, marque **et** données cohérentes |

## B — Compte multi-salles (la régression de #228)

`admin.dopamine@`, salle active serveur = **Dopamine**. **Exige l'adhésion supplémentaire
posée par le cockpit** (voir l'encadré en tête de recette) — sans elle, jouer **B′**.

| # | geste | attendu |
|---|---|---|
| B1 | 🔴 Réinstaller → **Studio Test Staging** → login | **reste sur Studio Test Staging**. Aucune bascule vers Dopamine, **même fugitive** |
| B2 | /profil, /planning, /reservations | **rien ne bouge** |
| B3 | Réinstaller → **Studio Yoga Test 1** → login | reste sur **Yoga** |
| B4 | Réinstaller → **Dopamine** → login | reste sur **Dopamine** (le choix est déjà actif) |
| B5 | 🔴 GYM-300 — après B1, ouvrir /profil | **« Changer de salle » est VISIBLE.** Son absence signifie que l'adhésion n'a pas été posée : arrêter le bloc, ce n'est pas un défaut de l'app |
| B6 | 🔴 GYM-300 — PostHog, après B1 | `active_gym_reconciled` avec `outcome=switched` **et `reason=choice_accepted`** |

## B′ — Le refus d'adhésion (un compte à salle unique qui vise ailleurs)

⚠️ **PLUS AVEC `admin.dopamine@`** — il est multi-salles depuis le 27/08 13h58, et son
choix serait désormais ACCEPTÉ : le bloc prouverait l'inverse de ce qu'il annonce. Il
demande un compte à salle unique — `member.yoga@staging.test`, membre de
`studio-yoga-test-1` et d'elle seule.

| # | geste | attendu |
|---|---|---|
| B′1 | 🔴 Réinstaller → **Studio Test Staging** → login `member.yoga@` | ⚠️ **depuis GYM-301 ce n'est plus un bandeau mais un ÉCRAN** — voir le bloc J (J5 à J7). L'issue et la télémétrie, elles, sont inchangées |
| B′2 | PostHog, après B′1 | `outcome=server_wins`, **`reason=not_member`**. C'est le comportement ATTENDU, pas un défaut |
| B′3 | /profil, une fois arrivé dans sa salle | « Changer de salle » **absent** — une seule adhésion. Attendu, et cohérent avec B′2 |
| B′4 | Réinstaller → **Studio Yoga Test 1** → login `member.yoga@` | reste sur **Yoga**, aucun écran de refus (`reason=already_aligned`) |

## C — Incident réseau, et la reprise (GYM-298)

| # | geste | attendu |
|---|---|---|
| C1 | 🔴 Réinstaller → **Studio Test Staging**, **couper le réseau**, login (échoue) → rétablir → login | l'app va sur **Studio Test Staging**. Le choix a survécu |
| C2 | 🔴 Réinstaller → **Studio Test Staging** → login, **couper le réseau dans les 2 s** | soit Studio Test, soit un écran sans données — **jamais Dopamine** |
| C3 | 🔴 **Suite de C2, réseau toujours coupé** : passer l'app en arrière-plan, revenir | **rien ne change** (pas de réseau), et **aucune boucle** : pas de clignotement, pas de requêtes en rafale |
| C4 | 🔴 **Suite de C3** : rétablir le réseau **sans relancer l'app**, passer en arrière-plan, revenir | la salle **Studio Test Staging** apparaît, marque **et** données. **C'est le cas que GYM-298 corrige** : avant, il fallait relancer l'app |
| C5 | Après C4, refaire arrière-plan / retour **trois fois** | **plus aucune** réconciliation : la reprise s'est désarmée. Vérifiable dans PostHog — un seul `active_gym_reconciled` de plus, pas trois |
| C6 | 🔴 Lancer une bascule manuelle (Profil → Changer de salle) puis passer en arrière-plan / revenir **pendant** la bascule | la bascule aboutit normalement. **Aucune réconciliation concurrente** |

## D — Inscription masquée en multi (GYM-293)

| # | geste | attendu |
|---|---|---|
| D1 | 🔴 Écran de connexion brandé (multi) | **aucun lien « Créer un compte »**. « Ce n'est pas ma salle » est toujours là |
| D2 | 🔴 Forcer la route : lien profond ou navigation vers `/(auth)/signup` en multi | **redirection immédiate** vers la connexion. **Aucun formulaire ne clignote** avant |
| D3 | Depuis la connexion brandée, « Ce n'est pas ma salle » → autre salle → connexion | parcours 291 intact, toujours **sans** lien d'inscription |
| D4 | 🔴 Build **single** (Dopamine) : écran d'accueil, connexion, inscription | **inchangés**. Le lien « Créer un compte » est là, le formulaire s'ouvre, l'inscription fonctionne |

## E — Switch manuel et course (non-régression #227/#228)

| # | geste | attendu |
|---|---|---|
| E1 | `admin.dopamine@` : **3 allers-retours** de bascule sans attendre l'écran | à l'arrêt : marque **et** données de la dernière salle. Aucun retour en arrière spontané |
| E2 | Idem en coupant le réseau au milieu | message d'échec, **salle inchangée**, jamais d'état mixte |

## F — Cloisonnement (non-régression #227)

| # | geste | attendu |
|---|---|---|
| F1 | Abonnement / Paiements / statistiques en salle A puis B | les trois **diffèrent** |
| F2 | Nom et adresse de la salle après bascule | ceux de la salle **courante** |

## G — En-têtes et logo (non-régression #229)

| # | geste | attendu |
|---|---|---|
| G1 | multi : /accueil, /planning, /reservations, /profil | le nom de la salle **active** partout, aucune mention de Dopamine |
| G2 | multi : bouton central de la barre | **pulse-V Viniz** teinté de l'accent de la salle |
| G3 | single : les mêmes écrans | « **DOPAMINE / Performance Club** », « **D** » sur fond noir — **au pixel** |

## H — Observabilité

| # | geste | attendu |
|---|---|---|
| H1 | Après A1, A4, B1, C1 | un `active_gym_reconciled` par ouverture de session : `aligned`, `server_wins`, `switched`, `unavailable` |
| H2 | Après C4 | un `active_gym_reconciled` **supplémentaire**, `outcome=switched` — la reprise a abouti |
| H3 | 🔴 GYM-300 — sur TOUS les événements du jour | la propriété **`reason`** est présente, et vaut l'une des 7 valeurs du jeu fermé : `choice_accepted`, `not_member`, `refused_pt403`, `rpc_error`, `memberships_unavailable`, `no_local_choice`, `already_aligned` |
| H4 | 🔴 GYM-300 — filtrer `outcome=server_wins` | **aucun** ne porte `reason=memberships_unavailable` ni `rpc_error`. Une lecture ratée ne donne JAMAIS la main au serveur |

## J — GYM-301 : bascules en session, écran « pas membre », recherche brandée

J1 à J4 se jouent avec `admin.dopamine@` (trois salles). J5 à J7 demandent au contraire un
compte à salle **unique** qui vise ailleurs : `member.yoga@` choisissant Studio Test.

| # | geste | attendu |
|---|---|---|
| J1 | 🔴 Profil → Changer de salle → salle B | la **navbar** prend les couleurs de B — fond, bordure, libellé actif — en même temps que l'en-tête et les cartes |
| J2 | 🔴 Recommencer vers C, puis vers A — **trois bascules dans la même session** | la navbar suit à **chaque** fois. C'est le geste exact du constat : une seule bascule peut réussir par chance |
| J3 | Comparer deux salles sombres aux fonds proches | les barres ne sont **pas** identiques. Avant ce lot elles l'étaient toutes, au pixel |
| J4 | Bascule avec le **réseau coupé** | palette **Viniz**, jamais les couleurs de la salle précédente |
| J5 | 🔴 Recherche → choisir une salle dont on n'est **pas** membre → se connecter | **écran dédié**, aux couleurs de la salle **DEMANDÉE** (pas celles où l'on atterrit) : « Tu n'es pas encore membre de {salle}. Contacte le gérant pour obtenir l'accès. » |
| J6 | 🔴 J5 → action principale « Revenir à la connexion {salle} » | connexion de la salle **demandée**, **déconnecté** : aucun écran ne doit rester accessible en arrière, et rouvrir l'app ne doit pas ramener une session ouverte |
| J7 | 🔴 J5 → action secondaire « Aller à {ma salle} » | l'app s'ouvre sur **sa** salle, **sans redemander le mot de passe** |
| J8 | PostHog, après J5 | `outcome=server_wins`, `reason=not_member` — **inchangé** par ce lot |
| J9 | 🔴 Couper le réseau → rouvrir connecté (lecture d'adhésions ratée) | **bandeau**, PAS l'écran de refus. `memberships_unavailable` n'est pas `not_member` |

### J′ — « Trouve ta salle » aux couleurs Viniz

| # | geste | attendu |
|---|---|---|
| J′1 | 🔴 Lancement sans salle choisie → écran de recherche | fond **Violet Ink**, titre en blanc lavande, sous-titre lavande, cartes en violet saturé. Plus aucune trace de la charte Dopamine ni du gris sombre |
| J′2 | Une salle **sans logo** dans les résultats | la pastille d'initiale est en fond Viniz + lime — plus le noir et le lime de **Dopamine** |
| J′3 | Pied de l'écran | « propulsé par ViNiZ », **même rendu** que sur la connexion d'une salle |
| J′4 | Écran de **lancement** (pulse-V) | **inchangé** |
| J′5 | Non-régression **single** : build Dopamine | l'écran de recherche est **inatteignable** ; navbar, connexion et accueil de Dopamine strictement identiques |

## K — GYM-302 : le lime du wordmark, et le pulse d'attente

| # | geste | attendu |
|---|---|---|
| K1 | 🔴 Écran « Trouve ta salle » (Violet Ink), pied de page | le wordmark **ViNiZ** est en **Neon Lime**. « propulsé par » reste en lavande — deux teintes, pas une |
| K2 | 🔴 Connexion d'une salle au fond **CLAIR** (Studio Test), pied de page | le wordmark n'est **PAS** lime : il suit l'encre atténuée du fond. C'est la règle du garde-fou, et c'est le cas qui compte |
| K3 | Connexion d'une salle au fond **sombre** (Dopamine Staging Clone) | wordmark **lime** |
| K4 | Écran « pas encore membre » (K2 puis un choix hors adhésion) | le pied suit la salle **DEMANDÉE**, donc la même règle qu'en K2/K3 |
| K5 | 🔴 Taper 3 lettres dans la recherche | pendant le chargement : le **pulse-V** miniature **bat** — le tracé se dessine et recommence. Ce n'est plus la roue du système, et ce n'est pas une ligne figée |
| K6 | 🔴 Toucher une salle dans la liste | la ligne affiche le **même** pulse, en plus petit. Aucune roue grise ne doit subsister sur cet écran |
| K7 | Réglages système → **Réduire les animations** activé, rejouer K5 | le tracé s'affiche **entier et immobile**, sans bille. Comportement voulu, hérité de l'écran 01 |
| K8 | VoiceOver / TalkBack sur K5 | l'état est annoncé comme un **chargement**, pas comme « Viniz » |
| K9 | Écran de **lancement** (pulse-V plein écran) | **inchangé** : même durée, même rendu |
| K10 | Non-régression **single** : build Dopamine | aucun de ces écrans n'est atteignable ; navbar, connexion et accueil strictement identiques |

## I — Les trois finitions (GYM-300)

| # | geste | attendu |
|---|---|---|
| I1 | 3a — rejouer **B′1** | bandeau sombre en bas, 3 s : « Tu n'es pas membre de … — te voilà chez … ». Pas de bandeau **rouge** : ce n'est pas une erreur |
| I2 | 3a — couper le réseau, forcer la fermeture, rouvrir connecté | bandeau « On n'a pas pu joindre tes salles — on réessaie dès que ça revient ». La salle affichée **ne change pas** |
| I3 | 🔴 3b — login **Studio Test** → « Ce n'est pas ma salle » → choisir **Dopamine** → login | la **tab bar**, l'en-tête et les cartes prennent les couleurs de **Dopamine**. Aucune trace de Studio Test, **même après attente** |
| I4 | 🔴 3b — même geste, mais **réseau coupé** au moment de la seconde sélection | palette **Viniz** (fond sombre, lime), **jamais** les couleurs de la salle précédente |
| I5 | 🔴 3c — login sur **Studio Test** (fond clair) → /accueil, /planning, /reservations, /progression | sous chaque titre, le **nom de la salle est LISIBLE**. Il était invisible (blanc sur clair) |
| I6 | 3c — non-régression **single** : build Dopamine, mêmes 4 écrans | le sous-titre gris est **exactement** celui d'avant. Doit être indiscernable |
