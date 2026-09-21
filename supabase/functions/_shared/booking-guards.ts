// GYM-226 — LES GARDES D'UNE RÉSERVATION, une seule fois.
//
// POURQUOI CE MODULE EXISTE. Le dashboard obtient un second chemin de réservation
// (admin-book-member : le GÉRANT inscrit un tiers à un cours futur) à côté du chemin
// libre-service existant (create-booking : le MEMBRE se réserve lui-même). Les deux
// posent EXACTEMENT les mêmes questions à la base — abonnement encore ouvrant, crédit
// disponible, plafond de réservations à venir — et seule l'identité du sujet change.
//
// Recopier ces lectures dans la nouvelle fonction, c'était accepter qu'elles
// divergent au premier ajustement. Le dépôt en a déjà fait les frais : GYM-191 a dû
// rattraper le prédicat « abonnement encore valide » dans QUATRE Edge Functions parce
// qu'il y avait été dupliqué (cf. _shared/active-subscription.ts, dont ce module est le
// prolongement direct).
//
// ⚠️ CE MODULE ÉTAIT UNE EXTRACTION PURE — chaque fonction reproduisait à l'identique la
// requête de create-booking, sans qu'aucune règle ne soit ajoutée, retirée ni assouplie.
// CE N'EST PLUS VRAI DEPUIS LE 21/09, et il faut le lire ici plutôt que le découvrir :
// `checkMemberQuota` (le quota de MEMBRES du plan, rejoué à chaque réservation) a été
// RETIRÉ des deux chemins. Le pourquoi tient sous le bloc `getMaxActiveBookings`
// ci-dessous ; en une phrase : cette garde ne protégeait pas l'entrée de la salle, elle
// en fermait la sortie à des membres qui avaient déjà payé.
//
// Les trois autres lectures, elles, restent à l'identique — abonnement ouvrant, crédit
// disponible, réservations à venir. Le chemin membre, seul chemin de réservation en
// production sur iOS, ne change sur AUCUNE de ces trois.
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ACCESS_SUBSCRIPTION_STATUSES, notExpiredFilter } from './active-subscription.ts'

/**
 * GYM-196 — LE PLAFOND DE RÉSERVATIONS SIMULTANÉES de la salle. `null` = aucune limite.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════════════════╗
 * ║  🔴 CE QUI A ÉTÉ RETIRÉ ICI : `checkMemberQuota` — le quota de MEMBRES à la           ║
 * ║  RÉSERVATION. Décision produit (Antoine, 21/09) : « on ne casse jamais ce qu'un       ║
 * ║  membre a déjà payé ».                                                                ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════╝
 *
 * La limite de membres d'un plan Viniz borne l'ARRIVÉE d'un nouveau membre. Elle n'a
 * jamais eu à borner la RÉSERVATION d'un membre déjà présent — et la rejouer ici produisait
 * exactement le contraire de ce que le plan facture :
 *
 *   1. 🔴 UNE SALLE AU-DELÀ DE SA LIMITE BLOQUAIT TOUS SES MEMBRES. Une salle de 40 membres
 *      retombée en Free (15) ne refusait pas le 41ᵉ arrivant — elle refusait les 40 déjà
 *      là, y compris les abonnés en cours. Et leurs prélèvements SEPA, eux, continuaient :
 *      aucun webhook de renouvellement ne regarde le plan de la salle. DÉBITÉ ET BLOQUÉ.
 *
 *   2. 🔴 ELLE LISAIT LA COLONNE `nexxia_gyms.plan`, PAS LE PLAN EFFECTIF. Elle ignorait
 *      donc l'essai : le jour où l'essai de 14 jours s'allume, une salle de plus de 15
 *      membres en essai Pro aurait été bloquée PENDANT son essai, par la colonne `free`
 *      qu'elle porte encore. Les quatre gardes d'arrivée, elles, lisent bien le plan
 *      effectif (vérifié en base, cf. recette) : cette lecture-ci était la seule fausse.
 *
 *   3. 🔴 `>=` SUR UN CHEMIN QUI N'AJOUTE PERSONNE. Une salle Free à EXACTEMENT 15 membres
 *      — le nombre que le plan AUTORISE — ne pouvait plus rien réserver. Sur une garde
 *      d'arrivée, `>=` est juste (on refuse le 16ᵉ). Ici il n'y a pas de 16ᵉ : le membre
 *      est déjà compté dans les 15. Ce défaut-là ne se corrige pas, il disparaît avec le
 *      contrôle.
 *
 * ⚠️ LES QUATRE GARDES D'ARRIVÉE SUFFISENT, et elles comptent déjà sur `member_gyms` avec
 * le MÊME prédicat, à la lettre (GYM-102 / GYM-283 / GYM-338 / GYM-348) :
 *     handle_new_user · admin-create-member · join_gym_self_serve · invite-team-member
 * Retirer ce cinquième contrôle ne rouvre donc aucune porte d'entrée : il n'en gardait
 * aucune. Il gardait la sortie.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE FONCTION SUBSISTE PLUTÔT QUE DE DISPARAÎTRE AVEC LE QUOTA
 * ─────────────────────────────────────────────────────────────────────────────────────
 * `checkMemberQuota` rendait DEUX choses sans rapport l'une avec l'autre : le verdict du
 * quota, et `max_active_bookings` — au motif que la ligne `nexxia_gyms` était de toute
 * façon lue. Le plafond de réservations à venir (GYM-196) est une règle VIVANTE, réglée
 * par salle, et les deux appelants s'en servent. Supprimer la fonction entière l'aurait
 * emporté avec le quota. Elle est donc réduite à ce qu'elle a toujours dû être : la
 * lecture d'une limite, sans verdict.
 *
 * ⚠️ REPLI FAIL-OPEN, ET C'EST UN CHANGEMENT ASSUMÉ. Si la lecture échoue, on rend `null`
 * — aucun plafond — et la réservation passe. Avant, une lecture en échec faisait rendre
 * `PLAN_NOT_FOUND` et REFUSAIT la réservation. Une panne de lecture passagère ne doit pas
 * fermer la salle à des membres qui ont payé : c'est la même politique que le décompte de
 * membres appliquait déjà, et c'est la décision produit du 21/09 appliquée jusqu'au bout.
 */
export async function getMaxActiveBookings(
  supabase: SupabaseClient,
  gymId: string,
): Promise<number | null> {
  const { data: gym } = await supabase
    .from('nexxia_gyms')
    .select('max_active_bookings')
    .eq('id', gymId)
    .single()

  return (gym?.max_active_bookings as number | null) ?? null
}

/**
 * GYM-63 / GYM-191 / GYM-195 — abonnement qui ouvre encore des droits sur cette salle.
 *
 * Le terme compte autant que le statut : un abonnement échu ne doit plus ouvrir de
 * réservation sans débit de crédit, même si le cron d'expiration a du retard. 'canceling'
 * compte comme actif — le membre a payé et reste engagé jusqu'au terme, lui débiter un
 * crédit ici serait le faire payer deux fois.
 *
 * Le booléen retourné alimente `p_has_subscription` de create_booking_atomic : c'est LUI
 * qui décide si la RPC débite un crédit.
 */
/**
 * GYM-252 — RENOMMÉE DEPUIS `hasActiveSubscription`.
 *
 * L'ancien nom disait « actif », un mot qui a fini par recouvrir DEUX questions : le droit
 * d'accès, et le blocage d'un nouvel achat (GYM-94). Elles divergent sur `suspended` — pas
 * de droits, mais achat bloqué — et un booléen nommé « actif » ne peut pas servir les deux.
 * Cette fonction ne répond qu'à la PREMIÈRE. Pour la seconde :
 * `findPurchaseBlockingSubscription` dans _shared/active-subscription.ts.
 */
export async function hasAccessRights(
  supabase: SupabaseClient,
  memberId: string,
  gymId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('member_subscriptions')
    .select('id')
    .eq('member_id', memberId)
    .eq('gym_id', gymId)
    .in('status', ACCESS_SUBSCRIPTION_STATUSES)
    .or(notExpiredFilter())
    .maybeSingle()

  return !!data
}

/**
 * GYM-94 — disponibilité crédit, avec la MÊME sélection que la RPC : au moins une ligne
 * avec (credits_total - credits_used) > 0, via la colonne générée credits_remaining.
 *
 * ⚠️ PAS de `.limit(1)` : c'est précisément ce qui masquait des crédits cumulés et
 * provoquait un faux 402.
 */
export async function hasAvailableCredits(
  supabase: SupabaseClient,
  memberId: string,
  gymId: string,
): Promise<boolean> {
  const { count } = await supabase
    .from('member_credits')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', memberId)
    .eq('gym_id', gymId)
    .gt('credits_remaining', 0)

  return (count ?? 0) > 0
}

/**
 * GYM-196 — nombre de réservations CONFIRMÉES encore à venir, pour le plafond
 * nexxia_gyms.max_active_bookings.
 *
 * Compte volontairement sur TOUTES les salles du membre, comme le fait create-booking :
 * le plafond lu est celui de la salle du créneau, mais le décompte n'est pas restreint
 * (un membre n'appartient qu'à une salle — profiles.gym_id est unique et immuable
 * depuis GYM-203).
 */
export async function countFutureConfirmedBookings(
  supabase: SupabaseClient,
  memberId: string,
): Promise<number> {
  const { count } = await supabase
    .from('bookings')
    .select('id, time_slots!inner(starts_at)', { count: 'exact', head: true })
    .eq('member_id', memberId)
    .eq('status', 'confirmed')
    .gte('time_slots.starts_at', new Date().toISOString())

  return count ?? 0
}
