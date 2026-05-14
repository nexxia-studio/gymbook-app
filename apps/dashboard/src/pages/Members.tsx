import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, ShieldOff, Bell, MoreVertical } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Skeleton } from '@/components/ui/Skeleton'
import { useMembers, type Member } from '@/hooks/useMembers'
import { useGymAdminActions } from '@/hooks/useGymAdminActions'
import { useToastStore } from '@/hooks/useToast'

function nameToColor(name: string): string {
  const colors = ['#4ECDC4', '#FF6B6B', '#6C5CE7', '#FF8E53', '#A8E6CF', '#B8B8FF']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

function MemberRow({ member, onLiftSuspension, onSendPush }: {
  member: Member
  onLiftSuspension: () => void
  onSendPush: () => void
}) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const fullName = `${member.firstName} ${member.lastName}`.trim()
  const initials = `${member.firstName.charAt(0)}${member.lastName.charAt(0)}`.toUpperCase()
  const isSuspended = member.suspendedUntil && new Date(member.suspendedUntil) > new Date()

  return (
    <tr className="border-b border-border transition-colors hover:bg-dark/[0.02]">
      {/* Avatar + name */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-body text-xs font-bold text-white"
            style={{ backgroundColor: nameToColor(fullName) }}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate font-body text-sm font-medium text-dark">{fullName || member.email}</p>
            <p className="truncate font-body text-xs text-muted">{member.email}</p>
          </div>
        </div>
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <span className={`rounded-lg px-2 py-0.5 font-body text-[10px] font-semibold ${
          isSuspended
            ? 'bg-red-50 text-red-500'
            : 'bg-green-500/10 text-green-600'
        }`}>
          {isSuspended ? t('members.suspended') : t('members.active')}
        </span>
      </td>

      {/* No-shows */}
      <td className="px-4 py-3">
        <span className={`font-body text-sm ${member.noshowCount > 0 ? 'font-bold text-red-500' : 'text-muted'}`}>
          {member.noshowCount}
        </span>
      </td>

      {/* Member since */}
      <td className="hidden px-4 py-3 lg:table-cell">
        <span className="font-body text-xs text-muted">
          {member.memberSince ? new Date(member.memberSince).toLocaleDateString('fr-BE') : '—'}
        </span>
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-lg p-1.5 text-muted hover:bg-dark/5"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-border bg-card py-1 shadow-lg">
                {isSuspended && (
                  <button
                    onClick={() => { setMenuOpen(false); onLiftSuspension() }}
                    className="flex w-full items-center gap-2 px-3 py-2 font-body text-sm text-dark hover:bg-dark/5"
                  >
                    <ShieldOff className="h-3.5 w-3.5" />
                    {t('members.lift_suspension')}
                  </button>
                )}
                <button
                  onClick={() => { setMenuOpen(false); onSendPush() }}
                  className="flex w-full items-center gap-2 px-3 py-2 font-body text-sm text-dark hover:bg-dark/5"
                >
                  <Bell className="h-3.5 w-3.5" />
                  {t('members.send_push')}
                </button>
              </div>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

export default function Members() {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const {
    members, totalCount, activeCount, isLoading,
    search, setSearch, statusFilter, setStatusFilter,
  } = useMembers()
  const { liftSuspension, sendPush } = useGymAdminActions()

  async function handleLiftSuspension(member: Member) {
    await liftSuspension(member.id, 'Lifted by admin')
    addToast(t('members.toast_suspension_lifted'))
  }

  async function handleSendPush(member: Member) {
    await sendPush(member.id, 'Dopamine', t('members.push_default_message'))
    addToast(t('members.toast_push_sent'))
  }

  const filters: Array<{ key: 'all' | 'active' | 'suspended'; label: string }> = [
    { key: 'all', label: t('members.filter_all') },
    { key: 'active', label: t('members.filter_active') },
    { key: 'suspended', label: t('members.filter_suspended') },
  ]

  return (
    <DashboardLayout>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-black uppercase tracking-tight text-dark lg:text-4xl">
            {t('members.title')}
          </h1>
          <p className="mt-1 font-body text-sm text-muted">
            {t('members.count', { total: totalCount })} &middot; {t('members.count_active', { active: activeCount })}
          </p>
        </div>
      </div>

      {/* Search + filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <Search className="h-4 w-4 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('members.search_placeholder')}
            className="w-48 bg-transparent font-body text-sm text-dark outline-none placeholder:text-muted"
          />
        </div>
        <div className="flex gap-2">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`rounded-lg px-3 py-1.5 font-body text-xs font-medium transition-colors ${
                statusFilter === f.key
                  ? 'bg-accent text-[#111111]'
                  : 'bg-card text-secondary hover:bg-dark/5'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-dark/[0.02]">
              <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase text-muted">{t('members.col_member')}</th>
              <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase text-muted">{t('members.col_status')}</th>
              <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase text-muted">{t('members.col_noshows')}</th>
              <th className="hidden px-4 py-3 text-left font-body text-xs font-semibold uppercase text-muted lg:table-cell">{t('members.col_since')}</th>
              <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase text-muted">{t('members.col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={5} className="p-3"><Skeleton variant="table-row" /></td></tr>
              ))
            ) : members.length === 0 ? (
              <tr><td colSpan={5} className="py-12 text-center font-body text-sm text-muted">{t('members.empty')}</td></tr>
            ) : (
              members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  onLiftSuspension={() => handleLiftSuspension(member)}
                  onSendPush={() => handleSendPush(member)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </DashboardLayout>
  )
}
