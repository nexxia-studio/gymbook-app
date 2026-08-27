import { useMemo } from 'react'
import { View, Text, Image, TouchableOpacity, Platform } from 'react-native'
import { usePathname, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSequence } from 'react-native-reanimated'
import { Calendar, CalendarCheck, Store, User } from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import { SvgXml } from 'react-native-svg'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { GYM_MODE } from '../../lib/gymResolver'
import { VINIZ_PULSE_LINE_SVG } from '../../assets/viniz/brandSvg'

interface TabItem {
  name: string
  route: string
  labelKey: string
  icon: LucideIcon | null
}

const TABS: TabItem[] = [
  { name: 'schedule', route: '/(tabs)/schedule', labelKey: 'tabs.schedule', icon: Calendar },
  { name: 'bookings', route: '/(tabs)/bookings', labelKey: 'tabs.bookings', icon: CalendarCheck },
  { name: 'index', route: '/(tabs)', labelKey: 'tabs.home', icon: null },
  { name: 'studio', route: '/(tabs)/studio', labelKey: 'tabs.studio', icon: Store },
  { name: 'profile', route: '/(tabs)/profile', labelKey: 'tabs.profile', icon: User },
]

// GYM-286b — les trois constantes de couleur ont été retirées : elles ne pouvaient pas
// lire le thème. Chaque composant lit désormais ses jetons.
// ⚠️ `#000` RESTE EN DUR, et ce n'est pas un oubli : c'est du NOIR PUR, pas le #111111 de
// la charte. Aucun jeton ne le vaut, et l'approcher par `tokens.background` changerait la
// pastille centrale d'un cran — sur l'élément le plus regardé de l'app.
const TAB_HEIGHT = 72

// ── GYM-297 — LE PULSE-V DANS UNE PASTILLE DE 58 px ──────────────────────────────────
// ⚠️ RECADRAGE, PAS RETOUCHE — même geste que `VinizLaunch` sur le wordmark. Le fichier de
// marque est un carré 1500×1500 dont le tracé n'occupe qu'une bande centrale ; posé tel
// quel dans une pastille ronde, il n'en remplirait qu'un tiers. Le `viewBox` est resserré
// sur l'emprise de l'art — bornes lues dans le SVG lui-même (les pastilles extrêmes du
// tracé : x 112,99→1390,07, y 240,24→1260,75). Le .svg du dépôt n'est pas modifié.
const PULSE_VIEWBOX = '113 240 1277 1021'
const PULSE_RATIO = 1021 / 1277
const PULSE_W = 34

function CenterButton({ active, onPress }: { active: boolean; onPress: () => void }) {
  const { tokens } = useTheme()

  // ⚠️ LE TRACÉ EST RETEINT, ET IL LE FAUT. Son art porte le lime Viniz #C8FF3D en dur dans
  // le SVG — la marque de Viniz, pas celle de la salle. Une prop `color` de
  // react-native-svg ne suffirait pas : elle n'alimente que `currentColor`, et ces chemins
  // portent un `fill` explicite. On remplace donc la valeur dans le XML, une fois par
  // thème. Même mécanique que la signature « propulsé par » de BrandedLogin.
  const pulseTeinte = useMemo(
    () => VINIZ_PULSE_LINE_SVG.replace(/#c8ff3d/gi, tokens.accent),
    [tokens.accent],
  )
  const scale = useSharedValue(1)

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  function handlePress() {
    scale.value = withSequence(
      withTiming(0.93, { duration: 80 }),
      withTiming(1, { duration: 150 }),
    )
    onPress()
  }

  return (
    <View className="items-center" style={{ marginTop: -24 }}>
      <TouchableOpacity onPress={handlePress} activeOpacity={1}>
        <Animated.View
          style={[
            animStyle,
            {
              width: 58,
              height: 58,
              borderRadius: 29,
              backgroundColor: '#000',
              alignItems: 'center',
              justifyContent: 'center',
              ...(Platform.OS === 'ios'
                ? { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8 }
                : { elevation: 8 }),
            },
          ]}
        >
          {/* ── GYM-297 — LE « D » DE DOPAMINE N'EST PAS UNE ICÔNE GÉNÉRIQUE ──────────
              C'est le logo d'UN client, au centre de la barre de navigation — l'élément le
              plus regardé de l'app. En mode multi il n'a rien à y faire : un membre de
              Studio Yoga tapait sur le « D » de Dopamine à chaque retour à l'accueil.

              ⚠️ LA PASTILLE, SON RAYON, SON OMBRE ET LA BORDURE D'ÉTAT NE CHANGENT PAS.
              Seul le CONTENU diffère selon le mode : le logo en `single`, le pulse-V Viniz
              en `multi`. Le clip reste sur une vue interne pour ne pas rogner l'ombre iOS.

              ⚠️ ET LE FOND DIFFÈRE AUSSI, PARCE QU'IL LE DOIT. En `single` c'est le noir pur
              d'origine, que le logo exige (son art a un fond noir). En `multi` c'est
              `tokens.background` : le pulse est teinté `tokens.accent`, et le garde-fou
              garantit ≥ 3:1 entre l'action et le fond — le seuil WCAG § 1.4.11 des
              ÉLÉMENTS D'INTERFACE, qui est le bon pour une icône. Le poser sur `#000` en
              multi ne garantirait rien : le noir pur n'est validé contre aucune primaire. */}
          <View
            style={{
              width: 58,
              height: 58,
              borderRadius: 29,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: GYM_MODE === 'multi' ? tokens.background : '#000',
              ...(active ? { borderWidth: 2, borderColor: tokens.accent } : {}),
            }}
          >
            {GYM_MODE === 'multi' ? (
              <SvgXml
                xml={pulseTeinte}
                viewBox={PULSE_VIEWBOX}
                width={PULSE_W}
                height={PULSE_W * PULSE_RATIO}
              />
            ) : (
              <Image
                source={require('../../assets/dopamine-logo-d.png')}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            )}
          </View>
        </Animated.View>
      </TouchableOpacity>
    </View>
  )
}

function TabButton({
  icon: Icon,
  label,
  active,
  onPress,
}: {
  icon: LucideIcon
  label: string
  active: boolean
  onPress: () => void
}) {
  const { tokens } = useTheme()

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} className="flex-1 items-center justify-center gap-1">
      <Icon size={22} color={active ? tokens.onSurface : tokens.onBackgroundMuted} />
      <Text
        style={{
          fontFamily: active ? 'DMSans_700Bold' : 'DMSans_400Regular',
          fontSize: 11,
          color: active ? tokens.onSurface : tokens.onBackgroundMuted,
        }}
      >
        {label}
      </Text>
      {active && (
        <View style={{ width: 20, height: 2, borderRadius: 1, backgroundColor: tokens.accent, marginTop: 1 }} />
      )}
    </TouchableOpacity>
  )
}

export function TabBar() {
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const { tokens } = useTheme()

  function isActive(tab: TabItem): boolean {
    if (tab.name === 'index') return pathname === '/' || pathname === '/(tabs)' || pathname === '/(tabs)/index'
    return pathname.endsWith(`/${tab.name}`)
  }

  return (
    <View
      style={{
        height: TAB_HEIGHT + insets.bottom,
        paddingBottom: insets.bottom,
        backgroundColor: tokens.surface,
        borderTopWidth: 1,
        borderTopColor: tokens.border,
        ...(Platform.OS === 'ios'
          ? { shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.05, shadowRadius: 8 }
          : { elevation: 8 }),
      }}
    >
      <View className="flex-1 flex-row items-center">
        {TABS.map((tab) => {
          const active = isActive(tab)

          if (tab.icon === null) {
            return (
              <View key={tab.name} className="flex-1 items-center">
                <CenterButton active={active} onPress={() => router.navigate(tab.route as never)} />
              </View>
            )
          }

          return (
            <TabButton
              key={tab.name}
              icon={tab.icon}
              label={t(tab.labelKey)}
              active={active}
              onPress={() => router.navigate(tab.route as never)}
            />
          )
        })}
      </View>
    </View>
  )
}
