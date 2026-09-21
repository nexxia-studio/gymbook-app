import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useGymStore } from '@/stores/useGymStore'

/**
 * GYM-250 — où en est l'essai de MA salle, et depuis/pendant combien de jours.
 *
 * ⚠️ POURQUOI PAS `useEffectivePlan`. Il rend `trial_active`, pas la DATE — et après le
 * terme il rend `false`, c'est-à-dire exactement le moment où le gérant a le plus besoin
 * d'être renseigné. Il faut donc la date, et elle vit sur `nexxia_gyms`.
 *
 * ⚠️ LECTURE DIRECTE, ET C'EST LÉGITIME ICI. Contrairement au cockpit — où une lecture
 * directe aurait SERVI un gérant au lieu de le refuser — un gérant qui lit `trial_ends_at`
 * de SA salle est dans son droit : c'est son contrat. La politique RLS « gym_admin voit sa
 * salle » couvre exactement ce besoin, et aucune RPC n'ajouterait de garde.
 *
 * ⚠️ `null` = ON NE SAIT PAS, jamais « pas d'essai ». Même contrat que `useEffectivePlan`
 * (GYM-246) : une panne de lecture ne doit pas se lire comme une salle sans essai, sinon
 * le bandeau disparaîtrait au pire moment.
 */
export type TrialPhase =
  /** Essai en cours, terme dans plus de 3 jours : rien à annoncer. */
  | { phase: 'running_quiet'; endsAt: string; daysLeft: number }
  /** Essai en cours, terme dans 3 jours ou moins. */
  | { phase: 'ending_soon'; endsAt: string; daysLeft: number }
  /** Terme atteint ou dépassé. */
  | { phase: 'ended'; endsAt: string; daysLeft: number }
  /** La salle n'a pas d'essai (et n'en a jamais eu, ou il a été clos explicitement). */
  | { phase: 'none' }

/**
 * Jours civils qui séparent aujourd'hui du terme.
 *
 * ⚠️ DATES LOCALES, PAS UNE DIVISION PAR 86 400 000. C'est le même piège qu'au § 4 de la
 * migration : « dans 3 jours » est une distance de CALENDRIER. La nuit du changement
 * d'heure, une soustraction de millisecondes dérive d'une heure — assez pour faire changer
 * de jour un compte calculé près de minuit, et pour que le bandeau et l'email du même
 * matin annoncent deux chiffres différents.
 */
function joursCivils(endsAt: string): number {
  const fin = new Date(endsAt)
  const a = new Date(fin.getFullYear(), fin.getMonth(), fin.getDate())
  const n = new Date()
  const b = new Date(n.getFullYear(), n.getMonth(), n.getDate())
  return Math.round((a.getTime() - b.getTime()) / 86_400_000)
}

export function useTrialStatus() {
  const gymId = useGymStore((s) => s.gym?.id)
  const [trial, setTrial] = useState<TrialPhase | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(async () => {
    if (!gymId) { setTrial(null); setIsLoading(false); return }
    setIsLoading(true)
    const { data, error } = await supabase
      .from('nexxia_gyms')
      .select('trial_ends_at')
      .eq('id', gymId)
      .maybeSingle()
    setIsLoading(false)

    if (error || !data) {
      // Le détail va dans la console, pas à l'écran. `null` = on ne sait pas.
      if (error) console.error('[trial] lecture de trial_ends_at :', error)
      setTrial(null)
      return
    }

    const endsAt = data.trial_ends_at
    if (!endsAt) { setTrial({ phase: 'none' }); return }

    const daysLeft = joursCivils(endsAt)
    // ⚠️ « TERMINÉ » SE JUGE SUR L'INSTANT, PAS SUR LE JOUR — et c'est le même critère que
    // le résolveur en base (`trial_ends_at > now()`). Un essai qui expire à 13 h 33 est
    // terminé à 15 h, alors que le compte en jours civils vaut encore 0 : afficher
    // « il reste 0 jour » à un gérant qui ne peut déjà plus vendre serait un mensonge, et
    // surtout un DÉSACCORD avec le serveur, qui est le seul à décider.
    if (new Date(endsAt).getTime() <= Date.now()) setTrial({ phase: 'ended', endsAt, daysLeft })
    else if (daysLeft <= 3) setTrial({ phase: 'ending_soon', endsAt, daysLeft })
    else setTrial({ phase: 'running_quiet', endsAt, daysLeft })
  }, [gymId])

  useEffect(() => { void load() }, [load])

  return { trial, isLoading, reload: load }
}
