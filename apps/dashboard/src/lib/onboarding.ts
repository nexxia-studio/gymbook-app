// GYM-248 — Persistance de la progression du wizard d'onboarding.
//
// ⚠️ LE POINT DUR DE CE LOT, à lire avant de toucher quoi que ce soit ici.
//
// `nexxia_gyms.onboarding_step` et `onboarding_completed` ne sont PAS écrivables depuis le
// client. La liste blanche de colonnes GYM-180 les exclut EXPLICITEMENT — son commentaire
// est sans ambiguïté (migration 20260727103000, §b) :
//
//     « Les champs commerciaux et techniques (plan, status, trial_*, commission_*_override,
//       mollie_*, id, slug, subdomain, onboarding_*, deleted_at) restent hors de sa portée »
//
// Une policy RLS ne filtre pas par colonne : c'est le GRANT qui tranche, et PostgREST
// rejette la requête ENTIÈRE dès qu'elle mentionne une colonne hors liste — même à valeur
// inchangée. Un UPDATE direct ne renverra donc pas « 0 ligne », il renverra une ERREUR.
//
// Ce lot n'a pas le droit de déployer une migration (périmètre du morceau 2). Le RPC qui
// manque est PROPOSÉ dans la description de PR, pas appliqué. En attendant :
//
//   · la progression est tenue LOCALEMENT (localStorage, par salle) et le wizard est
//     pleinement utilisable — c'est ce que le cockpit valide visuellement ;
//   · chaque étape TENTE quand même l'écriture serveur. Le jour où le RPC existe, la
//     persistance devient effective SANS toucher une ligne de ce fichier ;
//   · l'absence du RPC est reconnue précisément (PGRST202 / 404) et traitée comme
//     « persistance pas encore disponible ». TOUTE AUTRE erreur est remontée à l'appelant :
//     confondre les deux masquerait une vraie panne derrière un repli silencieux.
import { supabase } from '@/lib/supabase'

/**
 * RPC de progression. APPLIQUÉ en staging par le cockpit (migration
 * 20260823120000_gym248_onboarding_step_6.sql, versionnée dans le dépôt).
 * Le repli local ci-dessous reste en place : il couvre un environnement où la migration
 * n'aurait pas encore été appliquée, prod comprise.
 */
const RPC_NAME = 'set_gym_onboarding_progress'

const storageKey = (gymId: string) => `viniz.onboarding.${gymId}`
const welcomeKey = (gymId: string) => `viniz.welcome.${gymId}`

/**
 * GYM-248 — l'écran de bienvenue ne se voit QU'UNE FOIS, par salle et par navigateur.
 * Purement cosmétique : s'il réapparaît (mode privé, autre poste), personne n'est bloqué —
 * c'est pourquoi il n'a pas besoin d'aller en base, contrairement à la progression.
 */
export function hasSeenWelcome(gymId: string): boolean {
  try {
    return window.localStorage.getItem(welcomeKey(gymId)) === '1'
  } catch {
    // Stockage indisponible : on considère l'écran comme déjà vu plutôt que de le
    // réafficher à chaque rendu, ce qui serait bien plus pénible que de le manquer.
    return true
  }
}

export function markWelcomeSeen(gymId: string): void {
  try {
    window.localStorage.setItem(welcomeKey(gymId), '1')
  } catch { /* cf. hasSeenWelcome */ }
}

export interface OnboardingProgress {
  step: number
  completed: boolean
}

/**
 * Bornes du CHECK en base (nexxia_gyms_onboarding_step_check : 1 ≤ step ≤ 6).
 *
 * ⚠️ Trois endroits doivent rester d'accord — la colonne (CHECK), le RPC
 * set_gym_onboarding_progress (bornes 1..6) et cette constante. Migration de référence :
 * supabase/migrations/20260823120000_gym248_onboarding_step_6.sql.
 */
export const ONBOARDING_FIRST_STEP = 1
export const ONBOARDING_LAST_STEP = 6

export function clampStep(step: number): number {
  if (!Number.isFinite(step)) return ONBOARDING_FIRST_STEP
  return Math.min(ONBOARDING_LAST_STEP, Math.max(ONBOARDING_FIRST_STEP, Math.trunc(step)))
}

/** Lecture locale — repli quand le serveur ne peut pas encore mémoriser la progression. */
export function readLocalProgress(gymId: string): OnboardingProgress | null {
  try {
    const raw = window.localStorage.getItem(storageKey(gymId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<OnboardingProgress>
    if (typeof parsed.step !== 'number') return null
    return { step: clampStep(parsed.step), completed: parsed.completed === true }
  } catch {
    // Mode privé, quota plein, JSON corrompu : la progression locale est un CONFORT,
    // jamais une source de vérité. On repart du serveur.
    return null
  }
}

function writeLocalProgress(gymId: string, progress: OnboardingProgress): void {
  try {
    window.localStorage.setItem(storageKey(gymId), JSON.stringify(progress))
  } catch { /* cf. readLocalProgress */ }
}

/** Le RPC n'existe pas encore en base — à distinguer d'une vraie panne. */
function isMissingRpc(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false
  // PGRST202 = « function not found in schema cache » ; 42883 = undefined_function.
  if (error.code === 'PGRST202' || error.code === '42883') return true
  const msg = (error.message ?? '').toLowerCase()
  return msg.includes('could not find the function') || msg.includes('does not exist')
}

export type SaveOutcome =
  /** Écrit en base. */
  | 'persisted'
  /** RPC absent : progression tenue localement (état attendu tant que la PR n'est pas suivie). */
  | 'local-only'
  /** Panne réelle — l'appelant doit le dire à l'utilisateur. */
  | 'failed'

/**
 * Enregistre la progression. Écrit TOUJOURS le repli local d'abord : même si le serveur
 * refuse, l'utilisateur ne doit pas voir sa progression retomber à l'étape 1 au prochain
 * rendu.
 */
export async function saveOnboardingProgress(
  gymId: string,
  progress: OnboardingProgress,
): Promise<SaveOutcome> {
  const safe: OnboardingProgress = { step: clampStep(progress.step), completed: progress.completed }
  writeLocalProgress(gymId, safe)

  // ⚠️ Le cast est DÉLIBÉRÉ et documente un fait : ce RPC n'existe pas encore en base, il
  // est donc absent des types générés (types/database.ts). L'ajouter à la main aux types
  // serait un mensonge — ils décrivent le schéma RÉEL. Le jour où la migration proposée en
  // PR est appliquée, `supabase gen types` l'ajoutera et ce cast pourra sauter.
  // 🔴 LE CAST PORTE SUR LE CLIENT, PAS SUR LA MÉTHODE (correctif GYM-265).
  // `const rpc = supabase.rpc as …` DÉTACHAIT la méthode de son receveur : `rpc` est une
  // méthode de prototype dont le corps fait `this.rest`, et l'appel levait
  // « Cannot read properties of undefined (reading 'rest') ». Ici l'exception n'était même
  // pas rattrapée : elle remontait hors de `saveProgress`, et le repli 'local-only' prévu
  // par `isMissingRpc` juste en dessous était donc INATTEIGNABLE — le cas exact que ce
  // code est écrit pour gérer. Casté sur le client, le receveur reste lié par construction.
  const { error } = await (supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { code?: string | null; message?: string | null } | null }>
  }).rpc(RPC_NAME, {
    p_gym_id: gymId,
    p_step: safe.step,
    p_completed: safe.completed,
  })

  if (!error) return 'persisted'
  if (isMissingRpc(error)) return 'local-only'
  console.error('[onboarding] progress save failed:', error)
  return 'failed'
}
