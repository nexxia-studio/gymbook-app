// GYM-301 — LA SIGNATURE VINIZ, EXTRAITE POUR ÊTRE PARTAGÉE.
//
// Elle vivait en fonction privée dans `BrandedLogin.tsx`. L'écran de recherche et l'écran
// « pas encore membre » la portent désormais aussi — et la recopier trois fois aurait
// garanti qu'un jour l'une des trois garde un lime en dur sur un fond clair, ou une taille
// d'un pixel différente. Elle est donc EXTRAITE, pas dupliquée : un seul recadrage, une
// seule règle de teinte, un seul endroit à corriger.
import { useMemo } from 'react'
import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SvgXml } from 'react-native-svg'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { VINIZ_WORDMARK_SVG } from '../../assets/viniz/brandSvg'

/** Recadrage du wordmark sur l'emprise mesurée de son art (cf. VinizLaunch). */
const WORDMARK_VIEWBOX = '90 574 1275 353'
const WORDMARK_W = 62

/**
 * La signature Viniz en pied.
 *
 * ⚠️ LE WORDMARK EST RETEINT, ET IL LE FAUT. Son art est du lime #C8FF3D en dur dans le
 * SVG — or le lime ne va que sur fond sombre. Posé tel quel sur une salle aux couleurs
 * claires, il deviendrait illisible : exactement ce que le garde-fou interdit. Une prop
 * `color` de react-native-svg ne suffirait pas — elle n'alimente que `currentColor`, et
 * ces chemins portent un `fill` explicite. On remplace donc la valeur dans le XML, une
 * fois par teinte.
 *
 * ⚠️ `ink` EST OPTIONNELLE, ET SON DÉFAUT EST CE QUI GARANTIT LA NON-RÉGRESSION. Sans
 * argument, elle rend exactement ce que rendait la version privée de `BrandedLogin` :
 * l'encre atténuée du thème AMBIANT. Les appelants qui peignent un fond que le thème
 * ambiant ne décrit PAS — l'écran de recherche est aux couleurs Viniz, l'écran « pas
 * encore membre » à celles de la salle demandée — passent la leur, sinon la signature
 * s'accorderait à une salle qui n'est pas celle affichée.
 */
export function PoweredByViniz({ ink }: { ink?: string }) {
  const { t } = useTranslation()
  const { tokens } = useTheme()
  const tinted = useMemo(
    () => VINIZ_WORDMARK_SVG.replace(/#c8ff3d/gi, ink ?? tokens.onBackgroundMuted),
    [ink, tokens.onBackgroundMuted],
  )

  return (
    <View className="flex-row items-center justify-center gap-2 pb-3" style={{ opacity: 0.75 }}>
      <Text className="font-dmsans text-[11px]" style={{ color: ink ?? tokens.onBackgroundMuted }}>
        {t('branding.powered_by')}
      </Text>
      <SvgXml
        xml={tinted}
        viewBox={WORDMARK_VIEWBOX}
        width={WORDMARK_W}
        height={WORDMARK_W * (353 / 1275)}
      />
    </View>
  )
}
