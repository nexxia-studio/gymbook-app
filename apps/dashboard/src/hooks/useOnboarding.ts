// GYM-248 — État du wizard d'onboarding.
//
// Source de vérité : `nexxia_gyms.onboarding_step` / `onboarding_completed`, LUS en base
// (la lecture, elle, n'a jamais posé de problème de GRANT). L'écriture passe par
// lib/onboarding.ts — cf. son en-tête pour la limite assumée sur la liste blanche GYM-180.
//
// Forme reprise de useGymSettings / useGymLegal : useState + useEffect sur useGymStore,
// client `supabase` partagé. Le dossier hooks/ n'utilise pas react-query, on ne l'introduit
// pas ici.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useGymStore } from '@/stores/useGymStore'
import {
  clampStep,
  readLocalProgress,
  saveOnboardingProgress,
  ONBOARDING_FIRST_STEP,
  ONBOARDING_LAST_STEP,
  type SaveOutcome,
} from '@/lib/onboarding'

export interface OnboardingState {
  /** null tant que la salle n'est pas chargée ou la lecture pas terminée. */
  step: number | null
  completed: boolean | null
  /** Le wizard doit-il s'afficher ? (salle chargée, onboarding non terminé, non masqué) */
  isOpen: boolean
  /** Ferme pour CETTE session sans perdre l'étape — le « plus tard » des écrans. */
  dismiss: () => void
  goToStep: (step: number) => Promise<SaveOutcome>
  /** Avance d'une étape, ou termine si on était à la dernière. */
  advance: () => Promise<SaveOutcome>
  complete: () => Promise<SaveOutcome>
}

export function useOnboarding(): OnboardingState {
  const gym = useGymStore((s) => s.gym)
  const gymId = gym?.id ?? null

  const [step, setStep] = useState<number | null>(null)
  const [completed, setCompleted] = useState<boolean | null>(null)
  // Fermeture « plus tard » MÉMORISÉE PAR SALLE plutôt que par un booléen remis à zéro
  // dans un effet : changer de salle (impersonation super_admin, reconnexion) rouvre alors
  // le wizard sans aucun rendu en cascade, parce qu'il n'y a rien à réinitialiser.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!gymId) return
    const { data, error } = await supabase
      .from('nexxia_gyms')
      .select('onboarding_step, onboarding_completed')
      .eq('id', gymId)
      .single()
    if (error || !data) return

    const serverCompleted = data.onboarding_completed === true
    const serverStep = clampStep(data.onboarding_step ?? ONBOARDING_FIRST_STEP)

    // Le repli local ne PRIME que s'il est en AVANCE sur le serveur : tant que l'écriture
    // serveur n'est pas possible, c'est lui qui porte la progression réelle. Un serveur
    // déjà marqué terminé l'emporte toujours — on ne rouvre pas un wizard clos.
    const local = readLocalProgress(gymId)
    if (serverCompleted) {
      setCompleted(true)
      setStep(serverStep)
      return
    }
    if (local && (local.completed || local.step > serverStep)) {
      setCompleted(local.completed)
      setStep(local.step)
      return
    }
    setCompleted(false)
    setStep(serverStep)
  }, [gymId])

  useEffect(() => { void load() }, [load])

  const persist = useCallback(async (nextStep: number, nextCompleted: boolean): Promise<SaveOutcome> => {
    if (!gymId) return 'failed'
    setStep(clampStep(nextStep))
    setCompleted(nextCompleted)
    return saveOnboardingProgress(gymId, { step: nextStep, completed: nextCompleted })
  }, [gymId])

  const goToStep = useCallback((s: number) => persist(s, false), [persist])

  const advance = useCallback(() => {
    const current = step ?? ONBOARDING_FIRST_STEP
    if (current >= ONBOARDING_LAST_STEP) return persist(ONBOARDING_LAST_STEP, true)
    return persist(current + 1, false)
  }, [step, persist])

  const complete = useCallback(() => persist(ONBOARDING_LAST_STEP, true), [persist])

  return {
    step,
    completed,
    isOpen: Boolean(gymId) && completed === false && dismissedFor !== gymId,
    dismiss: () => setDismissedFor(gymId),
    goToStep,
    advance,
    complete,
  }
}
