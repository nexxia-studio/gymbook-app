// GYM-166 — Checklist des règles de mot de passe, affichée en permanence sous le champ.
// Chaque règle passe au vert (✓) dès qu'elle est satisfaite, en direct pendant la frappe.
// Gris/neutre tant que non satisfaite — PAS de rouge (on n'agresse pas quelqu'un qui tape).
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { passwordRules } from '@/lib/passwordPolicy'

interface PasswordRulesProps {
  password: string
  minLength?: number
}

export function PasswordRules({ password, minLength = 8 }: PasswordRulesProps) {
  const { t } = useTranslation()
  const rules = passwordRules(minLength)

  return (
    <ul className="flex flex-col gap-1">
      {rules.map((rule) => {
        const ok = rule.test(password)
        return (
          <li
            key={rule.id}
            className={`flex items-center gap-2 text-xs transition-colors ${ok ? 'text-accent-dim' : 'text-dark/40'}`}
          >
            <Check className={`h-3.5 w-3.5 shrink-0 ${ok ? 'opacity-100' : 'opacity-25'}`} />
            {t(`auth.password_rules.${rule.id}`, { count: minLength })}
          </li>
        )
      })}
    </ul>
  )
}
