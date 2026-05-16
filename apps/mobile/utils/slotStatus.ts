export type DisplayStatus = 'scheduled' | 'completed' | 'cancelled' | 'in_progress'

export function getDisplayStatus(slot: {
  date?: string
  time?: string
  endTime?: string
}): DisplayStatus {
  if (!slot.date || !slot.time || !slot.endTime) return 'scheduled'

  const now = Date.now()
  const [sy, smo, sd] = slot.date.split('-').map(Number)
  const [sh, sm] = slot.time.split(':').map(Number)
  const [eh, em] = slot.endTime.split(':').map(Number)

  const startMs = new Date(sy, smo - 1, sd, sh, sm).getTime()
  const endMs = new Date(sy, smo - 1, sd, eh, em).getTime()

  if (isNaN(endMs) || isNaN(startMs)) return 'scheduled'
  if (endMs < now) return 'completed'
  if (startMs <= now && now <= endMs) return 'in_progress'
  return 'scheduled'
}
