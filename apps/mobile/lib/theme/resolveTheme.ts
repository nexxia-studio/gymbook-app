// GYM-102 (3/5) — 🔴 LE GARDE-FOU. Deux couleurs entrent, un thème SÛR sort.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// CE QUE CE MODULE EMPÊCHE
// ═════════════════════════════════════════════════════════════════════════════════════
// Une salle ne fournit que sa primaire et sa secondaire. Rien ne l'oblige à ce qu'elles
// soient utilisables : deux pastels, deux fois la même valeur, une chaîne mal saisie.
// Appliquées telles quelles, elles ne produisent pas une app moche — elles produisent une
// app ILLISIBLE, chez UN client, que nous ne verrons jamais.
//
// Ce module ne fait donc pas « appliquer les couleurs de la salle » : il fait « appliquer
// ce qui est lisible, et retomber sur Viniz pour le reste ». La maquette l'énonce ainsi :
// « Deux variables seulement viennent du club — primaire et secondaire — tout le reste
// tient dans la palette Viniz. »
//
// ⚠️ FONCTION PURE, SANS RENDU NI RÉSEAU. C'est la condition pour qu'elle soit vérifiable
// autrement qu'en regardant un téléphone.
import {
  parseHex, toHex, contrastRatio, hslLightness, bestInkOn,
  AA_TEXT, AA_NON_TEXT, type Rgb,
} from './contrast'

// ─────────────────────────────────────────────────────────────────────────────────────
// LA PALETTE VINIZ — recopiée de la maquette, qui la déclare elle-même :
//     const LIME = "#C8FF3D", INK = "#2D1B69", LAV = "#C8C2E6", LIGHT = "#F3F0FF";
// ─────────────────────────────────────────────────────────────────────────────────────
// ⚠️ LE LIME VINIZ N'EST PAS LE LIME DOPAMINE. #C8FF3D contre #C8F000 : deux verts
// proches à l'œil, deux marques différentes. Les confondre habillerait Viniz aux couleurs
// d'un de ses clients.
export const VINIZ = {
  lime: '#C8FF3D',
  /** « Violet Ink » — l'encre de Viniz sur fond clair, et le repli des actions. */
  ink: '#2D1B69',
  /** Lavande : texte secondaire sur fond sombre. */
  lavender: '#C8C2E6',
  /** Blanc lavande : texte principal sur fond sombre, et surface claire. */
  light: '#F3F0FF',
  /** Fond sombre par défaut, quand la salle n'en fournit pas d'utilisable. */
  dark: '#171310',
  /** Texte discret sur fond clair. */
  mutedOnLight: '#6B5E9C',
} as const

export type ThemeMode = 'dark' | 'light'

export interface ThemeTokens {
  mode: ThemeMode
  /** Surface principale de l'app. */
  background: string
  /** Cartes et champs, posés sur `background`. */
  surface: string
  /** Texte principal — garanti ≥ 4,5:1 sur `background`. */
  onBackground: string
  /** Texte secondaire, même fond. */
  onBackgroundMuted: string
  /** Fond des actions. */
  accent: string
  /** Texte sur `accent` — garanti ≥ 4,5:1. */
  onAccent: string
  border: string
  // ── AJOUTS GYM-286a ────────────────────────────────────────────────────────────────
  // Quatre rôles que l'app de Dopamine distingue et que les huit jetons du lot 3 ne
  // savaient pas nommer. Ils ne sont PAS une extension de la marque : ils rendent
  // exprimable ce que `tailwind.config.js` exprimait déjà en huit couleurs.
  //
  // ⚠️ POURQUOI IL EN FALLAIT. Dopamine n'est pas une app sombre : c'est une app CLAIRE
  // (page #F5F4F0, cartes blanches) traversée de BANDES sombres (#111111) en en-tête.
  // Le lot 3 a logé la bande dans `background` — le bon choix, c'est là que la marque
  // se voit — mais il ne restait alors aucun jeton pour la page, ni pour l'encre qu'on
  // pose dessus. Sans ces quatre-là, migrer un écran obligeait à choisir entre deux maux :
  // réutiliser un jeton pour un rôle qui n'est pas le sien, ou laisser la couleur en dur.
  /**
   * Fond de PAGE, le registre clair de l'app — distinct de `background`, qui porte la
   * bande d'en-tête. Chez Dopamine : `move-bg` #F5F4F0 contre `move-dark` #111111.
   */
  page: string
  /**
   * Encre principale posée sur `surface` et `page`.
   *
   * 🔴 CE N'EST PAS `onAccent`, MÊME QUAND LES DEUX VALENT #111111 CHEZ DOPAMINE. Le
   * rapprochement est une coïncidence de palette, pas une identité de rôle : `onAccent`
   * est l'encre choisie POUR LA COULEUR D'ACTION de la salle. Une salle à l'action
   * sombre reçoit `onAccent` clair — et un écran qui aurait confondu les deux écrirait
   * alors son texte en blanc sur ses cartes blanches.
   */
  onSurface: string
  /** Encre secondaire sur `surface`/`page`. Chez Dopamine : `move-text-secondary`. */
  onSurfaceSecondary: string
  /** Variante atténuée de l'action. Chez Dopamine : `move-accent-dim`. */
  accentDim: string
  /**
   * 🔴 LE LIME NE VA QUE SUR FOND SOMBRE. En mode clair il DISPARAÎT de l'interface —
   * règle de l'écran 09 de la maquette, pas une préférence esthétique : sur un fond clair
   * ce vert ne porte aucun texte et ne se distingue d'aucune surface.
   */
  limeAllowed: boolean
}

/** Ce que la fonction a réellement fait — pour la PR, les tests, et le journal. */
export interface ThemeDecision {
  tokens: ThemeTokens
  notes: {
    primary: string | null
    secondary: string | null
    backgroundFromGym: boolean
    accentFromGym: boolean
    backgroundLightness: number
    accentContrast: number
    /** L'encre retenue pour le libellé, et d'où elle vient. */
    accentInk: string
    accentVsBackground: number
    textContrast: number
    reasons: string[]
  }
}

/** Le thème Viniz complet, en mode sombre : le repli quand rien n'est exploitable. */
function vinizDark(): ThemeTokens {
  return {
    mode: 'dark',
    background: VINIZ.dark,
    surface: '#211C18',
    onBackground: VINIZ.light,
    onBackgroundMuted: VINIZ.lavender,
    accent: VINIZ.lime,
    onAccent: VINIZ.ink,
    border: 'rgba(243,240,255,0.14)',
    page: VINIZ.dark,
    onSurface: VINIZ.light,
    onSurfaceSecondary: VINIZ.lavender,
    accentDim: VINIZ.lime,
    limeAllowed: true,
  }
}

/**
 * Résout le thème d'une salle.
 *
 * `primary` habille les ACTIONS, `secondary` le FOND — c'est la répartition que montre
 * l'écran 03 de la maquette (« Secondaire de la salle en fond, primaire sur l'action »),
 * et pas un choix fait ici.
 */
export function resolveTheme(
  primary: string | null | undefined,
  secondary: string | null | undefined,
): ThemeDecision {
  const reasons: string[] = []
  const p = parseHex(primary)
  const s = parseHex(secondary)

  if (!p) reasons.push('primaire illisible ou absente → palette Viniz pour l’action')
  if (!s) reasons.push('secondaire illisible ou absente → fond Viniz')

  // ── 1. LE FOND ─────────────────────────────────────────────────────────────────────
  // Un fond n'est retenu que s'il peut porter du texte. Un gris moyen, par exemple, ne
  // passe 4,5:1 NI avec l'encre claire NI avec l'encre sombre : le garder condamnerait
  // tout le texte de l'app, alors qu'aucun contrôle plus loin ne pourrait le rattraper.
  // ── LES DEUX JEUX D'ENCRES, ET POURQUOI ILS DIFFÈRENT ──────────────────────────────
  //
  // TEXTE DE PAGE : clair ou Violet Ink, et rien d'autre. C'est l'identité typographique
  // de Viniz, et la maquette la fixe explicitement pour le mode clair (« le texte passe en
  // Violet Ink »). Élargir ce jeu changerait l'aspect de l'app, pas sa lisibilité.
  //
  // LIBELLÉ D'UN BOUTON : le jeu s'ouvre au quasi-noir de la palette. ⚠️ CE N'EST PAS UN
  // ASSOUPLISSEMENT DU SEUIL — 4,5:1 reste 4,5:1. C'est que le libellé, lui, est posé sur
  // une couleur de MARQUE arbitraire, pas sur une surface Viniz : son seul travail est
  // d'être lu. Le cas qui l'impose est réel — un terracotta #E2543F (luminance 0,229) :
  //     encre #F3F0FF  3,36:1     encre #2D1B69  3,79:1   ← les deux échouent
  //     encre #171310  4,90:1  ✅
  // Avec les seules encres de page, cette primaire parfaitement utilisable était ÉCARTÉE.
  // Le défaut n'était pas dans le seuil, il était dans le choix de l'encre.
  //
  // Et le quasi-noir n'est pas une couleur inventée pour l'occasion : #171310 est le fond
  // sombre Viniz, et c'est bien une encre de ce registre que la maquette pose sur ses
  // boutons lime.
  const INKS = [VINIZ.light, VINIZ.ink] as const
  const INKS_LABEL = [VINIZ.light, VINIZ.ink, VINIZ.dark] as const
  let background: Rgb
  let backgroundFromGym = false
  if (s) {
    const { ratio } = bestInkOn(s, INKS)
    if (ratio >= AA_TEXT) {
      background = s
      backgroundFromGym = true
    } else {
      background = parseHex(VINIZ.dark)!
      reasons.push(
        `fond de la salle écarté : aucune encre n’y atteint ${AA_TEXT}:1 (meilleur ${ratio.toFixed(2)}:1)`,
      )
    }
  } else {
    background = parseHex(VINIZ.dark)!
  }

  // ── 2. LE MODE ─────────────────────────────────────────────────────────────────────
  // ⚠️ DÉCIDÉ PAR LE FOND, PAS PAR « LES DEUX COULEURS ». La maquette décrit le cas où
  // les deux sont claires (« L > 80 % ») ; c'est un cas particulier de la vraie question,
  // qui est : sur quoi le texte sera-t-il posé ? Un fond clair impose le mode clair, que
  // la primaire soit claire ou non — et quand les deux le sont, on retombe exactement sur
  // l'écran 09.
  const backgroundLightness = hslLightness(background)
  const mode: ThemeMode = backgroundLightness > 80 ? 'light' : 'dark'

  // ── 3. LE TEXTE ────────────────────────────────────────────────────────────────────
  const { ink: onBackground, ratio: textContrast } = bestInkOn(background, INKS)

  // ── 4. L'ACTION ────────────────────────────────────────────────────────────────────
  // Deux conditions, et il faut les DEUX :
  //   (a) la primaire doit porter du texte      → ≥ 4,5:1 avec l'une des deux encres ;
  //   (b) elle doit se voir sur le fond          → ≥ 3:1, WCAG § 1.4.11.
  // (b) est ce qui écarte « deux tons identiques » (ratio 1:1) et « deux pastels
  // voisins » : un bouton parfaitement lisible mais invisible sur sa page reste un
  // bouton que personne ne trouve.
  let accent: string
  let onAccent: string
  let accentFromGym = false
  let accentContrast = 0
  let accentVsBackground = 0

  if (p) {
    const inkOnPrimary = bestInkOn(p, INKS_LABEL)
    accentContrast = inkOnPrimary.ratio
    accentVsBackground = contrastRatio(p, background)
    if (accentContrast >= AA_TEXT && accentVsBackground >= AA_NON_TEXT) {
      accent = toHex(p)
      onAccent = inkOnPrimary.ink
      accentFromGym = true
    } else {
      if (accentContrast < AA_TEXT) {
        reasons.push(
          `primaire écartée de l’action : ne porte aucun texte (meilleur ${accentContrast.toFixed(2)}:1)`,
        )
      }
      if (accentVsBackground < AA_NON_TEXT) {
        reasons.push(
          `primaire écartée de l’action : invisible sur le fond (${accentVsBackground.toFixed(2)}:1 < ${AA_NON_TEXT}:1)`,
        )
      }
      accent = ''
      onAccent = ''
    }
  } else {
    accent = ''
    onAccent = ''
  }

  if (!accentFromGym) {
    // 🔴 LE REPLI DÉPEND DU MODE, ET C'EST TOUT L'OBJET DE LA RÈGLE DU LIME.
    // Sur fond sombre, l'action retombe sur le Neon Lime (« Action = Neon Lime par
    // défaut », écran 05a). Sur fond clair, le lime ne peut pas servir — il ne porte
    // aucun texte et ne se détache d'aucune surface claire : l'action retombe sur le
    // Violet Ink (« les actions retombent sur le Violet Ink Viniz », écran 09).
    accent = mode === 'dark' ? VINIZ.lime : VINIZ.ink
    // Même règle de sélection que pour une primaire de salle : une seule logique d'encre
    // dans le module, donc un seul endroit à corriger le jour où elle bouge.
    onAccent = bestInkOn(parseHex(accent)!, INKS_LABEL).ink
  }

  // ── 5. LES SURFACES SECONDAIRES ────────────────────────────────────────────────────
  // Dérivées du fond, jamais fournies par la salle : une troisième couleur de marque
  // multiplierait les combinaisons à vérifier sans rien apporter.
  const surface = mode === 'dark' ? 'rgba(243,240,255,0.06)' : 'rgba(45,27,105,0.05)'
  const border = mode === 'dark' ? 'rgba(243,240,255,0.14)' : 'rgba(45,27,105,0.12)'
  const onBackgroundMuted = mode === 'dark' ? VINIZ.lavender : VINIZ.mutedOnLight

  // ── 6. LES QUATRE RÔLES AJOUTÉS PAR GYM-286a ───────────────────────────────────────
  // 🔴 AUCUN N'INTRODUIT UNE COULEUR QUE LE GARDE-FOU N'AURAIT PAS DÉJÀ VALIDÉE. Chacun
  // retombe sur un jeton déjà résolu plus haut. C'est délibéré : ces rôles existent pour
  // que les écrans de Dopamine soient MIGRABLES, et une salle n'a fourni que deux
  // couleurs — en inventer une troisième ici, c'est ajouter une combinaison à vérifier
  // sans que personne ne l'ait demandée.
  //
  // ⚠️ ET C'EST UNE POSITION D'ATTENTE, PAS UNE DÉCISION DE DESIGN. Trois questions
  // restent ouvertes, listées à l'arbitrage dans docs/GYM-286-inventaire.md :
  //   — la bande d'en-tête doit-elle se détacher de la page chez une salle (aujourd'hui
  //     `page === background`, donc un écran migré rend à plat) ;
  //   — `accentDim` doit-il être une vraie dérivation de l'action plutôt que l'action
  //     elle-même ;
  //   — `onSurface` tient tant que `surface` est un voile translucide sur le fond ; il
  //     faudra le recalculer le jour où une salle fournira une surface opaque.
  const page = toHex(background)
  const onSurface = onBackground
  const onSurfaceSecondary = onBackgroundMuted
  const accentDim = accent

  return {
    tokens: {
      mode,
      background: toHex(background),
      surface,
      onBackground,
      onBackgroundMuted,
      accent,
      onAccent,
      border,
      page,
      onSurface,
      onSurfaceSecondary,
      accentDim,
      // 🔴 Le lime ne touche JAMAIS un fond clair.
      limeAllowed: mode === 'dark',
    },
    notes: {
      primary: p ? toHex(p) : null,
      secondary: s ? toHex(s) : null,
      backgroundFromGym,
      accentFromGym,
      backgroundLightness,
      accentContrast,
      accentInk: onAccent,
      accentVsBackground,
      textContrast,
      reasons,
    },
  }
}

/** Le thème par défaut, sans aucune salle : Viniz, mode sombre. */
export const VINIZ_THEME: ThemeTokens = vinizDark()
