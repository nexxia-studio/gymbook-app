import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useGymStore } from '@/stores/useGymStore'

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════════════╗
 * ║  GYM-363 — LA RÈGLE D'IDENTITÉ LÉGALE SE LIT AU SERVEUR, ELLE NE SE RECOPIE PLUS     ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════╝
 *
 * 🔴 CE QUE J'AI TROUVÉ EN LISANT LES DEUX CÔTÉS — et c'est très exactement la divergence
 * que ce lot avait pour consigne d'éviter, sauf qu'elle EXISTAIT DÉJÀ.
 *
 * `lib/gymLegalIdentity.ts` porte `REQUIRED_LEGAL_FIELDS`, SIX champs :
 *     legal_name · vat_number · legal_address · legal_postal_code · legal_city · email
 *
 * La fonction SQL `gym_legal_identity_missing`, celle qui décide vraiment — c'est elle que
 * lit `gym_legal_identity_complete`, et donc le cockpit — en porte SEPT (lue le 28/09) :
 *     … les six ci-dessus, PLUS `vat_exempt_mention` QUAND `vat_exempt IS TRUE`.
 *     « Seule règle conditionnelle : la franchise dispense de facturer la TVA, pas de
 *       l'expliquer. »
 *
 * ⚠️ CONSÉQUENCE CONCRÈTE, pas théorique : une salle en franchise de TVA sans mention voit
 * son bandeau de Réglages annoncer que tout est en ordre, pendant que le serveur la déclare
 * incomplète et lui refuse l'encaissement. Le commentaire de `MollieConnectCard` affirme
 * même que les deux listes sont « celle-là même » — c'était vrai à l'écriture, ça ne l'est
 * plus. Aucune salle n'est aujourd'hui en franchise (vérifié en production), donc personne
 * n'est encore tombé dedans.
 *
 * Ce hook est la réponse : UN SEUL endroit interroge la règle, et c'est le serveur qui la
 * détient. L'assistant, le bandeau de Réglages et la carte Mollie lisent tous les trois
 * cette liste-là.
 *
 * ⚠️ `missingLegalFields` N'EST PAS SUPPRIMÉ pour autant : il sert encore au gabarit des
 * CGV publiques, qui travaille sur un objet déjà en main et SANS session — il ne peut pas
 * appeler un RPC par champ. Les deux coexistent avec des rôles distincts, et celui-ci est
 * le seul qui décide.
 */
export interface LegalIdentityStatus {
  /** Champs manquants, dans l'ordre du serveur. `null` tant qu'on ne sait pas. */
  missing: string[] | null
  /** `true` dès qu'on SAIT que tout est rempli — jamais par défaut. */
  complete: boolean
  loading: boolean
  /**
   * À rejouer après un enregistrement : la règle est au serveur, pas dans le formulaire.
   *
   * ⚠️ IL REND LA LISTE, il ne se contente pas de la poser dans l'état. Un appelant qui
   * doit DÉCIDER juste après (l'assistant : « puis-je terminer ? ») ne peut pas lire un
   * `useState` qui vient d'être écrit — il lirait la valeur du rendu précédent. Rendre la
   * valeur évite un second aller-retour, et surtout évite de décider sur du périmé.
   */
  refresh: () => Promise<string[] | null>
}

export function useLegalIdentityStatus(): LegalIdentityStatus {
  const gym = useGymStore((s) => s.gym)
  const gymId = gym?.id ?? null
  const [missing, setMissing] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (): Promise<string[] | null> => {
    if (!gymId) return null
    setLoading(true)
    const { data, error } = await supabase.rpc('gym_legal_identity_missing', { p_gym_id: gymId })
    setLoading(false)
    // ⚠️ UNE ERREUR N'EST PAS « TOUT EST EN ORDRE ». `missing` reste `null` : l'appelant
    // saura qu'il ne sait pas, au lieu de laisser passer une salle incomplète — ou de
    // l'accuser à tort. C'est la même règle que `detectSatisfiedSteps` : dans le doute,
    // l'étape reste ouverte.
    if (error) {
      console.error('[legal-identity] lecture impossible:', error)
      return null
    }
    const liste = Array.isArray(data) ? data : []
    setMissing(liste)
    return liste
  }, [gymId])

  useEffect(() => { void load() }, [load])

  return {
    missing,
    complete: missing !== null && missing.length === 0,
    loading,
    refresh: load,
  }
}
