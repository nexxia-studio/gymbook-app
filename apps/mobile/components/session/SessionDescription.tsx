import { useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, LayoutAnimation } from 'react-native'
import { useTranslation } from 'react-i18next'

interface SessionDescriptionProps {
  activity: string
}

export function SessionDescription({ activity }: SessionDescriptionProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const desc = activity === 'Open Gym' ? t('session.desc_open_gym') : t('session.desc_hiit')

  const toggle = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setExpanded((v) => !v)
  }, [])

  return (
    <View className="bg-move-card px-5 py-4">
      <Text className="mb-2 font-dmsans-bold text-[11px] uppercase tracking-wider text-move-text-muted">
        {t('session.about')}
      </Text>
      <Text
        className="font-dmsans text-sm leading-5 text-move-text-secondary"
        numberOfLines={expanded ? undefined : 3}
      >
        {desc}
      </Text>
      <TouchableOpacity onPress={toggle} className="mt-1">
        <Text className="font-dmsans-bold text-xs text-move-accent-dim">
          {expanded ? t('session.see_less') : t('session.see_more')}
        </Text>
      </TouchableOpacity>
    </View>
  )
}
