import { LegalDocPage } from './LegalDocPage'

/**
 * GYM-265 — CGU DE LA PLATEFORME (Nexxia ↔ le gérant).
 *
 * Document NOUVEAU : il n'existait aucun contrat entre l'éditeur et l'exploitant. C'est
 * celui que /signup fait désormais accepter, à la place des CGV d'une salle — auxquelles
 * un gérant n'est pas partie.
 */
export default function Cgu() {
  return (
    <LegalDocPage
      kind="cgu"
      title="Conditions générales d'utilisation — Viniz"
      description="Conditions d'utilisation de la plateforme Viniz par un exploitant de salle : objet, formules, commissions, responsabilités, données et résiliation."
    />
  )
}
