// GYM-294 — L'INTERSTITIEL : « ce cours est chez une autre de tes salles ».
//
// ═════════════════════════════════════════════════════════════════════════════════════
// POURQUOI UN ÉCRAN INTERMÉDIAIRE PLUTÔT QU'UNE BASCULE SILENCIEUSE
// ═════════════════════════════════════════════════════════════════════════════════════
// Basculer tout seul serait plus court d'un geste, et ce serait la même faute que celle
// corrigée en GYM-301 : le membre a cliqué un LIEN, il n'a pas demandé à changer de salle.
// Le faire sans le dire lui retire son contexte — ses réservations, sa marque, son planning
// — sans qu'il comprenne ce qui s'est passé ni comment revenir. L'arbitrage du cockpit est
// donc le même ici : on annonce, il décide.
//
// ⚠️ AUX COULEURS DE LA SALLE DU CRÉNEAU, PAS DE LA SIENNE. C'est contre-intuitif et c'est
// le point : l'écran parle de la salle OÙ MÈNE le lien. Le peindre aux couleurs de la salle
// active dirait « tu es toujours ici » au moment exact où l'on explique le contraire.
//
// ⚠️ ET IL PASSE PAR `resolveTheme`, jamais par les couleurs brutes : une salle peut avoir
// choisi deux couleurs illisibles ensemble, et ce serait l'écran qui POSE UNE QUESTION qui
// deviendrait illisible. Même règle qu'en GYM-301.
import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { resolveTheme, VINIZ_THEME } from '../../lib/theme/resolveTheme'
import { readCachedBrand, type GymBrand } from '../../lib/theme/brand'
import { switchGym, type GymMembership } from '../../lib/gymSwitch'
import { captureEvent } from '../../lib/analytics'
import { PoweredByViniz } from '../viniz/PoweredByViniz'

export function CrossGymInterstitial({
  gym,
  onCancel,
  onSwitched,
}: {
  gym: GymMembership
  onCancel: () => void
  onSwitched: () => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [erreur, setErreur] = useState(false)
  const [marque, setMarque] = useState<GymBrand | null>(null)

  // Lecture LOCALE, sans réseau : si la marque de cette salle n'est pas en cache, on rend la
  // palette Viniz plutôt que d'attendre. Un interstitiel qui met une seconde à s'afficher
  // est un interstitiel qu'on croit cassé.
  useEffect(() => {
    let vivant = true
    void readCachedBrand(gym.slug).then((b) => { if (vivant) setMarque(b) })
    return () => { vivant = false }
  }, [gym.slug])

  const tokens = marque
    ? resolveTheme(marque.primaryColor, marque.secondaryColor).tokens
    : VINIZ_THEME
  const nom = marque?.name ?? gym.name

  async function yAller() {
    if (busy) return
    setBusy(true)
    setErreur(false)
    // 🔴 LE CHEMIN SANCTIONNÉ, ET LUI SEUL. `switchGym` appelle `switch_active_gym`, purge
    // les caches dans l'ordre et pose la salle sur confirmation SERVEUR (GYM-288/292). Une
    // bascule écrite à la main ici serait une seconde source de vérité pour la salle
    // active — exactement ce que trois lots ont servi à supprimer.
    const res = await switchGym(gym)
    setBusy(false)
    if (res.status !== 'ok') { setErreur(true); return }
    // Même événement que la réconciliation : la conséquence est la même, la salle active a
    // changé. La RAISON, elle, dit que le geste vient d'un lien profond.
    captureEvent('active_gym_reconciled', {
      outcome: 'switched',
      had_local_choice: true,
      reason: 'deep_link_accepted',
    })
    onSwitched()
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }}>
      <View className="flex-1 justify-center gap-3 px-6">
        <Text className="font-dmsans-bold text-2xl leading-8" style={{ color: tokens.onBackground }}>
          {t('cross_gym.title', { gym: nom })}
        </Text>
        <Text className="font-dmsans text-sm leading-6" style={{ color: tokens.onBackgroundMuted }}>
          {t('cross_gym.body')}
        </Text>

        {erreur ? (
          <Text className="font-dmsans text-sm" style={{ color: tokens.onBackgroundMuted }}>
            {t('cross_gym.error')}
          </Text>
        ) : null}

        <TouchableOpacity
          accessibilityRole="button"
          disabled={busy}
          onPress={yAller}
          className="mt-6 items-center rounded-2xl py-4"
          style={{ backgroundColor: tokens.accent, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? (
            <ActivityIndicator color={tokens.onAccent} />
          ) : (
            <Text className="font-dmsans-bold text-base" style={{ color: tokens.onAccent }}>
              {t('cross_gym.go', { gym: nom })}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={onCancel} className="mt-1 py-3">
          <Text className="text-center font-dmsans text-sm underline" style={{ color: tokens.onBackgroundMuted }}>
            {t('common.cancel')}
          </Text>
        </TouchableOpacity>
      </View>
      <PoweredByViniz tokens={tokens} />
    </SafeAreaView>
  )
}
