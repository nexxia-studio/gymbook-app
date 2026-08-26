/**
 * GYM-102 (2/5) — dérive les deux assets de marque « fond transparent » de l'écran de
 * lancement Viniz, et le module TypeScript qui les embarque.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ POURQUOI CE SCRIPT EXISTE — LIS CECI AVANT DE RÉGÉNÉRER
 * ─────────────────────────────────────────────────────────────────────────────────────
 * La spec de l'animation décrit l'asset ainsi : « le pulse-V seul, fond transparent (les
 * deux rectangles pleins #ffffff et #4827b4 du SVG d'origine ont été supprimés) ».
 * Le .zip contenant les fichiers finaux n'est pas arrivé — ce script applique donc
 * EXACTEMENT l'opération que la spec documente, sur les SVG d'origine DÉJÀ dans le dépôt.
 *
 * Ce n'est pas une reconstitution à vue : les deux `<rect x="-150" width="1800">` sont des
 * frères de premier niveau posés juste après `</defs>`, et rien d'autre n'est touché —
 * ni le viewBox, ni un chemin, ni une couleur.
 *
 * PREUVE QUE `viniz-icon.svg` EST BIEN LE SVG D'ORIGINE DE LA SPEC : la spec annonce
 * « viewBox 1500×1500, art lime #C8FF3D occupant x 7 %→93 %, y 15,5 %→83 % ». La boîte
 * englobante mesurée de l'art lime du fichier vaut x 7,5 %→92,7 %, y 16,0 %→84,0 % — mêmes
 * proportions à un demi-pour-cent près, sur un fichier qui porte précisément les deux
 * rectangles que la spec dit avoir retirés.
 *
 * ⚠️ SI LE .ZIP ARRIVE : remplacer les deux .svg par ceux du zip, relancer ce script pour
 * régénérer le module TS, et vérifier la position de la bille à l'écran (voir la note
 * ART_Y_NUDGE dans components/viniz/VinizPulse.tsx).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ ET POURQUOI UN MODULE TS EN PLUS DU .SVG
 * ─────────────────────────────────────────────────────────────────────────────────────
 * Rien dans l'app ne sait importer un `.svg` : `react-native-svg-transformer` n'est pas
 * installé, et l'installer imposerait de poser un `babelTransformerPath` dans
 * metro.config.js — LÀ OÙ NATIVEWIND POSE DÉJÀ LE SIEN. Les deux se remplacent l'un
 * l'autre : le perdant emporte soit tous les SVG, soit TOUT LE STYLE DE L'APP DOPAMINE.
 * Le risque est sans commune mesure avec le gain.
 *
 * La spec prévoit elle-même la porte de sortie : « ou `<SvgXml>` avec le contenu du
 * fichier ». C'est ce qu'on fait — d'où ce module généré, qui garde le .svg comme unique
 * source de vérité au lieu de laisser deux copies dériver en silence.
 *
 * Usage : node scripts/generate-viniz-brand-svg.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'assets', 'viniz')

/** Les deux fonds pleins que la spec dit avoir retirés — et EUX SEULS. */
const FULL_BLEED_RECT = /<rect x="-150"[^>]*fill="#(?:ffffff|4827b4)"[^>]*(?:\/>|><\/rect>)/g

const SOURCES = [
  {
    from: path.join(OUT_DIR, 'viniz-icon.svg'),
    to: path.join(OUT_DIR, 'viniz-pulse-line.svg'),
    export: 'VINIZ_PULSE_LINE_SVG',
  },
  {
    from: path.join(ROOT, '..', 'dashboard', 'src', 'assets', 'brand', 'viniz-wordmark.svg'),
    to: path.join(OUT_DIR, 'viniz-wordmark-transparent.svg'),
    export: 'VINIZ_WORDMARK_SVG',
  },
]

const parts = []
for (const s of SOURCES) {
  const src = fs.readFileSync(s.from, 'utf8')
  const removed = src.match(FULL_BLEED_RECT) || []
  if (removed.length !== 2) {
    throw new Error(
      `${path.basename(s.from)} : ${removed.length} rectangle(s) de fond trouvé(s), 2 attendus. ` +
      `Le fichier source a changé — vérifier avant de régénérer quoi que ce soit.`,
    )
  }
  const out = src.replace(FULL_BLEED_RECT, '')
  if (!out.includes('#c8ff3d')) throw new Error(`${path.basename(s.to)} : plus d'art lime après nettoyage`)
  fs.writeFileSync(s.to, out)
  parts.push({ name: s.export, xml: out, file: path.basename(s.to) })
  console.log(`✓ ${path.basename(s.to)} (${out.length} o, 2 fonds retirés)`)
}

const ts = `// ⚠️ FICHIER GÉNÉRÉ — NE PAS ÉDITER À LA MAIN.
// Source : les .svg d'à côté. Régénérer avec \`node scripts/generate-viniz-brand-svg.js\`.
//
// Le .svg reste la SOURCE DE VÉRITÉ ; ce module n'existe que parce que rien dans l'app ne
// sait importer un .svg (voir l'en-tête du script : metro.config.js ne peut pas accueillir
// un second babelTransformerPath sans écraser celui de NativeWind).
${parts.map((p) => `\n/** ${p.file} */\nexport const ${p.name} = ${JSON.stringify(p.xml)}\n`).join('')}`

fs.writeFileSync(path.join(OUT_DIR, 'brandSvg.ts'), ts)
console.log(`✓ brandSvg.ts (${ts.length} o)`)
