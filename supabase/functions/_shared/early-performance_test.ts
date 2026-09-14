// GYM-336 — BANC DE LA LECTURE DU CONSENTEMENT.
//
//     deno test supabase/functions/_shared/early-performance_test.ts
//
// ⚠️ AUCUNE DÉPENDANCE, comme les bancs de GYM-313 et GYM-319 et pour la même raison : le
// dépôt n'a ni `import_map` ni `deno.json` côté functions. La fonction testée est PURE —
// le banc tourne hors ligne, sans Mollie et sans base.
//
// CE QUE CE BANC PROTÈGE : les trois cas du cadrage (case cochée / non cochée / paramètre
// absent) et, surtout, l'invariant que la base impose de son côté par le CHECK
// `payments_early_performance_coherence` — les deux colonnes bougent ENSEMBLE ou pas du
// tout. Un jour où l'une serait posée sans l'autre, l'INSERT échouerait en production ;
// ici, il échoue au banc.
import { readEarlyPerformanceConsent, UNKNOWN_CONSENT_VERSION } from './early-performance.ts'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  ✓ ${label}`)
  } else {
    failures++
    console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`)
  }
}

/** L'invariant de la base, rejoué sur le résultat : les deux colonnes ou aucune. */
function coherent(r: { early_performance_requested_at: string | null; early_performance_consent_version: string | null }): boolean {
  return (r.early_performance_requested_at === null) === (r.early_performance_consent_version === null)
}

// ─────────────────────────────────────────────────────────────────────────────────────
// CAS 1 — CASE COCHÉE : demande enregistrée, horodatée, avec sa version
// ─────────────────────────────────────────────────────────────────────────────────────
console.log('\nCAS 1 — case cochée')
{
  const before = Date.now()
  const r = readEarlyPerformanceConsent({ early_performance_consent: true, early_performance_consent_version: '1' })
  const after = Date.now()

  check('une date est posée', r.early_performance_requested_at !== null)
  check('la version transmise est conservée', r.early_performance_consent_version === '1',
    `obtenu : ${r.early_performance_consent_version}`)
  check('les deux colonnes sont cohérentes', coherent(r))

  const ts = Date.parse(r.early_performance_requested_at ?? '')
  check("l'horodatage vient de l'horloge du serveur, à l'instant de l'appel",
    ts >= before && ts <= after, `${r.early_performance_requested_at} hors de [${before}, ${after}]`)
}

// ─────────────────────────────────────────────────────────────────────────────────────
// CAS 2 — CASE NON COCHÉE : aucune demande, et surtout aucune date
// ─────────────────────────────────────────────────────────────────────────────────────
console.log('\nCAS 2 — case non cochée')
{
  const r = readEarlyPerformanceConsent({ early_performance_consent: false, early_performance_consent_version: '1' })
  check('aucune date', r.early_performance_requested_at === null)
  // ⚠️ LE POINT QUI COMPTE : une version envoyée AVEC un refus ne doit rien écrire. Sinon
  // la ligne porterait une version sans demande — une acceptation hors du temps, que le
  // CHECK de la base refuserait.
  check('la version est ignorée malgré sa présence', r.early_performance_consent_version === null)
  check('les deux colonnes sont cohérentes', coherent(r))
}

// ─────────────────────────────────────────────────────────────────────────────────────
// CAS 3 — PARAMÈTRE ABSENT (binaire mobile antérieur) : l'achat PASSE, sans demande
// ─────────────────────────────────────────────────────────────────────────────────────
console.log('\nCAS 3 — paramètre absent (ancienne version de l\'app)')
{
  const r = readEarlyPerformanceConsent({ gym_id: 'g', plan_id: 'p', redirect_url: 'https://x' })
  check('aucune date — « aucune demande au dossier »', r.early_performance_requested_at === null)
  check('aucune version', r.early_performance_consent_version === null)
  check('les deux colonnes sont cohérentes', coherent(r))
  check('la lecture ne lève pas : le vieux binaire achète toujours', true)
}

// ─────────────────────────────────────────────────────────────────────────────────────
// CAS 4 — CE QUI N'EST PAS UN CONSENTEMENT
// ─────────────────────────────────────────────────────────────────────────────────────
// Un consentement est un booléen vrai. Rien d'autre. Une conversion en booléen aurait fait
// passer 'false' (chaîne non vide) et 1 pour des demandes expresses.
console.log('\nCAS 4 — valeurs qui ne sont pas un consentement')
for (const value of ['true', 'false', 1, 0, 'oui', null, undefined, {}, []]) {
  const r = readEarlyPerformanceConsent({ early_performance_consent: value })
  check(`${JSON.stringify(value) ?? 'undefined'} ne vaut pas consentement`,
    r.early_performance_requested_at === null)
}

// ─────────────────────────────────────────────────────────────────────────────────────
// CAS 5 — VERSION ILLISIBLE : on enregistre ce qu'on sait, on n'invente pas
// ─────────────────────────────────────────────────────────────────────────────────────
console.log('\nCAS 5 — consentement vrai, version inexploitable')
for (const bad of [undefined, null, 42, '', 'x'.repeat(33), 'v 1', 'drop table payments']) {
  const r = readEarlyPerformanceConsent({ early_performance_consent: true, early_performance_consent_version: bad })
  check(`${JSON.stringify(bad) ?? 'undefined'} → '${UNKNOWN_CONSENT_VERSION}'`,
    r.early_performance_consent_version === UNKNOWN_CONSENT_VERSION,
    `obtenu : ${r.early_performance_consent_version}`)
  check('  … et la demande reste enregistrée', r.early_performance_requested_at !== null)
}

// Formes valides acceptées telles quelles.
console.log('\nCAS 5b — versions valides conservées à l\'identique')
for (const good of ['1', '2', '2026-09', 'b4-v2', 'A_1.0']) {
  const r = readEarlyPerformanceConsent({ early_performance_consent: true, early_performance_consent_version: good })
  check(`'${good}' conservée`, r.early_performance_consent_version === good)
}

console.log(failures === 0 ? '\n✅ banc complet — 0 échec\n' : `\n❌ ${failures} échec(s)\n`)
if (failures > 0) throw new Error(`${failures} échec(s)`)
