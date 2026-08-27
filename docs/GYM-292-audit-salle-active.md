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
