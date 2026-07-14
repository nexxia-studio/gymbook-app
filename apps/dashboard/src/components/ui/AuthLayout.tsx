import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import vinizWordmark from '@/assets/brand/viniz-wordmark.svg'

interface AuthLayoutProps {
  children: ReactNode
}

const SUPPORTED_LANGS = ['fr', 'en'] as const

export function AuthLayout({ children }: AuthLayoutProps) {
  const { t, i18n } = useTranslation()

  return (
    <div className="flex min-h-screen">
      {/* Left panel — hidden on mobile */}
      <div className="relative hidden w-[40%] flex-col justify-between bg-dark p-10 lg:flex">
        <div className="flex items-center gap-2">
          <img src={vinizWordmark} alt="Viniz" className="h-11 w-11 rounded-xl" />
        </div>

        <div>
          <h2 className="font-display text-4xl font-black uppercase leading-tight text-white">
            {t('auth.tagline')}
          </h2>
          <p className="mt-4 max-w-xs font-body text-sm leading-relaxed text-white/50">
            {t('auth.quote')}
          </p>
        </div>

        <p className="font-body text-xs text-white/20">
          &copy; {new Date().getFullYear()} Viniz by Nexxia
        </p>
      </div>

      {/* Right panel */}
      <div className="relative flex flex-1 flex-col bg-background">
        {/* Lang switcher */}
        <div className="absolute right-4 top-4 flex gap-2">
          {SUPPORTED_LANGS.map((lng) => (
            <button
              key={lng}
              onClick={() => i18n.changeLanguage(lng)}
              className={`rounded px-2.5 py-1 font-body text-xs font-semibold uppercase transition-colors ${
                i18n.language === lng
                  ? 'bg-accent text-dark'
                  : 'bg-dark/5 text-dark/40 hover:bg-dark/10'
              }`}
            >
              {lng}
            </button>
          ))}
        </div>

        {/* Mobile logo */}
        <div className="flex items-center gap-2 p-6 lg:hidden">
          <img src={vinizWordmark} alt="Viniz" className="h-9 w-9 rounded-lg" />
        </div>

        {/* Form area */}
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </div>
    </div>
  )
}
