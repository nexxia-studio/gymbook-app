import { useCallback, useSyncExternalStore } from 'react'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'gymbook-theme'

function getEffectiveTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'dark' ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

// Apply immediately to prevent flash
applyTheme(getEffectiveTheme())

// External store for React
let listeners: Array<() => void> = []
function emitChange() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners = [...listeners, listener]
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getEffectiveTheme, () => 'light' as Theme)

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next)
    applyTheme(next)
    emitChange()
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(getEffectiveTheme() === 'dark' ? 'light' : 'dark')
  }, [setTheme])

  // No system preference listener — default is always light.
  // User must toggle manually; their choice is persisted in localStorage.

  return { theme, setTheme, toggleTheme, isDark: theme === 'dark' } as const
}
