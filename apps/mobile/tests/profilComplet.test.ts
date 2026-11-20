// GYM-387 — « faut-il afficher “Complète ton profil” ? »
//
//     cd apps/mobile && npx tsx tests/profilComplet.test.ts
//
// ⚠️ SCRIPT À CORPS DE MODULE, comme les autres tests de ce dossier.
import { doitCompleterProfil, estEmailContactValide, estEmailRelaisApple } from '../lib/profilComplet'

let failures = 0
function check(label: string, cond: boolean): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}`) }
}

console.log('doitCompleterProfil')
check('profil lu, phone null → true', doitCompleterProfil({ phone: null }, 'charge') === true)
check('profil lu, phone vide → true', doitCompleterProfil({ phone: '' }, 'charge') === true)
check('profil lu, phone en espaces → true', doitCompleterProfil({ phone: '   ' }, 'charge') === true)
check('profil lu, phone présent → false', doitCompleterProfil({ phone: '+32470123456' }, 'charge') === false)
check('profil non chargé → false', doitCompleterProfil(null, 'non_charge') === false)
check('erreur de lecture → false', doitCompleterProfil(null, 'erreur') === false)
// 🔴 Le cas de GYM-385 : un reste de profil SANS téléphone, mais une lecture en échec.
check('erreur, même avec un profil sans téléphone → false', doitCompleterProfil({ phone: null }, 'erreur') === false)
check('non chargé, même avec un profil sans téléphone → false', doitCompleterProfil({ phone: null }, 'non_charge') === false)
check('lecture réussie mais ligne absente → false', doitCompleterProfil(null, 'charge') === false)

console.log('estEmailRelaisApple')
check('adresse relais', estEmailRelaisApple('abc123@privaterelay.appleid.com') === true)
check('adresse relais en majuscules', estEmailRelaisApple('ABC@PrivateRelay.AppleID.com ') === true)
check('adresse réelle', estEmailRelaisApple('jean@example.com') === false)
check('icloud n’est pas un relais', estEmailRelaisApple('jean@icloud.com') === false)
check('null', estEmailRelaisApple(null) === false)

console.log('estEmailContactValide')
check('valide', estEmailContactValide('jean@example.com') === true)
check('sans domaine', estEmailContactValide('jean@example') === false)
check('avec espace', estEmailContactValide('jean dupont@example.com') === false)

console.log(failures === 0 ? '\n✅ profilComplet : tout passe' : `\n🔴 profilComplet : ${failures} échec(s)`)
process.exit(failures === 0 ? 0 : 1)
