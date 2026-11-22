// GYM-389 — « faut-il afficher “Mise à jour requise” ? »
//
//     cd apps/mobile && npx tsx tests/versionMinimale.test.ts
//
// ⚠️ SCRIPT À CORPS DE MODULE, comme les autres tests de ce dossier.
import {
  INTERVALLE_RELECTURE_MS, comparerVersions, doitForcerMiseAJour, doitRelirePolitique, urlsStore,
} from '../lib/versionMinimale'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

console.log('comparerVersions')
check('1.2.3 < 1.2.4', comparerVersions('1.2.3', '1.2.4') === -1)
check('1.2.10 > 1.2.9 (numérique, pas alphabétique)', comparerVersions('1.2.10', '1.2.9') === 1)
check('1.10.0 > 1.9.0', comparerVersions('1.10.0', '1.9.0') === 1)
check('2.0.0 > 1.99.99', comparerVersions('2.0.0', '1.99.99') === 1)
check('1.2.3 = 1.2.3', comparerVersions('1.2.3', '1.2.3') === 0)
check('espaces autour tolérés', comparerVersions(' 1.2.3 ', '1.2.3') === 0)
check('zéros de tête : 1.02.3 = 1.2.3', comparerVersions('1.02.3', '1.2.3') === 0)
for (const mal of ['1.2', '1.2.3.4', 'v1.2.3', '1.2.x', '1.2.3-beta', '', 'abc', null, undefined]) {
  check(`malformée « ${String(mal)} » → null`, comparerVersions(mal, '1.2.3') === null && comparerVersions('1.2.3', mal) === null)
}

console.log('doitForcerMiseAJour')
const p = (minVersion: string) => ({ minVersion })
check('1.2.3 < 1.2.4 → blocage', doitForcerMiseAJour('1.2.3', p('1.2.4'), 'charge') === true)
check('1.2.3 < 9.9.9 → blocage', doitForcerMiseAJour('1.2.3', p('9.9.9'), 'charge') === true)
check('1.2.9 < 1.2.10 → blocage', doitForcerMiseAJour('1.2.9', p('1.2.10'), 'charge') === true)
check('1.2.10 > 1.2.9 → pas de blocage', doitForcerMiseAJour('1.2.10', p('1.2.9'), 'charge') === false)
check('égalité → pas de blocage', doitForcerMiseAJour('1.2.3', p('1.2.3'), 'charge') === false)
check('min_version 0.0.0 → pas de blocage', doitForcerMiseAJour('1.2.3', p('0.0.0'), 'charge') === false)
// 🔴 Une lecture en échec n'est pas une réponse — même avec un reste de politique en main.
check('erreur → pas de blocage', doitForcerMiseAJour('1.2.3', null, 'erreur') === false)
check('erreur, même avec une politique bloquante → pas de blocage', doitForcerMiseAJour('1.2.3', p('9.9.9'), 'erreur') === false)
check('hors ligne (lecture jamais aboutie) → pas de blocage', doitForcerMiseAJour('1.2.3', null, 'non_charge') === false)
check('non chargé, même avec une politique bloquante → pas de blocage', doitForcerMiseAJour('1.2.3', p('9.9.9'), 'non_charge') === false)
check('ligne absente → pas de blocage', doitForcerMiseAJour('1.2.3', null, 'charge') === false)
check('min_version malformée → pas de blocage', doitForcerMiseAJour('1.2.3', p('9.9'), 'charge') === false)
check('version de l’app malformée → pas de blocage', doitForcerMiseAJour('1.2', p('9.9.9'), 'charge') === false)
check('version de l’app illisible (null) → pas de blocage', doitForcerMiseAJour(null, p('9.9.9'), 'charge') === false)

console.log('doitRelirePolitique')
const T = 1_000_000_000
check('jamais lue → relire', doitRelirePolitique(null, T, false) === true)
check('lue il y a 1 min → ne pas relire', doitRelirePolitique(T - 60_000, T, false) === false)
check('lue il y a 9 min 59 → ne pas relire', doitRelirePolitique(T - INTERVALLE_RELECTURE_MS + 1_000, T, false) === false)
check('lue il y a 10 min → relire', doitRelirePolitique(T - INTERVALLE_RELECTURE_MS, T, false) === true)
// d) de la recette : l'écran affiché doit pouvoir disparaître dès le retour au premier plan.
check('écran affiché, lue il y a 1 min → relire', doitRelirePolitique(T - 60_000, T, true) === true)

console.log('urlsStore')
const dit = (u: string[]) => u.join(' | ')
check('store_url présent → en premier',
  urlsStore('ios', 'app.viniz', 'https://apps.apple.com/be/app/viniz/id6809463633')[0] === 'https://apps.apple.com/be/app/viniz/id6809463633')
check('iOS Dopamine, sans store_url → fiche App Store',
  dit(urlsStore('ios', 'be.dopamineclub.app', null)) === 'https://apps.apple.com/app/id6781670485')
check('iOS Viniz, sans store_url → fiche App Store',
  dit(urlsStore('ios', 'app.viniz')) === 'https://apps.apple.com/app/id6809463633')
check('iOS staging, sans fiche → TestFlight',
  dit(urlsStore('ios', 'app.viniz.staging', null)) === 'itms-beta:// | https://testflight.apple.com/')
check('Android → market puis repli https',
  dit(urlsStore('android', 'be.dopamineclub.app', null))
    === 'market://details?id=be.dopamineclub.app | https://play.google.com/store/apps/details?id=be.dopamineclub.app')
check('Android, store_url puis market puis https', urlsStore('android', 'app.viniz', 'https://exemple.test/x').length === 3)
check('store_url vide → ignoré', dit(urlsStore('ios', 'app.viniz', '   ')) === 'https://apps.apple.com/app/id6809463633')
check('store_url au schéma inattendu → ignoré', urlsStore('android', 'app.viniz', 'javascript:alert(1)').length === 2)
check('store_url en http simple → ignoré', urlsStore('android', 'app.viniz', 'http://exemple.test').length === 2)
check('store_url identique au repli → pas de doublon',
  urlsStore('android', 'app.viniz', 'market://details?id=app.viniz').length === 2)
check('Android sans bundle → rien', urlsStore('android', null, null).length === 0)
check('web → rien', urlsStore('web', 'app.viniz', null).length === 0)

console.log(failures === 0 ? '\n✅ versionMinimale : tout passe' : `\n🔴 versionMinimale : ${failures} échec(s)`)
process.exit(failures === 0 ? 0 : 1)
