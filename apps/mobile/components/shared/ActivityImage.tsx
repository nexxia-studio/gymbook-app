import { useState, useEffect, type ReactNode } from 'react'
import { View, Text, ImageBackground, type StyleProp, type ViewStyle, type ImageStyle } from 'react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'

/**
 * GYM-216 — Visuel d'une activité, depuis activities.image_url.
 *
 * Remplace les QUATRE tables `Record<string, string>` indexées par le NOM EXACT de
 * l'activité qui existaient en parallèle (utils/activityImages, SessionHero, SessionCard,
 * FavoriteCard). Elles ne connaissaient que 'Open Gym' et 'HIIT / Hyrox' : les 5 cours
 * créés depuis retombaient TOUS sur la photo d'Open Gym.
 *
 * ⚠️ LE REPLI EST LE CAS NOMINAL AU PREMIER BUILD : activities.image_url est vide sur
 * les 6 activités en prod (04/08), le cockpit la renseignera après ce lot. Le repli
 * n'est donc pas un cas dégradé rare, c'est ce que TOUS les membres verront d'abord —
 * il doit être digne : une surface pleine aux couleurs de la salle, frappée des
 * initiales du cours. Jamais de carte cassée, jamais de blanc.
 *
 * Le repli couvre trois cas, indistinguables pour le membre :
 *   1. image_url vide (aujourd'hui, partout) ;
 *   2. image_url renseignée mais illisible — URL morte, 404, hors ligne (`onError`) ;
 *   3. activité inconnue au chargement (le nom n'arrive qu'après la requête).
 */
interface ActivityImageProps {
  /** activities.image_url. Vide / null → repli. */
  imageUrl?: string | null
  /** Nom de l'activité — sert à composer les initiales du repli. */
  activity: string
  /** activities.color, teinte du repli. Défaut : le gris neutre de la charte. */
  accentColor?: string | null
  className?: string
  style?: StyleProp<ViewStyle>
  imageStyle?: StyleProp<ImageStyle>
  /** Taille des initiales du repli, adaptée à la surface (carte, héro, vignette). */
  initialsSize?: number
  children?: ReactNode
}

/**
 * Initiales d'un nom d'activité, dérivées — surtout PAS une table à tenir à jour.
 * « Open Gym » → OG · « HIIT / Hyrox » → HH · « Strength » → ST · '' → ''
 */
export function activityInitials(activity: string): string {
  const words = activity.match(/\p{L}+/gu) ?? []
  const [first, second] = words
  if (!first) return ''
  if (!second) return first.slice(0, 2).toUpperCase()
  return (first.slice(0, 1) + second.slice(0, 1)).toUpperCase()
}

export function ActivityImage({
  imageUrl,
  activity,
  accentColor,
  className,
  style,
  imageStyle,
  initialsSize = 96,
  children,
}: ActivityImageProps) {
  const uri = imageUrl?.trim()
  const [failed, setFailed] = useState(false)
  // Surface du repli : le fond de marque, lisible sous du texte blanc comme une photo
  // assombrie. C'est ce que le commentaire d'en-tête promet — « une surface pleine aux
  // couleurs de la salle » — et qui n'était pas tenable tant que la valeur était figée.
  const { tokens } = useTheme()

  // Une nouvelle URL mérite une nouvelle tentative : sans ça, un échec sur un créneau
  // condamnerait le visuel de tous les suivants rendus par le même composant recyclé.
  useEffect(() => { setFailed(false) }, [uri])

  if (uri && !failed) {
    return (
      <ImageBackground
        source={{ uri }}
        className={className}
        style={style}
        imageStyle={imageStyle}
        onError={() => setFailed(true)}
      >
        {children}
      </ImageBackground>
    )
  }

  const initials = activityInitials(activity)

  return (
    <View className={className} style={[{ backgroundColor: tokens.background }, style]}>
      {/* La teinte de l'activité (activities.color) en voile : le repli reste distinct
          d'un cours à l'autre sans jamais prétendre être une photo. */}
      <View
        style={[
          { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.18 },
          { backgroundColor: accentColor || tokens.onSurfaceSecondary },
          imageStyle as StyleProp<ViewStyle>,
        ]}
      />
      {initials.length > 0 && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Text
            style={{
              fontFamily: 'BarlowCondensed_900Black',
              fontSize: initialsSize,
              lineHeight: initialsSize * 1.1,
              color: 'rgba(255,255,255,0.10)',
            }}
          >
            {initials}
          </Text>
        </View>
      )}
      {children}
    </View>
  )
}
