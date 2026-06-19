import { View, Text, Image, TouchableOpacity, Platform } from 'react-native'
import { usePathname, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSequence } from 'react-native-reanimated'
import { Calendar, CalendarCheck, Store, User } from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'

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

const ACTIVE_COLOR = '#111111'
const INACTIVE_COLOR = '#9A9890'
const ACCENT = '#C8F000'
const TAB_HEIGHT = 72

function CenterButton({ active, onPress }: { active: boolean; onPress: () => void }) {
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
          {/* Logo Dopamine — même pastille (58, rond), logo blanc sur fond noir en cover.
              Clip sur une vue interne pour ne pas rogner l'ombre iOS de la pastille. */}
          <View
            style={{
              width: 58,
              height: 58,
              borderRadius: 29,
              overflow: 'hidden',
              backgroundColor: '#000',
              ...(active ? { borderWidth: 2, borderColor: ACCENT } : {}),
            }}
          >
            <Image
              source={require('../../assets/dopamine-logo-d.png')}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
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
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} className="flex-1 items-center justify-center gap-1">
      <Icon size={22} color={active ? ACTIVE_COLOR : INACTIVE_COLOR} />
      <Text
        style={{
          fontFamily: active ? 'DMSans_700Bold' : 'DMSans_400Regular',
          fontSize: 11,
          color: active ? ACTIVE_COLOR : INACTIVE_COLOR,
        }}
      >
        {label}
      </Text>
      {active && (
        <View style={{ width: 20, height: 2, borderRadius: 1, backgroundColor: ACCENT, marginTop: 1 }} />
      )}
    </TouchableOpacity>
  )
}

export function TabBar() {
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const insets = useSafeAreaInsets()

  function isActive(tab: TabItem): boolean {
    if (tab.name === 'index') return pathname === '/' || pathname === '/(tabs)' || pathname === '/(tabs)/index'
    return pathname.endsWith(`/${tab.name}`)
  }

  return (
    <View
      style={{
        height: TAB_HEIGHT + insets.bottom,
        paddingBottom: insets.bottom,
        backgroundColor: '#FFFFFF',
        borderTopWidth: 1,
        borderTopColor: '#E8E6E0',
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
