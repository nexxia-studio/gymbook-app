// GYM-305 / GYM-215 — LA ZONE DE DÉPÔT, UNE SEULE POUR LES DEUX USAGES.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// POURQUOI UN SEUL COMPOSANT, ET PAS DEUX ÉCRANS QUI SE RESSEMBLENT
// ═════════════════════════════════════════════════════════════════════════════════════
// Le logo d'une salle et l'image d'une activité posent EXACTEMENT les mêmes questions :
// quelles tailles, quels formats, que faire d'un remplacement, que montrer pendant
// l'envoi, comment dire un refus. Deux implémentations auraient répondu pareil au début
// et divergé au premier correctif — c'est la leçon de `ColorField`, extrait pour la même
// raison en GYM-285.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 LES CONTRAINTES SONT CELLES DU BUCKET, RECOPIÉES ICI POUR ÊTRE DITES AVANT L'ENVOI
// ─────────────────────────────────────────────────────────────────────────────────────
// Le bucket `gym-media` refuse déjà au-delà de 2 Mio et hors des quatre types. Les rejouer
// côté client n'est pas une duplication de règle : c'est refuser AVANT un aller-retour, où
// l'échec reviendrait en erreur Storage brute — « The object exceeded the maximum allowed
// size » — illisible pour un gérant qui voulait juste poser son logo.
//
// ⚠️ SI LE BUCKET CHANGE, CES DEUX CONSTANTES CHANGENT. Elles sont mesurées sur lui
// (`file_size_limit` = 2097152, `allowed_mime_types`), pas choisies. Le serveur reste
// l'autorité : un écart rendrait le client PLUS permissif, et l'envoi échouerait
// proprement côté Storage — jamais l'inverse.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 LE NOM DE FICHIER EST DÉTERMINISTE — C'EST CE QUI ÉVITE LES ORPHELINS
// ─────────────────────────────────────────────────────────────────────────────────────
// `{gym_id}/logo.png`, `{gym_id}/activities/{activity_id}.png`. Un remplacement écrase le
// même objet (`upsert`), il n'en crée pas un second. C'est l'inverse de l'envoi d'avatar
// du mobile (`{user_id}/{Date.now()}.{ext}`), qui laisse un fichier par remplacement dans
// un bucket que personne ne balaie.
//
// ⚠️ L'EXTENSION, ELLE, N'EST PAS DÉTERMINISTE — ET C'EST LE PIÈGE. Un gérant qui remplace
// son `logo.png` par un JPEG écrirait `logo.jpg` À CÔTÉ : deux objets, et l'ancien resterait
// servi par toute URL déjà écrite ailleurs. On efface donc les frères d'autres extensions
// APRÈS un envoi réussi — dans cet ordre, un échec de nettoyage ne coûte qu'un fichier mort,
// jamais l'image qu'on vient de poser.
import { useCallback, useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Trash2, Loader2, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'

/** Le bucket posé par le cockpit. Public en lecture, écriture cloisonnée par policy. */
export const MEDIA_BUCKET = 'gym-media'
/** `file_size_limit` du bucket, mesuré. */
export const MEDIA_MAX_BYTES = 2 * 1024 * 1024
/** `allowed_mime_types` du bucket, mesurés — et l'extension qu'on écrit pour chacun. */
export const MEDIA_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}
const EXTENSIONS = Object.values(MEDIA_TYPES)

interface MediaUploadProps {
  /** L'URL enregistrée aujourd'hui, ou `''`. Peut être EXTERNE (posée à la main). */
  value: string
  /**
   * Appelé avec l'URL publique fraîche, ou `null` sur suppression.
   *
   * ⚠️ L'APPELANT DOIT PERSISTER TOUT DE SUITE. Le fichier est déjà en ligne à un chemin
   * déterministe : si la base gardait l'ancienne URL, elle servirait déjà la NOUVELLE image
   * sous un `?v=` périmé. Storage et base ne peuvent pas diverger ici.
   */
  onChange: (url: string | null) => void | Promise<void>
  /** Chemin dans le bucket, SANS extension : `${gymId}/logo`, `${gymId}/activities/${id}`. */
  path: string
  label: string
  /** Dimensions conseillées, affichées au gérant. */
  recommendation?: string
  /** Rapport d'aperçu, en classe Tailwind d'`aspect-ratio`. */
  aspect?: string
  /** Fond de l'aperçu — un logo lime a besoin d'un fond sombre pour se voir. */
  previewClassName?: string
  disabled?: boolean
  /** Pourquoi la zone est inactive. Dire la raison vaut mieux que griser sans un mot. */
  disabledNote?: string
}

/** L'URL pointe-t-elle dans NOTRE bucket ? Une URL externe ne s'y supprime pas. */
export function estDansLeBucket(url: string): boolean {
  return url.includes(`/storage/v1/object/public/${MEDIA_BUCKET}/`)
}

export function MediaUpload({
  value, onChange, path, label, recommendation, aspect = 'aspect-[5/1]',
  previewClassName = 'bg-dark', disabled = false, disabledNote,
}: MediaUploadProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [survol, setSurvol] = useState(false)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const traiter = useCallback(async (file: File) => {
    setErreur(null)
    // ── Les deux refus qu'on prononce SANS toucher au réseau ──────────────────────
    if (!MEDIA_TYPES[file.type]) {
      setErreur(t('media.error_format', { formats: 'PNG · JPEG · WEBP · SVG' }))
      return
    }
    if (file.size > MEDIA_MAX_BYTES) {
      setErreur(t('media.error_size', { max: '2 Mo', taille: `${(file.size / 1024 / 1024).toFixed(1)} Mo` }))
      return
    }

    const ext = MEDIA_TYPES[file.type]
    const chemin = `${path}.${ext}`
    setEnvoi(true)
    try {
      const { error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(chemin, file, { contentType: file.type, upsert: true })
      if (error) throw error

      // ⚠️ APRÈS l'envoi, jamais avant : voir l'en-tête. Un échec ici laisse un fichier
      // mort, pas un gérant sans logo. On n'en fait donc pas une erreur visible.
      const freres = EXTENSIONS.filter((e) => e !== ext).map((e) => `${path}.${e}`)
      await supabase.storage.from(MEDIA_BUCKET).remove(freres).catch(() => undefined)

      const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(chemin)
      // 🔴 LE SUFFIXE `?v=` N'EST PAS DÉCORATIF. Le CDN de Storage met en cache
      // agressivement, et le chemin ne change JAMAIS d'un remplacement à l'autre : sans
      // ce paramètre, le gérant remplace son logo, recharge, et revoit l'ancien —
      // pendant des heures, sans rien pour le lui expliquer.
      await onChange(`${data.publicUrl}?v=${Date.now()}`)
    } catch {
      setErreur(t('media.error_network'))
    } finally {
      setEnvoi(false)
    }
  }, [path, onChange, t])

  const supprimer = useCallback(async () => {
    setErreur(null)
    setEnvoi(true)
    try {
      // Une URL EXTERNE ne nous appartient pas : on ne tente pas de l'effacer, on cesse
      // seulement de la citer. C'est le cas de Dopamine, dont le logo a été posé à la main.
      if (estDansLeBucket(value)) {
        await supabase.storage.from(MEDIA_BUCKET).remove(EXTENSIONS.map((e) => `${path}.${e}`))
      }
      await onChange(null)
    } catch {
      setErreur(t('media.error_network'))
    } finally {
      setEnvoi(false)
    }
  }, [value, path, onChange, t])

  const surDepot = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setSurvol(false)
    if (disabled || envoi) return
    const file = e.dataTransfer.files?.[0]
    if (file) void traiter(file)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-body text-sm font-medium text-dark">{label}</label>

      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled && !envoi) setSurvol(true) }}
        onDragLeave={() => setSurvol(false)}
        onDrop={surDepot}
        // ⚠️ `button` ET PAS un `<button>` : la zone contient déjà une action de
        // suppression, et un bouton dans un bouton n'est pas un arbre valide.
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={() => { if (!disabled && !envoi) inputRef.current?.click() }}
        onKeyDown={(e) => {
          if (disabled || envoi) return
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() }
        }}
        className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
          disabled
            ? 'cursor-not-allowed border-[#E8E6E0] bg-dark/[0.02]'
            : survol
              ? 'cursor-pointer border-dark bg-dark/5'
              : 'cursor-pointer border-[#E8E6E0] hover:border-dark/40'
        }`}
      >
        {value ? (
          <>
            <div className={`w-full max-w-[240px] overflow-hidden rounded-lg ${aspect} ${previewClassName}`}>
              {/* `object-contain` : un logo ne se recadre pas, il se pose. */}
              <img src={value} alt={label} className="h-full w-full object-contain" />
            </div>
            <p className="font-body text-xs text-muted">{t('media.replace_hint')}</p>
          </>
        ) : (
          <>
            <ImagePlus className={`h-6 w-6 ${disabled ? 'text-dark/20' : 'text-muted'}`} />
            <p className="font-body text-sm text-dark">{t('media.drop_hint')}</p>
          </>
        )}

        {recommendation && (
          <p className="font-body text-[11px] text-dark/40">{recommendation}</p>
        )}
        <p className="font-body text-[11px] text-dark/40">
          {t('media.constraints', { formats: 'PNG · JPEG · WEBP · SVG', max: '2 Mo' })}
        </p>

        {envoi && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-card/70">
            <Loader2 className="h-5 w-5 animate-spin text-dark" />
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={Object.keys(MEDIA_TYPES).join(',')}
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0]
            // ⚠️ ON REMET LA VALEUR À ZÉRO. Sans cela, re-choisir LE MÊME fichier après une
            // erreur ne déclenche aucun `change` — l'écran resterait muet sur un geste répété.
            e.target.value = ''
            if (file) void traiter(file)
          }}
        />
      </div>

      {value && !disabled && (
        <button
          type="button"
          onClick={supprimer}
          disabled={envoi}
          className="self-start rounded-lg px-2 py-1 font-body text-xs text-muted transition-colors hover:bg-dark/5 hover:text-dark disabled:opacity-50"
        >
          <Trash2 className="mr-1 inline h-3 w-3" />
          {t('media.remove')}
        </button>
      )}

      {disabled && disabledNote && (
        <p className="font-body text-xs text-dark/40">{disabledNote}</p>
      )}

      {erreur && (
        <p className="flex items-start gap-1.5 font-body text-xs text-red-500">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {erreur}
        </p>
      )}
    </div>
  )
}
