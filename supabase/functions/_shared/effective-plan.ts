import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * GYM-245 — porte d'entrée UNIQUE du gating côté Edge Functions.
 *
 * nexxia_plan_limits = défauts du plan · nexxia_features = overrides par salle ·
 * get_effective_plan() résout les deux en un seul appel. Aucun appelant ne doit
 * réinterroger ces tables, et aucun ne doit écrire `if (plan === 'free')` : deux façons
 * de décider d'un droit finissent par diverger.
 *
 * ⚠️ Les noms de plans DIFFÈRENT entre les environnements — staging sert
 * free/starter/pro/premium, la production free/starter/studio/pro. C'est exactement
 * pourquoi rien ici ne raisonne sur un nom de plan : on lit les drapeaux résolus.
 *
 * ⚠️ NON UTILISÉ pour l'instant. Le branchement des fonctions existantes (create-payment,
 * create-subscription… qui lisent encore nexxia_plan_limits en direct) est GYM-246.
 *
 * ACCÈS : la fonction SQL exige service_role OU un profil rattaché à la salle. Passer
 * ici le client SERVICE ROLE ; avec un client porteur du JWT d'un membre d'une autre
 * salle, l'appel lève (42501) — c'est voulu.
 */

/** Limites quantitatives. `null` = illimité (convention de la grille). */
export interface EffectivePlanLimits {
  max_members: number | null
  max_slots_per_month: number | null
  max_admins: number | null
  max_sites: number | null
}

/**
 * Drapeaux résolus. Les dix clés de la grille sont TOUJOURS présentes.
 * L'index signature couvre les extras passthrough portés par la seule salle
 * (web_app, custom_branding, marketing_emails) — d'où le `| undefined` à la lecture.
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

/**
 * Taux effectifs, overrides de la salle DÉJÀ appliqués
 * (nexxia_gyms.commission_*_rate_override prime sur le taux du plan ; 0 est un override
 * valide). Même ordre de résolution que _shared/commission.ts.
 */
export interface EffectivePlanCommissions {
  sepa_rate: number
  cb_rate: number
}

export interface EffectivePlan {
  /** Plan contractuel de la salle (nexxia_gyms.plan). */
  plan: string
  /** Plan dont les limites sont SERVIES — diffère de `plan` pendant un essai (GYM-250). */
  effective_plan: string
  status: string
  trial_active: boolean
  limits: EffectivePlanLimits
  features: EffectivePlanFeatures
  commissions: EffectivePlanCommissions
}

/**
 * Résout le plan effectif d'une salle. Retourne `null` si l'appel échoue — salle
 * introuvable/supprimée, plan absent de la grille, ou accès refusé.
 *
 * ⚠️ `null` ne veut pas dire « aucun droit » : c'est une panne de résolution. L'appelant
 * doit la traiter comme une erreur (refus explicite, 5xx), JAMAIS la confondre avec un
 * plan gratuit — sinon une panne de base se lirait comme une rétrogradation silencieuse.
 */
export async function getEffectivePlan(
  admin: SupabaseClient,
  gymId: string,
): Promise<EffectivePlan | null> {
  const { data, error } = await admin.rpc('get_effective_plan', { p_gym_id: gymId })

  if (error) {
    console.error('[effective-plan] rpc error:', error)
    return null
  }
  if (!data) {
    console.error('[effective-plan] rpc returned no payload for gym:', gymId)
    return null
  }

  return data as unknown as EffectivePlan
}

/**
 * Raccourci de lecture d'un drapeau. Un drapeau absent vaut `false` : un droit ne
 * s'accorde jamais par omission.
 */
export function hasFeature(plan: EffectivePlan | null, feature: string): boolean {
  return plan?.features?.[feature] === true
}
