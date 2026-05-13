import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { getLocales } from 'expo-localization'

import fr from '../locales/fr.json'
import en from '../locales/en.json'
import nl from '../locales/nl.json'
import de from '../locales/de.json'

const deviceLang = getLocales()[0]?.languageCode ?? 'fr'
const supportedLangs = ['fr', 'en', 'nl', 'de']
const defaultLng = supportedLangs.includes(deviceLang) ? deviceLang : 'fr'

i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
    nl: { translation: nl },
    de: { translation: de },
  },
  lng: defaultLng,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
