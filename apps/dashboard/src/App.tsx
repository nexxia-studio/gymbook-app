import { useTranslation } from 'react-i18next'
import { Dumbbell } from 'lucide-react'

const SUPPORTED_LANGS = ['fr', 'en'] as const

function App() {
  const { t, i18n } = useTranslation()

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="fixed right-4 top-4 flex gap-2">
        {SUPPORTED_LANGS.map((lng) => (
          <button
            key={lng}
            onClick={() => i18n.changeLanguage(lng)}
            className={`rounded px-3 py-1 font-body text-sm font-semibold uppercase transition-colors ${
              i18n.language === lng
                ? 'bg-accent text-dark'
                : 'bg-dark/10 text-dark/60 hover:bg-dark/20'
            }`}
          >
            {lng}
          </button>
        ))}
      </div>

      <div className="text-center">
        <div className="mb-6 flex items-center justify-center gap-3">
          <Dumbbell className="h-10 w-10 text-accent" />
          <h1 className="font-display text-5xl font-black uppercase tracking-tight text-dark">
            {t('dashboard.title')}
          </h1>
        </div>
        <p className="text-lg text-dark/60">
          {t('dashboard.subtitle')}
        </p>
        <div className="mx-auto mt-6 h-1 w-24 rounded-full bg-accent" />
      </div>
    </div>
  )
}

export default App
