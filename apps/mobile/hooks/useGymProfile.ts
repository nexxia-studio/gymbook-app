import { useEffect, useState } from 'react'
import { getGymProfile, type GymProfile } from '../lib/gymProfile'
import { useActiveGymId } from '../lib/activeGym'

/**
 * GYM-216 — Identité de la salle (nom, adresse, email de contact) pour l'affichage.
 *
 * Renvoie `null` tant que la lecture n'a pas abouti ET si elle échoue : les écrans
 * MASQUENT alors le bloc concerné plutôt que d'afficher une donnée en dur. La lecture
 * est mise en cache dans lib/gymProfile — monter ce hook sur plusieurs écrans ne
 * déclenche qu'une seule requête.
 */
export function useGymProfile(): GymProfile | null {
  const [profile, setProfile] = useState<GymProfile | null>(null)
  // 🔴 GYM-292 — LA SALLE ACTIVE EST LA DÉPENDANCE, ET ELLE MANQUAIT. L'effet ne se
  // rejouait jamais (`[]`) : après un changement de salle, l'écran gardait le nom,
  // l'adresse et l'email de contact de la salle QUITTÉE jusqu'à son démontage. Le cache
  // sous-jacent est désormais indexé par salle, mais un cache juste ne sert à rien si
  // personne ne le redemande.
  const gymId = useActiveGymId()

  useEffect(() => {
    let cancelled = false
    // La salle pas encore résolue : on n'affiche rien plutôt que de garder l'ancienne.
    if (!gymId) { setProfile(null); return }
    getGymProfile().then((p) => {
      if (!cancelled) setProfile(p)
    })
    return () => { cancelled = true }
  }, [gymId])

  return profile
}
