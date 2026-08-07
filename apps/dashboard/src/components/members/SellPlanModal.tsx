// GYM-222 — Modale de vente d'une formule à un membre existant (fiche membre).
//
// Le gérant a Julie devant lui, elle a fini sa carte et paie au terminal. Trois décisions,
// pas une de plus : quelle formule, quel moyen de paiement, confirmer.
//
// 🔴 CE N'EST PAS AdjustCreditsModal. Celle-ci OFFRE des crédits (motif obligatoire,
// aucune écriture comptable) ; celle-ci VEND (ligne payments, facture, TVA, chiffre
// d'affaires). Elles se ressemblent volontairement à l'écran — même forme, mêmes gestes —
// mais ne doivent jamais fusionner : confondre un cadeau et une vente fausse la compta.
//
// Le formulaire reprend celui d'AddMemberModal (sélecteur de formule à l'unité + méthode
// de paiement) parce que c'est LE MÊME acte d'encaissement, avec le même vocabulaire.
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ShoppingCart } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { edgeErrorMessage, edgeErrorCodeOf } from '@/lib/edgeErrors'
import { useGymPlans } from '@/hooks/useGymPlans'
import { useToastStore } from '@/hooks/useToast'
import type { SellResult } from '@/hooks/useMemberDetail'

type PaymentMethod = 'cash' | 'card_terminal'

interface SellPlanModalProps {
  open: boolean
  onClose: () => void
  memberName: string
  /** Solde affiché EN CONTEXTE — informatif, il ne bloque jamais la vente (cf. plus bas). */
  currentRemaining: number
  /** Un abonnement en cours est refusé par le serveur (SUBSCRIPTION_ACTIVE) : on prévient avant. */
  hasActiveSubscription: boolean
  onSell: (planId: string, paymentMethod: PaymentMethod) => Promise<SellResult>
}

function formatPrice(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('fr-BE', { style: 'currency', currency }).format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`
  }
}

export function SellPlanModal({
  open, onClose, memberName, currentRemaining, hasActiveSubscription, onSell,
}: SellPlanModalProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const addToast = useToastStore((s) => s.addToast)
  const { plans } = useGymPlans()

  // Formules vendables au comptoir = ACTIVES et payées EN UNE FOIS. Même filtre
  // qu'AddMemberModal, et même frontière que la garde serveur PLAN_NOT_ONE_TIME.
  // ⚠️ L'abonnement MENSUEL et le SEPA sont HORS PÉRIMÈTRE (GYM-185) : ils sont exclus ici
  // par `billingType === 'one_time'`, et le serveur les refuserait de toute façon.
  const sellablePlans = plans.filter((p) => p.active && p.billingType === 'one_time')

  const [planId, setPlanId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Remise à zéro à chaque ouverture : une formule choisie pour Julie ne doit jamais
  // rester sélectionnée quand le gérant rouvre la modale sur quelqu'un d'autre.
  function reset() {
    setPlanId(''); setPaymentMethod('cash'); setSubmitting(false); setError(null)
  }

  useEffect(() => { if (open) reset() }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const selectedPlan = sellablePlans.find((p) => p.id === planId) ?? null
  const isUnlimited = selectedPlan?.planType === 'unlimited'
  const canSubmit = !!selectedPlan && !submitting

  async function handleSubmit() {
    if (!canSubmit || !selectedPlan) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await onSell(selectedPlan.id, paymentMethod)
      // Dire ce qui a été DÉLIVRÉ, pas « c'est fait » : une carte de séances et un
      // abonnement ne se vérifient pas au même endroit de la fiche.
      if (res.payment.delivered === 'subscription') {
        addToast(t('member_drawer.sell.toast_subscription', { name: memberName }), 'success')
      } else {
        addToast(t('member_drawer.sell.toast_credits', { count: res.payment.credits }), 'success')
      }
      // La facture est best-effort côté serveur : l'encaissement a bien eu lieu, mais le
      // gérant doit savoir que le membre ne l'a pas reçue — sinon il l'apprend par le membre.
      if (!res.invoice_sent) {
        addToast(t('member_drawer.sell.toast_invoice_failed'), 'warning')
      }
      onClose()
    } catch (err) {
      // GYM-219 — SUBSCRIPTION_ACTIVE et PLAN_MISCONFIGURED sont des refus LÉGITIMES, pas
      // des pannes : ils s'affichent en clair, dans la modale, à côté du choix à corriger.
      // Un « la vente a échoué » laisserait le gérant tâtonner devant son client.
      setError(edgeErrorMessage(edgeErrorCodeOf(err), t, { name: memberName }))
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass = 'w-full rounded-xl border border-border bg-card px-4 py-3 font-body text-sm text-dark outline-none transition-colors focus:border-dark'
  const labelClass = 'font-body text-sm font-medium text-dark'

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="m-0 h-full w-full max-w-none bg-transparent p-0 backdrop:bg-black/40 md:m-auto md:h-auto md:max-w-[460px] md:rounded-2xl"
    >
      <div className="flex h-full flex-col bg-card md:h-auto md:max-h-[90vh] md:rounded-2xl md:shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-5">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-accent-dim" />
            <h2 className="font-display text-xl font-black tracking-tight text-dark">
              {t('member_drawer.sell.title')}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-dark/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <p className="font-body text-sm text-muted">{memberName}</p>

          {/* Solde actuel EN CONTEXTE. Décision produit Antoine (07/08) : afficher pour
              éviter une erreur de manipulation, NE JAMAIS BLOQUER. Les crédits sont
              cumulables — un membre qui en a encore 2 peut en racheter, ils s'additionnent
              (déjà la règle en libre-service, GYM-94). « Pourquoi attendre si elle veut
              déjà payer. » */}
          <div className="mt-3 flex items-center justify-between rounded-xl bg-dark/[0.03] px-4 py-3">
            <span className="font-body text-sm text-muted">{t('member_drawer.sell.current_balance')}</span>
            <span className="font-display text-xl font-black tracking-tight text-dark">{currentRemaining}</span>
          </div>

          {/* Un abonnement en cours ouvre déjà l'accès illimité : le serveur refusera
              (SUBSCRIPTION_ACTIVE). On le dit AVANT que le gérant encaisse, pas après. */}
          {hasActiveSubscription && (
            <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 font-body text-xs text-amber-700">
              {t('member_drawer.sell.subscription_warning')}
            </p>
          )}

          {error && (
            <div className="mt-3 rounded-xl bg-red-50 px-4 py-2.5 font-body text-sm text-red-600">{error}</div>
          )}

          {sellablePlans.length === 0 ? (
            <p className="mt-5 font-body text-xs text-muted">{t('member_drawer.sell.no_plans')}</p>
          ) : (
            <>
              {/* Formule */}
              <label className={`${labelClass} mt-5 block`}>{t('member_drawer.sell.plan')}</label>
              <select
                value={planId}
                onChange={(e) => { setPlanId(e.target.value); setError(null) }}
                className={`${inputClass} mt-2`}
              >
                <option value="">{t('member_drawer.sell.plan_placeholder')}</option>
                {/* GYM-189 — la nature est explicitée dans le libellé : le gérant ne doit
                    jamais confondre « Abonnement 12 mois — paiement unique » (1000 €) avec
                    une carte de séances. */}
                {sellablePlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.planType === 'unlimited'
                      ? t('members.add.plan_kind_unlimited', { count: p.durationMonths ?? 0 })
                      : t('members.add.plan_kind_credits', { count: p.creditCount ?? 0 })
                    } — {formatPrice(p.priceCents, p.currency)}
                  </option>
                ))}
              </select>

              {selectedPlan && (
                <>
                  {/* Prix en lecture seule : il vient de gym_plans et n'est JAMAIS envoyé au
                      serveur, qui le résout lui-même. Aucun champ modifiable ici. */}
                  <div className="mt-4 flex items-center justify-between rounded-xl bg-dark/[0.03] px-4 py-3">
                    <span className="font-body text-sm text-muted">{t('member_drawer.sell.price')}</span>
                    <span className="font-body text-sm font-bold text-dark">
                      {formatPrice(selectedPlan.priceCents, selectedPlan.currency)}
                    </span>
                  </div>

                  {/* Ce que le membre obtiendra — un abonnement ne s'ajoute pas au solde. */}
                  <p className="mt-2 font-body text-xs text-muted">
                    {isUnlimited
                      ? t('member_drawer.sell.effect_subscription', { count: selectedPlan.durationMonths ?? 0 })
                      : t('member_drawer.sell.effect_credits', {
                          count: selectedPlan.creditCount ?? 0,
                          total: currentRemaining + (selectedPlan.creditCount ?? 0),
                        })}
                  </p>

                  {/* Méthode de paiement — 'cash' / 'card_terminal', les deux seules valeurs
                      réellement présentes en base. Aucune autre à inventer. */}
                  <label className={`${labelClass} mt-5 block`}>{t('member_drawer.sell.payment_method')}</label>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    {(['cash', 'card_terminal'] as PaymentMethod[]).map((m) => (
                      <label
                        key={m}
                        className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 font-body text-sm transition-colors ${
                          paymentMethod === m ? 'border-dark bg-dark/[0.03] text-dark' : 'border-border text-muted hover:bg-dark/5'
                        }`}
                      >
                        <input
                          type="radio"
                          name="sell_payment_method"
                          value={m}
                          checked={paymentMethod === m}
                          onChange={() => setPaymentMethod(m)}
                          className="h-4 w-4 accent-accent"
                        />
                        {m === 'cash' ? t('members.add.method_cash') : t('members.add.method_card')}
                      </label>
                    ))}
                  </div>

                  {/* L'encaissement déclenche une facture : le dire évite au gérant de se
                      demander s'il doit en émettre une à la main. */}
                  <p className="mt-4 font-body text-xs text-muted">{t('member_drawer.sell.invoice_hint')}</p>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border p-5">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit} isLoading={submitting}>
            {selectedPlan
              ? t('member_drawer.sell.confirm_with_price', {
                  price: formatPrice(selectedPlan.priceCents, selectedPlan.currency),
                })
              : t('member_drawer.sell.confirm')}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
