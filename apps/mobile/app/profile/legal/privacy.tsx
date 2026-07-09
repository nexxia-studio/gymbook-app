import { useTranslation } from 'react-i18next'
import { LegalScreen } from '../../../components/legal/LegalScreen'
import { getLegalDoc, LEGAL_VERSION, LEGAL_UPDATED_AT } from '../../../constants/legal'

export default function PrivacyPolicyScreen() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language?.startsWith('en') ? 'en' : 'fr'
  return (
    <LegalScreen
      title={t('profile.privacy_policy')}
      markdown={getLegalDoc('privacy', lang)}
      version={LEGAL_VERSION}
      updatedAt={LEGAL_UPDATED_AT}
    />
  )
}
