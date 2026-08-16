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
 * GYM-147 (QA Antoine, 15/08) — colonne ACCÈS en PASTILLE.
 *
 * La version précédente laissait la cellule VIDE quand il n'y avait rien à signaler. Le
 * constat de QA est juste : sur 90 % des lignes, une case vide ne se lit pas « rien à
 * signaler » mais « l'affichage a raté quelque chose ». La consigne « masquer plutôt
 * qu'afficher creux » (GYM-229) visait un LIBELLÉ orphelin — « Coach : — » — pas une
 * pastille, qui se balaie d'un coup d'œil sans encombrer la ligne.
 *
 * TROIS ÉTATS, et un seul par ligne :
 *   ROUGE  suspendu — accès BLOQUÉ
 *   AMBRE  accès ouvert, mais à savoir : résiliation en cours
 *   VERT   rien à signaler
 *
 * ⚠️ CUMUL : suspendu ET en résiliation → le ROUGE prime, c'est l'information urgente.
 * L'infobulle mentionne alors les DEUX, pour ne rien perdre.
 *
 * ⚠️ L'ÉCHÉANCE PROCHE N'EST PAS REPRISE ICI. La colonne Formule la porte déjà — badge
 * ambre ET date en clair (« Abonnement · jusqu'au 15/09 »). La redire dans Accès mettrait
 * deux pastilles ambre sur la même ligne pour un seul fait, et diluerait le signal que
 * cette colonne doit porter seule : la résiliation.
 *
 * ⚠️ ACCESSIBILITÉ — JAMAIS LA COULEUR SEULE. Trois éléments s'y ajoutent :
 *   · une ICÔNE de forme distincte (coche / triangle / croix), lisible en niveaux de gris
 *     comme par un daltonien ;
 *   · un `title` en texte, qui donne la date de suspension au survol ;
 *   · un `aria-label` identique, pour les lecteurs d'écran.
 * La date reste par ailleurs affichée EN CLAIR à côté de la pastille rouge : au comptoir,
 * c'est l'information dont le gérant a besoin sans avoir à survoler quoi que ce soit.
 */
function AccessCell({ member }: { member: Member }) {
  const { t } = useTranslation()
  const suspendedUntil = member.suspendedUntil
  const isSuspended = !!suspendedUntil && new Date(suspendedUntil) > new Date()
  const isCanceling = member.plan.isCanceling

  const date = fmtShortDate(suspendedUntil)

  if (isSuspended) {
    // Cumul suspendu + résiliation : le rouge prime, l'infobulle dit les deux.
    const label = isCanceling
      ? t('members.access.suspended_and_canceling', { date })
      : t('members.access.suspended', { date })
    return (
      <span className="inline-flex items-center gap-1.5" title={label} aria-label={label}>
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100">
          <XCircle className="h-3.5 w-3.5 text-red-600" aria-hidden="true" />
        </span>
        <span className="whitespace-nowrap font-body text-[11px] font-semibold text-red-600">{date}</span>
      </span>
    )
  }

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

  const label = t('members.access.ok')
  return (
    <span className="inline-flex items-center" title={label} aria-label={label}>
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500/15">
        <Check className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
      </span>
    </span>
  )
}

function MemberRow({ member, onSelect, onLiftSuspension, onSendPush }: {
  member: Member
  onSelect: () => void
  onLiftSuspension: () => void
  onSendPush: () => void
}) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
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
              <div className="absolute bottom-full right-0 z-20 mb-1 w-52 rounded-xl border border-border bg-card py-1 shadow-lg">
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
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <Search className="h-4 w-4 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('members.search_placeholder')}
            className="w-48 bg-transparent font-body text-sm text-dark outline-none placeholder:text-muted"
          />
        </div>
        <div className="flex gap-2">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`rounded-lg px-3 py-1.5 font-body text-xs font-medium transition-colors ${
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

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
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
