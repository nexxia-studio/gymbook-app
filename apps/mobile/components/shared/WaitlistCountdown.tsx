import { useEffect, useRef, useState } from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SEMANTIC } from '../../lib/theme/semantic'

interface Props {
  deadline: string
  onExpire?: () => void
}

export function WaitlistCountdown({ deadline, onExpire }: Props) {
  const { t } = useTranslation()
  const [minutesLeft, setMinutesLeft] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const expiredRef = useRef(false)

  useEffect(() => {
    expiredRef.current = false
    const update = () => {
      const diff = Math.max(0, new Date(deadline).getTime() - Date.now())
      setMinutesLeft(Math.floor(diff / 60000))
      setSecondsLeft(Math.floor((diff % 60000) / 1000))
      if (diff === 0 && !expiredRef.current) {
        expiredRef.current = true
        onExpire?.()
      }
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [deadline, onExpire])

  if (minutesLeft === 0 && secondsLeft === 0) {
    return (
      <View className="rounded-lg bg-red-500/15 px-3 py-2.5">
        <Text className="font-dmsans-bold text-xs text-red-400">
          {t('bookings.deadline_expired')}
        </Text>
      </View>
    )
  }

  const isUrgent = minutesLeft < 5
  const isWarning = minutesLeft < 15

  // GYM-286 — A-2, EN ATTENTE : #DC2626 et #EA580C sont un second rouge et un second
  // orangé, qu'aucun jeton ne vaut. Seul #F97316 EST `SEMANTIC.warning`, au caractère près.
  const bgClass = isUrgent ? 'bg-red-500/15' : 'bg-orange-500/15'
  // 🔴 GYM-290 (décision C, A-2) — FUSION. Trois rouges et trois orangés coexistaient
  // pour dire deux choses. #DC2626 rejoint `danger`, #EA580C rejoint `warning` : la
  // troisième branche portait DÉJÀ `SEMANTIC.warning`, si bien que deux orangés à 8 unités
  // l'un de l'autre se côtoyaient sur la même ligne, dans le même ternaire.
  // ⚠️ Change des pixels chez Dopamine — c'est l'objet même de la fusion.
  const textColor = isUrgent ? SEMANTIC.danger : isWarning ? SEMANTIC.warning : SEMANTIC.warning
  const fontWeight = isUrgent ? '900' as const : 'bold' as const

  const text = minutesLeft > 0
    ? t('bookings.countdown_with_min', { min: minutesLeft, sec: secondsLeft })
    : t('bookings.countdown_secs_only', { sec: secondsLeft })

  return (
    <View className={`rounded-lg ${bgClass} px-3 py-2.5`}>
      <Text className="font-dmsans-bold text-xs" style={{ color: textColor, fontWeight }}>
        {text}
      </Text>
    </View>
  )
}
