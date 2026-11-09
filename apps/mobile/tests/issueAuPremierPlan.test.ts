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
// Rouvrir l'achat sur `open`, c'est inviter à repayer quelqu'un dont le webhook tarde.
import { issueAuPremierPlan } from '../lib/paymentStatus'

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

console.log('\nCAS 3 — ambigu : navigateur fermé sans rien faire, ou webhook en retard')
for (const statut of ['open', 'pending']) {
  const issue = issueAuPremierPlan(statut)
  // 🔴 LE POINT DU BANC : rouvrir les options ici exposerait au double paiement.
  check(`${statut} → attendre`, issue === 'attendre', issue)
}

console.log('\nCAS 4 — inconnu : ligne introuvable ou lecture hors ligne')
{
  const issue = issueAuPremierPlan(null)
  check('null → attendre', issue === 'attendre', issue)
}

console.log(failures === 0 ? '\n✅ banc complet — 0 échec\n' : `\n❌ ${failures} échec(s)\n`)
if (failures > 0) process.exit(1)
