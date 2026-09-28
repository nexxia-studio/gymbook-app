import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/Input'
import type { GymLegal } from '@/hooks/useGymLegal'

/**
 * GYM-363 — LES CHAMPS QUE LE SERVEUR EXIGE, ET RIEN D'AUTRE.
 *
 * ⚠️ CE COMPOSANT N'EST PAS UN SECOND FORMULAIRE : il ne porte ni état, ni validation, ni
 * écriture. Il reçoit le `GymLegal` de `useGymLegal` — le MÊME hook que
 * Réglages → Infos légales — et rend les champs. La validation, la normalisation
 * `'' → NULL` et la détection d'un UPDATE bloqué par RLS restent où elles sont déjà :
 * dans `useGymLegal.save`. La liste des champs obligatoires, elle, vient du serveur
 * (`gym_legal_identity_missing`), jamais d'ici.
 *
 * Les libellés réutilisent les clés `settings.legal.*` de l'onglet existant : deux jeux de
 * libellés pour les mêmes colonnes finiraient par se contredire, et c'est le gérant qui
 * paierait la différence entre « Numéro d'entreprise » et « Numéro de TVA ».
 */
export interface LegalIdentityFieldsProps {
  form: GymLegal
  set: <K extends keyof GymLegal>(key: K, value: GymLegal[K]) => void
  /**
   * Champs que LE SERVEUR déclare manquants, tels quels (`legal_name`, `vat_number`, …).
   * `null` = on ne sait pas encore : on ne souligne alors rien plutôt que d'accuser à tort.
   */
  missing: string[] | null
}

/** Colonne SQL ↔ clé du formulaire. Un seul endroit fait la correspondance. */
const CHAMPS: { sql: string; key: keyof GymLegal; label: string; helper?: string; wide?: boolean; type?: string }[] = [
  { sql: 'legal_name', key: 'legalName', label: 'legal_name_label', helper: 'legal_name_helper', wide: true },
  { sql: 'vat_number', key: 'vatNumber', label: 'vat_number_label', helper: 'vat_number_helper' },
  { sql: 'email', key: 'email', label: 'email_label', type: 'email' },
  { sql: 'legal_address', key: 'legalAddress', label: 'street_label', wide: true },
  { sql: 'legal_postal_code', key: 'legalPostalCode', label: 'postal_code_label' },
  { sql: 'legal_city', key: 'legalCity', label: 'city_label' },
]

export function LegalIdentityFields({ form, set, missing }: LegalIdentityFieldsProps) {
  const { t } = useTranslation()
  const manque = (sql: string) => missing !== null && missing.includes(sql)

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {CHAMPS.map((c) => (
        <div key={c.sql} className={c.wide ? 'sm:col-span-2' : undefined}>
          <Input
            name={c.sql}
            type={c.type}
            label={t(`settings.legal.${c.label}`)}
            helper={c.helper ? t(`settings.legal.${c.helper}`) : undefined}
            value={String(form[c.key] ?? '')}
            onChange={(e) => set(c.key, e.target.value as GymLegal[typeof c.key])}
            /* ⚠️ `required` PORTE SUR CE QUE LE SERVEUR DIT, pas sur une liste locale : un
               champ déjà rempli en base n'est pas re-signalé, et un champ que le serveur
               exige en plus (la mention de franchise) le serait sans toucher ce fichier. */
            required={manque(c.sql)}
          />
        </div>
      ))}

      {/* ── La septième exigence, CONDITIONNELLE ────────────────────────────────────────
          🔴 C'EST ELLE QUI MANQUAIT AU CONTRÔLE CÔTÉ ÉCRAN. Le serveur exige
          `vat_exempt_mention` dès que `vat_exempt` est vrai : « la franchise dispense de
          facturer la TVA, pas de l'expliquer ». Sans ce champ, une salle en franchise
          remplirait les six autres et resterait incapable d'encaisser, sans comprendre. */}
      {form.vatExempt && (
        <div className="sm:col-span-2">
          <Input
            name="vat_exempt_mention"
            label={t('settings.legal.vat_mention_label')}
            helper={t('settings.legal.vat_mention_helper')}
            value={form.vatExemptMention}
            onChange={(e) => set('vatExemptMention', e.target.value)}
            required={manque('vat_exempt_mention')}
          />
        </div>
      )}
    </div>
  )
}
