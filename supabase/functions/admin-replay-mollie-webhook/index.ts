// GYM-315 — REJEU D'UN WEBHOOK MOLLIE PAR LE COCKPIT (outil d'exploitation ÉDITEUR).
//
// ═════════════════════════════════════════════════════════════════════════════════════
// POURQUOI CETTE FONCTION EXISTE
// ═════════════════════════════════════════════════════════════════════════════════════
// Révélée par GYM-314 : un défaut sur le chemin de l'argent laisse des paiements RÉELS
// figés en 'pending'. Le code corrigé traite parfaitement un rejeu — les deux gardes
// d'idempotence le laissent passer — mais Mollie ne retente que « up to 5 times (once a
// day) ». Passé ce délai, plus personne ne déclenche rien, et il ne restait que deux
// gestes, tous deux mauvais :
//   · ouvrir le tableau de bord Mollie DU CLIENT — il appartient au gérant, pas à nous ;
//   · rejouer à la main avec MOLLIE_WEBHOOK_SECRET sous les yeux — un secret qu'on
//     manipule est un secret qui finit dans un historique de shell.
//
// Cette fonction supprime les deux : elle relit le secret dans SON PROPRE environnement
// et appelle la fonction cible exactement comme Mollie le ferait. LE SECRET NE SORT
// JAMAIS DE L'INFRASTRUCTURE — ni dans une réponse, ni dans un log, ni sur un écran.
//
// ⚠️ ELLE NE CONTOURNE AUCUNE GARDE. Elle ne touche NI aux paiements, NI aux abonnements,
// NI aux crédits : elle déclenche la cible, qui refait son travail avec toutes ses
// vérifications (secret, format d'id, rate limit, idempotence, garde inter-tenant). Le
// seul pouvoir ajouté est celui de SONNER À LA PORTE. C'est délibéré : une fonction de
// réparation qui écrirait elle-même serait un second chemin vers l'argent, et deux
// chemins finissent par diverger.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FN = 'admin-replay-mollie-webhook'

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

/**
 * Les DEUX seules cibles rejouables — liste FERMÉE, et c'est une garde, pas une
 * commodité. Ce nom part dans une URL construite avec le secret : si l'appelant pouvait
 * l'écrire librement, il choisirait vers quelle fonction ce secret est envoyé. Un
 * `super_admin` est déjà de confiance ; une liste fermée fait qu'on n'a pas à en dépendre.
 */
const REPLAYABLE_TARGETS = ['mollie-webhook', 'mollie-subscription-webhook'] as const
type ReplayTarget = typeof REPLAYABLE_TARGETS[number]

/**
 * Union des formats acceptés par les deux cibles (`tr_` paiement, `sub_` abonnement,
 * `re_` remboursement, `ord_` commande). Filtre d'entrée seulement : chaque cible
 * re-valide selon SON propre format, plus étroit. On rejette tôt ce qui est manifestement
 * faux, on ne se substitue pas à leur contrôle.
 */
const MOLLIE_ID_RE = /^(tr|sub|re|ord)_[a-zA-Z0-9]+$/

/**
 * `payments.plan_id` est de type `text` et `gym_plans.id` de type `uuid` : il n'y a
 * AUCUNE clé étrangère entre les deux, donc rien qui garantisse la jointure. On teste la
 * forme avant de comparer — un `plan_id` non-uuid ferait lever la requête (22P02) et
 * transformerait une déduction en erreur 500.
 */
const UUID_RE = /^[0-9a-fA-F-]{36}$/

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * SOURCE PRIMAIRE (GYM-315 addendum) — `gym_plans.billing_type`
 * ═══════════════════════════════════════════════════════════════════════════════════
 * C'est LE critère qui décide réellement du webhook, et il n'est pas déduit : l'app
 * mobile choisit la fonction d'encaissement avec exactement ce test —
 *
 *     apps/mobile/app/profile/subscription.tsx:293
 *     const result = plan.billingType === 'one_time'
 *       ? await startOneTimeCheckout(...)      → create-payment      → mollie-webhook
 *       : await startSubscriptionCheckout(...) → create-subscription → mollie-subscription-webhook
 *
 * On relit donc la MÊME colonne que celle qui a produit l'aiguillage d'origine, au lieu
 * d'inférer depuis une conséquence.
 *
 * ⚠️ NE PAS UTILISER `gym_plans.type` POUR ÇA — c'est le piège de cette colonne. Sa
 * contrainte CHECK la limite à `('unlimited', 'credits')` : elle dit CE QUE LE MEMBRE
 * OBTIENT, pas comment il paie, et GYM-188 a explicitement DÉCOUPLÉ les deux axes
 * (`plan-resolver.ts` prend soin de les distinguer). Un plan `unlimited` payé en une
 * fois existe : mesuré en prod le 31/08/2026, 3 paiements `billing_type = 'one_time'`
 * portent `type = 'unlimited'`. Router sur `type` les enverrait au webhook d'abonnement.
 */
function targetForBillingType(billingType: string): ReplayTarget {
  return billingType === 'one_time' ? 'mollie-webhook' : 'mollie-subscription-webhook'
}

/**
 * REPLI — convention `credits_granted`, conservée telle quelle.
 *
 * Ne sert QUE si le plan n'est plus joignable : `plan_id` absent ou non-uuid, ou plan
 * supprimé de `gym_plans` (aucune FK ne l'en empêche). Mesuré en prod le 31/08/2026 :
 * 0 cas sur 28 paiements Mollie — mais un plan supprimé demain le produirait, et un
 * rejeu ne doit pas dépendre de la durée de vie d'une ligne de catalogue.
 *
 *   · `0`    → abonnement. create-subscription pose explicitement 0, et le commentaire
 *              GYM-243 dit pourquoi 0 plutôt que NULL : « évite une bascule NULL → 0 en
 *              cours de vie de la ligne ». C'est donc un marqueur stable, pas un hasard.
 *   · `> 0`  → vente à l'unité (create-payment, plan à crédits).
 *   · `NULL` → vente à l'unité ILLIMITÉE : `creditsGranted = isUnlimited ? null : ...`
 *              dans create-payment, seul écrivain de NULL sur cette colonne.
 *
 * ⚠️ CETTE CONVENTION A ÉTÉ CONÇUE POUR CLASSER /revenus, PAS POUR ROUTER. Elle est
 * exacte aujourd'hui (28/28 d'accord avec `billing_type` en prod), mais elle reste une
 * inférence sur une conséquence — d'où sa rétrogradation en repli.
 */
function targetForCreditsGranted(creditsGranted: number | null): ReplayTarget {
  return creditsGranted === 0 ? 'mollie-subscription-webhook' : 'mollie-webhook'
}

/**
 * 🔴 CEINTURE ANTI-FUITE — ne pas retirer, et lire pourquoi avant d'y toucher.
 *
 * DÉFAUT ATTRAPÉ À LA RELECTURE DE CE LOT (aucun code déployé) : en Deno, le message
 * d'erreur de `fetch` PORTE L'URL APPELÉE — « error sending request for url (https://…
 * ?secret=…) ». Or cette URL contient le secret. Ce message partait dans trois endroits :
 * les logs, `audit_logs.new_data` (que le GÉRANT de la salle peut lire, politique RLS
 * « Gym admins voient les logs de leur gym ») et la réponse JSON. Une simple panne réseau
 * suffisait donc à publier MOLLIE_WEBHOOK_SECRET — exactement ce que cette fonction
 * existe pour éviter.
 *
 * Deux passes, volontairement redondantes : la valeur exacte du secret d'abord, puis
 * toute forme `secret=…` résiduelle (ré-encodée, tronquée, ou provenant d'une autre
 * source). La seconde rattrape ce que la première ne reconnaîtrait pas.
 *
 * ⚠️ TOUT texte venant de l'extérieur de cette fonction passe par ici avant d'être
 * journalisé, tracé ou renvoyé. Aucune exception.
 */
function scrubSecret(text: string, secret: string): string {
  let out = text
  if (secret) out = out.split(secret).join('[redacted]')
  return out.replace(/secret=[^&\s)"']*/gi, 'secret=[redacted]')
}

/**
 * `audit_logs.ip_address` est de type `inet` : une valeur mal formée ferait ÉCHOUER
 * l'insertion, donc perdre la trace entière pour un champ accessoire. `x-forwarded-for`
 * peut porter plusieurs sauts (« client, proxy1, proxy2 ») — on garde le premier, et on
 * rend `null` au moindre doute plutôt que de risquer la ligne.
 */
function firstIp(header: string | null): string | null {
  const candidate = (header ?? '').split(',')[0]?.trim() ?? ''
  if (!candidate) return null
  const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(candidate)
    && candidate.split('.').every((o) => Number(o) <= 255)
  const isIpv6 = /^[0-9a-fA-F:]+$/.test(candidate) && candidate.includes(':')
  return isIpv4 || isIpv6 ? candidate : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return errorResponse(405, 'METHOD_NOT_ALLOWED')

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey)

    // ═══════════════════════════════════════════════════════════════════════════════
    // 1. AUTORISATION — super_admin UNIQUEMENT
    // ═══════════════════════════════════════════════════════════════════════════════
    // Forme reprise de create-refund (GYM-112) : jeton porteur → getUser → lecture du
    // rôle CÔTÉ SERVEUR. Rien n'est cru sur parole depuis le corps de la requête.
    //
    // 🔴 UNE SEULE CHOSE CHANGE, ET C'EST LE CŒUR DU LOT : `gym_admin` EST REFUSÉ. Les
    // douze fonctions `admin-*` du dépôt acceptent `['gym_admin', 'super_admin']` — un
    // gérant agissant chez lui. Celle-ci est un outil d'exploitation ÉDITEUR : elle
    // atteint N'IMPORTE QUELLE salle, puisque le paiement visé désigne lui-même la sienne.
    // L'ouvrir aux gérants donnerait à chacun un levier sur le chemin de l'argent des
    // autres. C'est la PREMIÈRE fonction du dépôt réservée au seul `super_admin` : la
    // divergence avec le motif habituel est VOULUE, elle n'est pas un oubli de copie.
    //
    // `deleted_at IS NULL` : même définition que `public.is_super_admin()` en base
    // (`SELECT role = 'super_admin' FROM profiles WHERE id = auth.uid() AND deleted_at IS
    // NULL`). Un compte éditeur désactivé ne doit pas garder la clé de la maison, et deux
    // définitions du même rôle qui divergent sont un défaut en attente.
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    if (!token) return errorResponse(401, 'UNAUTHORIZED', 'Non authentifié')

    const { data: { user }, error: authError } = await admin.auth.getUser(token)
    if (authError || !user) return errorResponse(401, 'UNAUTHORIZED', 'Non authentifié')

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .is('deleted_at', null)
      .single()

    if (!callerProfile || callerProfile.role !== 'super_admin') {
      // Refus SOBRE : ni le rôle constaté, ni « vous êtes gym_admin ». Un message qui
      // décrit l'écart renseigne celui qui cherche. Le log serveur, lui, est complet.
      console.warn(`[${FN}] forbidden — caller is not super_admin:`, user.id)
      return errorResponse(403, 'FORBIDDEN', 'Réservé à l\'exploitation Viniz')
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // 2. ENTRÉE
    // ═══════════════════════════════════════════════════════════════════════════════
    const { mollie_payment_id: molliePaymentId, target: requestedTarget } =
      await req.json().catch(() => ({})) as {
        mollie_payment_id?: string
        target?: string
      }

    if (!molliePaymentId) {
      return errorResponse(400, 'MISSING_MOLLIE_PAYMENT_ID', 'mollie_payment_id requis')
    }
    if (!MOLLIE_ID_RE.test(molliePaymentId)) {
      return errorResponse(400, 'INVALID_MOLLIE_PAYMENT_ID', 'Format d\'identifiant Mollie invalide')
    }
    if (requestedTarget && !REPLAYABLE_TARGETS.includes(requestedTarget as ReplayTarget)) {
      return errorResponse(400, 'INVALID_TARGET', 'Cible inconnue')
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // 3. LE PAIEMENT DOIT EXISTER EN BASE — pas de rejeu à l'aveugle
    // ═══════════════════════════════════════════════════════════════════════════════
    // Sans ce contrôle, la fonction deviendrait un déclencheur générique : n'importe quel
    // identifiant, connu ou inventé, ferait partir un appel authentifié par le secret vers
    // un webhook du chemin de l'argent. On n'ouvre un rejeu que sur une ligne QUE NOUS
    // AVONS ÉCRITE.
    //
    // Effet de bord assumé : les ventes au comptoir (counter-sale, espèces/TPE) n'ont pas
    // de `mollie_payment_id` — elles sont donc introuvables ici, ce qui est correct :
    // aucun webhook Mollie ne les concerne, il n'y a rien à rejouer.
    const { data: payment } = await admin
      .from('payments')
      .select('id, gym_id, member_id, status, credits_granted, plan_id, mollie_payment_id')
      .eq('mollie_payment_id', molliePaymentId)
      .maybeSingle()

    if (!payment) {
      console.warn(`[${FN}] payment not found for mollie id:`, molliePaymentId)
      return errorResponse(404, 'PAYMENT_NOT_FOUND', 'Aucun paiement connu pour cet identifiant Mollie')
    }

    // Capturé ICI, avant le moindre appel : une valeur nommée « avant » se lit avant.
    // La lire après le rejeu la rendrait dépendante du fait que `payment` ne soit pas
    // muté entre-temps — une hypothèse vraie aujourd'hui (objet désérialisé, sans lien
    // avec la base) mais qu'aucun lecteur ne devrait avoir à vérifier.
    const statusBefore = payment.status as string

    // ═══════════════════════════════════════════════════════════════════════════════
    // CIBLE — explicite > billing_type (sémantique) > credits_granted (repli)
    // ═══════════════════════════════════════════════════════════════════════════════
    // `target_source` voyage dans la réponse ET dans la trace : l'opérateur doit pouvoir
    // dire SUR QUOI la cible a été choisie sans relire ce fichier. Les trois cas se
    // distinguent, parce qu'ils n'inspirent pas la même confiance.
    let target: ReplayTarget
    let targetSource: 'explicit' | 'billing_type' | 'credits_granted'

    if (requestedTarget) {
      target = requestedTarget as ReplayTarget
      targetSource = 'explicit'
    } else {
      let billingType: string | null = null
      // Pas de jointure côté PostgREST : sans FK (text ↔ uuid) l'imbrication est
      // impossible, c'est donc une seconde lecture. Elle est indexée (clé primaire) et
      // ne coûte qu'un aller-retour, sur un chemin déclenché à la main.
      if (payment.plan_id && UUID_RE.test(payment.plan_id)) {
        const { data: plan } = await admin
          .from('gym_plans')
          .select('billing_type')
          .eq('id', payment.plan_id)
          .maybeSingle()
        billingType = plan?.billing_type ?? null
      }

      if (billingType) {
        target = targetForBillingType(billingType)
        targetSource = 'billing_type'
      } else {
        // Plan supprimé, plan_id absent ou malformé. On ne renonce pas au rejeu pour
        // autant : la convention `credits_granted` reste vraie sur toutes les données
        // mesurées, et `target_source` dit clairement qu'on est descendu d'un cran.
        target = targetForCreditsGranted(payment.credits_granted)
        targetSource = 'credits_granted'
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // 4. LE SECRET — lu ici, jamais transmis, jamais journalisé
    // ═══════════════════════════════════════════════════════════════════════════════
    // 🔴 GARDE INDISPENSABLE, ET LA RAISON EST CONTRE-INTUITIVE : les deux cibles
    // répondent **200 « OK »** quand le secret est refusé — c'est VOULU chez elles (un
    // 4xx ferait retenter Mollie indéfiniment sur un appel illégitime). Elles répondent
    // aussi 200 « OK » sur un succès et sur une sortie idempotente. UN SECRET ABSENT EST
    // DONC INDISTINGUABLE D'UNE RÉUSSITE côté appelant.
    //
    // Sans ce test, une variable oubliée au déploiement produirait un rejeu qui SEMBLE
    // marcher, sur de l'argent, sans que rien ne le signale. On refuse en 500 AVANT
    // d'appeler — un défaut de configuration se dit, il ne se déguise pas en succès.
    //
    // Le cas résiduel — notre secret présent mais DIFFÉRENT de celui de la cible — ne peut
    // pas se produire : les secrets Supabase sont posés au niveau du PROJET, les deux
    // fonctions lisent donc littéralement la même valeur. La vérification d'effet du
    // point 6 reste le filet en dernier ressort.
    const webhookSecret = Deno.env.get('MOLLIE_WEBHOOK_SECRET') ?? ''
    if (!webhookSecret) {
      console.error(`[${FN}] MOLLIE_WEBHOOK_SECRET absent — rejeu refusé`)
      return errorResponse(500, 'CONFIG_ERROR', 'Configuration serveur incomplète')
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // 5. L'APPEL — exactement ce que Mollie envoie
    // ═══════════════════════════════════════════════════════════════════════════════
    // Corps `application/x-www-form-urlencoded` avec le seul champ `id`, secret en
    // paramètre d'URL : c'est la forme que les deux cibles lisent (`await req.formData()`,
    // `url.searchParams.get('secret')`). Aucun en-tête d'authentification — les deux sont
    // en `verify_jwt = false`, comme Mollie les appelle.
    //
    // `gym_id` n'est joint QUE pour la cible abonnement, parce que create-subscription le
    // scelle dans l'URL de rappel des échéances (GYM-244) : rejouer sans lui ne serait pas
    // « exactement comme Mollie ». Il est ici sans effet — la ligne `payments` existe
    // forcément (point 3) et la cible lui donne la PRIORITÉ sur le paramètre — et il ne
    // peut pas servir à usurper : la garde inter-tenant exige que la metadata du paiement
    // porte le même gym_id, et il vient de notre base, pas de l'appelant.
    const targetUrl = new URL(`${supabaseUrl}/functions/v1/${target}`)
    targetUrl.searchParams.set('secret', webhookSecret)
    if (target === 'mollie-subscription-webhook') {
      targetUrl.searchParams.set('gym_id', payment.gym_id)
    }

    // ⚠️ NE JAMAIS JOURNALISER `targetUrl` NI `targetUrl.href` : le secret y est. On ne
    // logue que le NOM de la cible. Cette ligne est la seule trace de l'appel, et elle
    // est volontairement pauvre.
    console.log(`[${FN}] replay by`, user.id, '→', target, 'for', molliePaymentId)

    const startedAt = Date.now()
    let httpStatus: number | null = null
    let responseBody = ''
    let transportError: string | null = null

    try {
      const targetRes = await fetch(targetUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id: molliePaymentId }).toString(),
      })
      httpStatus = targetRes.status
      // Les cibles répondent en texte court ('OK', 'no token', 'gym mismatch'…). On
      // tronque quand même : un corps inattendu ne doit ni gonfler la trace ni la réponse.
      // `scrubSecret` par principe : ce corps vient d'ailleurs, on ne le relaie pas brut.
      responseBody = scrubSecret((await targetRes.text().catch(() => '')).slice(0, 500), webhookSecret)
    } catch (e) {
      // ⚠️ `scrubSecret` OBLIGATOIRE ICI : ce message contient l'URL appelée, donc le
      // secret. Il repart en log, en base et dans la réponse.
      transportError = scrubSecret(e instanceof Error ? e.message : String(e), webhookSecret)
      console.error(`[${FN}] target call threw:`, transportError)
    }

    const durationMs = Date.now() - startedAt

    // ═══════════════════════════════════════════════════════════════════════════════
    // 6. VÉRIFICATION D'EFFET — ce qui transforme « 200 OK » en preuve
    // ═══════════════════════════════════════════════════════════════════════════════
    // Relecture SEULE (aucune écriture) du statut du paiement. Elle répond à la seule
    // question qui intéresse l'opérateur — « est-ce que ça a débloqué quelque chose ? » —
    // là où le code HTTP ne le dit pas : la cible rend 200 aussi bien sur un succès que
    // sur une sortie idempotente. `pending → paid` = le rejeu a réparé ; `paid → paid` =
    // no-op, c'était déjà traité. Les deux sont des issues saines, et l'opérateur doit
    // pouvoir les distinguer sans ouvrir la base.
    const { data: after } = await admin
      .from('payments')
      .select('status')
      .eq('id', payment.id)
      .maybeSingle()

    const statusAfter = (after?.status ?? null) as string | null
    const ok = transportError === null && httpStatus !== null && httpStatus >= 200 && httpStatus < 300

    // ═══════════════════════════════════════════════════════════════════════════════
    // 7. TRACE — un rejeu est une action d'exploitation sur de l'argent
    // ═══════════════════════════════════════════════════════════════════════════════
    // `audit_logs` et non `gym_admin_actions` : cette dernière porte une contrainte CHECK
    // sur une liste FERMÉE d'`action_type` (aucune valeur de rejeu n'y figure — l'y
    // ajouter demanderait une migration) et décrit un geste de GÉRANT sur un MEMBRE de sa
    // salle, ce que ceci n'est pas. `audit_logs` a exactement la forme voulue
    // (actor_id / action / resource / resource_id / new_data / ip / user_agent), ses deux
    // index utiles, et ne demande AUCUNE migration — un correctif d'exploitation ne doit
    // pas traîner un changement de schéma derrière lui.
    //
    // ⚠️ `gym_id` est renseigné, donc le GÉRANT de la salle verra cette ligne (politique
    // RLS « Gym admins voient les logs de leur gym »). C'est assumé : une intervention de
    // l'éditeur sur les paiements d'une salle doit être visible par cette salle. D'où la
    // règle absolue ci-dessous.
    //
    // 🔴 AUCUN SECRET DANS `new_data` : on y écrit le NOM de la cible, jamais l'URL
    // construite. Relire cette règle avant d'ajouter le moindre champ ici.
    let auditLogged = true
    const { error: auditError } = await admin.from('audit_logs').insert({
      gym_id: payment.gym_id,
      actor_id: user.id,
      action: 'mollie_webhook_replay',
      resource: 'payments',
      resource_id: payment.id,
      new_data: {
        mollie_payment_id: molliePaymentId,
        target,
        target_source: targetSource,
        http_status: httpStatus,
        response_body: responseBody,
        transport_error: transportError,
        duration_ms: durationMs,
        status_before: statusBefore,
        status_after: statusAfter,
        ok,
      },
      ip_address: firstIp(req.headers.get('x-forwarded-for')),
      user_agent: req.headers.get('user-agent'),
    })

    if (auditError) {
      // Best-effort : l'appel a DÉJÀ eu lieu, échouer maintenant ne le rattraperait pas
      // et masquerait son résultat. Mais on ne prétend pas non plus l'avoir tracé — la
      // réponse porte `audit_logged: false`, pour que l'opérateur sache que la trace
      // manque et la reconstitue.
      console.error(`[${FN}] audit insert failed (non-blocking):`, auditError.message)
      auditLogged = false
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // 8. RÉPONSE — le nom de la cible, jamais l'URL
    // ═══════════════════════════════════════════════════════════════════════════════
    return jsonResponse({
      success: ok,
      target,
      target_source: targetSource,
      mollie_payment_id: molliePaymentId,
      payment_id: payment.id,
      gym_id: payment.gym_id,
      http_status: httpStatus,
      response_body: responseBody,
      transport_error: transportError,
      duration_ms: durationMs,
      status_before: statusBefore,
      status_after: statusAfter,
      // `pending → paid` : le rejeu a débloqué. Sinon, la cible est sortie sans changer
      // le statut — no-op idempotent, ou échec que `response_body` explique.
      changed: statusBefore !== statusAfter,
      audit_logged: auditLogged,
    }, ok ? 200 : 502)
  } catch (e) {
    // Même ceinture qu'au point 5 : `webhookSecret` est hors de portée depuis ce `catch`
    // (déclaré dans le `try`), on relit donc l'environnement. Le client ne reçoit qu'un
    // code générique — c'est le LOG qu'on protège ici.
    console.error(`[${FN}] uncaught:`, scrubSecret(
      e instanceof Error ? e.message : String(e),
      Deno.env.get('MOLLIE_WEBHOOK_SECRET') ?? '',
    ))
    return errorResponse(500, 'INTERNAL_ERROR', 'Erreur interne')
  }
})
