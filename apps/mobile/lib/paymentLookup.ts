// GYM-374 — LA LECTURE D'UNE LIGNE `payments` PAR SA CLÉ, à un seul endroit.
//
// Elle vivait dans le poll de `app/payment/success.tsx`. La fiche du cours en a besoin à
// son tour (décider sur le statut RÉEL du paiement, plus sur la présence de l'intention) :
// la clé de recherche est EXTRAITE ici plutôt que réécrite, pour que les deux écrans ne
// puissent pas chercher le même paiement de deux façons différentes.
//
// ⚠️ RLS : « Membres voient leurs paiements » — `member_id = auth.uid()`, SELECT. Mesuré
// sur la prod le 12/10 : c'est la seule policy de lecture côté membre, et elle suffit.
// Elle n'a AUCUNE clause de salle (cf. GYM-294 dans success.tsx).
import { supabase } from './supabase'
import { runNetworkSafe } from './networkError'

export interface ClePaiement {
  /** payments.id — porté par le deep link (?id=…). Prioritaire, plus précis. */
  rowId?: string
  /** mollie_payment_id — rendu au client par create-payment / create-subscription. */
  mollieId?: string
}

/**
 * Requête sur UNE ligne `payments` par sa clé. `null` si aucune clé n'est connue.
 * `rowId` prime sur `mollieId`, comme dans le poll d'origine.
 */
export function requetePaiement(cle: ClePaiement, colonnes: string) {
  const query = supabase.from('payments').select(colonnes)
  if (cle.rowId) return query.eq('id', cle.rowId)
  if (cle.mollieId) return query.eq('mollie_payment_id', cle.mollieId)
  return null
}

/**
 * Statut d'un paiement par son id Mollie — `null` si introuvable, illisible ou hors ligne.
 *
 * ⚠️ `null` NE VEUT PAS DIRE « pas payé ». C'est l'inconnu, et `issueDuRetour` le classe
 * comme tel (ambigu) : on ne rouvre jamais d'office l'achat sur une lecture ratée.
 */
export async function lireStatutPaiement(mollieId: string): Promise<string | null> {
  const query = requetePaiement({ mollieId }, 'status')
  if (!query) return null
  try {
    const res = await runNetworkSafe(async () => await query.maybeSingle())
    if (res.offline) return null
    const data = res.data.data as { status?: string } | null
    return data?.status ?? null
  } catch {
    return null
  }
}
