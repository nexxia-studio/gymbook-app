// LOT A — BANC DES GARDES DE RÉSERVATION, CÔTÉ TYPESCRIPT.
//
//     deno run supabase/functions/_shared/booking-guards_test.ts
//
// ⚠️ AUCUNE DÉPENDANCE, AUCUN RÉSEAU, comme les autres bancs `_shared` (GYM-313/319/336/346)
// et pour la même raison : le dépôt n'a ni `import_map` ni `deno.json` côté functions.
// Le client Supabase est REMPLACÉ par un faux qui enregistre ce qu'on lui demande — c'est
// ce qui permet de vérifier la REQUÊTE, pas seulement la valeur rendue.
//
// ⚠️ GYM-350 — `deno test` affichera « 0 passed » : script à corps de module, pas une suite
// `Deno.test()`. Lire la sortie du banc et le code de sortie. Voir
// docs/ops/preuves-controle-de-types.md §4.
//
// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  CE QUE CE BANC PROTÈGE                                                               ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
// Le banc SQL (supabase/tests/gym_booking_quota.sql) prouve le COMPORTEMENT en base : une
// salle au-delà de sa limite laisse réserver ses membres et refuse un nouveau venu. Il ne
// peut pas, lui, exécuter le TypeScript des Edge Functions.
//
// C'est ce que fait ce banc-ci, et c'est sa seule raison d'être : il exécute le module
// réellement importé par create-booking et admin-book-member, et il vérifie
//   · que le quota de MEMBRES n'y est plus — l'export a disparu, pas seulement son appel ;
//   · que `getMaxActiveBookings` ne lit QUE `max_active_bookings`, sur la BONNE salle ;
//   · qu'il ne rend JAMAIS de verdict — aucune valeur de retour ne peut refuser quoi que
//     ce soit, c'est un entier ou rien.
import * as guards from './booking-guards.ts'
import { getMaxActiveBookings } from './booking-guards.ts'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  ✓ ${label}`)
  } else {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/**
 * Faux client : il note la table, les colonnes et le filtre, puis rend ce qu'on lui a dit
 * de rendre. Assez pour attester la requête ; rien de plus, pour ne rien attester de faux.
 */
interface Trace { table?: string; columns?: string; eqColumn?: string; eqValue?: unknown }
// deno-lint-ignore no-explicit-any
function fauxClient(retour: { data: unknown }, trace: Trace): any {
  return {
    from(table: string) {
      trace.table = table
      return {
        select(columns: string) {
          trace.columns = columns
          return {
            eq(column: string, value: unknown) {
              trace.eqColumn = column
              trace.eqValue = value
              return { single: () => Promise.resolve(retour) }
            },
          }
        },
      }
    },
  }
}

console.log('\nCAS 1 — le quota de MEMBRES a disparu du module, export compris')
{
  const exports = Object.keys(guards).sort()
  check('`checkMemberQuota` n\'est plus exporté', !('checkMemberQuota' in guards),
    exports.join(', '))
  check('`getMaxActiveBookings` l\'a remplacé', typeof guards.getMaxActiveBookings === 'function')
  check('les trois autres gardes sont intactes',
    typeof guards.hasAccessRights === 'function'
    && typeof guards.hasAvailableCredits === 'function'
    && typeof guards.countFutureConfirmedBookings === 'function',
    exports.join(', '))
  // 🔴 LE POINT QUI COMPTE : le module n'exporte plus AUCUNE fonction capable de dire
  // « cette salle est pleine ». S'il en réapparaissait une, elle serait ici, et ce banc
  // le dirait — c'est la seule façon d'empêcher la garde de revenir par la fenêtre.
  check('aucun export ne parle de quota ni de membres',
    !exports.some((e) => /quota|member(?!Gyms)/i.test(e) && e !== 'countFutureConfirmedBookings'),
    exports.join(', '))
}

console.log('\nCAS 2 — la lecture porte sur la BONNE salle, et sur une seule colonne')
{
  const trace: Trace = {}
  const cap = await getMaxActiveBookings(
    fauxClient({ data: { max_active_bookings: 3 } }, trace), 'gym-42')
  check('table nexxia_gyms', trace.table === 'nexxia_gyms', String(trace.table))
  check('colonne max_active_bookings, et elle seule',
    trace.columns === 'max_active_bookings', String(trace.columns))
  // ⚠️ `plan` NE DOIT PLUS ÊTRE LU. C'était la lecture qui ignorait l'essai (défaut n°2) :
  // si elle revenait, elle reviendrait par ce `select`.
  check('la colonne `plan` n\'est plus lue', !String(trace.columns).includes('plan'),
    String(trace.columns))
  check('filtre sur l\'identifiant de la salle du créneau',
    trace.eqColumn === 'id' && trace.eqValue === 'gym-42',
    `${trace.eqColumn}=${String(trace.eqValue)}`)
  check('rend le plafond tel quel', cap === 3, String(cap))
}

console.log('\nCAS 3 — aucune valeur de retour ne peut refuser une réservation')
{
  const t1: Trace = {}
  const nul = await getMaxActiveBookings(fauxClient({ data: { max_active_bookings: null } }, t1), 'g')
  check('plafond NULL → null (aucune limite)', nul === null, String(nul))

  // 🔴 LE CŒUR DE LA DÉCISION PRODUIT DU 21/09. Salle introuvable, panne de lecture,
  // réponse vide : AUCUN de ces cas ne doit refuser la réservation d'un membre qui a payé.
  // Avant, la même panne rendait `PLAN_NOT_FOUND` et le membre était bloqué.
  const t2: Trace = {}
  const absente = await getMaxActiveBookings(fauxClient({ data: null }, t2), 'g')
  check('salle introuvable → null, PAS un refus', absente === null, String(absente))

  const t3: Trace = {}
  const vide = await getMaxActiveBookings(fauxClient({ data: {} }, t3), 'g')
  check('ligne sans la colonne → null, PAS un refus', vide === null, String(vide))

  const t4: Trace = {}
  const zero = await getMaxActiveBookings(fauxClient({ data: { max_active_bookings: 0 } }, t4), 'g')
  // ⚠️ 0 EST UNE VALEUR, PAS UN VIDE. Une salle qui règle son plafond à 0 interdit toute
  // réservation à venir — c'est son droit, et `?? null` ne doit pas l'écraser en « aucune
  // limite ». C'est exactement le piège que `||` aurait posé.
  check('un plafond de 0 est conservé, pas confondu avec « aucune limite »', zero === 0, String(zero))
}

console.log(failures === 0 ? '\n✅ banc complet — 0 échec\n' : `\n❌ ${failures} échec(s)\n`)
if (failures > 0) throw new Error(`${failures} échec(s)`)
