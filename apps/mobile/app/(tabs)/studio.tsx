import { useEffect, useState, useCallback } from 'react'
import { View, Text, ScrollView, ActivityIndicator } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Flame, Heart } from 'lucide-react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withTiming,
  withDelay,
  Easing,
  runOnJS,
} from 'react-native-reanimated'
import Svg, { Circle } from 'react-native-svg'
import { useAuthStore } from '../../stores/useAuthStore'
import { useProgression } from '../../hooks/useProgression'
import { getLevelInfo } from '../../utils/gamification'
import { getGymMonday } from '../../utils/timezone'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)
const EASE_OUT = Easing.out(Easing.cubic)

// ╔═══════════════════════════════════════════════════════════════════════════════════════╗
// ║  GYM-74 — LES DATES SUIVENT LA LANGUE, ET PLUS 'fr-BE' EN DUR                         ║
// ╚═══════════════════════════════════════════════════════════════════════════════════════╝
//
// Cet écran appelait `toLocaleDateString('fr-BE', …)` à TROIS endroits : le nom du mois en
// cours, la date d'adhésion, et les étiquettes de mois de la carte d'activité. Ce sont les
// chaînes les plus insidieuses du lot — invisibles dans le JSX, elles auraient rendu
// « septembre » au beau milieu d'une app anglaise sans qu'aucune relecture du JSX ne le voie.
//
// ⚠️ `fr` EST REMAPPÉ VERS `fr-BE`, DÉLIBÉRÉMENT. Le rendu français d'aujourd'hui doit
// rester au caractère près : `fr` et `fr-BE` diffèrent sur des détails d'abréviation, et
// Dopamine ne doit voir AUCUN changement. Les autres langues prennent leur tag tel quel.
//
// ⚠️ ENVELOPPÉ DANS UN try/catch, comme `formatPrice` de lib/payments.ts : c'est le motif
// du dépôt pour `Intl`, dont la disponibilité dépend du binaire Hermes embarqué.
const TAGS: Record<string, string> = { fr: 'fr-BE' }

function formatDateLocale(
  date: Date,
  options: Intl.DateTimeFormatOptions,
  langue: string,
): string {
  const tag = TAGS[langue] ?? langue ?? 'fr-BE'
  try {
    return date.toLocaleDateString(tag, options)
  } catch {
    return date.toLocaleDateString('fr-BE', options)
  }
}

function AnimatedNumber({ value, delay = 0, suffix = '' }: { value: number; delay?: number; suffix?: string }) {
  const { tokens } = useTheme()
  const [display, setDisplay] = useState(0)
  const anim = useSharedValue(0)
  const updater = useCallback((v: number) => setDisplay(Math.round(v)), [])

  useEffect(() => {
    anim.value = withDelay(delay, withTiming(value, { duration: 1200, easing: EASE_OUT }, () => {
      runOnJS(updater)(value)
    }))
    const id = setInterval(() => setDisplay(Math.round(anim.value)), 16)
    const timeout = setTimeout(() => clearInterval(id), delay + 1300)
    return () => { clearInterval(id); clearTimeout(timeout) }
  }, [value])

  return (
    <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 36, color: tokens.onSurface }}>
      {display}{suffix}
    </Text>
  )
}

function LevelCard({ totalSeances }: { totalSeances: number }) {
  const { tokens } = useTheme()
  const { t } = useTranslation()
  const { level, progress, nextLevel, remaining } = getLevelInfo(totalSeances)
  const barWidth = useSharedValue(0)

  useEffect(() => {
    barWidth.value = withDelay(200, withTiming(progress * 100, { duration: 1200, easing: EASE_OUT }))
  }, [progress])

  const barStyle = useAnimatedStyle(() => ({
    width: `${barWidth.value}%`,
    height: 8,
    borderRadius: 4,
    backgroundColor: level.color,
  }))

  return (
    // GYM-286 (A-6) — RATTACHÉ. #141414 → `tokens.background` #111111 : trois unités
    // d'écart sur le canal le plus éloigné, imperceptible. C'est un quasi-noir qui
    // n'avait pas de raison d'exister à côté du noir de la charte.
    <View className="overflow-hidden rounded-2xl p-5" style={{ backgroundColor: tokens.background }}>
      <View className="mb-3 flex-row items-center gap-3">
        <View className="h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
          <Text style={{ fontSize: 24 }}>{level.icon}</Text>
        </View>
        <View className="flex-1">
          <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 20, color: level.color }}>
            {level.name.toUpperCase()}
          </Text>
          <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: tokens.onBackground }}>
            {t('studio.sessions_completed', { count: totalSeances })}
          </Text>
        </View>
      </View>
      {/* GYM-286 — A-6, EN ATTENTE. #333333 et #888888 restent : ils n'ont PAS de voisin.
          Le jeton le plus proche est à 34 et 18 unités sur le canal le plus éloigné — les
          rattacher ne serait pas un alignement imperceptible mais un changement visible
          présenté comme tel. #333333 est de surcroît la PISTE d'une barre de progression
          posée sur une carte #111111 : la ramener au fond effacerait la piste.
          Il manque à la charte un gris NEUTRE SUR FOND SOMBRE. Remonté au cockpit. */}
      <View className="mb-2 rounded-full" style={{ height: 8, backgroundColor: tokens.rail }}>
        <Animated.View style={barStyle} />
      </View>
      <View className="flex-row justify-between">
        {/* GYM-286 (A-6) — RATTACHÉ. #666666 → `onSurfaceSecondary` #6B6861, écart 5. */}
        <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 11, color: tokens.onSurfaceSecondary }}>
          {level.name} — {level.min}
        </Text>
        {/* 🔴 GYM-290 (A-6) — #888888 EST DU TEXTE, PAS UN RAIL. Il n'a donc pas sa
            place dans le jeton `rail` : une marque inerte et une encre n'ont ni le même
            rôle ni le même seuil. Il rejoint l'encre atténuée, validée à 4,5:1.
            ⚠️ Change un pixel chez Dopamine (#888888 → #9A9890, 18 unités) — c'est le
            « changement visuel assumé » que la recommandation d'A-6 annonçait. */}
        {nextLevel && (
          <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 11, color: tokens.onBackgroundMuted }}>
            {nextLevel.name} — {nextLevel.min}
          </Text>
        )}
      </View>
      {nextLevel && (
        // GYM-286 (A-6) — RATTACHÉ. #999999 → `onBackgroundMuted` #9A9890, écart 9.
        <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: tokens.onBackgroundMuted, marginTop: 8 }}>
          {/* ⚠️ `level.name` et `level.icon` NE SONT PAS TRADUITS ICI — ils viennent de
              `utils/gamification.ts` (Rookie, Regular, Warrior, Champion, Légende) et
              sont interpolés tels quels. Voir la recette : ils vivent hors de cet écran
              et leur traduction est un arbitrage produit, pas une extraction. */}
          {t('studio.next_level', { count: remaining, level: nextLevel.name, icon: nextLevel.icon })}
        </Text>
      )}
    </View>
  )
}

function StreakCard({ streakWeeks, streakRecord }: { streakWeeks: number; streakRecord: number }) {
  const { tokens } = useTheme()
  const { t } = useTranslation()
  return (
    <View className="flex-1 rounded-2xl p-4" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted, marginBottom: 4 }}>{t('studio.streak')}</Text>
      <AnimatedNumber value={streakWeeks} delay={100} />
      <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: tokens.onSurfaceSecondary, marginTop: 2 }}>
        {/* Le NOMBRE est rendu par `AnimatedNumber` juste au-dessus : cette ligne ne
            porte que l'unité. La forme plurielle dépend quand même de lui — i18next
            accepte un `count` qui ne figure pas dans le libellé. */}
        {t('studio.streak_weeks', { count: streakWeeks })}
      </Text>
      <View className="mt-3 flex-row gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: i < Math.min(streakWeeks, 4) ? tokens.accent : tokens.border }}
          />
        ))}
      </View>
      <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 11, color: tokens.onBackgroundMuted, marginTop: 6 }}>
        {t('studio.streak_record', { count: streakRecord })}
      </Text>
    </View>
  )
}

function AttendanceCard({ confirmed, noShow }: { confirmed: number; noShow: number }) {
  const { tokens } = useTheme()
  const { t } = useTranslation()
  const total = confirmed + noShow
  const rate = total > 0 ? confirmed / total : 1
  const pct = Math.round(rate * 100)
  const radius = 32
  const strokeWidth = 6
  const circumference = 2 * Math.PI * radius
  const animProgress = useSharedValue(circumference)

  useEffect(() => {
    animProgress.value = withDelay(
      200,
      withTiming(circumference * (1 - rate), { duration: 1200, easing: EASE_OUT }),
    )
  }, [rate])

  const circleProps = useAnimatedProps(() => ({
    strokeDashoffset: animProgress.value,
  }))

  return (
    <View className="flex-1 rounded-2xl p-4" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted, marginBottom: 8 }}>{t('studio.attendance')}</Text>
      <View className="items-center">
        <View style={{ width: 76, height: 76 }}>
          <Svg width={76} height={76} viewBox="0 0 76 76">
            <Circle cx={38} cy={38} r={radius} stroke={tokens.border} strokeWidth={strokeWidth} fill="none" />
            <AnimatedCircle
              cx={38}
              cy={38}
              r={radius}
              stroke={tokens.accent}
              strokeWidth={strokeWidth}
              fill="none"
              strokeDasharray={circumference}
              animatedProps={circleProps}
              strokeLinecap="round"
              transform="rotate(-90 38 38)"
            />
          </Svg>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 20, color: tokens.onSurface }}>{pct}%</Text>
          </View>
        </View>
      </View>
      <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 11, color: tokens.onBackgroundMuted, textAlign: 'center', marginTop: 6 }}>
        {/* 🔴 DEUX NOMBRES, DEUX PLURIELS — i18next ne sait pas fléchir deux `count`
            dans une même clé. On compose donc deux clés fléchies séparément et on les
            joint, EXACTEMENT comme `useSubscriptionSummary` le fait pour « Illimité ·
            3 séances » (`parts.join(' · ')`, GYM-208). Reprendre ce mécanisme plutôt
            que d'en inventer un troisième. */}
        {[
          t('studio.attendance_confirmed', { count: confirmed }),
          t('studio.attendance_noshow', { count: noShow }),
        ].join(' · ')}
      </Text>
    </View>
  )
}

function MonthCard({ count, lastMonth }: { count: number; lastMonth: number }) {
  const { tokens } = useTheme()
  const { t, i18n } = useTranslation()
  const delta = count - lastMonth
  const monthName = formatDateLocale(new Date(), { month: 'long' }, i18n.language)
  return (
    <View className="flex-1 rounded-2xl p-4" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted, marginBottom: 4 }}>{t('studio.this_month')}</Text>
      <AnimatedNumber value={count} delay={300} />
      <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: tokens.onSurfaceSecondary, marginTop: 2, textTransform: 'capitalize' }}>
        {monthName}
      </Text>
      {/* 🔴 GYM-290 (décision C, A-2) — UNE VARIATION SIGNÉE EST UN SIGNAL, PAS UNE
          LECTURE. Le couple disait « ça monte / ça descend » avec un vert et un rouge de
          marque : il rejoint le couple sémantique, qui ne suit jamais la salle. Le vert
          #639922 était par ailleurs le quatrième vert de la rampe d'A-8 sans en être un
          palier — un orphelin de plus. */}
      {delta !== 0 && (
        <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 12, color: delta > 0 ? SEMANTIC.success : SEMANTIC.danger, marginTop: 4 }}>
          {/* Le signe est composé ICI et passé comme texte : une variation signée se
              lit « +3 » dans toutes les langues, et la faire fléchir n'aurait pas de sens. */}
          {t('studio.vs_last_month', { delta: `${delta > 0 ? '+' : ''}${delta}` })}
        </Text>
      )}
    </View>
  )
}

function TotalCard({ total, memberSince }: { total: number; memberSince: string | null }) {
  const { tokens } = useTheme()
  const { t, i18n } = useTranslation()
  const since = memberSince
    ? formatDateLocale(new Date(memberSince), { day: 'numeric', month: 'short', year: 'numeric' }, i18n.language)
    : ''
  return (
    <View className="flex-1 rounded-2xl p-4" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted, marginBottom: 4 }}>{t('studio.total')}</Text>
      <AnimatedNumber value={total} delay={400} />
      {since ? (
        <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: tokens.onSurfaceSecondary, marginTop: 2 }}>
          {t('studio.member_since', { date: since })}
        </Text>
      ) : null}
    </View>
  )
}

function HistogramCard({ data }: { data: { day: string; count: number }[] }) {
  const { tokens } = useTheme()
  const { t } = useTranslation()
  const maxCount = Math.max(...data.map((d) => d.count), 1)
  const firstLabel = data[0]?.day.slice(5) ?? ''
  const midLabel = data[14]?.day.slice(5) ?? ''
  const lastLabel = data[29]?.day.slice(5) ?? ''

  return (
    <View className="rounded-2xl p-5" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted, marginBottom: 12 }}>
        {t('studio.last_30_days')}
      </Text>
      <View className="flex-row items-end justify-between" style={{ height: 80 }}>
        {data.map((d, i) => {
          const isRecent = i >= 23
          return <HistoBar key={d.day} count={d.count} maxCount={maxCount} index={i} recent={isRecent} />
        })}
      </View>
      <View className="mt-2 flex-row justify-between">
        <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 10, color: tokens.onBackgroundMuted }}>{firstLabel}</Text>
        <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 10, color: tokens.onBackgroundMuted }}>{midLabel}</Text>
        <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 10, color: tokens.onBackgroundMuted }}>{lastLabel}</Text>
      </View>
    </View>
  )
}

function HistoBar({ count, maxCount, index, recent }: { count: number; maxCount: number; index: number; recent: boolean }) {
  const { tokens } = useTheme()
  const height = count > 0 ? (count / maxCount) * 100 : 2.5
  const scaleY = useSharedValue(0)

  useEffect(() => {
    scaleY.value = withDelay(index * 20, withTiming(1, { duration: 600, easing: EASE_OUT }))
  }, [])

  const style = useAnimatedStyle(() => ({
    height: height * scaleY.value + (count === 0 ? 2 : 0),
    width: 6,
    borderRadius: 3,
    // 🔴 GYM-290 (A-1 + A-5) — A-1 a tranché : ici #9DB800 est de la MARQUE (une lecture
    // d'affluence récente), pas un succès. Il rejoint donc `accentDim`, devenu une vraie
    // dérivation par A-5 au lieu d'un alias de `accent`.
    backgroundColor: count === 0 ? tokens.border : recent ? tokens.accentDim : tokens.accent,
  }))

  return <Animated.View style={style} />
}

function HeatmapCard({ data }: { data: { week: string; count: number }[] }) {
  const { tokens } = useTheme()
  const { t, i18n } = useTranslation()
  const weekMap = new Map(data.map((d) => [d.week, d.count]))
  // GYM-93 — frontières de semaine sur l'horloge de la SALLE, pas du téléphone. Même
  // défaut que le filtre de période du planning : le dimanche soir à Bruxelles est déjà
  // lundi plus à l'est, et toute la grille des 26 semaines glissait d'une colonne.
  const thisMonday = getGymMonday()

  const weeks: { key: string; count: number }[] = []
  for (let w = 25; w >= 0; w--) {
    const d = new Date(thisMonday)
    d.setDate(thisMonday.getDate() - w * 7)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const key = `${y}-${m}-${dd}`
    weeks.push({ key, count: weekMap.get(key) ?? 0 })
  }

  // GYM-46 — cellule dimensionnée depuis la largeur RÉELLE du conteneur (onLayout),
  // plus aucune largeur codée en dur : cellSize = (largeur - gaps) / nbColonnes.
  // Empêche les carrés de déborder hors de la card sur petits écrans (avant : 26×10
  // + 25×4 = 360pt fixes > ~321pt dispo sur iPhone 15 Pro → débordement).
  const gap = 4
  const [rowWidth, setRowWidth] = useState(0)
  const cols = weeks.length
  const cellSize = rowWidth > 0 ? (rowWidth - gap * (cols - 1)) / cols : 0
  const colWidth = cellSize + gap

  const monthLabels: { label: string; col: number }[] = []
  let prevMonth = -1
  weeks.forEach((w, i) => {
    const d = new Date(w.key)
    if (d.getMonth() !== prevMonth) {
      prevMonth = d.getMonth()
      monthLabels.push({ label: formatDateLocale(d, { month: 'short' }, i18n.language), col: i })
    }
  })

  return (
    <View className="rounded-2xl p-5" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted, marginBottom: 12 }}>
        {t('studio.activity_6_months')}
      </Text>
      <View
        className="flex-row"
        style={{ gap }}
        onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
      >
        {cellSize > 0 && weeks.map((w, i) => (
          <HeatmapCell key={w.key} count={w.count} index={i} size={cellSize} />
        ))}
      </View>
      <View className="mt-2" style={{ height: 14, position: 'relative' }}>
        {cellSize > 0 && monthLabels.map((m) => (
          <Text
            key={m.label + m.col}
            style={{
              fontFamily: 'DMSans_400Regular',
              fontSize: 9,
              color: tokens.onBackgroundMuted,
              position: 'absolute',
              left: m.col * colWidth,
            }}
          >
            {m.label}
          </Text>
        ))}
      </View>
      <View className="mt-2 flex-row items-center gap-1">
        <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 10, color: tokens.onBackgroundMuted }}>{t('studio.less')}</Text>
        {[0, 1, 2, 3].map((v) => (
          <View
            key={v}
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              // GYM-286 — A-8, EN ATTENTE : la rampe d'affluence (trois verts) attend une
              // dérivation de `accent` qui garantisse trois paliers distinguables sur
              // n'importe quelle primaire — un vrai travail, pas un remplacement.
              backgroundColor: v === 0 ? tokens.border : v === 1 ? tokens.ramp[0] : v === 2 ? tokens.ramp[1] : tokens.ramp[2],
            }}
          />
        ))}
        <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 10, color: tokens.onBackgroundMuted }}>{t('studio.more')}</Text>
      </View>
    </View>
  )
}

function HeatmapCell({ count, index, size }: { count: number; index: number; size: number }) {
  const { tokens } = useTheme()
  const opacity = useSharedValue(0)

  useEffect(() => {
    opacity.value = withDelay(index * 3, withTiming(1, { duration: 400 }))
  }, [])

  // GYM-286 (A-6) — RATTACHÉ : #F0EFEB → `tokens.page` #F5F4F0, écart 5.
  // GYM-286 — A-8, EN ATTENTE : la rampe d'affluence (trois verts) reste en dur.
  const bg = count === 0 ? tokens.page : count === 1 ? tokens.ramp[0] : count === 2 ? tokens.ramp[1] : tokens.ramp[2]
  const style = useAnimatedStyle(() => ({
    width: size,
    height: size,
    borderRadius: 2,
    backgroundColor: bg,
    opacity: opacity.value,
  }))

  return <Animated.View style={style} />
}

function FavoriteCoursCard({ data }: { data: { name: string; count: number } | null }) {
  const { tokens } = useTheme()
  const { t } = useTranslation()
  if (!data) return (
    <View className="flex-1 rounded-2xl p-4" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted }}>{t('studio.favorite_class')}</Text>
      {/* ⚠️ ÉTAT VIDE — c'est celui qu'on oublie, et celui que voit un membre qui n'a
          encore rien fait. Traduit au même titre que les titres. */}
      <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: tokens.onSurfaceSecondary, marginTop: 8 }}>{t('studio.none_yet')}</Text>
    </View>
  )
  return (
    <View className="flex-1 rounded-2xl p-4" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted, marginBottom: 8 }}>{t('studio.favorite_class')}</Text>
      <View className="flex-row items-center gap-2">
        {/* 🔴 GYM-290 (décision C, A-2) — FUSION : le troisième orangé rejoint `warning`. */}
        <Flame size={16} color={SEMANTIC.warning} />
        <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 14, color: tokens.onSurface, flex: 1 }} numberOfLines={1}>
          {data.name}
        </Text>
      </View>
      <View className="mt-2 self-start rounded-full px-2.5 py-1" style={{ backgroundColor: tokens.page }}>
        <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 11, color: tokens.onSurfaceSecondary }}>{t('studio.sessions_count', { count: data.count })}</Text>
      </View>
    </View>
  )
}

function FavoriteCoachCard({ data }: { data: { name: string; count: number } | null }) {
  const { tokens } = useTheme()
  const { t } = useTranslation()
  const initials = data ? data.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() : ''
  if (!data) return (
    <View className="flex-1 rounded-2xl p-4" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted }}>{t('studio.favorite_coach')}</Text>
      <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: tokens.onSurfaceSecondary, marginTop: 8 }}>{t('studio.none_yet')}</Text>
    </View>
  )
  return (
    <View className="flex-1 rounded-2xl p-4" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted, marginBottom: 8 }}>{t('studio.favorite_coach')}</Text>
      <View className="flex-row items-center gap-2">
        <View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: tokens.background }}>
          <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 12, color: tokens.accent }}>{initials}</Text>
        </View>
        <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 14, color: tokens.onSurface, flex: 1 }} numberOfLines={1}>
          {data.name}
        </Text>
      </View>
      <View className="mt-2 self-start rounded-full px-2.5 py-1" style={{ backgroundColor: tokens.page }}>
        <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 11, color: tokens.onSurfaceSecondary }}>{t('studio.sessions_count', { count: data.count })}</Text>
      </View>
    </View>
  )
}

export default function Studio() {
  const { tokens } = useTheme()
  const { t } = useTranslation()
  const gymId = useAuthStore((s) => s.gym_id)
  const memberId = useAuthStore((s) => s.user?.id)
  const { data, loading, error } = useProgression(gymId, memberId)

  if (loading) {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top']}>
        <View className="px-5 pb-4 pt-3" style={{ backgroundColor: tokens.background }}>
          <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 32, color: tokens.onBackground }}>
            {t('studio.progression_title')}
          </Text>
        </View>
        <View className="flex-1 items-center justify-center" style={{ backgroundColor: tokens.page }}>
          <ActivityIndicator size="large" color={tokens.accent} />
        </View>
      </SafeAreaView>
    )
  }

  if (error || !data) {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top']}>
        <View className="px-5 pb-4 pt-3" style={{ backgroundColor: tokens.background }}>
          <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 32, color: tokens.onBackground }}>
            {t('studio.progression_title')}
          </Text>
        </View>
        <View className="flex-1 items-center justify-center px-6" style={{ backgroundColor: tokens.page }}>
          <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 14, color: tokens.onBackgroundMuted, textAlign: 'center' }}>
            {/* ╔═══════════════════════════════════════════════════════════════════════╗
                🔴 GYM-74 — `error` N'EST PLUS AFFICHÉ, ET CE N'EST PAS UN OUBLI.
                ╚═══════════════════════════════════════════════════════════════════════╝
                `useProgression` remplit `error` avec `res?.message ?? fnError?.message
                ?? 'Erreur'` : une chaîne venue du SERVEUR ou du SDK Supabase. Elle est
                donc intraduisible par construction — et, accessoirement, elle exposait
                au membre un détail technique qu'il ne peut pas lire (même famille que
                GYM-346 : le détail va dans les journaux, pas dans l'écran).

                Le membre voit désormais un message utile et traduit ; le détail reste
                dans `error`, disponible pour le diagnostic. */}
            {t('studio.load_error')}
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top']}>
      <View className="px-5 pb-4 pt-3" style={{ backgroundColor: tokens.background }}>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 32, color: tokens.onBackground }}>
          {t('studio.progression_title')}
        </Text>
        {/* 🔴 GYM-300 (3c) — ENCRE RÉSOLUE, OPACITÉ CONSERVÉE. `text-white/40` était un
            BLANC EN DUR : illisible dès que la salle a un fond clair, et l'en-tête de
            Studio Test le montrait — le nom de la salle disparaissait purement et
            simplement de sa propre bande.

            ⚠️ ET `onBackgroundMuted` N'AURAIT PAS FAIT L'AFFAIRE. Chez Dopamine il vaut
            #9A9890, alors qu'un blanc à 40 % sur #111111 rend #707070 : le
            remplacement direct aurait déplacé un pixel en single, ce que le cadrage
            interdit. `tokens.onBackground + '66'` rend EXACTEMENT le blanc à 40 % chez
            Dopamine (0x66 = 102, soit 102/255 = 0,40 pile), et l'encre de la salle
            ailleurs. C'est le motif A-10 de GYM-286 : on migre la teinte, on ne touche
            pas à l'alpha.

            ⚠️ ALPHA SUR LA COULEUR, PAS `opacity` SUR L'ÉLÉMENT — les deux rendent
            pareil ICI, mais `opacity` s'applique à toute la descendance : le jour où ce
            `Text` accueille une icône ou un second fragment, elle les délaverait aussi.
            L'alpha dans la couleur ne teinte que ce qu'elle colore. */}
        <Text
          className="font-dmsans text-[13px]"
          style={{ color: tokens.onBackground + '66' }}
        >
          {t('studio.progression_subtitle')}
        </Text>
      </View>
      <ScrollView className="flex-1" style={{ backgroundColor: tokens.page }} contentContainerStyle={{ padding: 16, gap: 12 }} showsVerticalScrollIndicator={false}>
        <LevelCard totalSeances={data.total_seances} />

        <View className="flex-row gap-3">
          <StreakCard streakWeeks={data.streak_weeks} streakRecord={data.streak_record} />
          <AttendanceCard confirmed={data.confirmed_count} noShow={data.no_show_count} />
        </View>

        <View className="flex-row gap-3">
          <MonthCard count={data.seances_this_month} lastMonth={data.seances_last_month} />
          <TotalCard total={data.total_seances} memberSince={data.membre_since} />
        </View>

        <HistogramCard data={data.histo_30j} />

        <HeatmapCard data={data.heatmap_52w} />

        <View className="flex-row gap-3">
          <FavoriteCoursCard data={data.cours_favori} />
          <FavoriteCoachCard data={data.coach_favori} />
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  )
}
