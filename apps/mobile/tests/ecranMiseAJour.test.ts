// GYM-389 — l'écran « Mise à jour requise » rend TOUJOURS son bouton.
//
//     cd apps/mobile && npx tsx tests/ecranMiseAJour.test.ts
//
// ⚠️ SCRIPT À CORPS DE MODULE, comme les autres tests de ce dossier.
//
// Deux contrôles, parce qu'aucun des deux ne suffit seul :
//   1. UN RENDU RÉEL du composant (react-native-web + react-dom/server), pour toutes les
//      combinaisons de props et de marque : un bouton, son libellé, un fond distinct de
//      l'écran, 56 px de haut. L'écran ne reçoit pas `store_url` : avec ou sans, il rend la
//      même chose, et c'est `urlsStore` qui garantit une URL (cas repris ici).
//   2. UN CONTRÔLE DE SOURCE : le défaut constaté sur appareil venait de NativeWind, qui
//      n'existe pas dans ce rendu web. On refuse donc le motif lui-même — un Pressable qui
//      porte à la fois `className` et un `style` en fonction.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import Module from 'node:module'
import { urlsStore } from '../lib/versionMinimale'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

// ── Doublures : tout ce que l'écran importe et qui ne vit pas hors d'un appareil ───────
const React = require('react')
const RNW = require('react-native-web')
// tsx compile le JSX en `React.createElement` (pas de runtime automatique hors Metro).
;(globalThis as { React?: unknown }).React = React
const marque: { mode: 'single' | 'multi'; brand: unknown } = { mode: 'multi', brand: null }
const doublures: Record<string, () => unknown> = {
  'react-native': () => RNW,
  'react-native-safe-area-context': () => ({ SafeAreaView: RNW.View }),
  'lucide-react-native': () => ({ Download: () => React.createElement('i', { 'data-icone': 'download' }) }),
  'react-native-svg': () => ({ SvgXml: () => React.createElement('i', { 'data-logo': 'viniz' }) }),
  'react-i18next': () => ({ useTranslation: () => ({ t: (k: string) => k }) }),
  'nativewind/jsx-runtime': () => require('react/jsx-runtime'),
  '../../lib/theme/ThemeProvider': () => ({
    useTheme: () => ({ tokens: { accent: '#C8F000', background: '#111111' }, brand: marque.brand }),
  }),
  '../../hooks/useGymName': () => ({ useGymName: () => 'Studio Test' }),
  '../../lib/gymResolver': () => ({ get GYM_MODE() { return marque.mode } }),
}
const chargeur = Module as unknown as { _load: (id: string, ...r: unknown[]) => unknown }
const chargerOrigine = chargeur._load
chargeur._load = function (id: string, ...reste: unknown[]) {
  if (id in doublures) return doublures[id]()
  if (/\.(png|jpg)$/.test(id)) return { uri: 'logo-embarque.png' }
  return chargerOrigine.call(this, id, ...reste)
}

const { renderToStaticMarkup } = require('react-dom/server')
const { AppRegistry } = RNW

function rendre(props: { opening: boolean; openFailed: boolean }, mode: 'single' | 'multi', brand: unknown): string {
  marque.mode = mode
  marque.brand = brand
  // `gymResolver` est lu à l'import (constante par build) : on recharge l'écran par cas.
  const chemin = require.resolve('../components/version/UpdateRequiredScreen')
  delete require.cache[chemin]
  const { UpdateRequiredScreen } = require(chemin)
  AppRegistry.registerComponent('Ecran', () => () =>
    React.createElement(UpdateRequiredScreen, { onUpdate: () => {}, ...props }))
  const { element, getStyleElement } = AppRegistry.getApplication('Ecran', {})
  return renderToStaticMarkup(getStyleElement()) + renderToStaticMarkup(element)
}

/** La valeur d'une propriété CSS pour un élément : style en ligne, ou classes atomiques. */
function valeurCss(html: string, balise: string, propriete: string): string | null {
  const enLigne = balise.match(new RegExp(`${propriete}:\\s*([^;"]+)`))
  if (enLigne) return enLigne[1].trim()
  for (const classe of (balise.match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/)) {
    const regle = html.match(new RegExp(`\\.${classe}\\{${propriete}:([^;}]+)`))
    if (regle) return regle[1].trim()
  }
  return null
}

const MARQUES: [string, 'single' | 'multi', unknown][] = [
  ['multi, aucune salle', 'multi', null],
  ['multi, salle sans logo', 'multi', { slug: 's', name: 'Studio', shortName: null, logoUrl: null, primaryColor: '#FF8E53', secondaryColor: '#0B1F3A' }],
  ['multi, salle avec logo', 'multi', { slug: 's', name: 'Studio', shortName: null, logoUrl: 'https://exemple.test/l.png', primaryColor: '#C8F000', secondaryColor: '#111111' }],
  ['multi, couleurs peu contrastées', 'multi', { slug: 's', name: 'Studio', shortName: null, logoUrl: null, primaryColor: '#2A2A40', secondaryColor: '#1E1E2E' }],
  ['single (Dopamine)', 'single', null],
]

console.log('rendu : le bouton est toujours là')
for (const [nom, mode, brand] of MARQUES) {
  for (const opening of [false, true]) {
    for (const openFailed of [false, true]) {
      const html = rendre({ opening, openFailed }, mode, brand)
      const boutons = html.match(/<[a-z]+[^>]*role="button"[^>]*>/g) ?? []
      const cas = `${nom}${opening ? ', ouverture en cours' : ''}${openFailed ? ', échec d’ouverture' : ''}`
      const b = boutons[0] ?? ''
      const fondEcran = html.match(/background-color:\s*([^;"]+)/)?.[1]?.trim() ?? null
      const fondBouton = valeurCss(html, b, 'background-color')
      const ok =
        boutons.length === 1 &&
        b.includes('aria-label="update_required.button"') &&
        valeurCss(html, b, 'height') === '56px' &&
        fondBouton !== null && fondBouton !== fondEcran &&
        (opening || html.includes('>update_required.button<')) &&
        html.includes('update_required.open_failed') === openFailed &&
        html.includes('data-logo="viniz"')
      check(cas, ok, `boutons=${boutons.length} hauteur=${valeurCss(html, b, 'height')} fond=${fondBouton} écran=${fondEcran}`)
    }
  }
}

console.log('urlsStore : toujours une URL à ouvrir, avec ou sans store_url')
for (const bundle of ['be.dopamineclub.app', 'app.viniz', 'app.viniz.staging']) {
  for (const plateforme of ['ios', 'android'] as const) {
    for (const storeUrl of [null, '', 'https://exemple.test/fiche']) {
      const n = urlsStore(plateforme, bundle, storeUrl).length
      check(`${plateforme} ${bundle} store_url=${JSON.stringify(storeUrl)} → ${n} URL`, n >= 1)
    }
  }
}
check('staging iOS sans store_url → TestFlight',
  urlsStore('ios', 'app.viniz.staging', null).join(' | ') === 'itms-beta:// | https://testflight.apple.com/')

console.log('source : aucun Pressable avec className ET style en fonction')
const DOSSIER = join(__dirname, '..', 'components', 'version')
for (const fichier of readdirSync(DOSSIER).filter((f) => f.endsWith('.tsx'))) {
  const src = readFileSync(join(DOSSIER, fichier), 'utf8')
  const fautifs = (src.match(/<Pressable\b[\s\S]*?\n\s*>/g) ?? [])
    .filter((ouverture) => /\bclassName=/.test(ouverture) && /\bstyle=\{\s*\(/.test(ouverture))
  check(fichier, fautifs.length === 0)
  if (fichier === 'UpdateRequiredScreen.tsx') {
    const avant = src.slice(0, src.indexOf('<Pressable'))
    check('le bouton n’est pas dans un rendu conditionnel', !/(&&|\?)\s*\(?\s*$/.test(avant.trimEnd()))
  }
}

console.log(failures === 0 ? '\n✅ ecranMiseAJour : tout passe' : `\n🔴 ecranMiseAJour : ${failures} échec(s)`)
process.exit(failures === 0 ? 0 : 1)
