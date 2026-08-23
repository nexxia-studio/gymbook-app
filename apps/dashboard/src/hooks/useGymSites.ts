// GYM-248 — sites de LA salle (table gym_sites).
//
// ⚠️ Une salle mono-site n'a AUCUNE ligne ici, et c'est normal : `site_id` est optionnel
// partout dans le schéma, le mono-site vit sans. Une liste vide n'est donc pas une anomalie
// à combler par un défaut — c'est l'état ordinaire de la quasi-totalité des salles.
// Le dashboard affichait jusqu'ici un site écrit en dur (« Neupré ») à la place de cette
// lecture : un vestige mono-client, faux pour toute autre salle.
//
// Forme reprise de useGymSettings / useNoshowRules : useState + useEffect sur useGymStore,
// client `supabase` partagé.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useGymStore } from '@/stores/useGymStore'

export interface GymSite {
  id: string
  name: string
}

export function useGymSites() {
  const gym = useGymStore((s) => s.gym)
  const gymId = gym?.id ?? null
  const [sites, setSites] = useState<GymSite[]>([])

  const load = useCallback(async () => {
    if (!gymId) return
    const { data, error } = await supabase
      .from('gym_sites')
      .select('id, name')
      .eq('gym_id', gymId)
      .eq('active', true)
      .order('sort_order')
    // Une erreur ne se transforme PAS en liste par défaut : on garde la liste vide, ce qui
    // masque la section plutôt que de proposer des sites imaginaires.
    if (error || !data) return
    setSites(data.map((row) => ({ id: row.id, name: row.name })))
  }, [gymId])

  useEffect(() => { void load() }, [load])

  return { sites, siteNames: sites.map((s) => s.name) }
}
