/**
 * GYM-102 (2/5) — contrôle les deux assets de marque de l'écran de lancement Viniz, et
 * régénère le module TypeScript qui les embarque.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ LE .SVG EST LA SOURCE DE VÉRITÉ. CE SCRIPT NE DESSINE RIEN.
 * ─────────────────────────────────────────────────────────────────────────────────────
 * Les deux fichiers viennent de la maquette (Claude Design) et sont versionnés tels
 * quels. Ce script les relit, VÉRIFIE qu'ils sont bien à fond transparent, et en dérive
 * `brandSvg.ts`. Toucher au .svg sans relancer le script laisse le module en arrière —
 * c'est le seul piège de cet ensemble.
 *
 * ⚠️ LE CONTRÔLE DE FOND N'EST PAS DÉCORATIF. Le SVG d'origine de la marque porte deux
 * rectangles pleins hors-champ (`<rect x="-150" width="1800">` en #ffffff puis #4827b4).
 * S'ils reviennent — réexport depuis l'outil de dessin, mauvais fichier recopié — l'écran
 * de lancement affiche un CARRÉ VIOLET OPAQUE par-dessus le tracé, et rien dans le build
 * ne le signale. D'où l'échec franc ci-dessous plutôt qu'un avertissement.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ ET POURQUOI UN MODULE TS À CÔTÉ DU .SVG
 * ─────────────────────────────────────────────────────────────────────────────────────
 * Rien dans l'app ne sait importer un `.svg` : `react-native-svg-transformer` n'est pas
 * installé, et l'installer imposerait un `babelTransformerPath` dans metro.config.js —
 * LÀ OÙ NATIVEWIND POSE DÉJÀ LE SIEN. Les deux se remplacent l'un l'autre : le perdant
 * emporte soit tous les SVG, soit TOUT LE STYLE DE L'APP DOPAMINE, sans erreur de build
 * pour le dire. Décision laissée au cockpit, volontairement pas prise ici.
 *
 * La spec prévoit elle-même la porte de sortie : « ou `<SvgXml>` avec le contenu du
 * fichier ». C'est ce qu'on fait — d'où ce module généré, qui évite de laisser deux
 * copies du même dessin dériver en silence.
 *
 * Usage : node scripts/generate-viniz-brand-svg.js
 */
const fs = require('fs')
const path = require('path')

const OUT_DIR = path.join(__dirname, '..', 'assets', 'viniz')

/** Les deux fonds pleins qui ne doivent JAMAIS être là. */
const FULL_BLEED_RECT = /<rect x="-150"[^>]*fill="#(?:ffffff|4827b4)"[^>]*(?:\/>|><\/rect>)/g

const ASSETS = [
  { file: 'viniz-pulse-line.svg', export: 'VINIZ_PULSE_LINE_SVG' },
  { file: 'viniz-wordmark-transparent.svg', export: 'VINIZ_WORDMARK_SVG' },
]

const parts = []
for (const a of ASSETS) {
  const xml = fs.readFileSync(path.join(OUT_DIR, a.file), 'utf8')

  const opaque = xml.match(FULL_BLEED_RECT)
  if (opaque) {
    throw new Error(
      `${a.file} : ${opaque.length} fond(s) plein(s) trouvé(s) — l'asset n'est PAS transparent. ` +
      `Posé tel quel, il masquerait l'écran de lancement d'un carré opaque. Reprendre le ` +
      `fichier de la maquette avant d'aller plus loin.`,
    )
  }
  if (!xml.includes('#c8ff3d')) throw new Error(`${a.file} : aucun art lime #C8FF3D — mauvais fichier ?`)

  parts.push({ name: a.export, xml, file: a.file })
  console.log(`✓ ${a.file} (${xml.length} o, fond transparent confirmé)`)
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
