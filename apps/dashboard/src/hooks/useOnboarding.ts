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
  /**
   * Objectifs atteints, par étape (2..5). Sert à annoncer « c'est fait » plutôt que de
   * proposer une action que le gérant vient d'accomplir.
   *
   * Pas de `refresh()` exposé : quitter le dashboard DÉMONTE le wizard, et y revenir le
   * remonte — `load()` rejoue donc la détection tout seul, au seul moment où elle peut
   * avoir changé. Une méthode de rafraîchissement que personne n'appellerait serait une
   * promesse en l'air.
   */
  satisfied: Record<number, boolean>
  /** Ferme pour CETTE session sans perdre l'étape — le « plus tard » des écrans. */
  dismiss: () => void
  goToStep: (step: number) => Promise<SaveOutcome>
  /** Avance d'une étape, ou termine si on était à la dernière. */
  advance: () => Promise<SaveOutcome>
  complete: () => Promise<SaveOutcome>
}

/**
 * GYM-248 (itération post-E2E) — VALIDATION DES ÉTAPES PAR L'OBJET, PAS PAR LE CLIC.
 *
 * Première version : le CTA d'une étape avançait le compteur puis naviguait. Résultat
 * constaté au premier parcours réel — le wizard se croyait plus loin que la salle, et
 * « Configurer » ressemblait à « Passer ». Une étape n'est plus franchie parce qu'on a
 * cliqué, mais parce que la CHOSE EXISTE.
 *
 * Chacune des quatre étapes déléguées a un objet observable, et c'est la détection la plus
 * simple possible — un `count` en tête, aucune donnée rapatriée :
 *   2 · au moins une activité ................. activities
 *   3 · au moins un coach ..................... coaches      (⚠️ AVANT le créneau : un
 *                                                créneau EXIGE un coach — GYM-229,
 *                                                activity_requires_coach. L'ordre inverse
 *                                                envoyait un gérant neuf sur un planning
 *                                                où il ne pouvait rien poser.)
 *   4 · au moins un créneau ................... time_slots   (⚠️ PAS `slots` : la table
 *                                                s'appelle time_slots)
 *   5 · la politique d'absences existe ........ noshow_rules (une salle neuve n'a PAS de
 *                                                ligne — le formulaire la crée par upsert,
 *                                                donc sa présence VAUT configuration)
 *   6 · au moins un membre .................... profiles role='member', deleted_at NULL
 *                                                (le gérant est gym_admin : il ne se
 *                                                compte pas lui-même)
 *
 * L'étape 1 (identité visuelle) n'a pas d'objet à détecter — des couleurs par défaut sont
 * indiscernables de couleurs choisies. Elle garde donc sa validation explicite : le bouton
 * enregistre ET avance, ou le gérant la passe.
 */
async function detectSatisfiedSteps(gymId: string): Promise<Record<number, boolean>> {
  const countOf = async (
    table: 'activities' | 'coaches' | 'time_slots' | 'noshow_rules',
  ): Promise<boolean> => {
    const { count, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('gym_id', gymId)
    // ⚠️ Une erreur de comptage n'est PAS « objectif atteint » : dans le doute on laisse
    // l'étape ouverte. Marquer franchi sans savoir ferait disparaître une étape que le
    // gérant n'a jamais faite.
    if (error) return false
    return (count ?? 0) > 0
  }

  const [activities, coaches, slots, noshow] = await Promise.all([
    countOf('activities'), countOf('coaches'), countOf('time_slots'), countOf('noshow_rules'),
  ])

  const { count: members, error: membersError } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('gym_id', gymId)
    .eq('role', 'member')
    .is('deleted_at', null)

  return {
    2: activities,
    3: coaches,
    4: slots,
    5: noshow,
    6: !membersError && (members ?? 0) > 0,
  }
}

/** Première étape (parmi 2..5) dont l'objectif n'est PAS atteint. 6 = toutes atteintes. */
function firstUnsatisfied(satisfied: Record<number, boolean>): number {
  for (let n = 2; n <= ONBOARDING_LAST_STEP; n++) {
    if (!satisfied[n]) return n
  }
  return ONBOARDING_LAST_STEP + 1
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
  const [satisfied, setSatisfied] = useState<Record<number, boolean>>({})

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

    const storedStep = local && (local.completed || local.step > serverStep) ? local.step : serverStep
    if (local?.completed) {
      setCompleted(true)
      setStep(storedStep)
      return
    }

    // ── Avancement PAR DÉTECTION ──
    const found = await detectSatisfiedSteps(gymId)
    setSatisfied(found)

    // On n'avance JAMAIS au-delà de ce qui est stocké tant qu'on est encore à l'étape 1 :
    // l'identité visuelle n'a pas d'objet détectable, la sauter parce qu'une activité
    // existe déjà la ferait disparaître sans que le gérant l'ait vue.
    const detected = firstUnsatisfied(found)
    const effective = storedStep >= 2
      ? clampStep(Math.max(storedStep, Math.min(detected, ONBOARDING_LAST_STEP)))
      : storedStep

    setCompleted(false)
    setStep(effective)

    // La progression déduite est REPOUSSÉE en base (ou en local) : sans ça, elle serait
    // recalculée à chaque montage et la trace de l'avancement n'existerait nulle part.
    if (effective !== storedStep) {
      void saveOnboardingProgress(gymId, { step: effective, completed: false })
    }
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
    satisfied,
    isOpen: Boolean(gymId) && completed === false && dismissedFor !== gymId,
    dismiss: () => setDismissedFor(gymId),
    goToStep,
    advance,
    complete,
  }
}
