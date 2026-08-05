import { useEffect, useState } from 'react'
import { getGymProfile, type GymProfile } from '../lib/gymProfile'

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

  useEffect(() => {
    let cancelled = false
    getGymProfile().then((p) => {
      if (!cancelled) setProfile(p)
    })
    return () => { cancelled = true }
  }, [])

  return profile
}
