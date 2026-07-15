import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import vinizLogo from '@/assets/brand/viniz-logo-horizontal-lime.svg'

interface AuthLayoutProps {
  children: ReactNode
}

const SUPPORTED_LANGS = ['fr', 'en'] as const

export function AuthLayout({ children }: AuthLayoutProps) {
  const { t, i18n } = useTranslation()

  return (
    <div className="flex min-h-screen">
      {/* Left panel — indigo de marque FIXE (bg-primary), pas bg-dark qui s'inverse en
          clair en mode sombre (bg-dark = token texte). Reste indigo dans les 2 modes. */}
      <div className="relative hidden w-[40%] flex-col justify-between bg-primary p-10 lg:flex">
        {/* Logo horizontal Viniz sur le panneau indigo — lime lisible. L'asset est un
            canevas carré (contenu horizontal centré) : recadré via conteneur à hauteur
            fixe + overflow-hidden (asset non altéré), comme la sidebar. */}
        <div className="relative h-10 w-[200px] overflow-hidden">
          <img
            src={vinizLogo}
            alt="Viniz"
            className="absolute left-1/2 top-1/2 w-[200px] max-w-none -translate-x-1/2 -translate-y-1/2"
          />
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
                  ? 'bg-[#4827B4] text-white'
                  : 'bg-dark/5 text-dark/40 hover:bg-dark/10'
              }`}
            >
              {lng}
            </button>
          ))}
        </div>

        {/* Mobile logo — même logo horizontal, centré. Le panneau mobile est CLAIR : on
            pose le logo sur une pastille indigo pour que le lime reste lisible
            (règle : lime jamais sur fond clair). */}
        <div className="flex justify-center p-6 lg:hidden">
          <div className="rounded-xl bg-primary px-4 py-2.5">
            <div className="relative h-7 w-[140px] overflow-hidden">
              <img
                src={vinizLogo}
                alt="Viniz"
                className="absolute left-1/2 top-1/2 w-[140px] max-w-none -translate-x-1/2 -translate-y-1/2"
              />
            </div>
          </div>
        </div>

        {/* Form area */}
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </div>
    </div>
  )
}
