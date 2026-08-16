// GYM-129 — Données de la fiche membre (drawer /members).
// Toutes les lectures sont autorisées au gym_admin par les policies RLS
// (member_credits / member_subscriptions / bookings + time_slots/activities,
// USING gym_id = get_my_gym_id() AND is_gym_admin()) → lecture directe côté client,
// aucune Edge nécessaire pour lire. Seule l'écriture identité passe par une Edge.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { extractErrorCode, EdgeError } from '@/lib/edgeErrors'
import { useAuthStore } from '@/stores/useAuthStore'
import { invokeEdge } from '@/lib/edgeInvoke'

export interface CreditLine {
  planId: string
  planName: string
  total: number
  used: number
  remaining: number
}

export interface MemberSubscription {
  planName: string
  status: string
  startsAt: string
  endsAt: string | null
  amount: number | null
}

export interface RecentBooking {
  id: string
  status: string
  startsAt: string | null
  activity: string
}

// GYM-182 — une ligne du journal d'ajustements de crédits offerts.
export interface CreditAdjustment {
  id: string
  delta: number
  appliedDelta: number
  reason: string
  createdAt: string
  grantedByName: string
}

// GYM-182 — retour de l'Edge adjust-credits (miroir du jsonb de la RPC).
export interface AdjustResult {
  requested_delta: number
  applied_delta: number
  new_total: number
  new_used: number
  new_remaining: number
  adjustment_id: string
  clamped: boolean
}

// GYM-222 — une ligne de l'historique des paiements du membre.
// L'argent encaissé se lisait UNIQUEMENT dans /revenus, jamais sur la fiche : après une
// vente au comptoir, le gérant n'avait aucune confirmation sur l'écran où il venait de la
// faire. C'est aussi ce qui distingue visiblement une VENTE (ligne ici + facture) d'un
// crédit OFFERT (GYM-182, journal des ajustements, aucune écriture comptable).
export interface MemberPayment {
  id: string
  planName: string
  amount: number
  currency: string
  status: string
  /** 'cash' | 'card_terminal' | valeur Mollie | null tant que le paiement est pending. */
  method: string | null
  invoiceNumber: string | null
  at: string
}

// GYM-182 — plan_id sentinelle des crédits offerts manuellement (texte libre, pas une FK).
export const MANUAL_GRANT_PLAN_ID = 'manual_grant'

// GYM-222 — retour de l'Edge admin-sell-plan.
export interface SellResult {
  payment: { id: string; status: string; credits: number; delivered?: string; subscription_id?: string }
  invoice_sent: boolean
}

// Statuts d'abonnement AFFICHÉS dans la fiche. expired/cancelled → "aucun abonnement".
// GYM-151 — 'completed' (engagement arrivé à son terme) est affiché avec un badge « Terminé »
// (info utile au gérant) plutôt que masqué comme « aucun abonnement ».
//
// ⚠️ CETTE LISTE RÉPOND À « QUEL ABONNEMENT MONTRER ? », PAS À « OUVRE-T-IL DES DROITS ? ».
// Les deux questions ne se recouvrent pas : 'paused', 'suspended' et 'completed' méritent
// d'être VUS par le gérant sans pour autant autoriser une réservation. Le droit d'accès se
// décide ailleurs, et à un seul endroit : isSubscriptionActive (lib/subscription.ts), qui
// reprend le prédicat de la garde serveur. Ne pas fusionner les deux — remplacer cette
// liste par le prédicat de droits ferait DISPARAÎTRE de la fiche les abonnements en pause
// ou terminés, et le badge « Terminé » de GYM-151 avec eux.
//
// GYM-147 — 'canceling' AJOUTÉ. Il manquait : ce tableau est antérieur à GYM-195, qui a
// introduit le statut (résiliation demandée, accès maintenu jusqu'au terme). Un membre
// ayant résilié mais dont l'abonnement court encore n'apparaissait donc avec AUCUN
// abonnement dans sa fiche, alors que la liste /members l'affiche « Abonnement » — deux
// écrans, deux vérités sur la même donnée.
const LIVE_SUB_STATUSES = ['active', 'canceling', 'paused', 'suspended', 'completed']

export function useMemberDetail(memberId: string | null) {
  const gymId = useAuthStore((s) => s.gym_id)
  const [credits, setCredits] = useState<CreditLine[]>([])
  const [creditsRemaining, setCreditsRemaining] = useState(0)
  const [giftedRemaining, setGiftedRemaining] = useState(0)
  const [purchasedRemaining, setPurchasedRemaining] = useState(0)
  const [adjustments, setAdjustments] = useState<CreditAdjustment[]>([])
  const [payments, setPayments] = useState<MemberPayment[]>([])
  const [subscription, setSubscription] = useState<MemberSubscription | null>(null)
  const [bookings, setBookings] = useState<RecentBooking[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!memberId || !gymId) return
    setLoading(true)
    try {
      const [creditsRes, plansRes, subRes, bookingsRes, adjustmentsRes, paymentsRes] = await Promise.all([
        supabase
          .from('member_credits')
          .select('plan_id, credits_total, credits_used, credits_remaining')
          .eq('member_id', memberId),
        supabase.from('gym_plans').select('id, name').eq('gym_id', gymId),
        supabase
          .from('member_subscriptions')
          .select('plan_name, status, starts_at, ends_at, amount')
          .eq('member_id', memberId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('bookings')
          .select('id, status, booked_at, time_slots(starts_at, activities(name))')
          .eq('member_id', memberId)
          .order('booked_at', { ascending: false })
          .limit(5),
        // GYM-182 — journal des ajustements de crédits (RLS gym_admin). Le granter est embarqué
        // via la FK granted_by (désambiguïsée : deux FK vers profiles sur cette table).
        supabase
          .from('credit_adjustments')
          .select('id, delta, applied_delta, reason, created_at, granter:profiles!credit_adjustments_granted_by_fkey(first_name, last_name)')
          .eq('member_id', memberId)
          .order('created_at', { ascending: false })
          .limit(20),
        // GYM-222 — paiements du membre (RLS gym_admin : gym_id = get_my_gym_id()).
        // Filtré sur gym_id EN PLUS de member_id : la policy le ferait déjà, mais un membre
        // ayant changé de salle ne doit pas exposer le chiffre d'affaires d'une autre.
        supabase
          .from('payments')
          .select('id, plan_name, amount, currency, status, payment_method, invoice_number, paid_at, created_at')
          .eq('member_id', memberId)
          .eq('gym_id', gymId)
          .order('created_at', { ascending: false })
          .limit(10),
      ])

      const planNames = new Map<string, string>()
      for (const p of (plansRes.data ?? []) as Array<{ id: string; name: string }>) {
        planNames.set(p.id, p.name)
      }

      const creditLines: CreditLine[] = ((creditsRes.data ?? []) as Array<Record<string, unknown>>).map((c) => ({
        planId: c.plan_id as string,
        planName: planNames.get(c.plan_id as string) ?? '—',
        total: (c.credits_total as number) ?? 0,
        used: (c.credits_used as number) ?? 0,
        remaining: (c.credits_remaining as number) ?? 0,
      }))
      setCredits(creditLines)
      setCreditsRemaining(creditLines.reduce((s, c) => s + c.remaining, 0))
      // Décomposition offert (manual_grant) vs acheté (tout le reste).
      const gifted = creditLines.filter((c) => c.planId === MANUAL_GRANT_PLAN_ID).reduce((s, c) => s + c.remaining, 0)
      setGiftedRemaining(gifted)
      setPurchasedRemaining(creditLines.filter((c) => c.planId !== MANUAL_GRANT_PLAN_ID).reduce((s, c) => s + c.remaining, 0))

      const adjLines: CreditAdjustment[] = ((adjustmentsRes.data ?? []) as Array<Record<string, unknown>>).map((a) => {
        const g = a.granter as { first_name?: string; last_name?: string } | Array<{ first_name?: string; last_name?: string }> | null
        const granter = Array.isArray(g) ? g[0] : g
        const name = `${granter?.first_name ?? ''} ${granter?.last_name ?? ''}`.trim()
        return {
          id: a.id as string,
          delta: (a.delta as number) ?? 0,
          appliedDelta: (a.applied_delta as number) ?? 0,
          reason: (a.reason as string) ?? '',
          createdAt: a.created_at as string,
          grantedByName: name || '—',
        }
      })
      setAdjustments(adjLines)

      const paymentLines: MemberPayment[] = ((paymentsRes.data ?? []) as Array<Record<string, unknown>>).map((p) => ({
        id: p.id as string,
        planName: (p.plan_name as string) ?? '—',
        amount: Number(p.amount ?? 0),
        currency: (p.currency as string) ?? 'EUR',
        status: (p.status as string) ?? 'pending',
        method: (p.payment_method as string | null) ?? null,
        invoiceNumber: (p.invoice_number as string | null) ?? null,
        // paid_at fait foi quand il existe : c'est la date de l'ARGENT. created_at ne vaut
        // que pour un paiement jamais abouti (checkout abandonné), qui reste 'pending'.
        at: ((p.paid_at as string | null) ?? (p.created_at as string)) ?? '',
      }))
      setPayments(paymentLines)

      const sub = subRes.data as Record<string, unknown> | null
      if (sub && LIVE_SUB_STATUSES.includes(sub.status as string)) {
        setSubscription({
          planName: (sub.plan_name as string) ?? '—',
          status: sub.status as string,
          startsAt: sub.starts_at as string,
          endsAt: (sub.ends_at as string | null) ?? null,
          amount: (sub.amount as number | null) ?? null,
        })
      } else {
        setSubscription(null)
      }

      const recent: RecentBooking[] = ((bookingsRes.data ?? []) as Array<Record<string, unknown>>).map((b) => {
        // Embeds to-one typés en tableau par le client — tolérer objet ou tableau.
        const ts = b.time_slots as { starts_at?: string; activities?: unknown } | Array<{ starts_at?: string; activities?: unknown }> | null
        const slot = Array.isArray(ts) ? ts[0] : ts
        const act = slot?.activities as { name?: string } | Array<{ name?: string }> | null | undefined
        const activity = Array.isArray(act) ? act[0]?.name : act?.name
        return {
          id: b.id as string,
          status: b.status as string,
          startsAt: (slot?.starts_at as string | undefined) ?? null,
          activity: activity ?? '—',
        }
      })
      setBookings(recent)
    } catch (e) {
      console.error('Failed to load member detail', e)
    } finally {
      setLoading(false)
    }
  }, [memberId, gymId])

  useEffect(() => {
    if (memberId) load()
  }, [memberId, load])

  // GYM-182 — ajustement manuel via l'Edge adjust-credits (clamp + journal côté RPC).
  // Retourne le résultat (dont `clamped`) pour que l'appelant affiche le bon toast. Recharge
  // la fiche à la fin. Lève en cas d'erreur d'autorisation/validation.
  const adjustCredits = useCallback(async (delta: number, reason: string): Promise<AdjustResult> => {
    if (!memberId) throw new Error('NO_MEMBER')
    const { data, error } = await invokeEdge('adjust-credits', {
      body: { member_id: memberId, delta, reason },
    })
    // GYM-219 — INVALID_DELTA, REASON_REQUIRED et MEMBER_NOT_IN_GYM se corrigent
    // différemment : le code doit atteindre la modale.
    if (error) throw new EdgeError(await extractErrorCode(error))
    await load()
    return data as AdjustResult
  }, [memberId, load])

  // GYM-222 — vente d'une formule au comptoir à ce membre (espèces / terminal).
  //
  // 🔴 NE JAMAIS REMPLACER PAR adjustCredits. Une vente doit produire une ligne payments,
  // une facture, de la TVA et du chiffre d'affaires ; adjust-credits (GYM-182) n'écrit
  // qu'un crédit offert, et ses motifs décrivent des gestes GRATUITS. Le raccourci
  // paraîtrait équivalent à l'écran et fausserait durablement la comptabilité de la salle.
  //
  // Le PRIX n'est pas envoyé : il est résolu côté serveur depuis gym_plans. Aucun montant
  // saisi ou affiché par le dashboard n'entre dans l'écriture comptable.
  //
  // Lève une EdgeError porteuse du code (SUBSCRIPTION_ACTIVE, PLAN_MISCONFIGURED…) : ce
  // sont des refus LÉGITIMES qui doivent être expliqués au gérant, pas masqués (GYM-219).
  const sellPlan = useCallback(async (planId: string, paymentMethod: 'cash' | 'card_terminal'): Promise<SellResult> => {
    if (!memberId) throw new EdgeError('MEMBER_NOT_FOUND')
    const { data, error } = await invokeEdge('admin-sell-plan', {
      body: { member_id: memberId, plan_id: planId, payment_method: paymentMethod },
    })
    if (error) throw new EdgeError(await extractErrorCode(error))
    // Recharge AVANT de rendre la main : le solde de crédits, l'abonnement éventuellement
    // ouvert et la nouvelle ligne de paiement doivent être à l'écran quand la modale se
    // ferme. Sans ça le gérant relit un solde périmé et revend la même carte.
    await load()
    return data as SellResult
  }, [memberId, load])

  return {
    credits, creditsRemaining, giftedRemaining, purchasedRemaining, adjustments, payments,
    subscription, bookings, loading, reload: load, adjustCredits, sellPlan,
  }
}
