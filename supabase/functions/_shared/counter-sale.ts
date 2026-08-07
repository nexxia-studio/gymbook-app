// GYM-222 — L'ENCAISSEMENT AU COMPTOIR, extrait d'admin-create-member.
//
// POURQUOI CE MODULE EXISTE
// Jusqu'ici, encaisser espèces/terminal n'était possible qu'à la CRÉATION d'un membre
// (admin-create-member, GYM-144/167/189). Une fois le membre inscrit, plus aucun chemin :
// « Julie a fini sa carte, elle en rachète une » était impossible depuis sa fiche.
//
// La tentation était d'écrire un second encaissement dans une nouvelle fonction. C'est
// exactement le défaut corrigé par GYM-218 (deux moteurs de sanction) et GYM-216 (données
// en dur d'un côté, en base de l'autre) : deux implémentations de la même opération
// DIVERGENT — l'une gagne une garde, l'autre pas, et la comptabilité de la salle s'écarte
// selon le bouton cliqué. Le geste est donc extrait ICI, et les deux chemins l'appellent.
//
// ⚠️ CE MODULE NE CONNAÎT NI L'APPELANT NI LE MEMBRE. Il ne fait ni auth, ni contrôle de
// rôle, ni vérification d'appartenance à la salle — c'est le travail de chaque Edge
// Function, qui seule sait ce qu'elle a en entrée (données d'inscription vs member_id).
// Le gymId reçu ici DOIT déjà venir du profil de l'appelant, jamais d'un body.
//
// ─── LA FRONTIÈRE, TELLE QU'ELLE A ÉTÉ RELEVÉE DANS admin-create-member ──────────────
// Relève de la CRÉATION DU MEMBRE (reste dans admin-create-member) :
//   validation prénom/nom/email · auth.admin.createUser + EMAIL_EXISTS · email
//   d'invitation (generateLink 'recovery' + Resend) · lien de téléchargement de l'app.
// Relève de l'ENCAISSEMENT (déplacé ici) :
//   résolution serveur du prix · gardes d'achat sur la formule · ligne payments ·
//   apply_paid_payment · facture GYM-167.
//
// 🔴 LE SEUL VRAI COUPLAGE EST UN ORDRE, PAS UNE DONNÉE. admin-create-member résout et
// valide le plan AVANT de créer le compte (« échec de plan = rien créé ») puis n'encaisse
// qu'APRÈS, une fois l'user_id connu. D'où la découpe en DEUX temps ci-dessous —
// `resolveSellablePlan` (gardes, sans effet de bord) et `collectCounterPayment`
// (exécution) — et non une fonction unique : l'appelant intercale ce qu'il veut entre les
// deux. Sur la fiche membre, les deux temps s'enchaînent simplement.
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolvePlan, ResolvedPlan } from './plan-resolver.ts'
import { ACTIVE_SUBSCRIPTION_STATUSES, notExpiredFilter } from './active-subscription.ts'

/**
 * Moyens d'encaissement hors-ligne.
 *
 * ⚠️ CES DEUX VALEURS, ET AUCUNE AUTRE. Ce sont celles réellement présentes dans
 * payments.payment_method (constat base staging, INV-2026-0001..0005). En inventer une
 * troisième créerait une catégorie de chiffre d'affaires que ni /revenus ni les factures
 * ne savent lire.
 */
export type PaymentMethod = 'cash' | 'card_terminal'

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return value === 'cash' || value === 'card_terminal'
}

/** Refus métier prêt à être renvoyé tel quel par l'appelant (status + code + message). */
export interface CounterSaleRefusal {
  status: number
  code: string
  message: string
}

/**
 * GARDES D'ACHAT PORTANT SUR LA FORMULE — reprises À L'IDENTIQUE d'admin-create-member,
 * codes et statuts HTTP compris (le dashboard et l'app mobile mappent déjà ces codes).
 *
 * Aucun effet de bord : peut être appelée avant que le membre existe.
 *
 * Ce qui est vérifié :
 *   · la formule existe, appartient à la salle et est ACTIVE            → 404 PLAN_NOT_FOUND
 *   · elle se paie EN UNE FOIS (un abonnement récurrent Mollie ne
 *     s'enregistre pas à la main)                                      → 422 PLAN_NOT_ONE_TIME
 *   · elle est correctement configurée pour SA NATURE (GYM-189) :
 *     durée pour un 'unlimited', crédits pour une carte                → 422 PLAN_MISCONFIGURED
 *
 * Le PRIX vient de gym_plans via resolve_plan_for_payment (SECURITY DEFINER, service_role).
 * Aucun montant client n'entre jamais dans le calcul, sur aucun des deux chemins.
 */
export async function resolveSellablePlan(
  admin: SupabaseClient,
  gymId: string,
  planId: string,
): Promise<{ plan: ResolvedPlan; refusal?: never } | { plan?: never; refusal: CounterSaleRefusal }> {
  const plan = await resolvePlan(admin, gymId, planId)
  if (!plan) {
    return { refusal: { status: 404, code: 'PLAN_NOT_FOUND', message: 'Formule introuvable ou inactive' } }
  }
  if (!plan.is_one_time) {
    return {
      refusal: {
        status: 422,
        code: 'PLAN_NOT_ONE_TIME',
        message: 'Un abonnement récurrent ne peut pas être enregistré manuellement',
      },
    }
  }
  // GYM-189 — ce qui rend une formule « mal configurée » dépend de sa NATURE, pas de la
  // présence de crédits : un abonnement payé en une fois n'a légitimement pas de
  // credit_count, mais sans duration_months apply_paid_payment ouvrirait un abonnement
  // sans terme.
  if (plan.plan_type === 'unlimited') {
    if (plan.duration_months == null || plan.duration_months <= 0) {
      return { refusal: { status: 422, code: 'PLAN_MISCONFIGURED', message: 'Formule mal configurée (durée invalide)' } }
    }
  } else if (plan.credit_count == null || plan.credit_count <= 0) {
    return { refusal: { status: 422, code: 'PLAN_MISCONFIGURED', message: 'Formule mal configurée (crédits invalides)' } }
  }

  // GYM-193 — OMISSION VOLONTAIRE, NE PAS « CORRIGER », ET DÉSORMAIS PARTAGÉE.
  // La limite gym_plans.once_per_member (offre de découverte : un achat par membre) n'est
  // PAS appliquée au comptoir. Elle encadre le LIBRE-SERVICE (app membre, create-payment →
  // 409 PLAN_ALREADY_USED) ; face au comptoir c'est le gérant qui est juge : geste
  // commercial, offre refaite à un proche, séance d'essai offerte une seconde fois après
  // une longue absence, rétrofacturation litigieuse à rattraper (cf. le commentaire
  // CONSUMING_STATUSES de create-payment, qui désigne nommément cette dérogation).
  // Cette dérogation vaut donc maintenant AUSSI pour la vente à un membre existant —
  // c'est un élargissement du périmètre où elle s'applique, à valider par Antoine.
  return { plan }
}

/**
 * GYM-94 / GYM-191 / GYM-195 — GARDE PROPRE AU MEMBRE EXISTANT : un abonnement en cours
 * ouvre déjà un accès illimité, lui vendre des crédits c'est lui faire payer pour rien, et
 * lui ouvrir un second abonnement doublonnerait son engagement.
 *
 * 🔴 CETTE GARDE N'A PAS D'ÉQUIVALENT DANS admin-create-member, ET CE N'EST PAS UN OUBLI :
 * un compte créé quelques millisecondes plus tôt ne PEUT pas porter d'abonnement. Elle
 * serait du code mort sur ce chemin. C'est la seule asymétrie entre les deux appelants.
 *
 * « En cours » = statut ouvrant des droits ET terme non dépassé, per _shared/
 * active-subscription.ts. Un abonnement échu que le cron n'a pas encore passé 'expired' ne
 * doit RIEN bloquer : ce serait refuser la vente exactement au moment du réabonnement.
 *
 * ⚠️ ÉCART ASSUMÉ AVEC create-payment, À ARBITRER (cf. compte-rendu) : create-payment
 * teste encore `status = 'active'` seul, son commentaire GYM-94 étant antérieur à GYM-195
 * qui a établi que 'canceling' ouvre encore des droits (accès maintenu jusqu'au terme,
 * engagement ferme GYM-113). On s'appuie ici sur la définition CENTRALISÉE — la seule qui
 * ne se périme pas — plutôt que de recopier un prédicat que GYM-191 a justement extrait
 * parce qu'il divergeait dans quatre fonctions. Aligner create-payment est un autre lot.
 */
export async function findBlockingSubscription(
  admin: SupabaseClient,
  gymId: string,
  memberId: string,
  isUnlimited: boolean,
): Promise<CounterSaleRefusal | null> {
  const { data: activeSub } = await admin
    .from('member_subscriptions')
    .select('id')
    .eq('member_id', memberId)
    .eq('gym_id', gymId)
    .in('status', ACTIVE_SUBSCRIPTION_STATUSES)
    .or(notExpiredFilter())
    .limit(1)
    .maybeSingle()

  if (!activeSub) return null

  // Code inchangé (SUBSCRIPTION_ACTIVE) : l'app mobile le mappe déjà, le dashboard le
  // mappe depuis GYM-222. Le message diffère selon ce qui a été tenté — le gérant a
  // quelqu'un devant lui, « refusé » ne lui dit pas quoi faire.
  return {
    status: 409,
    code: 'SUBSCRIPTION_ACTIVE',
    message: isUnlimited
      ? 'Un abonnement est déjà actif'
      : 'Accès illimité déjà actif — achat de crédits inutile',
  }
}

/** Ce qui a été encaissé et délivré. `warning` renseigné = l'argent est saisi mais pas la contrepartie. */
export interface CounterSaleOutcome {
  payment: { id: string; status: string; credits: number; delivered?: string; subscription_id?: string }
  /** 'PAYMENT_NOT_RECORDED' (aucune ligne payments) | 'CREDITS_NOT_APPLIED' (ligne posée, rien délivré). */
  warning?: 'PAYMENT_NOT_RECORDED' | 'CREDITS_NOT_APPLIED'
  invoiceSent: boolean
}

/**
 * L'ENCAISSEMENT PROPREMENT DIT — ligne payments, contrepartie, facture.
 *
 * 🔴 C'EST CE BLOC QUI DISTINGUE UNE VENTE D'UN AJUSTEMENT DE CRÉDITS (GYM-182), et c'est
 * la raison d'être de GYM-222 : passer une vente par adjust-credits donnerait le crédit
 * SANS ligne payments, SANS facture, SANS TVA, SANS chiffre d'affaires. L'argent entrerait
 * en caisse sans qu'aucune écriture ne le trace.
 *
 * ⚠️ NE JAMAIS REMPLACER apply_paid_payment PAR UN INSERT member_credits. Le RPC est
 * atomique et idempotent (GYM-71), il pose payment_method/paid_at, et c'est LUI qui décide
 * de la contrepartie selon la nature du plan (GYM-189) : crédits cumulés en upsert pour
 * une carte, member_subscriptions pour un 'unlimited'. Les crédits s'ADDITIONNENT à
 * l'existant — un membre qui a encore 2 crédits peut en racheter, c'est voulu (GYM-94).
 *
 * Ne lève jamais : un échec est rapporté dans `warning`, à charge de l'appelant d'en faire
 * un avertissement (le membre vient d'être créé, on ne peut plus reculer) ou une erreur
 * dure (rien d'autre à préserver). Les deux chemins n'ont pas le même arbitrage.
 */
export async function collectCounterPayment(
  admin: SupabaseClient,
  params: {
    gymId: string
    memberId: string
    plan: ResolvedPlan
    paymentMethod: PaymentMethod
    /** Préfixe des logs, pour retrouver l'appelant dans les traces. */
    logPrefix: string
  },
): Promise<CounterSaleOutcome> {
  const { gymId, memberId, plan, paymentMethod, logPrefix } = params
  const isUnlimited = plan.plan_type === 'unlimited'
  const paymentRowId = crypto.randomUUID()

  // NULL pour un abonnement : c'est la convention du code (credits_granted > 0 ⇒ vente à
  // l'unité) sur laquelle s'appuient /revenus et create-refund pour distinguer les deux.
  const creditsGranted = isUnlimited ? null : plan.credit_count

  const { error: insertErr } = await admin.from('payments').insert({
    id: paymentRowId,
    gym_id: gymId,
    member_id: memberId,
    plan_id: plan.plan_id,
    plan_name: plan.name,
    amount: plan.price_cents / 100,
    currency: plan.currency,
    credits_granted: creditsGranted,
    status: 'pending',
    // Paiement hors-ligne : pas de mollie_payment_id ni de checkout_url, et aucune
    // commission Viniz (nexxia_fee) — l'argent n'est jamais passé par Mollie.
    // payment_method (cash / card_terminal) est posé par apply_paid_payment.
  })

  if (insertErr) {
    console.error(`${logPrefix} payment insert failed:`, insertErr)
    return {
      payment: { id: paymentRowId, status: 'failed', credits: 0 },
      warning: 'PAYMENT_NOT_RECORDED',
      invoiceSent: false,
    }
  }

  const { data: rpcResult, error: rpcErr } = await admin.rpc('apply_paid_payment', {
    p_payment_id: paymentRowId,
    p_payment_method: paymentMethod,
    p_paid_at: new Date().toISOString(),
  })

  // GYM-189 — le RPC renvoie du jsonb ; `result` conserve exactement les valeurs de
  // l'ancien retour texte, seul l'accès change.
  const applied = (rpcResult ?? {}) as { result?: string; delivered?: string; subscription_id?: string }
  if (rpcErr || (applied.result !== 'applied' && applied.result !== 'already_applied')) {
    console.error(`${logPrefix} apply_paid_payment failed:`, rpcErr, rpcResult)
    // La ligne payments existe et reste 'pending' : l'incident est traçable dans /revenus,
    // rien n'est perdu silencieusement.
    return {
      payment: { id: paymentRowId, status: 'pending', credits: 0 },
      warning: 'CREDITS_NOT_APPLIED',
      invoiceSent: false,
    }
  }

  // GYM-167 — facture générée et envoyée au membre. Best-effort : une facture non partie
  // ne doit jamais annuler un encaissement réel ni la contrepartie déjà délivrée.
  const invoiceSent = await sendInvoiceEmail(admin, paymentRowId, logPrefix)

  return {
    payment: {
      id: paymentRowId,
      status: 'paid',
      credits: plan.credit_count ?? 0,
      ...(applied.delivered ? { delivered: applied.delivered } : {}),
      ...(applied.subscription_id ? { subscription_id: applied.subscription_id } : {}),
    },
    invoiceSent,
  }
}

// GYM-167 — appel INTERNE à generate-invoice (X-Internal-Secret → contourne le contrôle de
// rôle membre/gym_admin, l'appelant ici étant une fonction et non une personne).
async function sendInvoiceEmail(admin: SupabaseClient, paymentId: string, logPrefix: string): Promise<boolean> {
  try {
    const secret = Deno.env.get('INTERNAL_FUNCTIONS_SECRET') ?? ''
    const { data, error } = await admin.functions.invoke('generate-invoice', {
      body: { payment_id: paymentId, mode: 'email' },
      headers: secret ? { 'X-Internal-Secret': secret } : undefined,
    })
    if (error) {
      console.error(`${logPrefix} invoice send failed:`, error)
      return false
    }
    return (data as { success?: boolean } | null)?.success === true
  } catch (e) {
    console.error(`${logPrefix} invoice send threw:`, e)
    return false
  }
}
