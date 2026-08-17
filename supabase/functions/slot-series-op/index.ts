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
  /** Champs à écrire sur les créneaux futurs de la série (op 'update'). */
  patch?: {
    activity_id?: string
    coach_id?: string | null
    capacity?: number
    level?: string
    notes?: string | null
    /** Heure LOCALE 'HH:mm' — jamais un instant UTC (cf. plus bas). */
    starts_local_time?: string
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
) {
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

    const { targets, skippedExceptions } = await selectTargets(admin, pivot.series_id, pivot.starts_at)

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
          // Date LOCALE du créneau, telle que la voit la salle.
          const localDate = new Intl.DateTimeFormat('en-CA', {
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

      if (Object.keys(seriesPatch).length > 0) {
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
        members_notified: notify.notified,
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
): Promise<{ notified: number; skippedReason?: string }> {
  const visible = ctx.timeChanged || ctx.coachChanged || ctx.activityChanged
  if (!visible) return { notified: 0, skippedReason: 'NO_VISIBLE_CHANGE' }
  if (ctx.slotIds.length === 0) return { notified: 0, skippedReason: 'NO_SLOTS' }

  try {
    // Inscrits CONFIRMÉS uniquement : la liste d'attente n'a pas de place à défendre, et
    // sera notifiée par le chemin habituel si une place se libère.
    const { data: rows } = await admin
      .from('bookings')
      .select('member_id, profiles(push_token)')
      .in('slot_id', ctx.slotIds)
      .eq('status', 'confirmed')

    // Déduplication PAR JETON : c'est elle qui garantit « un message par personne ».
    const tokens = new Set<string>()
    for (const r of (rows ?? []) as Array<{ profiles: { push_token: string | null } | { push_token: string | null }[] | null }>) {
      const prof = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles
      if (prof?.push_token) tokens.add(prof.push_token)
    }
    if (tokens.size === 0) return { notified: 0, skippedReason: 'NO_PUSH_TOKEN' }

    const { data: activity } = await admin
      .from('activities')
      .select('name')
      .eq('id', ctx.activityId ?? ctx.seriesActivityId)
      .single()
    const activityName = (activity?.name as string) ?? 'Cours'

    // Message GROUPÉ : il porte le nombre de séances concernées, sinon le membre croirait
    // qu'une seule date bouge.
    const what = ctx.timeChanged && ctx.newTime
      ? `nouvel horaire : ${ctx.newTime}`
      : ctx.activityChanged
        ? 'le cours a changé'
        : 'changement de coach'

    const body = ctx.slotCount > 1
      ? `${activityName} — ${what} (${ctx.slotCount} séances concernées).`
      : `${activityName} — ${what}.`

    const resp = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        tokens: [...tokens],
        title: 'Ton cours a été modifié',
        body,
        data: { type: 'slot_series_updated' },
      }),
    })

    if (!resp.ok) {
      console.error('[slot-series-op] send-notification refused:', JSON.stringify({
        status: resp.status, recipients: tokens.size, slots: ctx.slotCount,
      }))
      return { notified: 0, skippedReason: 'SEND_FAILED' }
    }
    return { notified: tokens.size }
  } catch (e) {
    // Journalisé de façon exploitable : on doit pouvoir savoir QUI n'a pas été prévenu.
    console.error('[slot-series-op] notify threw (non-blocking):', JSON.stringify({
      slots: ctx.slotCount, error: (e as Error).message,
    }))
    return { notified: 0, skippedReason: 'SEND_THREW' }
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
