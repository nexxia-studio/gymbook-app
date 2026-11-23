// GYM-386 — BANC DES TEXTES DE RAPPEL.
//
//     deno run supabase/functions/send-reminders/reminder-texts_test.ts
//
// ⚠️ AUCUNE DÉPENDANCE, AUCUN RÉSEAU. Script à corps de module : lire la sortie et le code
// de sortie, pas « N passed ».
import { composeReminderTexts, fuseauSalle, FUSEAU_REPLI } from './reminder-texts.ts'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const BXL = 'Europe/Brussels'

console.log('rappel 2h — heure exacte, aucune durée')
{
  // Mardi 24 novembre 2026, 18:00 à Bruxelles (heure d'hiver, UTC+1).
  const t = composeReminderTexts('2h', 'Hyrox', '2026-11-24T17:00:00+00:00', BXL)
  check('titre inchangé', t.pushTitle === "C'est bientôt ! 🏃", t.pushTitle)
  check('corps « Hyrox à 18:00 — à tout à l\'heure ! »', t.pushBody === "Hyrox à 18:00 — à tout à l'heure !", t.pushBody)
  check('aucune durée écrite', !/dans\s+\d|2\s?h\b/i.test(t.pushBody), t.pushBody)
  check('pas d\'email pour le 2h', t.emailSubject === null && t.emailTitle === null)
  // Le même cours, quelle que soit l'heure d'envoi : le texte ne dépend que du cours.
  const cours = ['2026-11-24T16:30:00Z', '2026-11-24T17:00:00Z', '2026-11-24T17:30:00Z']
    .map((s) => composeReminderTexts('2h', 'Hyrox', s, BXL).pushBody)
  check('cours rapprochés 17:30 / 18:00 / 18:30 distingués',
    cours.join(' | ') === "Hyrox à 17:30 — à tout à l'heure ! | Hyrox à 18:00 — à tout à l'heure ! | Hyrox à 18:30 — à tout à l'heure !", cours.join(' | '))
  check('heure d\'été : 18:00 local = 16:00 UTC',
    composeReminderTexts('2h', 'Yoga', '2026-07-07T16:00:00Z', BXL).pushBody === "Yoga à 18:00 — à tout à l'heure !")
  check('accepte un objet Date', composeReminderTexts('2h', 'Yoga', new Date('2026-07-07T16:00:00Z'), BXL).heure === '18:00')
}

console.log('passage à l\'heure d\'hiver (dimanche 25/10/2026, 03:00 → 02:00 à Bruxelles)')
{
  const veille = composeReminderTexts('24h', 'Hyrox', '2026-10-24T16:00:00Z', BXL)
  check('samedi 24/10 : 18:00 local = 16:00 UTC', veille.quand === 'Hyrox samedi 24 octobre à 18:00', veille.quand)
  const jourJ = composeReminderTexts('24h', 'Hyrox', '2026-10-25T17:00:00Z', BXL)
  check('dimanche 25/10 : 18:00 local = 17:00 UTC', jourJ.quand === 'Hyrox dimanche 25 octobre à 18:00', jourJ.quand)
  check('une constante +2 aurait dit 19:00', composeReminderTexts('2h', 'Hyrox', '2026-10-25T17:00:00Z', BXL).heure !== '19:00')
  check('02:30 la première fois (00:30 UTC)', composeReminderTexts('2h', 'Nuit', '2026-10-25T00:30:00Z', BXL).heure === '02:30')
  check('02:30 la seconde fois (01:30 UTC)', composeReminderTexts('2h', 'Nuit', '2026-10-25T01:30:00Z', BXL).heure === '02:30')
  check('passage à l\'heure d\'été (29/03/2026) : 18:00 local = 16:00 UTC',
    composeReminderTexts('2h', 'Hyrox', '2026-03-29T16:00:00Z', BXL).heure === '18:00')
}

console.log('rappel 24h — le jour réel, jamais « demain »')
{
  const t = composeReminderTexts('24h', 'Hyrox', '2026-11-24T17:00:00Z', BXL)
  check('sujet « Rappel — Hyrox mardi 24 novembre à 18:00 »', t.emailSubject === 'Rappel — Hyrox mardi 24 novembre à 18:00', String(t.emailSubject))
  check('titre « Rappel — votre cours mardi 24 novembre »', t.emailTitle === 'Rappel — votre cours mardi 24 novembre', String(t.emailTitle))
  check('aucun « demain »', ![t.emailSubject, t.emailTitle, t.quand, t.pushBody].some((s) => /demain/i.test(String(s))))
  check('push 24h : titre inchangé', t.pushTitle === 'Rappel cours 🏋️', t.pushTitle)
  check('push 24h : « Hyrox mardi 24 novembre à 18:00 »', t.pushBody === 'Hyrox mardi 24 novembre à 18:00', t.pushBody)
  check('push 24h dans le fuseau de la salle (New York : lundi 23 à 18:15 pour 23:15 UTC)',
    composeReminderTexts('24h', 'Hyrox', '2026-11-23T23:15:00Z', 'America/New_York').pushBody === 'Hyrox lundi 23 novembre à 18:15')
  check('push 24h, cours à 00:15 : le bon jour',
    composeReminderTexts('24h', 'Hyrox', '2026-11-23T23:15:00Z', BXL).pushBody === 'Hyrox mardi 24 novembre à 00:15')
  check('push 24h sans nom d\'activité', composeReminderTexts('24h', null, '2026-11-24T17:00:00Z', BXL).pushBody === 'Cours mardi 24 novembre à 18:00')

  // Cours à 00:15 le mardi 24 : 23:15 UTC le lundi 23.
  const minuit = composeReminderTexts('24h', 'Open Gym', '2026-11-23T23:15:00Z', BXL)
  check('juste après minuit : mardi 24 novembre à 00:15', minuit.quand === 'Open Gym mardi 24 novembre à 00:15', minuit.quand)
  check('minuit s\'écrit 00, pas 24', composeReminderTexts('2h', 'Open Gym', '2026-11-23T23:00:00Z', BXL).heure === '00:00')
  check('juste avant minuit : lundi 23 novembre à 23:45',
    composeReminderTexts('24h', 'Open Gym', '2026-11-23T22:45:00Z', BXL).quand === 'Open Gym lundi 23 novembre à 23:45')
  check('1er du mois : « dimanche 1 novembre »',
    composeReminderTexts('24h', 'Hyrox', '2026-11-01T17:00:00Z', BXL).jour === 'dimanche 1 novembre')
}

console.log('activité sans nom')
for (const vide of [null, undefined, '', '   ']) {
  const t = composeReminderTexts('2h', vide, '2026-11-24T17:00:00Z', BXL)
  check(`« ${String(vide)} » → Cours`, t.pushBody === "Cours à 18:00 — à tout à l'heure !", t.pushBody)
}
check('24h sans nom', composeReminderTexts('24h', null, '2026-11-24T17:00:00Z', BXL).emailSubject === 'Rappel — Cours mardi 24 novembre à 18:00')

console.log('fuseau de la salle')
{
  const instant = '2026-11-24T23:30:00Z'
  check('Bruxelles : mercredi 25 à 00:30', composeReminderTexts('24h', 'Yoga', instant, BXL).quand === 'Yoga mercredi 25 novembre à 00:30')
  check('New York : mardi 24 à 18:30', composeReminderTexts('24h', 'Yoga', instant, 'America/New_York').quand === 'Yoga mardi 24 novembre à 18:30')
  check('Lisbonne : 23:30', composeReminderTexts('2h', 'Yoga', instant, 'Europe/Lisbon').heure === '23:30')
  for (const mauvais of [null, undefined, '', '  ', 'Mars/Olympus', 42]) {
    check(`fuseau « ${String(mauvais)} » → repli Bruxelles`,
      fuseauSalle(mauvais) === FUSEAU_REPLI && composeReminderTexts('2h', 'Yoga', instant, mauvais).heure === '00:30')
  }
  check('fuseau valide conservé', composeReminderTexts('2h', 'Yoga', instant, ' America/New_York ').fuseau === 'America/New_York')
}

console.log('date illisible')
{
  let leve = false
  try { composeReminderTexts('2h', 'Yoga', 'pas une date', BXL) } catch { leve = true }
  check('lève plutôt que d\'écrire « Invalid Date »', leve)
}

console.log(failures === 0 ? '\n✅ reminder-texts : tout passe' : `\n🔴 reminder-texts : ${failures} échec(s)`)
Deno.exit(failures === 0 ? 0 : 1)
