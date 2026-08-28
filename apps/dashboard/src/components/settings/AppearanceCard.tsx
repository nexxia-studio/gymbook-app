// GYM-285 — RÉGLAGES → APPARENCE. Le wizard-couleurs, devenu éditable.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// LE MANQUE QUE CETTE PAGE COMBLE
// ═════════════════════════════════════════════════════════════════════════════════════
// Depuis le wizard self-serve (GYM-248), un gérant choisit ses couleurs UNE fois, à
// l'étape 1 de son onboarding — puis le wizard se ferme et ne se rouvre jamais. Il n'y
// avait plus AUCUN chemin pour les changer : ni écran, ni lien, ni contournement. Une
// couleur choisie en trente secondes le premier jour devenait définitive.
//
// ⚠️ CE N'EST PAS UNE RÉINVENTION. Le champ couleur (`ColorField`), la palette suggérée et
// le chemin d'écriture sont ceux du wizard, à l'identique — `ColorField` a été EXTRAIT
// plutôt que recopié. Deux implémentations auraient fini par diverger sur le seul point qui
// compte : ce que veut dire un champ vide.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// LE CHEMIN D'ÉCRITURE — LE MÊME, ET IL EST DÉJÀ SANCTIONNÉ
// ─────────────────────────────────────────────────────────────────────────────────────
// UPDATE RLS direct sur `nexxia_gyms`, exactement comme l'étape 1 du wizard et comme
// `GymSettingsCard`. La policy (GYM-180) est `FOR UPDATE USING (id = get_my_gym_id() AND
// is_gym_admin())`, doublée d'un GRANT colonne par colonne : `logo_url`, `primary_color`
// et `secondary_color` y figurent. Aucun nouveau chemin n'est créé ici.
//
// 🔴 `short_name` N'Y FIGURAIT PAS. La colonne a été posée en staging par le cockpit, mais
// une colonne ne suffit pas : sans `GRANT UPDATE (short_name)`, PostgREST refuse l'écriture
// (« permission denied for column »). La migration qui l'ajoute accompagne ce lot — c'est
// la MÊME policy, étendue d'une colonne, pas un second chemin.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ColorField, VINIZ_PRIMARY, VINIZ_SECONDARY } from '@/components/ui/ColorField'
import { MediaUpload } from '@/components/ui/MediaUpload'
import { supabase } from '@/lib/supabase'
import { useGymStore } from '@/stores/useGymStore'
import { useToastStore } from '@/hooks/useToast'
import { forecastBrand, previewBrand } from '@/lib/brandContrast'

export function AppearanceCard() {
  const { t } = useTranslation()
  const gym = useGymStore((s) => s.gym)
  const addToast = useToastStore((s) => s.addToast)

  // ⚠️ `null` N'EST PAS `''`. Un champ vide veut dire « pas choisi » et part en base comme
  // `null` ; c'est ce qui permet de DÉFAIRE un choix, et ce qu'un état initialisé à une
  // couleur par défaut rendrait impossible. Voir la règle du lot : on n'écrit jamais de
  // défaut, ni en base ni en repli d'enregistrement.
  const [primary, setPrimary] = useState<string | null>(null)
  const [secondary, setSecondary] = useState<string | null>(null)
  const [logoUrl, setLogoUrl] = useState('')
  const [shortName, setShortName] = useState('')
  // 🔴 GYM-306 — LE NOM DE MARQUE, DÉSORMAIS ÉDITABLE.
  const [nom, setNom] = useState('')
  // La dénomination LÉGALE, en lecture seule ici : elle s'édite dans « Informations
  // légales ». Voir la note du champ pour la raison de l'afficher quand même.
  const [nomLegal, setNomLegal] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!gym?.id) return
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('nexxia_gyms')
        .select('logo_url, primary_color, secondary_color, short_name, name, commercial_name')
        .eq('id', gym.id)
        .single()
      if (cancelled || !data) return
      setLogoUrl(data.logo_url ?? '')
      setShortName(data.short_name ?? '')
      setNom(data.name ?? '')
      setNomLegal(data.commercial_name ?? '')
      setPrimary(data.primary_color ?? null)
      setSecondary(data.secondary_color ?? null)
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [gym?.id])

  /**
   * 🔴 GYM-305 — LE LOGO S'ENREGISTRE TOUT DE SUITE, PAS AU BOUTON « ENREGISTRER ».
   *
   * ⚠️ CE N'EST PAS UNE INCOHÉRENCE AVEC LE RESTE DE LA CARTE, C'EST UNE CONSÉQUENCE DU
   * CHEMIN DÉTERMINISTE. Le fichier part dans `{gym_id}/logo.{ext}`, TOUJOURS le même
   * objet : à la seconde où l'envoi réussit, l'ancienne URL en base sert déjà la NOUVELLE
   * image. Attendre le bouton ne retarderait donc pas le changement — ça laisserait
   * seulement la base pointer dessus avec un `?v=` périmé, c'est-à-dire un logo remplacé
   * que le CDN continue de servir en version d'avant.
   *
   * Le chemin d'écriture est celui de la carte, sans exception : UPDATE RLS sur
   * `nexxia_gyms`, `logo_url` fait partie du GRANT colonne de GYM-180.
   */
  async function persisterLogo(url: string | null) {
    if (!gym?.id) return
    setLogoUrl(url ?? '')
    const { error } = await supabase
      .from('nexxia_gyms')
      .update({ logo_url: url })
      .eq('id', gym.id)
    if (error) {
      addToast(t('settings.appearance.save_error'), 'warning')
      return
    }
    addToast(t('settings.appearance.saved'))
  }

  const forecast = forecastBrand(primary, secondary)
  const preview = previewBrand(primary, secondary)

  async function handleSave() {
    if (!gym?.id) return
    // 🔴 UN NOM VIDE N'EST PAS UN CHOIX, C'EST UNE PERTE. `name` est NOT NULL en base, et
    // c'est lui que lisent l'app, les emails et les factures : l'enregistrer vide ferait
    // disparaître la salle de sa propre interface. On refuse AVANT d'écrire plutôt que de
    // laisser PostgREST rendre une erreur que le gérant ne saurait pas lire.
    if (!nom.trim()) {
      addToast(t('settings.appearance.name_required'), 'warning')
      return
    }
    setSaving(true)
    // 🔴 CHAQUE CHAMP VIDE PART EN `null`, JAMAIS EN CHAÎNE VIDE NI EN DÉFAUT. `''` en base
    // se lit comme « renseigné, mais vide » : le mobile afficherait alors un nom court vide
    // au lieu de retomber sur le nom complet, et un logo `''` casserait le rendu au lieu
    // de laisser la place aux initiales.
    const { error } = await supabase
      .from('nexxia_gyms')
      .update({
        // ⚠️ `logo_url` N'EST PLUS DANS CETTE ÉCRITURE. Il se persiste à l'envoi (voir
        // `persisterLogo`) : le réécrire ici renverrait la valeur que l'écran avait au
        // chargement et ANNULERAIT un logo posé entre-temps — le défaut classique du
        // formulaire qui réenregistre ce qu'il n'a pas modifié.
        short_name: shortName.trim() || null,
        // ⚠️ `name` EST NOT NULL et c'est le nom que voient les membres : un champ vidé ne
        // part PAS en `null` comme les autres, il est refusé plus haut. C'est la seule
        // exception à la règle « champ vidé => null » de cette carte, et elle vient de la
        // colonne, pas d'un choix d'écran.
        name: nom.trim(),
        primary_color: primary,
        secondary_color: secondary,
      })
      .eq('id', gym.id)
    setSaving(false)
    if (error) {
      addToast(t('settings.appearance.save_error'), 'warning')
      return
    }
    addToast(t('settings.appearance.saved'))
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* ── Le formulaire ─────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-display text-xl font-black tracking-tight text-dark">
          {t('settings.appearance.title')}
        </h2>
        <p className="mt-1 font-body text-sm text-muted">
          {t('settings.appearance.subtitle')}
        </p>

        <div className="mt-5 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField
              label={t('settings.appearance.primary_label')}
              value={primary}
              suggestion={VINIZ_PRIMARY}
              hint={t('settings.appearance.color_hint')}
              onChange={setPrimary}
            />
            <ColorField
              label={t('settings.appearance.secondary_label')}
              value={secondary}
              suggestion={VINIZ_SECONDARY}
              hint={t('settings.appearance.color_hint')}
              onChange={setSecondary}
            />
          </div>

          {/* ── 🔴 L'AVERTISSEMENT — ON PRÉVIENT, ON N'INTERDIT PAS ───────────────────
              Le garde-fou de l'app protège déjà le RENDU : une couleur inutilisable est
              écartée et remplacée par la palette Viniz. Ce qu'il ne fait pas, c'est le
              DIRE — le gérant enregistrait deux pastels et l'app les ignorait sans que
              personne ne l'en informe. Il croyait avoir choisi.

              ⚠️ Et il reste NON BLOQUANT, délibérément. Interdire l'enregistrement ferait
              de nous le juge du goût d'un client, sur une règle qu'il ne voit pas ; et une
              couleur écartée aujourd'hui peut devenir utilisable demain si l'autre change.
              On annonce la conséquence, il décide. */}
          {forecast.hasWarning && (
            <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div className="flex flex-col gap-1">
                <p className="font-body text-sm font-semibold text-amber-900">
                  {t('settings.appearance.warning_title')}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {forecast.backgroundFallsBack && (
                    <li className="font-body text-xs text-amber-800">
                      {t('settings.appearance.warning_background')}
                    </li>
                  )}
                  {forecast.accentCarriesNoText && (
                    <li className="font-body text-xs text-amber-800">
                      {t('settings.appearance.warning_accent_text')}
                    </li>
                  )}
                  {forecast.accentInvisibleOnBackground && (
                    <li className="font-body text-xs text-amber-800">
                      {t('settings.appearance.warning_accent_invisible')}
                    </li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════════
              🔴 GYM-306 — LES DEUX NOMS, CÔTE À CÔTE, ET UN SEUL ÉDITABLE ICI.
              ═══════════════════════════════════════════════════════════════════════
              La salle porte TROIS noms qui ne doivent JAMAIS être synchronisés de force :
                · `name`            — la marque, ce que les membres lisent partout ;
                · `commercial_name` — la dénomination légale, celle des factures ;
                · `short_name`      — l'en-tête de l'app (GYM-285).

              ⚠️ POURQUOI `name` EST DANS « APPARENCE » ET NON DANS « INFORMATIONS LÉGALES ».
              Cette carte réunit déjà tout ce que le MEMBRE voit : couleurs, logo, nom court.
              `name` est de cette famille — c'est la marque. La dénomination légale, elle,
              appartient à la carte qui porte le numéro de TVA et l'adresse d'émission. Les
              séparer selon ce que le gérant CHERCHE (« changer ce que voient mes membres »
              vs « corriger mes mentions de facture ») est ce qui empêche de les confondre.

              ⚠️ MAIS LA LÉGALE EST AFFICHÉE ICI QUAND MÊME, EN LECTURE SEULE. C'est ce que
              l'arbitrage demandait — les voir côte à côte — sans créer un second chemin
              d'écriture pour la même donnée. Deux champs modifiables pour une seule colonne
              divergeraient au premier enregistrement concurrent. */}
          <Input
            label={t('settings.appearance.name_label')}
            name="gymName"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            helper={t('settings.appearance.name_helper')}
          />

          <Input
            label={t('settings.appearance.legal_name_label')}
            name="gymLegalName"
            value={nomLegal}
            readOnly
            disabled
            placeholder={t('settings.appearance.legal_name_empty')}
            helper={t('settings.appearance.legal_name_helper')}
          />

          <Input
            label={t('settings.appearance.short_name_label')}
            name="shortName"
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
            placeholder={gym?.name ?? ''}
            helper={t('settings.appearance.short_name_helper')}
          />

          {/* 🔴 GYM-305 — LE CHAMP D'URL DEVIENT UNE ZONE DE DÉPÔT.
              Demander une URL, c'est demander au gérant d'héberger son logo lui-même :
              personne ne l'a fait. Mesuré en staging le 28/08 — 3 salles, `logo_url`
              renseignée sur ZÉRO. L'app affiche donc partout ses initiales de repli, et le
              champ qui devait y remédier n'a jamais servi une seule fois.

              ⚠️ UNE URL EXTERNE DÉJÀ POSÉE RESTE AFFICHÉE ET SERVIE. Celle de Dopamine a
              été écrite à la main, en production : la zone la montre comme aperçu et ne
              la touche pas. « Retirer » cesse de la citer sans tenter de l'effacer — elle
              n'est pas dans notre bucket, voir `estDansLeBucket`. */}
          <MediaUpload
            label={t('settings.appearance.logo_label')}
            value={logoUrl}
            onChange={persisterLogo}
            path={`${gym?.id ?? ''}/logo`}
            recommendation={t('settings.appearance.logo_reco')}
            // Le cadrage 5:1 est celui du mot-marque (#246) : le gérant voit son logo dans
            // la boîte où l'app le posera, pas dans un carré qui lui mentirait.
            aspect="aspect-[5/1]"
            previewClassName="bg-dark"
            disabled={!gym?.id}
          />

          <Button onClick={handleSave} isLoading={saving} disabled={!loaded} className="w-full sm:w-auto">
            <Check className="h-4 w-4" />
            {t('settings.appearance.submit')}
          </Button>
        </div>
      </div>

      {/* ── L'aperçu ──────────────────────────────────────────────────────────────── */}
      <BrandPreviewPanel
        preview={preview}
        nom={shortName.trim() || gym?.name || ''}
        titre={t('settings.appearance.preview_title')}
        note={t('settings.appearance.preview_note')}
        action={t('settings.appearance.preview_action')}
        corps={t('settings.appearance.preview_body')}
      />
    </div>
  )
}

/**
 * 🔴 L'APERÇU MONTRE LE RÉSULTAT, PAS LA SAISIE.
 *
 * Peindre bêtement les deux couleurs saisies mentirait exactement là où l'aperçu sert : sur
 * les cas où l'app va les ÉCARTER. Le gérant verrait ses deux pastels côte à côte, les
 * enregistrerait satisfait, et découvrirait autre chose sur le téléphone de ses membres —
 * sans jamais faire le lien. `previewBrand` rejoue donc les replis : ce qui s'affiche ici
 * est ce que les membres verront. L'avertissement dit POURQUOI, l'aperçu montre QUOI.
 *
 * ⚠️ IL SE MET À JOUR À LA FRAPPE, AVANT TOUT ENREGISTREMENT. C'est la seule façon de
 * transformer un choix de couleur en décision informée : essayer, voir, corriger.
 */
function BrandPreviewPanel({ preview, nom, titre, note, action, corps }: {
  preview: { background: string; onBackground: string; accent: string; onAccent: string }
  nom: string
  titre: string
  note: string
  action: string
  corps: string
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <h3 className="font-display text-base font-black tracking-tight text-dark">{titre}</h3>
      <p className="mt-1 font-body text-xs text-muted">{note}</p>

      <div
        className="mt-4 overflow-hidden rounded-xl"
        style={{ backgroundColor: preview.background }}
      >
        <div className="px-5 pb-6 pt-5">
          <p
            className="font-display text-2xl font-black tracking-tight"
            style={{ color: preview.onBackground }}
          >
            {nom.toUpperCase()}
          </p>
          <p className="mt-2 font-body text-xs" style={{ color: preview.onBackground, opacity: 0.7 }}>
            {corps}
          </p>
          <div
            className="mt-5 rounded-xl px-4 py-3 text-center font-body text-sm font-bold"
            style={{ backgroundColor: preview.accent, color: preview.onAccent }}
          >
            {action}
          </div>
        </div>
      </div>
    </div>
  )
}
