import { useTranslation } from 'react-i18next'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Dumbbell,
  LayoutDashboard,
  Calendar,
  Users,
  CreditCard,
  Receipt,
  TrendingUp,
  Settings,
  LogOut,
  X,
} from 'lucide-react'
import { useAuthStore } from '@/stores/useAuthStore'
import { useUIStore } from '@/stores/useUIStore'

const NAV_ITEMS = [
  { key: 'dashboard', path: '/dashboard', icon: LayoutDashboard },
  { key: 'planning', path: '/planning', icon: Calendar },
  { key: 'members', path: '/members', icon: Users },
  { key: 'plans', path: '/plans', icon: CreditCard },
  { key: 'payments', path: '/payments', icon: Receipt },
  { key: 'revenue', path: '/revenue', icon: TrendingUp },
  { key: 'settings', path: '/settings', icon: Settings },
] as const

export function Sidebar() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, signOut } = useAuthStore()
  const { sidebarOpen, toggleSidebar } = useUIStore()

  const firstName = user?.user_metadata?.first_name ?? ''
  const lastName = user?.user_metadata?.last_name ?? ''
  const email = user?.email ?? ''

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={toggleSidebar}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-sidebar transition-transform duration-200 ease-out lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex h-16 items-center justify-between px-5">
          <div className="flex items-center gap-2">
            <Dumbbell className="h-6 w-6 text-accent" />
            <span className="font-display text-xl font-black uppercase tracking-tight text-accent">
              GymBook
            </span>
          </div>
          <button onClick={toggleSidebar} className="text-muted lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Gym name */}
        <div className="px-5 pb-4">
          <span className="font-body text-xs text-muted">Dopamine Performance Club</span>
        </div>

        <div className="mx-5 border-t border-white/10" />

        {/* Navigation */}
        <nav className="mt-4 flex flex-1 flex-col gap-1 px-3">
          {NAV_ITEMS.map(({ key, path, icon: Icon }) => (
            <NavLink
              key={key}
              to={path}
              onClick={() => {
                if (window.innerWidth < 1024) toggleSidebar()
              }}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg px-3 py-2.5 font-body text-sm transition-all duration-150 ${
                  isActive
                    ? 'bg-accent font-semibold text-[#111111]'
                    : 'text-muted hover:translate-x-0.5 hover:text-sidebar-text'
                }`
              }
            >
              <Icon className="h-[18px] w-[18px]" />
              {t(`nav.${key}`)}
            </NavLink>
          ))}
        </nav>

        {/* Footer — user info */}
        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/20 font-body text-xs font-bold text-accent">
              {firstName.charAt(0)}{lastName.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-body text-sm font-medium text-sidebar-text">
                {firstName} {lastName}
              </p>
              <p className="truncate font-body text-xs text-muted">{email}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="shrink-0 text-muted transition-colors hover:text-red-400"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
