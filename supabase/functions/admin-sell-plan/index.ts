// GYM-222 — Vendre une formule à un membre DÉJÀ INSCRIT, depuis sa fiche (gym_admin).
//
// BLOQUANT GO LIVE, relevé en QA le 06/08 : « Rien sur la fiche du membre ne me propose de
// créer un paiement. » L'encaissement au comptoir existait et fonctionnait (espèces,
// terminal, facture automatique — INV-2026-0001..0005 en staging) mais UNIQUEMENT à la
// création du membre. Une fois inscrit, le geste quotidien d'une salle devenait
// impossible : « Julie a fini sa carte, elle en rachète une, elle paie au terminal. »
//
// 🔴 CE N'EST PAS UN AJUSTEMENT DE CRÉDITS. Passer une vente par adjust-credits (GYM-182)
// donnerait le crédit SANS ligne payments, SANS facture, SANS TVA, SANS chiffre
// d'affaires : l'argent entre en caisse et rien ne le trace. Les motifs de GYM-182
// décrivent des GESTES GRATUITS (parrainage, compensation) ; y glisser une vente
// fausserait durablement la comptabilité de la salle.
//
// 🔴 CE N'EST PAS NON PLUS UN SECOND ENCAISSEMENT. Tout le geste marchand vit dans
// _shared/counter-sale.ts, partagé avec admin-create-member : mêmes gardes, même ligne
// payments, même apply_paid_payment, même facture. Ce fichier n'ajoute QUE ce qui est
// propre au membre existant — le retrouver, vérifier qu'il est bien de la salle, et
// refuser la vente s'il a déjà un abonnement en cours.
//
// PÉRIMÈTRE (décisions produit Antoine, 07/08) : tout ce qui se paie EN UNE FOIS — crédits,
// cartes, séance d'essai, et l'abonnement « Illimité 12 mois — paiement unique ».
// ⚠️ HORS PÉRIMÈTRE, NE PAS IMPROVISER ICI : l'abonnement MENSUEL encaissé au comptoir
// chaque mois et le prélèvement SEPA sont d'autres chantiers (GYM-185). La garde
// PLAN_NOT_ONE_TIME de counter-sale.ts est ce qui tient cette frontière.
//
// Sécurité :
//  - verify_jwt = true (config.toml). L'appelant doit être gym_admin/super_admin.
//  - Le gym_id vient du profil de l'APPELANT, jamais du body.
//  - Le prix vient de gym_plans (resolve_plan_for_payment) : aucun montant client.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  collectCounterPayment,
  findBlockingSubscription,
  isPaymentMethod,
  resolveSellablePlan,
} from '../_shared/counter-sale.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function errorResponse(status: number, code: string, message?: string) {
  return jsonResponse({ error: true, code, message: message ?? code }, status)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey)

    // 1. Auth appelant + rôle gym_admin / super_admin (forme d'admin-update-member).
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    if (!token) return errorResponse(401, 'UNAUTHORIZED', 'Non authentifié')

    const { data: { user }, error: authError } = await admin.auth.getUser(token)
    if (authError || !user) return errorResponse(401, 'UNAUTHORIZED', 'Non authentifié')

    const { data: adminProfile } = await admin
      .from('profiles')
      .select('role, gym_id')
      .eq('id', user.id)
      .single()

    if (!adminProfile || (adminProfile.role !== 'gym_admin' && adminProfile.role !== 'super_admin')) {
      return errorResponse(403, 'FORBIDDEN', 'Réservé au gérant de la salle')
    }
    const gymId = adminProfile.gym_id as string | null
    if (!gymId) return errorResponse(400, 'NO_GYM', 'Aucune salle associée à ce compte')

    // 2. Entrée. Le montant n'est PAS un champ : même envoyé, il serait ignoré.
    const body = await req.json().catch(() => null) as
      | { member_id?: string; plan_id?: string; payment_method?: string }
      | null

    const memberId = body?.member_id?.trim() || null
    const planId = body?.plan_id?.trim() || null
    const paymentMethod = body?.payment_method

    if (!memberId) return errorResponse(400, 'MISSING_MEMBER_ID', 'member_id requis')
    if (!planId) return errorResponse(400, 'MISSING_PLAN_ID', 'plan_id requis')
    if (!isPaymentMethod(paymentMethod)) {
      return errorResponse(400, 'INVALID_PAYMENT_METHOD', 'Méthode de paiement invalide')
    }

    // 3. La cible : un membre de la salle de l'appelant, non supprimé.
    //    Contrôles repris À L'IDENTIQUE d'admin-update-member — mêmes codes, le dashboard
    //    les traduit déjà.
    //
    //    ⚠️ AUCUN CONTRÔLE DE SUSPENSION ICI, VOLONTAIREMENT (cf. compte-rendu GYM-222) :
    //    un membre suspendu pour no-show PEUT acheter. Payer n'est pas réserver — c'est
    //    create-booking qui refuse la réservation (code SUSPENDED, GYM-175/214). Lui
    //    interdire de régler d'avance le punirait deux fois et priverait la salle d'un
    //    encaissement légitime. Comportement CONSTATÉ et conservé, non modifié.
    const { data: target } = await admin
      .from('profiles')
      .select('id, gym_id, role, deleted_at')
      .eq('id', memberId)
      .single()

    if (!target) return errorResponse(404, 'MEMBER_NOT_FOUND', 'Membre introuvable')
    if (target.gym_id !== gymId) return errorResponse(403, 'WRONG_GYM', 'Membre hors de votre salle')
    if (target.role !== 'member') return errorResponse(403, 'NOT_A_MEMBER', 'Seuls les comptes membres peuvent acheter')
    if (target.deleted_at) return errorResponse(409, 'MEMBER_DELETED', 'Compte supprimé')

    // 4. Gardes portant sur la FORMULE — partagées avec admin-create-member.
    //    Prix et crédits autoritatifs serveur.
    const resolved = await resolveSellablePlan(admin, gymId, planId)
    if (resolved.refusal) {
      return errorResponse(resolved.refusal.status, resolved.refusal.code, resolved.refusal.message)
    }
    const plan = resolved.plan

    // 5. Garde propre au membre existant : abonnement déjà en cours (GYM-94/191/195).
    //    Placée APRÈS la résolution du plan (le message dépend de ce qui a été tenté) et
    //    AVANT toute écriture : on ne crée jamais un paiement qu'on refusera ensuite.
    //
    //    ⚠️ AUCUNE GARDE SUR LES CRÉDITS RESTANTS, VOLONTAIREMENT. Les crédits sont
    //    CUMULABLES : un membre qui en a encore 2 peut en racheter, ils s'additionnent
    //    (apply_paid_payment fait un upsert). C'est déjà la règle en libre-service
    //    (GYM-94, one_time cumulables) et c'est voulu — « pourquoi attendre si elle veut
    //    déjà payer ». Le solde actuel est AFFICHÉ dans la modale pour éviter une erreur de
    //    manipulation, jamais opposé au gérant.
    const blocking = await findBlockingSubscription(admin, gymId, memberId, plan.plan_type === 'unlimited')
    if (blocking) return errorResponse(blocking.status, blocking.code, blocking.message)

    // 6. Encaissement + contrepartie + facture (module partagé).
    const outcome = await collectCounterPayment(admin, {
      gymId,
      memberId,
      plan,
      paymentMethod,
      logPrefix: '[admin-sell-plan]',
    })

    // 🔴 ARBITRAGE INVERSE D'admin-create-member, ET C'EST DÉLIBÉRÉ. Là-bas un échec est un
    // simple `warning` parce que le compte membre, lui, a bien été créé : renvoyer une
    // erreur pousserait le gérant à recréer le membre. Ici il n'y a RIEN à préserver — un
    // succès affiché sans contrepartie délivrée ferait croire au gérant que Julie a ses
    // séances alors qu'elle vient de payer pour rien. On refuse franchement.
    if (outcome.warning === 'PAYMENT_NOT_RECORDED') {
      return errorResponse(500, 'PAYMENT_NOT_RECORDED', "L'encaissement n'a pas pu être enregistré")
    }
    if (outcome.warning === 'CREDITS_NOT_APPLIED') {
      // La ligne payments existe et reste 'pending' : l'incident est visible dans /revenus,
      // l'argent n'est pas perdu de vue. On renvoie son id pour le retrouver.
      return jsonResponse(
        {
          error: true,
          code: 'CREDITS_NOT_APPLIED',
          message: "Le paiement est enregistré mais la contrepartie n'a pas pu être délivrée",
          payment_id: outcome.payment.id,
        },
        500,
      )
    }

    return jsonResponse({
      success: true,
      payment: outcome.payment,
      invoice_sent: outcome.invoiceSent,
    })
  } catch (err) {
    console.error('[admin-sell-plan] uncaught:', err)
    return errorResponse(500, 'SERVER_ERROR', (err as Error).message)
  }
})
