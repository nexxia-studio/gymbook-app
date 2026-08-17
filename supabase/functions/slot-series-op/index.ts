// GYM-230 — Opérations de SÉRIE : modifier ou supprimer « ce cours et tous les suivants ».
//
// POURQUOI UNE EDGE FUNCTION PLUTÔT QU'UNE BOUCLE CÔTÉ NAVIGATEUR.
// Une série peut compter 52 créneaux, chacun avec des inscrits. Boucler depuis le
// dashboard, ce serait 52 allers-retours HTTP dont le sort dépend d'un onglet resté
// ouvert : un gérant qui ferme sa page au milieu laisse la moitié de sa série annulée et
// l'autre moitié vivante, sans que personne ne l'apprenne. Ici, un seul appel ; le serveur
// va au bout et REND COMPTE de ce qu'il a fait, créneau par créneau.
//
// ⚠️ LE PASSÉ N'EST JAMAIS TOUCHÉ (décision produit 6). Toutes les sélections sont bornées
// à `starts_at >= pivot`, et le pivot est le créneau depuis lequel le gérant agit. Les
// présences, pénalités et paiements attachés aux cours déjà tenus ne se réécrivent pas.
//
// ⚠️ LES EXCEPTIONS SONT ÉPARGNÉES (décision produit 5, comportement d'Apple Calendar).
// Un créneau déjà modifié seul porte `is_series_exception = true` : une modification de
// série ne l'écrase pas. Le gérant avait pris une décision sur cette date précise ; la
// série n'a pas à la défaire dans son dos.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Même clé, même fournisseur que cancel-slot et admin-book-member.
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''

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

interface SeriesOpRequest {
  /** 'count' ne modifie rien : il RENSEIGNE le gérant avant qu'il valide. */
  op?: 'count' | 'update' | 'delete'
  /** Créneau depuis lequel le gérant agit — le pivot. Le passé lui est antérieur. */
  slot_id?: string
  /**
   * 🔴 GYM-230 (QA staging 17/08) — PORTÉE, ajoutée en correctif.
   *
   * 'single' ne passait PAS par cette fonction : le dashboard écrivait le créneau
   * directement en PostgREST. La notification, qui vit ici, n'était donc jamais exécutée
   * — ni push, ni email, ni même une ligne de journal, l'Edge n'ayant pas tourné du tout.
   *
   * Défaut par 'following' : c'est le contrat qu'avaient les appelants avant ce correctif.
   */
  scope?: 'single' | 'following' 
  /** Champs à écrire sur les créneaux futurs de la série (op 'update'). */
  patch?: {
    activity_id?: string
    coach_id?: string | null
    capacity?: number
    level?: string
    notes?: string | null
    /** Heure LOCALE 'HH:mm' — jamais un instant UTC (cf. plus bas). */
    starts_local_time?: string
    /**
     * Date LOCALE 'YYYY-MM-DD', portée 'single' UNIQUEMENT : déplacer un cours isolé à une
     * autre date est un geste légitime. En portée 'following' elle est ignorée — chaque
     * occurrence a la sienne, et les toutes déplacer à la même date les empilerait.
     */
    starts_local_date?: string
    duration_min?: number
  }
  /** Motif d'annulation, transmis tel quel à cancel_slot_atomic (op 'delete'). */
  reason?: string
}

/** Créneaux FUTURS de la série, exceptions exclues. Le socle des trois opérations. */
async function selectTargets(
  admin: SupabaseClient,
  seriesId: string,
  pivotStartsAt: string,
  scope: 'single' | 'following',
  pivotId: string,
) {
  // Portée 'single' : le pivot, et lui seul. Il passe par le MÊME traitement que la portée
  // large — mêmes écritures, MÊME NOTIFICATION. C'est tout l'objet du correctif : deux
  // portées, un seul chemin.
  if (scope === 'single') {
    const { data } = await admin
      .from('time_slots')
      .select('id, starts_at, ends_at, bookings_count, is_series_exception')
      .eq('id', pivotId)
      .single()
    return { targets: data ? [data] : [], skippedExceptions: 0 }
  }

  const { data } = await admin
    .from('time_slots')
    .select('id, starts_at, ends_at, bookings_count, is_series_exception')
    .eq('series_id', seriesId)
    .gte('starts_at', pivotStartsAt)   // le passé n'est jamais touché
    .neq('status', 'cancelled')
    .order('starts_at')

  const all = data ?? []
  return {
    // Le pivot lui-même est TOUJOURS traité, même s'il est une exception : le gérant agit
    // depuis lui, il ne peut pas être surpris qu'il change.
    targets: all.filter((s) => !s.is_series_exception || s.starts_at === pivotStartsAt),
    skippedExceptions: all.filter((s) => s.is_series_exception && s.starts_at !== pivotStartsAt).length,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey)

    // ── Garde de rôle — modèle admin-* du dépôt. ─────────────────────────────
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    if (!token) return errorResponse(401, 'UNAUTHORIZED', 'Non authentifié')

    const { data: { user }, error: authError } = await admin.auth.getUser(token)
    if (authError || !user) return errorResponse(401, 'UNAUTHORIZED', 'Non authentifié')

    const { data: adminProfile } = await admin
      .from('profiles').select('role, gym_id').eq('id', user.id).single()

    if (!adminProfile || (adminProfile.role !== 'gym_admin' && adminProfile.role !== 'super_admin')) {
      return errorResponse(403, 'FORBIDDEN', 'Réservé au gérant de la salle')
    }
    if (!adminProfile.gym_id) return errorResponse(400, 'NO_GYM', 'Aucune salle associée à ce compte')
    const gymId = adminProfile.gym_id as string

    const body = await req.json().catch(() => null) as SeriesOpRequest | null
    const op = body?.op ?? 'count'
    const slotId = body?.slot_id
    if (!slotId) return errorResponse(400, 'MISSING_SLOT_ID', 'slot_id requis')

    // ── Le pivot, et sa série. gym_id lu sur le PROFIL de l'appelant. ────────
    const { data: pivot } = await admin
      .from('time_slots')
      .select('id, gym_id, series_id, starts_at')
      .eq('id', slotId)
      .single()

    if (!pivot) return errorResponse(404, 'SLOT_NOT_FOUND', 'Créneau introuvable')
    if (pivot.gym_id !== gymId) return errorResponse(403, 'WRONG_GYM', 'Créneau hors de votre salle')
    if (!pivot.series_id) return errorResponse(422, 'NOT_IN_SERIES', "Ce créneau n'appartient à aucune série")

    const { data: series } = await admin
      .from('slot_series')
      .select('id, gym_id, timezone, starts_local_time, duration_min, activity_id')
      .eq('id', pivot.series_id)
      .single()

    if (!series || series.gym_id !== gymId) {
      return errorResponse(403, 'WRONG_GYM', 'Série hors de votre salle')
    }

    const scope = body?.scope ?? 'following'
    const { targets, skippedExceptions } = await selectTargets(
      admin, pivot.series_id, pivot.starts_at, scope, pivot.id as string,
    )

    // ── COUNT — informer avant de décider (décision produit 4). ──────────────
    //
    // Le gérant doit savoir combien de cours ET combien de membres il engage AVANT de
    // valider : « 12 membres inscrits sur ces 8 cours seront prévenus ». Sans ce compte,
    // il déciderait à l'aveugle sur un geste qui touche des dizaines de personnes.
    if (op === 'count') {
      const ids = targets.map((s) => s.id)
      let members = 0
      if (ids.length > 0) {
        const { count } = await admin
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .in('slot_id', ids)
          .in('status', ['confirmed', 'waitlisted'])
        members = count ?? 0
      }
      return jsonResponse({
        slots: targets.length,
        members,
        skipped_exceptions: skippedExceptions,
      })
    }

    // ── DELETE — cancel_slot_atomic créneau par créneau. ─────────────────────
    //
    // ⚠️ CHAQUE CRÉNEAU EST SA PROPRE TRANSACTION, volontairement. cancel_slot_atomic
    // verrouille le créneau, annule les réservations, RECRÉDITE exactement les débits et
    // purge la liste d'attente. Les grouper en une seule transaction tiendrait un verrou
    // sur 52 créneaux pendant tout le traitement, bloquant les réservations en cours pour
    // toute la salle. Elle est de surcroît IDEMPOTENTE ('already_cancelled') : relancer
    // après un échec partiel est sans danger.
    //
    // L'échec partiel n'est donc PAS masqué : on continue, on compte, et on renvoie la
    // liste des créneaux en échec. Le gérant voit « 50 annulés, 2 en échec » et peut
    // relancer — plutôt qu'un « erreur » qui laisserait la série dans un état inconnu.
    if (op === 'delete') {
      let cancelled = 0
      let creditsRefunded = 0
      let bookingsCancelled = 0
      let notified = 0
      const failed: string[] = []

      // ⚠️ ON DÉLÈGUE À cancel-slot, ON NE RAPPELLE PAS LA RPC DIRECTEMENT.
      //
      // cancel_slot_atomic fait le travail transactionnel — annulation, recrédit exact,
      // purge de la liste d'attente — mais elle NE NOTIFIE PAS : c'est l'Edge cancel-slot
      // qui émet le push Expo et l'email Resend brandé pour chaque inscrit. L'appeler
      // directement aurait donc annulé 52 cours en laissant 12 membres l'apprendre en se
      // présentant devant une porte fermée.
      //
      // Décision produit 4 : les membres sont NOTIFIÉS. On réutilise le mécanisme existant
      // au lieu d'en réécrire un — c'est un appel de plus par créneau, entièrement
      // serveur-à-serveur, donc insensible à la fermeture de l'onglet du gérant.
      for (const slot of targets) {
        try {
          const resp = await fetch(`${supabaseUrl}/functions/v1/cancel-slot`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Le jeton du GÉRANT est retransmis : cancel-slot refait ses propres
              // contrôles de rôle et d'appartenance, elle ne fait confiance à personne.
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ slot_id: slot.id, reason: body?.reason ?? undefined }),
          })
          const result = await resp.json().catch(() => null)
          if (!resp.ok || !result) {
            console.error('[slot-series-op] cancel-slot failed:', slot.id, resp.status)
            failed.push(slot.id)
            continue
          }
          // 'already_cancelled' (idempotence, double-clic ou reprise après échec partiel)
          // n'est PAS un échec : le créneau est dans l'état voulu.
          if (result.status === 'cancelled' || result.already_cancelled) {
            cancelled += 1
            bookingsCancelled += (result.bookings_cancelled as number) ?? 0
            creditsRefunded += (result.credits_refunded as number) ?? 0
            notified += (result.notified as number) ?? 0
          }
        } catch (e) {
          console.error('[slot-series-op] cancel-slot threw:', slot.id, e)
          failed.push(slot.id)
        }
      }

      return jsonResponse({
        op: 'delete',
        slots_cancelled: cancelled,
        bookings_cancelled: bookingsCancelled,
        credits_refunded: creditsRefunded,
        notified,
        skipped_exceptions: skippedExceptions,
        failed_slot_ids: failed,
      }, failed.length > 0 ? 207 : 200)
    }

    // ── UPDATE — écrire le gabarit sur les créneaux futurs. ──────────────────
    if (op === 'update') {
      const patch = body?.patch ?? {}
      if (Object.keys(patch).length === 0) {
        return errorResponse(400, 'NO_FIELDS', 'Aucun champ à modifier')
      }

      // Champs communs, écrits tels quels sur chaque créneau.
      const common: Record<string, unknown> = {}
      if (patch.activity_id !== undefined) common.activity_id = patch.activity_id
      if (patch.coach_id !== undefined) common.coach_id = patch.coach_id || null
      if (patch.capacity !== undefined) common.capacity = patch.capacity
      if (patch.level !== undefined) common.level = patch.level
      if (patch.notes !== undefined) common.notes = patch.notes || null
      common.updated_at = new Date().toISOString()

      // ⚠️ L'HEURE SE RECALCULE PAR CRÉNEAU, JAMAIS PAR DÉCALAGE UNIFORME.
      //
      // Déplacer une série de 9 h à 10 h ne peut PAS se faire en ajoutant une heure à
      // chaque `starts_at` : de part et d'autre du 25 octobre, le même décalage absolu ne
      // donne pas la même heure à l'horloge. On recompose donc « date locale du créneau +
      // nouvelle heure locale », et on reconvertit avec le fuseau DE LA SÉRIE — celui qui a
      // été capturé à sa création.
      const newTime = patch.starts_local_time
      const newDuration = patch.duration_min ?? (series.duration_min as number)
      const tz = series.timezone as string

      let updated = 0
      const failed: string[] = []

      for (const slot of targets) {
        const fields = { ...common }

        if (newTime) {
          // Date LOCALE du créneau, telle que la voit la salle. En portée 'single', le
          // gérant peut aussi l'avoir déplacé : sa date prime alors. En portée 'following'
          // on garde CELLE DE CHAQUE OCCURRENCE — les aligner sur une seule date les
          // empilerait toutes au même jour.
          const localDate = (scope === 'single' && patch.starts_local_date)
            ? patch.starts_local_date
            : new Intl.DateTimeFormat('en-CA', {
                timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
              }).format(new Date(slot.starts_at as string))

          const starts = zonedToUtc(localDate, newTime, tz)
          const ends = new Date(starts.getTime() + newDuration * 60_000)
          fields.starts_at = starts.toISOString()
          fields.ends_at = ends.toISOString()
        } else if (patch.duration_min !== undefined) {
          // Durée seule : on garde le début, on décale la fin.
          const starts = new Date(slot.starts_at as string)
          fields.ends_at = new Date(starts.getTime() + newDuration * 60_000).toISOString()
        }

        // Portée 'single' : le créneau diverge désormais de sa série, il devient une
        // EXCEPTION (décision produit 5). Ce marquage était fait côté client — il vit
        // désormais dans la même écriture que le reste, donc dans la même transaction
        // logique. Un marquage qui échouait seul laissait un créneau modifié que la
        // série réécraserait ensuite.
        if (scope === 'single') fields.is_series_exception = true

        const { error } = await admin.from('time_slots').update(fields).eq('id', slot.id)
        if (error) {
          console.error('[slot-series-op] update failed:', slot.id, error.message)
          failed.push(slot.id)
          continue
        }
        updated += 1
      }

      // Le GABARIT de la série suit : les occurrences générées PLUS TARD (prolongation)
      // doivent naître avec les nouvelles valeurs, sinon la série se remettrait à produire
      // l'ancien horaire.
      const seriesPatch: Record<string, unknown> = {}
      if (patch.activity_id !== undefined) seriesPatch.activity_id = patch.activity_id
      if (patch.coach_id !== undefined) seriesPatch.coach_id = patch.coach_id || null
      if (patch.capacity !== undefined) seriesPatch.capacity = patch.capacity
      if (patch.level !== undefined) seriesPatch.level = patch.level
      if (patch.notes !== undefined) seriesPatch.notes = patch.notes || null
      if (newTime) seriesPatch.starts_local_time = newTime
      if (patch.duration_min !== undefined) seriesPatch.duration_min = patch.duration_min

      // ⚠️ UNIQUEMENT en portée 'following'. Une exception ne redéfinit pas la série :
      // propager son horaire au gabarit ferait naître toutes les occurrences futures avec
      // l'horaire d'un cours qu'on avait justement voulu traiter à part.
      if (scope === 'following' && Object.keys(seriesPatch).length > 0) {
        const { error: seriesErr } = await admin
          .from('slot_series').update(seriesPatch).eq('id', series.id)
        if (seriesErr) console.error('[slot-series-op] series template update failed:', seriesErr.message)
      }

      // ── NOTIFIER LES INSCRITS ────────────────────────────────────────────────
      //
      // DÉCISION PRODUIT 4 : les réservations suivent la modification, et les membres
      // sont PRÉVENUS. La suppression le faisait déjà (via cancel-slot) ; la modification
      // ne le faisait pas — et c'est le cas le plus dangereux des deux. Une annulation se
      // voit dans l'app, le cours disparaît. Un décalage de 18 h à 18 h 30 NE SE VOIT PAS :
      // le membre croit savoir, et se présente devant une salle vide.
      const notify = await notifyAffectedMembers(admin, supabaseUrl, serviceKey, {
        slotIds: targets.map((s) => s.id),
        activityId: (patch.activity_id as string | undefined) ?? null,
        seriesActivityId: series.activity_id as string,
        slotCount: updated,
        newTime: newTime ?? null,
        timeChanged: !!newTime || patch.duration_min !== undefined,
        coachChanged: patch.coach_id !== undefined,
        activityChanged: patch.activity_id !== undefined,
      })

      return jsonResponse({
        op: 'update',
        slots_updated: updated,
        skipped_exceptions: skippedExceptions,
        failed_slot_ids: failed,
        // `members_notified` = membres atteints par AU MOINS UN canal — c'est ce qui
        // intéresse le gérant. Le détail par canal reste exposé pour le diagnostic.
        members_notified: notify.reached,
        push_notified: notify.pushNotified,
        email_notified: notify.emailNotified,
        notification_skipped: notify.skippedReason,
      }, failed.length > 0 ? 207 : 200)
    }

    return errorResponse(400, 'UNKNOWN_OP', `Opération inconnue : ${op}`)
  } catch (err) {
    console.error('[slot-series-op] uncaught:', err)
    return errorResponse(500, 'SERVER_ERROR', (err as Error).message)
  }
})


/**
 * Courrier « cours modifié ».
 *
 * ⚠️ MISE EN PAGE REPRISE TELLE QUELLE de cancelEmailHtml (cancel-slot) : même bandeau
 * DOPAMINE, mêmes couleurs, même bouton, même pied. On ne réinvente pas une seconde
 * charte — un membre doit reconnaître l'expéditeur au premier coup d'œil, et deux gabarits
 * divergeraient au premier ajustement.
 */
function seriesUpdateEmailHtml(
  firstName: string | null,
  activityName: string,
  whatChanged: string,
  slotCount: number,
): string {
  const greeting = firstName ? `Bonjour ${firstName},` : 'Bonjour,'
  // Le NOMBRE de séances concernées : sans lui, le membre croirait qu'une seule date bouge.
  const scopeBlock = slotCount > 1
    ? `<p style="color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 12px;">Ce changement concerne <strong>${slotCount} séances</strong> à venir.</p>`
    : ''
  return `<div style="font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;background:#F5F4F0;padding:40px 20px;"><div style="max-width:520px;margin:0 auto;"><div style="background:#111111;padding:24px;border-radius:16px 16px 0 0;text-align:center;"><span style="font-family:'Arial Black',Arial,sans-serif;color:#C8F000;font-size:24px;letter-spacing:2px;">DOPAMINE</span></div><div style="background:#FFFFFF;padding:32px 28px;border-radius:0 0 16px 16px;"><div style="font-size:28px;margin-bottom:12px;">📅</div><h2 style="margin:0 0 8px;color:#111111;font-size:20px;">Ton cours a été modifié</h2><p style="color:#9A9890;font-size:13px;margin:0 0 20px;">${greeting}</p><p style="color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 12px;">Ton cours <strong>${activityName}</strong> a changé : ${whatChanged}.</p>${scopeBlock}<p style="color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 12px;">Tes réservations sont conservées — rien à refaire de ton côté.</p><a href="dopamine://bookings" style="display:inline-block;background:#C8F000;color:#111111;font-weight:bold;font-size:14px;text-decoration:none;padding:14px 28px;border-radius:12px;margin-top:8px;">Voir mes réservations →</a></div><p style="text-align:center;color:#9A9890;font-size:11px;margin:16px 0 0;">Dopamine Performance Club · Neupré</p></div></div>`
}

/**
 * GYM-230 — prévient les inscrits qu'un cours de leur série a changé.
 *
 * ⚠️ SEULS LES CHANGEMENTS VISIBLES DÉCLENCHENT UN ENVOI.
 *   · horaire (début ou durée) → OUI, le cas critique : invisible dans l'app, et c'est
 *     précisément celui qui fait arriver quelqu'un devant une porte fermée ;
 *   · coach                    → OUI, un membre vient parfois POUR quelqu'un ;
 *   · activité                 → OUI, même raison : ce n'est plus le cours réservé ;
 *   · capacité                 → NON, invisible et sans effet sur la place déjà acquise ;
 *   · notes internes           → NON, le membre ne les voit pas.
 * Un membre prévenu pour rien apprend à ignorer les notifications — et n'ouvrira pas
 * celle qui comptait.
 *
 * ⚠️ UN SEUL ENVOI PAR MEMBRE, PAS UN PAR CRÉNEAU. Quelqu'un inscrit aux huit cours d'une
 * série recevrait huit notifications pour un seul changement. Les jetons sont dédupliqués
 * et send-notification accepte un TABLEAU : un appel, un message par personne.
 *
 * ⚠️ BEST-EFFORT, jamais bloquant. Le créneau prime sur le message : la modification est
 * déjà écrite quand on arrive ici, et un échec d'envoi ne la défait pas. L'échec est
 * journalisé avec de quoi le rejouer (nombre de destinataires, cause), jamais avalé.
 */
async function notifyAffectedMembers(
  admin: SupabaseClient,
  supabaseUrl: string,
  serviceKey: string,
  ctx: {
    slotIds: string[]
    activityId: string | null
    seriesActivityId: string
    slotCount: number
    newTime: string | null
    timeChanged: boolean
    coachChanged: boolean
    activityChanged: boolean
  },
): Promise<{ pushNotified: number; emailNotified: number; reached: number; skippedReason?: string }> {
  const visible = ctx.timeChanged || ctx.coachChanged || ctx.activityChanged
  if (!visible) return { pushNotified: 0, emailNotified: 0, reached: 0, skippedReason: 'NO_VISIBLE_CHANGE' }
  if (ctx.slotIds.length === 0) return { pushNotified: 0, emailNotified: 0, reached: 0, skippedReason: 'NO_SLOTS' }

  try {
    // Inscrits CONFIRMÉS uniquement : la liste d'attente n'a pas de place à défendre, et
    // sera notifiée par le chemin habituel si une place se libère.
    const { data: rows } = await admin
      .from('bookings')
      .select('member_id, profiles(push_token, email, first_name)')
      .in('slot_id', ctx.slotIds)
      .eq('status', 'confirmed')

    // ⚠️ DÉDUPLICATION PAR MEMBRE — la clé du regroupement, et elle vaut pour LES DEUX
    // CANAUX. Quelqu'un inscrit aux huit cours d'une série apparaît huit fois dans cette
    // requête ; sans ce Map il recevrait huit push ET huit emails pour un seul changement.
    const members = new Map<string, { push: string | null; email: string | null; firstName: string | null }>()
    for (const r of (rows ?? []) as Array<{
      member_id: string
      profiles: { push_token: string | null; email: string | null; first_name: string | null } | { push_token: string | null; email: string | null; first_name: string | null }[] | null
    }>) {
      if (members.has(r.member_id)) continue
      const prof = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
      members.set(r.member_id, {
        push: prof?.push_token ?? null,
        email: prof?.email ?? null,
        firstName: prof?.first_name ?? null,
      })
    }
    if (members.size === 0) return { pushNotified: 0, emailNotified: 0, reached: 0, skippedReason: 'NO_MEMBERS' }

    const { data: activity } = await admin
      .from('activities')
      .select('name')
      .eq('id', ctx.activityId ?? ctx.seriesActivityId)
      .single()
    const activityName = (activity?.name as string) ?? 'Cours'

    const what = ctx.timeChanged && ctx.newTime
      ? `nouvel horaire : ${ctx.newTime}`
      : ctx.activityChanged
        ? 'le cours a changé'
        : 'changement de coach'

    const reachedMembers = new Set<string>()

    // ── Canal 1 : push ────────────────────────────────────────────────────────
    // send-notification accepte un TABLEAU : un seul appel HTTP pour tous les jetons,
    // et un message par personne.
    let pushNotified = 0
    const tokens = [...members.values()].map((m) => m.push).filter((t): t is string => !!t)
    if (tokens.length > 0) {
      try {
        const body = ctx.slotCount > 1
          ? `${activityName} — ${what} (${ctx.slotCount} séances concernées).`
          : `${activityName} — ${what}.`
        const resp = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            tokens,
            title: 'Ton cours a été modifié',
            body,
            data: { type: 'slot_series_updated' },
          }),
        })
        if (resp.ok) {
          pushNotified = tokens.length
          for (const [id, m] of members) if (m.push) reachedMembers.add(id)
        } else {
          // ⚠️ JOURNAL SÉPARÉ push / email : on doit pouvoir savoir LEQUEL des deux a
          // échoué. Un log commun laisserait croire que personne n'a rien reçu alors que
          // l'autre canal a peut-être fonctionné.
          console.error('[slot-series-op] PUSH failed:', JSON.stringify({
            status: resp.status, recipients: tokens.length, slots: ctx.slotCount,
          }))
        }
      } catch (e) {
        console.error('[slot-series-op] PUSH threw:', JSON.stringify({
          recipients: tokens.length, error: (e as Error).message,
        }))
      }
    }

    // ── Canal 2 : email ───────────────────────────────────────────────────────
    //
    // ⚠️ CE CANAL N'EST PAS UN CONFORT. L'app n'existe que sur iOS ; en Belgique Android
    // pèse 40 à 45 % du parc, et la publication n'arrivera pas avant septembre. Ces
    // membres — exactement ceux que le gérant inscrit lui-même depuis son dashboard
    // (GYM-226) — n'ont AUCUN autre moyen d'apprendre qu'un cours a changé d'heure.
    //
    // Un envoi PAR MEMBRE et non un envoi groupé : Resend accepte un tableau dans `to`,
    // mais tous les destinataires s'y verraient mutuellement, et le prénom ne pourrait pas
    // être personnalisé. Même forme que cancel-slot.
    let emailNotified = 0
    if (RESEND_KEY) {
      for (const [id, m] of members) {
        if (!m.email) continue
        try {
          const resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
            body: JSON.stringify({
              from: 'Dopamine Performance Club <noreply@viniz.app>',
              to: m.email,
              subject: `Cours modifié — ${activityName}`,
              html: seriesUpdateEmailHtml(m.firstName, activityName, what, ctx.slotCount),
            }),
          })
          if (resp.ok) {
            emailNotified += 1
            reachedMembers.add(id)
          } else {
            console.error('[slot-series-op] EMAIL failed:', JSON.stringify({
              member_id: id, status: resp.status, slots: ctx.slotCount,
            }))
          }
        } catch (e) {
          console.error('[slot-series-op] EMAIL threw:', JSON.stringify({
            member_id: id, error: (e as Error).message,
          }))
        }
      }
    }

    return { pushNotified, emailNotified, reached: reachedMembers.size }
  } catch (e) {
    // Journalisé de façon exploitable : on doit pouvoir savoir QUI n'a pas été prévenu.
    console.error('[slot-series-op] notify threw (non-blocking):', JSON.stringify({
      slots: ctx.slotCount, error: (e as Error).message,
    }))
    return { pushNotified: 0, emailNotified: 0, reached: 0, skippedReason: 'NOTIFY_THREW' }
  }
}


/**
 * « Date locale + heure locale + fuseau » → instant UTC, sans dépendance externe.
 *
 * Deno n'a pas date-fns-tz ici ; on résout le décalage en interrogeant Intl pour l'instant
 * candidat, puis en corrigeant. Deux passes suffisent : la première donne le bon décalage
 * sauf exactement pendant l'heure de bascule, la seconde le stabilise.
 */
function zonedToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, mi] = timeStr.split(':').map(Number)
  // Hypothèse de départ : l'heure locale lue comme si elle était UTC.
  let ts = Date.UTC(y, mo - 1, d, h, mi, 0, 0)
  for (let i = 0; i < 2; i++) {
    const offset = tzOffsetMs(new Date(ts), timeZone)
    ts = Date.UTC(y, mo - 1, d, h, mi, 0, 0) - offset
  }
  return new Date(ts)
}

/** Décalage du fuseau, en millisecondes, à un instant donné. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - at.getTime()
}
