import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useGymStore } from '@/stores/useGymStore'

/**
 * GYM-175 — politique d'absences de la salle (table noshow_rules).
 *
 * ⚠️ AUTRE TABLE que nexxia_gyms : le flux /settings existant (GYM-180) écrit nexxia_gyms
 * et ne convient pas ici. D'où ce hook dédié.
 *
 * ⚠️ UPSERT obligatoire : une salle peut ne PAS avoir de ligne noshow_rules (seule
 * Dopamine en a une). Le formulaire doit la CRÉER, pas échouer. La contrainte
 * UNIQUE(gym_id) rend l'upsert sûr — pas de doublon possible.
 *
 * RLS : policy ALL « Gym admins gèrent les règles no-show » = (gym_id = get_my_gym_id())
 * AND is_gym_admin(), sans WITH CHECK distinct → la même expression contrôle l'INSERT.
 * Les GRANTs de table sont complets pour authenticated (pas de liste blanche de colonnes
 * comme sur nexxia_gyms) : rien à ajouter côté droits.
 */
export interface NoshowRules {
  /** Nombre d'absences à partir duquel une suspension est appliquée. */
  suspensionAt: number
  /** Durée de la suspension au premier palier, en heures. */
  suspensionHours: number
  /** Durée de la suspension aggravée (paliers suivants), en heures. */
  escalatedSuspensionHours: number
  /** Jours sans nouvelle absence au bout desquels le compteur repart à zéro. */
  resetAfterDays: number
}

/** Valeurs de repli = comportement historique appliqué par mark_attendance_atomic. */
export const DEFAULT_NOSHOW_RULES: NoshowRules = {
  suspensionAt: 2,
  suspensionHours: 48,
  escalatedSuspensionHours: 336,
  resetAfterDays: 90,
}

export function useNoshowRules() {
  const gym = useGymStore((s) => s.gym)
  const [rules, setRules] = useState<NoshowRules | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const load = useCallback(async () => {
    if (!gym?.id) return
    setIsLoading(true)
    const { data, error } = await supabase
      .from('noshow_rules')
      .select('suspension_at, suspension_hours, escalated_suspension_hours, reset_after_days')
      .eq('gym_id', gym.id)
      .maybeSingle()
    setIsLoading(false)
    if (error) return
    // Aucune ligne → on présente les valeurs de repli, celles que le serveur applique
    // réellement en leur absence. Le gérant voit donc la politique en vigueur, pas un
    // formulaire vide, et le premier enregistrement créera la ligne.
    if (!data) {
      setRules(DEFAULT_NOSHOW_RULES)
      return
    }
    setRules({
      suspensionAt: data.suspension_at ?? DEFAULT_NOSHOW_RULES.suspensionAt,
      suspensionHours: data.suspension_hours ?? DEFAULT_NOSHOW_RULES.suspensionHours,
      escalatedSuspensionHours:
        data.escalated_suspension_hours ?? DEFAULT_NOSHOW_RULES.escalatedSuspensionHours,
      resetAfterDays: data.reset_after_days ?? DEFAULT_NOSHOW_RULES.resetAfterDays,
    })
  }, [gym?.id])

  useEffect(() => { load() }, [load])

  const save = useCallback(async (next: NoshowRules): Promise<{ error?: string }> => {
    if (!gym?.id) return { error: 'no_gym' }

    // Cohérence métier : durées strictement positives, seuil d'au moins 1 absence,
    // suspension aggravée jamais plus courte que la suspension simple (sinon la
    // « aggravation » adoucirait la sanction).
    if (!Number.isInteger(next.suspensionAt) || next.suspensionAt < 1) return { error: 'suspension_at' }
    if (!Number.isInteger(next.suspensionHours) || next.suspensionHours < 1) return { error: 'suspension_hours' }
    if (!Number.isInteger(next.escalatedSuspensionHours) || next.escalatedSuspensionHours < 1) {
      return { error: 'escalated_hours' }
    }
    if (next.escalatedSuspensionHours < next.suspensionHours) return { error: 'escalated_lower' }
    if (!Number.isInteger(next.resetAfterDays) || next.resetAfterDays < 1) return { error: 'reset_days' }

    const { data, error } = await supabase
      .from('noshow_rules')
      .upsert({
        gym_id: gym.id,
        suspension_at: next.suspensionAt,
        suspension_hours: next.suspensionHours,
        escalated_suspension_hours: next.escalatedSuspensionHours,
        reset_after_days: next.resetAfterDays,
      }, { onConflict: 'gym_id' })
      .select('gym_id')

    if (error) return { error: error.message }
    // Un écrit bloqué par RLS ne lève pas d'erreur : il porte sur 0 ligne (leçon GYM-180).
    if (!data || data.length === 0) return { error: 'forbidden' }
    setRules(next)
    return {}
  }, [gym?.id])

  return { rules, isLoading, save, reload: load }
}
