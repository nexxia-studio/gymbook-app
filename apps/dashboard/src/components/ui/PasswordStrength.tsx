import { useTranslation } from 'react-i18next'

interface PasswordStrengthProps {
  password: string
}

function getStrength(password: string): { score: number; label: 'weak' | 'medium' | 'strong' } {
  let score = 0
  if (password.length >= 12) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++

  if (score <= 1) return { score: 1, label: 'weak' }
  if (score <= 3) return { score: 2, label: 'medium' }
  return { score: 3, label: 'strong' }
}

const barColors = {
  weak: 'bg-red-400',
  medium: 'bg-amber-400',
  strong: 'bg-accent-dim',
}

const textColors = {
  weak: 'text-red-500',
  medium: 'text-amber-600',
  strong: 'text-accent-dim',
}

export function PasswordStrength({ password }: PasswordStrengthProps) {
  const { t } = useTranslation()

  if (!password) return null

  const { score, label } = getStrength(password)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= score ? barColors[label] : 'bg-dark/10'
            }`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${textColors[label]}`}>
          {t(`auth.password_strength.${label}`)}
        </span>
        <span className="text-xs text-dark/30">
          {t('auth.password_strength.requirements')}
        </span>
      </div>
    </div>
  )
}
