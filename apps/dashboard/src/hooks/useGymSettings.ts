import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database'
import { useGymStore } from '@/stores/useGymStore'
import { parseOpeningHours, type OpeningHours } from '@/lib/openingHours'

export interface GymSettings {
  waitlistConfirmationMinutes: number
  /** GYM-196 — null = aucune limite de réservations simultanées. */
  maxActiveBookings: number | null
  /**
   * GYM-228 — horaires d'ouverture, en heure LOCALE de la salle.
   *
   * `null` = JAMAIS RENSEIGNÉS, ce qui n'est pas « fermé tous les jours » : l'écran de
   * réglages propose alors une suggestion à valider, et la génération Open Gym refuse de
   * tourner. Un horaire deviné produirait des centaines de créneaux à des heures que
   * personne n'a choisies.
   */
  openingHours: OpeningHours | null
}

export function useGymSettings() {
  const gym = useGymStore((s) => s.gym)
  const [settings, setSettings] = useState<GymSettings | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const load = useCallback(async () => {
    if (!gym?.id) return
    setIsLoading(true)
    const { data, error } = await supabase
      .from('nexxia_gyms')
      .select('waitlist_confirmation_minutes, max_active_bookings, opening_hours')
      .eq('id', gym.id)
      .single()
    setIsLoading(false)
    if (error || !data) return
    setSettings({
      waitlistConfirmationMinutes: data.waitlist_confirmation_minutes ?? 30,
      // NULL est une VALEUR (« aucune limite »), jamais un défaut à remplacer.
      maxActiveBookings: data.max_active_bookings ?? null,
      openingHours: parseOpeningHours(data.opening_hours),
    })
  }, [gym?.id])

  useEffect(() => { load() }, [load])

  /**
   * GYM-228 — enregistrement des horaires.
   *
   * Écriture RLS directe comme les deux réglages voisins ; la migration de ce lot ajoute
   * le GRANT UPDATE sur la colonne (liste blanche GYM-180 — sans lui, PostgREST rejette
   * la requête entière).
   */
  const updateOpeningHours = useCallback(async (hours: OpeningHours): Promise<{ error?: string }> => {
    if (!gym?.id) return { error: 'no_gym' }
    const { error } = await supabase
      .from('nexxia_gyms')
      // Le type généré attend `Json` ; OpeningHours en est une forme valide mais
      // TypeScript ne peut pas le déduire (pas d'index signature). Cast explicite,
      // la CONTRAINTE de forme étant posée en base (CHECK sur les clés de jour).
      .update({ opening_hours: hours as unknown as Json })
      .eq('id', gym.id)
    if (error) return { error: error.message }
    setSettings((s) => (s ? { ...s, openingHours: hours } : s))
    return {}
  }, [gym?.id])

  const updateWaitlistDelay = useCallback(async (minutes: number): Promise<{ error?: string }> => {
    if (!gym?.id) return { error: 'no_gym' }
    if (minutes < 10 || minutes > 120) return { error: 'range' }
    const { error } = await supabase
      .from('nexxia_gyms')
      .update({ waitlist_confirmation_minutes: minutes })
      .eq('id', gym.id)
    if (error) return { error: error.message }
    setSettings((s) => (s ? { ...s, waitlistConfirmationMinutes: minutes } : s))
    return {}
  }, [gym?.id])

  /**
   * GYM-196 — limite de réservations simultanées. `null` = aucune limite (champ vidé).
   * Écriture via update RLS direct, comme le délai waitlist ; la migration GYM-196 ajoute
   * le GRANT UPDATE sur la colonne (liste blanche GYM-180).
   */
  const updateMaxActiveBookings = useCallback(
    async (max: number | null): Promise<{ error?: string }> => {
      if (!gym?.id) return { error: 'no_gym' }
      if (max !== null && (!Number.isInteger(max) || max < 1)) return { error: 'range' }

      const { data, error } = await supabase
        .from('nexxia_gyms')
        .update({ max_active_bookings: max })
        .eq('id', gym.id)
        .select('id')

      if (error) return { error: error.message }
      // Un UPDATE bloqué par RLS ne lève PAS d'erreur : il porte sur 0 ligne (GYM-180).
      if (!data || data.length === 0) return { error: 'forbidden' }
      setSettings((s) => (s ? { ...s, maxActiveBookings: max } : s))
      return {}
    },
    [gym?.id],
  )

  return { settings, isLoading, updateOpeningHours, updateWaitlistDelay, updateMaxActiveBookings }
}
