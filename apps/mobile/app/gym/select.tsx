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
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MapPin } from 'lucide-react-native'
import { TextInput } from '../../components/ui/TextInput'
import { writeSelectedGymSlug } from '../../lib/gymResolver'
import { fetchBrand } from '../../lib/theme/brand'
import {
  searchGyms,
  MIN_QUERY_LENGTH,
  SEARCH_DEBOUNCE_MS,
  type GymSearchResult,
  type GymSearchOutcome,
} from '../../lib/gymSearch'
import { GYM_MODE } from '../../lib/gymResolver'
import { Redirect } from 'expo-router'
import { VINIZ, VINIZ_THEME, type ThemeTokens } from '../../lib/theme/resolveTheme'
import { PoweredByViniz } from '../../components/viniz/PoweredByViniz'

// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 GYM-301 (3) — CET ÉCRAN EST À VINIZ, PAS À UNE SALLE
// ═════════════════════════════════════════════════════════════════════════════════════
// « Trouve ta salle » est le seul écran où le membre n'a PAS encore de salle — c'est même
// sa définition. Il empruntait pourtant `useTheme()`, donc les couleurs de la dernière
// salle vue, ou le repli Viniz sombre. Un écran de choix habillé aux couleurs d'une des
// options n'est pas neutre : il en désigne une.
//
// La palette est donc FIXE et c'est celle de la marque. Comme tout l'écran passait déjà
// par `tokens.*`, il suffit d'en changer la SOURCE — aucune couleur n'est écrite dans le
// JSX, et le jour où la charte Viniz bouge, elle bouge ici.
//
// ⚠️ COMPOSÉE À PARTIR DES CONSTANTES EXISTANTES, PAS DE VALEURS RECOPIÉES. `VINIZ.ink`,
// `VINIZ.light`, `VINIZ.lavender` et `VINIZ.lime` existent depuis GYM-102 ; les réécrire
// en dur aurait créé une seconde définition de la charte, condamnée à diverger.
//
// ⚠️ `VINIZ_THEME` NE CONVENAIT PAS TEL QUEL, et c'est la seule vraie différence : son
// fond est `VINIZ.dark` (#171310), le repli NEUTRE d'une salle sans couleurs utilisables.
// La marque, elle, se pose sur le Violet Ink. On part donc de `VINIZ_THEME` — pour hériter
// de l'accent, de l'encre et de la bordure sans les recopier — et on ne redéfinit que les
// trois jetons de fond.
//
// ⚠️ UN SEUL LITTÉRAL NOUVEAU DANS TOUT LE LOT : la surface des cartes. Le voile standard
// (`rgba(243,240,255,0.06)`) composé sur le Violet Ink donnerait #392872 ; la charte
// demande #3A2585, qui est un violet légèrement plus SATURÉ, pas un simple éclaircissement
// — aucun jeton existant ne le produit. Il est donc nommé ici plutôt que semé dans le JSX.
const VINIZ_CARD_SURFACE = '#3A2585'

const MARQUE_VINIZ: ThemeTokens = {
  ...VINIZ_THEME,
  background: VINIZ.ink,
  page: VINIZ.ink,
  surface: VINIZ_CARD_SURFACE,
  // Le lime reste autorisé : le Violet Ink est un fond SOMBRE, et c'est la condition.
  // `accent`, `onAccent`, `onBackground`, `onBackgroundMuted` et `border` sont hérités.
}

export default function GymSelect() {
  const tokens = MARQUE_VINIZ
  const { t } = useTranslation()
  const router = useRouter()
  // GYM-102 (4/5) — un lien profond dont le slug n'existe pas atterrit ici. Sans ce
  // message, le membre verrait un écran de recherche vide et croirait avoir mal cliqué.
  const { reason } = useLocalSearchParams<{ reason?: string }>()

  const [query, setQuery] = useState('')
  const [outcome, setOutcome] = useState<GymSearchOutcome>({ status: 'too_short' })
  const [searching, setSearching] = useState(false)
  // GYM-291 — la salle en cours d'ouverture. Le geste doit être ACQUITTÉ : entre le tap et
  // l'écran de connexion il y a une lecture de marque, courte mais non nulle, et une liste
  // qui ne réagit pas se fait taper deux fois.
  const [opening, setOpening] = useState<string | null>(null)

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

  // ── GYM-291 — 🔴 DE LA RECHERCHE À LA CONNEXION BRANDÉE, SANS ESCALE ────────────────
  //
  // CE QUE CE CHEMIN FAISAIT AVANT, ET CE QU'IL EN COÛTAIT. Il repartait par la racine —
  // « c'est elle qui décide de la suite ». La racine remontait alors l'écran de lancement
  // Viniz : 3,4 secondes de pulse animé QUE LE MEMBRE VENAIT DE VOIR, puis un écran
  // générique « Se connecter / Créer un compte », sans marque, avant d'atteindre enfin la
  // connexion de la salle choisie. Trois écrans pour un geste.
  //
  // ⚠️ ET L'ARGUMENT D'ORIGINE NE TIENT PAS ICI. « Router vers un écran précis
  // dupliquerait la décision de la racine » — sauf qu'à cet écran la décision est DÉJÀ
  // prise : on n'y arrive que sans session (le lancement n'y redirige que dans ce cas, et
  // « ce n'est pas ma salle » part d'un écran de connexion). Il n'y a rien à décider.
  //
  // ⚠️ LA MARQUE EST CHARGÉE AVANT DE NAVIGUER, ET C'EST CE QUI SUPPRIME LE SECOND
  // CHARGEMENT. La recherche ne rend que slug, nom, ville et logo — PAS les couleurs
  // (`search_gyms` est publique et volontairement avare). Sans ce préchargement, l'écran
  // de connexion s'ouvrirait aux couleurs Viniz par défaut puis basculerait sur celles de
  // la salle : le clignotement de marque que `lib/theme/brand.ts` existe pour éviter.
  // `fetchBrand` alimente le cache que le fournisseur de thème lit au montage.
  const handleSelect = useCallback(async (gym: GymSearchResult) => {
    if (opening) return
    setOpening(gym.slug)
    await writeSelectedGymSlug(gym.slug)
    // Best-effort : hors ligne, on navigue quand même. Le fournisseur de thème retombe
    // alors sur la palette Viniz, ce qui reste mieux que de bloquer sur une liste.
    await fetchBrand(gym.slug)
    router.replace('/(auth)/login')
  }, [router, opening])

  const renderItem = useCallback(({ item }: { item: GymSearchResult }) => (
    <TouchableOpacity
      onPress={() => handleSelect(item)}
      disabled={opening !== null}
      className="mb-3 flex-row items-center gap-4 rounded-2xl border p-4"
      style={{
        borderColor: tokens.border,
        backgroundColor: tokens.surface,
        // La ligne choisie reste pleine, les autres s'effacent : on montre CE QUI S'OUVRE,
        // pas seulement que quelque chose se passe.
        opacity: opening !== null && opening !== item.slug ? 0.4 : 1,
      }}
      accessibilityRole="button"
      accessibilityState={{ disabled: opening !== null, busy: opening === item.slug }}
      accessibilityLabel={item.city ? `${item.name}, ${item.city}` : item.name}
    >
      {/* Un logo absent est le cas NOMINAL d'une salle qui vient de s'inscrire : on rend
          une pastille avec l'initiale plutôt qu'un cadre vide ou une image cassée. */}
      {item.logo_url ? (
        <Image source={{ uri: item.logo_url }} className="h-12 w-12 rounded-xl" resizeMode="contain" />
      ) : (
        // 🔴 GYM-301 (3) — LA PASTILLE PORTAIT LA CHARTE DE DOPAMINE SUR UN ÉCRAN VINIZ.
        // `bg-move-dark` + `text-move-accent`, c'est le noir #111111 et le lime #C8F000 de
        // Dopamine — posés ici sur du Violet Ink, pour représenter une salle TIERCE.
        //
        // ⚠️ CE N'EST PAS UNE ENTORSE À L'ATTENTE A-3/A-4. Ce que le cockpit a gelé, c'est
        // la DÉRIVATION d'un fond depuis le thème d'une salle. Ici la palette est fixe,
        // connue à l'écriture, et c'est celle de Viniz : il n'y a rien à dériver.
        <View className="h-12 w-12 items-center justify-center rounded-xl" style={{ backgroundColor: tokens.background }}>
          <Text className="font-barlow text-lg" style={{ color: tokens.accent }}>
            {item.name.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
      <View className="flex-1">
        <Text className="font-dmsans-bold text-base" style={{ color: tokens.onSurface }} numberOfLines={1}>
          {item.name}
        </Text>
        {/* GYM-229 — pas de ligne vide ni de libellé orphelin : sans commune, la ligne
            disparaît entièrement. */}
        {item.city ? (
          <View className="mt-0.5 flex-row items-center gap-1">
            <MapPin size={12} color={tokens.onBackgroundMuted} />
            <Text className="font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>{item.city}</Text>
          </View>
        ) : null}
      </View>
      {opening === item.slug ? <ActivityIndicator color={tokens.onSurfaceSecondary} /> : null}
    </TouchableOpacity>
  ), [handleSelect, opening, tokens])

  // ── Le message d'état. Chaque cas dit ce qui se passe, aucun ne dit « erreur ». ──────
  const renderState = () => {
    if (searching) {
      return (
        <View className="items-center py-10">
          <ActivityIndicator color={tokens.onSurface} />
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

  // 🔴 GYM-301 (3) — LE GARDE DE MODE, QUI MANQUAIT. Cet écran n'était atteint qu'en
  // multi (lancement Viniz, connexion de salle, lien profond inconnu — tous gardés), mais
  // rien ne l'empêchait LUI-MÊME de s'afficher en single. C'était sans conséquence tant
  // qu'il empruntait le thème ambiant ; depuis ce lot il porte une palette Viniz FIXE, et
  // un lien profond vers `/gym/select` peindrait du Violet Ink dans l'app de Dopamine.
  // Même garde que `profile/gym-switch.tsx` et `gym/not-member.tsx`.
  if (GYM_MODE === 'single') return <Redirect href="/+not-found" />

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.page }} edges={['top', 'bottom']}>
      <View className="flex-1 px-6 pt-4">
        <Text className="font-barlow text-3xl uppercase" style={{ color: tokens.onSurface }}>
          {t('gym_select.title')}
        </Text>
        <Text className="mt-2 font-dmsans text-sm" style={{ color: tokens.onSurfaceSecondary }}>
          {reason === 'unknown_gym' ? t('deep_link.unknown_gym') : t('gym_select.subtitle')}
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

      {/* ⚠️ MÊME COMPOSANT QUE SUR LES CONNEXIONS DE SALLE, pas une copie : il a été
          extrait de `BrandedLogin` pour ce lot. L'encre est passée explicitement — sans
          elle il lirait le thème AMBIANT, c'est-à-dire les couleurs d'une salle, sur le
          seul écran qui n'en représente aucune. */}
      <PoweredByViniz ink={tokens.onBackgroundMuted} />
    </SafeAreaView>
  )
}

function Hint({ text }: { text: string }) {
  const tokens = MARQUE_VINIZ
  return (
    <View className="items-center px-6 py-10">
      <Text className="text-center font-dmsans text-sm" style={{ color: tokens.onBackgroundMuted }}>{text}</Text>
    </View>
  )
}
