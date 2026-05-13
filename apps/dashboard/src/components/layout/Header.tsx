import { useTranslation } from 'react-i18next'
import { Menu, Search, Bell, Moon, Sun } from 'lucide-react'
import { useUIStore } from '@/stores/useUIStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { useTheme } from '@/hooks/useTheme'
import { useLocation } from 'react-router-dom'

const ROUTE_LABELS: Record<string, string> = {
  '/dashboard': 'nav.dashboard',
  '/planning': 'nav.planning',
  '/members': 'nav.members',
  '/plans': 'nav.plans',
  '/revenue': 'nav.revenue',
  '/settings': 'nav.settings',
}

export function Header() {
  const { t } = useTranslation()
  const { toggleSidebar } = useUIStore()
  const user = useAuthStore((s) => s.user)
  const { isDark, toggleTheme } = useTheme()
  const location = useLocation()

  const firstName = user?.user_metadata?.first_name ?? ''
  const lastName = user?.user_metadata?.last_name ?? ''
  const pageLabel = ROUTE_LABELS[location.pathname]

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-card px-4 lg:px-6">
      {/* Hamburger — mobile only */}
      <button
        onClick={toggleSidebar}
        className="text-dark lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Breadcrumb */}
      <div className="hidden items-center gap-2 font-body text-sm lg:flex">
        <span className="text-muted">GymBook</span>
        {pageLabel && (
          <>
            <span className="text-muted">/</span>
            <span className="font-medium text-dark">{t(pageLabel)}</span>
          </>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Search */}
      <div className="hidden items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 md:flex">
        <Search className="h-4 w-4 text-muted" />
        <input
          type="text"
          placeholder={t('common.search_placeholder')}
          className="w-48 bg-transparent font-body text-sm text-dark outline-none placeholder:text-muted"
        />
      </div>

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="rounded-lg p-2 text-muted transition-colors hover:bg-dark/5 hover:text-dark"
      >
        {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </button>

      {/* Notifications */}
      <button className="relative rounded-lg p-2 text-muted transition-colors hover:bg-dark/5 hover:text-dark">
        <Bell className="h-5 w-5" />
        <span className="animate-badge absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />
      </button>

      {/* Avatar */}
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 font-body text-xs font-bold text-accent">
        {firstName.charAt(0)}{lastName.charAt(0)}
      </div>
    </header>
  )
}
