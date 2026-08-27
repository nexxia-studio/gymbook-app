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
  parseHex, toHex, contrastRatio, prefersDarkInk, hslLightness, bestInkOn, mutedInkOn,
  melange, decalerDe, SEUIL_TEXTE, SEUIL_SURFACE,
  AA_TEXT, AA_NON_TEXT, type Rgb,
} from './contrast'

// ─────────────────────────────────────────────────────────────────────────────────────
// LA PALETTE VINIZ — recopiée de la maquette, qui la déclare elle-même :
//     const LIME = "#C8FF3D", INK = "#2D1B69", LAV = "#C8C2E6", LIGHT = "#F3F0FF";
// ─────────────────────────────────────────────────────────────────────────────────────
// ⚠️ LE LIME VINIZ N'EST PAS LE LIME DOPAMINE. #C8FF3D contre #C8F000 : deux verts
// proches à l'œil, deux marques différentes. Les confondre habillerait Viniz aux couleurs
// d'un de ses clients.
/**
 * 🔴 GYM-290 (décision B) — LE PAS QUI SÉPARE LA BANDE DE LA PAGE.
 *
 * Exprimé en RATIO DE CONTRASTE et non en pourcentage de luminosité : un pas en pourcentage
 * se voit sur un fond sombre et disparaît sur un fond clair, alors qu'un pas en contraste
 * est le même à l'œil partout. Valeur de la planche, recoupée avec les surfaces voisines de
 * Dopamine (carte/page 1,10:1, bordure/page 1,13:1).
 *
 * ⚠️ NE PAS L'AUGMENTER POUR « MIEUX VOIR LA BANDE ». Au-delà, la bande cesse d'être une
 * séparation et devient une seconde couleur de marque — que la salle n'a pas choisie.
 */
export const PAS_BANDE = 1.3

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
   * 🔴 GYM-290 (décision A) — LE FOND DU BOUTON PRIMAIRE, ET SON ENCRE.
   *
   * ⚠️ POURQUOI UN COUPLE À PART, ET NON `accent`/`onAccent`. Chez une salle, les deux
   * paires sont IDENTIQUES — la décision A dit « fond = accent de la salle, encre choisie
   * par contraste », c'est exactement `accent`/`onAccent`. Mais chez Dopamine le bouton
   * primaire est l'INVERSE de son accent : fond sombre #111111, libellé lime #C8F000.
   * Câbler les écrans sur `accent` aurait retourné tous les boutons de l'app de
   * production. Le couple existe donc pour que `DOPAMINE_THEME` puisse FIGER ce que la
   * salle, elle, dérive — c'est le mandat du ticket, mot pour mot.
   */
  actionBg: string
  onAction: string
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
    actionBg: VINIZ.lime,
    onAction: bestInkOn(parseHex(VINIZ.lime)!, [VINIZ.light, VINIZ.ink, VINIZ.dark]).ink,
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
  // 🔴 GYM-290 (0a) — DÉCIDÉ PAR LA LUMINANCE, PLUS PAR LA TEINTE. `hslLightness > 80`
  // classait « sombre » un lime #C8FF3D (62 % de clarté HSL, mais presque aussi lumineux
  // qu'un blanc) : il recevait les encres du mode sombre, et la lavande y tombait à
  // 1,15:1. Mesuré sur 19 600 salles AVANT correction : `onBackgroundMuted` sous 4,5:1
  // dans 10 920 cas. Plus d'une salle sur deux. Voir `prefersDarkInk`.
  const mode: ThemeMode = prefersDarkInk(background) ? 'light' : 'dark'
  // ⚠️ CONSERVÉE, MAIS DÉGRADÉE AU RANG DE DESCRIPTION. `backgroundLightness` est publiée
  // dans les notes de décision et n'y décide plus RIEN — c'est la mesure qui a causé le
  // défaut. La laisser sans ce commentaire inviterait à s'en resservir.
  const backgroundLightness = hslLightness(background)

  // ── 3. LE TEXTE ────────────────────────────────────────────────────────────────────
  const { ink: onBackground, ratio: textContrast } = bestInkOn(background, INKS)

  // ═══════════════════════════════════════════════════════════════════════════════════
  // 🔴 GYM-290 (décision B) — LA BANDE EXISTE ENFIN CHEZ UNE SALLE
  // ═══════════════════════════════════════════════════════════════════════════════════
  // `page === background` : un écran migré rendait À PLAT chez une salle, sans la bande
  // d'en-tête qui structure tous les écrans de Dopamine. Ce n'était pas un choix de design,
  // c'était une position d'attente assumée depuis GYM-286a — faute de savoir de combien
  // décaler sans inventer une couleur.
  //
  // LE PAS EST UN CONTRASTE, PAS UN POURCENTAGE. Éclaircir « de 8 % » donne un écart bien
  // visible sur un fond sombre et invisible sur un fond clair : la même formule produit
  // deux résultats différents selon la salle. Un pas exprimé en RATIO DE CONTRASTE est le
  // même à l'œil partout, parce que c'est justement la grandeur que l'œil mesure.
  //
  // ⚠️ 1,30:1 EST CALIBRÉ, PAS CHOISI. C'est le pas de la planche, et il se recoupe avec ce
  // que fait Dopamine entre ses propres surfaces voisines : carte/page 1,10:1, bordure/page
  // 1,13:1. Sa bande à elle est à 17,16:1 — mais c'est un fond SOMBRE sur une page CLAIRE,
  // un parti pris d'identité, pas un pas de séparation. Reproduire 17:1 chez une salle
  // reviendrait à lui imposer le contraste de Dopamine ; 1,30:1 sépare sans imposer.
  //
  // ⚠️ ET LE SENS SUIT L'ÉLÉVATION. En mode sombre la page s'enfonce (plus sombre que la
  // bande), en mode clair elle se lève : la bande et les cartes restent « au-dessus » de la
  // page, dans l'ordre auquel l'œil est habitué. Quand le fond est déjà trop extrême pour
  // le pas demandé — un noir qu'on ne peut plus assombrir — on part dans l'autre sens
  // plutôt que de rendre un pas trop petit, qui ne se verrait pas.
  const versLaPage = mode === 'dark' ? parseHex('#000000')! : parseHex('#FFFFFF')!
  const versLAutre = mode === 'dark' ? parseHex('#FFFFFF')! : parseHex('#000000')!
  const pageRgb =
    decalerDe(background, versLaPage, PAS_BANDE)
    ?? decalerDe(background, versLAutre, PAS_BANDE)
    ?? background
  const page = toHex(pageRgb)

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
    // 🔴 GYM-290 (décision B) — SUR LES DEUX FONDS. Une action n'est pas posée que sur la
    // bande : les écrans en mettent aussi sur la page. Ne la valider que sur `background`
    // laissait 466 salles sur 19 600 avec un bouton invisible sur leur propre page — le
    // défaut que la séparation bande/page vient de rendre possible, et qu'elle doit donc
    // couvrir. On garde le PIRE des deux : c'est celui que le membre rencontrera.
    accentVsBackground = Math.min(
      contrastRatio(p, background),
      contrastRatio(p, pageRgb),
    )
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
    // 🔴 GYM-290 — ET LE REPLI EST REVALIDÉ SUR LE FOND, CE QU'IL N'ÉTAIT PAS. Le lime
    // était posé dès que le mode était sombre, sans vérifier qu'il se DÉTACHE de ce fond
    // précis. Sur un fond sombre-mais-vif — une menthe, un olive — l'action retombait donc
    // sur une couleur invisible : mesuré, `accent` sous 3:1 sur 5 748 salles sur 19 600,
    // et jusqu'à 1,00:1 (l'action de la MÊME couleur que sa page).
    // On essaie les deux replis dans l'ordre de la maquette et on garde le premier qui se
    // voit ; si aucun ne se voit, l'encre principale sert d'action — elle, on sait qu'elle
    // se détache, c'est la condition qui a fait accepter le fond.
    const replis = mode === 'dark' ? [VINIZ.lime, VINIZ.ink] : [VINIZ.ink, VINIZ.lime]
    const visible = replis.find(
      (c) => contrastRatio(parseHex(c)!, background) >= SEUIL_SURFACE
        && contrastRatio(parseHex(c)!, pageRgb) >= SEUIL_SURFACE,
    )
    if (!visible) {
      reasons.push(
        'aucun repli d’action ne se détache de ce fond : l’encre principale sert d’action',
      )
    }
    accent = visible ?? onBackground
    // Même règle de sélection que pour une primaire de salle : une seule logique d'encre
    // dans le module, donc un seul endroit à corriger le jour où elle bouge.
    onAccent = bestInkOn(parseHex(accent)!, INKS_LABEL).ink
  }

  // ── 5. LES SURFACES SECONDAIRES ────────────────────────────────────────────────────
  // Dérivées du fond, jamais fournies par la salle : une troisième couleur de marque
  // multiplierait les combinaisons à vérifier sans rien apporter.
  // 🔴 GYM-290 — LES SURFACES DEVIENNENT OPAQUES, ET C'EST UNE CORRECTION DE FOND.
  //
  // Elles étaient des VOILES (`rgba(...,0.06)`). Un voile ne vaut que par ce qu'il y a
  // dessous — et GYM-302 a montré ce que ça coûte : la tab bar, rendue hors de tout écran,
  // n'avait AUCUN fond de salle derrière elle et affichait donc la même teinte pour toutes
  // les salles sombres. On l'avait corrigé là où ça se voyait, en peignant le fond dessous.
  //
  // La décision B rend le problème général : dès que `page` et `background` diffèrent, le
  // MÊME voile rend deux couleurs selon l'endroit où la carte est posée. Une « surface »
  // qui change de couleur selon son support n'est pas un jeton, c'est un accident.
  //
  // On compose donc le voile sur le fond UNE fois, ici, et le jeton sort opaque. Effet de
  // bord bienvenu : ses encres deviennent calculables — c'est ce qui permet aux deux
  // jetons ci-dessous d'être validés pour de bon.
  //
  // ⚠️ ET LE VOILE PEUT RENDRE LA CARTE MOINS LISIBLE QUE LA PAGE — c'est ce qui restait.
  // Éclaircir un fond sombre le rapproche de l'encre claire qu'on va poser dessus : la
  // carte descendait sous 4,5:1 sur 980 salles alors que la PAGE, elle, passait. On essaie
  // donc les deux sens et on garde celui dont la meilleure encre est la plus contrastée ;
  // si aucun ne tient le seuil, on ne voile pas du tout. Une carte plate est moins grave
  // qu'une carte illisible — et le cas est rare, par construction.
  const CLAIR = parseHex(VINIZ.light)!
  const SOMBRE = parseHex(VINIZ.dark)!
  const aSurface = mode === 'dark' ? 0.06 : 0.05
  const aBorder = mode === 'dark' ? 0.14 : 0.12
  const candidats = [CLAIR, SOMBRE].map((v) => ({ v, s: melange(v, background, aSurface) }))
  const meilleur = candidats.reduce((a, b) =>
    (bestInkOn(b.s, INKS).ratio > bestInkOn(a.s, INKS).ratio ? b : a))
  const voileTient = bestInkOn(meilleur.s, INKS).ratio >= SEUIL_TEXTE
  if (!voileTient) {
    reasons.push('carte non voilée : tout voile ferait tomber son encre sous le seuil texte')
  }
  const voile = meilleur.v
  const surfaceRgb = voileTient ? meilleur.s : background
  const borderRgb = melange(voile, background, aBorder)
  const surface = toHex(surfaceRgb)
  const border = toHex(borderRgb)

  // 🔴 GYM-290 (0) — L'ENCRE ATTÉNUÉE EST DÉRIVÉE, PLUS CHOISIE DANS UNE LISTE DE DEUX.
  // Une teinte fixe ne peut pas être à la fois atténuée et lisible sur un fond quelconque.
  // On part de l'encre principale — dont on SAIT qu'elle passe le seuil — et on la fond
  // vers le fond aussi loin que 4,5:1 l'autorise. La hiérarchie reste (le secondaire est
  // plus discret), et la lisibilité ne dépend plus de la teinte du fond.
  const onBackgroundMuted = toHex(
    mutedInkOn(background, parseHex(onBackground)!, SEUIL_TEXTE, pageRgb),
  )

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
  // 🔴 GYM-290 — LES ENCRES DE CARTE SE VALIDENT SUR LA CARTE, PAS SUR LA PAGE.
  // Elles recopiaient les encres de fond. Tant que la surface était un voile à 6 %, l'écart
  // était petit — mais il existait, et il suffisait à faire tomber `onSurface` sous 4,5:1
  // sur 980 salles et `onSurfaceSecondary` sur 11 760. Mesurées sur LEUR fond, elles
  // tombent à zéro.
  const onSurface = bestInkOn(surfaceRgb, INKS).ink
  const onSurfaceSecondary = toHex(
    mutedInkOn(surfaceRgb, parseHex(onSurface)!, SEUIL_TEXTE),
  )
  const accentDim = accent
  // Décision A, option 1 : chez une salle, l'action EST l'accent, et son encre est celle
  // que le garde-fou a retenue pour lui — jamais une couleur choisie à la main.
  const actionBg = accent
  const onAction = onAccent

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
      actionBg,
      onAction,
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
