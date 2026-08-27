# GYM-286 — Inventaire des couleurs de `apps/mobile`, et méthode de migration

> **Ticket** GYM-286a (inventaire + écran pilote) · **Chantier parent** GYM-102
> **Branche** `gym-286a-inventaire-pilote` · **Base** `develop` @ `48ca4ca`
> **Suite** GYM-286b applique mécaniquement la [méthode](#méthode--migrer-un-fichier-mode-demploi-pour-gym-286b) aux 70 fichiers restants.

Tant qu'une couleur est écrite en dur dans `apps/mobile`, l'app est aux couleurs de la
salle sur les écrans migrés et en Dopamine partout ailleurs. Ce document recense ce qui
reste, dit à quoi chaque valeur doit devenir, et décrit comment procéder.

---

## 1. Comment ces chiffres sont obtenus

**Aucun compte de ce document n'est écrit à la main.** Tous se rejouent :

```bash
cd apps/mobile

# ── LES DEUX COMPTES DU TICKET ──────────────────────────────────────────────────
# Périmètre : app/** + components/**, c'est-à-dire EXACTEMENT les deux globs `content`
# de tailwind.config.js — hors d'eux, une classe `move-*` n'est même pas générée.
# `components/viniz/**` est retiré : ces composants sont nés migrés au lot 3.
grep -roh --include='*.ts' --include='*.tsx' --exclude-dir=viniz -E 'move-[a-z-]+' app components | wc -l
grep -roh --include='*.ts' --include='*.tsx' --exclude-dir=viniz -E '#[0-9a-fA-F]{3,8}\b' app components | wc -l
grep -rl  --include='*.ts' --include='*.tsx' --exclude-dir=viniz -E 'move-[a-z-]+|#[0-9a-fA-F]{3,8}\b' app components | wc -l

# ── L'INVENTAIRE CLASSÉ (source du § 4) ─────────────────────────────────────────
node scripts/inventaire-couleurs.mjs        # résumé par famille
node scripts/inventaire-couleurs.mjs --md   # le tableau par fichier, tel quel
```

Vérifié identique avec le `grep` BSD de macOS et avec `ugrep`.

### Ce que les chiffres du ticket recouvraient — et l'écart

| mesure | ticket | mesuré sur `develop` @ `48ca4ca` | commentaire |
|---|---|---|---|
| classes `move-*` | 441 | **442** | 441 se reproduit **exactement** au commit du lot 3 (`71f2f8c`). Le +1 est `move-border`, ajouté par GYM-288. |
| hexadécimaux | 313 | **313** ✅ | reproduction exacte. |
| fichiers | 62 | **71** | ⚠️ **ne se reproduit sous aucune définition** : 64 fichiers portent une classe, 60 un hex, 71 l'un ou l'autre, 53 les deux. Aucun périmètre testé ne rend 62. |

🔴 **Et le périmètre réel est plus large que les deux populations annoncées.** Trois
familles de littéraux ne sont comptées ni dans les 442 ni dans les 313, et devront
pourtant être migrées :

| population | occurrences | fichiers | exemple |
|---|---|---|---|
| classes `move-*` | 442 | 64 | `bg-move-dark` |
| hexadécimaux | 313 | 60 | `color="#111111"` |
| **palette Tailwind par défaut** | **101** | 26 | `text-red-500`, `border-orange-400`, `bg-green-500/10` |
| **`white` / `black` / `transparent`** | **64** | 34 | `text-white`, `bg-black/40`, `text-white/60` |
| **`rgba()` littéraux** | **7** | 5 | `rgba(17, 17, 17, 0.65)` |
| **TOTAL** | **927** | **75** | |

```bash
# Les trois populations non annoncées :
PAL='(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)'
grep -roh --include='*.ts' --include='*.tsx' --exclude-dir=viniz -E "(bg|text|border|fill|stroke|ring|divide|placeholder|shadow)-$PAL-[0-9]{2,3}(/[0-9]+)?" app components | wc -l
grep -roh --include='*.ts' --include='*.tsx' --exclude-dir=viniz -E '\b(bg|text|border|fill)-(white|black|transparent)(/[0-9]+)?' app components | wc -l
grep -roh --include='*.ts' --include='*.tsx' --exclude-dir=viniz -E 'rgba?\([0-9., ]+\)' app components | wc -l
```

**Conséquence pour le chiffrage de GYM-286b : ~23 % de travail de plus que le ticket ne
l'indique.** Le tableau du § 4 ne couvre que les deux premières populations — celles que
GYM-286a avait mandat d'inventorier. Les 172 autres occurrences sont à inventorier au
même format avant 286b ; elles sont pour l'essentiel **sémantiques** (rouges, orangés,
verts de la palette Tailwind), c'est-à-dire la famille qui compte le plus.

> **✅ FAIT EN GYM-286b.** `scripts/inventaire-couleurs.mjs` couvre désormais les cinq
> populations et fait autorité sur les comptes : **900 occurrences sur 73 fichiers**
> (728 + 172), commentaires exclus. La palette Tailwind y est **lue dans le paquet
> installé**, jamais recopiée — une montée de version ne peut pas rendre le tableau faux
> en silence.
>
> 🔴 **Et seules 64 des 172 se migrent.** Une valeur ne devient un jeton que si elle vaut
> EXACTEMENT ce jeton : `text-red-500` **est** `SEMANTIC.danger` #EF4444, mais
> `bg-red-500/10` est un lavis de ce rouge que nul jeton ne nomme. Les 108 autres restent
> — et **les laisser n'est pas un demi-travail** : ce sont des valeurs sémantiques, dont
> le seul devoir est de ne jamais suivre la marque, ce qu'une classe Tailwind figée fait
> déjà parfaitement. Ce qui leur manque est une source unique, pas une correction.
>
> `node scripts/inventaire-couleurs.mjs --reste` ventile le restant **par raison** : une
> occurrence laissée sur ordre du cockpit et une occurrence oubliée se ressemblent dans un
> total, et n'ont rien à voir.

### État après GYM-286a, puis après GYM-286b

| | avant 286a | après 286a | **après 286b** |
|---|---|---|---|
| occurrences (5 populations, hors commentaires) | 924 | 900 | **240** |
| dont **migrables** (un jeton existe, à la valeur exacte) | 762 | 738 | **0** ✅ |
| dont laissées **sur ordre**, marquées dans le code | 162 | 162 | **240** |
| fichiers portant encore une couleur | 75 | 73 | **56** |

**Les 240 restantes ne sont pas un reste-à-faire.** Elles sont toutes laissées
délibérément, marquées `GYM-286` à côté de leur raison. `--reste` les ventile.

---

## 2. Les trois familles

| | famille | ce qui la définit | destination |
|---|---|---|---|
| 1 | **MARQUE** | doit suivre le thème de la salle | jeton résolu — `tokens.*` de `resolveTheme` |
| 2 | **SÉMANTIQUE** | 🔴 **ne suit JAMAIS la marque** | jeton fixe — `SEMANTIC.*`, créé par ce lot |
| 3 | **NEUTRE** | gris, surfaces, séparateurs, texte courant | jeton neutre, indépendant de la salle |

### 🔴 Pourquoi la famille 2 existe

Une salle ne fournit que deux couleurs, et rien ne l'empêche de choisir du rouge. Si le
rouge d'erreur suivait la marque, cette salle rendrait ses messages d'erreur
indiscernables du reste de son interface. Le rouge d'erreur n'est pas une couleur de
marque qu'on aurait oublié de rendre configurable : **c'est un signal, et un signal qui
change de sens d'un client à l'autre n'est plus un signal.** Même raisonnement pour le
vert de succès, l'orange d'alerte et les états désactivés.

Ces valeurs vivent désormais dans `lib/theme/semantic.ts`. Elles ne passent **ni** par la
marque, **ni** par le garde-fou de contraste.

### ⚠️ La famille 3, telle que le ticket la définit, n'existe pas encore

Le ticket attend « des jetons neutres Viniz, **indépendants de la salle** ». Ce n'est pas
ce que fait le résolveur du lot 3 : ses neutres sont **dérivés du fond de la salle**
(`surface` et `border` sont des voiles `rgba` posés sur `background`, `onBackgroundMuted`
bascule avec le mode). Ils bougent donc avec la salle.

Ce n'est pas un défaut — c'est ce qui garantit qu'une surface reste lisible sur n'importe
quel fond. Mais cela veut dire que **classer une valeur en NEUTRE ne change pas sa
destination, seulement sa justification** : elle va dans un jeton résolu comme les
autres. La distinction MARQUE/NEUTRE reste utile pour une raison précise : elle dit
quelles couleurs un gérant de salle **choisit** (deux), et quelles couleurs il ne fait
que **subir** (toutes les autres). Voir l'arbitrage **A-7**.

---

## 3. Le vocabulaire de jetons, et les quatre qui manquaient

### Ce que le lot 3 avait laissé

`ThemeTokens` comptait huit rôles ; `tailwind.config.js` en compte huit aussi — mais **ce
ne sont pas les mêmes huit**. Trois couleurs de Dopamine n'avaient aucun jeton, et deux
rôles de texte n'en avaient aucun non plus.

🔴 **La cause tient en une phrase : Dopamine n'est pas une app sombre.** C'est une app
**claire** (page `#F5F4F0`, cartes blanches) traversée de **bandes sombres** `#111111` en
en-tête. Le lot 3 a logé la bande dans `background` — le bon choix, c'est là que la
marque se voit — mais il ne restait alors aucun jeton pour la page, ni pour l'encre qu'on
y pose. Sans les quatre ajouts ci-dessous, migrer un écran obligeait à choisir entre deux
maux : réutiliser un jeton pour un rôle qui n'est pas le sien, ou laisser la couleur en dur.

| jeton ajouté | valeur Dopamine | remplace |
|---|---|---|
| `tokens.page` | `#F5F4F0` | `move-bg` — le fond de PAGE, distinct de la bande |
| `tokens.onSurface` | `#111111` | `move-dark` **dans son emploi de texte** |
| `tokens.onSurfaceSecondary` | `#6B6861` | `move-text-secondary` |
| `tokens.accentDim` | `#9DB800` | `move-accent-dim` |

En mode multi, aucun des quatre n'introduit de couleur nouvelle : chacun retombe sur un
jeton déjà validé par le garde-fou (`page = background`, `onSurface = onBackground`,
`onSurfaceSecondary = onBackgroundMuted`, `accentDim = accent`). C'est une **position
d'attente** — voir arbitrages **A-4** et **A-5**.

### 🔴 Les deux pièges de valeur identique

Ce sont les deux erreurs les plus faciles à commettre et les plus difficiles à voir, parce
qu'**elles ne produisent aucun défaut visible en mode single**.

**Piège 1 — `move-dark` sert DEUX rôles.**

| écriture | rôle | jeton | chez une salle |
|---|---|---|---|
| `bg-move-dark` | FOND de la bande | `tokens.background` | devient la couleur de la salle |
| `text-move-dark`, `color="#111111"` | ENCRE sur surface claire | `tokens.onSurface` | reste une encre lisible |

Migrer `text-move-dark` vers `background` écrirait le texte **dans la couleur du fond**.
Chez Dopamine les deux valent `#111111` : invisible. Chez le premier client : illisible.

**Piège 2 — `onAccent` n'est pas `onSurface`,** bien que tous deux vaillent `#111111`.
`onAccent` est l'encre choisie **pour la couleur d'action de la salle**. Une salle à
l'action sombre reçoit un `onAccent` clair — et un écran qui aurait confondu les deux
écrirait son texte **en blanc sur ses cartes blanches**.

### La table de correspondance, vérifiée mécaniquement

```bash
cd apps/mobile && node scripts/verify-theme-parity.mjs
```

Ce script compare `tailwind.config.js` (qui habille les classes encore en place) à
`DOPAMINE_THEME` (qui habille tout ce qui est migré) et **sort 1 au premier écart**. Tant
qu'une seule classe `move-*` subsiste, les deux coexistent dans la même app — souvent
dans le même écran — et doivent dire la même chose au caractère près.

| classe | jeton | valeur |
|---|---|---|
| `bg-move-dark` | `tokens.background` | `#111111` |
| `text-move-dark` | `tokens.onSurface` | `#111111` |
| `move-card` | `tokens.surface` | `#FFFFFF` |
| `move-bg` | `tokens.page` | `#F5F4F0` |
| `move-border` | `tokens.border` | `#E8E6E0` |
| `move-accent` | `tokens.accent` | `#C8F000` |
| `move-accent-dim` | `tokens.accentDim` | `#9DB800` |
| `move-text-secondary` | `tokens.onSurfaceSecondary` | `#6B6861` |
| `move-text-muted` | `tokens.onBackgroundMuted` | `#9A9890` |
| `#FFFFFF` (encre sur bande) | `tokens.onBackground` | `#FFFFFF` |
| `#111111` (encre sur action) | `tokens.onAccent` | `#111111` |

---

## 4. L'inventaire par fichier

**Régénérer :** `cd apps/mobile && node scripts/inventaire-couleurs.mjs --md`

Le **rôle** (fond / encre / bordure / ombre) est lu dans l'attribut qui porte la couleur,
pas dans la couleur elle-même : c'est ce qui permet à `#111111` d'être un fond de marque
sur une ligne et une encre neutre sur la suivante.

Répartition : **NEUTRE 491** (67,4 %) · **MARQUE 154** (21,2 %) · **À ARBITRER 45**
(6,2 %) · **SÉMANTIQUE 38** (5,2 %).

#### `app/(tabs)/studio.tsx` — 91 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #9A9890 | 19 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #FFFFFF — `bg-move-card` | 10 | fond | NEUTRE | `tokens.surface` |
| #E8E6E0 | 10 | bordure | NEUTRE | `tokens.border` |
| #6B6861 | 7 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #111111 — `bg-move-dark` | 7 | fond | MARQUE | `tokens.background` |
| #F5F4F0 — `bg-move-bg` | 5 | fond | NEUTRE | `tokens.page` |
| #111111 | 4 | encre | NEUTRE | `tokens.onSurface` |
| #FFFFFF | 4 | encre | NEUTRE | `tokens.onBackground` |
| #E8E6E0 | 3 | fond | NEUTRE | `tokens.border` |
| #C8F000 | 3 | encre | MARQUE | `tokens.accent` |
| #C8F000 | 2 | fond | MARQUE | `tokens.accent` |
| #C0DD97 | 2 | fond | À ARBITRER | — *(reste en dur)* |
| #97C459 | 2 | fond | À ARBITRER | — *(reste en dur)* |
| #3B6D11 | 2 | fond | À ARBITRER | — *(reste en dur)* |
| #141414 | 1 | fond | À ARBITRER | `tokens.background ?` |
| #333333 | 1 | fond | À ARBITRER | — *(reste en dur)* |
| #666666 | 1 | encre | À ARBITRER | — *(reste en dur)* |
| #888888 | 1 | encre | À ARBITRER | — *(reste en dur)* |
| #999999 | 1 | encre | À ARBITRER | — *(reste en dur)* |
| #E8E6E0 | 1 | encre | NEUTRE | `tokens.border` |
| #639922 | 1 | encre | À ARBITRER | `SEMANTIC.success ?` |
| #E53935 | 1 | encre | À ARBITRER | `SEMANTIC.danger ?` |
| #9DB800 | 1 | fond | À ARBITRER | `tokens.accentDim / SEMANTIC.success ?` |
| #F0EFEB | 1 | fond | À ARBITRER | `tokens.page ?` |
| #EF9F27 | 1 | encre | À ARBITRER | `SEMANTIC.warning ?` |

#### `app/profile/subscription.tsx` — 56 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #6B6861 — `text-move-text-secondary` | 11 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #9A9890 — `text-move-text-muted` | 9 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #111111 — `text-move-dark` | 9 | encre | NEUTRE | `tokens.onSurface` |
| #FFFFFF — `bg-move-card` | 6 | fond | NEUTRE | `tokens.surface` |
| #111111 — `bg-move-dark` | 5 | fond | MARQUE | `tokens.background` |
| #FFFFFF | 4 | encre | NEUTRE | `tokens.onBackground` |
| #E8E6E0 — `border-move-border` | 3 | bordure | NEUTRE | `tokens.border` |
| #C8F000 | 3 | encre | MARQUE | `tokens.accent` |
| #F97316 | 2 | encre | SÉMANTIQUE | `SEMANTIC.warning` |
| #C8F000 — `border-move-accent` | 2 | bordure | MARQUE | `tokens.accent` |
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #E8E6E0 — `bg-move-border` | 1 | fond | NEUTRE | `tokens.border` |

#### `app/profile/preferences.tsx` — 35 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 — `text-move-dark` | 7 | encre | NEUTRE | `tokens.onSurface` |
| #9A9890 — `text-move-text-muted` | 6 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #E8E6E0 — `border-move-border` | 4 | bordure | NEUTRE | `tokens.border` |
| #F5F4F0 — `bg-move-bg` | 3 | fond | NEUTRE | `tokens.page` |
| #FFFFFF — `bg-move-card` | 3 | fond | NEUTRE | `tokens.surface` |
| #C8F000 — `bg-move-accent` | 3 | fond | MARQUE | `tokens.accent` |
| #111111 — `bg-move-dark` | 2 | fond | MARQUE | `tokens.background` |
| #FFFFFF | 2 | encre | NEUTRE | `tokens.onBackground` |
| #E5E5E5 | 2 | fond | SÉMANTIQUE | `SEMANTIC.disabledTrack` |
| #25D366 | 1 | encre | SÉMANTIQUE | — *(reste en dur)* |
| #6B6861 — `text-move-text-secondary` | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #C8F000 — `border-move-accent` | 1 | bordure | MARQUE | `tokens.accent` |

#### `app/payment/success.tsx` — 26 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 | 6 | encre | NEUTRE | `tokens.onSurface` |
| #111111 — `bg-move-dark` | 5 | fond | MARQUE | `tokens.background` |
| #C8F000 | 4 | encre | MARQUE | `tokens.accent` |
| #FFFFFF | 3 | encre | NEUTRE | `tokens.onBackground` |
| #9A9890 — `text-move-text-muted` | 3 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #6B6861 — `text-move-text-secondary` | 2 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #C8F000 — `bg-move-accent` | 1 | fond | MARQUE | `tokens.accent` |
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #E8E6E0 — `border-move-border` | 1 | bordure | NEUTRE | `tokens.border` |

#### `app/profile/edit.tsx` — 23 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 — `bg-move-dark` | 3 | fond | MARQUE | `tokens.background` |
| #FFFFFF | 3 | encre | NEUTRE | `tokens.onBackground` |
| #FFFFFF — `bg-move-card` | 3 | fond | NEUTRE | `tokens.surface` |
| #C8F000 | 2 | encre | MARQUE | `tokens.accent` |
| #6B6861 — `text-move-text-secondary` | 2 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #4ECDC4 | 1 | fond | À ARBITRER | — *(reste en dur)* |
| #FF6B6B | 1 | fond | À ARBITRER | — *(reste en dur)* |
| #6C5CE7 | 1 | fond | À ARBITRER | — *(reste en dur)* |
| #FF8E53 | 1 | fond | À ARBITRER | — *(reste en dur)* |
| #A8E6CF | 1 | fond | À ARBITRER | — *(reste en dur)* |
| #B8B8FF | 1 | fond | À ARBITRER | — *(reste en dur)* |
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #C8F000 | 1 | fond | MARQUE | `tokens.accent` |
| #FFFFFF — `border-move-card` | 1 | bordure | NEUTRE | `tokens.onBackground` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |

#### `app/profile/payments.tsx` — 22 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #F5F4F0 — `bg-move-bg` | 4 | fond | NEUTRE | `tokens.page` |
| #9A9890 — `text-move-text-muted` | 3 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #111111 — `bg-move-dark` | 3 | fond | MARQUE | `tokens.background` |
| #111111 — `text-move-dark` | 3 | encre | NEUTRE | `tokens.onSurface` |
| #6B6861 — `text-move-text-secondary` | 3 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #FFFFFF | 2 | encre | NEUTRE | `tokens.onBackground` |
| #E5E5E0 | 1 | encre | À ARBITRER | `tokens.border ?` |
| #C8F000 | 1 | encre | MARQUE | `tokens.accent` |
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |
| #E8E6E0 — `border-move-border` | 1 | bordure | NEUTRE | `tokens.border` |

#### `app/dopamine/reset-password.tsx` — 20 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #C8F000 | 6 | encre | MARQUE | `tokens.accent` |
| #111111 — `bg-move-dark` | 4 | fond | MARQUE | `tokens.background` |
| #FFFFFF — `bg-move-card` | 3 | fond | NEUTRE | `tokens.surface` |
| #111111 — `text-move-dark` | 3 | encre | NEUTRE | `tokens.onSurface` |
| #6B6861 — `text-move-text-secondary` | 3 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |

#### `app/profile/delete-account.tsx` — 20 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #EF4444 | 3 | encre | SÉMANTIQUE | `SEMANTIC.danger` |
| #111111 — `text-move-dark` | 3 | encre | NEUTRE | `tokens.onSurface` |
| #FFFFFF | 3 | encre | NEUTRE | `tokens.onBackground` |
| #FFFFFF — `bg-move-card` | 3 | fond | NEUTRE | `tokens.surface` |
| #9A9890 — `text-move-text-muted` | 3 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #111111 — `bg-move-dark` | 2 | fond | MARQUE | `tokens.background` |
| #6B6861 | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #B45309 | 1 | encre | À ARBITRER | `SEMANTIC.warning ?` |

#### `app/session/[id].tsx` — 20 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #C8F000 | 4 | encre | MARQUE | `tokens.accent` |
| #9A9890 — `text-move-text-muted` | 3 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #FFFFFF — `bg-move-card` | 2 | fond | NEUTRE | `tokens.surface` |
| #6B6861 — `text-move-text-secondary` | 2 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #111111 — `text-move-dark` | 2 | encre | NEUTRE | `tokens.onSurface` |
| #111111 — `bg-move-dark` | 2 | fond | MARQUE | `tokens.background` |
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #E8E6E0 — `border-move-border` | 1 | bordure | NEUTRE | `tokens.border` |
| #EF4444 | 1 | encre | SÉMANTIQUE | `SEMANTIC.danger` |
| #F97316 | 1 | encre | SÉMANTIQUE | `SEMANTIC.warning` |
| #FFFFFF | 1 | encre | NEUTRE | `tokens.onBackground` |

#### `app/profile/export-data.tsx` — 18 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 — `bg-move-dark` | 3 | fond | MARQUE | `tokens.background` |
| #6B6861 — `text-move-text-secondary` | 3 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #9A9890 — `text-move-text-muted` | 3 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #FFFFFF | 2 | encre | NEUTRE | `tokens.onBackground` |
| #F5F4F0 — `bg-move-bg` | 2 | fond | NEUTRE | `tokens.page` |
| #E8E6E0 — `border-move-border` | 2 | bordure | NEUTRE | `tokens.border` |
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |
| #C8F000 | 1 | encre | MARQUE | `tokens.accent` |

#### `components/profile/ProfileHeader.tsx` — 18 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #C8F000 — `bg-move-accent` | 3 | fond | MARQUE | `tokens.accent` |
| #111111 — `text-move-dark` | 3 | encre | NEUTRE | `tokens.onSurface` |
| #6B6861 — `text-move-text-secondary` | 2 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #4ECDC4 | 1 | fond | À ARBITRER | — *(reste en dur)* |
| #FF6B6B | 1 | fond | À ARBITRER | — *(reste en dur)* |
| #6C5CE7 | 1 | fond | À ARBITRER | — *(reste en dur)* |
| #FF8E53 | 1 | fond | À ARBITRER | — *(reste en dur)* |
| #A8E6CF | 1 | fond | À ARBITRER | — *(reste en dur)* |
| #B8B8FF | 1 | fond | À ARBITRER | — *(reste en dur)* |
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |
| #FFFFFF | 1 | encre | NEUTRE | `tokens.onBackground` |
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |

#### `components/session/PaymentRequiredSheet.tsx` — 18 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 — `text-move-dark` | 5 | encre | NEUTRE | `tokens.onSurface` |
| #9A9890 — `text-move-text-muted` | 3 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #C8F000 — `text-move-accent` | 3 | encre | MARQUE | `tokens.accent` |
| #E8E6E0 — `border-move-border` | 2 | bordure | NEUTRE | `tokens.border` |
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |
| #C8F000 — `bg-move-accent` | 1 | fond | MARQUE | `tokens.accent` |
| #9DB800 | 1 | encre | À ARBITRER | `tokens.accentDim / SEMANTIC.success ?` |
| #6B6861 — `text-move-text-secondary` | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #111111 — `bg-move-dark` | 1 | fond | MARQUE | `tokens.background` |

#### `app/(tabs)/bookings.tsx` — 17 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #9A9890 — `text-move-text-muted` | 6 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #111111 — `bg-move-dark` | 3 | fond | MARQUE | `tokens.background` |
| #C8F000 — `text-move-accent` | 3 | encre | MARQUE | `tokens.accent` |
| #111111 — `text-move-dark` | 3 | encre | NEUTRE | `tokens.onSurface` |
| #FFFFFF | 1 | encre | NEUTRE | `tokens.onBackground` |
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |

#### `app/(tabs)/profile.tsx` — 14 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #E8E6E0 — `bg-move-border` | 7 | fond | NEUTRE | `tokens.border` |
| #FFFFFF | 3 | encre | NEUTRE | `tokens.onBackground` |
| #111111 — `bg-move-dark` | 2 | fond | MARQUE | `tokens.background` |
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #EF4444 | 1 | encre | SÉMANTIQUE | `SEMANTIC.danger` |

#### `components/schedule/FilterSheet.tsx` — 13 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #E8E6E0 — `border-move-border` | 2 | bordure | NEUTRE | `tokens.border` |
| #111111 — `bg-move-dark` | 2 | fond | MARQUE | `tokens.background` |
| #6B6861 — `text-move-text-secondary` | 2 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #9A9890 — `text-move-text-muted` | 2 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #C8F000 — `bg-move-accent` | 1 | fond | MARQUE | `tokens.accent` |
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #E8E6E0 — `bg-move-border` | 1 | fond | NEUTRE | `tokens.border` |
| #111111 | 1 | encre | NEUTRE | `tokens.onSurface` |
| #C8F000 — `text-move-accent` | 1 | encre | MARQUE | `tokens.accent` |

#### `components/profile/GamificationCard.tsx` — 12 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #C8F000 — `text-move-accent` | 3 | encre | MARQUE | `tokens.accent` |
| #111111 | 2 | fond | MARQUE | `tokens.background` |
| #C8F000 — `bg-move-accent` | 2 | fond | MARQUE | `tokens.accent` |
| #FFFFFF | 1 | encre | NEUTRE | `tokens.onBackground` |
| #333333 | 1 | fond | À ARBITRER | — *(reste en dur)* |
| #22C55E | 1 | encre | SÉMANTIQUE | `SEMANTIC.success` |
| #555555 | 1 | encre | À ARBITRER | — *(reste en dur)* |
| #111111 | 1 | encre | NEUTRE | `tokens.onSurface` |

#### `components/session/WeekSlots.tsx` — 12 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #9A9890 — `text-move-text-muted` | 3 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #E8E6E0 — `border-move-border` | 2 | bordure | NEUTRE | `tokens.border` |
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |
| #C8F000 — `border-move-accent` | 1 | bordure | MARQUE | `tokens.accent` |
| #C8F000 — `bg-move-accent` | 1 | fond | MARQUE | `tokens.accent` |
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #E8E6E0 — `bg-move-border` | 1 | fond | NEUTRE | `tokens.border` |
| #111111 | 1 | encre | NEUTRE | `tokens.onSurface` |
| #6B6861 — `text-move-text-secondary` | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |

#### `app/gym/select.tsx` — 11 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 — `text-move-dark` | 3 | encre | NEUTRE | `tokens.onSurface` |
| #9A9890 — `text-move-text-muted` | 3 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #E8E6E0 — `border-move-border` | 1 | bordure | NEUTRE | `tokens.border` |
| #111111 — `bg-move-dark` | 1 | fond | MARQUE | `tokens.background` |
| #C8F000 — `text-move-accent` | 1 | encre | MARQUE | `tokens.accent` |
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #6B6861 — `text-move-text-secondary` | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |

#### `app/(auth)/signup.tsx` — 10 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #6B6861 — `text-move-text-secondary` | 4 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #111111 — `text-move-dark` | 3 | encre | NEUTRE | `tokens.onSurface` |
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #111111 — `bg-move-dark` | 1 | fond | MARQUE | `tokens.background` |
| #E8E6E0 — `border-move-border` | 1 | bordure | NEUTRE | `tokens.border` |

#### `components/home/SessionCard.tsx` — 10 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #FFFFFF | 3 | encre | NEUTRE | `tokens.onBackground` |
| #EF4444 | 2 | encre | SÉMANTIQUE | `SEMANTIC.danger` |
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #111111 — `bg-move-dark` | 1 | fond | MARQUE | `tokens.background` |
| #C8F000 — `text-move-accent` | 1 | encre | MARQUE | `tokens.accent` |

#### `components/schedule/SlotListCard.tsx` — 10 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 — `text-move-dark` | 3 | encre | NEUTRE | `tokens.onSurface` |
| #9A9890 — `text-move-text-muted` | 3 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #EF4444 | 2 | encre | SÉMANTIQUE | `SEMANTIC.danger` |
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |
| #6B6861 — `text-move-text-secondary` | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |

#### `components/bookings/FavoriteCard.tsx` — 9 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #9A9890 — `text-move-text-muted` | 2 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #EF4444 | 2 | encre | SÉMANTIQUE | `SEMANTIC.danger` |
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |
| #111111 | 1 | encre | NEUTRE | `tokens.onSurface` |
| #6B6861 — `text-move-text-secondary` | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #111111 — `bg-move-dark` | 1 | fond | MARQUE | `tokens.background` |
| #C8F000 — `text-move-accent` | 1 | encre | MARQUE | `tokens.accent` |

#### `components/home/OpenGymCard.tsx` — 9 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #FFFFFF | 2 | encre | NEUTRE | `tokens.onBackground` |
| #C8F000 — `text-move-accent` | 2 | encre | MARQUE | `tokens.accent` |
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #111111 — `bg-move-dark` | 1 | fond | MARQUE | `tokens.background` |
| #E8E6E0 — `border-move-border` | 1 | bordure | NEUTRE | `tokens.border` |

#### `components/navigation/TabBar.tsx` — 9 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #000 | 2 | fond | NEUTRE | — *(reste en dur)* |
| #000 | 2 | ombre | NEUTRE | — *(reste en dur)* |
| #111111 | 1 | encre | NEUTRE | `tokens.onSurface` |
| #9A9890 | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #C8F000 | 1 | fond | MARQUE | `tokens.accent` |
| #FFFFFF | 1 | fond | NEUTRE | `tokens.surface` |
| #E8E6E0 | 1 | bordure | NEUTRE | `tokens.border` |

#### `components/schedule/FilterBar.tsx` — 9 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 — `bg-move-dark` | 2 | fond | MARQUE | `tokens.background` |
| #C8F000 — `text-move-accent` | 2 | encre | MARQUE | `tokens.accent` |
| #E8E6E0 — `border-move-border` | 1 | bordure | NEUTRE | `tokens.border` |
| #6B6861 | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |
| #C8F000 — `bg-move-accent` | 1 | fond | MARQUE | `tokens.accent` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |

#### `components/session/BookingModal.tsx` — 9 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #9A9890 — `text-move-text-muted` | 2 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |
| #F97316 | 1 | encre | SÉMANTIQUE | `SEMANTIC.warning` |
| #22C55E | 1 | encre | SÉMANTIQUE | `SEMANTIC.success` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |
| #6B6861 — `text-move-text-secondary` | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #111111 — `bg-move-dark` | 1 | fond | MARQUE | `tokens.background` |
| #C8F000 — `text-move-accent` | 1 | encre | MARQUE | `tokens.accent` |

#### `components/session/SessionInfo.tsx` — 9 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #6B6861 — `text-move-text-secondary` | 2 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #22C55E | 1 | encre | SÉMANTIQUE | `SEMANTIC.success` |
| #EF4444 | 1 | encre | SÉMANTIQUE | `SEMANTIC.danger` |
| #F97316 | 1 | encre | SÉMANTIQUE | `SEMANTIC.warning` |
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |
| #E8E6E0 — `bg-move-border` | 1 | fond | NEUTRE | `tokens.border` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |

#### `app/(auth)/forgot-password.tsx` — 8 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #6B6861 — `text-move-text-secondary` | 2 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #111111 — `bg-move-dark` | 1 | fond | MARQUE | `tokens.background` |
| #FFFFFF | 1 | encre | NEUTRE | `tokens.onBackground` |
| #C8F000 — `bg-move-accent` | 1 | fond | MARQUE | `tokens.accent` |
| #9DB800 | 1 | encre | À ARBITRER | `tokens.accentDim / SEMANTIC.success ?` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |

#### `app/(tabs)/index.tsx` — 8 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 — `bg-move-dark` | 2 | fond | MARQUE | `tokens.background` |
| #FFFFFF | 2 | encre | NEUTRE | `tokens.onBackground` |
| #F5F4F0 — `bg-move-bg` | 2 | fond | NEUTRE | `tokens.page` |
| #C8F000 | 1 | encre | MARQUE | `tokens.accent` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |

#### `components/bookings/HistoryCard.tsx` — 8 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #9A9890 — `text-move-text-muted` | 3 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #E8E6E0 — `bg-move-border` | 2 | fond | NEUTRE | `tokens.border` |
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |
| #6B6861 — `text-move-text-secondary` | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |

#### `components/legal/MarkdownText.tsx` — 8 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 — `text-move-dark` | 4 | encre | NEUTRE | `tokens.onSurface` |
| #6B6861 — `text-move-text-secondary` | 3 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |

#### `components/profile/ProfileListItem.tsx` — 8 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #9A9890 — `text-move-text-muted` | 2 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |
| #EF4444 | 1 | encre | SÉMANTIQUE | `SEMANTIC.danger` |
| #6B6861 | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #22C55E20 | 1 | fond | À ARBITRER | `SEMANTIC.success + alpha` |
| #FFFFFF | 1 | encre | NEUTRE | `tokens.onBackground` |
| #22C55E | 1 | encre | SÉMANTIQUE | `SEMANTIC.success` |

#### `components/schedule/OpenGymListCard.tsx` — 8 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 — `text-move-dark` | 3 | encre | NEUTRE | `tokens.onSurface` |
| #9A9890 — `text-move-text-muted` | 2 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |
| #6B6861 — `text-move-text-secondary` | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #E8E6E0 — `border-move-border` | 1 | bordure | NEUTRE | `tokens.border` |

#### `app/(auth)/verify-email.tsx` — 7 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #C8F000 — `bg-move-accent` | 1 | fond | MARQUE | `tokens.accent` |
| #C8F000 | 1 | encre | MARQUE | `tokens.accent` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |
| #6B6861 — `text-move-text-secondary` | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #9DB800 — `text-move-accent-dim` | 1 | encre | À ARBITRER | `tokens.accentDim / SEMANTIC.success ?` |

#### `components/legal/LegalScreen.tsx` — 7 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 — `bg-move-dark` | 2 | fond | MARQUE | `tokens.background` |
| #FFFFFF | 2 | encre | NEUTRE | `tokens.onBackground` |
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #E8E6E0 — `border-move-border` | 1 | bordure | NEUTRE | `tokens.border` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |

#### `components/session/MaxBookingsModal.tsx` — 7 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |
| #F97316 | 1 | encre | SÉMANTIQUE | `SEMANTIC.warning` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |
| #6B6861 — `text-move-text-secondary` | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #111111 — `bg-move-dark` | 1 | fond | MARQUE | `tokens.background` |
| #C8F000 — `text-move-accent` | 1 | encre | MARQUE | `tokens.accent` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |

#### `components/session/SuspensionModal.tsx` — 7 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |
| #EF4444 | 1 | encre | SÉMANTIQUE | `SEMANTIC.danger` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |
| #6B6861 — `text-move-text-secondary` | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #111111 — `bg-move-dark` | 1 | fond | MARQUE | `tokens.background` |
| #C8F000 — `text-move-accent` | 1 | encre | MARQUE | `tokens.accent` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |

#### `components/schedule/EmptySchedule.tsx` — 6 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #9A9890 — `text-move-text-muted` | 2 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #E8E6E0 — `bg-move-border` | 1 | fond | NEUTRE | `tokens.border` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |
| #111111 — `bg-move-dark` | 1 | fond | MARQUE | `tokens.background` |
| #C8F000 — `text-move-accent` | 1 | encre | MARQUE | `tokens.accent` |

#### `components/session/SessionHero.tsx` — 6 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #FFFFFF | 4 | encre | NEUTRE | `tokens.onBackground` |
| #EF4444 | 2 | encre | SÉMANTIQUE | `SEMANTIC.danger` |

#### `components/ui/PasswordInput.tsx` — 6 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #9A9890 | 3 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #111111 — `text-move-dark` | 2 | encre | NEUTRE | `tokens.onSurface` |
| #E8E6E0 — `border-move-border` | 1 | bordure | NEUTRE | `tokens.border` |

#### `app/(auth)/login.tsx` — 5 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #111111 — `bg-move-dark` | 1 | fond | MARQUE | `tokens.background` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #6B6861 — `text-move-text-secondary` | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |

#### `app/(tabs)/schedule.tsx` — 5 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 — `bg-move-dark` | 2 | fond | MARQUE | `tokens.background` |
| #FFFFFF | 1 | encre | NEUTRE | `tokens.onBackground` |
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #C8F000 | 1 | encre | MARQUE | `tokens.accent` |

#### `app/payment/cancel.tsx` — 5 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #111111 | 1 | encre | NEUTRE | `tokens.onSurface` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #111111 — `bg-move-dark` | 1 | fond | MARQUE | `tokens.background` |
| #C8F000 | 1 | encre | MARQUE | `tokens.accent` |

#### `components/auth/OAuthButtons.tsx` — 5 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #E8E6E0 — `bg-move-border` | 2 | fond | NEUTRE | `tokens.border` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #E8E6E0 — `border-move-border` | 1 | bordure | NEUTRE | `tokens.border` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |

#### `components/bookings/UpcomingCard.tsx` — 5 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 — `bg-move-dark` | 1 | fond | MARQUE | `tokens.background` |
| #FFFFFF | 1 | encre | NEUTRE | `tokens.onBackground` |
| #C8F000 — `text-move-accent` | 1 | encre | MARQUE | `tokens.accent` |
| #C8F000 — `bg-move-accent` | 1 | fond | MARQUE | `tokens.accent` |
| #111111 | 1 | encre | NEUTRE | `tokens.onSurface` |

#### `components/ui/Button.tsx` — 5 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #C8F000 — `text-move-accent` | 2 | encre | MARQUE | `tokens.accent` |
| #111111 — `bg-move-dark` | 1 | fond | MARQUE | `tokens.background` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #FFFFFF | 1 | encre | NEUTRE | `tokens.onBackground` |

#### `components/ui/PasswordStrength.tsx` — 5 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #EF4444 | 1 | fond | SÉMANTIQUE | `SEMANTIC.danger` |
| #F59E0B | 1 | fond | À ARBITRER | `SEMANTIC.warning ?` |
| #9DB800 | 1 | fond | À ARBITRER | `tokens.accentDim / SEMANTIC.success ?` |
| #9DB800 — `text-move-accent-dim` | 1 | encre | À ARBITRER | `tokens.accentDim / SEMANTIC.success ?` |
| #E8E6E0 | 1 | fond | NEUTRE | `tokens.border` |

#### `components/ui/TextInput.tsx` — 5 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 — `text-move-dark` | 2 | encre | NEUTRE | `tokens.onSurface` |
| #9A9890 — `text-move-text-muted` | 2 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #E8E6E0 — `border-move-border` | 1 | bordure | NEUTRE | `tokens.border` |

#### `components/auth/GoogleLogo.tsx` — 4 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #4285F4 | 1 | encre | SÉMANTIQUE | — *(reste en dur)* |
| #34A853 | 1 | encre | SÉMANTIQUE | — *(reste en dur)* |
| #FBBC05 | 1 | encre | SÉMANTIQUE | — *(reste en dur)* |
| #EA4335 | 1 | encre | SÉMANTIQUE | — *(reste en dur)* |

#### `components/bookings/BookingTabs.tsx` — 4 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #C8F000 — `bg-move-accent` | 1 | fond | MARQUE | `tokens.accent` |
| #E8E6E0 — `border-move-border` | 1 | bordure | NEUTRE | `tokens.border` |
| #111111 | 1 | fond | MARQUE | `tokens.background` |
| #6B6861 — `text-move-text-secondary` | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |

#### `components/home/EmptyDayState.tsx` — 4 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #9A9890 — `text-move-text-muted` | 2 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #E8E6E0 — `bg-move-border` | 1 | fond | NEUTRE | `tokens.border` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |

#### `components/profile/SignOutModal.tsx` — 4 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |
| #EF4444 | 1 | encre | SÉMANTIQUE | `SEMANTIC.danger` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |
| #6B6861 — `text-move-text-secondary` | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |

#### `components/profile/StatsRow.tsx` — 4 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #9A9890 — `text-move-text-muted` | 2 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #111111 | 1 | encre | NEUTRE | `tokens.onSurface` |

#### `components/session/CancelModal.tsx` — 4 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |
| #EF4444 | 1 | encre | SÉMANTIQUE | `SEMANTIC.danger` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |
| #6B6861 — `text-move-text-secondary` | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |

#### `components/session/SessionDescription.tsx` — 4 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #6B6861 — `text-move-text-secondary` | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |
| #9DB800 — `text-move-accent-dim` | 1 | encre | À ARBITRER | `tokens.accentDim / SEMANTIC.success ?` |

#### `components/ui/Checkbox.tsx` — 4 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #C8F000 — `border-move-accent` | 1 | bordure | MARQUE | `tokens.accent` |
| #C8F000 — `bg-move-accent` | 1 | fond | MARQUE | `tokens.accent` |
| #E8E6E0 — `border-move-border` | 1 | bordure | NEUTRE | `tokens.border` |
| #111111 | 1 | encre | NEUTRE | `tokens.onSurface` |

#### `components/ui/PasswordRules.tsx` — 4 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #9DB800 — `text-move-accent-dim` | 2 | encre | À ARBITRER | `tokens.accentDim / SEMANTIC.success ?` |
| #C9C7C0 | 1 | encre | SÉMANTIQUE | `SEMANTIC.disabledInk` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |

#### `app/+not-found.tsx` — 3 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #111111 — `text-move-dark` | 1 | encre | NEUTRE | `tokens.onSurface` |
| #9DB800 — `text-move-accent-dim` | 1 | encre | À ARBITRER | `tokens.accentDim / SEMANTIC.success ?` |

#### `components/home/DayTabs.tsx` — 3 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 — `bg-move-dark` | 1 | fond | MARQUE | `tokens.background` |
| #E8E6E0 — `border-move-border` | 1 | bordure | NEUTRE | `tokens.border` |
| #6B6861 — `text-move-text-secondary` | 1 | encre | NEUTRE | `tokens.onSurfaceSecondary` |

#### `components/schedule/Skeleton.tsx` — 3 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #E8E6E0 — `bg-move-border` | 3 | fond | NEUTRE | `tokens.border` |

#### `components/shared/WaitlistCountdown.tsx` — 3 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #DC2626 | 1 | encre | À ARBITRER | `SEMANTIC.danger ?` |
| #EA580C | 1 | encre | À ARBITRER | `SEMANTIC.warning ?` |
| #F97316 | 1 | encre | SÉMANTIQUE | `SEMANTIC.warning` |

#### `app/dopamine/confirm-waitlist.tsx` — 2 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #C8F000 | 1 | encre | MARQUE | `tokens.accent` |

#### `app/dopamine/payment-success.tsx` — 2 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #111111 | 1 | encre | NEUTRE | `tokens.onSurface` |

#### `app/index.tsx` — 2 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #000000 | 1 | fond | NEUTRE | — *(reste en dur)* |
| #C8F000 | 1 | fond | MARQUE | `tokens.accent` |

#### `components/profile/ProfileSection.tsx` — 2 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |
| #FFFFFF — `bg-move-card` | 1 | fond | NEUTRE | `tokens.surface` |

#### `components/schedule/SectionHeader.tsx` — 2 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #F5F4F0 — `bg-move-bg` | 1 | fond | NEUTRE | `tokens.page` |
| #9A9890 — `text-move-text-muted` | 1 | encre | NEUTRE | `tokens.onBackgroundMuted` |

#### `components/shared/ActivityImage.tsx` — 2 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 | 1 | fond | MARQUE | `tokens.background` |
| #6B6861 | 1 | fond | NEUTRE | `tokens.onSurfaceSecondary` |

#### `components/ui/InScreenBanner.tsx` — 2 occurrences

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 — `bg-move-dark` | 1 | fond | MARQUE | `tokens.background` |
| #FFFFFF | 1 | encre | NEUTRE | `tokens.onBackground` |

#### `app/(auth)/_layout.tsx` — 1 occurrence

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #F5F4F0 | 1 | fond | NEUTRE | `tokens.page` |

#### `app/_layout.tsx` — 1 occurrence

| valeur | ×  | rôle | famille | jeton cible |
|---|---|---|---|---|
| #111111 | 1 | fond | MARQUE | `tokens.background` |

---

## 5. À ARBITRER — le cockpit tranche avant GYM-286b

45 occurrences ne sont pas classées ici — **A-1** 10 · **A-2** 6 · **A-6** 9 · **A-7** 12 ·
**A-8** 7 · **A-10** 1 (A-3, A-4 et A-5 sont des décisions de design, sans occurrence propre). **Ce n'est pas un inventaire incomplet : c'est un
inventaire qui s'arrête où commence une décision de charte.** Chaque ligne porte une
recommandation ; aucune n'est appliquée.

### A-1 · `#9DB800` (`move-accent-dim`) — marque, ou signal de succès ? — 10 occurrences

C'est l'ambiguïté la plus coûteuse du lot. La couleur est un lime atténué — donc de la
famille marque par construction. Mais **quatre de ses cinq emplois en classe sont des
succès** :

| emploi | fichier | ce que la couleur dit |
|---|---|---|
| règle de mot de passe satisfaite | `components/ui/PasswordRules.tsx` | ✅ succès |
| force « strong » | `components/ui/PasswordStrength.tsx` | ✅ succès |
| e-mail de réinitialisation envoyé | `app/(auth)/forgot-password.tsx` | ✅ succès |
| renvoi redevenu possible | `app/(auth)/verify-email.tsx` | ✅ succès |
| moyen de paiement | `components/session/PaymentRequiredSheet.tsx` | neutre |
| affluence récente | `app/(tabs)/studio.tsx` | marque (rampe) |

> **Recommandation : scinder.** Les quatre succès vont à `SEMANTIC.success`, le reste à
> `tokens.accentDim`. Motif : chez une salle rouge, un mot de passe fort s'afficherait
> aujourd'hui **en rouge** — le membre lirait un échec là où il y a une réussite.
> ⚠️ Scinder **change des pixels** (`#9DB800` → `#22C55E`) : c'est une régression
> volontaire, elle doit être décidée, pas glissée dans une migration.

### A-2 · Trois rouges, trois orangés, deux ambres — fusionner ? — 6 occurrences

Rouges `#EF4444` (19×, **dominant**) · `#DC2626` · `#E53935`.
Orangés `#F97316` (7×, **dominant**) · `#EA580C` · `#EF9F27`.
Ambres `#F59E0B` · `#B45309`.

*(`#FF6B6B` ressemble à un quatrième rouge mais n'apparaît que dans la palette d'avatars :
il relève de **A-7**, pas d'un signal.)*

`lib/theme/semantic.ts` ne retient que les **valeurs dominantes** (`danger #EF4444`,
`warning #F97316`, `success #22C55E`). Les autres restent en dur.

> **Recommandation : fusionner, dans un lot séparé de 286b.** Réduire à un rouge est un
> progrès de charte — et un changement de pixels sur des écrans que 286b n'a pas mandat
> de retoucher. Mélanger les deux rendrait toute régression indémêlable d'une
> harmonisation voulue.
>
> 🔴 **Règle absolue pour 286b, en attendant :** un littéral qui n'est pas **exactement**
> la valeur d'un jeton **ne se migre pas**. Approcher `#DC2626` par `SEMANTIC.danger`
> (`#EF4444`) est précisément la régression d'un pixel que le lot interdit — et la plus
> difficile à voir en relecture.

### A-3 · Le bouton primaire partagé — 🔴 le plus structurant

`components/ui/Button.tsx`, variante `primary` : `bg-move-dark` + `text-move-accent`.
C'est un bouton **sombre à libellé lime**. Le couple `(accent, onAccent)` du thème dit
l'inverse : **fond de marque, encre lisible dessus**.

Traduire mécaniquement `bg-move-dark → tokens.accent` **retournerait le bouton primaire de
toute l'app**. Traduire `bg-move-dark → tokens.background` le garderait sombre, mais alors
le bouton prendrait la couleur de la salle en fond avec un libellé lime en dur — illisible
chez une salle claire.

> **Recommandation : traiter `Button.tsx` comme une décision de design à part entière,
> avant tout écran.** La question posée au cockpit est : *chez une salle, le bouton
> primaire est-il (a) fond `accent` / encre `onAccent`, ou (b) fond `background` / encre
> `accent` ?* La maquette Viniz dit (a) (« Action = Neon Lime par défaut ») ; Dopamine
> fait (b). L'un des deux doit céder, et ce n'est pas à une migration de le décider.

### A-4 · La bande d'en-tête chez une salle — 0 occurrence, effet sur tous les écrans

Aujourd'hui `page === background` en mode multi : un écran migré rend **à plat**, sans la
bande d'en-tête qui structure tous les écrans de Dopamine.

> **Recommandation : dériver une bande.** Par exemple `background` éclairci ou assombri
> d'un pas fixe, repassé au garde-fou. Non fait ici : c'est une couleur de plus à
> vérifier, et la décider dans un lot d'inventaire serait la faire passer en contrebande.

### A-5 · `accentDim` chez une salle — 0 occurrence

`accentDim = accent` en multi : aucune variante atténuée.

> **Recommandation : dérivation réelle** (l'action à ~75 % de luminosité, revalidée à
> 4,5:1), le jour où A-1 aura dit ce qui reste vraiment dans ce jeton.

### A-6 · Les huit gris hors palette — 9 occurrences

`#141414` `#333333` `#555555` `#666666` `#888888` `#999999` `#E5E5E0` `#F0EFEB`
— tous à un ou deux crans d'un jeton existant (`#141414` vs `move-dark #111111` ;
`#E5E5E0` vs `move-border #E8E6E0` ; `#F0EFEB` vs `move-bg #F5F4F0`). Six des huit valeurs sont
dans `app/(tabs)/studio.tsx` ; `#333333` y est **et** dans `GamificationCard.tsx`.

> **Recommandation : rattacher, en l'assumant comme un changement visuel.** L'écart est
> imperceptible mais réel ; l'alternative est de figer huit gris de plus pour toujours.

### A-7 · Palette d'avatars — 12 occurrences

`#4ECDC4` `#FF6B6B` `#6C5CE7` `#FF8E53` `#A8E6CF` `#B8B8FF`, dupliquée à l'identique dans
`app/profile/edit.tsx` et `components/profile/ProfileHeader.tsx`.

> **Recommandation : palette Viniz fixe, partagée, hors thème** — c'est le cas d'usage qui
> justifierait le module « neutres indépendants de la salle » que le § 2 dit manquant.
> Motif : la couleur identifie **le membre**, pas la salle. Elle doit rester la même quand
> il change de salle, et ne doit jamais se confondre avec la couleur de la salle courante.
> ⚠️ La duplication entre les deux fichiers est un défaut à part entière : deux listes qui
> doivent rester identiques et que rien n'oblige à l'être.

### A-8 · Rampe d'affluence du studio — 7 occurrences

`#C0DD97` / `#97C459` / `#3B6D11` : trois verts d'intensité croissante (2× chacun), plus
`#639922` (variation positive). La variation négative, `#E53935`, est comptée en **A-2**.

> **Recommandation : dériver de `accent`.** C'est une lecture de donnée, pas un signal :
> elle peut suivre la marque sans rien perdre de son sens, contrairement à un message
> d'erreur. Mais la dérivation doit garantir trois paliers distinguables sur **n'importe
> quelle** primaire, ce qui est un vrai travail — pas un remplacement.

### A-9 · Marques tierces — 5 occurrences, classées SÉMANTIQUE

`#4285F4` `#34A853` `#FBBC05` `#EA4335` (logo Google officiel) et `#25D366` (WhatsApp).

> **Recommandation : aucun jeton. Elles restent en dur, et c'est délibéré.** Elles
> partagent avec la famille sémantique la propriété qui compte — ne jamais suivre la
> marque — mais leur donner un nom de jeton inviterait un jour quelqu'un à les thématiser.
> Le logo Google a une charte d'usage ; le vert WhatsApp identifie WhatsApp.
> **À faire en 286b :** un commentaire sur chacune disant qu'elle est intouchable, sans
> quoi elles ressembleront à des oublis dans un fichier par ailleurs entièrement migré.

### A-10 · `#22C55E20` — 1 occurrence

Un succès à 12,5 % d'alpha (`components/profile/ProfileListItem.tsx`).

> **Recommandation :** `SEMANTIC.success` + opacité explicite, plutôt qu'un jeton de plus.

---

## 6. L'écran pilote

### Les trois candidats

| écran | classes + hex | pourquoi | retenu |
|---|---|---|---|
| `app/profile/security.tsx` | 14 + 10 | porte les **trois familles** ; emploie les **huit** couleurs de `tailwind.config.js` ; **aucune** classe de palette Tailwind ni `white`/`black` — donc entièrement migrable dans ses propres limites | ✅ |
| `app/profile/delete-account.tsx` | 12 + 8 | bonne couverture sémantique (`#EF4444`, `#B45309`) mais **aucun** cas de désactivation, et un parcours que peu de membres voient | non |
| `app/(tabs)/bookings.tsx` | 11 + 6 | onglet principal, très visible — mais **aucune** couleur sémantique : le pilote n'aurait rien prouvé sur la famille 2, la plus délicate | non |

### Pourquoi `security.tsx`

Un pilote doit **rencontrer les difficultés**, pas les éviter. Celui-ci porte les trois
familles sur un seul composant — l'interrupteur de biométrie :

| couleur | rôle | famille | devient |
|---|---|---|---|
| `#C8F000` | piste allumée | **MARQUE** | `tokens.accent` |
| `#E5E5E5` | piste éteinte | **SÉMANTIQUE** | `SEMANTIC.disabledTrack` |
| `#111111` | bouton allumé | **MARQUE** | `tokens.onAccent` |
| `#FFFFFF` | bouton éteint | **NEUTRE** | `tokens.surface` |

🔴 **La piste éteinte est la seule qui ne bouge pas.** Si elle suivait la marque, une
salle au gris clair rendrait « activé » et « désactivé » indiscernables : le membre ne
saurait plus si sa biométrie est en service. **Un réglage dont on ne lit plus l'état est
pire qu'un réglage laid** — c'est la raison d'être de la famille sémantique, sur un cas
qu'on peut montrer.

L'écran porte aussi les deux pièges du § 3 : `bg-move-dark` (bande) et `text-move-dark`
(encre) y coexistent, et `onAccent` y côtoie `onSurface`.

### Non-régression : la preuve

```bash
cd apps/mobile && node scripts/verify-screen-parity.mjs app/profile/security.tsx
```

Le script rejoue les deux versions du fichier — `develop` et le travail en cours — en
résolvant chaque jeton par sa valeur Dopamine, puis compare les deux **suites de
couleurs, position par position**.

> `couleurs avant : 24 | jetons après : 24` — **24/24 identiques, dans le même ordre.**

C'est ce qui manquait à la relecture : un diff peut être impeccable et désigner la
mauvaise couleur. `tokens.background` à la place de `tokens.page` se relit très bien et
peint l'écran entier en noir.

| vérification | résultat |
|---|---|
| `npx tsc --noEmit` | **0 erreur** |
| `EXPO_NO_DOTENV=1 npx expo config --json` vs `develop` | **diff nul** |
| `node scripts/verify-theme-parity.mjs` | 11/11 jetons concordants |
| `node scripts/verify-screen-parity.mjs app/profile/security.tsx` | 24/24 couleurs identiques |

Aucune build EAS, aucun déploiement.

### 🔴 Ce que le pilote ne migre pas, et pourquoi c'est le résultat le plus important

`<Button/>`, `<PasswordInput/>` et `<PasswordRules/>` gardent leurs couleurs en dur. Ce ne
sont pas des oublis : ce sont d'**autres fichiers**, partagés par des dizaines d'écrans.
Les migrer depuis un écran ferait de ce lot un changement à l'échelle de l'app, sans
qu'aucun écran ne puisse plus servir de témoin.

**L'ordre que cela impose à GYM-286b :** `components/ui/*` **d'abord**, les écrans
ensuite. Un écran migré au-dessus de composants qui ne le sont pas reste, en mode multi,
à moitié aux couleurs de Dopamine — **et cela ne se voit sur aucune capture prise en mode
single.**

---

## Méthode — migrer un fichier (mode d'emploi pour GYM-286b)

### Ordre des lots

1. **`components/ui/*`** — les briques partagées. ⚠️ `Button.tsx` est bloqué par
   l'arbitrage **A-3** : ne pas le migrer avant la réponse du cockpit.
2. **`components/<domaine>/*`** — cartes, modales, listes.
3. **Les écrans `app/**`** — du plus simple au plus fourni. Garder
   `app/(tabs)/studio.tsx` (91 occurrences, six gris hors palette) **pour la fin** : il
   dépend de A-6 et A-8.

### Les huit étapes, pour un fichier

**1. Lister ce que le fichier porte.**
```bash
cd apps/mobile
node scripts/inventaire-couleurs.mjs --md \
  | awk -v f='app/profile/payments.tsx' 'index($0,f){p=1} p&&/^####/&&!index($0,f){exit} p'
```

**2. Vérifier qu'aucune ligne n'est bloquée par un arbitrage** (§ 5). Si oui : migrer tout
le reste, laisser cette ligne en dur avec un commentaire `// GYM-286 — A-n, en attente`.
Ne pas décider à la place du cockpit, ne pas non plus bloquer le fichier entier.

**3. Ajouter le crochet.**
```ts
import { useTheme } from '../../lib/theme/ThemeProvider'
// et, seulement si le fichier porte un signal :
import { SEMANTIC } from '../../lib/theme/semantic'
```
```ts
const { tokens } = useTheme()
```
⚠️ **Chaque composant du fichier a besoin du sien.** Un sous-composant déclaré dans le
même fichier ne voit pas le `tokens` de son parent.

**4. Remplacer, en distinguant le rôle et non la couleur.** La couleur passe de
`className` à `style` ; **tout le reste de la classe demeure.**
```diff
- <View className="rounded-2xl bg-move-card p-4">
+ <View className="rounded-2xl p-4" style={{ backgroundColor: tokens.surface }}>

- <Text className="font-dmsans-bold text-base text-move-dark">
+ <Text className="font-dmsans-bold text-base" style={{ color: tokens.onSurface }}>

- <ChevronLeft size={24} color="#FFFFFF" />
+ <ChevronLeft size={24} color={tokens.onBackground} />
```
🔴 **Se poser la question du rôle à chaque `move-dark` et à chaque `#111111`** : fond de
bande (`background`) ou encre sur clair (`onSurface`) ? Voir § 3, piège 1.

**5. Vérifier que le fichier ne porte plus de couleur.**
```bash
PAL='(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)'
grep -nE "move-[a-z-]+|#[0-9a-fA-F]{3,8}\b|(bg|text|border|fill|ring)-$PAL-[0-9]{2,3}|(bg|text|border|fill)-(white|black)|rgba?\(" <fichier>
```
Tout ce qui subsiste doit être **dans un commentaire**, ou **justifié** (marque tierce,
arbitrage en attente).

**6. Prouver la non-régression.**
```bash
node scripts/verify-screen-parity.mjs <fichier>
```
Doit rendre `n/n identiques, dans le même ordre`. **Une longueur différente signale
presque toujours un jeton oublié.**

**7. Vérifier le reste.**
```bash
npx tsc --noEmit                                   # → 0
node scripts/verify-theme-parity.mjs               # → 11/11
EXPO_NO_DOTENV=1 npx expo config --json            # → diff nul vs develop
```

**8. Mesurer ce qui reste.** `node scripts/inventaire-couleurs.mjs` — le total doit avoir
baissé du nombre exact d'occurrences du fichier.

### 🔴 Les six pièges rencontrés sur le pilote

**P-1 · Un commentaire JSX qui cite une couleur est compté comme du code.**
Rencontré immédiatement : le pilote, une fois migré, « contenait » encore huit couleurs
en dur qu'il n'affiche nulle part, et la vérification de parité a signalé **8 faux
écarts**. Les deux scripts vident désormais `{/* … */}` avant de compter — mais un `grep`
à la main, lui, ne le fait pas. **Ne pas conclure d'un `grep` seul qu'un fichier n'est pas
migré.**

**P-2 · Un commentaire JSX ne peut pas précéder l'élément racine d'un `return`.**
`return ( {/* … */} <View>… )` est deux éléments frères : `tsc` rend
« JSX expressions must have one parent element ». Mettre le commentaire **avant** le
`return`, en `//`.

**P-3 · `border` est une largeur, pas une couleur.**
`className="border border-move-border"` → seul `border-move-border` s'en va. Retirer les
deux **efface le trait**, et rien ne le signale.

**P-4 · Le remplacement d'une classe par un `style` laisse facilement une accolade.**
`style={{ backgroundColor: tokens.page }` a produit 31 erreurs `tsc` sur une seule ligne.
Peu grave — `tsc` l'attrape — mais lancer `tsc` **après chaque fichier**, pas après dix.

**P-5 · La `SafeAreaView` porte la couleur de la bande, pas celle de la page.**
C'est ce qui fait que l'encoche prolonge l'en-tête. Y mettre `page` ouvre une bande claire
au-dessus d'un en-tête sombre — visible seulement sur un appareil à encoche.

**P-6 · Deux jetons de même valeur ne sont pas interchangeables.**
`onAccent` et `onSurface` valent tous deux `#111111` chez Dopamine. Aucun test en mode
single ne peut distinguer une confusion entre les deux : c'est
`verify-screen-parity.mjs` qui la rend visible, parce qu'il compare des **suites**, et
`verify-theme-parity.mjs` qui garantit que les valeurs elles-mêmes n'ont pas dérivé.

### 🔴 Les pièges découverts pendant GYM-286b

Les six premiers venaient du pilote. Ceux-ci viennent des 74 fichiers suivants, et ils
partagent tous une même racine : **une couleur ne doit pas CHANGER DE PLACE dans le
fichier, seulement changer de nature.** `verify-screen-parity` compare des *suites* ; tout
ce qui déplace une couleur produit un faux rouge — et un faux rouge finit par se contourner
de tête, ce qui rend le garde-fou inutile.

**P-7 · P-2 était trop étroit : `{/* … */}` est invalide dans TOUT contexte d'expression.**
Pas seulement avant la racine d'un `return`, mais aussi après `&& (`, `? (` et `: (`.
Rencontré **six fois**. `tsc` ne dit jamais « commentaire mal placé » : il dit
« JSX elements cannot have multiple attributes with the same name » ou « ')' expected »,
vingt lignes plus bas. Un balayage mécanique traite le cas :

```bash
# convertit tout {/* … */} mal placé en //  — à relancer après chaque lot
python3 - <<'EOF'
import io,re,os
for root,_,files in os.walk('.'):
    if 'node_modules' in root or '/viniz' in root: continue
    if not (root.startswith('./app') or root.startswith('./components')): continue
    for fn in [f for f in files if f.endswith('.tsx')]:
        p=os.path.join(root,fn); lines=io.open(p,encoding='utf-8').read().split('\n')
        out=[];changed=False;i=0
        while i<len(lines):
            l=lines[i]; prev=out[-1] if out else ''
            if re.search(r'(\&\&|\?|:|return)\s*\($', prev.rstrip()) and re.match(r'^\s*\{/\*', l):
                bloc=[];j=i
                while j<len(lines):
                    bloc.append(lines[j])
                    if '*/}' in lines[j]: break
                    j+=1
                ind=re.match(r'^(\s*)',bloc[0]).group(1)
                for bl in '\n'.join(bloc).replace('{/*','').replace('*/}','').split('\n'):
                    out.append((ind+'// '+bl.strip()).rstrip())
                changed=True;i=j+1;continue
            out.append(l);i+=1
        if changed: io.open(p,'w',encoding='utf-8').write('\n'.join(out))
EOF
```

**P-8 · Un élément peut DÉJÀ porter un `style`.**
`<Pressable style={({pressed}) => …}>` en avait un, fonctionnel ; la `View` d'un pied
collant aussi. En ajouter un second produit deux attributs de même nom, que React résout
silencieusement en gardant le dernier. `tsc` l'attrape ici ; sur un composant moins typé,
il ne l'attraperait pas. **Fusionner, ne jamais juxtaposer.**

**P-9 · L'ordre des attributs JSX compte — `style` avant `className` quand il le faut.**
Quand un ternaire a une branche migrée et une branche laissée en dur, la migrée part dans
`style` et l'autre reste dans `className`. Si la branche laissée précédait la migrée dans
la chaîne d'origine, écrire `className` d'abord **inverse les deux couleurs**. Rien ne
change au rendu ; tout change à la preuve. Rencontré sur `verify-email.tsx` et
`subscription.tsx`.

**P-10 · Trois façons de déplacer une couleur sans le vouloir.**

| ce qu'on fait | ce que ça déplace | ce qu'il faut faire |
|---|---|---|
| hisser un littéral dans une constante nommée | 1 déclaration ← N emplois | soit le répéter, soit résoudre les constantes (le script le fait) |
| descendre une constante de module dans le composant | la couleur descend avec | une **fabrique** `makeStyles(tokens)`, laissée à la place de la constante |
| passer une couleur en paramètre à une fonction externe | 1 déclaration → N appels | **refermer la fonction sur `tokens`** (la déclarer dans le composant) |

**P-11 · Une classe `move-*` peut porter un alpha.**
`bg-move-accent/15`, `bg-move-border/30`… : **15 occurrences**, comptées comme la couleur
PLEINE par l'inventaire de 286a, donc comme migrables. Migrées, elles auraient rempli à
100 % des fonds prévus à 5, 10, 15, 30 ou 50 % — la seule régression que l'outillage
aurait **activement recommandée**. Même règle que pour la palette Tailwind : l'alpha exclut
du migrable, et ce qui ne se migre pas ne se compare pas.

### La convention de marquage

Une couleur laissée en dur **sur ordre** porte un commentaire contenant `GYM-286` dans les
dix lignes qui la précèdent. `node scripts/inventaire-couleurs.mjs --reste` s'en sert pour
séparer *l'oubli* de *l'ordre* — sans quoi le lot ne peut jamais annoncer sa fin.

La raison s'écrit **à côté de la couleur**, jamais dans un fichier d'exceptions que
personne ne relit.

### Ce qu'il ne faut pas défaire

- **Pas de `react-native-svg-transformer`** — conflit `babelTransformerPath` avec NativeWind.
- **`EXPO_PUBLIC_GYM_MODE`**, repli `single`, lecture stricte — `lib/gymResolver.ts` n'est
  pas touché par ce chantier.
- **`primary_color` / `secondary_color` `NULL` = « pas choisi »** : le repli visuel est
  côté client (palette Viniz). Ne réintroduire aucun défaut côté serveur.
- **`DOPAMINE_THEME` est une copie de `tailwind.config.js`, pas sa source.** Tant qu'une
  seule classe `move-*` subsiste, les deux coexistent et doivent concorder :
  `verify-theme-parity.mjs` refuse de les laisser diverger.
