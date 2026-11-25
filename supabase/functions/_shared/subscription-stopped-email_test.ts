// GYM-190 — BANC DE L'EMAIL « ABONNEMENT ARRÊTÉ PAR LA SALLE ».
//
//     deno test --no-check supabase/functions/_shared/subscription-stopped-email_test.ts
//
// AUCUN RÉSEAU, AUCUNE BASE : le module compose, il n'envoie rien.
import type { GymBranding } from './gym-branding.ts'

// ⚠️ IMPORT DYNAMIQUE, ET C'EST VOULU. `gym-branding.ts` lit `DASHBOARD_URL` au chargement ;
// `deno test` tourne sans `--allow-env` et l'import statique ferait tomber tout le banc
// (NotCapable). Le temps du chargement, la lecture d'environnement rend « absent » : le
// module prend alors son repli, exactement comme en production sans la variable.
// Rien de ce qui est testé ici ne dépend de cette variable.
const lireEnv = Deno.env.get
Deno.env.get = () => undefined
const { buildSubscriptionStoppedEmail, formatEndDate, langueDe } = await import('./subscription-stopped-email.ts')
Deno.env.get = lireEnv

function eq(actual: unknown, expected: unknown, message = ''): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${message}\n  attendu : ${e}\n  obtenu  : ${a}`)
}
function ok(cond: boolean, message: string): void {
  if (!cond) throw new Error(message)
}

const TIRETS = /[—–]/
const VOUVOIEMENT = /(^|[^\p{L}])(vous|votre|vos)(?![\p{L}])/iu

const branding: GymBranding = {
  name: 'Salle du Banc', slug: 'banc', address: '1 rue du Test', postalCode: '4000', city: 'Liège',
  email: 'contact@banc.test', phone: null, logoUrl: null, primaryColor: '#C8FF3D', secondaryColor: '#2D1B69',
}
// Minuit à Bruxelles, donc LA VEILLE en UTC : 23:00 en hiver (UTC+1), 22:00 en été (UTC+2).
const HIVER = '2026-12-14T23:00:00.000Z' // 15 décembre 2026, 00:00 à Bruxelles
const ETE = '2026-07-14T22:00:00.000Z' // 15 juillet 2026, 00:00 à Bruxelles
const base = {
  branding, firstName: 'Alex', planName: 'Illimité', endsAt: HIVER, timeZone: 'Europe/Brussels',
  cancelledBookings: 0, langue: 'fr' as const,
}

// ─── DATE DE FIN, DANS LE FUSEAU DE LA SALLE ─────────────────────────────────────────
Deno.test('date : hiver, 23:00 UTC la veille se lit le 15 décembre', () => {
  eq(formatEndDate(HIVER, 'Europe/Brussels'), '15 décembre 2026')
})
Deno.test('date : été, 22:00 UTC la veille se lit le 15 juillet', () => {
  eq(formatEndDate(ETE, 'Europe/Brussels'), '15 juillet 2026')
})
Deno.test('date : le fuseau de la salle commande, pas celui du serveur', () => {
  eq(formatEndDate(HIVER, 'UTC'), '14 décembre 2026')
  eq(formatEndDate(HIVER, 'America/New_York'), '14 décembre 2026')
})
Deno.test('date : fuseau absent ou inconnu, celui du schéma (Europe/Brussels), jamais UTC', () => {
  eq(formatEndDate(HIVER, null), '15 décembre 2026')
  eq(formatEndDate(HIVER, undefined), '15 décembre 2026')
  eq(formatEndDate(HIVER, ''), '15 décembre 2026')
  eq(formatEndDate(ETE, 'Pas/UnFuseau'), '15 juillet 2026')
})
Deno.test('date : en anglais', () => {
  eq(formatEndDate(HIVER, 'Europe/Brussels', 'en'), '15 December 2026')
})

// ─── LANGUE ──────────────────────────────────────────────────────────────────────────
Deno.test('langue : en pour « en », fr pour tout le reste', () => {
  eq(['en', 'EN', 'en-GB'].map(langueDe), ['en', 'en', 'en'])
  eq(['fr', 'nl', 'de', 'lb', '', null, undefined].map(langueDe), ['fr', 'fr', 'fr', 'fr', 'fr', 'fr', 'fr'])
})

// ─── CONTENU ─────────────────────────────────────────────────────────────────────────
Deno.test('fr : formule, date de fin, plus de prélèvement, nouvelle formule pour revenir', () => {
  const mail = buildSubscriptionStoppedEmail(base)
  eq(mail.subject, "Ton abonnement Illimité s'arrête le 15 décembre 2026")
  ok(mail.html.includes('Bonjour Alex,'), 'salutation')
  ok(mail.html.includes('<strong>Illimité</strong>'), 'formule')
  ok(mail.html.includes("s'arrête le <strong>15 décembre 2026</strong>"), 'date de fin')
  ok(mail.html.includes('Aucun autre prélèvement ne sera effectué'), 'prélèvements')
  ok(mail.html.includes('souscrire une nouvelle formule'), 'retour')
  ok(mail.html.includes('Salle du Banc'), 'salle')
  ok(mail.html.startsWith('<!doctype html>'), 'coquille emailShell')
})

Deno.test('date de fin en été : le 15 juillet, pas le 14', () => {
  const mail = buildSubscriptionStoppedEmail({ ...base, endsAt: ETE })
  ok(mail.subject.endsWith('15 juillet 2026'), mail.subject)
  ok(mail.html.includes('15 juillet 2026') && !mail.html.includes('14 juillet'), 'corps')
})

Deno.test('réservations annulées : rien à zéro, singulier, pluriel', () => {
  const zero = buildSubscriptionStoppedEmail(base).html
  ok(!/réservation/i.test(zero), 'zéro réservation : aucune mention')
  const une = buildSubscriptionStoppedEmail({ ...base, cancelledBookings: 1 }).html
  ok(une.includes('1 réservation prévue après cette date a été annulée.'), 'singulier')
  const trois = buildSubscriptionStoppedEmail({ ...base, cancelledBookings: 3 }).html
  ok(trois.includes('3 réservations prévues après cette date ont été annulées.'), 'pluriel')
})

Deno.test('sans prénom ni nom de formule : aucune valeur vide ni « null » affichée', () => {
  const mail = buildSubscriptionStoppedEmail({ ...base, firstName: null, planName: null })
  eq(mail.subject, "Ton abonnement s'arrête le 15 décembre 2026")
  ok(mail.html.includes('<p style="color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 16px;">Bonjour,</p>'), 'salutation sans prénom')
  ok(!/null|undefined|<strong>\s*<\/strong>|  /.test(mail.subject + mail.html.replace(/<style>.*<\/style>/s, '')), 'ni null ni blanc double')
})

Deno.test('les valeurs venues de la base sont échappées', () => {
  const mail = buildSubscriptionStoppedEmail({
    ...base, firstName: '<b>Al</b>', planName: 'Duo & <script>x</script>',
    branding: { ...branding, name: 'Salle <i>&</i>' },
  })
  ok(!/<script>|<b>Al|<i>/.test(mail.html), 'aucune balise injectée')
  ok(mail.html.includes('Duo &amp; &lt;script&gt;x&lt;/script&gt;'), 'formule échappée')
  ok(mail.html.includes('&lt;b&gt;Al&lt;/b&gt;'), 'prénom échappé')
  // L'objet n'est pas du HTML : la valeur y reste brute.
  ok(mail.subject.includes('Duo & <script>x</script>'), 'objet en texte brut')
})

Deno.test('en : même contenu, singulier et pluriel', () => {
  const mail = buildSubscriptionStoppedEmail({ ...base, langue: 'en', cancelledBookings: 1 })
  eq(mail.subject, 'Your Illimité membership ends on 15 December 2026')
  ok(mail.html.includes('Hello Alex,'), 'salutation')
  ok(mail.html.includes('ends on <strong>15 December 2026</strong>'), 'date')
  ok(mail.html.includes('No further payment will be taken'), 'prélèvements')
  ok(mail.html.includes('1 booking scheduled after that date has been cancelled.'), 'singulier')
  ok(mail.html.includes('sign up for a new plan'), 'retour')
  const deux = buildSubscriptionStoppedEmail({ ...base, langue: 'en', cancelledBookings: 2 }).html
  ok(deux.includes('2 bookings scheduled after that date have been cancelled.'), 'pluriel')
})

Deno.test('aucun tiret long ni demi-cadratin, objet et corps, fr et en, tous les cas', () => {
  for (const langue of ['fr', 'en'] as const) {
    for (const cancelledBookings of [0, 1, 4]) {
      for (const planName of ['Illimité', null]) {
        const mail = buildSubscriptionStoppedEmail({ ...base, langue, cancelledBookings, planName })
        ok(!TIRETS.test(mail.subject), `objet ${langue} : ${mail.subject}`)
        ok(!TIRETS.test(mail.html), `corps ${langue}, ${cancelledBookings} réservation(s)`)
      }
    }
  }
})

Deno.test('fr : tutoiement, comme les emails membres de failed-renewal-emails', () => {
  for (const cancelledBookings of [0, 1, 4]) {
    const mail = buildSubscriptionStoppedEmail({ ...base, cancelledBookings })
    ok(!VOUVOIEMENT.test(mail.subject) && !VOUVOIEMENT.test(mail.html), 'ni vous, ni votre, ni vos')
  }
})
