// GYM-346 — BANC DU CLASSEMENT DES ÉCHECS MOLLIE.
//
//     deno test supabase/functions/_shared/mollie-error_test.ts
//
// ⚠️ AUCUNE DÉPENDANCE, comme les bancs de GYM-313/319/336 et pour la même raison : le
// dépôt n'a ni `import_map` ni `deno.json` côté functions. Les fonctions testées sont
// PURES — le banc tourne hors ligne, sans Mollie et sans base.
//
// ⚠️ GYM-350 — `deno test` affichera « 0 passed » : ce banc est un script à corps de
// module, pas une suite `Deno.test()`. Le corps s'exécute en « pre-test output » et un
// échec rend bien exit 1. Lire la sortie du banc et le code de sortie, pas la ligne
// « N passed ». Voir docs/ops/preuves-controle-de-types.md §4.
//
// CE QUE CE BANC PROTÈGE : la distinction 422 / 502 — celle qui a fait retenter trois fois
// une requête vouée à échouer — et le fait que le détail Mollie ne ressorte JAMAIS dans le
// message rendu au membre.
import {
  classifyMollieHttpError,
  classifyMollieNetworkError,
  redactSecrets,
  TOKEN_OUTCOMES,
} from './mollie-error.ts'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  ✓ ${label}`)
  } else {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// ── Le corps type d'un refus Mollie, tel qu'il arrive réellement ──
const REFUS_422 = JSON.stringify({
  status: 422,
  title: 'Unprocessable Entity',
  detail: 'The amount is lower than the minimum',
  field: 'amount',
})

const METHODE_422 = JSON.stringify({
  status: 422,
  title: 'Unprocessable Entity',
  detail: 'No suitable payment method found for this profile',
  field: 'method',
})

console.log('\nCAS 1 — 422 : DÉFINITIF, la même requête sera refusée à l\'identique')
{
  const o = classifyMollieHttpError(422, REFUS_422)
  check('definitive = true', o.definitive === true)
  check('code distinct MOLLIE_REFUSED', o.code === 'MOLLIE_REFUSED', `obtenu : ${o.code}`)
  check('statut rendu = 422', o.status === 422, `obtenu : ${o.status}`)
  check('le message NE CONTIENT PAS le détail Mollie',
    !o.message.includes('minimum') && !o.message.includes('amount'),
    `obtenu : ${o.message}`)
}

console.log('\nCAS 2 — 502 : INCERTAIN, réessayer a du sens')
{
  const o = classifyMollieHttpError(502, '<html>Bad Gateway</html>')
  check('definitive = false', o.definitive === false)
  check('code distinct MOLLIE_UNAVAILABLE', o.code === 'MOLLIE_UNAVAILABLE', `obtenu : ${o.code}`)
  check('statut rendu = 502', o.status === 502, `obtenu : ${o.status}`)
  check('un corps NON-JSON ne fait pas lever', true)
}

console.log('\nCAS 2b — les autres 5xx suivent le même sort')
for (const s of [500, 503, 504]) {
  const o = classifyMollieHttpError(s, '')
  check(`${s} → incertain`, o.definitive === false && o.code === 'MOLLIE_UNAVAILABLE')
}

console.log('\nCAS 3 — 422 « moyen de paiement » : code À PART, et toujours définitif')
{
  const o = classifyMollieHttpError(422, METHODE_422)
  check('code MOLLIE_METHOD_UNAVAILABLE', o.code === 'MOLLIE_METHOD_UNAVAILABLE', `obtenu : ${o.code}`)
  check('definitive = true', o.definitive === true)
  check('le message reste générique',
    !o.message.includes('profile') && !o.message.includes('suitable'),
    `obtenu : ${o.message}`)
}

console.log('\nCAS 4 — 401/403 : Mollie refuse NOTRE jeton, le membre n\'y peut rien')
for (const s of [401, 403]) {
  const o = classifyMollieHttpError(s, '')
  check(`${s} → MOLLIE_TOKEN_REJECTED et définitif`,
    o.code === 'MOLLIE_TOKEN_REJECTED' && o.definitive === true)
}

console.log('\nCAS 5 — 429 : définitif pour CETTE requête, incertain pour la suivante')
{
  const o = classifyMollieHttpError(429, '')
  check('classé incertain — réessayer est la bonne conduite', o.definitive === false)
  check('code MOLLIE_UNAVAILABLE', o.code === 'MOLLIE_UNAVAILABLE')
}

console.log('\nCAS 6 — pas de réponse du tout (réseau, timeout) : toujours incertain')
{
  const o = classifyMollieNetworkError()
  check('definitive = false', o.definitive === false)
  check('code MOLLIE_UNAVAILABLE', o.code === 'MOLLIE_UNAVAILABLE')
}

console.log('\nCAS 7 — la porte du jeton distingue ses trois causes')
{
  check('NOT_CONNECTED → MOLLIE_NOT_CONNECTED',
    TOKEN_OUTCOMES.NOT_CONNECTED.code === 'MOLLIE_NOT_CONNECTED')
  check('REFRESH_FAILED → MOLLIE_TOKEN_REJECTED',
    TOKEN_OUTCOMES.REFRESH_FAILED.code === 'MOLLIE_TOKEN_REJECTED')
  check('CONNECTION_REVOKED → MOLLIE_NOT_CONNECTED',
    TOKEN_OUTCOMES.CONNECTION_REVOKED.code === 'MOLLIE_NOT_CONNECTED')
  check('les trois sont définitifs — réessayer ne répare rien',
    Object.values(TOKEN_OUTCOMES).every((o) => o.definitive === true))
}

console.log('\nCAS 8 — AUCUN message rendu au membre ne porte de détail Mollie')
{
  const tous = [
    classifyMollieHttpError(422, REFUS_422),
    classifyMollieHttpError(422, METHODE_422),
    classifyMollieHttpError(502, '<html>Bad Gateway</html>'),
    classifyMollieHttpError(401, ''),
    classifyMollieHttpError(429, ''),
    classifyMollieNetworkError(),
    ...Object.values(TOKEN_OUTCOMES),
  ]
  check('aucun message ne cite le corps Mollie',
    tous.every((o) => !/minimum|suitable|Bad Gateway|Unprocessable/i.test(o.message)))
  check('tous les messages sont non vides', tous.every((o) => o.message.length > 0))
}

console.log('\nCAS 9 — le secret du rappel est caviardé avant journalisation')
{
  const url = 'https://x.supabase.co/functions/v1/mollie-webhook?secret=s3cr3t-r33l&gym_id=abc'
  const out = redactSecrets(url)
  check('le secret a disparu', !out.includes('s3cr3t-r33l'), out)
  check('le reste de l\'URL est conservé', out.includes('gym_id=abc'), out)
  check('fonctionne dans un payload JSON entier',
    !redactSecrets(JSON.stringify({ webhookUrl: url })).includes('s3cr3t-r33l'))
}

console.log(failures === 0 ? '\n✅ banc complet — 0 échec\n' : `\n❌ ${failures} échec(s)\n`)
if (failures > 0) throw new Error(`${failures} échec(s)`)
