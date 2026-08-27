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

const AnimatedCircle = Animated.createAnimatedComponent(Circle)
const EASE_OUT = Easing.out(Easing.cubic)

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
    // GYM-286 — A-6, EN ATTENTE : #141414 est un quasi-noir voisin de `move-dark`
    // #111111. Le rattacher change des pixels : c'est le commit dédié qui s'en charge.
    <View className="overflow-hidden rounded-2xl p-5" style={{ backgroundColor: '#141414' }}>
      <View className="mb-3 flex-row items-center gap-3">
        <View className="h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
          <Text style={{ fontSize: 24 }}>{level.icon}</Text>
        </View>
        <View className="flex-1">
          <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 20, color: level.color }}>
            {level.name.toUpperCase()}
          </Text>
          <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: tokens.onBackground }}>
            {totalSeances} séances complétées
          </Text>
        </View>
      </View>
      {/* GYM-286 — A-6, EN ATTENTE : #333333, #666666, #888888 et #999999 sont quatre
          gris hors de la palette de la charte. */}
      <View className="mb-2 rounded-full" style={{ height: 8, backgroundColor: '#333333' }}>
        <Animated.View style={barStyle} />
      </View>
      <View className="flex-row justify-between">
        <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#666666' }}>
          {level.name} — {level.min}
        </Text>
        {nextLevel && (
          <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 11, color: '#888888' }}>
            {nextLevel.name} — {nextLevel.min}
          </Text>
        )}
      </View>
      {nextLevel && (
        <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: '#999999', marginTop: 8 }}>
          Plus que {remaining} séances pour {nextLevel.name} {nextLevel.icon}
        </Text>
      )}
    </View>
  )
}

function StreakCard({ streakWeeks, streakRecord }: { streakWeeks: number; streakRecord: number }) {
  const { tokens } = useTheme()
  return (
    <View className="flex-1 rounded-2xl p-4" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted, marginBottom: 4 }}>Streak</Text>
      <AnimatedNumber value={streakWeeks} delay={100} />
      <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: tokens.onSurfaceSecondary, marginTop: 2 }}>
        semaines d'affilée
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
        Record : {streakRecord} sem.
      </Text>
    </View>
  )
}

function AttendanceCard({ confirmed, noShow }: { confirmed: number; noShow: number }) {
  const { tokens } = useTheme()
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
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted, marginBottom: 8 }}>Présence</Text>
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
        {confirmed} confirmées · {noShow} no-shows
      </Text>
    </View>
  )
}

function MonthCard({ count, lastMonth }: { count: number; lastMonth: number }) {
  const { tokens } = useTheme()
  const delta = count - lastMonth
  const monthName = new Date().toLocaleDateString('fr-BE', { month: 'long' })
  return (
    <View className="flex-1 rounded-2xl p-4" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted, marginBottom: 4 }}>Ce mois</Text>
      <AnimatedNumber value={count} delay={300} />
      <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: tokens.onSurfaceSecondary, marginTop: 2, textTransform: 'capitalize' }}>
        {monthName}
      </Text>
      {delta !== 0 && (
        // GYM-286 — A-8 et A-2, EN ATTENTE : #639922 est le vert de variation positive
        // (rampe du studio), #E53935 un troisième rouge. Aucun jeton ne les vaut.
        <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 12, color: delta > 0 ? '#639922' : '#E53935', marginTop: 4 }}>
          {delta > 0 ? '+' : ''}{delta} vs mois dernier
        </Text>
      )}
    </View>
  )
}

function TotalCard({ total, memberSince }: { total: number; memberSince: string | null }) {
  const { tokens } = useTheme()
  const since = memberSince ? new Date(memberSince).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  return (
    <View className="flex-1 rounded-2xl p-4" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted, marginBottom: 4 }}>Total</Text>
      <AnimatedNumber value={total} delay={400} />
      {since ? (
        <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 12, color: tokens.onSurfaceSecondary, marginTop: 2 }}>
          depuis le {since}
        </Text>
      ) : null}
    </View>
  )
}

function HistogramCard({ data }: { data: { day: string; count: number }[] }) {
  const { tokens } = useTheme()
  const maxCount = Math.max(...data.map((d) => d.count), 1)
  const firstLabel = data[0]?.day.slice(5) ?? ''
  const midLabel = data[14]?.day.slice(5) ?? ''
  const lastLabel = data[29]?.day.slice(5) ?? ''

  return (
    <View className="rounded-2xl p-5" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted, marginBottom: 12 }}>
        30 derniers jours
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
    // GYM-286 — A-1, EN ATTENTE : #9DB800 est le lime atténué, non tranché.
    backgroundColor: count === 0 ? tokens.border : recent ? '#9DB800' : tokens.accent,
  }))

  return <Animated.View style={style} />
}

function HeatmapCard({ data }: { data: { week: string; count: number }[] }) {
  const { tokens } = useTheme()
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
      monthLabels.push({ label: d.toLocaleDateString('fr-BE', { month: 'short' }), col: i })
    }
  })

  return (
    <View className="rounded-2xl p-5" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted, marginBottom: 12 }}>
        Activité (6 mois)
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
        <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 10, color: tokens.onBackgroundMuted }}>Moins</Text>
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
              backgroundColor: v === 0 ? tokens.border : v === 1 ? '#C0DD97' : v === 2 ? '#97C459' : '#3B6D11',
            }}
          />
        ))}
        <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 10, color: tokens.onBackgroundMuted }}>Plus</Text>
      </View>
    </View>
  )
}

function HeatmapCell({ count, index, size }: { count: number; index: number; size: number }) {
  const opacity = useSharedValue(0)

  useEffect(() => {
    opacity.value = withDelay(index * 3, withTiming(1, { duration: 400 }))
  }, [])

  // GYM-286 — A-8 et A-6, EN ATTENTE : la rampe, et #F0EFEB (gris voisin de `move-bg`).
  const bg = count === 0 ? '#F0EFEB' : count === 1 ? '#C0DD97' : count === 2 ? '#97C459' : '#3B6D11'
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
  if (!data) return (
    <View className="flex-1 rounded-2xl p-4" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted }}>Cours favori</Text>
      <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: tokens.onSurfaceSecondary, marginTop: 8 }}>Aucun encore</Text>
    </View>
  )
  return (
    <View className="flex-1 rounded-2xl p-4" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted, marginBottom: 8 }}>Cours favori</Text>
      <View className="flex-row items-center gap-2">
        {/* GYM-286 — A-2, EN ATTENTE : #EF9F27 est un troisième orangé. */}
        <Flame size={16} color="#EF9F27" />
        <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 14, color: tokens.onSurface, flex: 1 }} numberOfLines={1}>
          {data.name}
        </Text>
      </View>
      <View className="mt-2 self-start rounded-full px-2.5 py-1" style={{ backgroundColor: tokens.page }}>
        <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 11, color: tokens.onSurfaceSecondary }}>{data.count} séances</Text>
      </View>
    </View>
  )
}

function FavoriteCoachCard({ data }: { data: { name: string; count: number } | null }) {
  const { tokens } = useTheme()
  const initials = data ? data.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() : ''
  if (!data) return (
    <View className="flex-1 rounded-2xl p-4" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted }}>Coach préféré</Text>
      <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 13, color: tokens.onSurfaceSecondary, marginTop: 8 }}>Aucun encore</Text>
    </View>
  )
  return (
    <View className="flex-1 rounded-2xl p-4" style={{ backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.border }}>
      <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 12, color: tokens.onBackgroundMuted, marginBottom: 8 }}>Coach préféré</Text>
      <View className="flex-row items-center gap-2">
        <View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: tokens.background }}>
          <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 12, color: tokens.accent }}>{initials}</Text>
        </View>
        <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 14, color: tokens.onSurface, flex: 1 }} numberOfLines={1}>
          {data.name}
        </Text>
      </View>
      <View className="mt-2 self-start rounded-full px-2.5 py-1" style={{ backgroundColor: tokens.page }}>
        <Text style={{ fontFamily: 'DMSans_500Medium', fontSize: 11, color: tokens.onSurfaceSecondary }}>{data.count} séances</Text>
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
            MA PROGRESSION
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
            MA PROGRESSION
          </Text>
        </View>
        <View className="flex-1 items-center justify-center px-6" style={{ backgroundColor: tokens.page }}>
          <Text style={{ fontFamily: 'DMSans_400Regular', fontSize: 14, color: tokens.onBackgroundMuted, textAlign: 'center' }}>
            {error ?? 'Impossible de charger ta progression'}
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top']}>
      <View className="px-5 pb-4 pt-3" style={{ backgroundColor: tokens.background }}>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 32, color: tokens.onBackground }}>
          MA PROGRESSION
        </Text>
        <Text className="font-dmsans text-[13px] text-white/40">
          Tes stats, ton niveau, ta régularité
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
