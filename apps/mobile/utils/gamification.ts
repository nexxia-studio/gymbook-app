export const LEVELS = [
  { name: 'Rookie', min: 0, max: 9, icon: '🥚', color: '#888' },
  { name: 'Regular', min: 10, max: 24, icon: '💪', color: '#378ADD' },
  { name: 'Warrior', min: 25, max: 49, icon: '🔥', color: '#EF9F27' },
  { name: 'Champion', min: 50, max: 99, icon: '⚡', color: '#639922' },
  // GYM-74 — « Légende » → « Legend ». Les noms de niveaux sont des NOMS, pas des
  // libellés : Rookie, Regular, Warrior et Champion sont le vocabulaire du fitness et
  // fonctionnent tels quels en français. « Légende » était le seul intrus francisé d'une
  // liste par ailleurs anglaise — le mot reste transparent en français, et la liste
  // devient cohérente dans les deux langues.
  //
  // ⚠️ AUCUNE AUTRE DÉPENDANCE À CETTE CHAÎNE, vérifié : `getLevelInfo` choisit le niveau
  // par `min`/`max`, jamais par le nom ; `studio.tsx` est le seul consommateur et il ne
  // fait que l'AFFICHER. Rien n'est comparé, rien n'est stocké, rien ne part au serveur
  // ni dans un événement d'analytics.
  { name: 'Legend', min: 100, max: 999, icon: '👑', color: '#534AB7' },
]

export function getLevelInfo(totalSeances: number) {
  const idx = LEVELS.findIndex((l) => totalSeances >= l.min && totalSeances <= l.max)
  const levelIdx = idx === -1 ? LEVELS.length - 1 : idx
  const level = LEVELS[levelIdx]
  const nextLevel = LEVELS[levelIdx + 1] ?? null
  const range = level.max - level.min + 1
  const progress = Math.min((totalSeances - level.min) / range, 1)
  const remaining = nextLevel ? nextLevel.min - totalSeances : 0

  return { level, progress, nextLevel, remaining }
}
