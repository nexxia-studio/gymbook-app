// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  LES COULEURS TIRÉES DU LOGO PASSENT LE GARDE-FOU — ou ne sont pas proposées          ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
//     npm --prefix apps/dashboard run test:logo-colors
//
// ⚠️ SCRIPT À CORPS DE MODULE, comme `rls-isolation.test.ts` et les bancs `_shared` : pas
// de cadre de test dans ce dépôt. Lire la sortie et le code de sortie (GYM-350 §4).
//
// ⚠️ CE BANC N'OUVRE AUCUNE IMAGE. Il éprouve la DÉCISION (`choisirCouple`), pas la lecture
// du canvas — c'est pour cela qu'elle a été isolée. Ce qui compte n'est pas « comment lire
// une image » mais « quel couple on propose, et passe-t-il le garde-fou ».
//
// CE QU'IL PROTÈGE : la promesse de GYM-102/285. Proposer un couple que l'app ignorerait
// serait pire que ne rien proposer — le gérant accepterait, et ne verrait jamais ses
// couleurs. Le banc exige donc que TOUT couple proposé passe `forecastBrand` sans avertir.
import { choisirCouple, type Rgb } from '../lib/logoColors'
import { forecastBrand } from '../lib/brandContrast'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

const rgb = (r: number, g: number, b: number): Rgb => ({ r, g, b })

console.log('\nCAS 1 — un logo coloré rend un couple, et ce couple passe le garde-fou')
{
  const palette = choisirCouple([rgb(200, 255, 61), rgb(23, 16, 46), rgb(255, 255, 255)])
  check('un couple est proposé', palette !== null, JSON.stringify(palette))
  if (palette) {
    const f = forecastBrand(palette.primary, palette.secondary)
    // 🔴 LE POINT DU BANC.
    check('le couple ne déclenche AUCUN repli', !f.hasWarning, JSON.stringify(f))
  }
}

console.log('\nCAS 2 — un logo MONOCHROME ne propose rien')
{
  // Noir, blanc, gris : aucune couleur de marque à en tirer. On n'en invente pas.
  const palette = choisirCouple([rgb(0, 0, 0), rgb(255, 255, 255), rgb(128, 128, 128)])
  check('rien n\'est proposé', palette === null, JSON.stringify(palette))
}

console.log('\nCAS 3 — aucune entrée, aucune proposition')
{
  check('liste vide → null', choisirCouple([]) === null)
}

console.log('\nCAS 4 — DEUX PASTELS VOISINS : le garde-fou les refuse, donc on ne les propose pas')
{
  // C'est le cas nommé par GYM-102 : « deux tons clairs doivent déclencher l'alerte ».
  // Le couple brut échouerait ; la boucle doit soit trouver un fond sombre acceptable,
  // soit ne rien rendre — jamais rendre le couple fautif.
  const pastels = [rgb(250, 220, 230), rgb(225, 235, 250)]
  const palette = choisirCouple(pastels)
  if (palette === null) {
    check('aucun couple acceptable → null', true)
  } else {
    const f = forecastBrand(palette.primary, palette.secondary)
    check('le couple rendu passe quand même le garde-fou', !f.hasWarning, JSON.stringify({ palette, f }))
    check('le fond n\'est PAS l\'un des deux pastels bruts',
      !pastels.some((p) => `#${[p.r, p.g, p.b].map((v) => v.toString(16).padStart(2, '0')).join('')}` === palette.secondary),
      palette.secondary)
  }
}

console.log('\nCAS 5 — balayage : tout couple proposé passe le garde-fou, sans exception')
{
  // 🔴 UN BANC QUI N'ESSAIE QU'UN CAS NE PROUVE RIEN (GYM-350). On balaie la roue des
  // teintes et on exige l'invariant sur CHACUNE.
  let proposes = 0
  let fautifs = 0
  for (let h = 0; h < 360; h += 15) {
    const a = (h % 360) / 60
    const x = Math.round(255 * (1 - Math.abs((a % 2) - 1)))
    const table: Rgb[] = [
      rgb(255, x, 0), rgb(x, 255, 0), rgb(0, 255, x), rgb(0, x, 255), rgb(x, 0, 255), rgb(255, 0, x),
    ]
    const teinte = table[Math.floor(a) % 6]
    const palette = choisirCouple([teinte, rgb(20, 20, 20), rgb(245, 245, 245)])
    if (!palette) continue
    proposes++
    if (forecastBrand(palette.primary, palette.secondary).hasWarning) fautifs++
  }
  check(`${proposes} couples proposés sur 24 teintes`, proposes > 0, String(proposes))
  check('aucun couple fautif', fautifs === 0, `${fautifs} fautif(s)`)
}

console.log(failures === 0 ? '\n✅ banc complet — 0 échec\n' : `\n❌ ${failures} échec(s)\n`)
if (failures > 0) process.exit(1)
