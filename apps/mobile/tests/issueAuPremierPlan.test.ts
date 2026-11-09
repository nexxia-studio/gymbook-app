// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  GYM-379 — AU RETOUR DU NAVIGATEUR, SEUL UN ÉCHEC TERMINAL ARRÊTE L'ATTENTE           ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
//     cd apps/mobile && npx tsx tests/issueAuPremierPlan.test.ts
//
// ⚠️ SCRIPT À CORPS DE MODULE, comme `deepLinkTarget.test.ts` : pas de cadre de test dans
// ce dépôt. Lire la sortie et le code de sortie.
//
// CE QU'IL PROTÈGE : la feuille « Payer cette séance » rend les options d'achat au membre
// quand il revient du navigateur SANS avoir payé — mais JAMAIS sur un statut ambigu.
// Rouvrir l'achat sur `open`, c'est inviter à repayer quelqu'un dont le webhook tarde : sur
// `open`, on propose de reprendre le MÊME checkout (compléments du 09/11).
import { gardeAvantAchat, issueAuPremierPlan, issueFinAttente, nouveauPaiementAutorise } from '../lib/paymentStatus'

let failures = 0
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${label}`)
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\nCAS 1 — échec terminal : on arrête l\'attente et on rend les options')
for (const statut of ['canceled', 'cancelled', 'expired', 'failed']) {
  const issue = issueAuPremierPlan(statut)
  check(`${statut} → abandonner`, issue === 'abandonner', issue)
}

console.log('\nCAS 2 — payé : on laisse la boucle existante voir le crédit')
{
  const issue = issueAuPremierPlan('paid')
  check('paid → attendre', issue === 'attendre', issue)
}

console.log('\nCAS 3 — non finalisé : annulé chez la banque (aucun webhook), navigateur fermé, ou webhook en retard')
for (const statut of ['open', 'pending']) {
  const issue = issueAuPremierPlan(statut)
  // 🔴 LE POINT DU BANC : jamais `abandonner` (rouvrir les options exposerait au double
  // paiement) — on propose la reprise du MÊME checkout.
  check(`${statut} → proposer_reprise`, issue === 'proposer_reprise', issue)
}

console.log('\nCAS 4 — inconnu : ligne introuvable ou lecture hors ligne')
{
  const issue = issueAuPremierPlan(null)
  check('null → attendre', issue === 'attendre', issue)
}

console.log('\nCAS 5 — paiement précédent `open` : JAMAIS de nouveau checkout')
for (const statut of ['open', 'pending', 'paid', null]) {
  check(`précédent ${statut} → pas de nouveau paiement`, nouveauPaiementAutorise('tr_1', statut) === false)
}
for (const statut of ['failed', 'canceled', 'expired']) {
  check(`précédent ${statut} → nouveau paiement possible`, nouveauPaiementAutorise('tr_1', statut) === true)
}
check('aucun paiement précédent → nouveau paiement possible', nouveauPaiementAutorise(undefined, null) === true)

// GYM-379 (passe finale, point 4) — l'illisible n'est plus « non finalisé » : il menait à
// « Reprendre » sur un checkout dont on ne savait rien.
console.log('\nCAS 6 — fin des 5 min, réouverture ou tap sur « Reprendre » : `open` seul rouvre, l\'illisible ne propose rien')
for (const [statut, attendu] of [
  ['open', 'non_finalise'],
  ['pending', 'non_finalise'],
  [null, 'illisible'],
  ['authorized', 'illisible'],
  ['paid', 'paye'],
  ['expired', 'options'],
  ['canceled', 'options'],
  ['failed', 'options'],
] as const) {
  const issue = issueFinAttente(statut)
  check(`${statut} → ${attendu}`, issue === attendu, issue)
}

// GYM-379 (passe finale, point 1) — un achat depuis Profil n'écrase jamais un paiement vivant.
console.log('\nCAS 7 — avant un achat depuis Profil : le paiement de l\'intention en cours décide')
for (const [paymentId, statut, attendu] of [
  [undefined, null, 'libre'],
  ['tr_1', 'open', 'paiement_en_cours'],
  ['tr_1', 'pending', 'paiement_en_cours'],
  ['tr_1', 'paid', 'conserver'],
  ['tr_1', 'expired', 'libre'],
  ['tr_1', 'canceled', 'libre'],
  ['tr_1', 'failed', 'libre'],
  ['tr_1', null, 'illisible'],
] as const) {
  const garde = gardeAvantAchat(paymentId, statut)
  check(`${paymentId ?? 'sans paiement'} / ${statut} → ${attendu}`, garde === attendu, garde)
}

console.log(failures === 0 ? '\n✅ banc complet — 0 échec\n' : `\n❌ ${failures} échec(s)\n`)
if (failures > 0) process.exit(1)
