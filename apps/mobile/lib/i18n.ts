import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import fr from '../locales/fr.json'
import en from '../locales/en.json'
import nl from '../locales/nl.json'
import de from '../locales/de.json'

i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
    nl: { translation: nl },
    de: { translation: de },
  },
  lng: 'fr',
  fallbackLng: 'fr',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
