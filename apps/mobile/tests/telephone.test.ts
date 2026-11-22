// GYM-387 — normalisation et validation du téléphone.
//
//     cd apps/mobile && npx tsx tests/telephone.test.ts
//
// ⚠️ SCRIPT À CORPS DE MODULE, comme les autres tests de ce dossier : pas de cadre de test
// dans ce dépôt. Lire la sortie et le code de sortie.
import {
  estTelephoneConforme, indicatifDuPays, normaliserTelephone, telephonePourEnregistrement,
  type ResultatTelephone,
} from '../lib/telephone'

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

console.log('Caractères invisibles (copier-coller depuis les contacts iOS)')
attend('marques de direction U+202A…U+202C', '\u202A+32 470 12 34 56\u202C', null, '+32470123456')
attend('espaces insécables U+00A0', '0470\u00A012\u00A034\u00A056', 'BE', '+32470123456')
attend('U+200E, U+200F, U+2066, U+2069, U+FEFF', '\uFEFF\u200E\u20660470 12 34 56\u2069\u200F', 'BE', '+32470123456')
attend('invisibles seuls → vide', '\u202A\u202C\u00A0', 'BE', 'refus:vide')

console.log('Indicatif tapé sans « + »')
attend('BE : 32 470 12 34 56', '32 470 12 34 56', 'BE', '+32470123456')
attend('BE : jamais +3232…', '32470123456', 'BE', '+32470123456')
attend('BE : 32 + 0 national', '32 0470 12 34 56', 'BE', '+32470123456')
attend('FR : 33 6 12 34 56 78', '33 6 12 34 56 78', 'FR', '+33612345678')
attend('LU : 352 621 123 456', '352 621 123 456', 'LU', '+352621123456')
attend('32… chez une salle FR : pas l’indicatif de la salle', '32470123456', 'FR', '+3332470123456')
attend('BE : commence par 32 mais trop court pour un international', '3247012', 'BE', 'refus:trop_court')

console.log('Longueur minimale par pays')
attend('LU : fixe à 6 chiffres', '22 33 44', 'LU', '+352223344')
attend('LU : fixe à 6 chiffres, déjà en +', '+352 22 33 44', null, '+352223344')
attend('LU : 5 chiffres', '22 33 4', 'LU', 'refus:trop_court')
attend('BE : 6 chiffres restent refusés', '04 12 34 5', 'BE', 'refus:trop_court')
attend('FR : 7 chiffres restent refusés', '06 12 34 5', 'FR', 'refus:trop_court')

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

console.log('Enregistrement du profil : un numéro non touché n’est jamais réécrit')
const dire = (r: ReturnType<typeof telephonePourEnregistrement>) =>
  r.type === 'modifie' ? `modifie:${r.e164}` : r.type === 'refus' ? `refus:${r.raison}` : `inchange:${r.aVerifier ? 'a_verifier' : 'ok'}`
function enregistre(label: string, saisie: string, initial: string | null, pays: string | null, attendu: string): void {
  const obtenu = dire(telephonePourEnregistrement(saisie, initial, pays))
  check(label, obtenu === attendu, `attendu ${attendu}, obtenu ${obtenu}`)
}
// 🔴 Cas réel en prod : numéro américain sans indicatif, chez une salle belge.
enregistre('6504992804 non touché → inchangé, signalé', '6504992804', '6504992804', 'BE', 'inchange:a_verifier')
check('6504992804 non touché ne produit jamais +326504992804',
  JSON.stringify(telephonePourEnregistrement('6504992804', '6504992804', 'BE')).includes('+32') === false)
enregistre('numéro conforme non touché → inchangé, rien à signaler', '+32470123456', '+32470123456', 'BE', 'inchange:ok')
enregistre('numéro national non touché → inchangé, signalé', '0470 12 34 56', '0470 12 34 56', 'BE', 'inchange:a_verifier')
enregistre('vide non touché → inchangé, rien à signaler', '', '', 'BE', 'inchange:ok')
enregistre('champ modifié → normalisé', '0470 12 34 57', '6504992804', 'BE', 'modifie:+32470123457')
enregistre('champ modifié et invalide → refus', '0470', '6504992804', 'BE', 'refus:trop_court')
enregistre('champ vidé → refus', '', '+32470123456', 'BE', 'refus:vide')
enregistre('numéro non lu, champ laissé vide → inchangé', '', null, 'BE', 'inchange:ok')
enregistre('numéro non lu, champ rempli → normalisé', '0470123456', null, 'BE', 'modifie:+32470123456')
check('conforme : +32470123456', estTelephoneConforme('+32470123456'))
check('non conforme : 6504992804', !estTelephoneConforme('6504992804'))

console.log('Indicatifs')
check('BE → 32', indicatifDuPays('BE') === '32')
check('LU → 352', indicatifDuPays('LU') === '352')
check('inconnu → null', indicatifDuPays('DE') === null)
check('absent → null', indicatifDuPays(null) === null)

console.log(failures === 0 ? '\n✅ telephone : tout passe' : `\n🔴 telephone : ${failures} échec(s)`)
process.exit(failures === 0 ? 0 : 1)
