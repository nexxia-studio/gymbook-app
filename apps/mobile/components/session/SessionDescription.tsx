import { useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, LayoutAnimation } from 'react-native'
import { useTranslation } from 'react-i18next'

interface SessionDescriptionProps {
  /**
   * GYM-216 — activities.description, telle que le gérant l'a saisie dans le cockpit.
   * Chaîne vide / null = non renseignée : le composant ne rend RIEN.
   */
  description: string | null | undefined
}

/**
 * GYM-216 — Description du cours, lue en base.
 *
 * Avant : un ternaire sur le NOM de l'activité choisissait entre deux textes d'interface
 * (`session.desc_open_gym` / `session.desc_hiit`). Tout cours autre qu'« Open Gym »
 * héritait donc de la description HIIT — et modifier une description dans le dashboard
 * n'avait aucun effet dans l'app.
 *
 * ⚠️ REPLI : description vide → section MASQUÉE. Jamais de texte générique de
 * remplacement : un vide est honnête, un texte inventé décrit un cours qui n'existe pas.
 *
 * ⚠️ MULTILINGUE (hors périmètre GYM-216) : le texte est rendu tel quel, dans sa langue
 * de saisie. activity_translations est vide et supported_languages = ['fr'], donc c'est
 * exact aujourd'hui. Le jour où une salle sera multilingue, la traduction se résoudra
 * chez l'appelant : ce composant reçoit une description DÉJÀ résolue, sa signature
 * n'aura pas à changer.
 */
export function SessionDescription({ description }: SessionDescriptionProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const toggle = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setExpanded((v) => !v)
  }, [])

  const text = description?.trim()
  if (!text) return null

  return (
    <View className="bg-move-card px-5 py-4">
      <Text className="mb-2 font-dmsans-bold text-[11px] uppercase tracking-wider text-move-text-muted">
        {t('session.about')}
      </Text>
      <Text
        className="font-dmsans text-sm leading-5 text-move-text-secondary"
        numberOfLines={expanded ? undefined : 3}
      >
        {text}
      </Text>
      <TouchableOpacity onPress={toggle} className="mt-1">
        <Text className="font-dmsans-bold text-xs text-move-accent-dim">
          {expanded ? t('session.see_less') : t('session.see_more')}
        </Text>
      </TouchableOpacity>
    </View>
  )
}
