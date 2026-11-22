// GYM-389 — « Mise à jour requise ». Écran plein, sans « Plus tard » ni autre issue : la
// seule action est d'aller au store.
//
// GYM-389 (suite) — DESIGN B : plein écran aux couleurs de la salle. Secondaire en fond,
// primaire sur la tuile du logo, le nom et le bouton ; paire Viniz si elles sont inconnues
// ou illisibles (voir `couleursMiseAJour`). Seul le rendu change : les props, et donc toute
// la logique de blocage de `UpdateRequiredGate`, sont celles de la PR #347.
import { useState } from 'react'
import { View, Text, Image, Pressable, ActivityIndicator, type ImageSourcePropType } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Download } from 'lucide-react-native'
import { SvgXml } from 'react-native-svg'
import { VINIZ_PULSE_LINE_SVG } from '../../assets/viniz/brandSvg'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { useGymName } from '../../hooks/useGymName'
import { GYM_MODE } from '../../lib/gymResolver'
import {
  ENCRE_PIED, ENCRE_TEXTE, ENCRE_TITRE, couleursMiseAJour, initialeSalle,
} from './couleursMiseAJour'

/** Le pulse-V recadré sur l'emprise de son art (même cadrage que la barre d'onglets). */
const PULSE_VIEWBOX = '113 240 1277 1021'
const PULSE_H = 16
const PULSE_W = PULSE_H * (1277 / 1021)

interface Props {
  onUpdate: () => void
  opening: boolean
  /** true quand aucune URL de store n'a pu être ouverte. */
  openFailed: boolean
}

export function UpdateRequiredScreen({ onUpdate, opening, openFailed }: Props) {
  const { t } = useTranslation()
  const { tokens, brand } = useTheme()
  // Le nom de la salle s'il est connu, sinon celui de l'app (repli de `useGymName`).
  const nom = useGymName()
  const [logoEnEchec, setLogoEnEchec] = useState(false)
  const [appuye, setAppuye] = useState(false)

  // ⚠️ EN MODE SINGLE, AUCUNE MARQUE N'EST CHARGÉE (`brand` vaut null par construction) :
  // l'app de Dopamine prend ses deux couleurs dans son thème figé et son logo dans le
  // build — le même fichier que la barre d'onglets. En multi, tout vient de la marque.
  const single = GYM_MODE === 'single'
  const { fond, accent } = couleursMiseAJour(
    single ? tokens.accent : brand?.primaryColor,
    single ? tokens.background : brand?.secondaryColor,
  )
  const logo: ImageSourcePropType | null = single
    ? require('../../assets/dopamine-logo-d.png')
    : brand?.logoUrl
      ? { uri: brand.logoUrl }
      : null

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: fond }}>
      <View className="flex-1 items-center justify-center" style={{ paddingHorizontal: 28 }}>
        <View
          className="items-center justify-center overflow-hidden"
          style={{ width: 112, height: 112, borderRadius: 30, backgroundColor: accent }}
        >
          {logo && !logoEnEchec ? (
            <Image
              source={logo}
              style={{ width: 112, height: 112 }}
              resizeMode="contain"
              accessibilityRole="image"
              accessibilityLabel={nom}
              onError={() => setLogoEnEchec(true)}
            />
          ) : (
            <Text
              accessible={false}
              style={{ fontFamily: 'DMSans_700Bold', fontSize: 52, lineHeight: 60, color: fond }}
            >
              {initialeSalle(nom)}
            </Text>
          )}
        </View>

        <Text
          className="mt-5 text-center"
          style={{ fontFamily: 'DMSans_500Medium', fontWeight: '600', fontSize: 13, letterSpacing: 1.2, color: accent }}
        >
          {nom.toUpperCase()}
        </Text>

        <Text
          accessibilityRole="header"
          className="mt-3 text-center"
          style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 32, lineHeight: 36, color: ENCRE_TITRE }}
        >
          {t('update_required.title')}
        </Text>

        <Text
          className="mt-3 text-center"
          style={{ fontFamily: 'DMSans_400Regular', fontSize: 16, lineHeight: 24, color: ENCRE_TEXTE }}
        >
          {t('update_required.message')}
        </Text>
      </View>

      <View style={{ paddingHorizontal: 28, paddingBottom: 28 }}>
        {openFailed && (
          <Text
            className="mb-3 text-center"
            style={{ fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, color: ENCRE_TITRE }}
          >
            {t('update_required.open_failed', { name: nom })}
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('update_required.button')}
          accessibilityState={{ busy: opening, disabled: opening }}
          disabled={opening}
          onPress={onUpdate}
          onPressIn={() => setAppuye(true)}
          onPressOut={() => setAppuye(false)}
          // 🔴 NI `className` NI `style` EN FONCTION SUR CE PRESSABLE. NativeWind (css-interop)
          // recopie le `style` par étalement dès qu'un `className` est présent : une fonction
          // `({ pressed }) => …` s'étale en objet VIDE, et le bouton perdait fond, hauteur et
          // arrondi — son libellé, de la couleur du fond, devenait invisible. Constaté sur
          // appareil (build staging du 22/11). Le style est donc un objet, et l'état appuyé
          // un état React. `tests/ecranMiseAJour.test.ts` refuse le retour de ce motif.
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            height: 56,
            borderRadius: 28,
            gap: 10,
            backgroundColor: accent,
            opacity: appuye || opening ? 0.8 : 1,
          }}
        >
          {opening ? (
            <ActivityIndicator color={fond} />
          ) : (
            <>
              <Download size={20} color={fond} strokeWidth={2} />
              <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 16, color: fond }}>
                {t('update_required.button')}
              </Text>
            </>
          )}
        </Pressable>

        <View className="mt-5 flex-row items-center justify-center" style={{ gap: 6 }}>
          <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: ENCRE_PIED }}>
            {t('update_required.powered_by')}
          </Text>
          {/* Le vrai logo Viniz : le pulse-V, statique, dans ses couleurs d'origine (lime).
              `couleursMiseAJour` garantit qu'il se détache du fond retenu. */}
          <SvgXml
            xml={VINIZ_PULSE_LINE_SVG}
            viewBox={PULSE_VIEWBOX}
            width={PULSE_W}
            height={PULSE_H}
            accessible={false}
          />
          <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 13, color: ENCRE_TITRE }}>viniz</Text>
        </View>
      </View>
    </SafeAreaView>
  )
}
