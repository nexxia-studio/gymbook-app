import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Mail, Download, UserX } from 'lucide-react'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { resolveLegalLang, type LegalLang } from '@/lib/legalContent'

const SUPPORT_EMAIL = 'support@viniz.app'

const COPY: Record<LegalLang, {
  title: string
  meta: string
  intro: string
  contactTitle: string
  contactBody: string
  resourcesTitle: string
  exportTitle: string
  exportBody: string
  deleteTitle: string
  deleteBody: string
  identityTitle: string
  privacy: string
  terms: string
}> = {
  fr: {
    title: 'Support',
    meta: 'Contactez le support Viniz et retrouvez les ressources RGPD (export de données, suppression de compte).',
    intro: 'Besoin d’aide avec l’application ou vos données ? Nous sommes là pour vous.',
    contactTitle: 'Nous contacter',
    contactBody: 'Écrivez-nous, nous répondons dans les meilleurs délais (et sous un mois maximum pour toute demande relative à vos données personnelles).',
    resourcesTitle: 'Gérer vos données depuis l’application',
    exportTitle: 'Exporter mes données',
    exportBody: 'Profil → Exporter mes données : demandez une copie de vos données personnelles.',
    deleteTitle: 'Supprimer mon compte',
    deleteBody: 'Profil → Supprimer mon compte : anonymisation immédiate de vos données personnelles et suppression de vos données de santé.',
    identityTitle: 'Éditeur',
    privacy: 'Politique de confidentialité',
    terms: 'Conditions générales',
  },
  en: {
    title: 'Support',
    meta: 'Contact Viniz support and find the GDPR resources (data export, account deletion).',
    intro: 'Need help with the app or your data? We’re here for you.',
    contactTitle: 'Contact us',
    contactBody: 'Write to us — we reply as soon as possible (and within one month at most for any request regarding your personal data).',
    resourcesTitle: 'Manage your data from the app',
    exportTitle: 'Export my data',
    exportBody: 'Profile → Export my data: request a copy of your personal data.',
    deleteTitle: 'Delete my account',
    deleteBody: 'Profile → Delete my account: immediate anonymisation of your personal data and erasure of your health data.',
    identityTitle: 'Publisher',
    privacy: 'Privacy Policy',
    terms: 'Terms & Conditions',
  },
}

// Page publique (accessible hors session — Apple vérifie les URLs).
export default function Support() {
  const { i18n } = useTranslation()
  const [lang, setLang] = useState<LegalLang>(() => resolveLegalLang(i18n.language))
  const c = COPY[lang]
  useDocumentMeta(`${c.title} — Viniz`, c.meta)

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
        <h1 className="mb-3 font-display text-3xl font-black tracking-tight text-dark">
          {c.title}
        </h1>
        <p className="mb-8 text-sm leading-6 text-secondary">{c.intro}</p>

        {/* Contact */}
        <section className="mb-6 rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-2 font-body text-base font-bold text-dark">{c.contactTitle}</h2>
          <p className="mb-4 text-sm leading-6 text-secondary">{c.contactBody}</p>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="inline-flex items-center gap-2 rounded-xl bg-dark px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-dark/90"
          >
            <Mail size={16} className="text-accent" />
            {SUPPORT_EMAIL}
          </a>
        </section>

        {/* Ressources in-app */}
        <section className="mb-6 rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-4 font-body text-base font-bold text-dark">{c.resourcesTitle}</h2>
          <div className="flex gap-3 py-2">
            <Download size={18} className="mt-0.5 shrink-0 text-muted" />
            <div>
              <p className="text-sm font-semibold text-dark">{c.exportTitle}</p>
              <p className="text-sm leading-6 text-secondary">{c.exportBody}</p>
            </div>
          </div>
          <div className="flex gap-3 border-t border-border py-2 pt-3">
            <UserX size={18} className="mt-0.5 shrink-0 text-muted" />
            <div>
              <p className="text-sm font-semibold text-dark">{c.deleteTitle}</p>
              <p className="text-sm leading-6 text-secondary">{c.deleteBody}</p>
            </div>
          </div>
        </section>

        {/* Identité éditeur */}
        <section className="mb-8">
          <h2 className="mb-1 font-body text-xs font-bold uppercase tracking-wider text-muted">
            {c.identityTitle}
          </h2>
          <p className="text-sm leading-6 text-secondary">
            <strong className="font-semibold text-dark">Nexxia</strong> — Antoine Monie · Rue Grande
            Bruyère 6 B1, 4840 Welkenraedt, Belgique · BCE BE 1024.997.119 · {SUPPORT_EMAIL}
          </p>
        </section>

        <nav className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border pt-6 text-sm">
          <Link to="/legal/privacy" className="text-secondary transition-colors hover:text-dark">
            {c.privacy}
          </Link>
          <Link to="/legal/terms" className="text-secondary transition-colors hover:text-dark">
            {c.terms}
          </Link>
        </nav>
      </main>
    </div>
  )
}
