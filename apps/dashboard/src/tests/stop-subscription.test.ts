// GYM-190 — arrêt d'un abonnement par le gérant : la DÉCISION et les TEXTES, sans navigateur.
//
//     npm --prefix apps/dashboard run test:stop-subscription
//
// Script à corps de module, comme `chunk-reload.test.ts` : pas de cadre de test dans ce
// dépôt. Lire la sortie et le code de sortie.
//
// Les textes sont lus dans les VRAIS fichiers fr.json / en.json par une vraie instance
// i18next : un code du contrat sans traduction, un pluriel manquant ou un tiret long
// font échouer ce banc, pas seulement une revue.
import i18next, { type TFunction } from 'i18next'
import fr from '../locales/fr.json'
import en from '../locales/en.json'
import { edgeErrorMessage } from '../lib/edgeErrors'
import {
  STOP_ERROR_CODES,
  STOP_REASON_MAX_LENGTH,
  canStopSubscription,
  formatGymDate,
  isStopReasonValid,
  parseStopPreview,
  parseStopResult,
  showsEndBadge,
  stopBookingsKey,
  stopModalSubtitle,
} from '../lib/stopSubscription'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}${detail ? ` (${detail})` : ''}`) }
}
function eq(label: string, got: unknown, want: unknown): void {
  check(label, got === want, `reçu ${JSON.stringify(got)}, attendu ${JSON.stringify(want)}`)
}

async function translator(lng: 'fr' | 'en'): Promise<TFunction> {
  const instance = i18next.createInstance()
  await instance.init({
    lng,
    fallbackLng: false,
    resources: { fr: { translation: fr }, en: { translation: en } },
    interpolation: { escapeValue: false },
  })
  return instance.t
}
const tFr = await translator('fr')
const tEn = await translator('en')
// edgeErrorMessage signale en console les codes inconnus : c'est voulu en production,
// c'est du bruit ici.
console.warn = () => {}

console.log('\nCAS 1 : le bouton ne se montre que pour un abonnement actif et récurrent, sur la fiche de SON membre')
{
  const A = 'membre-a'
  const sub = (over: Partial<{ status: string; mollieSubscriptionId: string | null; memberId: string | null }> = {}) =>
    ({ status: 'active', mollieSubscriptionId: 'sub_abc', memberId: A, ...over })
  eq('active avec identifiant Mollie', canStopSubscription(sub(), A), true)
  eq('active payé en une fois', canStopSubscription(sub({ mollieSubscriptionId: null }), A), false)
  eq('identifiant vide', canStopSubscription(sub({ mollieSubscriptionId: '' }), A), false)
  eq('identifiant fait d\'espaces', canStopSubscription(sub({ mollieSubscriptionId: '  ' }), A), false)
  for (const status of ['canceling', 'past_due', 'paused', 'suspended', 'completed', 'cancelled', 'expired']) {
    eq(status, canStopSubscription(sub({ status }), A), false)
  }
  eq('aucun abonnement', canStopSubscription(null, A), false)
  eq('undefined', canStopSubscription(undefined, A), false)
  // L'abonnement d'un AUTRE membre resté à l'écran (fiche A puis fiche B) : jamais de bouton.
  eq('abonnement du membre A sur la fiche du membre B', canStopSubscription(sub(), 'membre-b'), false)
  eq('aucun membre affiché (null)', canStopSubscription(sub(), null), false)
  eq('aucun membre affiché (undefined)', canStopSubscription(sub(), undefined), false)
  eq('abonnement sans membre connu', canStopSubscription(sub({ memberId: null }), A), false)
  eq('deux identifiants vides ne se valent pas', canStopSubscription(sub({ memberId: '' }), ''), false)
}

console.log('\nCAS 2 : le motif est obligatoire, les espaces ne comptent pas, 500 caractères au plus')
{
  eq('vide', isStopReasonValid(''), false)
  eq('espaces', isStopReasonValid('   '), false)
  eq('retours à la ligne et tabulations', isStopReasonValid('\n\t '), false)
  eq('un mot', isStopReasonValid('Déménagement'), true)
  eq('entouré d\'espaces', isStopReasonValid('  Déménagement  '), true)
  eq('500 caractères', isStopReasonValid('a'.repeat(STOP_REASON_MAX_LENGTH)), true)
  eq('501 caractères', isStopReasonValid('a'.repeat(STOP_REASON_MAX_LENGTH + 1)), false)
  eq('500 caractères utiles entourés d\'espaces (le serveur rogne)', isStopReasonValid(` ${'a'.repeat(500)} `), true)
  eq('la limite vaut 500', STOP_REASON_MAX_LENGTH, 500)
}

console.log('\nCAS 3 : la date de fin se lit dans le fuseau de la salle, pas en UTC')
{
  const BRU = 'Europe/Brussels'
  // Minuit à Bruxelles = 23:00 UTC la veille en hiver, 22:00 UTC la veille en été.
  eq('hiver, fr', formatGymDate('2026-12-14T23:00:00.000Z', BRU, 'fr'), '15 décembre 2026')
  eq('été, fr', formatGymDate('2026-07-14T22:00:00.000Z', BRU, 'fr'), '15 juillet 2026')
  eq('hiver, en', formatGymDate('2026-12-14T23:00:00.000Z', BRU, 'en'), '15 December 2026')
  eq('été, en', formatGymDate('2026-07-14T22:00:00.000Z', BRU, 'en'), '15 July 2026')
  eq('une minute avant minuit reste la veille', formatGymDate('2026-12-14T22:59:00.000Z', BRU, 'fr'), '14 décembre 2026')
  eq('veille du changement d\'heure d\'automne', formatGymDate('2026-10-24T22:00:00.000Z', BRU, 'fr'), '25 octobre 2026')
  eq('lendemain du changement d\'heure d\'automne', formatGymDate('2026-10-25T23:00:00.000Z', BRU, 'fr'), '26 octobre 2026')
  eq('changement d\'heure de printemps', formatGymDate('2027-03-28T22:00:00.000Z', BRU, 'fr'), '29 mars 2027')
  eq('passage d\'année', formatGymDate('2026-12-31T23:00:00.000Z', BRU, 'fr'), '1 janvier 2027')
  eq('variante régionale fr-BE', formatGymDate('2026-12-14T23:00:00.000Z', BRU, 'fr-BE'), '15 décembre 2026')
  eq('langue sans traduction (nl) : anglais, comme le repli i18n', formatGymDate('2026-12-14T23:00:00.000Z', BRU, 'nl'), '15 December 2026')
  eq('un autre fuseau donne un autre jour', formatGymDate('2026-12-14T23:00:00.000Z', 'Europe/London', 'fr'), '14 décembre 2026')
  eq('null', formatGymDate(null, BRU, 'fr'), '')
  eq('date illisible', formatGymDate('pas une date', BRU, 'fr'), '')
}

console.log('\nCAS 4 : le badge « Se termine le » couvre tout abonnement en résiliation daté')
{
  eq('canceling avec date', showsEndBadge({ status: 'canceling', endsAt: '2026-12-14T23:00:00.000Z' }), true)
  eq('canceling sans date', showsEndBadge({ status: 'canceling', endsAt: null }), false)
  eq('canceling avec date illisible', showsEndBadge({ status: 'canceling', endsAt: 'pas une date' }), false)
  eq('active avec date', showsEndBadge({ status: 'active', endsAt: '2026-12-14T23:00:00.000Z' }), false)
  eq('aucun abonnement', showsEndBadge(null), false)
  eq('texte fr', tFr('member_drawer.sub_ends_on', { date: '15 décembre 2026' }), 'Se termine le 15 décembre 2026')
  eq('texte en', tEn('member_drawer.sub_ends_on', { date: '15 December 2026' }), 'Ends on 15 December 2026')
}

console.log('\nCAS 5 : réponses de l\'aperçu (dry_run)')
{
  const apercu = parseStopPreview({
    ok: true, dry_run: true, ends_at: '2026-12-14T23:00:00.000Z', plan_name: 'Illimité',
    bookings: [
      { id: 'b1', slot_id: 's1', starts_at: '2026-12-20T09:00:00Z', activity_name: 'Yoga', status: 'confirmed' },
      { id: 'b2', slot_id: 's2', starts_at: '2026-12-21T09:00:00Z', activity_name: null, status: 'waitlisted' },
    ],
  })
  eq('aperçu : nature', apercu.kind, 'preview')
  if (apercu.kind === 'preview') {
    eq('aperçu : date', apercu.endsAt, '2026-12-14T23:00:00.000Z')
    eq('aperçu : formule', apercu.planName, 'Illimité')
    eq('aperçu : 2 réservations', apercu.bookingsCount, 2)
  }
  const sansResa = parseStopPreview({ ok: true, dry_run: true, ends_at: '2026-12-14T23:00:00.000Z', plan_name: null, bookings: [] })
  eq('aucune réservation', sansResa.kind === 'preview' && sansResa.bookingsCount, 0)
  eq('formule absente', sansResa.kind === 'preview' && sansResa.planName, null)
  const deja = parseStopPreview({ ok: true, already: true, ends_at: '2026-12-14T23:00:00.000Z' })
  eq('déjà arrêté', deja.kind, 'already')
  eq('déjà arrêté sans date reste « déjà arrêté »', parseStopPreview({ ok: true, already: true, ends_at: null }).kind, 'already')
  eq('corps vide', parseStopPreview(null).kind, 'invalid')
  eq('ok absent', parseStopPreview({ ends_at: '2026-12-14T23:00:00.000Z', bookings: [] }).kind, 'invalid')
  eq('date absente : pas de formulaire sur une date inconnue', parseStopPreview({ ok: true, dry_run: true, bookings: [] }).kind, 'invalid')
  eq('date illisible', parseStopPreview({ ok: true, dry_run: true, ends_at: 'x', bookings: [] }).kind, 'invalid')
  eq('liste de réservations absente : le nombre annoncé serait inventé', parseStopPreview({ ok: true, dry_run: true, ends_at: '2026-12-14T23:00:00.000Z' }).kind, 'invalid')
  eq('un arrêt réel reçu à la place d\'un aperçu n\'ouvre pas le formulaire',
    parseStopPreview({ ok: true, ends_at: '2026-12-14T23:00:00.000Z', mollie: 'cancelled', cancelled_bookings: [], failed_bookings: [] }).kind, 'invalid')
}

console.log('\nCAS 6 : réponses de l\'arrêt')
{
  const arret = parseStopResult({
    ok: true, ends_at: '2026-12-14T23:00:00.000Z', mollie: 'cancelled',
    cancelled_bookings: ['b1', 'b2'], failed_bookings: [{ id: 'b3', error: 'boom' }],
  })
  eq('arrêt : nature', arret.kind, 'stopped')
  if (arret.kind === 'stopped') {
    eq('arrêt : date', arret.endsAt, '2026-12-14T23:00:00.000Z')
    eq('arrêt : 2 annulées', arret.cancelledCount, 2)
    eq('arrêt : 1 en échec', arret.failedCount, 1)
  }
  const sansListes = parseStopResult({ ok: true, ends_at: '2026-12-14T23:00:00.000Z', mollie: 'already_gone' })
  eq('listes absentes : arrêt acquis, zéro échec connu', sansListes.kind === 'stopped' && sansListes.failedCount, 0)
  eq('déjà arrêté (appel concurrent)', parseStopResult({ ok: true, already: true, ends_at: '2026-12-14T23:00:00.000Z' }).kind, 'already')
  eq('corps vide', parseStopResult(undefined).kind, 'invalid')
  eq('ok false', parseStopResult({ ok: false }).kind, 'invalid')
  eq('un aperçu reçu à la place d\'un arrêt n\'est pas un succès',
    parseStopResult({ ok: true, dry_run: true, ends_at: '2026-12-14T23:00:00.000Z', plan_name: null, bookings: [] }).kind, 'invalid')
}

console.log('\nCAS 7 : nombre de réservations annoncé dans la modale (0, 1, plusieurs)')
{
  const dire = (t: TFunction, count: number) => t(stopBookingsKey(count), { count })
  eq('fr, 0', dire(tFr, 0), 'Aucune réservation ne sera annulée.')
  eq('fr, 1', dire(tFr, 1), '1 réservation sera annulée.')
  eq('fr, 3', dire(tFr, 3), '3 réservations seront annulées.')
  eq('en, 0', dire(tEn, 0), 'No bookings will be cancelled.')
  eq('en, 1', dire(tEn, 1), '1 booking will be cancelled.')
  eq('en, 3', dire(tEn, 3), '3 bookings will be cancelled.')
  eq('fr, 1 échec', tFr('member_drawer.stop.failed_bookings', { count: 1 }), '1 réservation n\'a pas pu être annulée, à annuler à la main.')
  eq('fr, 2 échecs', tFr('member_drawer.stop.failed_bookings', { count: 2 }), '2 réservations n\'ont pas pu être annulées, à annuler à la main.')
  eq('en, 1 échec', tEn('member_drawer.stop.failed_bookings', { count: 1 }), '1 booking could not be cancelled and must be cancelled manually.')
  eq('en, 2 échecs', tEn('member_drawer.stop.failed_bookings', { count: 2 }), '2 bookings could not be cancelled and must be cancelled manually.')
  eq('avertissement, mot pour mot', tFr('member_drawer.stop.warning'),
    'Les prélèvements s\'arrêtent. Pour revenir, le membre devra souscrire une nouvelle formule.')
  eq('bouton', tFr('member_drawer.stop.button'), 'Arrêter l\'abonnement')
}

console.log('\nCAS 8 : chaque refus connu a son texte, en fr et en en ; un code inconnu a le texte générique')
{
  const replisFr = tFr('edge_errors.FALLBACK')
  const replisEn = tEn('edge_errors.FALLBACK')
  for (const code of STOP_ERROR_CODES) {
    const texteFr = edgeErrorMessage(code, tFr)
    const texteEn = edgeErrorMessage(code, tEn)
    check(`${code} : fr`, texteFr !== replisFr && texteFr !== `edge_errors.${code}` && texteFr.length > 10, texteFr)
    check(`${code} : en`, texteEn !== replisEn && texteEn !== `edge_errors.${code}` && texteEn.length > 10, texteEn)
    check(`${code} : fr et en diffèrent`, texteFr !== texteEn)
  }
  // Le serveur range DEUX cas sous NOT_RECURRING (payé en une fois, ou sans identifiants
  // Mollie) : le texte doit être vrai dans les deux.
  eq('NOT_RECURRING, fr', edgeErrorMessage('NOT_RECURRING', tFr),
    'Cet abonnement n\'est pas prélevé automatiquement : il ne peut pas être arrêté ici. S\'il a été payé en une fois, le remboursement est à traiter à part.')
  eq('NOT_RECURRING, en', edgeErrorMessage('NOT_RECURRING', tEn),
    'This subscription is not charged automatically, so it cannot be stopped here. If it was paid in one go, the refund has to be handled separately.')
  eq('MOLLIE_READ_FAILED, fr', edgeErrorMessage('MOLLIE_READ_FAILED', tFr),
    'Mollie n\'a pas pu être consulté. Rien n\'a été modifié. Réessaie dans un instant.')
  eq('code inconnu, fr', edgeErrorMessage('CODE_DE_DEMAIN', tFr), replisFr)
  eq('code inconnu, en', edgeErrorMessage('CODE_DE_DEMAIN', tEn), replisEn)
  eq('code absent (panne réseau), fr', edgeErrorMessage(undefined, tFr), replisFr)
  for (const attendu of [
    'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'MISSING_SUBSCRIPTION_ID', 'REASON_REQUIRED', 'REASON_TOO_LONG',
    'NOT_STOPPABLE', 'NOT_RECURRING', 'END_DATE_UNKNOWN', 'PAYMENT_IN_FLIGHT', 'MOLLIE_NOT_CONNECTED',
    'MOLLIE_READ_FAILED', 'MOLLIE_STOP_FAILED', 'STOP_NOT_PERSISTED', 'SERVER_ERROR',
  ]) {
    check(`le contrat cite ${attendu}`, (STOP_ERROR_CODES as readonly string[]).includes(attendu))
  }
  // Une autre salle répond 404 NOT_FOUND, comme un abonnement inexistant.
  check('le contrat ne cite pas WRONG_GYM', !(STOP_ERROR_CODES as readonly string[]).includes('WRONG_GYM'))
}

console.log('\nCAS 9 : aucun tiret long ni demi-cadratin dans les textes de l\'arrêt')
{
  const TIRETS = /[—–]/
  function feuilles(node: unknown, prefix: string, out: Array<[string, string]>): void {
    if (typeof node === 'string') out.push([prefix, node])
    else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) feuilles(v, `${prefix}.${k}`, out)
    }
  }
  for (const [lng, dict] of [['fr', fr], ['en', en]] as const) {
    const textes: Array<[string, string]> = []
    feuilles(dict.member_drawer.stop, 'member_drawer.stop', textes)
    textes.push(['member_drawer.sub_ends_on', dict.member_drawer.sub_ends_on])
    const erreurs = dict.edge_errors as Record<string, string>
    for (const code of STOP_ERROR_CODES) textes.push([`edge_errors.${code}`, erreurs[code] ?? ''])
    textes.push(['edge_errors.FALLBACK', erreurs.FALLBACK])
    check(`${lng} : ${textes.length} textes relus`, textes.length > 25)
    for (const [cle, texte] of textes) {
      if (TIRETS.test(texte)) check(`${lng} ${cle}`, false, texte)
    }
    check(`${lng} : aucun tiret long`, textes.every(([, texte]) => !TIRETS.test(texte)))
  }
  // Les deux langues portent exactement les mêmes clés : une clé oubliée d'un côté
  // s'afficherait brute à l'écran.
  const clesFr: Array<[string, string]> = []
  const clesEn: Array<[string, string]> = []
  feuilles(fr.member_drawer.stop, '', clesFr)
  feuilles(en.member_drawer.stop, '', clesEn)
  eq('mêmes clés en fr et en en', clesFr.map(([k]) => k).sort().join(), clesEn.map(([k]) => k).sort().join())
  // La date de fin est le DÉBUT du jour affiché : « garde son accès jusqu'à cette date »
  // se lisait comme inclusif. La phrase est retirée, elle ne doit pas revenir.
  check('la phrase end_date_hint a disparu', !clesFr.some(([k]) => k === '.end_date_hint'))
}

console.log('\nCAS 10 : sous-titre de la modale, sans tiret quand la formule est absente')
{
  eq('nom et formule', stopModalSubtitle('Julie Martin', 'Illimité'), 'Julie Martin · Illimité')
  eq('formule absente : le nom seul', stopModalSubtitle('Julie Martin', null), 'Julie Martin')
  eq('formule vide', stopModalSubtitle('Julie Martin', '  '), 'Julie Martin')
  eq('formule undefined', stopModalSubtitle('Julie Martin', undefined), 'Julie Martin')
  check('jamais de tiret long', !/[—–]/.test(stopModalSubtitle('Julie Martin', null)))
}

console.log(failures === 0 ? '\nTOUT PASSE\n' : `\n${failures} ÉCHEC(S)\n`)
process.exit(failures === 0 ? 0 : 1)
