import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function err(status: number, message: string, code?: string) {
  return json({ error: true, code: code ?? 'ERROR', message }, status)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return err(401, 'Non authentifié', 'UNAUTHORIZED')

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const supabaseAdmin = createClient(supabaseUrl, serviceKey)

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) return err(401, 'Non authentifié', 'UNAUTHORIZED')

    const body = await req.json() as { gym_id: string; member_id: string }
    const { gym_id: gymId, member_id: memberId } = body
    if (!gymId || !memberId) return err(400, 'gym_id et member_id requis', 'MISSING_PARAMS')

    const confirmed = await supabaseAdmin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', memberId)
      .eq('gym_id', gymId)
      .eq('status', 'confirmed')
    const totalSeances = confirmed.count ?? 0

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()

    const thisMonth = await supabaseAdmin
      .from('bookings')
      .select('id, time_slots!inner(starts_at)', { count: 'exact', head: true })
      .eq('member_id', memberId)
      .eq('gym_id', gymId)
      .eq('status', 'confirmed')
      .gte('time_slots.starts_at', monthStart)
      .lt('time_slots.starts_at', nextMonthStart)
    const seancesThisMonth = thisMonth.count ?? 0

    const lastMonth = await supabaseAdmin
      .from('bookings')
      .select('id, time_slots!inner(starts_at)', { count: 'exact', head: true })
      .eq('member_id', memberId)
      .eq('gym_id', gymId)
      .eq('status', 'confirmed')
      .gte('time_slots.starts_at', lastMonthStart)
      .lt('time_slots.starts_at', monthStart)
    const seancesLastMonth = lastMonth.count ?? 0

    const noShow = await supabaseAdmin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', memberId)
      .eq('gym_id', gymId)
      .eq('status', 'no_show')
    const noShowCount = noShow.count ?? 0

    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString()
    const { data: histo30Raw } = await supabaseAdmin
      .from('bookings')
      .select('time_slots!inner(starts_at)')
      .eq('member_id', memberId)
      .eq('gym_id', gymId)
      .eq('status', 'confirmed')
      .gte('time_slots.starts_at', thirtyDaysAgo)

    const histo30Map: Record<string, number> = {}
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000)
      histo30Map[d.toISOString().slice(0, 10)] = 0
    }
    for (const row of histo30Raw ?? []) {
      const ts = (row as { time_slots: { starts_at: string } | { starts_at: string }[] }).time_slots
      const arr = Array.isArray(ts) ? ts : [ts]
      const day = arr[0]?.starts_at?.slice(0, 10)
      if (day && day in histo30Map) histo30Map[day]++
    }
    const histo30j = Object.entries(histo30Map).map(([day, count]) => ({ day, count }))

    const oneYearAgo = new Date(now.getTime() - 52 * 7 * 86400000).toISOString()
    const { data: heatmapRaw } = await supabaseAdmin
      .from('bookings')
      .select('time_slots!inner(starts_at)')
      .eq('member_id', memberId)
      .eq('gym_id', gymId)
      .eq('status', 'confirmed')
      .gte('time_slots.starts_at', oneYearAgo)

    const weekMap: Record<string, number> = {}
    for (const row of heatmapRaw ?? []) {
      const ts = (row as { time_slots: { starts_at: string } | { starts_at: string }[] }).time_slots
      const arr = Array.isArray(ts) ? ts : [ts]
      const d = arr[0]?.starts_at ? new Date(arr[0].starts_at) : null
      if (!d) continue
      const dayOfWeek = d.getDay()
      const monday = new Date(d)
      monday.setDate(d.getDate() - ((dayOfWeek + 6) % 7))
      const weekKey = monday.toISOString().slice(0, 10)
      weekMap[weekKey] = (weekMap[weekKey] ?? 0) + 1
    }
    const heatmap52w = Object.entries(weekMap)
      .map(([week, count]) => ({ week, count }))
      .sort((a, b) => a.week.localeCompare(b.week))

    const sortedWeeks = heatmap52w.slice().sort((a, b) => b.week.localeCompare(a.week))
    let streakWeeks = 0
    const thisMonday = new Date(now)
    thisMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    const weekSet = new Set(heatmap52w.map((w) => w.week))
    for (let i = 0; i < 52; i++) {
      const ref = new Date(thisMonday.getTime() - i * 7 * 86400000)
      const key = ref.toISOString().slice(0, 10)
      if (weekSet.has(key)) {
        streakWeeks++
      } else if (i > 0) {
        break
      }
    }

    let streakRecord = 0
    let currentRun = 0
    const allWeekKeys = heatmap52w.map((w) => w.week).sort()
    for (let i = 0; i < allWeekKeys.length; i++) {
      if (i === 0) {
        currentRun = 1
      } else {
        const prev = new Date(allWeekKeys[i - 1])
        const curr = new Date(allWeekKeys[i])
        const diffDays = (curr.getTime() - prev.getTime()) / 86400000
        currentRun = diffDays <= 8 ? currentRun + 1 : 1
      }
      if (currentRun > streakRecord) streakRecord = currentRun
    }

    const { data: coursFavoriRows } = await supabaseAdmin
      .from('bookings')
      .select('time_slots!inner(activities!inner(name))')
      .eq('member_id', memberId)
      .eq('gym_id', gymId)
      .eq('status', 'confirmed')

    let coursFavori: { name: string; count: number } | null = null
    if (coursFavoriRows && coursFavoriRows.length > 0) {
      const activityCounts: Record<string, number> = {}
      for (const row of coursFavoriRows) {
        const ts = (row as { time_slots: { activities: { name: string } } | { activities: { name: string } }[] }).time_slots
        const arr = Array.isArray(ts) ? ts : [ts]
        const name = arr[0]?.activities?.name
        if (name) activityCounts[name] = (activityCounts[name] ?? 0) + 1
      }
      const top = Object.entries(activityCounts).sort((a, b) => b[1] - a[1])[0]
      if (top) coursFavori = { name: top[0], count: top[1] }
    }

    const { data: coachFavoriRows } = await supabaseAdmin
      .from('bookings')
      .select('time_slots!inner(coaches!inner(name))')
      .eq('member_id', memberId)
      .eq('gym_id', gymId)
      .eq('status', 'confirmed')

    let coachFavori: { name: string; count: number } | null = null
    if (coachFavoriRows && coachFavoriRows.length > 0) {
      const coachCounts: Record<string, number> = {}
      for (const row of coachFavoriRows) {
        const ts = (row as { time_slots: { coaches: { name: string } } | { coaches: { name: string } }[] }).time_slots
        const arr = Array.isArray(ts) ? ts : [ts]
        const name = arr[0]?.coaches?.name
        if (name) coachCounts[name] = (coachCounts[name] ?? 0) + 1
      }
      const top = Object.entries(coachCounts).sort((a, b) => b[1] - a[1])[0]
      if (top) coachFavori = { name: top[0], count: top[1] }
    }

    const { data: profileRow } = await supabaseAdmin
      .from('profiles')
      .select('member_since')
      .eq('id', memberId)
      .single()

    return json({
      total_seances: totalSeances,
      seances_this_month: seancesThisMonth,
      seances_last_month: seancesLastMonth,
      confirmed_count: totalSeances,
      no_show_count: noShowCount,
      streak_weeks: streakWeeks,
      streak_record: Math.max(streakRecord, streakWeeks),
      histo_30j: histo30j,
      heatmap_52w: heatmap52w,
      cours_favori: coursFavori,
      coach_favori: coachFavori,
      membre_since: profileRow?.member_since ?? null,
    })
  } catch (e) {
    console.error('[get-progression] uncaught:', e)
    return err(500, (e as Error).message ?? 'Erreur interne', 'INTERNAL')
  }
})
