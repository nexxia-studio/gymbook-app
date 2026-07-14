import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { LegalMarkdown } from '@/components/LegalMarkdown'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { getLegalDoc, resolveLegalLang, type LegalKind, type LegalLang } from '@/lib/legalContent'

interface LegalDocPageProps {
  kind: LegalKind
  title: string
  description: string
}

// Coquille sobre commune aux pages légales publiques (thème dashboard actuel).
// Publique = rendue sans session (Apple vérifie les URLs hors connexion).
export function LegalDocPage({ kind, title, description }: LegalDocPageProps) {
  const { i18n } = useTranslation()
  useDocumentMeta(title, description)

  const [lang, setLang] = useState<LegalLang>(() => resolveLegalLang(i18n.language))
  const markdown = getLegalDoc(kind, lang)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/" className="font-display text-xl font-black uppercase tracking-tight text-dark">
            Viniz
          </Link>
          <div className="flex items-center gap-1 text-xs">
            {(['fr', 'en'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                className={`rounded-md px-2 py-1 font-body uppercase transition-colors ${
                  lang === code ? 'bg-dark text-white' : 'text-muted hover:text-dark'
                }`}
                aria-pressed={lang === code}
              >
                {code}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <LegalMarkdown markdown={markdown} />

        <nav className="mt-12 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-6 text-sm">
          <Link to="/legal/privacy" className="text-secondary transition-colors hover:text-dark">
            {lang === 'en' ? 'Privacy Policy' : 'Politique de confidentialité'}
          </Link>
          <Link to="/legal/terms" className="text-secondary transition-colors hover:text-dark">
            {lang === 'en' ? 'Terms & Conditions' : 'Conditions générales'}
          </Link>
          <Link to="/support" className="text-secondary transition-colors hover:text-dark">
            {lang === 'en' ? 'Support' : 'Support'}
          </Link>
        </nav>
      </main>
    </div>
  )
}
