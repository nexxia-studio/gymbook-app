// GYM-129 — Drawer fiche membre (/members). Identité (édition prénom/nom/téléphone
// via admin-update-member), crédits, abonnement, 5 dernières réservations. Lectures
// directes (RLS gym_admin) ; email non modifiable (hors périmètre v1).
import { useState, useEffect, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Pencil, Mail, Phone, Globe, CalendarDays, CreditCard, RefreshCcw, Gift, History, ShieldAlert, AlertTriangle, ShoppingCart, Receipt, ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useToastStore } from '@/hooks/useToast'
import { useGymTimezone } from '@/hooks/useGymTimezone'
import { extractErrorBody, edgeErrorMessage } from '@/lib/edgeErrors'
import { isSubscriptionActive } from '@/lib/subscription'
import { useMemberDetail, MANUAL_GRANT_PLAN_ID } from '@/hooks/useMemberDetail'
import { useMemberDiscipline, type PenaltyEntry } from '@/hooks/useMemberDiscipline'
import { AdjustCreditsModal } from '@/components/members/AdjustCreditsModal'
import { SellPlanModal } from '@/components/members/SellPlanModal'
import type { Member } from '@/hooks/useMembers'
import { invokeEdge } from '@/lib/edgeInvoke'

interface MemberDrawerProps {
  member: Member | null
  onClose: () => void
  onUpdated: (patch: { firstName: string; lastName: string; phone: string | null }) => void
}

const BOOKING_BADGE: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-700',
  attended: 'bg-accent-dim/20 text-accent-dim',
  cancelled: 'bg-gray-100 text-gray-500',
  no_show: 'bg-red-100 text-red-700',
  waitlisted: 'bg-amber-100 text-amber-700',
  // GYM-174 — absent sans perte de crédit (orange neutre).
  excused: 'bg-orange-100 text-orange-700',
}

// GYM-214 — l'origine de la sanction se lit d'un coup d'œil : un no-show constaté et
// une annulation tardive sont deux comportements différents. 'unknown' reste neutre :
// on n'affirme pas une origine qu'on n'a pas pu établir.
const ORIGIN_BADGE: Record<string, string> = {
  noshow: 'bg-red-100 text-red-700',
  late_cancel: 'bg-amber-100 text-amber-700',
  unknown: 'bg-gray-100 text-gray-500',
}

const SUB_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  suspended: 'bg-red-100 text-red-700',
  // GYM-151 — engagement arrivé à son terme : état neutre (ni positif « actif », ni rouge).
  completed: 'bg-gray-200 text-gray-700',
  // GYM-147 / GYM-195 — résiliation demandée, accès MAINTENU jusqu'au terme. Ambre : ce
  // n'est ni un abonnement serein ni une perte d'accès — c'est un départ annoncé, et c'est
  // exactement le moment où une relance a encore un sens.
  canceling: 'bg-amber-100 text-amber-700',
}

function nameToColor(name: string): string {
  const colors = ['#4ECDC4', '#FF6B6B', '#6C5CE7', '#FF8E53', '#A8E6CF', '#B8B8FF']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

export function MemberDrawer({ member, onClose, onUpdated }: MemberDrawerProps) {
  const { t } = useTranslation()
  const tz = useGymTimezone()
  const addToast = useToastStore((s) => s.addToast)
  const { credits, creditsRemaining, giftedRemaining, purchasedRemaining, adjustments, payments, subscription, bookings, loading, adjustCredits, sellPlan } = useMemberDetail(member?.id ?? null)
  const { penalties, lifts, summary: discipline, loading: disciplineLoading } = useMemberDiscipline(member?.id ?? null)

  const [adjustOpen, setAdjustOpen] = useState(false)
  const [sellOpen, setSellOpen] = useState(false)
  const [identity, setIdentity] = useState({
    firstName: '', lastName: '', phone: '' as string | null,
    // GYM-224 — code du badge d'accès. Saisi ici, LU par le membre dans /profile.
    accessBadgeCode: null as string | null,
  })
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', accessBadgeCode: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // (Re)seed à l'ouverture / changement de membre.
  useEffect(() => {
    if (member) {
      setIdentity({
        firstName: member.firstName, lastName: member.lastName, phone: member.phone,
        accessBadgeCode: member.accessBadgeCode,
      })
      setEditing(false)
      setFormError(null)
    }
  }, [member])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    if (member) { document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey) }
  }, [member, onClose])

  function startEdit() {
    setForm({
      firstName: identity.firstName, lastName: identity.lastName, phone: identity.phone ?? '',
      accessBadgeCode: identity.accessBadgeCode ?? '',
    })
    setFormError(null)
    setEditing(true)
  }

  function fmtDate(iso: string | null, withTime = false): string {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('fr-BE', {
      timeZone: tz, day: '2-digit', month: 'short', year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    })
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!member || saving) return
    setFormError(null)
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setFormError(t('member_drawer.error_names_required'))
      return
    }
    setSaving(true)
    try {
      const { data, error } = await invokeEdge('admin-update-member', {
        body: {
          member_id: member.id,
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          phone: form.phone.trim(),
          // GYM-224 — chaîne vide transmise TELLE QUELLE : c'est l'Edge qui la convertit
          // en NULL (l'index unique partiel ne filtre que les NULL, pas les ''). Effacer
          // le champ doit donc pouvoir remonter jusqu'au serveur.
          access_badge_code: form.accessBadgeCode.trim(),
        },
      })
      if (error) {
        // GYM-219 — INVALID_PHONE / INVALID_FIRST_NAME désignent le champ fautif ;
        // « la sauvegarde a échoué » laissait chercher.
        //
        // GYM-224 — on lit le corps ENTIER (une seule fois, la Response n'est pas rejouable)
        // parce que BADGE_CODE_TAKEN y joint le PRÉNOM DU PORTEUR ACTUEL. C'est l'information
        // qui transforme « ce code est déjà pris » en un geste : savoir chez qui vérifier.
        const body = await extractErrorBody(error)
        setFormError(edgeErrorMessage(body.code, t, {
          name: identity.firstName,
          holder: body.holder_first_name,
        }))
        return
      }
      const updated = (data?.member ?? {}) as {
        first_name?: string; last_name?: string; phone?: string | null; access_badge_code?: string | null
      }
      const next = {
        firstName: updated.first_name ?? form.firstName.trim(),
        lastName: updated.last_name ?? form.lastName.trim(),
        phone: updated.phone ?? null,
        // `?? null` et non `?? form…` : le serveur fait autorité sur ce qu'il a réellement
        // stocké (chaîne vide normalisée en NULL, code trimé).
        accessBadgeCode: updated.access_badge_code ?? null,
      }
      setIdentity(next)
      onUpdated(next)
      setEditing(false)
      addToast(t('member_drawer.toast_saved'), 'success')
    } catch {
      setFormError(t('member_drawer.error_save'))
    } finally {
      setSaving(false)
    }
  }

  // GYM-214 — une suspension ÉCHUE n'est plus une suspension : comparer à maintenant,
  // ne jamais se contenter de « la colonne est renseignée ». Le cron d'expiration ne
  // repasse pas la colonne à NULL, une date passée y subsiste donc normalement.
  const isSuspended = !!member?.suspendedUntil && new Date(member.suspendedUntil).getTime() > Date.now()

  /**
   * GYM-222 — un abonnement qui fera refuser la vente par le serveur (SUBSCRIPTION_ACTIVE).
   * Sert UNIQUEMENT à prévenir le gérant avant qu'il encaisse ; l'autorité reste
   * admin-sell-plan, qui refait le test sur la base.
   *
   * Même prédicat que la garde serveur : statut ouvrant des droits ET terme non dépassé.
   * Un abonnement échu que le cron n'a pas encore passé 'expired' ne doit rien annoncer —
   * ce serait alarmer exactement au moment du réabonnement.
   *
   * GYM-147 — LE PRÉDICAT N'EST PLUS RECOPIÉ ICI. Il vient de lib/subscription.ts, partagé
   * avec la liste /members et aligné sur la garde serveur
   * (_shared/booking-guards.ts → hasActiveSubscription : statut ∈ {active, canceling} ET
   * terme non dépassé). Le « faux négatif assumé » que documentait ce commentaire — un
   * abonnement 'canceling' que useMemberDetail ne chargeait pas — n'existe plus : le statut
   * a rejoint LIVE_SUB_STATUSES. Une seule définition, trois écrans.
   */
  const hasBlockingSubscription = isSubscriptionActive(subscription?.status, subscription?.endsAt)

  /**
   * GYM-214 — Libellé en clair d'une sanction. La valeur brute de `penalties.type`
   * n'est JAMAIS montrée : les types historiques ('suspension_48h', 'suspension_2w')
   * comme tout type inconnu retombent sur un libellé générique.
   * La durée d'une suspension vient de expires_at − applied_at, pas du nom du type :
   * GYM-175 écrit 'suspension' et rend la durée configurable par salle.
   */
  function penaltyLabel(p: PenaltyEntry): string {
    if (p.kind === 'suspension') {
      if (!p.duration) return t('member_drawer.discipline.kind.suspension')
      const duration = t(`member_drawer.discipline.duration.${p.duration.unit}`, { count: p.duration.value })
      return t('member_drawer.discipline.kind.suspension_for', { duration })
    }
    return t(`member_drawer.discipline.kind.${p.kind}`)
  }

  // Levées qu'aucune pénalité chargée ne réclame — cf. le bloc « autres levées ».
  const attachedLiftIds = new Set(penalties.map((p) => p.lift?.id).filter(Boolean))
  const orphanLifts = lifts.filter((l) => !attachedLiftIds.has(l.id))

  const fullName = `${identity.firstName} ${identity.lastName}`.trim() || (member?.email ?? '')
  const initials = `${identity.firstName.charAt(0)}${identity.lastName.charAt(0)}`.toUpperCase() || '?'

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-200 ${
          member ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-card shadow-2xl transition-transform duration-300 ease-out ${
          member ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {member && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border p-5">
              <h2 className="font-display text-xl font-black tracking-tight text-dark">
                {t('member_drawer.title')}
              </h2>
              <button onClick={onClose} className="rounded-lg p-1.5 text-muted transition-colors hover:bg-dark/5">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {/* ── Identité ── */}
              <div className="flex items-center gap-4">
                {member.avatarUrl ? (
                  <img src={member.avatarUrl} alt={fullName} className="h-14 w-14 shrink-0 rounded-full object-cover" />
                ) : (
                  <div
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full font-display text-lg font-black text-white"
                    style={{ backgroundColor: nameToColor(fullName || '?') }}
                  >
                    {initials}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate font-display text-xl font-black tracking-tight text-dark">{fullName}</p>
                  <p className="truncate font-body text-sm text-muted">{member.email}</p>
                </div>
              </div>

              {/* ── GYM-214 — État disciplinaire, près de l'identité ──
                  GYM-204 a donné au gérant le pouvoir de lever une sanction sans rien lui
                  montrer de ce qui l'a causée. Cet indicateur est la première réponse :
                  discret quand tout va bien (rien du tout), net quand il y a à savoir.
                  Aucun « 0 absence » : une ligne vide n'apprend rien et ajoute du bruit. */}
              {isSuspended ? (
                <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-red-50 px-4 py-3">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <div className="min-w-0">
                    <p className="font-body text-sm font-semibold text-red-700">
                      {t('member_drawer.discipline.suspended_until', { date: fmtDate(member.suspendedUntil, true) })}
                    </p>
                    {member.noshowCount > 0 && (
                      <p className="font-body text-xs text-red-600/80">
                        {t('member_drawer.discipline.noshow_count', { count: member.noshowCount })}
                      </p>
                    )}
                  </div>
                </div>
              ) : member.noshowCount > 0 ? (
                /* Compteur sans suspension : un SIGNAL, pas une sanction — ton neutre. */
                <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-amber-50 px-4 py-3">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  <p className="font-body text-sm text-amber-700">
                    {t('member_drawer.discipline.noshow_count', { count: member.noshowCount })}
                  </p>
                </div>
              ) : null}

              {editing ? (
                <form onSubmit={handleSave} className="mt-5 flex flex-col gap-4">
                  {formError && <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{formError}</div>}
                  <div className="grid grid-cols-2 gap-3">
                    <Input label={t('member_drawer.first_name')} value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} required />
                    <Input label={t('member_drawer.last_name')} value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} required />
                  </div>
                  <Input label={t('member_drawer.phone')} type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder={t('member_drawer.phone_optional')} />
                  {/* GYM-224 — code du badge d'accès. Vider le champ RETIRE le badge
                      (l'Edge stocke NULL) : c'est le geste attendu quand un membre rend
                      son badge ou le perd. */}
                  <Input
                    label={t('member_drawer.badge_code')}
                    value={form.accessBadgeCode}
                    onChange={(e) => setForm((f) => ({ ...f, accessBadgeCode: e.target.value }))}
                    placeholder={t('member_drawer.badge_code_optional')}
                    autoComplete="off"
                  />
                  <p className="-mt-2 font-body text-xs text-muted">{t('member_drawer.badge_code_hint')}</p>
                  <div className="flex gap-3">
                    <Button type="button" variant="ghost" onClick={() => setEditing(false)} className="flex-1" disabled={saving}>
                      {t('common.cancel')}
                    </Button>
                    <Button type="submit" isLoading={saving} className="flex-1">
                      {t('common.save')}
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="mt-5 flex flex-col gap-3">
                    <Row Icon={Mail} label={t('member_drawer.email')} value={member.email} muted title={t('member_drawer.email_readonly')} />
                    <Row Icon={Phone} label={t('member_drawer.phone')} value={identity.phone || '—'} />
                    {identity.accessBadgeCode && (
                      <Row Icon={ScanLine} label={t('member_drawer.badge_code')} value={identity.accessBadgeCode} />
                    )}
                    <Row Icon={Globe} label={t('member_drawer.language')} value={(member.preferredLanguage ?? '—').toUpperCase()} />
                    <Row Icon={CalendarDays} label={t('member_drawer.member_since')} value={fmtDate(member.memberSince)} />
                  </div>
                  <Button variant="secondary" onClick={startEdit} className="mt-4 w-full">
                    <Pencil className="h-4 w-4" />
                    {t('member_drawer.edit')}
                  </Button>
                </>
              )}

              {/* ── Crédits ── */}
              <Section Icon={CreditCard} title={t('member_drawer.credits')}>
                <div className="rounded-xl border border-border p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="font-body text-sm text-muted">{t('member_drawer.credits_remaining')}</span>
                    <span className="font-display text-2xl font-black tracking-tight text-dark">{creditsRemaining}</span>
                  </div>
                  {/* GYM-182 — décomposition acheté / offert quand il y a des crédits offerts. */}
                  {giftedRemaining > 0 && (
                    <p className="mt-1 text-right font-body text-xs text-muted">
                      {t('member_drawer.credits_breakdown', { purchased: purchasedRemaining, gifted: giftedRemaining })}
                    </p>
                  )}
                  {credits.filter((c) => c.total > 0).length > 0 && (
                    <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
                      {credits.filter((c) => c.total > 0).map((c) => (
                        <div key={c.planId} className="flex justify-between font-body text-xs">
                          <span className="truncate text-dark">
                            {c.planId === MANUAL_GRANT_PLAN_ID ? t('member_drawer.credits_gifted_label') : c.planName}
                          </span>
                          <span className="text-muted">{t('member_drawer.credits_used_total', { used: c.used, total: c.total })}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* GYM-222 — LE geste quotidien de la salle : le gérant vient de lire le
                      solde juste au-dessus, c'est ici que la vente est naturelle. Action
                      PRIMAIRE, au-dessus de l'ajustement.

                      🔴 LA HIÉRARCHIE DES DEUX BOUTONS EST LE GARDE-FOU. Vendre produit une
                      ligne payments, une facture, de la TVA, du chiffre d'affaires ; offrir
                      (GYM-182) ne produit qu'un crédit. Mettre le second en avant, ou les
                      rendre équivalents, mènerait un gérant pressé à encaisser de l'argent
                      par le chemin qui ne le trace pas. */}
                  <Button className="mt-3 w-full" onClick={() => setSellOpen(true)}>
                    <ShoppingCart className="h-4 w-4" />
                    {t('member_drawer.sell.button')}
                  </Button>

                  {/* GYM-182 — bouton d'ajustement manuel (geste GRATUIT : parrainage,
                      compensation). Volontairement secondaire. */}
                  <Button variant="secondary" className="mt-2 w-full" onClick={() => setAdjustOpen(true)}>
                    <Gift className="h-4 w-4" />
                    {t('member_drawer.adjust.button')}
                  </Button>
                </div>

                {/* GYM-182 — historique des ajustements de crédits. */}
                {adjustments.length > 0 && (
                  <div className="mt-3 rounded-xl border border-border p-4">
                    <h4 className="mb-2 flex items-center gap-1.5 font-body text-xs font-semibold text-dark">
                      <History className="h-3.5 w-3.5 text-muted" />
                      {t('member_drawer.adjust.history_title')}
                    </h4>
                    <div className="flex flex-col gap-2">
                      {adjustments.map((a) => (
                        <div key={a.id} className="flex items-start justify-between gap-3 font-body text-xs">
                          <div className="min-w-0">
                            <p className="truncate text-dark">{a.reason}</p>
                            <p className="text-muted">{fmtDate(a.createdAt, true)} · {a.grantedByName}</p>
                          </div>
                          <span className={`shrink-0 font-semibold ${a.appliedDelta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {a.appliedDelta >= 0 ? '+' : ''}{a.appliedDelta}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Section>

              {/* ── GYM-222 — Paiements ──
                  L'argent encaissé ne se lisait QUE dans /revenus. Après une vente au
                  comptoir, le gérant n'avait aucune trace sur l'écran où il venait de la
                  faire — et rien ne distinguait, sur la fiche, une carte VENDUE d'un crédit
                  OFFERT. Ces lignes sont la preuve comptable du geste : montant, moyen de
                  paiement, numéro de facture. Aucune ligne → état vide honnête. */}
              <Section Icon={Receipt} title={t('member_drawer.payments.title')}>
                {loading ? (
                  <p className="font-body text-sm text-muted">{t('common.loading')}</p>
                ) : payments.length === 0 ? (
                  <p className="rounded-xl border border-border p-4 font-body text-sm text-muted">
                    {t('member_drawer.payments.empty')}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {payments.map((p) => (
                      <div key={p.id} className="flex items-start justify-between gap-3 rounded-xl border border-border px-4 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate font-body text-sm font-medium text-dark">{p.planName}</p>
                          <p className="font-body text-xs text-muted">
                            {fmtDate(p.at)}
                            {/* Libellés RÉUTILISÉS de /revenus (revenue.method_*) : le même
                                paiement doit se lire pareil sur les deux écrans. Seules
                                'cash' et 'card_terminal' y ont une entrée ; un paiement
                                Mollie garde son libellé brut plutôt qu'une traduction
                                inventée. */}
                            {p.method && <> · {p.method === 'cash' || p.method === 'card_terminal'
                              ? t(`revenue.method_${p.method}`)
                              : p.method}</>}
                            {p.invoiceNumber && <> · {p.invoiceNumber}</>}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-body text-sm font-bold text-dark">
                            {new Intl.NumberFormat('fr-BE', { style: 'currency', currency: p.currency }).format(p.amount)}
                          </p>
                          {/* Seul un statut NON encaissé est signalé : afficher « payé » sur
                              chaque ligne serait du bruit, mais un paiement resté en attente
                              ou remboursé change ce que le gérant doit en conclure. */}
                          {p.status !== 'paid' && (
                            <p className="font-body text-[11px] font-semibold text-amber-600">
                              {t(`revenue.status_${p.status}`, { defaultValue: p.status })}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* ── Abonnement ── */}
              <Section Icon={RefreshCcw} title={t('member_drawer.subscription')}>
                {subscription ? (
                  <div className="rounded-xl border border-border p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-body text-sm font-semibold text-dark">{subscription.planName}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SUB_BADGE[subscription.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {t(`member_drawer.sub_status.${subscription.status}`)}
                      </span>
                    </div>
                    <p className="mt-2 font-body text-xs text-muted">
                      {fmtDate(subscription.startsAt)} → {subscription.endsAt ? fmtDate(subscription.endsAt) : '∞'}
                    </p>
                  </div>
                ) : (
                  <p className="rounded-xl border border-border p-4 font-body text-sm text-muted">{t('member_drawer.no_subscription')}</p>
                )}
              </Section>

              {/* ── GYM-214 — Historique disciplinaire ──
                  Même forme que le journal d'ajustements de crédits (GYM-182) : une carte
                  bordée, des lignes date + motif + auteur. Rien en base → un état vide
                  honnête, pas un bloc fantôme. */}
              <Section Icon={ShieldAlert} title={t('member_drawer.discipline.title')}>
                {disciplineLoading ? (
                  <p className="font-body text-sm text-muted">{t('common.loading')}</p>
                ) : penalties.length === 0 && lifts.length === 0 ? (
                  <p className="rounded-xl border border-border p-4 font-body text-sm text-muted">
                    {t('member_drawer.discipline.empty')}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {penalties.map((p) => (
                      <div key={p.id} className="rounded-xl border border-border p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-body text-sm font-semibold text-dark">
                              {penaltyLabel(p)}
                            </p>
                            <p className="font-body text-xs text-muted">
                              {fmtDate(p.appliedAt, true)}
                              {p.activity && <> · {p.activity}</>}
                            </p>
                          </div>
                          {/* Origine : no-show et annulation tardive sont deux
                              comportements différents, jamais le même badge. */}
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${ORIGIN_BADGE[p.origin]}`}>
                            {t(`member_drawer.discipline.origin.${p.origin}`)}
                          </span>
                        </div>

                        {p.notes && (
                          <p className="mt-2 font-body text-xs text-muted">{p.notes}</p>
                        )}

                        {/* 🔴 Une pénalité levée garde son expires_at en base : sans ce
                            bandeau, l'écran la montrerait « en cours » alors que l'accès
                            a été rendu. */}
                        {p.lift ? (
                          <div className="mt-2 rounded-lg bg-green-50 px-3 py-2">
                            <p className="font-body text-xs font-semibold text-green-700">
                              {t('member_drawer.discipline.lifted_on', { date: fmtDate(p.lift.createdAt, true) })}
                            </p>
                            <p className="font-body text-xs text-green-700/80">
                              {p.lift.reason || '—'} · {p.lift.adminName}
                            </p>
                          </div>
                        ) : p.active ? (
                          <p className="mt-2 font-body text-xs font-semibold text-red-600">
                            {t('member_drawer.discipline.active_until', { date: fmtDate(p.expiresAt, true) })}
                          </p>
                        ) : null}
                      </div>
                    ))}

                    {/* Levées qu'aucune pénalité ne réclame : journal antérieur à la ligne
                        penalties la plus ancienne chargée, ou rapprochement impossible.
                        Les taire donnerait un historique incomplet. */}
                    {orphanLifts.length > 0 && (
                      <div className="rounded-xl border border-border p-4">
                        <h4 className="mb-2 flex items-center gap-1.5 font-body text-xs font-semibold text-dark">
                          <History className="h-3.5 w-3.5 text-muted" />
                          {t('member_drawer.discipline.other_lifts')}
                        </h4>
                        <div className="flex flex-col gap-2">
                          {orphanLifts.map((l) => (
                            <div key={l.id} className="font-body text-xs">
                              <p className="text-dark">{l.reason || '—'}</p>
                              <p className="text-muted">{fmtDate(l.createdAt, true)} · {l.adminName}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Compteur + échéance de remise à zéro. */}
                    {discipline && discipline.noshowCount > 0 && (
                      <div className="rounded-xl bg-dark/[0.03] px-4 py-3">
                        <p className="font-body text-xs font-semibold text-dark">
                          {t('member_drawer.discipline.noshow_count', { count: discipline.noshowCount })}
                        </p>
                        <p className="mt-0.5 font-body text-xs text-muted">
                          {isSuspended
                            ? t('member_drawer.discipline.reset_suspended')
                            : discipline.resetAt
                              ? t('member_drawer.discipline.reset_on', { date: fmtDate(discipline.resetAt.toISOString()) })
                              : t('member_drawer.discipline.reset_unknown')}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </Section>

              {/* ── Réservations récentes ── */}
              <Section Icon={CalendarDays} title={t('member_drawer.recent_bookings')}>
                {loading ? (
                  <p className="font-body text-sm text-muted">{t('common.loading')}</p>
                ) : bookings.length === 0 ? (
                  <p className="rounded-xl border border-border p-4 font-body text-sm text-muted">{t('member_drawer.no_bookings')}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {bookings.map((b) => (
                      <div key={b.id} className="flex items-center justify-between rounded-xl border border-border px-4 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate font-body text-sm font-medium text-dark">{b.activity}</p>
                          <p className="font-body text-xs text-muted">{fmtDate(b.startsAt, true)}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${BOOKING_BADGE[b.status] ?? 'bg-gray-100 text-gray-500'}`}>
                          {t(`member_drawer.booking_status.${b.status}`)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>

            {/* GYM-222 — modale de vente d'une formule au comptoir. */}
            <SellPlanModal
              open={sellOpen}
              onClose={() => setSellOpen(false)}
              memberName={fullName}
              currentRemaining={creditsRemaining}
              hasActiveSubscription={hasBlockingSubscription}
              onSell={sellPlan}
            />

            {/* GYM-182 — modale d'ajustement manuel de crédits. */}
            <AdjustCreditsModal
              open={adjustOpen}
              onClose={() => setAdjustOpen(false)}
              memberName={fullName}
              currentRemaining={creditsRemaining}
              giftedRemaining={giftedRemaining}
              onAdjust={adjustCredits}
            />
          </>
        )}
      </aside>
    </>
  )
}

function Row({ Icon, label, value, muted, title }: { Icon: typeof Mail; label: string; value: string; muted?: boolean; title?: string }) {
  return (
    <div className="flex items-center gap-3" title={title}>
      <Icon className="h-4 w-4 shrink-0 text-muted" />
      <span className="font-body text-xs text-muted">{label}</span>
      <span className={`ml-auto truncate font-body text-sm ${muted ? 'text-muted' : 'text-dark'}`}>{value}</span>
    </div>
  )
}

function Section({ Icon, title, children }: { Icon: typeof Mail; title: string; children: ReactNode }) {
  return (
    <div className="mt-6">
      <h3 className="mb-3 flex items-center gap-2 font-body text-sm font-semibold text-dark">
        <Icon className="h-4 w-4 text-muted" />
        {title}
      </h3>
      {children}
    </div>
  )
}
