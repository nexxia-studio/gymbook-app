# Recette — GYM-74 · L'écran Studio parle enfin autre chose que le français

> Un lot, un fichier. Voir `docs/recettes/README.md`.

🔴 **AUCUN DÉPLOIEMENT.**

## Ce que le lot pose

| fichier | changement |
|---|---|
| `apps/mobile/app/(tabs)/studio.tsx` | 23 clés appelées · 8 sous-composants dotés de `t()` · 🔴 3 `'fr-BE'` en dur levés |
| `apps/mobile/locales/fr.json` · `en.json` | **30 clés** ajoutées à la section `studio` existante |

---

## § 1 — Combien de chaînes, et une rectification

**26 chaînes d'interface**, rendues par **23 clés** (trois sont réutilisées : le titre
apparaît trois fois, « Aucun encore » et les badges « N séances » deux fois chacun).

⚠️ **Une rectification au cadrage** : `useTranslation` **était importé**, et
`const { t } = useTranslation()` déclaré ligne 452 — mais **jamais appelé**. Le diagnostic
tient, la cause est un peu différente : ce n'est pas un écran écrit avant l'i18n, c'est un
écran où le branchement a été posé puis jamais utilisé.

### 🔴 Les trois chaînes que le JSX ne montrait pas

```ts
new Date().toLocaleDateString('fr-BE', { month: 'long' })                       // nom du mois
new Date(memberSince).toLocaleDateString('fr-BE', { day, month: 'short', … })   // date d'adhésion
d.toLocaleDateString('fr-BE', { month: 'short' })                               // étiquettes de la heatmap
```

**Ce sont les plus insidieuses du lot.** Invisibles dans le JSX, elles auraient rendu
« septembre » au milieu d'une app anglaise sans qu'aucune relecture des libellés ne le voie.

Remplacées par `formatDateLocale(date, options, i18n.language)`.

⚠️ **`fr` est remappé vers `fr-BE`, délibérément** : les deux diffèrent sur des détails
d'abréviation, et le rendu français d'aujourd'hui doit rester au caractère près — Dopamine
ne doit voir **aucun** changement. Enveloppé dans un `try/catch`, comme `formatPrice` de
`lib/payments.ts` : c'est le motif du dépôt pour `Intl`.

---

## § 2 — Pluriels et nombres : le mécanisme en place, repris tel quel

Convention du dépôt : `clé_one` / `clé_other` avec `{{count}}` — celle de
`subscription.sessions_count_*`, `payment.credits_added_*`, `session.max_bookings_message_*`.

**Six paires fléchies** ajoutées : `sessions_completed`, `next_level`, `streak_weeks`,
`streak_record`, `attendance_confirmed`, `attendance_noshow`, `sessions_count`.

### 🔴 Le cas à deux nombres

`{confirmed} confirmées · {noShow} no-shows` porte **deux** pluriels indépendants, et
i18next ne sait pas fléchir deux `count` dans une même clé.

Solution reprise de `useSubscriptionSummary` (GYM-208), qui résout exactement le même
problème pour « Illimité · 3 séances » : **deux clés fléchies séparément, jointes par
`' · '`**. Pas un troisième mécanisme — celui qui existe déjà.

### Un `count` qui ne s'affiche pas

`semaines d'affilée` est sous un `AnimatedNumber` qui porte le nombre : le libellé ne
contient pas `{{count}}`, mais la flexion en dépend quand même. i18next l'accepte —
`t('studio.streak_weeks', { count: streakWeeks })`.

---

## § 3 — Le count-up n'a pas été touché

Convention documentée : `useEffect([data])`, pas au montage.

**Vérifié sur le diff : aucun `useEffect` ni aucune liste de dépendances n'apparaît dans
les lignes modifiées.** Les changements sont strictement dans le rendu de texte.

---

## § 4 — États vides et message d'erreur

- **« Aucun encore »** (cours favori, coach préféré) — traduit. C'est ce qu'un membre qui
  n'a encore rien fait voit en premier.
- 🔴 **Le message d'erreur a changé de nature.** Il affichait
  `{error ?? 'Impossible de charger ta progression'}`. Or `useProgression` remplit `error`
  avec `res?.message ?? fnError?.message ?? 'Erreur'` : **une chaîne venue du serveur ou du
  SDK Supabase**. Intraduisible par construction — et elle exposait au membre un détail
  technique qu'il ne peut pas lire (même famille que GYM-346 : le détail va dans les
  journaux, pas dans l'écran).

  Le membre voit désormais `studio.load_error`, traduit. `error` reste disponible pour le
  diagnostic, simplement il n'est plus rendu.

---

## § 5 — (a) D'autres écrans dans le même état ?

**Non — studio.tsx était le seul.** Scan de tous les `.tsx` de `app/` et `components/` :
les autres correspondances étaient des **faux positifs** (des génériques TypeScript
`Record<…>` qu'une détection JSX naïve prend pour du texte).

### 🔴 Mais `'fr-BE'` en dur existe ailleurs — 6 autres occurrences, NON TRAITÉES

| fichier | ligne |
|---|---|
| `app/(tabs)/profile.tsx` | 108 |
| `app/profile/payments.tsx` | 31 |
| `app/profile/subscription.tsx` | 49, 60 |
| `app/profile/delete-account.tsx` | 33 |
| `components/session/SuspensionModal.tsx` | 30 |

Ces écrans **ont** leurs libellés traduits — ce sont leurs **dates** qui resteront
françaises en anglais. Listées sans être traitées, comme demandé : c'est ton arbitrage de
périmètre. `formatDateLocale` de ce lot est prêt à être extrait vers `utils/` le jour où tu
décides de les reprendre.

### Deux autres constats, hors périmètre

- **`studio.title` / `studio.plans` / `studio.info`** existaient déjà dans les locales et ne
  sont **référencées nulle part** — vestiges d'un écran antérieur. Laissées en place :
  les supprimer n'est pas une extraction.
- **Les noms de niveaux** (`utils/gamification.ts`) sont `Rookie`, `Regular`, `Warrior`,
  `Champion`, **`Légende`** — quatre anglais et un français. Voir § 6.

---

## § 6 — (b) Ce qui vient du serveur et que je ne traduis pas

| chaîne | origine | décision |
|---|---|---|
| **nom du cours favori** (`data.cours_favori.name`) | `activities.name`, saisi par le gérant | **laissée** — relève d'`activity_translations`, pas de cet écran |
| **nom du coach** (`data.coach_favori.name`) | `coaches.name` | **laissée** — un nom propre ne se traduit pas |
| **initiales du coach** | dérivées du nom ci-dessus | **laissées** — dérivation, pas une chaîne |
| **`error`** de `useProgression` | message serveur / SDK Supabase | **cessé d'être affiché** (§ 4) |

### ⚠️ Un cas frontière : les noms de niveaux

`level.name` et `nextLevel.name` viennent de `utils/gamification.ts` — **une constante de
l'app, pas du serveur**. Ils sont donc traduisibles en principe.

**Je ne les ai pas traduits**, et c'est un choix à valider :
1. ils vivent **hors de cet écran** — les extraire déborderait du fichier du lot ;
2. `Rookie`/`Regular`/`Warrior`/`Champion` sont des termes de gamification que beaucoup de
   produits laissent en anglais dans toutes les langues ; **`Légende` est l'intrus**, pas
   l'inverse ;
3. les traduire est un **arbitrage produit** (garde-t-on les termes anglais ?), pas une
   extraction mécanique.

Ils sont interpolés tels quels dans `studio.next_level`, qui les reçoit en paramètre — la
clé est donc déjà prête si tu décides de les traduire plus tard.

---

## Preuves

- **Parité fr/en : 669 clés = 669 clés**, zéro manquante d'un côté comme de l'autre
- **`studio` : 33 clés en fr, 33 en en** (3 préexistantes + 30 ajoutées)
- **Les 23 clés appelées depuis `studio.tsx` résolvent toutes**, en fr ET en en, formes
  fléchies `_one`/`_other` comprises — vérifié par script
- **Aucune chaîne littérale d'interface ne subsiste dans le JSX** (les seules
  correspondances restantes sont le repli `'fr-BE'` documenté du helper et la variable
  `streakRecord`)
- **Le count-up est intact** : aucun `useEffect` ni aucune dépendance dans le diff
- **`tsc` mobile exit 0 — 165 fichiers projet** · `tsc --build` dashboard **exit 0**
- `deno check` **35/35** · les **4** bancs Deno passent
- ⚠️ **Pas d'essai sur appareil** — pas de simulateur depuis cette machine. Le rendu
  anglais n'a pas été vu ; la résolution des clés est prouvée par script, pas à l'écran
- **Aucun déploiement**
