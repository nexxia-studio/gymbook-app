// GYM-102 (2/5) — ÉCRAN 02 « TROUVER SA SALLE ».
//
// ⚠️ CET ÉCRAN N'EXISTE PAS EN MODE `single`. Le routeur d'Expo enregistre le fichier, mais
// rien ne l'ouvre : la résolution de salle (lib/gymResolver) rend `source: 'build'` et
// aucun chemin ne mène ici. L'app Dopamine ne le verra jamais.
//
// CE QU'IL AFFICHE : logo, nom, ville. RIEN D'AUTRE — et surtout pas la rue. C'est la
// contrainte du socle (lot 1), reprise ici : `search_gyms` ne rend que ces quatre champs,
// et cet écran n'en demande pas davantage. Une commune situe une salle ; une rue permet
// de se présenter chez quelqu'un.
import { useState, useCallback, useEffect, useRef } from 'react'
import { View, Text, ActivityIndicator, TouchableOpacity, FlatList, Image } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MapPin } from 'lucide-react-native'
import { TextInput } from '../../components/ui/TextInput'
import { writeSelectedGymSlug } from '../../lib/gymResolver'
import {
  searchGyms,
  MIN_QUERY_LENGTH,
  SEARCH_DEBOUNCE_MS,
  type GymSearchResult,
  type GymSearchOutcome,
} from '../../lib/gymSearch'

export default function GymSelect() {
  const { t } = useTranslation()
  const router = useRouter()

  const [query, setQuery] = useState('')
  const [outcome, setOutcome] = useState<GymSearchOutcome>({ status: 'too_short' })
  const [searching, setSearching] = useState(false)

  // ⚠️ DEUX GARDES, ET ELLES NE FONT PAS LA MÊME CHOSE :
  //  · `timer` porte l'ANTI-REBOND — il évite de lancer une requête à chaque frappe, donc
  //    de brûler le quota de 30 recherches / 15 min sur un seul mot tapé lettre à lettre ;
  //  · `seq` écarte les réponses TARDIVES — deux requêtes lancées peuvent revenir dans le
  //    désordre, et la plus lente écraserait alors le résultat de la plus récente. Le
  //    membre verrait les résultats d'une frappe qu'il a déjà corrigée.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)

    const q = query.trim()
    if (q.length < MIN_QUERY_LENGTH) {
      setSearching(false)
      setOutcome({ status: 'too_short' })
      return
    }

    setSearching(true)
    const mySeq = ++seq.current
    timer.current = setTimeout(async () => {
      const res = await searchGyms(q)
      if (mySeq !== seq.current) return // une frappe plus récente a pris la main
      setOutcome(res)
      setSearching(false)
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [query])

  const handleSelect = useCallback(async (gym: GymSearchResult) => {
    await writeSelectedGymSlug(gym.slug)
    // Le choix mémorisé, on repart par la racine : c'est elle qui décide de la suite
    // (connexion, accueil…) selon la session. Router ici vers un écran précis
    // dupliquerait cette décision, et les deux finiraient par diverger.
    router.replace('/')
  }, [router])

  const renderItem = useCallback(({ item }: { item: GymSearchResult }) => (
    <TouchableOpacity
      onPress={() => handleSelect(item)}
      className="mb-3 flex-row items-center gap-4 rounded-2xl border border-move-border bg-white p-4"
      accessibilityRole="button"
      accessibilityLabel={item.city ? `${item.name}, ${item.city}` : item.name}
    >
      {/* Un logo absent est le cas NOMINAL d'une salle qui vient de s'inscrire : on rend
          une pastille avec l'initiale plutôt qu'un cadre vide ou une image cassée. */}
      {item.logo_url ? (
        <Image source={{ uri: item.logo_url }} className="h-12 w-12 rounded-xl" resizeMode="contain" />
      ) : (
        <View className="h-12 w-12 items-center justify-center rounded-xl bg-move-dark">
          <Text className="font-barlow text-lg text-move-accent">
            {item.name.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
      <View className="flex-1">
        <Text className="font-dmsans-bold text-base text-move-dark" numberOfLines={1}>
          {item.name}
        </Text>
        {/* GYM-229 — pas de ligne vide ni de libellé orphelin : sans commune, la ligne
            disparaît entièrement. */}
        {item.city ? (
          <View className="mt-0.5 flex-row items-center gap-1">
            <MapPin size={12} color="#9A9890" />
            <Text className="font-dmsans text-xs text-move-text-muted">{item.city}</Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  ), [handleSelect])

  // ── Le message d'état. Chaque cas dit ce qui se passe, aucun ne dit « erreur ». ──────
  const renderState = () => {
    if (searching) {
      return (
        <View className="items-center py-10">
          <ActivityIndicator color="#111111" />
        </View>
      )
    }
    switch (outcome.status) {
      case 'too_short':
        // ⚠️ UNE INVITE, PAS UNE ERREUR : le membre est en train de taper, il n'a rien
        // fait de mal.
        return <Hint text={t('gym_select.hint_min_length', { min: MIN_QUERY_LENGTH })} />
      case 'ok':
        return outcome.results.length === 0
          ? <Hint text={t('gym_select.empty')} />
          : null
      case 'rate_limited':
        return <Hint text={t('gym_select.rate_limited')} />
      case 'offline':
        return <Hint text={t('common.offline_message')} />
      case 'error':
        return <Hint text={t('gym_select.error')} />
    }
  }

  const results = outcome.status === 'ok' ? outcome.results : []

  return (
    <SafeAreaView className="flex-1 bg-move-bg" edges={['top', 'bottom']}>
      <View className="flex-1 px-6 pt-4">
        <Text className="font-barlow text-3xl uppercase text-move-dark">
          {t('gym_select.title')}
        </Text>
        <Text className="mt-2 font-dmsans text-sm text-move-text-secondary">
          {t('gym_select.subtitle')}
        </Text>

        <View className="mt-6">
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('gym_select.placeholder')}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>

        <FlatList
          className="mt-5"
          data={results}
          keyExtractor={(item) => item.slug}
          renderItem={renderItem}
          ListEmptyComponent={renderState()}
          ListFooterComponent={results.length > 0 ? renderState() : null}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      </View>
    </SafeAreaView>
  )
}

function Hint({ text }: { text: string }) {
  return (
    <View className="items-center px-6 py-10">
      <Text className="text-center font-dmsans text-sm text-move-text-muted">{text}</Text>
    </View>
  )
}
