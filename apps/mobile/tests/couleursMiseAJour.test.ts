// GYM-389 (suite) — la paire de couleurs de l'écran « Mise à jour requise » (design B).
//
//     cd apps/mobile && npx tsx tests/couleursMiseAJour.test.ts
//
// ⚠️ SCRIPT À CORPS DE MODULE, comme les autres tests de ce dossier.
import { PAIRE_VINIZ, couleursMiseAJour, initialeSalle } from '../components/version/couleursMiseAJour'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const viniz = (c: { fond: string; accent: string; deLaSalle: boolean }) =>
  c.fond === PAIRE_VINIZ.fond && c.accent === PAIRE_VINIZ.accent && c.deLaSalle === false

console.log('couleursMiseAJour')
const dopamine = couleursMiseAJour('#C8F000', '#111111')
check('Dopamine (lime sur quasi-noir) : couleurs de la salle', dopamine.deLaSalle && dopamine.fond === '#111111' && dopamine.accent === '#C8F000', JSON.stringify(dopamine))
check('écriture courte #RGB normalisée', couleursMiseAJour('#fff', '#000').fond === '#000000')
check('aucune couleur → paire Viniz', viniz(couleursMiseAJour(null, null)))
check('couleurs illisibles → paire Viniz', viniz(couleursMiseAJour('rouge', 'bleu')))
check('peu contrastées (deux tons sombres voisins) → paire Viniz', viniz(couleursMiseAJour('#2A2A40', '#1E1E2E')))
check('deux fois la même couleur → paire Viniz', viniz(couleursMiseAJour('#123456', '#123456')))
check('deux pastels → paire Viniz', viniz(couleursMiseAJour('#FFD1DC', '#FFF5E1')))
check('secondaire claire, primaire sombre (titre blanc illisible) → paire Viniz', viniz(couleursMiseAJour('#111111', '#FFFFFF')))
check('fond moyen (texte #D6D2CC sous 4,5:1) → paire Viniz', viniz(couleursMiseAJour('#000000', '#808080')))

const sansFond = couleursMiseAJour('#FF8E53', null)
check('secondaire inconnue : fond Viniz, primaire de la salle gardée', sansFond.fond === PAIRE_VINIZ.fond && sansFond.accent === '#FF8E53' && sansFond.deLaSalle)
const sansAccent = couleursMiseAJour(undefined, '#0B1F3A')
check('primaire inconnue : lime Viniz sur le fond de la salle', sansAccent.fond === '#0B1F3A' && sansAccent.accent === PAIRE_VINIZ.accent && sansAccent.deLaSalle)
check('primaire sombre seule sur fond Viniz → paire Viniz', viniz(couleursMiseAJour('#221133', null)))

// Le logo Viniz du pied garde son lime : tout fond retenu doit le laisser se détacher (3:1).
import { parseHex, contrastRatio } from '../lib/theme/contrast'
let limeOk = true
for (let v = 0; v <= 255; v += 5) {
  for (const sec of [[v, v, v], [v, 0, 0], [0, v, 0], [0, 0, v], [v, v, 0], [0, v, v], [v, 0, v]]) {
    const hex = '#' + sec.map((c) => c.toString(16).padStart(2, '0')).join('')
    const c = couleursMiseAJour('#FFFFFF', hex)
    if (contrastRatio(parseHex('#C8FF3D')!, parseHex(c.fond)!) < 3) limeOk = false
  }
}
check('logo Viniz lime ≥ 3:1 sur tout fond retenu (balayage de 364 secondaires)', limeOk)

console.log('initialeSalle')
check('Dopamine Performance Club → D', initialeSalle('Dopamine Performance Club') === 'D')
check('minuscule et espaces → majuscule', initialeSalle('  studio yoga') === 'S')
check('accent conservé', initialeSalle('élan') === 'É')
check('vide ou absent → V', initialeSalle('') === 'V' && initialeSalle(null) === 'V' && initialeSalle('   ') === 'V')

if (failures > 0) { console.log(`\n${failures} échec(s)`); process.exit(1) }
console.log('\nTout est vert.')
