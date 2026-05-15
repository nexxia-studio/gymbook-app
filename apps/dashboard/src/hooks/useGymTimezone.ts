import { useGymStore } from '@/stores/useGymStore'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'

export function useGymTimezone(): string {
  const gym = useGymStore((s) => s.gym)
  return gym?.timezone ?? DEFAULT_TIMEZONE
}
