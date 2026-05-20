import { useEffect, useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { CreditCard, TrendingUp, Users, Zap, Download } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'

type PaymentStatus = 'paid' | 'pending' | 'failed' | 'expired' | 'canceled'
type SubStatus = 'active' | 'canceling' | 'canceled' | 'completed'

interface PaymentStats {
  total_revenue: number
  total_this_month: number
  total_last_month: number
  growth_percent: number
  active_subscriptions: number
  total_members: number
  nexxia_fees: number
}

interface Payment {
  id: string
  member_name: string
  member_email: string
  plan_name: string
  plan_id: string | null
  amount: number
  status: PaymentStatus
  payment_method: string | null
  paid_at: string | null
  created_at: string
  invoice_number: string | null
}

interface Subscription {
  id: string
  member_name: string
  member_email: string
  plan_name: string
  plan_code: string | null
  amount: number
  status: SubStatus
  starts_at: string | null
  ends_at: string | null
  next_payment_at: string | null
  payments_count: number
  max_payments: number | null
}

type Tab = 'overview' | 'transactions' | 'subscriptions'

const FORMAT_DATE = (iso: string | null): string => {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: 'short', year: 'numeric' })
}

const FORMAT_DATE_SHORT = (iso: string | null): string => {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: 'short' })
}

const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  paid: { label: 'Payé', className: 'bg-green-100 text-green-700' },
  pending: { label: 'En cours', className: 'bg-amber-100 text-amber-700' },
  failed: { label: 'Échoué', className: 'bg-red-100 text-red-700' },
  expired: { label: 'Expiré', className: 'bg-gray-100 text-gray-500' },
  canceled: { label: 'Annulé', className: 'bg-gray-100 text-gray-500' },
}

const SUB_STATUS_STYLES: Record<string, { label: string; className: string }> = {
  active: { label: 'Actif', className: 'bg-green-100 text-green-700' },
  canceling: { label: 'Résilié', className: 'bg-orange-100 text-orange-700' },
  canceled: { label: 'Annulé', className: 'bg-gray-100 text-gray-500' },
  completed: { label: 'Terminé', className: 'bg-blue-100 text-blue-700' },
}

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_STYLES[status] ?? { label: status, className: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`inline-block rounded-full px-2 py-1 font-body text-xs font-semibold ${config.className}`}>
      {config.label}
    </span>
  )
}

function SubStatusBadge({ status }: { status: string }) {
  const config = SUB_STATUS_STYLES[status] ?? { label: status, className: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`inline-block rounded-full px-2 py-1 font-body text-xs font-semibold ${config.className}`}>
      {config.label}
    </span>
  )
}

interface KpiCardProps {
  label: string
  value: string
  subtitle?: string
  Icon: typeof CreditCard
  subtitleClass?: string
  dimmed?: boolean
}

function KpiCard({ label, value, subtitle, Icon, subtitleClass = 'text-muted', dimmed = false }: KpiCardProps) {
  return (
    <div className={`rounded-2xl border border-[#E8E6E0] bg-card p-6 ${dimmed ? 'opacity-60' : ''}`}>
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-dark" />
        <span className="font-body text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
      </div>
      <div className="font-display text-2xl font-black tracking-tight text-dark">{value}</div>
      {subtitle && <div className={`mt-1 font-body text-xs ${subtitleClass}`}>{subtitle}</div>}
    </div>
  )
}

export default function PaymentsPage() {
  const { t } = useTranslation()
  const gymId = useAuthStore((s) => s.gym_id)

  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [stats, setStats] = useState<PaymentStats | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<'7d' | '30d' | '90d' | 'all'>('30d')

  const loadData = useCallback(async () => {
    if (!gymId) return
    setIsLoading(true)

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString()

    const [totalRes, monthRes, lastMonthRes, subsCount, membersCount, paymentsRes, subsRes] = await Promise.all([
      supabase.from('payments').select('amount, nexxia_fee').eq('gym_id', gymId).eq('status', 'paid'),
      supabase.from('payments').select('amount').eq('gym_id', gymId).eq('status', 'paid').gte('paid_at', startOfMonth),
      supabase.from('payments').select('amount').eq('gym_id', gymId).eq('status', 'paid').gte('paid_at', startOfLastMonth).lte('paid_at', endOfLastMonth),
      supabase.from('member_subscriptions').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).in('status', ['active', 'canceling']),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('gym_id', gymId).eq('role', 'member'),
      supabase.from('payments')
        .select('id, plan_name, plan_id, amount, status, payment_method, paid_at, created_at, invoice_number, member:profiles!payments_member_id_fkey(first_name, last_name, email)')
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('member_subscriptions')
        .select('id, plan_name, plan_code, amount, status, starts_at, ends_at, next_payment_at, payments_count, max_payments, member:profiles!member_subscriptions_member_id_fkey(first_name, last_name, email)')
        .eq('gym_id', gymId)
        .order('starts_at', { ascending: false }),
    ])

    const totalRevenue = totalRes.data?.reduce((s, p) => s + Number(p.amount), 0) ?? 0
    const totalFees = totalRes.data?.reduce((s, p) => s + Number(p.nexxia_fee ?? 0), 0) ?? 0
    const thisMonth = monthRes.data?.reduce((s, p) => s + Number(p.amount), 0) ?? 0
    const lastMonth = lastMonthRes.data?.reduce((s, p) => s + Number(p.amount), 0) ?? 0
    const growth = lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : 0

    setStats({
      total_revenue: totalRevenue,
      total_this_month: thisMonth,
      total_last_month: lastMonth,
      growth_percent: growth,
      active_subscriptions: subsCount.count ?? 0,
      total_members: membersCount.count ?? 0,
      nexxia_fees: totalFees,
    })

    const mappedPayments: Payment[] = (paymentsRes.data ?? []).map((p) => {
      const member = p.member as unknown as { first_name?: string; last_name?: string; email?: string } | null
      const name = member ? `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() : ''
      return {
        id: p.id as string,
        member_name: name || 'Inconnu',
        member_email: member?.email ?? '',
        plan_name: (p.plan_name as string) ?? '—',
        plan_id: (p.plan_id as string | null) ?? null,
        amount: Number(p.amount),
        status: (p.status as PaymentStatus) ?? 'pending',
        payment_method: (p.payment_method as string | null) ?? null,
        paid_at: (p.paid_at as string | null) ?? null,
        created_at: (p.created_at as string) ?? '',
        invoice_number: (p.invoice_number as string | null) ?? null,
      }
    })
    setPayments(mappedPayments)

    const mappedSubs: Subscription[] = (subsRes.data ?? []).map((s) => {
      const member = s.member as unknown as { first_name?: string; last_name?: string; email?: string } | null
      const name = member ? `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() : ''
      return {
        id: s.id as string,
        member_name: name || 'Inconnu',
        member_email: member?.email ?? '',
        plan_name: (s.plan_name as string) ?? '—',
        plan_code: (s.plan_code as string | null) ?? null,
        amount: Number(s.amount ?? 0),
        status: (s.status as SubStatus) ?? 'active',
        starts_at: (s.starts_at as string | null) ?? null,
        ends_at: (s.ends_at as string | null) ?? null,
        next_payment_at: (s.next_payment_at as string | null) ?? null,
        payments_count: (s.payments_count as number) ?? 0,
        max_payments: (s.max_payments as number | null) ?? null,
      }
    })
    setSubscriptions(mappedSubs)

    setIsLoading(false)
  }, [gymId])

  useEffect(() => { loadData() }, [loadData])

  const filteredPayments = useMemo(() => {
    return payments.filter((p) => {
      const matchSearch = !searchQuery ||
        p.member_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.member_email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.plan_name.toLowerCase().includes(searchQuery.toLowerCase())
      const matchStatus = statusFilter === 'all' || p.status === statusFilter
      const matchDate = (() => {
        if (dateFilter === 'all') return true
        const days = dateFilter === '7d' ? 7 : dateFilter === '30d' ? 30 : 90
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - days)
        return new Date(p.created_at) >= cutoff
      })()
      return matchSearch && matchStatus && matchDate
    })
  }, [payments, searchQuery, statusFilter, dateFilter])

  const filteredTotalPaid = useMemo(
    () => filteredPayments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0),
    [filteredPayments],
  )

  const exportCSV = useCallback(() => {
    const headers = ['Date', 'Membre', 'Email', 'Plan', 'Montant (€)', 'Statut', 'Méthode', 'Facture']
    const rows = filteredPayments.map((p) => [
      new Date(p.created_at).toLocaleDateString('fr-BE'),
      p.member_name,
      p.member_email,
      p.plan_name,
      p.amount.toFixed(2),
      p.status,
      p.payment_method ?? '-',
      p.invoice_number ?? '-',
    ])
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `paiements-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filteredPayments])

  const TABS: Array<{ key: Tab; label: string }> = [
    { key: 'overview', label: t('payments.tab_overview') },
    { key: 'transactions', label: t('payments.tab_transactions') },
    { key: 'subscriptions', label: t('payments.tab_subscriptions') },
  ]

  const recentPaid = useMemo(
    () => payments.filter((p) => p.status === 'paid').slice(0, 5),
    [payments],
  )

  return (
    <DashboardLayout>
      <h1 className="font-display text-3xl font-black uppercase tracking-tight text-dark lg:text-4xl">
        {t('payments.title')}
      </h1>
      <p className="mt-1 font-body text-sm text-muted">{t('payments.subtitle')}</p>

      {/* Tabs */}
      <div className="mt-6 flex w-fit gap-1 rounded-xl bg-gray-100 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-lg px-4 py-2 font-body text-sm font-semibold transition-all ${
              activeTab === tab.key
                ? 'bg-white text-dark shadow-sm'
                : 'text-muted hover:text-dark'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent border-t-transparent" />
          </div>
        ) : activeTab === 'overview' && stats ? (
          <div>
            {/* KPIs */}
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label={t('payments.kpi_total_revenue')}
                value={`${stats.total_revenue.toFixed(2)}€`}
                subtitle={t('payments.kpi_since_start')}
                Icon={CreditCard}
              />
              <KpiCard
                label={t('payments.kpi_this_month')}
                value={`${stats.total_this_month.toFixed(2)}€`}
                subtitle={
                  stats.growth_percent > 0
                    ? `↑ +${stats.growth_percent.toFixed(0)}% ${t('payments.vs_last_month')}`
                    : stats.growth_percent < 0
                    ? `↓ ${stats.growth_percent.toFixed(0)}% ${t('payments.vs_last_month')}`
                    : t('payments.last_month_zero')
                }
                subtitleClass={
                  stats.growth_percent > 0 ? 'text-green-600' :
                  stats.growth_percent < 0 ? 'text-red-500' : 'text-muted'
                }
                Icon={TrendingUp}
              />
              <KpiCard
                label={t('payments.kpi_active_subscriptions')}
                value={String(stats.active_subscriptions)}
                subtitle={t('payments.kpi_total_members', { count: stats.total_members })}
                Icon={Users}
              />
              <KpiCard
                label={t('payments.kpi_nexxia_fees')}
                value={`${stats.nexxia_fees.toFixed(2)}€`}
                subtitle={t('payments.kpi_nexxia_fees_subtitle')}
                Icon={Zap}
                dimmed
              />
            </div>

            {/* Recent transactions */}
            <div className="overflow-hidden rounded-2xl border border-[#E8E6E0] bg-card shadow-sm">
              <div className="flex items-center justify-between border-b border-[#E8E6E0] px-6 py-4">
                <h2 className="font-display text-lg font-black uppercase tracking-tight text-dark">
                  {t('payments.recent_transactions')}
                </h2>
                <button
                  type="button"
                  onClick={() => setActiveTab('transactions')}
                  className="font-body text-sm text-muted hover:text-dark"
                >
                  {t('payments.see_all')} →
                </button>
              </div>
              {recentPaid.length === 0 ? (
                <div className="py-12 text-center font-body text-sm text-muted">
                  {t('payments.no_transactions')}
                </div>
              ) : (
                recentPaid.map((p) => (
                  <div key={p.id} className="flex items-center justify-between border-b border-[#F3F4F6] px-6 py-4 last:border-b-0 hover:bg-[#FAFAF7]">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 font-body text-sm">
                        {p.member_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-body text-sm font-medium text-dark">{p.member_name}</div>
                        <div className="font-body text-xs text-muted">{p.plan_name}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-body font-bold text-dark">{p.amount.toFixed(2)}€</span>
                      <StatusBadge status={p.status} />
                      <span className="font-body text-xs text-muted">{FORMAT_DATE_SHORT(p.paid_at ?? p.created_at)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : activeTab === 'transactions' ? (
          <div>
            {/* Filters bar */}
            <div className="mb-4 flex flex-wrap gap-3">
              <input
                type="text"
                placeholder={t('payments.search_placeholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="min-w-48 flex-1 rounded-xl border border-[#E8E6E0] bg-card px-4 py-2 font-body text-sm focus:border-dark focus:outline-none"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-xl border border-[#E8E6E0] bg-card px-4 py-2 font-body text-sm focus:border-dark focus:outline-none"
              >
                <option value="all">{t('payments.filter_all_status')}</option>
                <option value="paid">{t('payments.status_paid')}</option>
                <option value="pending">{t('payments.status_pending')}</option>
                <option value="failed">{t('payments.status_failed')}</option>
                <option value="canceled">{t('payments.status_canceled')}</option>
              </select>
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as '7d' | '30d' | '90d' | 'all')}
                className="rounded-xl border border-[#E8E6E0] bg-card px-4 py-2 font-body text-sm focus:border-dark focus:outline-none"
              >
                <option value="7d">{t('payments.filter_7d')}</option>
                <option value="30d">{t('payments.filter_30d')}</option>
                <option value="90d">{t('payments.filter_90d')}</option>
                <option value="all">{t('payments.filter_all_time')}</option>
              </select>
              <button
                type="button"
                onClick={exportCSV}
                className="flex items-center gap-2 rounded-xl bg-dark px-4 py-2 font-body text-sm font-semibold text-accent hover:bg-gray-800"
              >
                <Download className="h-4 w-4" />
                {t('payments.export_csv')}
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-[#E8E6E0] bg-card shadow-sm">
              <div className="grid grid-cols-[2fr_2fr_1fr_1fr_1fr] gap-4 border-b border-[#E8E6E0] bg-gray-50 px-6 py-3">
                {[
                  t('payments.col_member'),
                  t('payments.col_plan'),
                  t('payments.col_amount'),
                  t('payments.col_status'),
                  t('payments.col_date'),
                ].map((h) => (
                  <span key={h} className="font-body text-xs font-semibold uppercase tracking-wider text-muted">
                    {h}
                  </span>
                ))}
              </div>
              {filteredPayments.length === 0 ? (
                <div className="py-12 text-center font-body text-sm text-muted">
                  {t('payments.no_results')}
                </div>
              ) : (
                filteredPayments.map((p) => (
                  <div
                    key={p.id}
                    className="grid grid-cols-[2fr_2fr_1fr_1fr_1fr] gap-4 border-b border-[#F3F4F6] px-6 py-4 last:border-b-0 hover:bg-[#FAFAF7]"
                  >
                    <div>
                      <div className="font-body text-sm font-medium text-dark">{p.member_name}</div>
                      <div className="font-body text-xs text-muted">{p.member_email}</div>
                    </div>
                    <div className="self-center font-body text-sm text-dark">{p.plan_name}</div>
                    <div className="self-center font-body font-bold text-dark">{p.amount.toFixed(2)}€</div>
                    <div className="self-center"><StatusBadge status={p.status} /></div>
                    <div className="self-center font-body text-sm text-muted">
                      {FORMAT_DATE(p.paid_at ?? p.created_at)}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 text-right font-body text-sm text-muted">
              {t('payments.summary_count', { count: filteredPayments.length })} ·{' '}
              {t('payments.summary_total')}{' '}
              <strong className="text-dark">{filteredTotalPaid.toFixed(2)}€</strong>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[#E8E6E0] bg-card shadow-sm">
            <div className="grid grid-cols-[2fr_2fr_1fr_1fr_1fr] gap-4 border-b border-[#E8E6E0] bg-gray-50 px-6 py-3">
              {[
                t('payments.col_member'),
                t('payments.col_plan'),
                t('payments.col_amount_monthly'),
                t('payments.col_status'),
                t('payments.col_next_payment'),
              ].map((h) => (
                <span key={h} className="font-body text-xs font-semibold uppercase tracking-wider text-muted">
                  {h}
                </span>
              ))}
            </div>
            {subscriptions.length === 0 ? (
              <div className="py-12 text-center font-body text-sm text-muted">
                {t('payments.no_subscriptions')}
              </div>
            ) : (
              subscriptions.map((s) => (
                <div
                  key={s.id}
                  className="grid grid-cols-[2fr_2fr_1fr_1fr_1fr] gap-4 border-b border-[#F3F4F6] px-6 py-4 last:border-b-0 hover:bg-[#FAFAF7]"
                >
                  <div>
                    <div className="font-body text-sm font-medium text-dark">{s.member_name}</div>
                    <div className="font-body text-xs text-muted">{s.member_email}</div>
                  </div>
                  <div>
                    <div className="font-body text-sm text-dark">{s.plan_name}</div>
                    <div className="font-body text-xs text-muted">
                      {s.payments_count}/{s.max_payments ?? '?'} {t('payments.payments_count_label')}
                    </div>
                  </div>
                  <div className="self-center font-body font-bold text-dark">{s.amount.toFixed(2)}€</div>
                  <div className="self-center"><SubStatusBadge status={s.status} /></div>
                  <div className="self-center font-body text-sm text-muted">
                    {s.status === 'canceling' && s.ends_at
                      ? t('payments.ends_on', { date: FORMAT_DATE(s.ends_at) })
                      : FORMAT_DATE(s.next_payment_at)}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
