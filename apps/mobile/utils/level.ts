export type Level = 'starter' | 'athlete' | 'elite' | 'champion'

export function getLevel(sessions: number): Level {
  if (sessions >= 50) return 'champion'
  if (sessions >= 20) return 'elite'
  if (sessions >= 5) return 'athlete'
  return 'starter'
}

export function getLevelProgress(sessions: number): number {
  if (sessions >= 50) return 100
  if (sessions >= 20) return ((sessions - 20) / 30) * 100
  if (sessions >= 5) return ((sessions - 5) / 15) * 100
  return (sessions / 5) * 100
}
