// GYM-330 — L'ÉCRAN D'ACCEPTATION DES CONDITIONS.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// POURQUOI IL EXISTE
// ─────────────────────────────────────────────────────────────────────────────────────
// Relevé en prod le 11/09 : 50 profils vivants sur 104 n'ont AUCUN consentement — ni
// journal, ni colonne. Corrélation parfaite avec leur chemin de création :
// `admin-create-member` et `invite-team-member` posent les user_metadata SANS
// `terms_accepted`, `privacy_policy_accepted` ni `legal_version`. Ce n'est pas un défaut de
// journalisation (GYM-199 l'a corrigé) mais de RECUEIL : ces personnes n'ont jamais rien
// accepté, et aucun correctif technique ne peut fabriquer une acceptation qui n'a pas eu
// lieu. Seul un écran peut la recueillir.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// IL SERT DEUX FOIS, ET IL EST ÉCRIT POUR LES DEUX
// ─────────────────────────────────────────────────────────────────────────────────────
// 1. le rattrapage des comptes sans consentement ;
// 2. la RÉACCEPTATION à chaque changement de LEGAL_VERSION — dont celui de ce lot (2.0).
// La seule différence est le titre et la phrase d'introduction : `isUpdate` la porte. Rien
// d'autre ne distingue les deux cas, et c'est voulu — un écran de rattrapage qui divergerait
// de l'écran de réacceptation finirait par ne plus être testé.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// LE TEXTE EST DANS L'ÉCRAN, PAS DERRIÈRE UN LIEN
// ─────────────────────────────────────────────────────────────────────────────────────
// Les deux documents sont rendus en entier, dans la page, au-dessus de la case. Un lien
// sortant laisserait le membre accepter sans avoir rien eu sous les yeux — et c'est
// exactement ce qui rend une acceptation attaquable. Le même `MarkdownText` que les écrans
// de consultation, alimenté par le même `renderLegal` : un seul rendu, pas deux textes qui
// pourraient diverger.
import { useState } from 'react'
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MarkdownText } from './MarkdownText'
import { Checkbox } from '../ui/Checkbox'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'
import { getLegalDoc, LEGAL_VERSION, LEGAL_UPDATED_AT } from '../../constants/legal'
import { renderLegal } from '../../constants/legal/params'
import { useLegalParams } from '../../hooks/useLegalParams'

interface Props {
  /** true = réacceptation après changement de version ; false = premier recueil. */
  isUpdate: boolean
  submitting: boolean
  error: string | null
  onAccept: () => void
  onSignOut: () => void
}

export function LegalAcceptanceScreen({ isUpdate, submitting, error, onAccept, onSignOut }: Props) {
  const { t, i18n } = useTranslation()
  const { tokens } = useTheme()
  const lang = i18n.language?.startsWith('en') ? 'en' : 'fr'
  // Mêmes paramètres de salle que les écrans de consultation : le membre accepte le texte
  // de SA salle, avec son barème d'absences et son délai de liste d'attente.
  const params = useLegalParams()
  const [accepted, setAccepted] = useState(false)

  const canSubmit = accepted && !submitting

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top']}>
      <View className="px-5 pb-4 pt-3">
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: tokens.onBackground, letterSpacing: 2 }}>
          {(isUpdate ? t('legal_gate.title_update') : t('legal_gate.title_first')).toUpperCase()}
        </Text>
        <Text className="mt-2 font-dmsans text-sm leading-relaxed" style={{ color: tokens.onSurfaceSecondary }}>
          {isUpdate ? t('legal_gate.intro_update') : t('legal_gate.intro_first')}
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        style={{ backgroundColor: tokens.page }}
        contentContainerStyle={{ padding: 20, paddingBottom: 32 }}
        showsVerticalScrollIndicator={true}
      >
        <MarkdownText markdown={renderLegal(getLegalDoc('cgu', lang), params, lang)} />
        <View className="my-6 border-t" style={{ borderColor: tokens.border }} />
        <MarkdownText markdown={renderLegal(getLegalDoc('privacy', lang), params, lang)} />

        <View className="mt-6 border-t pt-4" style={{ borderColor: tokens.border }}>
          <Text className="font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
            {t('profile.legal.version', { version: LEGAL_VERSION, date: LEGAL_UPDATED_AT })}
          </Text>
        </View>
      </ScrollView>

      {/* Barre d'action ANCRÉE hors du ScrollView : la case et le bouton restent atteignables
          sans avoir à faire défiler deux documents jusqu'au bout. Le texte, lui, est bien
          au-dessus — il est lisible dans l'écran, ce qui est ce qui compte. */}
      <View className="border-t px-5 pb-4 pt-4" style={{ borderColor: tokens.border, backgroundColor: tokens.surface }}>
        {/* ⚠️ CASE NON PRÉ-COCHÉE, comme celle de GYM-336 et pour la même raison : une case
            pré-cochée enregistre l'inertie du membre, pas sa décision. */}
        <Checkbox checked={accepted} onToggle={() => setAccepted((v) => !v)}>
          <Text className="font-dmsans text-sm leading-relaxed" style={{ color: tokens.onSurfaceSecondary }}>
            {t('legal_gate.checkbox')}
          </Text>
        </Checkbox>

        {error && (
          <Text className="mt-3 font-dmsans text-sm" style={{ color: SEMANTIC.danger }}>{error}</Text>
        )}

        <Pressable
          onPress={onAccept}
          disabled={!canSubmit}
          accessibilityState={{ disabled: !canSubmit }}
          style={{ backgroundColor: tokens.actionBg }}
          className={`mt-4 flex-row items-center justify-center gap-3 rounded-2xl px-4 py-4 ${canSubmit ? '' : 'opacity-60'}`}
        >
          {submitting && <ActivityIndicator color={tokens.onAction} />}
          <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onAction }}>
            {t('legal_gate.accept')}
          </Text>
        </Pressable>

        {/* 🔴 LA SORTIE. Un membre qui refuse ne doit PAS rester coincé dans une app qu'il ne
            peut ni utiliser ni quitter : ce serait une contrainte, et un consentement
            contraint n'en est pas un. Se déconnecter le ramène à l'écran de connexion ; son
            compte, ses crédits et son abonnement restent intacts, et l'écran le
            réaccueillera à la prochaine connexion. La suppression de compte reste ouverte
            par ailleurs (Profil → Supprimer mon compte), mais elle exige d'être connecté :
            elle n'est donc PAS atteignable d'ici, et c'est une limite connue. */}
        <Pressable onPress={onSignOut} disabled={submitting} className="mt-2 items-center py-3">
          <Text className="font-dmsans text-sm underline" style={{ color: tokens.onBackgroundMuted }}>
            {t('legal_gate.decline')}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}
