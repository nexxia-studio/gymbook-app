// GYM-288 (livrable 3) — ÉCRAN « CHANGER DE SALLE ».
//
// ⚠️ N'EXISTE QU'EN MODE `multi`. L'entrée du Profil ne s'affiche pas en `single`, et cet
// écran refuse d'y rendre quoi que ce soit : le routeur enregistre le fichier dans tous
// les builds, il faut donc que la route elle-même se garde.
//
// ⚠️ ON NE PROPOSE PAS « REJOINDRE UNE AUTRE SALLE » ICI. `switch_active_gym` refuse
// (PT403) toute salle où le membre n'est pas inscrit, et elle a raison de le faire : ce
// sont deux gestes différents. Un bouton « rejoindre » posé sur cet écran promettrait
// quelque chose que le serveur refuse — il mentirait avant même d'être câblé.
import { useCallback, useEffect, useState } from 'react'
import { View, Text, ActivityIndicator, TouchableOpacity, Image, FlatList } from 'react-native'
import { Redirect, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Check } from 'lucide-react-native'
import { GYM_MODE } from '../../lib/gymResolver'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { listMyGyms, switchGym, type GymMembership } from '../../lib/gymSwitch'

type State =
  | { step: 'loading' }
  | { step: 'ready'; gyms: GymMembership[] }
  | { step: 'offline' }
  | { step: 'error' }

export default function GymSwitch() {
  const { t } = useTranslation()
  const router = useRouter()
  const { tokens } = useTheme()
  const [state, setState] = useState<State>({ step: 'loading' })
  const [switching, setSwitching] = useState<string | null>(null)
  const [refused, setRefused] = useState(false)

  useEffect(() => {
    if (GYM_MODE === 'single') return
    let alive = true
    listMyGyms().then((res) => {
      if (!alive) return
      setState(res.status === 'ok' ? { step: 'ready', gyms: res.gyms } : { step: res.status })
    })
    return () => { alive = false }
  }, [])

  const handleSelect = useCallback(async (gym: GymMembership) => {
    if (gym.isActive || switching) return
    setRefused(false)
    setSwitching(gym.gymId)
    const res = await switchGym(gym)
    setSwitching(null)
    if (res.status === 'ok') {
      // Retour à l'onglet d'accueil plutôt qu'au Profil : c'est là que la bascule se VOIT
      // — planning, marque, réservations. Rester sur une liste de salles après avoir
      // changé de salle ne montre rien de ce qui vient de se passer.
      router.replace('/(tabs)' as never)
      return
    }
    // ⚠️ `not_a_member` ne devrait pas arriver — la liste vient des appartenances. S'il
    // arrive, c'est que l'inscription a été retirée entre l'affichage et le geste : on le
    // dit, et on recharge la liste plutôt que de laisser une ligne fantôme cliquable.
    if (res.status === 'not_a_member') {
      setRefused(true)
      const again = await listMyGyms()
      if (again.status === 'ok') setState({ step: 'ready', gyms: again.gyms })
      return
    }
    setRefused(true)
  }, [router, switching])

  if (GYM_MODE === 'single') return <Redirect href="/+not-found" />

  const renderItem = ({ item }: { item: GymMembership }) => {
    const busy = switching === item.gymId
    return (
      <TouchableOpacity
        onPress={() => handleSelect(item)}
        disabled={item.isActive || switching !== null}
        accessibilityRole="button"
        accessibilityState={{ selected: item.isActive, disabled: item.isActive }}
        className="mb-3 flex-row items-center gap-4 rounded-2xl p-4"
        style={{
          backgroundColor: tokens.surface,
          borderWidth: 1,
          borderColor: item.isActive ? tokens.accent : tokens.border,
          opacity: switching !== null && !busy ? 0.5 : 1,
        }}
      >
        {item.logoUrl ? (
          <Image source={{ uri: item.logoUrl }} className="h-12 w-12 rounded-xl" resizeMode="contain" />
        ) : (
          <View className="h-12 w-12 items-center justify-center rounded-xl" style={{ backgroundColor: tokens.background }}>
            <Text className="font-dmsans-bold text-lg" style={{ color: tokens.onBackground }}>
              {item.name.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}

        <View className="flex-1">
          <Text className="font-dmsans-bold text-base" style={{ color: tokens.onBackground }} numberOfLines={1}>
            {item.name}
          </Text>
          {item.isActive && (
            <Text className="mt-0.5 font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
              {t('gym_switch.current')}
            </Text>
          )}
        </View>

        {busy
          ? <ActivityIndicator color={tokens.onBackground} />
          : item.isActive
            ? <Check size={20} color={tokens.accent} />
            : null}
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top', 'bottom']}>
      <View className="flex-1 px-6 pt-4">
        <Text className="font-barlow text-3xl uppercase" style={{ color: tokens.onBackground }}>
          {t('gym_switch.title')}
        </Text>

        {state.step === 'loading' && (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={tokens.onBackground} />
          </View>
        )}

        {(state.step === 'offline' || state.step === 'error') && (
          <Hint color={tokens.onBackgroundMuted}>
            {t(state.step === 'offline' ? 'common.offline_message' : 'gym_switch.error')}
          </Hint>
        )}

        {state.step === 'ready' && state.gyms.length <= 1 && (
          // ⚠️ CE CAS NE DEVRAIT PAS S'ATTEINDRE : l'entrée du Profil ne s'affiche que
          // au-delà d'une salle. Il reste traité parce qu'une inscription peut être
          // retirée pendant que l'écran est ouvert — et un écran vide serait alors pris
          // pour une panne.
          <Hint color={tokens.onBackgroundMuted}>{t('gym_switch.only_one')}</Hint>
        )}

        {state.step === 'ready' && state.gyms.length > 1 && (
          <>
            <Text className="mt-2 font-dmsans text-sm" style={{ color: tokens.onBackgroundMuted }}>
              {t('gym_switch.subtitle')}
            </Text>
            {refused && (
              <Text className="mt-4 font-dmsans text-sm" style={{ color: tokens.onBackground }}>
                {t('gym_switch.failed')}
              </Text>
            )}
            <FlatList
              className="mt-5"
              data={state.gyms}
              keyExtractor={(g) => g.gymId}
              renderItem={renderItem}
              showsVerticalScrollIndicator={false}
            />
          </>
        )}
      </View>
    </SafeAreaView>
  )
}

function Hint({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <View className="flex-1 items-center justify-center px-6">
      <Text className="text-center font-dmsans text-sm" style={{ color }}>{children}</Text>
    </View>
  )
}
