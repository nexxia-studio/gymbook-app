import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/useAuthStore'
import { useTheme } from '../lib/theme/ThemeProvider'
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
  // 🔴 GYM-293b — LA MARQUE, PARCE QU'ELLE EST LÀ AVANT LA CONNEXION. Les CGV sont ouvertes
  // depuis l'écran d'INSCRIPTION : `gym_id` y est nul, et la lecture ci-dessous ne part
  // jamais. Le contrat s'affichait donc avec l'identité de repli — c'est-à-dire, avant ce
  // lot, celle de Dopamine, chez n'importe quelle salle.
  const { brand } = useTheme()
  const slug = brand?.slug ?? null
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

    // ⚠️ MISE À JOUR FONCTIONNELLE, ET C'EST NÉCESSAIRE DEPUIS GYM-293b. Deux chargements
    // indépendants alimentent maintenant le même état — l'opérationnel et l'identité. Un
    // `setParams({...})` littéral écraserait ce que l'autre vient d'écrire, et le gagnant
    // dépendrait de l'ordre d'arrivée des réponses : le nom du Club disparaîtrait une fois
    // sur deux, sans qu'on puisse le reproduire.
    setParams((prev) => ({
      ...prev,
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
    }))
  }, [gymId])

  /**
   * 🔴 GYM-293b — L'IDENTITÉ DU VENDEUR, LUE SUR LA SALLE DE CONTEXTE.
   *
   * ⚠️ `public_gym_legal_identity` ET PAS UNE LECTURE DE TABLE. C'est la fonction de
   * GYM-265, ouverte à `anon` précisément pour ce cas : afficher l'identité légale d'une
   * salle à quelqu'un qui n'en est pas encore membre. Une lecture directe de `nexxia_gyms`
   * serait refusée par la RLS sur l'écran d'inscription — là où le besoin existe.
   *
   * ⚠️ ET ELLE NE PART PAS EN SINGLE. `brand` y vaut `null` par construction : l'app de
   * Dopamine n'émet donc AUCUNE requête de plus qu'avant, et son article 1 continue de
   * venir du repli `CLUB_IDENTITY` — les deux textes rendus sont identiques à l'octet.
   */
  const loadIdentity = useCallback(async () => {
    if (!slug) return
    try {
      const { data, error } = await (supabase as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: unknown }>
      }).rpc('public_gym_legal_identity', { p_slug: slug })
      if (error) return
      const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined
      if (!row) return
      // ⚠️ LE NOM COMMERCIAL D'ABORD. C'est celui sous lequel la salle se présente à ses
      // membres ; `name` est le libellé interne. La dénomination LÉGALE, elle, n'a rien à
      // faire ici : l'article renvoie déjà à l'écran d'informations du Club pour cela.
      const nom = (row.commercial_name ?? row.name) as string | null
      const ville = (row.legal_city ?? row.city) as string | null
      setParams((prev) => ({
        ...prev,
        clubName: nom?.trim() || prev.clubName,
        clubCommune: ville?.trim() || prev.clubCommune,
      }))
    } catch {
      // Un membre doit TOUJOURS pouvoir lire ses CGV : un échec laisse le repli en place,
      // qui ne nomme personne plutôt que de nommer le mauvais vendeur.
    }
  }, [slug])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadIdentity() }, [loadIdentity])

  return params
}
