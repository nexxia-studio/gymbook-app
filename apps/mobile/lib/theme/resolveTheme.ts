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

/**
 * 🔴 GYM-290 (A-6) — LE PAS DU RAIL : le gris-sur-sombre qui manquait à la charte.
 *
 * Trois gris orphelins traînaient depuis GYM-286 — #333333 (deux pistes de barre), #555555
 * (une pastille vide) — sans aucun jeton voisin. Le commentaire de l'époque disait le
 * manque en toutes lettres : « il manque à la charte un gris NEUTRE SUR FOND SOMBRE ».
 *
 * Un RAIL n'est ni une encre ni une surface d'action : c'est une marque inerte, qui doit se
 * distinguer du fond SANS attirer l'œil. Le seuil des éléments d'interface (3:1) serait
 * donc faux ici — il produirait un trait dur là où il faut un creux.
 *
 * ⚠️ 1,49:1 EST MESURÉ SUR DOPAMINE, PAS CHOISI. C'est exactement le rapport de son
 * #333333 sur son #111111 : la valeur qui a servi pendant deux ans dans l'app de
 * production. On ne calibre pas un jeton neuf à vue quand une référence existe.
 */
export const PAS_RAIL = 1.49

/**
 * 🔴 GYM-293b — LE PAS QUI CREUSE UN CHAMP DANS SA CARTE.
 *
 * ⚠️ CE PAS NE PORTE PAS, À LUI SEUL, L'IDENTIFICATION DU CHAMP. C'est `fieldBorder` qui
 * s'en charge, au seuil des éléments d'interface (3:1) — la règle WCAG 1.4.11 vise le
 * CONTOUR, pas le remplissage. Le pas de fond n'a donc qu'un rôle : que le champ se lise
 * comme un creux avant même qu'on regarde son trait.
 *
 * ⚠️ ET IL RESTE VOLONTAIREMENT SOUS `PAS_BANDE`. Une bande d'en-tête sépare deux régions
 * de l'écran ; un champ est posé DANS une carte, et un pas aussi marqué transformerait un
 * formulaire de six champs en six blocs gris — l'inverse de la hiérarchie recherchée.
 */
export const PAS_CHAMP = 1.2

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
  /** Cartes, posées sur `background`. Les CHAMPS ont les leurs depuis GYM-293b. */
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
   * 🔴 GYM-290 (A-6) — MARQUE INERTE SUR LE FOND : piste de barre, pastille vide.
   *
   * Ni une encre (elle ne porte aucun texte) ni une action (elle n'appelle aucun geste) :
   * elle doit se voir sans se faire remarquer. C'est le rôle qu'aucun jeton ne nommait, et
   * faute duquel trois gris étaient restés en dur depuis GYM-286.
   */
  /**
   * 🔴 GYM-307 — L'ENCRE SECONDAIRE POSÉE SUR LE FOND D'ACTION.
   *
   * Un sous-titre dans un bouton se pose sur `actionBg`, pas sur la page : il lui faut donc
   * sa propre encre atténuée, validée sur CE fond. Faute de ce jeton, le seul recours était
   * un blanc à 60 % — qui vaut 7,22:1 sur le sombre de Dopamine et 1,09:1 sur un accent
   * lime. Le même code, lisible chez l'un, invisible chez l'autre.
   */
  onActionMuted: string
  rail: string
  /**
   * 🔴 GYM-293b — LE CHAMP DE SAISIE, ENFIN DISTINCT DE LA CARTE QUI LE PORTE.
   *
   * `surface` se disait « cartes ET champs » : les deux recevaient donc la MÊME couleur, et
   * un champ posé sur une carte disparaissait dans son support. Chez Dopamine cela ne se
   * voyait pas — carte blanche, champ blanc, et un trait #E8E6E0 pour tout indice, ce qui
   * passe sur du blanc. Chez une salle à la carte colorée, c'était du rose sur du rose :
   * constaté en recette (Q3/Q5), formulaire d'inscription illisible.
   *
   * ⚠️ LES QUATRE JETONS VONT ENSEMBLE, ET C'EST LE POINT. Un fond de champ sans son encre
   * ni son placeholder revalidés ne fait que déplacer le problème : le gris de placeholder
   * employé jusqu'ici (`onBackgroundMuted`) était validé sur le FOND de l'app, puis posé
   * dans un champ sur une CARTE — deux surfaces que rien n'oblige à se ressembler.
   */
  field: string
  /** Encre de saisie, validée sur `field` — jamais sur la carte. */
  onField: string
  /** Placeholder : atténué autant que SEUIL_TEXTE l'autorise SUR `field`. */
  onFieldMuted: string
  /**
   * Contour du champ, à SEUIL_SURFACE de son fond.
   *
   * ⚠️ C'EST LUI QUI IDENTIFIE LE CHAMP, PAS LE REMPLISSAGE — et c'est pourquoi il ne
   * réemploie pas `border`, dérivé pour SÉPARER (un trait de liste, un filet de carte) et
   * validé à ce titre bien en dessous de 3:1.
   */
  fieldBorder: string
  /**
   * 🔴 GYM-290 (A-8) — LA RAMPE D'AFFLUENCE : trois paliers d'intensité croissante.
   *
   * C'est une LECTURE DE DONNÉE, pas un signal : elle peut suivre la marque sans rien
   * perdre de son sens, contrairement à un message d'erreur. Mais elle doit garantir trois
   * paliers DISTINGUABLES sur n'importe quelle primaire — ce qui est un vrai travail, pas
   * un remplacement. Voir `rampe()`.
   */
  ramp: readonly [string, string, string]
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
  // La carte du thème Viniz, nommée UNE fois : les jetons de formulaire s'en déduisent, et
  // recopier le littéral les ferait dériver le jour où cette surface bougerait.
  const CARTE = '#211C18'
  return {
    mode: 'dark',
    background: VINIZ.dark,
    surface: CARTE,
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
    onActionMuted: toHex(mutedInkOn(
      parseHex(VINIZ.lime)!,
      parseHex(bestInkOn(parseHex(VINIZ.lime)!, [VINIZ.light, VINIZ.ink, VINIZ.dark]).ink)!,
      SEUIL_TEXTE,
    )),
    rail: toHex(decalerDe(parseHex(VINIZ.dark)!, parseHex(VINIZ.light)!, PAS_RAIL)!),
    ...champ(parseHex(CARTE)!, [VINIZ.light, VINIZ.ink]),
    ramp: rampe(parseHex(VINIZ.dark)!, parseHex(VINIZ.lime)!),
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
  // 🔴 GYM-290 (A-5) — `accentDim` DEVIENT UNE VRAIE DÉRIVATION. Il valait `accent` : une
  // « variante atténuée » identique à ce qu'elle atténue ne sert à rien. A-1 vient de dire
  // ce qui reste dedans — de la MARQUE, jamais un succès — donc on peut enfin le dériver.
  //
  // ⚠️ IL EST POSÉ COMME TEXTE (`+not-found`, `SessionDescription`) : il se valide donc au
  // seuil TEXTE sur le fond, pas au seuil surface. C'est exactement ce que la
  // recommandation d'A-5 demandait — « l'action à ~75 % de luminosité, revalidée à 4,5:1 ».
  // `mutedInkOn` fait les deux d'un coup : il atténue autant que le seuil l'autorise, et
  // pas davantage.
  const accentDim = toHex(
    mutedInkOn(background, parseHex(accent)!, SEUIL_TEXTE, pageRgb),
  )
  // Décision A, option 1 : chez une salle, l'action EST l'accent, et son encre est celle
  // que le garde-fou a retenue pour lui — jamais une couleur choisie à la main.
  const actionBg = accent
  const onAction = onAccent
  const onActionMuted = toHex(
    mutedInkOn(parseHex(actionBg)!, parseHex(onAction)!, SEUIL_TEXTE),
  )
  // Le rail se dérive du FOND vers l'encre, du pas mesuré sur Dopamine. Vers l'encre et non
  // vers le blanc : sur une salle claire, éclaircir le fond ne produirait rien de visible.
  const rail = toHex(
    decalerDe(background, parseHex(onBackground)!, PAS_RAIL) ?? parseHex(onBackground)!,
  )

  // 🔴 GYM-293b — LE CHAMP SE CREUSE DANS LA CARTE, PAS DANS LE FOND. `surfaceRgb` et non
  // `background` : un champ d'inscription est posé sur la carte du formulaire, et c'est de
  // ce support-là qu'il doit se détacher. Le prendre depuis le fond donnerait un champ
  // parfaitement contrasté avec une région de l'écran où il ne se trouve pas.
  const champs = champ(surfaceRgb, INKS)

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
      onActionMuted,
      rail,
      ...champs,
      ramp: rampe(background, parseHex(accent)!),
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

/**
 * 🔴 GYM-293b — LE CONTOUR DU CHAMP SE MESURE SUR SES DEUX VOISINS.
 *
 * ⚠️ UN `decalerDe(champ, encre, 3)` NE SUFFIT PAS, ET LE BALAYAGE L'A MONTRÉ. Le champ est
 * creusé À L'OPPOSÉ de son encre ; un trait posé à 3:1 du champ, en allant vers l'encre,
 * traverse donc la carte et se fond dedans : mesuré, 12 040 salles sur 19 600 avec un
 * contour sous 3:1 côté carte. Le champ était identifiable depuis l'intérieur et invisible
 * depuis l'extérieur — c'est-à-dire invisible.
 *
 * WCAG § 1.4.11 demande 3:1 avec les couleurs ADJACENTES, au pluriel. On prend donc le PLUS
 * PETIT trait qui satisfait les deux : on avance du fond du champ vers son encre et on
 * s'arrête au premier point qui tient le seuil des deux côtés. Le plus petit, parce qu'un
 * contour plus marqué que nécessaire transforme un formulaire en grille.
 */
function contour(champFond: Rgb, carte: Rgb, encre: Rgb): Rgb {
  const PAS = 100
  for (let i = 1; i <= PAS; i += 1) {
    const c = melange(encre, champFond, i / PAS)
    if (contrastRatio(c, champFond) >= SEUIL_SURFACE && contrastRatio(c, carte) >= SEUIL_SURFACE) return c
  }
  // Aucun point ne tient les deux : l'encre du champ est le trait le plus visible dont on
  // dispose. Jamais un gris choisi à la main — ce serait une couleur que rien ne valide.
  return encre
}

/**
 * 🔴 GYM-293b — LES QUATRE JETONS DE FORMULAIRE, DÉRIVÉS D'UN SEUL ENDROIT.
 *
 * Une seule fonction pour les quatre, appelée depuis `resolveTheme` ET depuis `vinizDark` :
 * le repli Viniz et le thème d'une salle ne peuvent pas diverger sur ce que « un champ »
 * veut dire. C'est la leçon de `onActionMuted`, recalculé à la main dans les deux endroits
 * en GYM-307 — deux copies d'une même règle finissent toujours par se répondre autrement.
 *
 * L'ORDRE DES DÉRIVATIONS N'EST PAS ARBITRAIRE :
 *   1. le fond du champ se creuse dans la carte (`PAS_CHAMP`) ;
 *   2. son encre se choisit SUR CE FOND-LÀ, pas sur la carte ;
 *   3. le placeholder s'atténue depuis cette encre, autant que SEUIL_TEXTE l'autorise ;
 *   4. le contour se pose à SEUIL_SURFACE du fond du champ.
 *
 * ⚠️ CHAQUE ÉTAPE A SON REPLI, ET AUCUN N'INVENTE DE COULEUR. Un pas impossible (carte déjà
 * à la couleur de l'encre) rend un champ PLAT plutôt qu'un champ faux : le contour, lui,
 * tient encore l'identification. Un contour impossible retombe sur l'encre du champ — le
 * trait le plus visible dont on dispose, jamais un gris choisi à la main.
 */
function champ(carte: Rgb, encres: readonly string[]) {
  // ⚠️ PREMIÈRE VERSION, ÉCARTÉE PAR LA MESURE : creuser le champ VERS SON ENCRE. C'est le
  // geste naturel — « assombrir un peu le champ dans une carte claire » — et il est faux
  // pour la raison exacte que GYM-290 avait déjà rencontrée sur le voile des cartes :
  // rapprocher une surface de son encre, c'est rendre cette encre moins lisible. Balayage
  // des 19 600 salles : `onField` tombait à 4,00:1 sur 1 960 d'entre elles — une correction
  // de lisibilité qui cassait la lisibilité, sur une salle sur dix.
  //
  // 🔴 ON CREUSE DONC À L'OPPOSÉ DE L'ENCRE, et le champ y GAGNE du contraste. Les deux
  // directions sont essayées et on garde celle dont la meilleure encre est la plus
  // contrastée : la même règle, et pour le même motif, que le choix du voile de carte.
  // Si aucune ne peut atteindre le pas, le champ reste PLAT — son contour, lui, tient
  // encore l'identification, et un champ plat vaut mieux qu'un champ illisible.
  const creux = encres
    .map((dir) => decalerDe(carte, parseHex(dir)!, PAS_CHAMP))
    .filter((c): c is Rgb => c !== null)
  const fond = creux.length
    ? creux.reduce((a, b) => (bestInkOn(b, encres).ratio > bestInkOn(a, encres).ratio ? b : a))
    : carte
  const onField = bestInkOn(fond, encres).ink
  return {
    field: toHex(fond),
    onField,
    onFieldMuted: toHex(mutedInkOn(fond, parseHex(onField)!, SEUIL_TEXTE)),
    fieldBorder: toHex(contour(fond, carte, parseHex(onField)!)),
  }
}

/**
 * 🔴 GYM-290 (A-8) — TROIS PALIERS DÉRIVÉS DE L'ACCENT, DISTINGUABLES PARTOUT.
 *
 * ⚠️ LE PIÈGE EST D'ÉCHELONNER EN OPACITÉ. Trois mélanges à 33 / 66 / 100 % donnent trois
 * paliers bien séparés sur un fond sombre et trois quasi-jumeaux sur un fond clair — la
 * même formule, deux résultats. On échelonne donc en CONTRASTE SUR LE FOND, la grandeur
 * que l'œil mesure : chaque palier est le plus petit mélange qui atteint son ratio.
 *
 * Les trois cibles montent régulièrement du seuil de visibilité (le palier 1 doit se voir,
 * donc SEUIL_SURFACE) jusqu'à l'accent plein. Un palier qui ne peut pas atteindre sa cible
 * — accent trop proche du fond — retombe sur l'accent : trois paliers dont deux se
 * confondent restent lisibles, là où un palier invisible ferait disparaître une donnée.
 */
function rampe(background: Rgb, accent: Rgb): readonly [string, string, string] {
  // ⚠️ PREMIÈRE TENTATIVE, ÉCARTÉE PAR LA MESURE : trois cibles FIXES (3 / 3,75 / 4,5).
  // Elles supposaient que tout accent atteint 4,5:1 sur son fond — or le garde-fou ne lui
  // demande que 3:1. Résultat mesuré sur les cinq salles de test : des paliers séparés de
  // 1,19 seulement, et un terracotta dont les paliers 2 et 3 étaient IDENTIQUES (1,00),
  // faute de pouvoir monter plus haut. Une rampe dont deux barreaux se confondent ne dit
  // plus rien de la donnée qu'elle représente.
  //
  // 🔴 ON ÉCHELONNE DONC SUR LE CONTRASTE DE L'ACCENT LUI-MÊME, GÉOMÉTRIQUEMENT. Le palier
  // 3 est l'accent plein ; les deux autres sont à C^(1/3) et C^(2/3) de son contraste. La
  // progression géométrique donne le MÊME rapport entre paliers consécutifs — une rampe
  // régulière à l'œil — et ce rapport vaut C^(1/3). Comme le garde-fou garantit déjà
  // C ≥ 3:1 pour tout accent retenu, la séparation minimale est 3^(1/3) ≈ 1,44 : elle est
  // acquise par construction, sur n'importe quelle primaire.
  const C = contrastRatio(accent, background)
  return [1 / 3, 2 / 3, 1].map((k) => {
    const cible = Math.pow(C, k)
    return toHex(decalerDe(background, accent, cible) ?? accent)
  }) as unknown as readonly [string, string, string]
}

/** Le thème par défaut, sans aucune salle : Viniz, mode sombre. */
export const VINIZ_THEME: ThemeTokens = vinizDark()
