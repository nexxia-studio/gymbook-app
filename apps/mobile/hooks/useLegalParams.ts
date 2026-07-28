import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/useAuthStore'
import { DEFAULT_LEGAL_PARAMS, type LegalParams } from '../constants/legal/params'

/**
 * GYM-197 — charge les paramètres opérationnels de la salle pour le rendu des CGU.
 *
 * Deux lectures, sur un écran consulté rarement : nexxia_gyms (limite de réservations,
 * délai de confirmation waitlist) et noshow_rules (barème d'absences). Les deux sont
 * lisibles par un membre grâce aux policies existantes — « Members voient leur salle »
 * et « Règles no-show visibles par les membres » (SELECT, gym_id = get_my_gym_id()).
 *
 * COMPORTEMENT SÛR PAR DÉFAUT : tout échec (réseau, RLS, absence de ligne) laisse les
 * valeurs de repli en place. Un membre doit TOUJOURS pouvoir lire ses CGU — mieux vaut
 * des valeurs par défaut plausibles qu'un document vide ou un écran d'erreur.
 *
 * ⚠️ `maxActiveBookings` est le SEUL champ dont NULL est une valeur signifiante
 * (« aucune limite ») : il n'est donc jamais remplacé par le repli, contrairement aux
 * autres où NULL signifie « colonne non renseignée ».
 */
export function useLegalParams() {
  const gymId = useAuthStore((s) => s.gym_id)
  const [params, setParams] = useState<LegalParams>(DEFAULT_LEGAL_PARAMS)

  const load = useCallback(async () => {
    if (!gymId) return

    const [gymRes, rulesRes] = await Promise.all([
      supabase
        .from('nexxia_gyms')
        .select('max_active_bookings, waitlist_confirmation_minutes')
        .eq('id', gymId)
        .maybeSingle(),
      supabase
        .from('noshow_rules')
        .select('warning_1_at, warning_2_at, suspension_at, suspension_hours, escalated_suspension_hours, reset_after_days')
        .eq('gym_id', gymId)
        .maybeSingle(),
    ])

    const gym = gymRes.error ? null : gymRes.data
    const rules = rulesRes.error ? null : rulesRes.data

    setParams({
      // NULL conservé tel quel : « aucune limite » est une valeur, pas une absence.
      maxActiveBookings: gym
        ? (gym.max_active_bookings as number | null)
        : DEFAULT_LEGAL_PARAMS.maxActiveBookings,
      waitlistConfirmationMinutes:
        gym?.waitlist_confirmation_minutes ?? DEFAULT_LEGAL_PARAMS.waitlistConfirmationMinutes,
      warning1At: rules?.warning_1_at ?? DEFAULT_LEGAL_PARAMS.warning1At,
      warning2At: rules?.warning_2_at ?? DEFAULT_LEGAL_PARAMS.warning2At,
      suspensionAt: rules?.suspension_at ?? DEFAULT_LEGAL_PARAMS.suspensionAt,
      suspensionHours: rules?.suspension_hours ?? DEFAULT_LEGAL_PARAMS.suspensionHours,
      escalatedSuspensionHours:
        rules?.escalated_suspension_hours ?? DEFAULT_LEGAL_PARAMS.escalatedSuspensionHours,
      resetAfterDays: rules?.reset_after_days ?? DEFAULT_LEGAL_PARAMS.resetAfterDays,
    })
  }, [gymId])

  useEffect(() => { load() }, [load])

  return params
}
