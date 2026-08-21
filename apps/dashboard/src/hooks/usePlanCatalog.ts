import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * GYM-247 — grille tarifaire Viniz, lue depuis nexxia_plan_limits.
 *
 * ⚠️ AUCUN prix, AUCUNE limite, AUCUN nom de plan n'est écrit en dur : tout vient de la
 * table. Les grilles diffèrent d'un environnement à l'autre (staging et production n'ont
 * pas eu les mêmes plans au même moment) et une grille recopiée dans le code aurait menti
 * au premier changement de tarif.
 *
 * Lecture directe autorisée : la policy « Plan limits visibles par tous »
 * (FOR SELECT USING (true)) couvre le rôle authenticated — vérifié en base. Aucun RPC
 * n'est donc nécessaire.
 *
 * Le tri se fait sur price_cents : c'est la grille elle-même qui décide de l'ordre
 * croissant, pas une liste de noms figée dans le code.
 */
export interface CatalogPlan {
  plan: string
  price_cents: number | null
  price_yearly_cents: number | null
  max_members: number | null
  max_admins: number | null
  max_sites: number | null
  payments_enabled: boolean | null
  notifications_enabled: boolean | null
  analytics_enabled: boolean | null
  export_enabled: boolean | null
  qr_checkin_enabled: boolean | null
  ios_app_enabled: boolean | null
  android_app_enabled: boolean | null
  multi_site_enabled: boolean | null
  api_access_enabled: boolean | null
  custom_domain: boolean | null
}

// Littéral d'un seul tenant : supabase-js infère le type de `data` en parsant cette
// chaîne à la compilation, une concaténation lui ferait perdre le typage.
const SELECT_COLS = 'plan, price_cents, price_yearly_cents, max_members, max_admins, max_sites, payments_enabled, notifications_enabled, analytics_enabled, export_enabled, qr_checkin_enabled, ios_app_enabled, android_app_enabled, multi_site_enabled, api_access_enabled, custom_domain' as const

/** Drapeaux montrés dans la grille comparative, dans l'ordre d'affichage. */
export const CATALOG_FEATURE_KEYS = [
  'payments_enabled',
  'qr_checkin_enabled',
  'ios_app_enabled',
  'android_app_enabled',
  'analytics_enabled',
  'export_enabled',
  'multi_site_enabled',
  'api_access_enabled',
  'custom_domain',
] as const

export function usePlanCatalog() {
  const [plans, setPlans] = useState<CatalogPlan[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    const { data, error: err } = await supabase
      .from('nexxia_plan_limits')
      .select(SELECT_COLS)
      .order('price_cents', { ascending: true })
    setIsLoading(false)

    if (err || !data) {
      // Même règle que useEffectivePlan : un échec de lecture n'est pas une grille vide.
      // L'écran doit dire « indisponible », jamais afficher un catalogue amputé.
      setError(err?.message ?? 'no_payload')
      setPlans(null)
      return
    }
    setError(null)
    setPlans(data as CatalogPlan[])
  }, [])

  useEffect(() => { load() }, [load])

  return { plans, isLoading, error, reload: load }
}
