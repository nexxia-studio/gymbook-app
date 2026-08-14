// GYM-167 — Menu « Facture » d'une ligne de paiement dans /revenus.
// Deux actions : Télécharger (ouvre le document pour impression/PDF au comptoir) et
// Envoyer par email au membre. Les deux appellent generate-invoice (numéro idempotent :
// regénérer produit le MÊME document avec le MÊME numéro).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveEdgeError } from '@/lib/edgeErrors'
import { FileText, Download, Mail, Loader2 } from 'lucide-react'
import { useToastStore } from '@/hooks/useToast'
import { invokeEdge } from '@/lib/edgeInvoke'

export function InvoiceMenu({ paymentId }: { paymentId: string }) {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<null | 'download' | 'email'>(null)

  async function handleDownload() {
    if (busy) return
    setBusy('download')
    try {
      const { data, error } = await invokeEdge('generate-invoice', {
        body: { payment_id: paymentId, mode: 'download' },
      })
      const html = (data as { html?: string } | null)?.html
      if (error || !html) {
        // GYM-219 — NOT_PAID (« pas encore encaissé ») n'est pas une panne : le gérant
        // doit savoir qu'il n'y a rien à facturer, pas réessayer indéfiniment.
        addToast(await resolveEdgeError(error, t), 'error')
        return
      }
      // Ouvre le document dans un onglet → le gérant imprime / enregistre en PDF.
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
      setOpen(false)
    } catch {
      addToast(t('revenue.invoice.error'), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function handleEmail() {
    if (busy) return
    setBusy('email')
    try {
      const { data, error } = await invokeEdge('generate-invoice', {
        body: { payment_id: paymentId, mode: 'email' },
      })
      if (error || !(data as { success?: boolean } | null)?.success) {
        // NO_EMAIL dit quoi corriger (ajouter l'email sur la fiche) ; RESEND_NOT_CONFIGURED
        // dit que le problème n'est pas chez le gérant.
        addToast(await resolveEdgeError(error, t), 'error')
        return
      }
      addToast(t('revenue.invoice.email_sent'), 'success')
      setOpen(false)
    } catch {
      addToast(t('revenue.invoice.error'), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-fit items-center gap-1 font-body text-[11px] font-semibold text-dark/60 hover:text-dark"
      >
        <FileText className="h-3 w-3" />
        {t('revenue.invoice.action')}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          {/* GYM-168 — ancré à droite : la colonne est la plus à droite du tableau ;
              un menu ancré à gauche débordait et était rogné par l'overflow-x-auto du tableau. */}
          <div className="absolute bottom-full right-0 z-20 mb-1 w-60 rounded-xl border border-border bg-card py-1 shadow-lg">
            <button
              type="button"
              onClick={handleDownload}
              disabled={!!busy}
              className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left font-body text-sm text-dark hover:bg-dark/5 disabled:opacity-50"
            >
              {busy === 'download' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {t('revenue.invoice.download')}
            </button>
            <button
              type="button"
              onClick={handleEmail}
              disabled={!!busy}
              className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left font-body text-sm text-dark hover:bg-dark/5 disabled:opacity-50"
            >
              {busy === 'email' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
              {t('revenue.invoice.email')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
