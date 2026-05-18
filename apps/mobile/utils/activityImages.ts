export const ACTIVITY_IMAGE_URLS: Record<string, string> = {
  'Open Gym': 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&q=80',
  'HIIT / Hyrox': 'https://images.unsplash.com/photo-1517963879433-6ad2b056d712?w=800&q=80',
}

const DEFAULT = ACTIVITY_IMAGE_URLS['Open Gym']

export function getActivityImageUrl(activityName: string | undefined | null): string {
  if (!activityName) return DEFAULT
  return ACTIVITY_IMAGE_URLS[activityName] ?? DEFAULT
}
