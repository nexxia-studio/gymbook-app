// GYM-286a — ÉCRAN PILOTE : « SÉCURITÉ », MIGRÉ DES CLASSES `move-*` VERS LES JETONS.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// 🔴 EN MODE `single`, CET ÉCRAN REND EXACTEMENT COMME AVANT — AU PIXEL.
// ═════════════════════════════════════════════════════════════════════════════════════
// Chaque jeton posé ici vaut, chez Dopamine, la valeur en dur qu'il remplace.
// Ce n'est pas une affirmation de relecture : `node scripts/verify-theme-parity.mjs`
// compare `tailwind.config.js` à `DOPAMINE_THEME` et sort 1 au premier écart.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// POURQUOI CET ÉCRAN A ÉTÉ CHOISI COMME PILOTE
// ─────────────────────────────────────────────────────────────────────────────────────
// Il porte les TROIS familles de couleurs à lui seul, et c'est rare :
//   MARQUE      `bg-move-dark`, `bg-move-accent` — suivent la salle ;
//   NEUTRE      `bg-move-bg`, `bg-move-card`, `border-move-border`, les deux gris de
//               texte — la palette Viniz, indépendante de la salle ;
//   SÉMANTIQUE  #E5E5E5, la piste de l'interrupteur ÉTEINT — ne suit jamais la salle :
//               « ce réglage est désactivé » ne peut pas dépendre d'une charte.
// Il emploie aussi les huit couleurs de `tailwind.config.js`, ce qui fait de sa migration
// un gabarit complet pour les 70 fichiers de GYM-286b.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 CE QUE CE FICHIER NE MIGRE PAS, ET POURQUOI
// ─────────────────────────────────────────────────────────────────────────────────────
// `<Button/>`, `<PasswordInput/>` et `<PasswordRules/>` portent encore leurs couleurs en
// dur. Ce ne sont pas des oublis : ce sont d'AUTRES fichiers, partagés par des dizaines
// d'écrans. Les migrer ici ferait de ce lot un changement à l'échelle de l'app, sans
// qu'aucun écran ne puisse plus servir de témoin.
//
// ⚠️ ET `<Button/>` PORTE UNE DÉCISION QUI N'EST PAS À PRENDRE ICI. Son variant primaire
// est `bg-move-dark` + `text-move-accent` : un bouton SOMBRE à libellé LIME. Le couple
// (`accent`, `onAccent`) du thème dit l'inverse — fond de marque, encre lisible dessus.
// Le traduire mécaniquement retournerait le bouton de toute l'app. La question est
// posée à l'arbitrage dans docs/GYM-286-inventaire.md ; ce fichier ne la tranche pas.
//
// ⚠️ L'ORDRE QUI EN DÉCOULE POUR GYM-286b : `components/ui/*` D'ABORD, les écrans
// ensuite. Un écran migré au-dessus de composants qui ne le sont pas reste, en mode
// multi, à moitié aux couleurs de Dopamine — et cela ne se voit sur aucune capture
// prise en mode single.
import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, Pressable, Switch, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Shield, Lock, Fingerprint, ChevronLeft, ChevronRight } from 'lucide-react-native'
import { PasswordInput } from '../../components/ui/PasswordInput'
import { PasswordRules } from '../../components/ui/PasswordRules'
import { Button } from '../../components/ui/Button'
import { supabase } from '../../lib/supabase'
import { validatePassword, mapPasswordError } from '../../lib/passwordPolicy'
import { useBiometrics } from '../../hooks/useBiometrics'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'

const CHANGE_PW_MIN_LENGTH = 8

function ChangePasswordForm({ onPasswordChanged }: { onPasswordChanged: (newPassword: string) => void }) {
  const { t } = useTranslation()
  const { tokens } = useTheme()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const reset = () => {
    setCurrent('')
    setNext('')
    setConfirm('')
    setOpen(false)
  }

  const handleSubmit = useCallback(async () => {
    if (next !== confirm) {
      Alert.alert(t('auth.errors.generic'), t('security.passwords_dont_match'))
      return
    }
    const pw = validatePassword(next, CHANGE_PW_MIN_LENGTH)
    if (!pw.valid) {
      const missing = pw.failed.map((id) => t(`auth.password_rules.${id}`, { count: CHANGE_PW_MIN_LENGTH })).join(' · ')
      Alert.alert(t('auth.errors.generic'), `${t('auth.password_errors.missing_prefix')} ${missing}`)
      return
    }
    setIsLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.email) throw new Error('No user')

      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: current,
      })
      if (reauthError) {
        Alert.alert(t('auth.errors.generic'), t('security.wrong_password'))
        return
      }

      const { error } = await supabase.auth.updateUser({ password: next })
      if (error) throw error

      onPasswordChanged(next)

      Alert.alert(t('security.updated_title'), t('security.updated_message'), [
        { text: 'OK', onPress: reset },
      ])
    } catch (err) {
      Alert.alert(t('auth.errors.generic'), t(mapPasswordError((err as Error).message)))
    } finally {
      setIsLoading(false)
    }
  }, [current, next, confirm, onPasswordChanged, t])

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between py-1"
      >
        {/* ⚠️ `text-move-dark` ET `color="#111111"` SONT LA MÊME COULEUR DANS DEUX
            ÉCRITURES — une classe et un littéral. Les deux deviennent `onSurface`, et
            c'est tout l'intérêt de la migration : la duplication disparaît avec elles. */}
        <Text className="font-dmsans-medium text-sm" style={{ color: tokens.onSurface }}>
          {t('security.change_password')}
        </Text>
        <ChevronRight size={16} color={tokens.onSurface} />
      </Pressable>
    )
  }

  const disabled = isLoading || !current || !next || !confirm

  return (
    <View className="gap-3">
      <PasswordInput
        label={t('security.current_password')}
        value={current}
        onChangeText={setCurrent}
      />
      <View className="gap-2">
        <PasswordInput
          label={t('security.new_password')}
          value={next}
          onChangeText={setNext}
        />
        <PasswordRules password={next} minLength={CHANGE_PW_MIN_LENGTH} />
      </View>
      <PasswordInput
        label={t('security.confirm_password')}
        value={confirm}
        onChangeText={setConfirm}
      />

      <Button
        title={isLoading ? t('security.updating') : t('security.update_password')}
        onPress={handleSubmit}
        isLoading={isLoading}
        disabled={disabled}
      />

      <Pressable onPress={reset}>
        <Text className="text-center font-dmsans text-sm" style={{ color: tokens.onBackgroundMuted }}>
          {t('security.cancel')}
        </Text>
      </Pressable>
    </View>
  )
}

export default function SecurityScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const { tokens } = useTheme()
  const {
    isBiometricAvailable,
    isBiometricEnabled,
    getBiometricLabel,
    enableBiometric,
    disableBiometric,
    getSavedCredentials,
    updateSavedPassword,
  } = useBiometrics()

  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [biometricEnabled, setBiometricEnabled] = useState(false)
  const [biometricLabel, setBiometricLabel] = useState('')
  const [toggling, setToggling] = useState(false)

  const refresh = useCallback(async () => {
    const [available, enabled, label] = await Promise.all([
      isBiometricAvailable(),
      isBiometricEnabled(),
      getBiometricLabel(),
    ])
    setBiometricAvailable(available)
    setBiometricEnabled(enabled)
    setBiometricLabel(label)
  }, [isBiometricAvailable, isBiometricEnabled, getBiometricLabel])

  useEffect(() => { refresh() }, [refresh])

  const handleToggleBiometric = useCallback(async () => {
    if (biometricEnabled) {
      Alert.alert(
        t('security.disable_biometric_title', { kind: biometricLabel }),
        t('security.disable_biometric_message'),
        [
          { text: t('security.cancel'), style: 'cancel' },
          {
            text: t('security.disable_biometric_confirm'),
            style: 'destructive',
            onPress: async () => {
              await disableBiometric()
              setBiometricEnabled(false)
            },
          },
        ],
      )
      return
    }

    setToggling(true)
    try {
      const creds = await getSavedCredentials()
      if (!creds) {
        Alert.alert(
          t('security.reconnect_required_title'),
          t('security.reconnect_required_message', { kind: biometricLabel }),
        )
        return
      }
      const success = await enableBiometric(creds.email, creds.password)
      if (success) setBiometricEnabled(true)
    } finally {
      setToggling(false)
    }
  }, [biometricEnabled, biometricLabel, disableBiometric, enableBiometric, getSavedCredentials, t])

  // ── LA BANDE SOMBRE ──────────────────────────────────────────────────────────────
  // 🔴 C'EST ICI, ET SEULEMENT ICI, QUE LA MARQUE DE LA SALLE SE VOIT SUR CET ÉCRAN.
  // `background` porte la bande ; `onBackground` est l'encre que le garde-fou a retenue
  // POUR ELLE. Les deux vont ensemble : écrire du blanc en dur sur une bande devenue
  // claire rendrait le titre illisible chez le premier client au fond pâle.
  //
  // ⚠️ LA `SafeAreaView` PORTE LA MÊME COULEUR QUE LA BANDE, PAS CELLE DE LA PAGE. C'est
  // ce qui fait que l'encoche prolonge l'en-tête au lieu d'ouvrir une bande claire
  // au-dessus de lui.
  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pb-6 pt-3" style={{ backgroundColor: tokens.background }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={24} color={tokens.onBackground} />
        </Pressable>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: tokens.onBackground, letterSpacing: 2 }}>
          {t('security.title').toUpperCase()}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {/* ── LA PAGE CLAIRE ─────────────────────────────────────────────────────────────
          ⚠️ `page`, PAS `background`. Dopamine n'est pas une app sombre : c'est une app
          claire traversée d'une bande sombre. Confondre les deux ici peindrait tout
          l'écran en #111111 — la régression la plus visible que ce lot puisse produire,
          et celle que le choix de deux jetons distincts rend impossible à écrire. */}
      <ScrollView className="flex-1" style={{ backgroundColor: tokens.page }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
        {/* Password section */}
        <View className="gap-4 rounded-2xl p-4" style={{ backgroundColor: tokens.surface }}>
          <View className="flex-row items-center gap-2">
            <Lock size={20} color={tokens.onSurface} />
            <Text className="font-dmsans-bold text-base" style={{ color: tokens.onSurface }}>
              {t('security.password_section')}
            </Text>
          </View>
          <ChangePasswordForm onPasswordChanged={updateSavedPassword} />
        </View>

        {/* Biometric section */}
        {biometricAvailable && (
          <View className="gap-4 rounded-2xl p-4" style={{ backgroundColor: tokens.surface }}>
            <View className="flex-row items-center gap-2">
              <Fingerprint size={20} color={tokens.onSurface} />
              <Text className="font-dmsans-bold text-base" style={{ color: tokens.onSurface }}>
                {t('security.biometric_section', { kind: biometricLabel })}
              </Text>
            </View>
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="font-dmsans-medium text-sm" style={{ color: tokens.onSurface }}>
                  {t('security.biometric_toggle', { kind: biometricLabel })}
                </Text>
                <Text className="mt-0.5 font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
                  {t('security.biometric_subtitle')}
                </Text>
              </View>
              {/* ── 🔴 LES TROIS FAMILLES SUR UN SEUL COMPOSANT ─────────────────────
                  C'est le cas d'école du lot, et il tient en quatre couleurs :

                    piste ALLUMÉE  #C8F000 → `tokens.accent`   MARQUE — suit la salle,
                                              c'est le « oui » de la salle qui s'affiche ;
                    piste ÉTEINTE  #E5E5E5 → `SEMANTIC.disabledTrack`  SÉMANTIQUE, FIXE ;
                    bouton allumé  #111111 → `tokens.onAccent` MARQUE — l'encre que le
                                              garde-fou a retenue POUR la piste allumée ;
                    bouton éteint  #FFFFFF → `tokens.surface`  NEUTRE — une pastille
                                              posée, qui ne dit rien d'autre.

                  ⚠️ ET LA PISTE ÉTEINTE EST LA SEULE QUI NE BOUGE PAS. Si elle suivait la
                  marque, une salle au gris clair rendrait « activé » et « désactivé »
                  indiscernables — le membre ne saurait plus si sa biométrie est en
                  service. Un réglage dont on ne lit plus l'état est pire qu'un réglage
                  laid : c'est la raison d'être de la famille SÉMANTIQUE.

                  ⚠️ `thumbColor` ALLUMÉ EST `onAccent`, PAS `onSurface`, MÊME SI LES DEUX
                  VALENT #111111 CHEZ DOPAMINE. La pastille est posée SUR la piste de
                  marque : c'est la seule encre dont on sache qu'elle s'y lit. */}
              <Switch
                value={biometricEnabled}
                onValueChange={handleToggleBiometric}
                disabled={toggling}
                trackColor={{ true: tokens.accent, false: SEMANTIC.disabledTrack }}
                thumbColor={biometricEnabled ? tokens.onAccent : tokens.surface}
              />
            </View>
          </View>
        )}

        {/* Security note */}
        {/* ⚠️ `border` EST UNE LARGEUR, PAS UNE COULEUR — la classe NativeWind reste.
            Seul `border-move-border` s'en va. Retirer les deux effacerait le trait. */}
        <View
          className="flex-row gap-2 rounded-xl border p-3"
          style={{ borderColor: tokens.border, backgroundColor: tokens.page }}
        >
          <Shield size={16} color={tokens.onSurfaceSecondary} />
          <Text className="flex-1 font-dmsans text-xs leading-5" style={{ color: tokens.onSurfaceSecondary }}>
            {t('security.note')}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
