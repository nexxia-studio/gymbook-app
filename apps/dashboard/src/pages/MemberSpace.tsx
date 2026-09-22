import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'
import { Smartphone, LogOut, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/stores/useAuthStore'
import { useGymStore } from '@/stores/useGymStore'
import { memberAppUrl, hasOwnApp } from '@/lib/memberApp'
import vinizWordmark from '@/assets/brand/viniz-wordmark.svg'

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════════════╗
 * ║  L'ÉCRAN D'UN MEMBRE QUI ARRIVE SUR LE DASHBOARD                                      ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════╝
 *
 * 🔴 CE N'EST PAS UN CADENAS, C'EST UNE ORIENTATION. L'écran précédent (`restricted` dans
 * `ProtectedRoute`) disait « votre compte n'a pas les droits nécessaires » et n'offrait
 * qu'un bouton « Se déconnecter » — un cul-de-sac poli. Or un membre qui atterrit ici ne
 * s'est pas trompé de produit : il s'est trompé de PORTE. Sa salle existe, son compte est
 * valide, tout est en ordre — simplement, ça se passe ailleurs.
 *
 * ⚠️ 110 COMPTES `member` SONT RATTACHÉS EN PRODUCTION. N'importe lequel peut arriver ici
 * par un lien, un favori ou une recherche : ce n'est pas un cas de bord.
 *
 * ⚠️ LA RÈGLE GYM-303 EST RESPECTÉE ICI, et c'est tout l'objet de `lib/memberApp.ts` : on
 * n'envoie JAMAIS un membre vers l'app d'une autre salle. Sans slug reconnu, on rend le
 * neutre Viniz — jamais Dopamine « au cas où ».
 *
 * ⚠️ AUCUN `DashboardLayout` : ni barre latérale, ni bandeau d'essai, ni menu de gérant.
 * Cette page n'est pas un écran du dashboard, c'est sa sortie.
 */
export default function MemberSpace() {
  const { t } = useTranslation()
  const session = useAuthStore((s) => s.session)
  const role = useAuthStore((s) => s.role)
  const initialized = useAuthStore((s) => s.initialized)
  const signOut = useAuthStore((s) => s.signOut)
  const gym = useGymStore((s) => s.gym)

  if (!initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-dim border-t-transparent" />
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace />

  // ⚠️ UN GÉRANT QUI ARRIVE ICI EST RENVOYÉ CHEZ LUI. La page est atteignable par URL ; la
  // laisser s'afficher pour un `gym_admin` lui dirait d'aller dans une app où il n'a rien
  // à faire. Le rôle `null` (profil pas encore résolu) reste ici plutôt que de rebondir :
  // `initialized` est posé APRÈS le fetch du profil, donc `null` est un fait, pas une
  // attente.
  if (role === 'gym_admin' || role === 'super_admin') {
    return <Navigate to="/dashboard" replace />
  }

  const url = memberAppUrl(gym?.slug)
  const ownApp = hasOwnApp(gym?.slug)

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-[440px] text-center">
        <div className="mb-10 flex items-center justify-center">
          <img src={vinizWordmark} alt="Viniz" className="h-11 w-11 rounded-xl" />
        </div>

        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-dim/10">
          <Smartphone className="h-8 w-8 text-accent-dim" />
        </div>

        <h1 className="font-display text-2xl font-black tracking-tight text-dark">
          {t('member_space.title')}
        </h1>

        {/* Le nom de la salle est DIT : il confirme au membre qu'il est au bon endroit,
            et que ce n'est pas son compte qui pose problème. */}
        <p className="mt-3 font-body text-sm leading-relaxed text-secondary">
          {gym?.name
            ? t('member_space.message_with_gym', { gym: gym.name })
            : t('member_space.message')}
        </p>

        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="mt-8 inline-flex items-center gap-2 rounded-xl bg-dark px-6 py-3 font-ui text-sm font-bold text-light transition-opacity hover:opacity-90"
        >
          {ownApp ? t('member_space.cta_app') : t('member_space.cta_viniz')}
          <ArrowUpRight className="h-4 w-4" />
        </a>

        <div className="mt-8">
          <Button variant="ghost" onClick={() => { void signOut() }}>
            <LogOut className="h-4 w-4" />
            {t('auth.logout')}
          </Button>
        </div>
      </div>
    </div>
  )
}
