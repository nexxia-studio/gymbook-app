import { useEffect, useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { CreditCard, TrendingUp, RefreshCcw, AlertCircle, Download } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import { RevenueChart, type RevenueBucket } from '@/components/revenue/RevenueChart'

const GYM_TZ = 'Europe/Brussels'
type PaymentStatus = 'paid' | 'pending' | 'failed' | 'expired' | 'canceled'
type ChartMode = '12m' | '8w'
type TypeFilter = 'all' | 'one_time' | 'subscription'
type StatusFilter = 'all' | PaymentStatus | 'failed_pending'
type PeriodFilter = '7d' | '30d' | '90d' | 'all'

interface PaymentRow {
  id: string
  memberName: string
  memberEmail: string
  planName: string
  amount: number
  status: PaymentStatus
  method: string | null
  isOneTime: boolean
  invoiceNumber: string | null
  paidAt: string | null
  createdAt: string
  paidAtBxl: Date | null
  createdAtBxl: Date | null
}

// ── Heure locale gym (buckets en Europe/Brussels, pas UTC) ──
function toBxl(iso: string | null): Date | null {
  if (!iso) return null
  return new Date(new Date(iso).toLocaleString('en-US', { timeZone: GYM_TZ }))
}
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}`
}
function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = x.getDay()
  x.setDate(x.getDate() - (day === 0 ? 6 : day - 1))
  return x
}
function weekKey(d: Date): string {
  const m = mondayOf(d)
  return `${m.getFullYear()}-${m.getMonth()}-${m.getDate()}`
}

const STATUS_STYLES: Record<PaymentStatus, string> = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-500',
  canceled: 'bg-gray-100 text-gray-500',
}

const FMT_DATE = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const FMT_EUR = (n: number): string => `${n.toFixed(2)}€`

interface KpiCardProps {
  label: string
  value: string
  subtitle?: string
  subtitleClass?: string
  Icon: typeof CreditCard
  onClick?: () => void
  active?: boolean
}
function KpiCard({ label, value, subtitle, subtitleClass = 'text-muted', Icon, onClick, active }: KpiCardProps) {
  const base = `rounded-2xl border bg-card p-3 text-left transition-shadow sm:p-6 ${
    active ? 'border-red-400 ring-1 ring-red-200' : 'border-border'
  }`
  const content = (
    <>
      <div className="mb-3 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${active ? 'text-red-500' : 'text-dark'}`} />
        <span className="font-body text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
      </div>
      <div className="font-display text-lg font-black tracking-tight text-dark sm:text-2xl">{value}</div>
      {subtitle && <div className={`mt-1 font-body text-xs ${subtitleClass}`}>{subtitle}</div>}
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className={`${base} hover:shadow-md`}>{content}</button>
  ) : (
    <div className={base}>{content}</div>
  )
}

export default function Revenue() {
  const { t } = useTranslation()
  const gymId = useAuthStore((s) => s.gym_id)

  const [rows, setRows] = useState<PaymentRow[]>([])
  const [mrr, setMrr] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  const [chartMode, setChartMode] = useState<ChartMode>('12m')
  const [period, setPeriod] = useState<PeriodFilter>('30d')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const loadData = useCallback(async () => {
    if (!gymId) return
    setIsLoading(true)
    const [paymentsRes, subsRes] = await Promise.all([
      supabase.from('payments')
        .select('id, plan_name, amount, status, payment_method, credits_granted, paid_at, created_at, invoice_number, member:profiles!payments_member_id_fkey(first_name, last_name, email)')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false })
        .limit(1000),
      // MRR = somme des montants des abonnements actifs du gym
      supabase.from('member_subscriptions').select('amount').eq('gym_id', gymId).eq('status', 'active'),
    ])

    const mapped: PaymentRow[] = (paymentsRes.data ?? []).map((p) => {
      const member = p.member as unknown as { first_name?: string; last_name?: string; email?: string } | null
      const name = member ? `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() : ''
      return {
        id: p.id as string,
        memberName: name || t('revenue.unknown_member'),
        memberEmail: member?.email ?? '',
        planName: (p.plan_name as string) ?? '—',
        amount: Number(p.amount),
        status: (p.status as PaymentStatus) ?? 'pending',
        method: (p.payment_method as string | null) ?? null,
        // Critère abo/one_time : credits_granted > 0 = à l'unité ; sinon = abonnement.
        isOneTime: Number(p.credits_granted ?? 0) > 0,
        invoiceNumber: (p.invoice_number as string | null) ?? null,
        paidAt: (p.paid_at as string | null) ?? null,
        createdAt: (p.created_at as string) ?? '',
        paidAtBxl: toBxl((p.paid_at as string | null) ?? null),
        createdAtBxl: toBxl((p.created_at as string | null) ?? null),
      }
    })
    setRows(mapped)
    setMrr((subsRes.data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0))
    setIsLoading(false)
  }, [gymId, t])

  useEffect(() => { loadData() }, [loadData])

  // ── KPIs (mois en cours en heure locale gym) ──
  const kpis = useMemo(() => {
    const nowB = new Date(new Date().toLocaleString('en-US', { timeZone: GYM_TZ }))
    const curKey = monthKey(nowB)
    const prevKey = monthKey(new Date(nowB.getFullYear(), nowB.getMonth() - 1, 1))
    let thisMonth = 0, lastMonth = 0, failedPending = 0
    for (const r of rows) {
      if (r.status === 'paid' && r.paidAtBxl) {
        const k = monthKey(r.paidAtBxl)
        if (k === curKey) thisMonth += r.amount
        else if (k === prevKey) lastMonth += r.amount
      }
      if (r.status === 'failed' || r.status === 'pending') {
        const b = r.paidAtBxl ?? r.createdAtBxl
        if (b && monthKey(b) === curKey) failedPending++
      }
    }
    const growth = lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : thisMonth > 0 ? 100 : 0
    return { thisMonth, lastMonth, growth, failedPending }
  }, [rows])

  // ── Buckets chart (heure locale gym) ──
  const buckets = useMemo<RevenueBucket[]>(() => {
    const nowB = new Date(new Date().toLocaleString('en-US', { timeZone: GYM_TZ }))
    const defs: { key: string; label: string }[] = []
    if (chartMode === '12m') {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(nowB.getFullYear(), nowB.getMonth() - i, 1)
        defs.push({ key: monthKey(d), label: d.toLocaleDateString(undefined, { month: 'short' }) })
      }
    } else {
      for (let i = 7; i >= 0; i--) {
        const m = mondayOf(new Date(nowB.getFullYear(), nowB.getMonth(), nowB.getDate() - i * 7))
        defs.push({
          key: `${m.getFullYear()}-${m.getMonth()}-${m.getDate()}`,
          label: `${String(m.getDate()).padStart(2, '0')}/${String(m.getMonth() + 1).padStart(2, '0')}`,
        })
      }
    }
    const acc = new Map(defs.map((d) => [d.key, { oneTime: 0, subscription: 0 }]))
    for (const r of rows) {
      if (r.status !== 'paid' || !r.paidAtBxl) continue
      const k = chartMode === '12m' ? monthKey(r.paidAtBxl) : weekKey(r.paidAtBxl)
      const b = acc.get(k)
      if (!b) continue
      if (r.isOneTime) b.oneTime += r.amount
      else b.subscription += r.amount
    }
    return defs.map((d) => ({ label: d.label, oneTime: acc.get(d.key)!.oneTime, subscription: acc.get(d.key)!.subscription }))
  }, [rows, chartMode])

  // ── Liste filtrée ──
  const filtered = useMemo(() => {
    const cutoff = (() => {
      if (period === 'all') return null
      const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
      const c = new Date(); c.setDate(c.getDate() - days); return c
    })()
    return rows.filter((r) => {
      if (cutoff && new Date(r.createdAt) < cutoff) return false
      if (typeFilter === 'one_time' && !r.isOneTime) return false
      if (typeFilter === 'subscription' && r.isOneTime) return false
      if (statusFilter === 'failed_pending') return r.status === 'failed' || r.status === 'pending'
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      return true
    })
  }, [rows, period, typeFilter, statusFilter])

  const filteredPaidTotal = useMemo(
    () => filtered.filter((r) => r.status === 'paid').reduce((s, r) => s + r.amount, 0),
    [filtered],
  )

  const exportCSV = useCallback(() => {
    const headers = ['Date', 'Membre', 'Email', 'Formule', 'Type', 'Méthode', 'Montant (€)', 'Statut', 'Facture']
    const lines = filtered.map((r) => [
      new Date(r.createdAt).toLocaleDateString('fr-BE'),
      r.memberName, r.memberEmail, r.planName,
      r.isOneTime ? 'À l\'unité' : 'Abonnement',
      r.method ?? '-', r.amount.toFixed(2), r.status, r.invoiceNumber ?? '-',
    ])
    const csv = [headers, ...lines].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `revenus-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filtered])

  const selectClass = 'rounded-xl border border-border bg-card px-3 py-2 font-body text-sm focus:border-dark focus:outline-none'

  return (
    <DashboardLayout>
      <h1 className="font-display text-3xl font-black uppercase tracking-tight text-dark lg:text-4xl">
        {t('revenue.title')}
      </h1>
      <p className="mt-1 font-body text-sm text-muted">{t('revenue.subtitle')}</p>

      {isLoading ? (
        <div className="mt-8 flex h-64 items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent border-t-transparent" />
        </div>
      ) : (
        <>
          {/* KPIs — grille Bento (2 colonnes dès le mobile, cf. /plans) */}
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            <KpiCard
              label={t('revenue.kpi_month')}
              value={FMT_EUR(kpis.thisMonth)}
              subtitle={t('revenue.kpi_month_sub')}
              Icon={CreditCard}
            />
            <KpiCard
              label={t('revenue.kpi_growth')}
              value={`${kpis.growth > 0 ? '+' : ''}${kpis.growth.toFixed(0)}%`}
              subtitle={t('revenue.kpi_growth_sub')}
              subtitleClass={kpis.growth > 0 ? 'text-green-600' : kpis.growth < 0 ? 'text-red-500' : 'text-muted'}
              Icon={TrendingUp}
            />
            <KpiCard
              label={t('revenue.kpi_mrr')}
              value={FMT_EUR(mrr)}
              subtitle={t('revenue.kpi_mrr_sub')}
              Icon={RefreshCcw}
            />
            <KpiCard
              label={t('revenue.kpi_unpaid')}
              value={String(kpis.failedPending)}
              subtitle={t('revenue.kpi_unpaid_sub')}
              subtitleClass={kpis.failedPending > 0 ? 'text-red-500' : 'text-muted'}
              Icon={AlertCircle}
              active={statusFilter === 'failed_pending'}
              onClick={() => {
                // Toggle : 1er clic préfiltre impayés, 2e clic (carte active) remet le statut à "tous".
                if (statusFilter === 'failed_pending') setStatusFilter('all')
                else { setStatusFilter('failed_pending'); setPeriod('all') }
              }}
            />
          </div>

          {/* Chart CA empilé */}
          <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-black uppercase tracking-tight text-dark">
                {t('revenue.chart_title')}
              </h2>
              <div className="flex gap-1 rounded-xl bg-dark/5 p-1">
                {(['12m', '8w'] as ChartMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setChartMode(m)}
                    className={`rounded-lg px-3 py-1.5 font-body text-xs font-semibold transition-all ${
                      chartMode === m ? 'bg-card text-dark shadow-sm' : 'text-muted hover:text-dark'
                    }`}
                  >
                    {t(`revenue.chart_mode_${m}`)}
                  </button>
                ))}
              </div>
            </div>
            <RevenueChart data={buckets} />
          </div>

          {/* Liste des paiements fusionnée */}
          <div className="mt-6">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <select value={period} onChange={(e) => setPeriod(e.target.value as PeriodFilter)} className={selectClass}>
                <option value="7d">{t('revenue.period_7d')}</option>
                <option value="30d">{t('revenue.period_30d')}</option>
                <option value="90d">{t('revenue.period_90d')}</option>
                <option value="all">{t('revenue.period_all')}</option>
              </select>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeFilter)} className={selectClass}>
                <option value="all">{t('revenue.type_all')}</option>
                <option value="one_time">{t('revenue.type_one_time')}</option>
                <option value="subscription">{t('revenue.type_subscription')}</option>
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className={selectClass}>
                <option value="all">{t('revenue.status_all')}</option>
                <option value="paid">{t('revenue.status_paid')}</option>
                <option value="pending">{t('revenue.status_pending')}</option>
                <option value="failed">{t('revenue.status_failed')}</option>
                <option value="expired">{t('revenue.status_expired')}</option>
                <option value="canceled">{t('revenue.status_canceled')}</option>
                <option value="failed_pending">{t('revenue.status_failed_pending')}</option>
              </select>
              <button
                type="button"
                onClick={exportCSV}
                disabled={filtered.length === 0}
                className="ml-auto flex items-center gap-2 rounded-xl bg-dark px-4 py-2 font-body text-sm font-semibold text-accent transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                {t('revenue.export_csv')}
              </button>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <div className="grid grid-cols-[1.5fr_1.5fr_0.9fr_1.1fr] sm:min-w-[720px] sm:grid-cols-[1.4fr_1.6fr_0.9fr_0.9fr_0.9fr_1fr] gap-3 border-b border-border bg-dark/[0.03] px-5 py-3">
                {[
                  t('revenue.col_member'), t('revenue.col_plan'), t('revenue.col_type'),
                  t('revenue.col_method'), t('revenue.col_amount'), t('revenue.col_status_date'),
                ].map((h, i) => (
                  // type (i=2) et méthode (i=3) masqués < sm pour tenir à 375px sans scroll.
                  <span key={h} className={`font-body text-xs font-semibold uppercase tracking-wider text-muted ${i === 2 || i === 3 ? 'hidden sm:block' : ''}`}>{h}</span>
                ))}
              </div>
              {filtered.length === 0 ? (
                <div className="py-14 text-center font-body text-sm text-muted">{t('revenue.empty_list')}</div>
              ) : (
                filtered.map((r) => (
                  <div key={r.id} className="grid grid-cols-[1.5fr_1.5fr_0.9fr_1.1fr] sm:min-w-[720px] sm:grid-cols-[1.4fr_1.6fr_0.9fr_0.9fr_0.9fr_1fr] gap-3 border-b border-border px-5 py-3.5 last:border-b-0 hover:bg-dark/[0.02]">
                    <div className="min-w-0">
                      <div className="truncate font-body text-sm font-medium text-dark">{r.memberName}</div>
                      <div className="truncate font-body text-xs text-muted">{r.memberEmail}</div>
                    </div>
                    <div className="min-w-0 self-center">
                      <div className="truncate font-body text-sm text-dark">{r.planName}</div>
                      {r.invoiceNumber && <div className="hidden truncate font-body text-[11px] text-muted sm:block">{r.invoiceNumber}</div>}
                    </div>
                    <div className="hidden self-center sm:block">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.isOneTime ? 'bg-dark/10 text-dark' : 'bg-accent/20 text-accent-dim'}`}>
                        {r.isOneTime ? t('revenue.type_one_time') : t('revenue.type_subscription')}
                      </span>
                    </div>
                    <div className="hidden self-center font-body text-sm text-muted sm:block">{r.method ?? '—'}</div>
                    <div className="self-center font-body text-sm font-bold text-dark">{FMT_EUR(r.amount)}</div>
                    <div className="flex flex-col gap-1 self-center">
                      <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[r.status]}`}>
                        {t(`revenue.status_${r.status}`)}
                      </span>
                      <span className="font-body text-[11px] text-muted">{FMT_DATE(r.paidAt ?? r.createdAt)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-3 text-right font-body text-sm text-muted">
              {t('revenue.summary_count', { count: filtered.length })} · {t('revenue.summary_total')}{' '}
              <strong className="text-dark">{FMT_EUR(filteredPaidTotal)}</strong>
            </div>
          </div>
        </>
      )}
    </DashboardLayout>
  )
}
