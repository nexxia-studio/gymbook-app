# GYM-250 (PR 2) — La fin d'essai, les relances, l'allumage

**Branche** `gym-trial-on` · **base** `develop` · **aucun déploiement**, aucun build Expo.

Deux migrations, **et l'allumage est la seconde** : `20260923110000_gym250_allumage.sql` ne
s'applique qu'après le banc, et elle **refuse de partir seule** (elle échoue si la première
n'est pas là).

---

## § 1 — La réponse à ta question sur le quota de builds

> **Le message que lit un membre vit DANS L'APP. Il ne peut pas être corrigé côté serveur.**

Mesuré sur les trois surfaces :

| Étape | Ce qui se passe |
|---|---|
| `create-payment` refuse | `403 { code: 'PLAN_PAYMENTS_DISABLED', message: '…' }` |
| `tryEdgeInvoke` → `mapPaymentError(result.code)` | rend une **clé i18n**, `payments.errors.PAYMENTS_DISABLED` |
| `PaymentRequiredSheet` / `subscription.tsx` | `Alert.alert(t('payments.error_title'), t(info.messageKey))` |

Le `message` du serveur n'est **jamais affiché** — il n'apparaît que dans un `console.error`.
La voie serveur n'existe donc pas ici, et **inventer un nouveau code serait pire** : les
builds déjà installés ne le connaissent pas, `mapPaymentError` tomberait sur `default` →
`payments.errors.FALLBACK`, c'est-à-dire « L'action n'a pas abouti. Réessaie » — un message
qui invite à recommencer une action qui ne peut pas aboutir.

**Donc : le code serveur ne bouge pas, seul le texte du bundle change.** Il part avec la
**1.2.2**.

| | Avant | Après |
|---|---|---|
| fr | « Les paiements ne sont pas activés pour cette salle. » | « Le paiement en ligne n'est pas disponible pour cette salle. Tu peux régler directement auprès d'elle — tes abonnements et tes crédits en cours ne changent pas. » |
| en | « Payments are not enabled for this gym. » | « Online payment isn't available for this gym. You can pay them directly — your current membership and credits are unaffected. » |

Il ne dit rien de la situation commerciale de la salle, il donne une **issue réelle** (la
vente au comptoir n'est gardée par aucun plan — vérifié à l'audit), et il **rassure sur ce
qui compte** : ce que le membre a payé n'est pas touché.

---

## § 2 — Le cron : les deux tâches, et pourquoi elles ne sont pas dans le fichier

**⚠️ La section cron de la migration est commentée — elle n'est pas exécutée par le dépôt.**
`send-trial-reminders` lit le secret interne dans son en-tête : l'écrire ici le mettrait en
clair dans git. Convention GYM-116 / GYM-252.

| Tâche | Horaire | Quoi | Secret |
|---|---|---|---|
| `close-expired-trials` | **`40 * * * *`** | `SELECT public.close_expired_trials()` | aucun — **posable tel quel** |
| `send-trial-reminders` | **`55 * * * *`** | Edge Function | **à cloner** depuis `send-subscription-reminders` |

**Horaires choisis pour ne disputer aucune minute** aux dix jobs relevés en production le
21/09 : `:00`, `:05`, `:25`, `:35`, `:50`, la grille des quarts (`*/15`) et les demies
(`*/30`). **`:40` et `:55` sont libres.**

**Toutes les heures, pas une fois par jour** : l'heure d'envoi est décidée **en SQL**, sur
l'horloge de la salle (**9 h locale**). Le cron ne fait que proposer des occasions — une
salle dans un autre fuseau est servie correctement sans qu'une ligne change.

⚠️ **`:40` avant `:55` dans l'heure, et ce n'est pas indifférent.** Le gérant qui reçoit son
J-0 à 9 h voit une salle déjà remise en `active` — pas une salle « en essai » qui lui
annonce la fin de son essai.

---

## § 3 — La langue et l'identité des relances

**Langue** : `profiles.preferred_language` → à défaut `nexxia_gyms.default_language` → à
défaut `fr`. Résolu **dans la RPC de balayage**, pas dans le TypeScript : le courrier suit
le gérant, pas sa salle.

**Identité** : `VINIZ_BRANDING`, jamais `loadGymBranding`. Un courrier qui annonce la fin
d'un essai Viniz ne peut pas être signé du nom de la salle qui en est l'objet — ce serait la
salle s'écrivant à elle-même.

🔴 **Les quatre constantes ont déménagé** d'`auth-email-hook` vers `_shared/gym-branding.ts`
(`VINIZ_BRANDING`, `VINIZ_CTA_BG`, `VINIZ_CTA_FG`, `VINIZ_WORDMARK_PNG`, plus
`DASHBOARD_URL`), **sans changer une valeur**. Elles y étaient seules tant qu'un seul
courrier s'adressait au gérant ; il y en a deux maintenant, et deux exemplaires de la marque
auraient divergé au premier changement de logo.

**Aucun push.** Le gérant n'a pas l'app mobile — c'est celle des membres. C'est aussi
pourquoi **aucune garde de plan** ne conditionne ce courrier : `notifications_enabled`
gouverne les notifications **aux membres d'une salle**, pas les messages de la plateforme à
son client. Une salle en Free qui arrive au bout de son essai doit précisément le recevoir.

---

## § e — La clôture de l'état affiché

```sql
public.close_expired_trials()  -- trialing + date passée → status = 'active'
```

⚠️ **Elle ne coupe rien.** Le droit est tombé à la seconde où `trial_ends_at` est passée —
le hook est temporel. Cette fonction **cesse d'afficher** « en essai » une salle qui ne l'est
plus. Le banc le prouve par son ordre : les cas ⑩-⑮ (extinction constatée) passent **avant**
le cas ⑯ (la clôture).

- Elle **n'efface pas `trial_ends_at`** : c'est elle qui permet au J-0 et au J+7 de partir
  après, et la seule trace qu'un essai a eu lieu.
- Elle **journalise** dans `audit_logs`, `actor_id` **NULL** = la plateforme, pas un humain.
  Le lot 2 a rendu cette table en ajout seul : la ligne ne pourra plus être réécrite.
- Elle **laisse tranquille** une salle `trialing` **sans date**. C'est un état incohérent,
  mais possiblement transitoire et légitime (le cockpit pose le statut, puis la date, en deux
  gestes) : clôturer entre les deux défairait ton travail dans l'heure.

---

## § f — Les relances

| Jalon | Fenêtre | Pourquoi cette borne |
|---|---|---|
| **J-3** | `jours ∈ [1, 3]` | borne basse à 1 pour ne jamais se superposer au J-0 |
| **J-0** | `jours ∈ [-2, 0]` | le jour même **+ deux jours de rattrapage** : c'est le courrier le plus important, un cron manqué ne doit pas le perdre |
| **J+7** | `jours ∈ [-14, -7]` | l'écart avec `-2` garantit qu'une salle ne reçoit jamais deux courriers le même jour |

**Jours civils locaux, jamais une durée.** `trial_ends_at - INTERVAL '3 days'` compte
3 × 86 400 s : la nuit du 25/10, cela dérive d'une heure — assez pour faire changer de jour
une relance calculée près de minuit. Même geste qu'à GYM-93, GYM-116 et GYM-319. **Le
bandeau du dashboard applique la même règle**, pour que l'écran et le courrier du même matin
n'annoncent pas deux chiffres différents.

### 🔴 Le J-0 nomme l'extinction

> **Ce qui ne change pas :** les abonnements et les crédits déjà payés **courent jusqu'à
> leur terme**. Les membres continuent de réserver, et la salle peut toujours vendre au
> comptoir.
>
> **Ce qui s'arrête :** les **nouvelles ventes en ligne**, et elles seules.

⚠️ **Dire « votre essai est terminé » et rien d'autre serait pire que de ne rien dire** : le
gérant croirait avoir tout perdu et appellerait ses membres pour les rassurer. C'est
l'inverse du message.

### L'idempotence — « une fois par salle », prouvé

Trois colonnes de suivi (motif GYM-116 : **une par jalon**, pas un `reminder_sent_at`
unique — sinon le J-0 ne partirait jamais pour une salle ayant reçu son J-3).

Et la garantie tient à **deux** endroits, pas un :

1. **`mark_trial_reminder_sent` porte `WHERE … IS NULL`** : deux exécutions concurrentes ne
   repoussent pas l'horodatage. La première écriture gagne, la seconde ne touche aucune ligne
   et rend `false`.
2. **L'Edge Function regroupe par (salle, jalon) avant de marquer.** Dopamine a **trois**
   `gym_admin` : marquer après chaque envoi aurait posé la marque au premier et privé les
   deux autres de leur courrier. Les courriers partent, **puis** la marque est posée une fois.

⚠️ **Le jalon n'est marqué que si au moins un courrier est parti.** Zéro envoi = panne
Resend : ne rien marquer laisse le cron rattraper à l'heure suivante, et les fenêtres sont
assez larges pour que le rattrapage aboutisse.

🔴 **`cockpit_set_trial_end` remet les trois compteurs à zéro.** Sans ça, le lot 2 cassait
les relances : une salle prolongée d'un mois n'aurait **plus jamais** reçu de J-3 ni de J-0 —
elle se serait éteinte en silence, exactement le défaut que ce lot corrige. La remise à zéro
est inconditionnelle : un essai raccourci ou clos change aussi le calendrier.

### Le bandeau

`TrialBanner`, monté dans `DashboardLayout` — **pas** dans Réglages. Le gérant n'y va que
s'il a une raison, et la raison est justement ce qu'il ignore : c'est ce qui rendait le badge
de GYM-247 inutile comme alerte.

Il **n'est pas permanent** : il apparaît à **J-3**, au moment où l'information devient
actionnable, et reste après le terme. Un bandeau affiché quatorze jours devient un élément de
décor. Et comme `PlanGate`, **`null` veut dire « on ne sait pas »** : sur une panne de
lecture il n'affiche rien plutôt qu'une alerte.

⚠️ « Terminé » se juge **sur l'instant**, pas sur le jour civil — même critère que le
résolveur (`trial_ends_at > now()`). Un essai qui expire à 13 h 33 est terminé à 15 h, alors
que le compte en jours vaut encore 0.

---

## § h — L'allumage

`20260923110000_gym250_allumage.sql` : **une seule ligne change**,
`v_trial_enabled CONSTANT boolean := true`. Le reste du corps est repris à l'identique de
GYM-293b.

**Elle refuse de partir seule.** Son contrôle d'application échoue si :
- la constante n'est pas passée à `true` ;
- les trois colonnes de relance manquent ;
- `close_expired_trials()` n'existe pas.

Et elle ne se contente pas de relire le source : elle **appelle le résolveur sur une vraie
salle** et vérifie qu'il rend toujours des commissions.

**Pour revenir en arrière** : rejouer le fichier avec `false`. Aucune donnée n'est touchée —
le hook est un **calcul**, pas un état. Les relances, elles, continuent de partir : elles ne
dépendent pas de la constante mais de `trial_ends_at`. C'est voulu — un retour en arrière ne
doit pas rendre les gérants muets.

---

## Les preuves

### `deno check` — **36 / 36**

```
deno check : 36 fonctions · 0 en échec
```

⚠️ **36 et non 35** : `send-trial-reminders` est la trente-sixième. Le chiffre de la
convention GYM-350 change avec ce lot, et la recette le dit pour que le prochain lot ne le
lise pas comme une régression.

### `tsc --build` (dashboard) — exit 0 · `tsc` (mobile) — exit 0

```
tsconfig.app.json : 158 · tsconfig.node.json : 1 · tsconfig.tests.json : 2
```

Parité i18n : **dashboard 1380/1380**, **mobile 669/669**.

### Bancs TypeScript — 3 / 3 verts

`commission_test` (11 assertions), `booking-guards_test` (13), `mollie-error_test` (29).

### Banc de l'essai — staging, transactionnel, **25 / 25**

`supabase/tests/gym_trial_on.sql`. **Les deux migrations sont appliquées dans la
transaction**, puis annulées : on ne teste pas une reconstruction du lot, on teste les
fichiers.

| # | Cas | Obtenu |
|---|---|---|
| ①② | Dates héritées : avant / après la purge (**décision 4**) | **3 → 0** ✅ |
| ③④ | Migration 1 laisse `false` · migration 2 pose `true` | ✅ |
| ⑤⑥⑦ | **En essai** : colonne `free`, effectif `pro`, 200 membres, vente ouverte | ✅ |
| ⑧ | **En essai** : commission = **0,0100**, le taux du plan effectif (**décision 1**) | ✅ |
| ⑨ | **En essai** : un NOUVEAU membre est accepté | ✅ |
| ⑩⑪⑫ | **Jour 15** : effectif `free`, vente fermée, commission à 0 | ✅ |
| ⑬⑭ | **Jour 15** : ses membres réservent (`confirmed`), 3 abonnements intacts | ✅ |
| ⑮ | **Jour 15** : un NOUVEAU membre est refusé — `PT409` | ✅ |
| ⑯⑰⑱⑲ | Clôture : 1 salle, statut `active`, **date conservée**, 1 audit `actor_id` NULL, 0 au 2ᵉ appel | ✅ |
| ⑳㉑㉒㉓ | Relances : **2 lignes pour 2 gérants**, jalon posé une fois (`true` puis `false`), disparu du balayage | ✅ |
| ㉔ | Le J-0 est rendu le jour du terme | ✅ |
| ㉕ | Prolonger l'essai remet les trois jalons à zéro | ✅ |

**L'ordre de ⑩-⑮ avant ⑯ est la preuve principale** : l'extinction s'était déjà produite
**avant** que le cron ne passe. Le cron ne coupe rien, il range.

**Le filtre horaire est exercé, pas contourné** : `now()` étant figé dans la transaction, le
banc déplace la salle dans un fuseau où il est **actuellement 9 h** (`posix/Pacific/Niue` ce
jour-là). C'est le vrai `AT TIME ZONE` de la fonction qui est éprouvé.

**Étanchéité revérifiée après coup** : constante de retour à `false`, 0 colonne
`trial_reminder_*`, `close_expired_trials()` absente, grille `free` à 15, les trois salles en
`pro`/`active` avec leurs dates héritées et `Europe/Brussels`, 0 ligne `trial_closed`.

---

## Ce qui reste, et dans quel ordre

1. Appliquer **`20260923100000`** (staging puis prod).
2. Déployer les Edge Functions : **`send-trial-reminders`** (nouvelle) et
   **`auth-email-hook`** (l'identité Viniz a déménagé — il ne compile plus sans le `_shared`
   à jour).
3. Poser **`close-expired-trials`** (`40 * * * *`, sans secret) et **cloner**
   `send-trial-reminders` (`55 * * * *`).
4. Déployer le **dashboard** (bandeau).
5. **Rejouer le banc hors transaction** si tu veux la confirmation sur l'appliqué.
6. Seulement alors : **`20260923110000`** — l'allumage.
7. Le texte membre part avec la **1.2.2** (3 builds Expo restants jusqu'au 01/10).

⚠️ **Entre l'étape 1 et l'étape 6**, toute salle créée en libre-service est `trialing` avec
une vraie date mais servie en `free` (état hérité de la PR #305, déjà documenté). À
l'allumage, elle **récupère son essai** si la date n'est pas passée.

📋 **Hors lot, signalé :** le moteur B2B (`nexxia_subscriptions`, grâce, reconduction) reste
entier — 0 ligne, aucun écrivain. C'est le lot suivant, et l'essai n'en dépend pas.
