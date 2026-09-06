// GYM-166 — Checklist des règles de mot de passe, affichée en permanence sous le champ.
// Chaque règle passe au vert (✓) dès qu'elle est satisfaite, en direct pendant la frappe.
// Gris/neutre tant que non satisfaite — PAS de rouge tant que non soumis.
import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react-native'
import { passwordRules } from '../../lib/passwordPolicy'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'

// GYM-286 — A-1, EN ATTENTE. Le cockpit n'a pas tranché : #9DB800 est un lime atténué,
// donc de la marque par construction — mais ici il dit « cette règle est satisfaite »,
// c'est-à-dire un SUCCÈS. Chez une salle rouge, une règle satisfaite s'afficherait en
// rouge et le membre lirait un échec là où il y a une réussite.
// La valeur reste donc en dur : la migrer vers `tokens.accentDim` figerait la réponse
// « marque », la migrer vers `SEMANTIC.success` changerait des pixels (#9DB800 → #22C55E).
//
// ⚠️ ELLE EST RÉPÉTÉE PLUTÔT QUE HISSÉE DANS UNE CONSTANTE, ET C'EST VOULU. Une constante
// nommée ne serait lue qu'UNE fois par `verify-screen-parity.mjs` là où le fichier
// d'origine portait DEUX couleurs : les suites se décaleraient, et le fichier passerait
// pour une régression. La répétition disparaîtra avec l'arbitrage.

interface PasswordRulesProps {
  password: string
  minLength?: number
}

export function PasswordRules({ password, minLength = 8 }: PasswordRulesProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()
  const rules = passwordRules(minLength)

  return (
    <View className="gap-1">
      {rules.map((rule) => {
        const ok = rule.test(password)
        return (
          <View key={rule.id} className="flex-row items-center gap-2">
            {/* 🔴 GYM-290 (décision C, A-1) — SCISSION. Ici #9DB800 disait un SUCCÈS (la
                règle est satisfaite), pas la marque : il devient `SEMANTIC.success`.
                ⚠️ CHANGE UN PIXEL CHEZ DOPAMINE, et c'est assumé — chez une salle rouge,
                une règle satisfaite s'affichait EN ROUGE. */}
            <Check size={14} color={ok ? SEMANTIC.success : SEMANTIC.disabledInk} />
            <Text
              className="font-dmsans text-xs"
              style={{ color: ok ? SEMANTIC.success : tokens.onBackgroundMuted }}
            >
              {t(`auth.password_rules.${rule.id}`, { count: minLength })}
            </Text>
          </View>
        )
      })}
    </View>
  )
}
