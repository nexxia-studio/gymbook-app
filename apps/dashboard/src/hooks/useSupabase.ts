import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Tables } from '@/types/database'

const DOPAMINE_ID = 'a0000000-0000-0000-0000-000000000001'

type Gym = Tables<'nexxia_gyms'>

export function useGym(gymId: string = DOPAMINE_ID) {
  return useQuery<Gym | null>({
    queryKey: ['gym', gymId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nexxia_gyms')
        .select('*')
        .eq('id', gymId)
        .maybeSingle()

      if (error) throw error
      return data
    },
  })
}
