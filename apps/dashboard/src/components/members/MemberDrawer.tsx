// GYM-129 — Drawer fiche membre (/members). Identité (édition prénom/nom/téléphone
// via admin-update-member), crédits, abonnement, 5 dernières réservations. Lectures
// directes (RLS gym_admin) ; email non modifiable (hors périmètre v1).
import { useState, useEffect, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Pencil, Mail, Phone, Globe, CalendarDays, CreditCard, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { supabase } from '@/lib/supabase'
import { useToastStore } from '@/hooks/useToast'
import { useGymTimezone } from '@/hooks/useGymTimezone'
import { useMemberDetail } from '@/hooks/useMemberDetail'
import type { Member } from '@/hooks/useMembers'

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
}

const SUB_BADGE: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  suspended: 'bg-red-100 text-red-700',
  // GYM-151 — engagement arrivé à son terme : état neutre (ni positif « actif », ni rouge).
  completed: 'bg-gray-200 text-gray-700',
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
  const { credits, creditsRemaining, subscription, bookings, loading } = useMemberDetail(member?.id ?? null)

  const [identity, setIdentity] = useState({ firstName: '', lastName: '', phone: '' as string | null })
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // (Re)seed à l'ouverture / changement de membre.
  useEffect(() => {
    if (member) {
      setIdentity({ firstName: member.firstName, lastName: member.lastName, phone: member.phone })
      setEditing(false)
      setFormError(null)
    }
  }, [member])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    if (member) { document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey) }
  }, [member, onClose])

  function startEdit() {
    setForm({ firstName: identity.firstName, lastName: identity.lastName, phone: identity.phone ?? '' })
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
      const { data, error } = await supabase.functions.invoke('admin-update-member', {
        body: {
          member_id: member.id,
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          phone: form.phone.trim(),
        },
      })
      if (error) {
        setFormError(t('member_drawer.error_save'))
        return
      }
      const updated = (data?.member ?? {}) as { first_name?: string; last_name?: string; phone?: string | null }
      const next = {
        firstName: updated.first_name ?? form.firstName.trim(),
        lastName: updated.last_name ?? form.lastName.trim(),
        phone: updated.phone ?? null,
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

              {editing ? (
                <form onSubmit={handleSave} className="mt-5 flex flex-col gap-4">
                  {formError && <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{formError}</div>}
                  <div className="grid grid-cols-2 gap-3">
                    <Input label={t('member_drawer.first_name')} value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} required />
                    <Input label={t('member_drawer.last_name')} value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} required />
                  </div>
                  <Input label={t('member_drawer.phone')} type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder={t('member_drawer.phone_optional')} />
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
                  {credits.filter((c) => c.total > 0).length > 0 && (
                    <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
                      {credits.filter((c) => c.total > 0).map((c) => (
                        <div key={c.planId} className="flex justify-between font-body text-xs">
                          <span className="truncate text-dark">{c.planName}</span>
                          <span className="text-muted">{t('member_drawer.credits_used_total', { used: c.used, total: c.total })}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
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
