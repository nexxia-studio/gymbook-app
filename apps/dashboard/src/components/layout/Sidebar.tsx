import { useTranslation } from 'react-i18next'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Calendar,
  Users,
  CreditCard,
  TrendingUp,
  Megaphone,
  Settings,
  LogOut,
  X,
} from 'lucide-react'
import { useAuthStore } from '@/stores/useAuthStore'
import { useGymStore } from '@/stores/useGymStore'
import { useUIStore } from '@/stores/useUIStore'
import vinizLogo from '@/assets/brand/viniz-logo-horizontal-lime.svg'

const NAV_ITEMS = [
  { key: 'dashboard', path: '/dashboard', icon: LayoutDashboard },
  { key: 'planning', path: '/planning', icon: Calendar },
  { key: 'members', path: '/members', icon: Users },
  { key: 'plans', path: '/plans', icon: CreditCard },
  { key: 'revenue', path: '/revenue', icon: TrendingUp },
  { key: 'communications', path: '/communications', icon: Megaphone },
  { key: 'settings', path: '/settings', icon: Settings },
] as const

export function Sidebar() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, signOut } = useAuthStore()
  const gymName = useGymStore((s) => s.gym?.name) ?? 'Viniz'
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
        {/* Header — logo horizontal Viniz centré. Le SVG est exporté sur un canevas carré
            (contenu horizontal centré, marges transparentes) : on recadre via un conteneur
            à hauteur fixe + overflow-hidden avec l'image surdimensionnée et centrée, plutôt
            que d'altérer l'asset. Lime lisible sur indigo (clair) comme sur #150D33 (sombre). */}
        <div className="relative flex h-16 items-center justify-center px-4">
          <div className="relative h-9 w-[180px] overflow-hidden">
            <img
              src={vinizLogo}
              alt="Viniz"
              className="absolute left-1/2 top-1/2 w-[180px] max-w-none -translate-x-1/2 -translate-y-1/2"
            />
          </div>
          <button onClick={toggleSidebar} className="absolute right-4 text-sidebar-text/70 lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Gym name — couleur mode-aware (text-sidebar-name) : var(--color-card) = blanc en
            clair sur sidebar indigo ; var(--color-light) #F3F0FF en sombre (lisible sur #150D33). */}
        <div className="px-5 pb-4 text-center">
          <span className="font-body text-xs text-sidebar-name">{gymName}</span>
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
                    ? 'bg-accent font-semibold text-[#17102E]'
                    : 'text-sidebar-text/55 hover:translate-x-0.5 hover:text-sidebar-text'
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
              <p className="truncate font-body text-xs text-sidebar-text/50">{email}</p>
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
