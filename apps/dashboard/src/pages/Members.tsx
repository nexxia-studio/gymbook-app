import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { edgeErrorMessage } from '@/lib/edgeErrors'
import { Search, ShieldOff, Bell, MoreVertical, Plus, Check, AlertTriangle, XCircle } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { MemberDrawer } from '@/components/members/MemberDrawer'
import { AddMemberModal } from '@/components/members/AddMemberModal'
import { LiftSuspensionModal } from '@/components/members/LiftSuspensionModal'
import { useMembers, type Member, type MemberStatusFilter } from '@/hooks/useMembers'
import type { MemberPlan } from '@/lib/subscription'
import { useGymAdminActions } from '@/hooks/useGymAdminActions'
import { useGymStore } from '@/stores/useGymStore'
import { useToastStore } from '@/hooks/useToast'

function nameToColor(name: string): string {
  const colors = ['#4ECDC4', '#FF6B6B', '#6C5CE7', '#FF8E53', '#A8E6CF', '#B8B8FF']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

/** JJ/MM — la forme demandée. Année omise : une échéance de relance se lit à quelques
 *  semaines, l'année n'y apporte rien et allonge une cellule déjà dense. */
function fmtShortDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('fr-BE', { day: '2-digit', month: '2-digit' }).format(d)
}

/**
 * GYM-147 — colonne FORMULE : ce que le membre POSSÈDE.
 *
 * DÉCISIONS PRODUIT (Antoine, 07/08) reprises telles quelles :
 *  · abonnement → AFFICHER L'ÉCHÉANCE. C'est précisément le signal de relance.
 *  · abonnement + crédits → « Abonnement et crédits », SANS le nombre : les crédits sont
 *    GELÉS pendant un abonnement (GYM-94), afficher un compteur figé laisserait croire à
 *    une consommation qui n'a pas lieu.
 *  · rien → formulation NEUTRE. « Aucune formule », jamais « Inactif » : un membre sans
 *    formule n'est pas fautif, il vient peut-être de s'inscrire ou attend son prochain achat.
 */
function PlanCell({ plan }: { plan: MemberPlan }) {
  const { t } = useTranslation()

  if (plan.kind === 'none') {
    return (
      <span className="rounded-lg bg-dark/5 px-2 py-0.5 font-body text-[10px] font-semibold text-muted">
        {t('members.plan_none')}
      </span>
    )
  }

  if (plan.kind === 'credits') {
    return (
      <span className="rounded-lg bg-accent-dim/10 px-2 py-0.5 font-body text-[10px] font-semibold text-accent-dim">
        {t('members.plan_credits', { count: plan.credits })}
      </span>
    )
  }

  // Abonnement (seul ou avec crédits). L'échéance proche vire à l'ambre : c'est le seul
  // moment où une relance change encore quelque chose, elle doit sauter aux yeux dans une
  // colonne par ailleurs uniformément verte.
  const label = plan.kind === 'subscription_credits'
    ? t('members.plan_subscription_credits')
    : t('members.plan_subscription')
  const until = fmtShortDate(plan.endsAt)

  return (
    <span
      className={`whitespace-nowrap rounded-lg px-2 py-0.5 font-body text-[10px] font-semibold ${
        plan.expiringSoon ? 'bg-amber-100 text-amber-800' : 'bg-green-500/10 text-green-600'
      }`}
      title={plan.expiringSoon ? t('members.plan_expiring_hint') : undefined}
    >
      {until ? t('members.plan_until', { plan: label, date: until }) : label}
    </span>
  )
}

/**
 * GYM-147 — colonne ACCÈS : « CE MEMBRE PEUT-IL RÉSERVER ? »
 *
 * 🔴 CORRECTIF QA (Antoine, 15/08). La version précédente répondait en réalité à une AUTRE
 * question — « n'est-il pas suspendu ? » — et affichait donc ✅ à côté de « Aucune
 * formule ». C'était l'INVERSE de la vérité : la garde serveur
 * (_shared/booking-guards.ts, garde 7) refuse en PAYMENT_REQUIRED tout membre sans
 * abonnement actif ET sans crédit. La suspension n'est qu'UNE des deux causes de refus ;
 * l'absence de formule est l'autre, et c'est de loin la plus fréquente.
 *
 * Sur une colonne dont le rôle est d'annoncer un droit, annoncer l'inverse du serveur est
 * le pire défaut possible : le gérant envoie quelqu'un réserver, et la porte se ferme.
 *
 * ÉTATS — dans l'ordre de priorité :
 *   ROUGE  suspendu OU sans formule → il NE PEUT PAS réserver
 *   AMBRE  résiliation en cours     → il peut, mais il part
 *   VERT   abonnement ou crédits, rien à signaler
 *
 * ⚠️ MÊME CALCUL QUE LA COLONNE VOISINE. `plan.kind === 'none'` est exactement ce
 * qu'affiche PlanCell et ce que filtre « Sans formule » — une seule expression, trois
 * usages. Recalculer ici ouvrirait la porte à deux colonnes de la même ligne qui se
 * contredisent, ce qui serait pire que le défaut corrigé.
 *
 * ⚠️ ALIGNÉ SUR LE SERVEUR, Y COMPRIS SUR CE QU'IL NE FILTRE PAS. `plan` compte les crédits
 * sans exclure les expirés, parce que hasAvailableCredits ne les exclut pas non plus
 * (`.gt('credits_remaining', 0)`, sans clause sur expires_at). Être plus strict ici
 * annoncerait un blocage qui n'existe pas.
 *
 * ⚠️ L'ÉCHÉANCE PROCHE N'EST PAS REPRISE ICI — arbitrage conservé. La colonne Formule la
 * porte déjà, badge ambre ET date en clair. La redire mettrait deux pastilles ambre sur la
 * même ligne pour un seul fait.
 *
 * ⚠️ ACCESSIBILITÉ — JAMAIS LA COULEUR SEULE : icône de forme distincte (coche / triangle /
 * croix), `title` en texte et `aria-label` identique. La date de suspension reste affichée
 * EN CLAIR à côté de la pastille : au comptoir, on ne doit pas avoir à survoler.
 */
function AccessCell({ member }: { member: Member }) {
  const { t } = useTranslation()
  const suspendedUntil = member.suspendedUntil
  const isSuspended = !!suspendedUntil && new Date(suspendedUntil) > new Date()
  // Identique à PlanCell et au filtre « Sans formule ». Une seule source.
  const hasNoPlan = member.plan.kind === 'none'
  const isCanceling = member.plan.isCanceling
  const date = fmtShortDate(suspendedUntil)

  // ── ROUGE — il ne peut pas réserver ────────────────────────────────────────
  if (isSuspended || hasNoPlan) {
    // L'infobulle CUMULE les motifs : un membre suspendu ET sans formule a deux problèmes,
    // et lever la suspension ne suffirait pas à le faire réserver. Le gérant doit voir les
    // deux, sinon il résout l'un et se heurte à l'autre.
    const label = isSuspended
      ? (hasNoPlan
          ? t('members.access.suspended_and_no_plan', { date })
          : isCanceling
            ? t('members.access.suspended_and_canceling', { date })
            : t('members.access.suspended', { date }))
      : t('members.access.no_plan')

    return (
      <span className="inline-flex items-center gap-1.5" title={label} aria-label={label}>
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100">
          <XCircle className="h-3.5 w-3.5 text-red-600" aria-hidden="true" />
        </span>
        {/* La date n'est affichée que pour une SUSPENSION : elle ne figure nulle part
            ailleurs sur la ligne. Le motif « sans formule », lui, est déjà écrit en toutes
            lettres dans la colonne Formule — le répéter ici serait du bruit. */}
        {isSuspended && (
          <span className="whitespace-nowrap font-body text-[11px] font-semibold text-red-600">{date}</span>
        )}
      </span>
    )
  }

  // ── AMBRE — il peut réserver, mais il part ────────────────────────────────
  if (isCanceling) {
    const label = t('members.access.canceling')
    return (
      <span className="inline-flex items-center gap-1.5" title={label} aria-label={label}>
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
        </span>
        <span className="whitespace-nowrap font-body text-[11px] font-semibold text-amber-700">
          {t('members.access.canceling_short')}
        </span>
      </span>
    )
  }

  // ── VERT ──────────────────────────────────────────────────────────────────
  const label = t('members.access.ok')
  return (
    <span className="inline-flex items-center" title={label} aria-label={label}>
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500/15">
        <Check className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
      </span>
    </span>
  )
}

/**
 * GYM-147 (QA mobile, 15/08) — menu d'actions, PARTAGÉ entre la ligne de tableau (desktop)
 * et la carte (mobile).
 *
 * Extrait tel quel, classes comprises : le rendu desktop est identique au caractère près.
 * Le dupliquer aurait garanti qu'une action ajoutée un jour n'existe que d'un côté — et le
 * gérant travaille surtout sur mobile, donc précisément du côté qu'on oublie.
 */
/**
 * GYM-147 (QA Antoine, 15/08) — CARTE MEMBRE, rendu mobile.
 *
 * « Parfait pour le desktop mais le tableau en version mobile n'est pas bon du tout. »
 * Le gérant consulte son dashboard DEBOUT DANS SA SALLE, sur son téléphone : c'est son
 * usage principal au comptoir, pas l'exception.
 *
 * ⚠️ RECOMPOSER, PAS RÉDUIRE. La piste « remplacer Formule par un symbole » ferait perdre
 * la DATE D'ÉCHÉANCE, qui est le signal de relance le plus actionnable de l'écran — et un
 * tableau à six colonnes tassé sur 380 px reste illisible, symboles compris. On abandonne
 * donc le tableau sous `md`, au profit d'une pile de cartes.
 *
 * CONVENTION REPRISE DU DÉPÔT, pas inventée : /planning fait déjà exactement cela —
 * PlanningCalendar en `hidden … md:block`, MobileDayList en `md:hidden` avec des SlotCard
 * empilées. Même point de bascule, même idiome de carte cliquable pleine largeur.
 *
 * ⚠️ AUCUNE LOGIQUE MÉTIER ICI. PlanCell et AccessCell sont réutilisés TELS QUELS : les
 * pastilles, les prédicats et les dates sont rigoureusement ceux du desktop. Une carte qui
 * recalculerait son état finirait par contredire le tableau.
 *
 * ORDRE DE LECTURE — le gérant cherche d'abord QUI, puis PEUT-IL ENTRER :
 *   1. nom (+ email en dessous, discret)
 *   2. les DEUX pastilles, côte à côte et pleinement lisibles
 *   3. le pied de carte : no-shows s'il y en a, ancienneté
 */
function MemberCard({ member, onSelect, onLiftSuspension, onSendPush }: {
  member: Member
  onSelect: () => void
  onLiftSuspension: () => void
  onSendPush: () => void
}) {
  const { t } = useTranslation()
  const fullName = `${member.firstName} ${member.lastName}`.trim()
  const initials = `${member.firstName.charAt(0)}${member.lastName.charAt(0)}`.toUpperCase()
  const isSuspended = !!member.suspendedUntil && new Date(member.suspendedUntil) > new Date()

  return (
    <div
      onClick={onSelect}
      className="cursor-pointer rounded-2xl border border-border bg-card p-4 transition-colors active:bg-dark/[0.03]"
    >
      {/* Identité + menu d'actions */}
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-body text-xs font-bold text-white"
          style={{ backgroundColor: nameToColor(fullName) }}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-body text-sm font-semibold text-dark">{fullName || member.email}</p>
          <p className="truncate font-body text-xs text-muted">{member.email}</p>
        </div>
        {/* Zone tactile du menu : le doigt, pas la souris. */}
        <div className="-mr-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <MemberActionsMenu
            isSuspended={isSuspended}
            onLiftSuspension={onLiftSuspension}
            onSendPush={onSendPush}
            openUpward={false}
          />
        </div>
      </div>

      {/* Les deux pastilles — l'information que cet écran existe pour porter. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <PlanCell plan={member.plan} />
        <AccessCell member={member} />
      </div>

      {/* Secondaire. Le no-show n'apparaît QUE s'il y en a : « 0 » sur chaque carte serait
          du bruit, et le chiffre reste dans la fiche complète, au clic. L'ancienneté est
          en revanche un GAIN — sur desktop elle est masquée sous `lg`. */}
      <div className="mt-2 flex items-center gap-3 font-body text-[11px] text-muted">
        {member.noshowCount > 0 && (
          <span className="font-semibold text-red-500">
            {t('planning.noshow_count', { count: member.noshowCount })}
          </span>
        )}
        {member.memberSince && (
          <span>{t('members.card_since', { date: new Date(member.memberSince).toLocaleDateString('fr-BE') })}</span>
        )}
      </div>
    </div>
  )
}

function MemberActionsMenu({ isSuspended, onLiftSuspension, onSendPush, openUpward = true }: {
  isSuspended: boolean
  onLiftSuspension: () => void
  onSendPush: () => void
  /**
   * Sens d'ouverture. `true` (defaut) = vers le HAUT, comportement historique du tableau :
   * les lignes vivent en bas de page, il y a toujours de la place au-dessus.
   *
   * Les CARTES mobiles passent `false`. La premiere carte est collee au haut de l'ecran :
   * un menu ouvert vers le haut sortirait du viewport, hors d'atteinte et sans possibilite
   * de faire defiler pour le rattraper. Vers le bas, le pire cas -- la derniere carte --
   * reste recuperable, la page defilant.
   */
  openUpward?: boolean
}) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
        className="rounded-lg p-1.5 text-muted hover:bg-dark/5"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setMenuOpen(false) }} />
          <div className={`absolute right-0 z-20 w-52 rounded-xl border border-border bg-card py-1 shadow-lg ${
            openUpward ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}>
            {isSuspended && (
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onLiftSuspension() }}
                className="flex w-full items-center gap-2 px-3 py-2 font-body text-sm text-dark hover:bg-dark/5"
              >
                <ShieldOff className="h-3.5 w-3.5" />
                {t('members.lift_suspension')}
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onSendPush() }}
              className="flex w-full items-center gap-2 px-3 py-2 font-body text-sm text-dark hover:bg-dark/5"
            >
              <Bell className="h-3.5 w-3.5" />
              {t('members.send_push')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function MemberRow({ member, onSelect, onLiftSuspension, onSendPush }: {
  member: Member
  onSelect: () => void
  onLiftSuspension: () => void
  onSendPush: () => void
}) {
  // `t` a disparu d'ici avec le menu d'actions, extrait dans MemberActionsMenu : plus rien
  // dans la ligne elle-même n'est traduit — les deux cellules d'état sont des composants.
  const fullName = `${member.firstName} ${member.lastName}`.trim()
  const initials = `${member.firstName.charAt(0)}${member.lastName.charAt(0)}`.toUpperCase()
  const isSuspended = member.suspendedUntil && new Date(member.suspendedUntil) > new Date()

  return (
    <tr onClick={onSelect} className="cursor-pointer border-b border-border transition-colors hover:bg-dark/[0.02]">
      {/* Avatar + name */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-body text-xs font-bold text-white"
            style={{ backgroundColor: nameToColor(fullName) }}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate font-body text-sm font-medium text-dark">{fullName || member.email}</p>
            <p className="truncate font-body text-xs text-muted">{member.email}</p>
          </div>
        </div>
      </td>

      {/* GYM-147 — FORMULE : « qu'a-t-il acheté ? » ────────────────────────────
          Remplace le badge Actif/Inactif, qui ne lisait que la suspension et
          annonçait donc « Actif » un membre dont l'abonnement avait expiré. */}
      <td className="px-4 py-3">
        <PlanCell plan={member.plan} />
      </td>

      {/* GYM-147 — ACCÈS : « peut-il réserver ? » ─────────────────────────────
          VIDE quand il n'y a rien à signaler. « OK » répété sur quarante lignes
          serait du bruit qui noierait les six lignes qui comptent — leçon GYM-229,
          masquer plutôt qu'afficher creux. */}
      <td className="px-4 py-3">
        <AccessCell member={member} />
      </td>

      {/* No-shows */}
      <td className="px-4 py-3">
        <span className={`font-body text-sm ${member.noshowCount > 0 ? 'font-bold text-red-500' : 'text-muted'}`}>
          {member.noshowCount}
        </span>
      </td>

      {/* Member since */}
      <td className="hidden px-4 py-3 lg:table-cell">
        <span className="font-body text-xs text-muted">
          {member.memberSince ? new Date(member.memberSince).toLocaleDateString('fr-BE') : '—'}
        </span>
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <MemberActionsMenu
          isSuspended={!!isSuspended}
          onLiftSuspension={onLiftSuspension}
          onSendPush={onSendPush}
        />
      </td>
    </tr>
  )
}

export default function Members() {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const {
    members, totalCount, withPlanCount, noPlanCount, expiringCount, suspendedCount,
    isLoading, search, setSearch, statusFilter, setStatusFilter, refetch,
  } = useMembers()
  const { liftSuspension, sendPush } = useGymAdminActions()
  const gymName = useGymStore((s) => s.gym?.name) ?? 'Viniz'
  const [selected, setSelected] = useState<Member | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [liftTarget, setLiftTarget] = useState<Member | null>(null)

  // GYM-204 — la levée passe par une modale à motif obligatoire. L'ancienne version
  // appelait l'écriture avec un motif en dur ('Lifted by admin') puis affichait un toast de
  // succès SANS jamais tester le résultat : le geste n'aboutissait pas, personne ne l'a vu.
  // Succès comme échec sont désormais décidés par la modale, sur le retour réel.
  function handleLiftSuspension(member: Member) {
    setLiftTarget(member)
  }

  async function handleSendPush(member: Member) {
    // GYM-219 — le succès n'est plus affirmé sans preuve : le toast suit le résultat.
    const res = await sendPush(member.id, gymName, t('members.push_default_message'))
    if (!res.ok) {
      addToast(edgeErrorMessage(res.code, t, { name: member.firstName }), 'error')
      return
    }
    addToast(t('members.toast_push_sent'))
  }

  // GYM-147 — « Actif » a disparu : il ne lisait que la suspension, et annonçait donc
  // « actif » un membre dont l'abonnement avait expiré. Les trois filtres qui le remplacent
  // isolent chacun une population SUR LAQUELLE AGIR — c'est l'objet du lot : sans eux, il
  // faut lire quarante lignes pour trouver les six qui décrochent.
  //
  // Chaque pastille porte SON COMPTE : le gérant voit l'ampleur avant de cliquer, et une
  // population vide se lit d'un coup d'œil sans avoir à filtrer pour le découvrir.
  const filters: Array<{ key: MemberStatusFilter; label: string; count?: number }> = [
    { key: 'all', label: t('members.filter_all') },
    { key: 'no_plan', label: t('members.filter_no_plan'), count: noPlanCount },
    { key: 'expiring', label: t('members.filter_expiring'), count: expiringCount },
    { key: 'suspended', label: t('members.filter_suspended'), count: suspendedCount },
  ]

  return (
    <DashboardLayout>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-black tracking-tight text-dark lg:text-4xl">
            {t('members.title')}
          </h1>
          <p className="mt-1 font-body text-sm text-muted">
            {/* GYM-147 — « actifs » comptait les NON-SUSPENDUS : il annonçait comme actifs
                des membres dont l'abonnement avait expiré depuis des mois. Le chiffre qui
                compte est celui des membres qui POSSÈDENT quelque chose. */}
            {t('members.count', { total: totalCount })} &middot; {t('members.count_with_plan', { count: withPlanCount })}
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="self-start sm:self-auto">
          <Plus className="h-4 w-4" />
          {t('members.add_member')}
        </Button>
      </div>

      {/* Search + filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Recherche — PLEINE LARGEUR sous `sm`. Au comptoir c'est le premier geste :
            quelqu'un badge, on cherche son nom. Elle reste au-dessus des cartes, donc
            atteignable sans défilement. */}
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('members.search_placeholder')}
            className="w-full bg-transparent font-body text-sm text-dark outline-none placeholder:text-muted sm:w-48"
          />
        </div>
        {/* Filtres — DÉFILEMENT HORIZONTAL sous `sm` plutôt que passage à la ligne : les
            quatre pastilles et leurs compteurs ne tiennent pas sur 380 px. Même traitement
            que les onglets de jour de MobileDayList. `-mx-1 px-1` évite que l'anneau de
            focus soit rogné par l'overflow. */}
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 font-body text-xs font-medium transition-colors ${
                statusFilter === f.key
                  ? 'bg-accent text-[#17102E]'
                  : 'bg-card text-secondary hover:bg-dark/5'
              }`}
            >
              {f.label}
              {f.count !== undefined && f.count > 0 && (
                <span className={`ml-1.5 rounded px-1 py-px font-body text-[10px] font-bold ${
                  statusFilter === f.key ? 'bg-[#17102E]/15' : 'bg-dark/10'
                }`}>
                  {f.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Table — DESKTOP UNIQUEMENT. Bascule `md`, celle que /planning emploie déjà
          (PlanningCalendar en `hidden … md:block`, MobileDayList en `md:hidden`). */}
      <div className="hidden overflow-hidden rounded-2xl border border-border bg-card md:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-dark/[0.02]">
              <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase text-muted">{t('members.col_member')}</th>
              <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase text-muted">{t('members.col_plan')}</th>
              <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase text-muted">{t('members.col_access')}</th>
              <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase text-muted">{t('members.col_noshows')}</th>
              <th className="hidden px-4 py-3 text-left font-body text-xs font-semibold uppercase text-muted lg:table-cell">{t('members.col_since')}</th>
              <th className="px-4 py-3 text-left font-body text-xs font-semibold uppercase text-muted">{t('members.col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td colSpan={6} className="p-3"><Skeleton variant="table-row" /></td></tr>
              ))
            ) : members.length === 0 ? (
              <tr><td colSpan={6} className="py-12 text-center font-body text-sm text-muted">{t('members.empty')}</td></tr>
            ) : (
              members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  onSelect={() => setSelected(member)}
                  onLiftSuspension={() => handleLiftSuspension(member)}
                  onSendPush={() => handleSendPush(member)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Cartes — MOBILE UNIQUEMENT. Même bascule, même idiome que MobileDayList. */}
      <div className="flex flex-col gap-2 md:hidden">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} variant="table-row" />)
        ) : members.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-6 text-center">
            <p className="font-body text-sm text-muted">{t('members.empty')}</p>
          </div>
        ) : (
          members.map((member) => (
            <MemberCard
              key={member.id}
              member={member}
              onSelect={() => setSelected(member)}
              onLiftSuspension={() => handleLiftSuspension(member)}
              onSendPush={() => handleSendPush(member)}
            />
          ))
        )}
      </div>

      <AddMemberModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={refetch} />

      {/* GYM-204 — motif obligatoire, erreurs visibles, liste rafraîchie après succès. */}
      <LiftSuspensionModal
        open={liftTarget !== null}
        onClose={() => setLiftTarget(null)}
        memberId={liftTarget?.id ?? null}
        memberName={liftTarget ? `${liftTarget.firstName} ${liftTarget.lastName}` : ''}
        suspendedUntil={liftTarget?.suspendedUntil ?? null}
        onLift={(reason) => liftSuspension(liftTarget!.id, reason)}
        onDone={refetch}
      />

      <MemberDrawer
        member={selected}
        onClose={() => setSelected(null)}
        onUpdated={() => refetch()}
      />
    </DashboardLayout>
  )
}
