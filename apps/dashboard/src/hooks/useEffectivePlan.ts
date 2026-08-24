import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useGymStore } from '@/stores/useGymStore'

/**
 * GYM-245 — plan effectif de la salle : porte d'entrée UNIQUE du gating côté dashboard.
 *
 * nexxia_plan_limits = défauts du plan · nexxia_features = overrides par salle ·
 * get_effective_plan() résout les deux en un seul appel RPC. Aucun écran ne doit
 * réinterroger ces tables, et aucun ne doit écrire `if (plan === 'free')` : deux façons
 * de décider d'un droit finissent par diverger.
 *
 * ⚠️ Les noms de plans DIFFÈRENT entre environnements — staging sert
 * free/starter/pro/premium, la production free/starter/studio/pro. D'où la règle : on
 * teste un DRAPEAU (`features.export_enabled`), jamais un nom de plan.
 *
 * ⚠️ AUCUN composant ne l'utilise encore — la consommation, c'est GYM-247.
 *
 * Forme reprise de useGymLegal / useGymSettings : useState + useEffect sur
 * useGymStore, client `supabase` partagé. Le dossier hooks/ n'utilise pas react-query
 * (seuls main.tsx et useSupabase.ts en dépendent) — on ne l'introduit pas ici.
 */

/** Limites quantitatives. `null` = illimité (convention de la grille). */
export interface EffectivePlanLimits {
  max_members: number | null
  max_slots_per_month: number | null
  max_admins: number | null
  max_sites: number | null
}

/**
 * Drapeaux résolus. Les dix clés de la grille sont toujours présentes ; l'index
 * signature couvre les extras passthrough portés par la seule salle
 * (web_app, custom_branding, marketing_emails).
 */
export interface EffectivePlanFeatures {
  custom_domain: boolean
  payments_enabled: boolean
  notifications_enabled: boolean
  analytics_enabled: boolean
  multi_site_enabled: boolean
  ios_app_enabled: boolean
  android_app_enabled: boolean
  qr_checkin_enabled: boolean
  export_enabled: boolean
  api_access_enabled: boolean
  [feature: string]: boolean | undefined
}

export interface EffectivePlan {
  /** Plan contractuel (nexxia_gyms.plan). */
  plan: string
  /** Plan dont les limites sont SERVIES — diffère pendant un essai (GYM-250). */
  effectivePlan: string
  status: string
  trialActive: boolean
  limits: EffectivePlanLimits
  features: EffectivePlanFeatures
}

/** Forme brute du jsonb rendu par get_effective_plan (snake_case). */
interface EffectivePlanRow {
  plan: string
  effective_plan: string
  status: string
  trial_active: boolean
  limits: EffectivePlanLimits
  features: EffectivePlanFeatures
  commissions: { sepa_rate: number; cb_rate: number }
}

/**
 * Cache de session, par salle. Le plan ne change qu'à un changement d'abonnement ou à
 * une bascule de drapeau côté super-admin — pas pendant une session de gérant. Une
 * lecture par salle et par session suffit, et évite un aller-retour sur chaque écran
 * qui voudra gater un bouton.
 *
 * Porté au niveau module, et non dans un state React : plusieurs composants monteront
 * ce hook simultanément (GYM-247), et un cache par instance les ferait tous requêter.
 * `invalidateEffectivePlan()` est là pour la bascule manuelle d'un drapeau.
 */
const cache = new Map<string, EffectivePlan>()

export function invalidateEffectivePlan(gymId?: string): void {
  if (gymId) cache.delete(gymId)
  else cache.clear()
}

function toEffectivePlan(row: EffectivePlanRow): EffectivePlan {
  return {
    plan: row.plan,
    effectivePlan: row.effective_plan,
    status: row.status,
    trialActive: Boolean(row.trial_active),
    limits: row.limits,
    features: row.features ?? ({} as EffectivePlanFeatures),
  }
}

export function useEffectivePlan() {
  const gym = useGymStore((s) => s.gym)
  const gymId = gym?.id ?? null

  // L'état RETIENT la salle à laquelle il appartient. Sans ça, le rendu qui suit
  // immédiatement un changement de salle — avant que l'effet n'ait tourné — servirait
  // encore les drapeaux de la salle précédente. Sur un hook qui gate des boutons, une
  // seule frame de mauvais tenant est une frame de trop.
  const [state, setState] = useState<{ gymId: string | null; data: EffectivePlan | null }>(
    () => ({ gymId, data: gymId ? cache.get(gymId) ?? null : null }),
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Si l'état porte encore la salle précédente, on retombe sur le cache de la salle
  // COURANTE (souvent déjà chaud), jamais sur la valeur périmée.
  const data = state.gymId === gymId
    ? state.data
    : (gymId ? cache.get(gymId) ?? null : null)

  const setData = useCallback(
    (next: EffectivePlan | null) => setState({ gymId, data: next }),
    [gymId],
  )

  const load = useCallback(async (force = false) => {
    if (!gymId) { setData(null); return }

    if (!force) {
      const hit = cache.get(gymId)
      if (hit) { setData(hit); setError(null); return }
    }

    setIsLoading(true)
    // get_effective_plan n'est pas encore dans les types générés (la migration n'est pas
    // appliquée) : le cast tombera à la prochaine régénération de types/database.ts.
    // 🔴 LE CAST PORTE SUR LE CLIENT, PAS SUR LA MÉTHODE (correctif GYM-265).
    // `(supabase.rpc as …)('get_effective_plan', …)` DÉTACHAIT la méthode de son receveur :
    // `rpc` est une méthode de prototype dont le corps fait `this.rest`, et l'appel levait
    // « Cannot read properties of undefined (reading 'rest') ». Rien ne rattrapait ici :
    // l'exception remontait hors de `load()`, `get_effective_plan` n'était donc JAMAIS
    // résolu, et le gating restait indéfiniment sur « on ne sait pas ». Casté sur le
    // client, le receveur reste lié par construction.
    const { data: row, error: rpcError } = await (supabase as unknown as {
      rpc: (
        fn: string, args: Record<string, unknown>,
      ) => Promise<{ data: EffectivePlanRow | null; error: { message: string } | null }>
    }).rpc('get_effective_plan', { p_gym_id: gymId })
    setIsLoading(false)

    if (rpcError || !row) {
      // ⚠️ On NE retombe PAS sur un plan gratuit : une panne de résolution n'est pas une
      // rétrogradation. Les écrans qui gatent doivent traiter `plan === null` comme
      // « on ne sait pas », pas comme « aucun droit ».
      setError(rpcError?.message ?? 'no_payload')
      setData(null)
      return
    }

    const resolved = toEffectivePlan(row)
    cache.set(gymId, resolved)
    setError(null)
    setData(resolved)
  }, [gymId, setData])

  // Rejoue à chaque changement de salle : le cache est indexé par gymId, donc changer
  // de salle sert l'entrée de la nouvelle, jamais celle de l'ancienne.
  useEffect(() => { load() }, [load])

  return {
    plan: data?.plan ?? null,
    effectivePlan: data?.effectivePlan ?? null,
    status: data?.status ?? null,
    trialActive: data?.trialActive ?? false,
    limits: data?.limits ?? null,
    features: data?.features ?? null,
    isLoading,
    error,
    /** Force une relecture (bascule d'un drapeau, changement de plan). */
    reload: useCallback(() => load(true), [load]),
  }
}
