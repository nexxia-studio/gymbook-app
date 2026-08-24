import { LegalDocPage } from './LegalDocPage'

/**
 * GYM-265 — CGV DE LA SALLE (la salle ↔ son membre).
 *
 * ⚠️ CE DOCUMENT N'EST PAS CELUI DE VINIZ. Le vendeur est la salle, résolue depuis l'URL
 * (?gym=<slug>, et le sous-domaine quand GYM-201 sera en service). Sans salle résolue, la
 * page explique que les CGV sont propres à chaque salle et où trouver les siennes.
 */
export default function Terms() {
  return (
    <LegalDocPage
      kind="terms"
      title="Conditions générales de vente — Viniz"
      description="Conditions générales de vente de votre salle : compte, formules, paiements, réservations, rétractation et abonnements."
    />
  )
}
