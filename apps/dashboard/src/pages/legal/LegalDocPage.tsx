import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { LegalMarkdown } from '@/components/LegalMarkdown'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import {
  getLegalDoc,
  resolveLegalLang,
  LEGAL_DRAFT,
  type LegalKind,
  type LegalLang,
} from '@/lib/legalContent'
import {
  fetchGymLegalIdentity,
  resolveGymSlug,
  type GymLegalIdentity,
} from '@/lib/gymLegalIdentity'

interface LegalDocPageProps {
  kind: LegalKind
  title: string
  description: string
}

/**
 * Coquille sobre commune aux pages légales publiques.
 *
 * ⚠️ PUBLIQUE = RENDUE SANS SESSION. Apple vérifie les URLs légales hors connexion, et un
 * futur membre doit pouvoir lire les CGV avant de créer un compte. Rien ici ne peut donc
 * dépendre du store de session ni de ProtectedRoute.
 */
export function LegalDocPage({ kind, title, description }: LegalDocPageProps) {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  useDocumentMeta(title, description)

  const [lang, setLang] = useState<LegalLang>(() => resolveLegalLang(i18n.language))
  const [gym, setGym] = useState<GymLegalIdentity | null>(null)

  // Seules les CGV sont paramétrées par une salle : inutile d'interroger la base sur les
  // deux autres documents, qui sont identiques pour tout le monde.
  const slug = kind === 'terms' ? resolveGymSlug(location.search, window.location.hostname) : null

  useEffect(() => {
    if (!slug) {
      setGym(null)
      return
    }
    // `cancelled` évite d'appliquer une réponse tardive après un changement de slug — le
    // cas se produit dès qu'on navigue d'une salle à l'autre depuis le pied de page.
    let cancelled = false
    fetchGymLegalIdentity(slug).then((g) => {
      if (!cancelled) setGym(g)
    })
    return () => {
      cancelled = true
    }
  }, [slug])

  const markdown = getLegalDoc(kind, lang, gym)

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
        {/* ── BANDEAU « VERSION PROVISOIRE » ────────────────────────────────────────
            GYM-265 — le texte affiché est un brouillon rédigé en interne, en attente de
            relecture juridique. Le dire EN TÊTE, avant le document, et non en note de bas
            de page : un lecteur qui s'engage sur la foi de ce texte doit savoir qu'il n'est
            pas définitif AVANT de le lire, pas après. Le bandeau disparaît document par
            document, en basculant son drapeau dans LEGAL_DRAFT. */}
        {LEGAL_DRAFT[kind] && (
          <div
            role="status"
            className="mb-8 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3"
          >
            <p className="font-body text-sm font-semibold text-amber-900">
              {t('legal.draft_title')}
            </p>
            <p className="mt-1 font-body text-xs leading-5 text-amber-800">
              {t('legal.draft_body')}
            </p>
          </div>
        )}

        {/* Une salle a été demandée dans l'URL mais n'a pas pu être lue : on le DIT.
            Sans ce message, le visiteur croirait lire les CGV de sa salle alors qu'il a
            sous les yeux la page générique. */}
        {kind === 'terms' && slug && !gym && (
          <div role="status" className="mb-8 rounded-xl border border-border bg-card px-4 py-3">
            <p className="font-body text-xs leading-5 text-secondary">
              {t('legal.gym_not_resolved', { slug })}
            </p>
          </div>
        )}

        <LegalMarkdown markdown={markdown} />

        <nav className="mt-12 flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-6 text-sm">
          <Link to="/legal/cgu" className="text-secondary transition-colors hover:text-dark">
            {t('legal.nav_cgu')}
          </Link>
          <Link to="/legal/terms" className="text-secondary transition-colors hover:text-dark">
            {t('legal.nav_terms')}
          </Link>
          <Link to="/legal/privacy" className="text-secondary transition-colors hover:text-dark">
            {t('legal.nav_privacy')}
          </Link>
          <Link to="/support" className="text-secondary transition-colors hover:text-dark">
            {t('legal.nav_support')}
          </Link>
        </nav>
      </main>
    </div>
  )
}
