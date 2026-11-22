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
//
// 🔴 GYM-379 (passe finale) — MAIS CE N'EST PAS LA SEULE POLICY. Un `gym_admin` lit TOUS
// les paiements de sa salle : connecté avec ce rôle, une clé partagée ou devinée rendait le
// paiement d'un autre membre — et la fiche du cours aurait décidé d'une réservation sur le
// statut d'autrui. La requête filtre donc AUSSI `member_id` = le membre connecté. Sans
// membre connu, pas de requête du tout.
import { supabase } from './supabase'
import { runNetworkSafe } from './networkError'

export interface ClePaiement {
  /** payments.id — porté par le deep link (?id=…). Prioritaire, plus précis. */
  rowId?: string
  /** mollie_payment_id — rendu au client par create-payment / create-subscription. */
  mollieId?: string
}

/** Le membre connecté, lu dans la session locale (aucun aller-retour réseau). */
export async function membreConnecte(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.user?.id ?? null
  } catch {
    return null
  }
}

/**
 * Requête sur UNE ligne `payments` par sa clé, POUR CE MEMBRE. `null` si aucune clé ou
 * aucun membre n'est connu. `rowId` prime sur `mollieId`, comme dans le poll d'origine.
 */
export function requetePaiement(cle: ClePaiement, colonnes: string, memberId: string | null) {
  if (!memberId) return null
  const query = supabase.from('payments').select(colonnes).eq('member_id', memberId)
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
  const query = requetePaiement({ mollieId }, 'status', await membreConnecte())
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
