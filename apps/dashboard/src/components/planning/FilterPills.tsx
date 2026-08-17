// GYM-128 — Barre de filtres de /planning : TROIS MENUS au lieu d'une traînée de pastilles.
//
// SIGNALÉ PAR ANTOINE LE 15/07, DEVENU ACTUEL LE 15/08. Chaque coach, chaque activité et
// chaque statut avait sa pastille, plus trois pastilles « Tous ». Avec 3 coachs et 2
// activités c'était tenable ; Nico en aura SIX ET SIX — une quinzaine de pastilles en
// travers de l'écran, DÈS L'OUVERTURE de la page. Ce n'est pas un défaut de montée en
// charge, c'est l'état de départ.
//
// ⚠️ LE FICHIER GARDE SON NOM. FilterPills est importé par Planning.tsx et le renommer
// n'apporterait rien à ce lot qu'un diff plus large à relire.
//
// ⚠️ CE QUI CHANGE ET CE QUI NE CHANGE PAS. Aucune requête, aucun prédicat métier : le
// filtrage reste CLIENT, sur les créneaux déjà chargés, en comparant les mêmes champs
// (coach.id, activity.id, statut d'affichage). Ce qui change est la CARDINALITÉ — on teste
// une appartenance au lieu d'une égalité — parce que « Marie ou Julie » était impossible à
// exprimer avec une valeur unique, et c'est la première question d'un gérant à six coachs.
//
// ⚠️ LES LISTES SONT DÉRIVÉES DE LA BASE, elles l'étaient déjà : usePlanning.fetchMeta lit
// `activities` et `coaches` de la salle, triés par sort_order. Le constat GYM-216 (« 2
// pastilles en dur, 4 activités impossibles à filtrer ») visait le FilterPills de
// apps/mobile, un autre fichier, corrigé à l'époque. Celui-ci n'a jamais eu ce défaut.
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw, EyeOff } from 'lucide-react'
import { MultiSelectFilter, type MultiSelectOption } from '@/components/ui/MultiSelectFilter'
import type { Activity, Coach } from '@/types/planning'

interface FilterPillsProps {
  coaches: Coach[]
  activities: Activity[]
  filterCoach: string[]
  filterActivity: string[]
  filterStatus: string[]
  onCoachChange: (v: string[]) => void
  onActivityChange: (v: string[]) => void
  onStatusChange: (v: string[]) => void
  hasActiveFilters: boolean
  onReset: () => void
  /** GYM-228 — activités masquées par défaut (Open Gym). Vide = rien n'est masqué. */
  hiddenActivityIds: string[]
  onShowHidden: () => void
}

// Statuts d'affichage filtrables. 'in_progress' est volontairement absent : il était déjà
// hors de la liste avant ce lot, et l'ajouter serait un changement de comportement.
const STATUS_VALUES = ['scheduled', 'completed', 'cancelled'] as const

export function FilterPills({
  coaches,
  activities,
  filterCoach,
  filterActivity,
  filterStatus,
  onCoachChange,
  onActivityChange,
  onStatusChange,
  hasActiveFilters,
  onReset,
  hiddenActivityIds,
  onShowHidden,
}: FilterPillsProps) {
  const { t } = useTranslation()

  const coachOptions = useMemo<MultiSelectOption[]>(
    () => coaches.map((c) => ({ value: c.id, label: c.name })),
    [coaches],
  )

  // La couleur de l'activité est conservée, en pastille devant l'intitulé : c'est le repère
  // visuel du planning, le perdre obligerait à relire les noms.
  const activityOptions = useMemo<MultiSelectOption[]>(
    () => activities.map((a) => ({ value: a.id, label: a.name, color: a.color })),
    [activities],
  )

  const statusOptions = useMemo<MultiSelectOption[]>(
    () => STATUS_VALUES.map((v) => ({ value: v, label: t(`planning.status.${v}`) })),
    [t],
  )

  return (
    // ⚠️ AUCUN `overflow` SUR CE CONTENEUR, ni ici ni chez l'appelant. Les panneaux des
    // menus sont positionnés en `absolute` : un ancêtre en `overflow-x-auto` les ROGNERAIT
    // au lieu de les laisser déborder — le menu s'ouvrirait tronqué, ou ne s'afficherait
    // pas du tout. C'est le piège classique de ce motif, et c'est aussi pourquoi le
    // défilement horizontal de /members (GYM-147) ne se transpose PAS ici : là-bas les
    // pastilles n'ouvrent rien.
    //
    // `flex-wrap` fait le travail à la place : sur 380 px, les trois menus et le bouton de
    // réinitialisation passent sur deux lignes au lieu de déborder. Deux lignes courtes
    // valent mieux qu'une ligne coupée.
    <div className="flex flex-wrap items-center gap-2">
      <MultiSelectFilter
        label={t('planning.filter_coaches')}
        options={coachOptions}
        selected={filterCoach}
        onChange={onCoachChange}
      />
      <MultiSelectFilter
        label={t('planning.filter_activities')}
        options={activityOptions}
        selected={filterActivity}
        onChange={onActivityChange}
      />
      <MultiSelectFilter
        label={t('planning.filter_statuses')}
        options={statusOptions}
        selected={filterStatus}
        onChange={onStatusChange}
      />

      {/* GYM-228 — UN PLANNING INCOMPLET DOIT LE DIRE. Des créneaux masqués sans mention,
          c'est un gérant qui croit voir sa semaine entière et prend des décisions sur une
          vue tronquée. La mention nomme les activités concernées et les réaffiche d'un
          clic — elle disparaît dès qu'il n'y a plus rien de masqué. */}
      {hiddenActivityIds.length > 0 && (
        <button
          type="button"
          onClick={onShowHidden}
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-amber-50 px-3 py-1.5 font-body text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
          title={t('planning.hidden_activities_hint')}
        >
          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          {t('planning.hidden_activities', {
            names: hiddenActivityIds
              .map((id) => activities.find((a) => a.id === id)?.name)
              .filter(Boolean)
              .join(', '),
          })}
        </button>
      )}

      {/* Réinitialiser — UNIQUEMENT quand il y a quelque chose à réinitialiser. */}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onReset}
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 font-body text-xs font-medium text-muted transition-colors hover:bg-dark/5 hover:text-dark"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          {t('planning.filter_reset')}
        </button>
      )}
    </div>
  )
}
