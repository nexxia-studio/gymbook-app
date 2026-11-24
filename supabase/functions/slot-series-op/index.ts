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
// GYM-238 — en-tête, pied, bouton et expéditeur composés depuis nexxia_gyms.
import { loadGymBranding, emailSender, emailShell, type GymBranding } from '../_shared/gym-branding.ts'
// GYM-391 — la ligne de la boîte de réception et le push, en un seul geste.
import { notifier, textes } from '../_shared/notify.ts'
// GYM-391 — la demande comparée à l'état lu en base : seul ce qui change s'écrit et se dit.
import {
  applyToSlots, diffSeries, groupByMember, isVisible,
  type ChangeRequest, type MemberMessage, type SeriesRow, type SlotChange, type SlotPatch, type SlotRow,
} from './changes.ts'

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
  patch?: SlotPatch
  /** Motif d'annulation, transmis tel quel à cancel_slot_atomic (op 'delete'). */
  reason?: string
}

/** Ce que la comparaison lit d'un créneau (`SlotRow`), plus le compte d'inscrits. */
const SLOT_COLUMNS =
  'id, starts_at, ends_at, bookings_count, is_series_exception, activity_id, coach_id, capacity, level, notes, updated_at'

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
      .select(SLOT_COLUMNS)
      .eq('id', pivotId)
      .single()
    return { targets: data ? [data] : [], skippedExceptions: 0 }
  }

  const { data } = await admin
    .from('time_slots')
    .select(SLOT_COLUMNS)
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

    // ── Le pivot, et sa série ÉVENTUELLE. gym_id lu sur le PROFIL de l'appelant. ──
    const { data: pivot } = await admin
      .from('time_slots')
      .select('id, gym_id, series_id, activity_id, starts_at, ends_at')
      .eq('id', slotId)
      .single()

    if (!pivot) return errorResponse(404, 'SLOT_NOT_FOUND', 'Créneau introuvable')
    if (pivot.gym_id !== gymId) return errorResponse(403, 'WRONG_GYM', 'Créneau hors de votre salle')

    // 🔴 GYM-236 — LE REFUS « NOT_IN_SERIES » A DISPARU.
    //
    // Cette fonction exigeait un series_id, et le chemin ponctuel écrivait donc en
    // PostgREST direct — sans jamais notifier personne. C'est le défaut relevé en corrigeant
    // GYM-230, et c'est le cas le PLUS FRÉQUENT : un gérant décale un cours isolé (coach
    // absent, imprévu) bien plus souvent qu'une série entière.
    //
    // Un créneau ponctuel n'est pas un cas particulier : c'est une série d'UNE occurrence.
    // La fonction le traite donc comme un lot de un, et tout ce qui suit — détection du
    // changement visible, déduplication, push + email, journalisation — s'applique à
    // l'identique. Une seule voie d'écriture, donc un seul endroit qui notifie.
    const isStandalone = !pivot.series_id

    const { data: series } = isStandalone
      ? { data: null }
      : await admin
          .from('slot_series')
          .select('id, gym_id, timezone, starts_local_time, duration_min, activity_id, coach_id, capacity, level, notes')
          .eq('id', pivot.series_id)
          .single()

    if (!isStandalone && (!series || series.gym_id !== gymId)) {
      return errorResponse(403, 'WRONG_GYM', 'Série hors de votre salle')
    }

    // Le FUSEAU : celui de la série quand elle existe (capturé à sa création, il ne suit
    // pas les changements de la salle), sinon celui du gym — la source dont la série tire
    // le sien. Sans lui, recomposer « date locale + heure locale » serait impossible, et
    // c'est cette conversion par créneau qui absorbe le changement d'heure du 25 octobre.
    let timeZone: string
    if (series) {
      timeZone = series.timezone as string
    } else {
      const { data: gym } = await admin
        .from('nexxia_gyms').select('timezone').eq('id', gymId).single()
      timeZone = (gym?.timezone as string) ?? 'Europe/Brussels'
    }

    // Sans série, il n'y a rien « après » : la portée large n'a pas de sens et serait
    // trompeuse. On la ramène à 'single' plutôt que de renvoyer une erreur — l'appelant
    // demande de modifier CE créneau, et c'est exactement ce qui va se passer.
    const scope = isStandalone ? 'single' : (body?.scope ?? 'following')
    const { targets, skippedExceptions } = await selectTargets(
      admin, (pivot.series_id as string) ?? '', pivot.starts_at, scope, pivot.id as string,
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

      // 🔴 GYM-391 (recette staging 24/11) — LA DEMANDE EST COMPARÉE À L'ÉTAT EN BASE.
      //
      // Le formulaire envoie tous ses champs à chaque enregistrement. Lire « champ présent »
      // comme « champ modifié » donnait time_changed, coach_changed et activity_changed à
      // true pour un simple décalage d'horaire, et une demande rejouée (double clic)
      // réécrivait et renotifiait tout. Désormais, par créneau : seules les colonnes dont
      // la valeur diffère s'écrivent, et un créneau sans différence n'est ni écrit ni
      // notifié. Une demande identique à l'état en base traverse donc la fonction sans
      // rien toucher, et répond 200.
      const request: ChangeRequest = { patch, scope, timeZone, inSeries: !!series }

      // L'écriture est CONDITIONNELLE à l'`updated_at` lu (le trigger trg_slots_updated le
      // renouvelle à chaque UPDATE) : de deux demandes simultanées, une seule écrit et
      // notifie. La boucle et ses reprises vivent dans `applyToSlots`, éprouvée par le banc.
      const { applied, unchanged, failed } = await applyToSlots(targets as SlotRow[], request, {
        async write(slot, fields) {
          const write = admin
            .from('time_slots')
            .update({ ...fields, updated_at: new Date().toISOString() })
            .eq('id', slot.id)
          const { data: written, error } = await (
            slot.updated_at === null ? write.is('updated_at', null) : write.eq('updated_at', slot.updated_at)
          ).select('id')
          if (error) {
            console.error('[slot-series-op] update failed:', slot.id, error.message)
            return 'error'
          }
          return (written ?? []).length > 0 ? 'written' : 'stale'
        },
        async reread(id) {
          const { data } = await admin.from('time_slots').select(SLOT_COLUMNS).eq('id', id).maybeSingle()
          return data as SlotRow | null
        },
      })
      const updated = applied.length

      // Le GABARIT de la série suit : les occurrences générées PLUS TARD (prolongation)
      // doivent naître avec les nouvelles valeurs, sinon la série se remettrait à produire
      // l'ancien horaire. Comparé lui aussi à son état en base : rien à écrire s'il porte
      // déjà ces valeurs.
      //
      // ⚠️ UNIQUEMENT en portée 'following'. Une exception ne redéfinit pas la série :
      // propager son horaire au gabarit ferait naître toutes les occurrences futures avec
      // l'horaire d'un cours qu'on avait justement voulu traiter à part.
      // Un créneau ponctuel n'a pas de gabarit à faire suivre : `series` est null.
      if (series && scope === 'following') {
        const seriesPatch = diffSeries(series as unknown as SeriesRow, patch)
        if (Object.keys(seriesPatch).length > 0) {
          const { error: seriesErr } = await admin
            .from('slot_series').update(seriesPatch).eq('id', series.id)
          if (seriesErr) console.error('[slot-series-op] series template update failed:', seriesErr.message)
        }
      }

      // ── NOTIFIER LES INSCRITS ────────────────────────────────────────────────
      //
      // DÉCISION PRODUIT 4 : les réservations suivent la modification, et les membres
      // sont PRÉVENUS. La suppression le faisait déjà (via cancel-slot) ; la modification
      // ne le faisait pas — et c'est le cas le plus dangereux des deux. Une annulation se
      // voit dans l'app, le cours disparaît. Un décalage de 18 h à 18 h 30 NE SE VOIT PAS :
      // le membre croit savoir, et se présente devant une salle vide.
      //
      // GYM-391 — seuls les créneaux que CETTE demande a réellement écrits y entrent.
      const notify = await notifyAffectedMembers(admin, gymId, applied)

      return jsonResponse({
        op: 'update',
        slots_updated: updated,
        // Créneaux déjà dans l'état demandé : ni écrits, ni notifiés.
        slots_unchanged: unchanged,
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
  gym: GymBranding,
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
  // GYM-238 — corps seul : la chrome vient de la coquille partagée, aux couleurs et au
  // nom de la salle lus en base.
  return emailShell(gym, {
    emoji: '📅',
    title: 'Ton cours a été modifié',
    bodyHtml:
      `<p style="color:#9A9890;font-size:13px;margin:0 0 20px;">${greeting}</p>` +
      `<p style="color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 12px;">Ton cours <strong>${activityName}</strong> a changé : ${whatChanged}.</p>` +
      scopeBlock +
      `<p style="color:#3D3B36;font-size:14px;line-height:1.6;margin:0 0 12px;">Tes réservations sont conservées — rien à refaire de ton côté.</p>`,
    ctaLabel: 'Voir mes réservations →',
    // 🔴 ÉTAIT `dopamine://bookings` : inerte dans tout client mail.
    ctaPath: 'bookings',
  })
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
 * 🔴 GYM-391 — « CHANGEMENT » S'ENTEND PAR RAPPORT À LA BASE. `applied` ne porte que les
 * créneaux réellement écrits, chacun avec ses drapeaux réels (`changes.ts`). Un créneau
 * déjà dans l'état demandé n'y figure pas, et ses inscrits ne reçoivent rien.
 *
 * ⚠️ UN SEUL ENVOI PAR MEMBRE, PAS UN PAR CRÉNEAU. Quelqu'un inscrit à huit cours de la
 * série reçoit UNE ligne et UN push, qui disent « 8 séances concernées » : le compte est
 * celui de SES séances, pas celui de la série.
 *
 * ⚠️ BEST-EFFORT, jamais bloquant. Le créneau prime sur le message : la modification est
 * déjà écrite quand on arrive ici, et un échec d'envoi ne la défait pas. L'échec est
 * journalisé avec de quoi le rejouer (nombre de destinataires, cause), jamais avalé.
 */
async function notifyAffectedMembers(
  admin: SupabaseClient,
  // GYM-238 — la salle dont on emprunte l'identité pour les emails. Passée plutôt que
  // relue ici : l'appelant l'a déjà validée (gym_id du PROFIL, jamais du body).
  gymId: string,
  applied: Array<{ slotId: string; change: SlotChange }>,
): Promise<{ pushNotified: number; emailNotified: number; reached: number; skippedReason?: string }> {
  if (applied.length === 0) return { pushNotified: 0, emailNotified: 0, reached: 0, skippedReason: 'NO_CHANGE' }
  const visible = applied.filter((a) => isVisible(a.change))
  if (visible.length === 0) return { pushNotified: 0, emailNotified: 0, reached: 0, skippedReason: 'NO_VISIBLE_CHANGE' }

  try {
    // Inscrits CONFIRMÉS uniquement : la liste d'attente n'a pas de place à défendre, et
    // sera notifiée par le chemin habituel si une place se libère.
    const { data: rows } = await admin
      .from('bookings')
      // GYM-391 — `slot_id` : la ligne de la boîte de réception pointe un cours du membre.
      .select('member_id, slot_id, profiles(push_token, email, first_name)')
      .in('slot_id', visible.map((a) => a.slotId))
      .eq('status', 'confirmed')

    type Profile = { push_token: string | null; email: string | null; first_name: string | null }
    const bookings = (rows ?? []) as Array<{ member_id: string; slot_id: string; profiles: Profile | Profile[] | null }>
    const profiles = new Map<string, Profile | null>()
    for (const r of bookings) {
      if (!profiles.has(r.member_id)) profiles.set(r.member_id, Array.isArray(r.profiles) ? (r.profiles[0] ?? null) : r.profiles)
    }

    // ⚠️ REGROUPEMENT PAR MEMBRE — il vaut pour LES DEUX CANAUX. Quelqu'un inscrit à huit
    // cours apparaît huit fois dans la requête ci-dessus ; il ne reçoit qu'un push et un
    // email, qui portent le nombre de ses séances concernées.
    const messages: MemberMessage[] = groupByMember(visible, bookings)
    if (messages.length === 0) return { pushNotified: 0, emailNotified: 0, reached: 0, skippedReason: 'NO_MEMBERS' }

    const { data: activities } = await admin
      .from('activities')
      .select('id, name')
      .in('id', [...new Set(messages.map((m) => m.activityId))])
    const activityNames = new Map((activities ?? []).map((a) => [a.id as string, a.name as string]))
    const nameOf = (m: MemberMessage): string => activityNames.get(m.activityId) ?? 'Cours'

    const reachedMembers = new Set<string>()

    // ── Canal 1 : boîte de réception + push ───────────────────────────────────
    //
    // GYM-391 — UNE ligne 'session_updated_by_gym' par membre concerné, jeton ou pas, et
    // le push pour ceux qui en ont un, par l'aide partagée.
    //
    // ⚠️ `pushType` garde 'slot_series_updated', le `data.type` que ce push a toujours porté.
    //
    // `pushNotified` compte les tickets Expo `ok`, pas « autant que de jetons dès que
    // l'appel a répondu 2xx » : un plan sans notifications répondait 200 et tous les
    // membres étaient comptés prévenus.
    //
    // Par paquets de 10 en parallèle : un cours de 40 inscrits ne doit pas enchaîner 40
    // allers-retours l'un après l'autre.
    let pushNotified = 0
    for (let i = 0; i < messages.length; i += 10) {
      const issues = await Promise.all(messages.slice(i, i + 10).map((m) =>
        notifier(admin, {
          gymId,
          memberId: m.memberId,
          type: 'session_updated_by_gym',
          ...textes.coursModifie({ activite: nameOf(m), quoi: m.what, seances: m.slotCount }),
          data: {
            slot_id: m.slotId,
            slot_count: m.slotCount,
            time_changed: m.time_changed,
            coach_changed: m.coach_changed,
            activity_changed: m.activity_changed,
          },
          pushToken: profiles.get(m.memberId)?.push_token ?? null,
          pushType: 'slot_series_updated',
        }).then((issue) => ({ id: m.memberId, issue }))))
      for (const { id, issue } of issues) {
        if (issue.push_sent) { pushNotified += 1; reachedMembers.add(id) }
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
    // UNE lecture pour tout le lot : l'identité de la salle ne change pas d'un
    // destinataire à l'autre.
    const gym = await loadGymBranding(admin, gymId)

    let emailNotified = 0
    if (RESEND_KEY) {
      for (const m of messages) {
        const profile = profiles.get(m.memberId)
        if (!profile?.email) continue
        try {
          const resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
            body: JSON.stringify({
              from: emailSender(gym),
              to: profile.email,
              subject: `Cours modifié — ${nameOf(m)}`,
              html: seriesUpdateEmailHtml(gym, profile.first_name, nameOf(m), m.what, m.slotCount),
            }),
          })
          if (resp.ok) {
            emailNotified += 1
            reachedMembers.add(m.memberId)
          } else {
            console.error('[slot-series-op] EMAIL failed:', JSON.stringify({
              member_id: m.memberId, status: resp.status, slots: m.slotCount,
            }))
          }
        } catch (e) {
          console.error('[slot-series-op] EMAIL threw:', JSON.stringify({
            member_id: m.memberId, error: (e as Error).message,
          }))
        }
      }
    }

    return { pushNotified, emailNotified, reached: reachedMembers.size }
  } catch (e) {
    // Journalisé de façon exploitable : on doit pouvoir savoir QUI n'a pas été prévenu.
    console.error('[slot-series-op] notify threw (non-blocking):', JSON.stringify({
      slots: applied.length, error: (e as Error).message,
    }))
    return { pushNotified: 0, emailNotified: 0, reached: 0, skippedReason: 'NOTIFY_THREW' }
  }
}
