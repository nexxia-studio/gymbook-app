import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useGymStore } from '@/stores/useGymStore'

/**
 * GYM-180 — informations légales & facturation du gym.
 *
 * Ces champs alimentent DIRECTEMENT le bloc émetteur des factures (generate-invoice).
 * Deux adresses distinctes, à ne pas confondre :
 *   - siège social      → legal_address / legal_postal_code / legal_city (obligatoire sur facture)
 *   - établissement     → address / postal_code / city (la salle : usage membre, Google, app)
 *
 * Écriture via update RLS direct sur nexxia_gyms, comme useGymSettings : la migration
 * GYM-180 ajoute la policy UPDATE gym-scopée qui manquait, et restreint les colonnes
 * modifiables par GRANT (le gérant ne peut pas toucher plan/status/commissions/mollie).
 */
export interface GymLegal {
  commercialName: string
  legalName: string
  legalForm: string
  vatNumber: string
  legalAddress: string
  legalPostalCode: string
  legalCity: string
  address: string
  postalCode: string
  city: string
  vatRate: string      // gardé en string : c'est une saisie de formulaire
  vatExempt: boolean
  vatExemptMention: string
}

export const EMPTY_GYM_LEGAL: GymLegal = {
  commercialName: '', legalName: '', legalForm: '', vatNumber: '',
  legalAddress: '', legalPostalCode: '', legalCity: '',
  address: '', postalCode: '', city: '',
  vatRate: '0', vatExempt: false, vatExemptMention: '',
}

// Doit rester un littéral d'un seul tenant : supabase-js infère le type de `data` en
// parsant cette chaîne à la compilation, une concaténation lui fait perdre le typage.
const SELECT_COLS = 'commercial_name, legal_name, legal_form, vat_number, legal_address, legal_postal_code, legal_city, address, postal_code, city, vat_rate, vat_exempt, vat_exempt_mention' as const

export function useGymLegal() {
  const gym = useGymStore((s) => s.gym)
  const [legal, setLegal] = useState<GymLegal | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const load = useCallback(async () => {
    if (!gym?.id) return
    setIsLoading(true)
    const { data, error } = await supabase
      .from('nexxia_gyms')
      .select(SELECT_COLS)
      .eq('id', gym.id)
      .single()
    setIsLoading(false)
    if (error || !data) return
    setLegal({
      commercialName: data.commercial_name ?? '',
      legalName: data.legal_name ?? '',
      legalForm: data.legal_form ?? '',
      vatNumber: data.vat_number ?? '',
      legalAddress: data.legal_address ?? '',
      legalPostalCode: data.legal_postal_code ?? '',
      legalCity: data.legal_city ?? '',
      address: data.address ?? '',
      postalCode: data.postal_code ?? '',
      city: data.city ?? '',
      vatRate: String(data.vat_rate ?? 0),
      vatExempt: Boolean(data.vat_exempt),
      vatExemptMention: data.vat_exempt_mention ?? '',
    })
  }, [gym?.id])

  useEffect(() => { load() }, [load])

  const save = useCallback(async (next: GymLegal): Promise<{ error?: string }> => {
    if (!gym?.id) return { error: 'no_gym' }

    const rate = Number(next.vatRate)
    if (!next.vatExempt && (!Number.isFinite(rate) || rate < 0 || rate > 100)) {
      return { error: 'rate' }
    }

    // Champs texte : '' → NULL, pour ne pas stocker des chaînes vides sur une facture.
    const orNull = (v: string) => (v.trim() === '' ? null : v.trim())

    const { data, error } = await supabase
      .from('nexxia_gyms')
      .update({
        commercial_name: orNull(next.commercialName),
        legal_name: orNull(next.legalName),
        legal_form: orNull(next.legalForm),
        vat_number: orNull(next.vatNumber),
        legal_address: orNull(next.legalAddress),
        legal_postal_code: orNull(next.legalPostalCode),
        legal_city: orNull(next.legalCity),
        address: orNull(next.address),
        postal_code: orNull(next.postalCode),
        city: orNull(next.city),
        // Exonéré : le taux n'a pas de sens, on le remet à 0 et on garde la mention.
        // Assujetti : pas de mention d'exonération à traîner.
        vat_rate: next.vatExempt ? 0 : rate,
        vat_exempt: next.vatExempt,
        vat_exempt_mention: next.vatExempt ? orNull(next.vatExemptMention) : null,
      })
      .eq('id', gym.id)
      .select('id')

    if (error) return { error: error.message }
    // Un UPDATE bloqué par RLS ne lève PAS d'erreur : il porte simplement sur 0 ligne.
    // Le .select() ci-dessus permet de distinguer « enregistré » de « silencieusement ignoré ».
    if (!data || data.length === 0) return { error: 'forbidden' }
    setLegal(next)
    return {}
  }, [gym?.id])

  return { legal, isLoading, save, reload: load }
}
