import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Megaphone, Lock, PartyPopper, AlertTriangle, MessageSquare, Send, Users, Bell, Mail, Eye } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { useAuthStore } from '@/stores/useAuthStore'
import { useGymStore } from '@/stores/useGymStore'
import { useToastStore } from '@/hooks/useToast'
import { supabase } from '@/lib/supabase'

type Template = 'info' | 'closure' | 'promo' | 'cancellation' | 'custom'
type Segment = 'all' | 'subscribers' | 'drop_in' | 'present_today'

interface HistoryRow {
  id: string
  title: string
  body: string
  segment: string
  template: string
  send_push: boolean
  send_email: boolean
  status: string
  sent_at: string | null
  recipient_count: number | null
  created_at: string
}

const TEMPLATE_META: Record<Template, { icon: typeof Megaphone; emoji: string }> = {
  info: { icon: Megaphone, emoji: '📢' },
  closure: { icon: Lock, emoji: '🔒' },
  promo: { icon: PartyPopper, emoji: '🎉' },
  cancellation: { icon: AlertTriangle, emoji: '⚠️' },
  custom: { icon: MessageSquare, emoji: '💬' },
}

const TEMPLATES: Template[] = ['info', 'closure', 'promo', 'cancellation', 'custom']
const SEGMENTS: Segment[] = ['all', 'subscribers', 'drop_in', 'present_today']

export default function Communications() {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const gymId = useAuthStore((s) => s.gym_id)
  const user = useAuthStore((s) => s.user)
  const gymName = useGymStore((s) => s.gym?.name) ?? 'Viniz'

  const [template, setTemplate] = useState<Template>('info')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [segment, setSegment] = useState<Segment>('all')
  const [sendPush, setSendPush] = useState(true)
  const [sendEmail, setSendEmail] = useState(false)
  const [recipientCount, setRecipientCount] = useState<number | null>(null)
  const [isSending, setIsSending] = useState(false)

  const [history, setHistory] = useState<HistoryRow[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)

  // Pre-fill title when template changes (only if user hasn't typed a custom title)
  useEffect(() => {
    setTitle(t(`communications.templates.${template}.title`))
  }, [template, t])

  // Live recipient count when segment changes
  useEffect(() => {
    if (!gymId) return
    let cancelled = false
    const run = async () => {
      const { data, error } = await supabase
        .rpc('get_communication_recipients', { p_gym_id: gymId, p_segment: segment })
      if (cancelled) return
      if (error) {
        setRecipientCount(null)
        return
      }
      setRecipientCount(data?.length ?? 0)
    }
    run()
    return () => { cancelled = true }
  }, [gymId, segment])

  const loadHistory = async () => {
    if (!gymId) return
    setIsLoadingHistory(true)
    const { data } = await supabase
      .from('gym_communications')
      .select('id, title, body, segment, template, send_push, send_email, status, sent_at, recipient_count, created_at')
      .eq('gym_id', gymId)
      .order('created_at', { ascending: false })
      .limit(50)
    setHistory((data ?? []) as HistoryRow[])
    setIsLoadingHistory(false)
  }

  useEffect(() => { loadHistory() }, [gymId]) // eslint-disable-line react-hooks/exhaustive-deps

  const canSend = useMemo(() => {
    return title.trim().length > 0 && body.trim().length > 0 && (sendPush || sendEmail) && !!gymId
  }, [title, body, sendPush, sendEmail, gymId])

  const handleSend = async () => {
    if (!canSend || !gymId || !user) return
    if (!confirm(t('communications.confirm_send', { count: recipientCount ?? 0 }))) return

    setIsSending(true)
    try {
      // 1. Create draft row
      const { data: draft, error: draftErr } = await supabase
        .from('gym_communications')
        .insert({
          gym_id: gymId,
          created_by: user.id,
          title: title.trim(),
          body: body.trim(),
          segment,
          template,
          send_push: sendPush,
          send_email: sendEmail,
          status: 'draft',
        })
        .select('id')
        .single()

      if (draftErr || !draft) {
        addToast(draftErr?.message ?? t('communications.errors.create_failed'), 'error')
        setIsSending(false)
        return
      }

      // 2. Trigger send-communication Edge Function
      const { data: result, error: fnErr } = await supabase.functions.invoke('send-communication', {
        body: { communication_id: draft.id },
      })

      if (fnErr) {
        addToast(fnErr.message, 'error')
      } else {
        addToast(t('communications.sent_success', {
          push: result?.push_sent ?? 0,
          email: result?.email_sent ?? 0,
          total: result?.recipient_count ?? 0,
        }), 'success')
        setTitle(t(`communications.templates.${template}.title`))
        setBody('')
        await loadHistory()
      }
    } catch (e) {
      addToast((e as Error).message, 'error')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-black tracking-tight text-dark">
            {t('communications.title')}
          </h1>
          <p className="mt-1 font-body text-sm text-muted">{t('communications.subtitle')}</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Composer + Preview */}
          <div className="space-y-6 lg:col-span-2">
            {/* Section 1 — Composer */}
            <section className="rounded-2xl border border-border bg-card p-6">
              <h2 className="mb-4 font-display text-lg font-black tracking-tight text-dark">
                {t('communications.composer')}
              </h2>

              {/* Template cards */}
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {TEMPLATES.map((tpl) => {
                  const meta = TEMPLATE_META[tpl]
                  const Icon = meta.icon
                  const isActive = template === tpl
                  return (
                    <button
                      key={tpl}
                      type="button"
                      onClick={() => setTemplate(tpl)}
                      className={`flex flex-col items-center gap-2 rounded-xl border p-3 transition ${
                        isActive
                          ? 'border-accent-dim bg-accent-dim/10'
                          : 'border-border bg-background hover:border-muted'
                      }`}
                    >
                      <Icon className={`h-5 w-5 ${isActive ? 'text-dark' : 'text-muted'}`} />
                      <span className={`text-center font-body text-xs ${isActive ? 'font-semibold text-dark' : 'text-muted'}`}>
                        {t(`communications.templates.${tpl}.label`)}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Title */}
              <label className="mb-1 block font-body text-xs font-medium text-muted">
                {t('communications.fields.title')}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mb-3 w-full rounded-xl border border-border bg-background px-3 py-2 font-body text-sm text-dark outline-none focus:border-accent-dim"
              />

              {/* Body */}
              <label className="mb-1 block font-body text-xs font-medium text-muted">
                {t('communications.fields.body')}
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t(`communications.templates.${template}.placeholder`)}
                rows={6}
                className="mb-3 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 font-body text-sm text-dark outline-none focus:border-accent-dim"
              />

              {/* Segment */}
              <label className="mb-1 block font-body text-xs font-medium text-muted">
                {t('communications.fields.segment')}
              </label>
              <select
                value={segment}
                onChange={(e) => setSegment(e.target.value as Segment)}
                className="mb-3 w-full rounded-xl border border-border bg-background px-3 py-2 font-body text-sm text-dark outline-none focus:border-accent-dim"
              >
                {SEGMENTS.map((seg) => (
                  <option key={seg} value={seg}>
                    {t(`communications.segments.${seg}`)}
                  </option>
                ))}
              </select>

              {/* Channel toggles */}
              <div className="mb-4 flex flex-col gap-2 sm:flex-row">
                <label className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendPush}
                    onChange={(e) => setSendPush(e.target.checked)}
                    className="h-4 w-4 accent-accent"
                  />
                  <Bell className="h-4 w-4 text-muted" />
                  <span className="font-body text-sm text-dark">{t('communications.channels.push')}</span>
                </label>
                <label className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendEmail}
                    onChange={(e) => setSendEmail(e.target.checked)}
                    className="h-4 w-4 accent-accent"
                  />
                  <Mail className="h-4 w-4 text-muted" />
                  <span className="font-body text-sm text-dark">{t('communications.channels.email')}</span>
                </label>
              </div>

              {/* TODO GYM-54 : SMS + WhatsApp */}

              {/* Recipient count + send */}
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 font-body text-sm text-muted">
                  <Users className="h-4 w-4" />
                  <span>
                    {recipientCount === null
                      ? t('communications.recipients_loading')
                      : t('communications.recipients_count', { count: recipientCount })}
                  </span>
                </div>
                <button
                  onClick={handleSend}
                  disabled={!canSend || isSending || (recipientCount ?? 0) === 0}
                  className="flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-2.5 font-body font-bold text-[#17102E] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-light disabled:text-primary"
                >
                  <Send className="h-4 w-4" />
                  {isSending ? t('communications.sending') : t('communications.send')}
                </button>
              </div>
            </section>

            {/* Section 3 — History */}
            <section className="rounded-2xl border border-border bg-card p-6">
              <h2 className="mb-4 font-display text-lg font-black tracking-tight text-dark">
                {t('communications.history')}
              </h2>
              {isLoadingHistory ? (
                <div className="py-8 text-center font-body text-sm text-muted">{t('common.loading')}</div>
              ) : history.length === 0 ? (
                <div className="py-8 text-center font-body text-sm text-muted">{t('communications.history_empty')}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="px-2 py-2 text-left font-body text-xs font-semibold uppercase text-muted">{t('communications.table.date')}</th>
                        <th className="px-2 py-2 text-left font-body text-xs font-semibold uppercase text-muted">{t('communications.table.title')}</th>
                        <th className="hidden px-2 py-2 text-left font-body text-xs font-semibold uppercase text-muted sm:table-cell">{t('communications.table.segment')}</th>
                        <th className="hidden px-2 py-2 text-center font-body text-xs font-semibold uppercase text-muted md:table-cell">{t('communications.table.channels')}</th>
                        <th className="px-2 py-2 text-center font-body text-xs font-semibold uppercase text-muted">{t('communications.table.recipients')}</th>
                        <th className="px-2 py-2 text-right font-body text-xs font-semibold uppercase text-muted">{t('communications.table.status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((row) => (
                        <tr key={row.id} className="border-b border-border">
                          <td className="px-2 py-3 font-body text-xs text-muted">
                            {new Date(row.created_at).toLocaleDateString('fr-BE', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </td>
                          <td className="px-2 py-3 font-body text-sm font-medium text-dark">
                            {TEMPLATE_META[(row.template as Template) ?? 'custom'].emoji} {row.title}
                          </td>
                          <td className="hidden px-2 py-3 font-body text-xs text-muted sm:table-cell">
                            {t(`communications.segments.${row.segment}`, { defaultValue: row.segment })}
                          </td>
                          <td className="hidden px-2 py-3 text-center md:table-cell">
                            <div className="flex items-center justify-center gap-2">
                              {row.send_push && <Bell className="h-3 w-3 text-muted" />}
                              {row.send_email && <Mail className="h-3 w-3 text-muted" />}
                            </div>
                          </td>
                          <td className="px-2 py-3 text-center font-body text-sm text-dark">
                            {row.recipient_count ?? '—'}
                          </td>
                          <td className="px-2 py-3 text-right">
                            <StatusBadge status={row.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {/* Section 2 — Preview */}
          <aside className="lg:col-span-1">
            <section className="sticky top-6 rounded-2xl border border-border bg-card p-6">
              <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-black tracking-tight text-dark">
                <Eye className="h-4 w-4" />
                {t('communications.preview')}
              </h2>

              {/* Phone-style mockup */}
              <div className="rounded-2xl bg-dark p-3">
                <div className="rounded-xl bg-white px-3 py-3 shadow-sm">
                  <div className="mb-1 flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-xs font-bold text-[#17102E]">{gymName.charAt(0).toUpperCase()}</div>
                    <span className="font-body text-[11px] font-semibold uppercase tracking-wide text-muted">{gymName}</span>
                    <span className="ml-auto font-body text-[10px] text-muted">{t('communications.preview_now')}</span>
                  </div>
                  <p className="font-body text-sm font-semibold text-dark">
                    {title || t('communications.preview_title_placeholder')}
                  </p>
                  <p className="mt-0.5 font-body text-xs text-muted whitespace-pre-wrap">
                    {body || t('communications.preview_body_placeholder')}
                  </p>
                </div>
              </div>

              <p className="mt-4 font-body text-xs text-muted">
                {t('communications.preview_hint')}
              </p>
            </section>
          </aside>
        </div>
      </div>
    </DashboardLayout>
  )
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  const cls = status === 'sent'
    ? 'bg-green-500/10 text-green-600'
    : status === 'sending'
      ? 'bg-orange-500/10 text-orange-600'
      : status === 'failed'
        ? 'bg-red-500/10 text-red-600'
        : 'bg-muted/10 text-muted'
  return (
    <span className={`rounded-md px-2 py-0.5 font-body text-[10px] font-semibold ${cls}`}>
      {t(`communications.status.${status}`, { defaultValue: status })}
    </span>
  )
}
