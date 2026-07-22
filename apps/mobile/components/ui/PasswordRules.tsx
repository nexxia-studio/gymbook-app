// GYM-166 — Checklist des règles de mot de passe, affichée en permanence sous le champ.
// Chaque règle passe au vert (✓) dès qu'elle est satisfaite, en direct pendant la frappe.
// Gris/neutre tant que non satisfaite — PAS de rouge tant que non soumis.
import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react-native'
import { passwordRules } from '../../lib/passwordPolicy'

interface PasswordRulesProps {
  password: string
  minLength?: number
}

export function PasswordRules({ password, minLength = 8 }: PasswordRulesProps) {
  const { t } = useTranslation()
  const rules = passwordRules(minLength)

  return (
    <View className="gap-1">
      {rules.map((rule) => {
        const ok = rule.test(password)
        return (
          <View key={rule.id} className="flex-row items-center gap-2">
            <Check size={14} color={ok ? '#9DB800' : '#C9C7C0'} />
            <Text className={`font-dmsans text-xs ${ok ? 'text-move-accent-dim' : 'text-move-text-muted'}`}>
              {t(`auth.password_rules.${rule.id}`, { count: minLength })}
            </Text>
          </View>
        )
      })}
    </View>
  )
}
