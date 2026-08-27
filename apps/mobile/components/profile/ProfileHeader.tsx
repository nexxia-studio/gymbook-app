import { View, Text, Pressable, Image } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { avatarColor } from '../../lib/theme/palette'
import { useGymName } from '../../hooks/useGymName'

interface ProfileHeaderProps {
  firstName: string
  lastName: string
  memberSince: string
  levelKey?: string
  avatarUrl?: string | null
  /**
   * GYM-224 — code du badge d'accès. `null` quand la salle ne lui en a pas encore
   * attribué : dans ce cas RIEN ne s'affiche (cf. le bloc plus bas).
   */
  accessBadgeCode?: string | null
}

export function ProfileHeader({ firstName, lastName, memberSince, levelKey, avatarUrl, accessBadgeCode }: ProfileHeaderProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const { tokens } = useTheme()
  const nomSalle = useGymName()
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
  // GYM-286b (A-7) — la palette d'avatars vit maintenant dans lib/theme/palette.ts, avec
  // son hachage. Elle était dupliquée mot pour mot ici et dans app/profile/edit.tsx.
  const bgColor = avatarColor(`${firstName} ${lastName}`)

  return (
    <View className="mx-4 mt-4 items-center rounded-3xl px-6 py-6 shadow-sm" style={{ backgroundColor: tokens.surface }}>
      {/* Avatar (tap → edit photo) */}
      <Pressable onPress={() => router.push('/profile/edit?focus=photo' as never)}>
        <View
          className="mb-3 h-20 w-20 items-center justify-center overflow-hidden rounded-full"
          style={{ backgroundColor: bgColor, borderWidth: 3, borderColor: tokens.accent }}
        >
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} className="h-full w-full" />
          ) : (
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 28, color: tokens.onBackground }}>
              {initials}
            </Text>
          )}
        </View>
      </Pressable>

      <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: tokens.onSurface }}>
        {firstName} {lastName}
      </Text>

      {levelKey && (
        // GYM-286 — `bg-move-accent/15` reste : un lavis à 15 % n'est pas `tokens.accent`.
        <View className="mt-1 rounded-lg bg-move-accent/15 px-3 py-1">
          <Text className="font-dmsans-bold text-xs" style={{ color: tokens.onSurface }}>
            {t(`profile.level.${levelKey}`)}
          </Text>
        </View>
      )}

      <Text className="mt-1 font-dmsans text-[13px]" style={{ color: tokens.onSurfaceSecondary }}>
        {t('profile.member_since', { date: memberSince })}
      </Text>

      <View className="mt-2 rounded-lg px-3 py-1" style={{ backgroundColor: tokens.page }}>
        {/* GYM-297 — le nom de la salle ACTIVE. `profile.badge_gym` valait
            « Dopamine Performance Club » dans les DEUX locales : un nom de client rangé
            dans un fichier de traduction, que personne ne pense à corriger. */}
        <Text className="font-dmsans-medium text-[10px]" style={{ color: tokens.onBackgroundMuted }}>
          {nomSalle}
        </Text>
      </View>

      {/* ── GYM-224 — Code du badge d'accès ────────────────────────────────────
          Le membre le cherche DEBOUT DEVANT LA PORTE, souvent une main occupée :
          il doit se lire d'un coup d'œil, sans zoomer ni faire défiler. D'où le
          corps large, la graisse maximale, l'interlettrage (des chiffres serrés se
          confondent), et le fond accent qui le détache du reste de la carte.

          `selectable` : recopier le code sans le retaper à la main.

          ⚠️ RIEN quand il n'y a pas de badge — pas de « — », pas de « Aucun badge ».
          C'est la leçon de GYM-229 : un libellé sans valeur se lit comme une donnée
          manquante, alors que ne pas avoir de badge est un état parfaitement normal.
          Le bloc entier disparaît, intitulé compris. */}
      {accessBadgeCode ? (
        <View className="mt-4 w-full items-center rounded-2xl bg-move-accent/15 px-4 py-3">
          <Text className="font-dmsans-medium text-[10px] uppercase tracking-wider" style={{ color: tokens.onSurfaceSecondary }}>
            {t('profile.access_badge_label')}
          </Text>
          <Text
            selectable
            style={{
              fontFamily: 'BarlowCondensed_900Black',
              fontSize: 32,
              lineHeight: 38,
              letterSpacing: 2,
              color: tokens.onSurface,
            }}
          >
            {accessBadgeCode}
          </Text>
        </View>
      ) : null}
    </View>
  )
}
