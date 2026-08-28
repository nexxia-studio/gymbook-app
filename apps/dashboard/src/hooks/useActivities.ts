import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import type { ActivityItem, ActivityFormData } from '@/types/activity'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function mapRow(row: Record<string, unknown>): ActivityItem {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    description: (row.description as string) ?? '',
    durationMin: row.duration_min as number,
    defaultCapacity: row.default_capacity as number,
    level: (row.default_level as string) ?? 'all',
    icon: (row.icon as string) ?? 'Dumbbell',
    color: (row.color as string) ?? '#4ECDC4',
    requiresMedicalCheck: (row.requires_medical_check as boolean) ?? false,
    // GYM-229 — repli sur `true` : une activité lue avant l'application de la migration
    // (ou par un build antérieur) doit se comporter comme avant, coach obligatoire.
    requiresCoach: (row.requires_coach as boolean) ?? true,
    hiddenInPlanning: (row.hidden_in_planning as boolean) ?? false,
    // GYM-231 — repli sur 0 : une activité lue avant la migration reste à capacité DURE.
    // Replier sur autre chose ouvrirait un dépassement que personne n'a paramétré.
    maxOverbook: (row.max_overbook as number) ?? 0,
    // GYM-215 — `null` reste `null` : le mobile lit cette absence et affiche son repli
    // aux initiales (`ActivityImage`). Une chaîne vide y passerait pour une URL et
    // casserait le rendu au lieu de laisser la place au repli.
    imageUrl: (row.image_url as string | null) ?? null,
    active: (row.active as boolean) ?? true,
  }
}

export function useActivities() {
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const gymId = useAuthStore((s) => s.gym_id)

  const fetchActivities = useCallback(async () => {
    if (!gymId) return
    try {
      setIsLoading(true)
      const { data, error: err } = await supabase
        .from('activities')
        .select('*')
        .eq('gym_id', gymId)
        .order('sort_order')
      if (err) throw err
      setActivities((data ?? []).map(mapRow))
    } catch (e) {
      setError('Failed to load activities')
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }, [gymId])

  useEffect(() => { fetchActivities() }, [fetchActivities])

  const activeCount = activities.filter((a) => a.active).length

  /**
   * GYM-228 — 🔴 L'ERREUR N'ÉTAIT PAS TESTÉE. `await supabase…insert()` sans lire `error` :
   * l'écran se rafraîchissait sans l'activité, sans un mot. C'est le motif des faux succès
   * de GYM-204 et GYM-219 — un échec non testé se lit comme une réussite.
   *
   * Ce n'était PAS la cause du défaut signalé en QA (la case manquait simplement à
   * l'écran), mais le trouver en le cherchant et le laisser aurait été le laisser exploser
   * plus tard, sur une contrainte violée ou un GRANT manquant.
   */
  const createActivity = useCallback(async (data: ActivityFormData): Promise<{ error?: string }> => {
    if (!gymId) return { error: 'no_gym' }
    const { error } = await supabase.from('activities').insert({
      gym_id: gymId,
      name: data.name,
      slug: data.slug,
      description: data.description,
      duration_min: data.durationMin,
      default_capacity: data.defaultCapacity,
      default_level: data.level,
      icon: data.icon,
      color: data.color,
      requires_medical_check: data.requiresMedicalCheck,
      requires_coach: data.requiresCoach,
      hidden_in_planning: data.hiddenInPlanning,
      max_overbook: data.maxOverbook,
    })
    if (error) return { error: error.message }
    fetchActivities()
    return {}
  }, [gymId, fetchActivities])

  const updateActivity = useCallback(async (id: string, data: ActivityFormData): Promise<{ error?: string }> => {
    const { error } = await supabase.from('activities').update({
      name: data.name,
      slug: data.slug,
      description: data.description,
      duration_min: data.durationMin,
      default_capacity: data.defaultCapacity,
      default_level: data.level,
      icon: data.icon,
      color: data.color,
      requires_medical_check: data.requiresMedicalCheck,
      requires_coach: data.requiresCoach,
      hidden_in_planning: data.hiddenInPlanning,
      max_overbook: data.maxOverbook,
    }).eq('id', id)
    if (error) return { error: error.message }
    fetchActivities()
    return {}
  }, [fetchActivities])

  /**
   * 🔴 GYM-215 — L'IMAGE SE PERSISTE À L'ENVOI, PAS À LA SOUMISSION DU FORMULAIRE.
   *
   * ⚠️ POURQUOI PAS UN CHAMP DE `ActivityFormData`. Le fichier part dans
   * `{gym_id}/activities/{activity_id}.{ext}` — un chemin qui contient l'IDENTIFIANT de
   * l'activité. À la création, cet identifiant n'existe pas encore : le champ serait donc
   * mort dans la moitié des ouvertures de la modale. Et à l'édition, le fichier est en
   * ligne dès l'envoi réussi : laisser la base pointer ailleurs jusqu'au « Enregistrer »
   * créerait un état où l'image a changé mais où la base ne le dit pas.
   *
   * ⚠️ AUCUNE MIGRATION N'EST NÉCESSAIRE — VÉRIFIÉ, PAS SUPPOSÉ. Contrairement à
   * `nexxia_gyms` (GYM-180, GRANT colonne par colonne), `activities` n'a AUCUNE liste
   * blanche : `authenticated` détient UPDATE sur toutes ses colonnes, `image_url`
   * comprise. Le cloisonnement vient de la seule RLS — « Gym admins gèrent les activités »,
   * `gym_id = get_my_gym_id() AND is_gym_admin()`. C'est le même chemin que les onze
   * autres champs de cette modale, sans exception ajoutée.
   */
  const updateActivityImage = useCallback(async (id: string, url: string | null): Promise<{ error?: string }> => {
    const { error } = await supabase.from('activities').update({ image_url: url }).eq('id', id)
    if (error) return { error: error.message }
    fetchActivities()
    return {}
  }, [fetchActivities])

  const getActivityFutureSlots = useCallback(async (id: string): Promise<number> => {
    const { count } = await supabase
      .from('time_slots')
      .select('*', { count: 'exact', head: true })
      .eq('activity_id', id)
      .gt('starts_at', new Date().toISOString())
      .neq('status', 'cancelled')
    return count ?? 0
  }, [])

  const toggleActivity = useCallback(async (id: string) => {
    const activity = activities.find((a) => a.id === id)
    if (!activity) return false
    const newActive = !activity.active
    await supabase.from('activities').update({ active: newActive }).eq('id', id)
    fetchActivities()
    return newActive
  }, [activities, fetchActivities])

  const duplicateActivity = useCallback(async (id: string) => {
    if (!gymId) return null
    const original = activities.find((a) => a.id === id)
    if (!original) return null
    const { data } = await supabase.from('activities').insert({
      gym_id: gymId,
      name: `${original.name} (copie)`,
      slug: slugify(`${original.name} copie`),
      description: original.description,
      duration_min: original.durationMin,
      default_capacity: original.defaultCapacity,
      default_level: original.level,
      icon: original.icon,
      color: original.color,
      requires_medical_check: original.requiresMedicalCheck,
      requires_coach: original.requiresCoach,
      hidden_in_planning: original.hiddenInPlanning,
      max_overbook: original.maxOverbook,
      // GYM-215 — la copie emporte l'image de l'originale, comme elle emporte sa couleur.
      //
      // ⚠️ LES DEUX POINTENT ALORS SUR LE MÊME OBJET, ET C'EST SANS DANGER DANS LE SENS
      // QUI COMPTE. Remplacer l'image de la copie écrit `{gym}/activities/{id_copie}.{ext}`
      // — son propre chemin — et l'originale ne bouge pas. Le seul cas gênant est l'inverse :
      // SUPPRIMER l'image de l'originale laisse la copie citer un objet effacé. Le mobile y
      // répond déjà par son repli aux initiales (`ActivityImage`, cas 2 : URL morte), donc
      // au pire une carte digne — jamais une image cassée.
      image_url: original.imageUrl,
    }).select().single()
    fetchActivities()
    return data ? mapRow(data) : null
  }, [gymId, activities, fetchActivities])

  const deleteActivity = useCallback(async (id: string) => {
    await supabase.from('activities').delete().eq('id', id)
    fetchActivities()
  }, [fetchActivities])

  return {
    activities, activeCount, isLoading, error,
    createActivity, updateActivity, updateActivityImage, toggleActivity, getActivityFutureSlots,
    duplicateActivity, deleteActivity, slugify, refetch: fetchActivities,
  }
}
