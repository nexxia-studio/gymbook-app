// GYM-387 — normalisation et validation du téléphone.
//
//     cd apps/mobile && npx tsx tests/telephone.test.ts
//
// ⚠️ SCRIPT À CORPS DE MODULE, comme les autres tests de ce dossier : pas de cadre de test
// dans ce dépôt. Lire la sortie et le code de sortie.
import { indicatifDuPays, normaliserTelephone, type ResultatTelephone } from '../lib/telephone'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const dit = (r: ResultatTelephone) => (r.ok ? r.e164 : `refus:${r.raison}`)
function attend(label: string, saisie: string | null, pays: string | null, attendu: string): void {
  const obtenu = dit(normaliserTelephone(saisie, pays))
  check(label, obtenu === attendu, `attendu ${attendu}, obtenu ${obtenu}`)
}

console.log('Indicatif de la salle')
attend('BE, numéro national', '0470123456', 'BE', '+32470123456')
attend('FR, numéro national', '0612345678', 'FR', '+33612345678')
attend('NL, numéro national', '0612345678', 'NL', '+31612345678')
attend('LU, pas de 0 national', '621123456', 'LU', '+352621123456')
attend('BE, fixe à 8 chiffres significatifs', '04 123 45 67', 'BE', '+3241234567')
attend('pays en minuscules', '0470123456', 'be', '+32470123456')

console.log('Numéro déjà international')
attend('déjà en +', '+32470123456', 'FR', '+32470123456')
attend('préfixe 00', '0032470123456', null, '+32470123456')
attend('+32 suivi du 0 national', '+320470123456', null, '+32470123456')
attend('+32 (0)', '+32 (0)470 12 34 56', null, '+32470123456')
attend('indicatif hors liste, conservé tel quel', '+447911123456', 'BE', '+447911123456')

console.log('Espaces et tirets')
attend('espaces', '0470 12 34 56', 'BE', '+32470123456')
attend('tirets', '0470-12-34-56', 'BE', '+32470123456')
attend('points et barre', '0470/12.34.56', 'BE', '+32470123456')
attend('espaces autour', '  +32 470 12 34 56  ', null, '+32470123456')

console.log('Refus')
attend('vide', '', 'BE', 'refus:vide')
attend('null', null, 'BE', 'refus:vide')
attend('espaces seuls', '   ', 'BE', 'refus:vide')
attend('trop court', '0470 12', 'BE', 'refus:trop_court')
attend('trop court en +', '+32470', null, 'refus:trop_court')
attend('7 chiffres significatifs', '0412345', 'BE', 'refus:trop_court')
attend('sans indicatif, pays inconnu', '0470123456', null, 'refus:indicatif_requis')
attend('sans indicatif, pays hors liste', '0470123456', 'DE', 'refus:indicatif_requis')
attend('lettres', '0470 abc 456', 'BE', 'refus:invalide')
attend('que des zéros', '0000000000', 'BE', 'refus:invalide')
attend('plus de 15 chiffres', '+3247012345678901', null, 'refus:invalide')

console.log('Indicatifs')
check('BE → 32', indicatifDuPays('BE') === '32')
check('LU → 352', indicatifDuPays('LU') === '352')
check('inconnu → null', indicatifDuPays('DE') === null)
check('absent → null', indicatifDuPays(null) === null)

console.log(failures === 0 ? '\n✅ telephone : tout passe' : `\n🔴 telephone : ${failures} échec(s)`)
process.exit(failures === 0 ? 0 : 1)
