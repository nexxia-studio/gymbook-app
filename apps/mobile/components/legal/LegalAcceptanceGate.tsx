// GYM-330 — LA PORTE. C'est elle qui donne sa valeur juridique à l'écran.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 POURQUOI UN COMPOSANT QUI ENVELOPPE `<Slot />` ET NON UNE REDIRECTION
// ─────────────────────────────────────────────────────────────────────────────────────
// Une redirection (`router.replace` dans un effet) est une COURSE : elle s'exécute APRÈS le
// premier rendu de la route visée. Un deep link, un tap sur notification, une reprise de
// session sur `/session/<id>` afficheraient donc l'écran demandé — ne serait-ce qu'une
// frame — avant d'être renvoyés. « Aucune action possible avant acceptation » ne serait
// vrai que du parcours nominal, c'est-à-dire précisément pas des chemins par lesquels on
// contourne un écran.
//
// Ici, tant que le consentement manque, `<Slot />` N'EST PAS MONTÉ. Il n'existe aucune
// route à atteindre : ni onglets, ni planning, ni paiement, ni `/session/<id>`. Le
// contournement n'est pas interdit, il est IMPOSSIBLE — et c'est la seule forme de
// blocage qui n'ait pas à énumérer les chemins qu'elle bloque.
//
// ⚠️ CONSÉQUENCE SUR LES TAPS DE NOTIFICATION, connue et acceptable : `usePushNotifications`
// appelle `router.push` sur un arbre non monté. La navigation est mémorisée sans rien
// afficher, et la route s'ouvre APRÈS l'acceptation. Le membre atterrit donc là où il
// voulait aller, une fois qu'il a accepté.
//
// ⚠️ IL EST MONTÉ SOUS `BrandThemeProvider` : l'écran est brandé par la salle comme le
// reste de l'app, sans quoi le premier écran qu'un membre voit serait le seul à ne pas
// l'être.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// CE QUE LA PORTE NE BLOQUE PAS
// ─────────────────────────────────────────────────────────────────────────────────────
// Sans session, elle laisse tout passer : connexion, inscription, mot de passe oublié,
// vérification d'email. Bloquer là serait absurde — il n'y a personne à faire consentir.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { View, Text, Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Sentry from '@sentry/react-native'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/useAuthStore'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { LEGAL_VERSION } from '../../constants/legal'
import { LegalAcceptanceScreen } from './LegalAcceptanceScreen'

type Status =
  | { kind: 'checking' }
  | { kind: 'ok' }
  | { kind: 'needed'; isUpdate: boolean }
  | { kind: 'unavailable' }

export function LegalAcceptanceGate({ children }: { children: ReactNode }) {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const signOut = useAuthStore((s) => s.signOut)
  const [status, setStatus] = useState<Status>({ kind: 'checking' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const check = useCallback(async () => {
    if (!userId) {
      setStatus({ kind: 'ok' })
      return
    }
    setStatus({ kind: 'checking' })
    const { data, error: readErr } = await supabase
      .from('profiles')
      .select('terms_version')
      .eq('id', userId)
      .maybeSingle()

    // 🔴 ÉCHEC DE LECTURE → `unavailable`, ET NON « ok ». Laisser passer sur une erreur
    // réseau ferait du mode avion le contournement le plus simple de tout le dispositif.
    // L'app n'a de toute façon aucun contenu hors ligne : bloquer ne retire rien d'utile,
    // et l'écran propose de réessayer ou de se déconnecter — jamais une impasse.
    if (readErr) {
      Sentry.captureException(readErr, { tags: { area: 'gym330_legal_gate' } })
      setStatus({ kind: 'unavailable' })
      return
    }

    // Profil absent : `ensureProfile` le crée au login. On ne bloque pas sur un état
    // transitoire, mais on ne valide pas non plus — le prochain passage tranchera.
    if (!data) {
      setStatus({ kind: 'ok' })
      return
    }

    const accepted = (data.terms_version as string | null) ?? null
    if (accepted === LEGAL_VERSION) {
      setStatus({ kind: 'ok' })
      return
    }
    // ⚠️ `isUpdate` distingue les DEUX usages de l'écran : rattrapage d'un compte qui n'a
    // jamais rien accepté (`null`) et réacceptation d'une version antérieure. Toute valeur
    // différente de la version courante rebloque — y compris, en théorie, une version
    // SUPÉRIEURE : un binaire ancien face à des textes plus récents doit s'arrêter, pas
    // décider qu'il est à jour.
    setStatus({ kind: 'needed', isUpdate: accepted !== null })
  }, [userId])

  useEffect(() => { void check() }, [check])

  const accept = useCallback(async () => {
    setSubmitting(true)
    setError(null)
    // L'horodatage vient du SERVEUR (accept_legal_terms, GYM-330) — jamais de l'horloge du
    // téléphone. Même règle que la demande d'exécution anticipée de GYM-336.
    const { error: rpcErr } = await supabase.rpc('accept_legal_terms', { p_version: LEGAL_VERSION })
    setSubmitting(false)
    if (rpcErr) {
      Sentry.captureException(rpcErr, { tags: { area: 'gym330_accept_legal_terms' } })
      setError(rpcErr.message)
      return
    }
    setStatus({ kind: 'ok' })
  }, [])

  const leave = useCallback(async () => {
    setError(null)
    await signOut()
    // `signOut` vide la session : `userId` passe à null, `check` rejoue et rend `ok`. Le
    // `_layout` racine renvoie alors vers /(auth)/login. Aucune impasse.
  }, [signOut])

  if (status.kind === 'ok') return <>{children}</>

  // Pendant la vérification : RIEN, comme le fait déjà `_layout` tant que les polices ne
  // sont pas chargées. Afficher un écran de chargement ferait clignoter une page de plus au
  // démarrage, et rendre `children` « en attendant » rouvrirait la frame qu'on ferme.
  if (status.kind === 'checking') return null

  if (status.kind === 'needed') {
    return (
      <LegalAcceptanceScreen
        isUpdate={status.isUpdate}
        submitting={submitting}
        error={error}
        onAccept={accept}
        onSignOut={leave}
      />
    )
  }

  return <UnavailableScreen onRetry={check} onSignOut={leave} />
}

/** Lecture impossible : ni acceptation forcée, ni app ouverte, ni impasse. */
function UnavailableScreen({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => void }) {
  const { t } = useTranslation()
  const { tokens } = useTheme()
  return (
    <SafeAreaView className="flex-1 items-center justify-center px-8" style={{ backgroundColor: tokens.background }}>
      <Text className="text-center font-dmsans-bold text-base" style={{ color: tokens.onBackground }}>
        {t('legal_gate.unavailable_title')}
      </Text>
      <Text className="mt-2 text-center font-dmsans text-sm leading-relaxed" style={{ color: tokens.onSurfaceSecondary }}>
        {t('legal_gate.unavailable_body')}
      </Text>
      <Pressable
        onPress={onRetry}
        style={{ backgroundColor: tokens.actionBg }}
        className="mt-6 rounded-2xl px-6 py-3"
      >
        <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onAction }}>{t('common.retry')}</Text>
      </Pressable>
      <Pressable onPress={onSignOut} className="mt-3 py-2">
        <Text className="font-dmsans text-sm underline" style={{ color: tokens.onBackgroundMuted }}>
          {t('legal_gate.decline')}
        </Text>
      </Pressable>
      <View className="h-4" />
    </SafeAreaView>
  )
}
