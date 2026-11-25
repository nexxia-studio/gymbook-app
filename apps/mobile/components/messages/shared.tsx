// GYM-391 — ce que la liste des messages et le message en entier ont en commun : l'icône du
// type, la date relative traduite et le périmètre des requêtes.
import { useCallback, useMemo } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  BadgeCheck, Ban, Bell, CalendarCheck, CalendarClock, CalendarX, CreditCard, Megaphone, Ticket, TrendingUp,
  type LucideIcon,
} from 'lucide-react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { useActiveGymId } from '../../lib/activeGym'
import { messageScope, type MessageScope } from '../../lib/messages/data'
import { relativeDate } from '../../lib/messages/format'
import { messageIconName, type MessageIconName } from '../../lib/messages/list'
import { useAuthStore } from '../../stores/useAuthStore'

// `Record` complet : un nom ajouté à `MessageIconName` sans icône ici ne compile pas.
const ICONS: Record<MessageIconName, LucideIcon> = {
  'calendar-check': CalendarCheck,
  'trending-up': TrendingUp,
  'calendar-x': CalendarX,
  'calendar-clock': CalendarClock,
  'badge-check': BadgeCheck,
  'credit-card': CreditCard,
  ticket: Ticket,
  ban: Ban,
  megaphone: Megaphone,
  bell: Bell,
}

/** Le périmètre des requêtes (membre ET salle), ou null s'il en manque un : aucune requête alors. */
export function useMessageScope(): MessageScope | null {
  const userId = useAuthStore((s) => s.user?.id)
  const gymId = useActiveGymId()
  return useMemo(() => messageScope(userId, gymId), [userId, gymId])
}

/** L'icône d'un type de message dans sa pastille. À poser sur `tokens.surface`. */
export function MessageIcon({ type }: { type: string | null | undefined }) {
  const { tokens } = useTheme()
  const Icon = ICONS[messageIconName(type)]
  return (
    <View
      className="h-10 w-10 items-center justify-center rounded-full"
      style={{ backgroundColor: tokens.page }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Icon size={20} color={tokens.onSurface} />
    </View>
  )
}

/**
 * Rend la fonction qui traduit `created_at` en date relative (« il y a 5 min », « hier »,
 * « 12 mars »). Null quand la date est absente ou illisible : on n'affiche alors rien.
 */
export function useMessageDateLabel(): (createdAt: string | null | undefined) => string | null {
  const { t } = useTranslation()
  return useCallback((createdAt) => {
    const date = relativeDate(createdAt, new Date())
    if (!date) return null
    switch (date.kind) {
      case 'now': return t('messages.date_now')
      case 'minutes': return t('messages.date_minutes', { count: date.count })
      case 'hours': return t('messages.date_hours', { count: date.count })
      case 'yesterday': return t('messages.date_yesterday')
      case 'days': return t('messages.date_days', { count: date.count })
      case 'date': {
        // Les mois de l'accueil (home.months), comme les autres écrans.
        const months = t('home.months', { returnObjects: true }) as string[]
        const month = months[date.month - 1] ?? ''
        return date.year === null
          ? t('messages.date_day_month', { day: date.day, month })
          : t('messages.date_day_month_year', { day: date.day, month, year: date.year })
      }
    }
  }, [t])
}
