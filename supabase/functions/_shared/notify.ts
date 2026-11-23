// GYM-391 — LE SEUL POINT D'ÉCRITURE DES MESSAGES AU MEMBRE : UNE LIGNE ET UN PUSH.
//
// Chez Dopamine, 87 membres sur 171 ont un jeton push (mesure du 23/11). Les autres ne
// reçoivent rien d'un push. `public.notifications` est la boîte de réception que TOUT
// membre retrouvera dans l'app, qu'il ait autorisé les notifications ou non.
//
// `notifier` fait les deux gestes, dans cet ordre :
//   1. le push, via `send-notification` (gym_id + X-Internal-Secret), si le membre a un jeton ;
//   2. UNE ligne dans `public.notifications`, avec `push_sent` = ce qu'Expo a répondu.
//
// ⚠️ UNE FONCTION QUI APPELLE `notifier` N'APPELLE PLUS `send-notification` ELLE-MÊME pour
// le même événement : sinon le membre reçoit deux push, ou un push sans ligne.
//
// ⚠️ `push_sent` NE MENT PAS, même règle que `send-communication` (GYM-134) : vrai si le
// jeton a reçu un ticket `ok` d'Expo, pas parce que le membre a un jeton. La lecture de la
// réponse (`jetonsAcceptes`) vit ici ; `send-communication/push-batches.ts` la réexporte.
//
// ⚠️ NE LÈVE JAMAIS. Un message qui échoue ne doit défaire ni une réservation ni un
// paiement : l'échec est journalisé et rendu dans le résultat.
//
// ⚠️ LA VALEUR DES JETONS N'EST JAMAIS JOURNALISÉE. Les journaux ne portent que des
// identifiants (salle, membre, type) et des codes d'erreur.
//
// `email_sent` n'est pas écrit (il garde son défaut, false) : les emails partent des
// fonctions appelantes, avant ou après ce point selon le cas, et l'aide ne les voit pas.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { INTERNAL_SECRET_ENV, INTERNAL_SECRET_HEADER } from './internal-auth.ts'

/**
 * Les types que cette aide écrit. Chacun figure dans `notifications_type_check` ;
 * 'credits_purchased' y est ajouté par la migration GYM-391.
 */
export type TypeNotification =
  | 'booking_confirmed'
  | 'waitlist_promoted'
  | 'session_cancelled_by_gym'
  | 'subscription_activated'
  | 'subscription_payment_failed'
  | 'credits_purchased'

export interface Notification {
  gymId: string
  memberId: string
  type: TypeNotification
  title: string
  body: string
  /** Le contexte : écrit dans la colonne `data` de la ligne ET joint au push. */
  data?: Record<string, unknown>
  /**
   * Le jeton push du membre, si l'appelant l'a déjà lu (`null` = le membre n'en a pas).
   * Absent (`undefined`) : l'aide le lit dans `profiles`.
   */
  pushToken?: string | null
  /**
   * Le `data.type` du PUSH, quand il doit différer du type de la ligne.
   *
   * Les versions installées de l'app ouvrent un écran selon ce champ
   * (`handleNotificationTap`, apps/mobile/hooks/usePushNotifications.ts) : elles
   * attendent 'waitlist_promotion' et 'slot_cancelled', pas 'waitlist_promoted' ni
   * 'session_cancelled_by_gym'. Changer la valeur casserait le toucher du push sur tout
   * binaire déjà en circulation. Par défaut, le type de la ligne.
   */
  pushType?: string
}

export interface IssueNotification {
  /** La ligne est écrite dans `public.notifications`. */
  inbox_written: boolean
  /** Expo a rendu un ticket `ok` pour le jeton du membre. */
  push_sent: boolean
  /** Le membre avait un jeton : un push a été tenté. */
  push_attempted: boolean
}

/** Ce que `notifier` touche du monde. Remplacé par des doublures dans le banc. */
export interface Dependances {
  /** Le jeton push du membre, ou null. */
  lireJeton(memberId: string): Promise<string | null>
  /** Pousse UN jeton ; rend la réponse de `send-notification`, ou null si l'appel a levé. */
  envoyer(charge: ChargePush): Promise<unknown>
  /** Insère la ligne ; rend le message d'erreur, ou null. */
  ecrire(ligne: LigneNotification): Promise<string | null>
  maintenant(): string
  journal(message: string, detail: Record<string, unknown>): void
}

export interface ChargePush {
  tokens: string[]
  gym_id: string
  title: string
  body: string
  data: Record<string, unknown>
}

export interface LigneNotification {
  gym_id: string
  member_id: string
  type: TypeNotification
  title: string
  body: string
  data: Record<string, unknown> | null
  push_sent: boolean
  sent_at: string
}

/**
 * Lit la réponse de `send-notification` pour UN lot et rend les jetons acceptés par Expo.
 *
 * `results` est la liste des tickets Expo, dans l'ordre des jetons envoyés. Tout ce qui
 * n'est pas exactement cette forme (réponse en erreur, garde de plan, longueur différente)
 * ne valide AUCUN jeton : dans le doute, on ne déclare pas un envoi.
 */
export function jetonsAcceptes(lot: string[], reponse: unknown): string[] {
  const r = reponse as { ok?: unknown; results?: unknown } | null
  if (!r || r.ok !== true || !Array.isArray(r.results) || r.results.length !== lot.length) return []
  return lot.filter((_, i) => (r.results as { status?: unknown }[])[i]?.status === 'ok')
}

/** Jeton utilisable : une chaîne non vide. */
function jetonUtilisable(valeur: unknown): string | null {
  const t = typeof valeur === 'string' ? valeur.trim() : ''
  return t === '' ? null : t
}

/**
 * Pourquoi un push n'a pas été accepté, en un CODE : jamais le message d'Expo, qui peut
 * citer le jeton.
 */
export function motifDuRefus(reponse: unknown): string {
  const r = reponse as { ok?: unknown; skipped?: unknown; code?: unknown; status?: unknown; results?: unknown } | null
  if (!r || typeof r !== 'object') return 'no_response'
  if (r.skipped === 'notifications_disabled') return 'notifications_disabled'
  if (r.ok !== true) {
    if (typeof r.code === 'string') return r.code
    return typeof r.status === 'number' ? `http_${r.status}` : 'not_ok'
  }
  const ticket = Array.isArray(r.results) ? (r.results[0] as { status?: unknown; details?: { error?: unknown } } | undefined) : undefined
  if (!ticket) return 'no_ticket'
  return typeof ticket.details?.error === 'string' ? ticket.details.error : `ticket_${String(ticket.status)}`
}

/** Le cœur, sans réseau ni base : c'est lui que le banc éprouve. */
export async function notifierAvec(n: Notification, deps: Dependances): Promise<IssueNotification> {
  const issue: IssueNotification = { inbox_written: false, push_sent: false, push_attempted: false }
  const repere = { gym_id: n.gymId, member_id: n.memberId, type: n.type }

  // 1. Le push, si le membre a un jeton.
  try {
    const jeton = jetonUtilisable(n.pushToken === undefined ? await deps.lireJeton(n.memberId) : n.pushToken)
    if (jeton) {
      issue.push_attempted = true
      const reponse = await deps.envoyer({
        tokens: [jeton],
        gym_id: n.gymId,
        title: n.title,
        body: n.body,
        data: { ...(n.data ?? {}), type: n.pushType ?? n.type },
      })
      issue.push_sent = jetonsAcceptes([jeton], reponse).length === 1
      if (!issue.push_sent) deps.journal('push non accepté', { ...repere, motif: motifDuRefus(reponse) })
    }
  } catch (e) {
    deps.journal('push en erreur', { ...repere, erreur: (e as Error).name })
  }

  // 2. La ligne, que le push soit parti ou non.
  try {
    const erreur = await deps.ecrire({
      gym_id: n.gymId,
      member_id: n.memberId,
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data ?? null,
      push_sent: issue.push_sent,
      sent_at: deps.maintenant(),
    })
    if (erreur) deps.journal('ligne non écrite', { ...repere, erreur })
    else issue.inbox_written = true
  } catch (e) {
    deps.journal('ligne en erreur', { ...repere, erreur: (e as Error).name })
  }

  return issue
}

/** Délai laissé à `send-notification` : un webhook ne doit pas rester suspendu à un push. */
const DELAI_PUSH_MS = 10_000

/**
 * Écrit UNE ligne dans `public.notifications` ET envoie le push.
 * `admin` est un client service_role : la table n'a aucune règle INSERT pour les membres.
 */
export function notifier(admin: SupabaseClient, n: Notification): Promise<IssueNotification> {
  return notifierAvec(n, {
    async lireJeton(memberId) {
      const { data } = await admin.from('profiles').select('push_token').eq('id', memberId).maybeSingle()
      return (data?.push_token as string | null | undefined) ?? null
    },
    async envoyer(charge) {
      try {
        const resp = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            // GYM-282 — le tuyau exige le secret interne.
            [INTERNAL_SECRET_HEADER]: Deno.env.get(INTERNAL_SECRET_ENV) ?? '',
          },
          body: JSON.stringify(charge),
          signal: AbortSignal.timeout(DELAI_PUSH_MS),
        })
        return await resp.json().catch(() => null)
      } catch {
        return null
      }
    },
    async ecrire(ligne) {
      const { error } = await admin.from('notifications').insert(ligne)
      return error ? error.message : null
    },
    maintenant: () => new Date().toISOString(),
    journal: (message, detail) => console.error(`[notify] ${message}:`, JSON.stringify(detail)),
  })
}

// ─────────────────────────────────────────────────────────────────────────────────────
// LES TEXTES. Un seul endroit, pour que le push et la ligne disent la même chose, et pour
// que le banc vérifie qu'aucun ne porte de tiret long ni demi-cadratin (GYM-390).
// ─────────────────────────────────────────────────────────────────────────────────────

export interface Texte { title: string; body: string }

const seances = (n: number): string => (n === 1 ? '1 séance ajoutée' : `${n} séances ajoutées`)
const euros = (centimes: number): string => `${(centimes / 100).toFixed(2).replace('.', ',')} €`

export const textes = {
  /** Le membre a réservé lui-même (create-booking). */
  reservationConfirmee(p: { activite: string; jour: string; heure: string }): Texte {
    return { title: 'Réservation confirmée', body: `${p.activite}, ${p.jour} à ${p.heure}.` }
  },
  /** Le gérant a inscrit le membre (admin-book-member). */
  inscriptionParLaSalle(p: { activite: string; jour: string; heure: string }): Texte {
    return { title: 'Inscription confirmée', body: `${p.activite}, ${p.jour} à ${p.heure}. Inscrit par ta salle.` }
  },
  /** Une place s'est libérée pour un membre en liste d'attente (notify-waitlist). */
  placeDisponible(p: { activite: string; minutes: number }): Texte {
    return { title: 'Place disponible !', body: `${p.activite} : vous avez ${p.minutes} min pour confirmer.` }
  },
  /** La salle a annulé le cours (cancel-slot). */
  coursAnnule(p: { activite: string; jour: string; heure: string; creditRendu: boolean }): Texte {
    return {
      title: 'Cours annulé',
      body: `${p.activite} du ${p.jour} à ${p.heure} est annulé.${p.creditRendu ? " Ton crédit t'a été rendu." : ''}`,
    }
  },
  /** Abonnement ouvert. `centimesParMois` connu : premier prélèvement d'un abonnement mensuel. */
  abonnementActive(p: { plan: string; centimesParMois?: number | null }): Texte {
    return {
      title: 'Abonnement activé',
      body: typeof p.centimesParMois === 'number'
        ? `${p.plan}, ${euros(p.centimesParMois)}/mois.`
        : `${p.plan} : votre abonnement est actif.`,
    }
  },
  /** Premier échec de prélèvement d'un cycle. L'accès reste ouvert jusqu'à `avant`. */
  paiementEchoue(p: { plan: string; avant: string }): Texte {
    return {
      title: 'Prélèvement refusé',
      body: `Le prélèvement de ton abonnement ${p.plan} n'a pas abouti. Ton accès reste ouvert. Sans régularisation d'ici au ${p.avant}, il sera suspendu.`,
    }
  },
  /** Achat de crédits encaissé. */
  creditsAchetes(p: { plan: string; seances: number }): Texte {
    return { title: 'Paiement confirmé', body: `${p.plan} : ${seances(p.seances)}.` }
  },
}
