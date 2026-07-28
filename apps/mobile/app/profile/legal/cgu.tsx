import { useTranslation } from 'react-i18next'
import { LegalScreen } from '../../../components/legal/LegalScreen'
import { getLegalDoc, LEGAL_VERSION, LEGAL_UPDATED_AT } from '../../../constants/legal'
import { renderLegal } from '../../../constants/legal/params'
import { useLegalParams } from '../../../hooks/useLegalParams'

export default function TermsScreen() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language?.startsWith('en') ? 'en' : 'fr'
  // GYM-197 — les paramètres opérationnels de la salle sont injectés dans le gabarit.
  // Le hook part des valeurs par défaut et ne les remplace qu'en cas de succès : l'écran
  // s'affiche donc immédiatement, avec un texte toujours valide, jamais un placeholder.
  const params = useLegalParams()

  return (
    <LegalScreen
      title={t('profile.terms')}
      markdown={renderLegal(getLegalDoc('cgu', lang), params, lang)}
      version={LEGAL_VERSION}
      updatedAt={LEGAL_UPDATED_AT}
    />
  )
}
