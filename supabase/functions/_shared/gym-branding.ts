// GYM-238 — L'IDENTITÉ DE LA SALLE DANS LES EMAILS, LUE EN BASE. Un seul endroit.
//
// EXIGENCE D'ANTOINE, QUI COMMANDE TOUT LE LOT : « configurer chaque ticket dans le but
// d'être SCALABLE et facilement DUPLICABLE pour un autre pro. PAS DE DONNÉES DOPAMINE EN
// DUR DANS LE CODE. » GYM-216 l'a fait pour l'app ; les emails étaient le dernier gros
// bastion côté serveur. En l'état, une deuxième salle enverrait à ses membres des courriers
// signés « DOPAMINE », en lime et noir, avec une commune qui n'est même plus la bonne.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// POURQUOI CETTE FORME : UNE COQUILLE + DES BLOCS, ET NON DIX GABARITS CORRIGÉS
// ─────────────────────────────────────────────────────────────────────────────────────
// Quatorze fonctions composent du HTML d'email. Ce qui se répète chez elles n'est PAS le
// message — « cours annulé » et « paiement confirmé » n'ont rien à se dire — c'est la
// CHROME : la bande d'en-tête, le pied, le bouton, le nom d'expéditeur, la forme des
// liens. Corriger dix gabarits séparément les ferait diverger au premier ajustement,
// exactement comme ont divergé les prédicats d'abonnement (GYM-191/195) et les moteurs de
// sanction (GYM-218). D'où : `emailShell()` porte la chrome, l'appelant passe son corps.
//
// ⚠️ CE MODULE N'ENVOIE RIEN. Chaque fonction garde son appel Resend, sa gestion d'erreur
// et sa sémantique best-effort — certaines envoient en lot, d'autres une seule fois, et
// toutes ont des règles de non-blocage différentes. Factoriser l'envoi aurait touché
// quatorze chemins d'erreur pour un gain nul. On factorise ce qui se répète, pas ce qui
// se ressemble.
//
// ⚠️ UNE SEULE LECTURE DE nexxia_gyms PAR ENVOI : `loadGymBranding` ramène tout — nom,
// slug, adresse, contact, logo, couleurs. Une lecture par section aurait multiplié les
// requêtes sur le chemin d'un simple email de confirmation.
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Domaine des Universal Links membres (GYM-158). INFRA PRODUIT, identique pour toutes les
 * salles — ce n'est pas une donnée de salle, sa place est bien dans le code.
 */
export const LINKS_BASE = 'https://links.viniz.app'

/**
 * Adresse d'envoi. ⚠️ NE PAS CHANGER LE DOMAINE : viniz.app est le domaine vérifié chez
 * Resend (DKIM, SPF, DMARC). En changer casserait la délivrabilité de toutes les salles.
 * Seul le NOM affiché devant l'adresse vient de la salle.
 */
export const MAIL_ADDRESS = 'noreply@viniz.app'

/**
 * Repli de marque = les couleurs actuelles de Dopamine.
 *
 * Ce n'est pas une entorse à la règle « pas de données en dur » : ce sont les valeurs
 * qu'ont TOUS les emails aujourd'hui, et nexxia_gyms.primary_color / secondary_color sont
 * VIDES en base. Sans repli, le premier email partirait sans couleur. Dès qu'une salle
 * renseigne les siennes, elles gagnent — y compris pour Dopamine.
 */
export const FALLBACK_PRIMARY = '#C8F000'
export const FALLBACK_SECONDARY = '#111111'

/**
 * Repli d'identité quand la ligne nexxia_gyms est ILLISIBLE (réseau, id inconnu).
 *
 * ⚠️ LE PRODUIT, JAMAIS UNE SALLE. Un email signé du nom d'une autre salle serait une
 * fuite d'identité ; signé du nom de la plateforme, il reste honnête. C'est aussi
 * l'expéditeur qu'emploient déjà les alertes internes (« Viniz <noreply@viniz.app> »).
 */
const PRODUCT_NAME = 'Viniz'

export interface GymBranding {
  name: string
  slug: string
  address: string | null
  postalCode: string | null
  city: string | null
  email: string | null
  phone: string | null
  logoUrl: string | null
  primaryColor: string
  secondaryColor: string
}

/** Colonnes lues — la liste vit ici pour qu'un ajout profite à tous les gabarits. */
const GYM_COLUMNS = 'name, slug, subdomain, address, postal_code, city, email, phone, logo_url, primary_color, secondary_color'

/**
 * Une valeur de base « présente » : ni null, ni chaîne vide, ni blancs.
 *
 * ⚠️ LES TROIS COLONNES DE MARQUE SONT VIDES EN PRODUCTION, pas NULL selon les lignes.
 * Tester la seule nullité laisserait passer `''` et produirait un `<img src="">` ou un
 * `color:` vide — un logo cassé, visible par tous les membres.
 */
function present(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.length > 0 ? s : null
}

/**
 * Lit l'identité de la salle. UNE requête, tout ce dont les emails ont besoin.
 *
 * Ne lève jamais : un email est toujours best-effort dans ce dépôt, et faire échouer une
 * annulation de cours parce que la ligne de salle est illisible serait absurde. Le repli
 * produit prend alors la main.
 */
export async function loadGymBranding(
  supabase: SupabaseClient,
  gymId: string,
): Promise<GymBranding> {
  const { data } = await supabase
    .from('nexxia_gyms')
    .select(GYM_COLUMNS)
    .eq('id', gymId)
    .maybeSingle()

  const row = (data ?? {}) as Record<string, unknown>
  return {
    name: present(row.name) ?? PRODUCT_NAME,
    // `subdomain` en second choix, comme le fait déjà lib/gymUrls côté mobile : les deux
    // valent 'dopamine' en base, mais `slug` est la colonne qui porte l'identité d'URL.
    slug: present(row.slug) ?? present(row.subdomain) ?? '',
    address: present(row.address),
    postalCode: present(row.postal_code),
    city: present(row.city),
    email: present(row.email),
    phone: present(row.phone),
    logoUrl: present(row.logo_url),
    primaryColor: present(row.primary_color) ?? FALLBACK_PRIMARY,
    secondaryColor: present(row.secondary_color) ?? FALLBACK_SECONDARY,
  }
}

/**
 * Nom d'expéditeur — le NOM vient de la salle, l'ADRESSE reste celle du domaine vérifié.
 *
 * Les guillemets et virgules sont retirés : une virgule dans un display-name non quoté
 * casse l'en-tête From et fait rejeter l'envoi par Resend.
 */
export function emailSender(b: GymBranding): string {
  const safeName = b.name.replace(/["',]/g, ' ').replace(/\s+/g, ' ').trim() || PRODUCT_NAME
  return `${safeName} <${MAIL_ADDRESS}>`
}

/**
 * GYM-238 / GYM-207 — LIEN MEMBRE, EN UNIVERSAL LINK.
 *
 * 🔴 LE DÉFAUT CORRIGÉ PAR CE LOT : les gabarits pointaient `dopamine://bookings`. Gmail,
 * Apple Mail et Outlook n'ouvrent QUE http(s) — un schéma personnalisé y est inerte : pas
 * d'erreur, pas de message, RIEN. Antoine l'a constaté en production le 18/08 : « j'ai un
 * bouton "Voir ma réservation" et quand je clique dessus, rien ne se passe ».
 *
 * ⚠️ MÊME DÉFAUT QU'À GYM-207 (04/08), au même endroit, jamais généralisé : le lot
 * précédent n'avait traité que le retour de paiement. Il est ici traité pour TOUS les
 * emails, et la seule façon d'en fabriquer un passe désormais par cette fonction.
 *
 * Le slug vient de la base, jamais du code. S'il manque, on rend une chaîne vide plutôt
 * qu'une URL fausse — `emailShell` masque alors le bouton (cf. plus bas).
 */
export function memberLink(b: GymBranding, path: string): string {
  if (!b.slug) return ''
  return `${LINKS_BASE}/${b.slug}/${path.replace(/^\/+/, '')}`
}

/**
 * EN-TÊTE — le logo de la salle, ou son nom.
 *
 * ⚠️ CONTRAINTES EMAIL, NON NÉGOCIABLES :
 *  · PNG uniquement — Gmail et Outlook ne rendent pas les SVG. Une URL qui n'est pas un
 *    PNG retombe sur le nom : un logo cassé est pire qu'un texte juste.
 *  · URL absolue et publique (https) — jamais de pièce jointe intégrée.
 *  · `alt` PORTANT LE NOM DE LA SALLE. Ce n'est pas un détail d'accessibilité : beaucoup
 *    de clients bloquent les images par défaut, et l'alternative textuelle est alors TOUT
 *    ce que le membre voit. C'est le repli principal.
 *  · largeur fixe en pixels + display:block — Outlook ignore les largeurs relatives.
 */
function headerHtml(b: GymBranding): string {
  const logo = b.logoUrl
  const isUsablePng = !!logo && /^https:\/\//i.test(logo) && /\.png(\?|#|$)/i.test(logo)
  const inner = isUsablePng
    ? `<img src="${escapeAttr(logo!)}" alt="${escapeAttr(b.name)}" width="160" style="display:block;margin:0 auto;width:160px;max-width:160px;height:auto;border:0;" />`
    : `<span style="font-family:'Arial Black',Arial,sans-serif;color:${escapeAttr(b.primaryColor)};font-size:24px;letter-spacing:2px;">${escapeHtml(b.name.toUpperCase())}</span>`
  // ⚠️ LE FOND VIENT DE `secondary_color`, LU EN BASE — il n'a jamais été écrit en dur, et
  // il ne l'est toujours pas. Le passage de #111111 à #000000 demandé en QA (le logo de
  // Dopamine a un fond noir pur, et le carré se détachait sur le #111111) est donc un
  // geste de COCKPIT sur nexxia_gyms.secondary_color : rien à coder ici, et c'est
  // exactement ce que la lecture en base devait permettre.
  //
  // `background-color` explicite plutôt que le raccourci `background`, et `color-scheme`
  // inline : sans couleur déclarée sur l'élément, c'est ici que l'inversion frappait.
  return `<div style="background-color:${escapeAttr(b.secondaryColor)};color-scheme:light only;padding:24px;border-radius:16px 16px 0 0;text-align:center;">${inner}</div>`
}

/**
 * PIED DE PAGE — composé depuis la base, jamais écrit.
 *
 * Il disait « Dopamine Performance Club · Neupré » : nom en dur, ET commune PÉRIMÉE (la
 * salle est à Ougrée depuis GYM-180). Une donnée fausse écrite en dur ne se corrige nulle
 * part ; lue en base, elle suit.
 *
 * ⚠️ nexxia_gyms.email et phone sont NULL en production : la ligne de contact DISPARAÎT
 * entièrement plutôt que d'afficher un libellé suivi d'un blanc ou d'un tiret. C'est la
 * leçon de GYM-229 (le « Coach : » vide des créneaux Open Gym) appliquée ici.
 */
function footerHtml(b: GymBranding): string {
  // GYM-238 (finitions QA du 19/08) — TROIS LIGNES, dans cet ordre : nom, adresse
  // complète, contact. Tout tenait sur une ligne séparée par des points médians, ce qui
  // rendait l'adresse illisible sur un écran de téléphone.
  //
  // ⚠️ SÉPARÉES PAR DES <br>, PAS PAR DES RETOURS À LA LIGNE. Un saut de ligne dans le
  // source HTML est rendu comme une espace : les trois lignes seraient revenues sur une.
  //
  // ⚠️ CHAQUE LIGNE N'APPARAÎT QUE SI SA DONNÉE EXISTE. `phone` est NULL en production et
  // le restera tant que le gérant ne l'aura pas renseigné : pas de ligne vide, pas de
  // libellé orphelin, pas de séparateur suspendu. C'est la règle GYM-229, appliquée
  // ligne par ligne plutôt qu'au bloc entier.
  const place = [b.address, [b.postalCode, b.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  // Le contact tient sur la même ligne quand les deux existent — le téléphone n'a pas de
  // ligne à lui : il complète l'email, il ne le remplace pas.
  const contact = [b.email, b.phone].filter(Boolean).join(' · ')
  const lines = [b.name, place, contact].filter(Boolean).map(escapeHtml)
  if (lines.length === 0) return ''
  return `<div style="background-color:#F5F4F0;color-scheme:light only;padding:16px 0 0;"><p style="text-align:center;color:#6B6861;font-size:11px;line-height:1.7;margin:0;">${lines.join('<br />')}</p></div>`
}

export interface EmailShellOptions {
  /** Titre du message (h2). */
  title: string
  /** Corps déjà composé par l'appelant — c'est lui qui varie d'un email à l'autre. */
  bodyHtml: string
  /** Pictogramme au-dessus du titre, si le gabarit en avait un. */
  emoji?: string
  /** Libellé du bouton d'action. Sans `ctaPath`, aucun bouton n'est rendu. */
  ctaLabel?: string
  /** Chemin membre (ex. 'bookings') → Universal Link construit par `memberLink`. */
  ctaPath?: string
  /** URL absolue déjà connue (lien d'activation, facture…), au lieu de `ctaPath`. */
  ctaUrl?: string
  /** Largeur du bloc. Les gabarits existants utilisent 480 ou 520 px. */
  width?: number
}

/**
 * LA COQUILLE : en-tête, corps de l'appelant, bouton, pied. Aux couleurs de la salle.
 *
 * ⚠️ LE BOUTON DISPARAÎT PLUTÔT QUE DE POINTER DANS LE VIDE. Sans slug lisible, aucune
 * URL membre n'est constructible : rendre un bouton mort reproduirait exactement le défaut
 * que ce lot corrige. Le membre reçoit alors un email complet, sans bouton — le message
 * reste lisible et vrai.
 */
export function emailShell(b: GymBranding, o: EmailShellOptions): string {
  const href = o.ctaUrl ?? (o.ctaPath ? memberLink(b, o.ctaPath) : '')
  const cta = o.ctaLabel && href
    // ⚠️ CONTRASTE : fond = `primary_color` (le lime #C8F000 chez Dopamine), texte =
    // `secondary_color`, donc SOMBRE SUR CLAIR. L'inverse — un texte clair sur ce lime —
    // serait illisible. Les deux valeurs viennent de la base, elles n'ont jamais été
    // écrites en dur ici.
    ? `<div style="text-align:center;margin:24px 0 0;"><a href="${escapeAttr(href)}" style="display:inline-block;background-color:${escapeAttr(b.primaryColor)};color:${escapeAttr(b.secondaryColor)};color-scheme:light only;font-weight:bold;font-size:14px;text-decoration:none;padding:14px 28px;border-radius:12px;">${escapeHtml(o.ctaLabel)}</a></div>`
    : ''
  const emoji = o.emoji ? `<div style="font-size:28px;margin-bottom:12px;">${o.emoji}</div>` : ''
  const width = o.width ?? 520
  // 🔴 GYM-238 (QA du 19/08) — L'EMAIL EST RENDU EN DOCUMENT COMPLET, ET C'EST CE QUI
  // CORRIGE L'INVERSION EN MODE SOMBRE. Il n'était qu'un fragment `<div>` : sans <head>,
  // aucune directive de thème ne pouvait être posée, et Apple Mail appliquait sa PROPRE
  // inversion sur iPhone — Antoine a reçu un email au corps #111111 sous un en-tête blanc
  // cassé, exactement l'inverse de ce qui était prévu. Illisible pour tout membre en mode
  // sombre, c'est-à-dire pour beaucoup de monde.
  //
  // ⚠️ ON NE FAIT PAS UN EMAIL ADAPTATIF. L'objectif est qu'il s'affiche TOUJOURS comme
  // prévu, pas qu'il se décline en deux thèmes — c'est un chantier à part.
  //
  // TROIS NIVEAUX, PARCE QU'UN SEUL NE SUFFIT PAS :
  //  1. les deux <meta> de thème, comprises par Apple Mail et iOS ;
  //  2. `color-scheme: light only` en ligne sur chaque bloc porteur de couleur, pour les
  //     clients qui ignorent le <head> mais lisent les styles inline ;
  //  3. ⚠️ LE PLUS IMPORTANT : un `background-color` EXPLICITE sur chaque élément, y
  //     compris ceux qui n'en avaient pas besoin visuellement (le <body>, la colonne
  //     centrale, le pied). L'inversion frappe d'abord les zones SANS couleur déclarée —
  //     compter sur un fond hérité, c'est précisément ce qui a laissé Apple Mail décider.
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<style>:root { color-scheme: light only; supported-color-schemes: light only; }</style>
</head>
<body style="margin:0;padding:0;background-color:#F5F4F0;color-scheme:light only;">
<div style="font-family:'DM Sans','Helvetica Neue',Arial,sans-serif;background-color:#F5F4F0;color-scheme:light only;padding:40px 20px;"><div style="max-width:${width}px;margin:0 auto;background-color:#F5F4F0;color-scheme:light only;">${headerHtml(b)}<div style="background-color:#FFFFFF;color-scheme:light only;padding:32px 28px;border-radius:0 0 16px 16px;">${emoji}<h2 style="margin:0 0 8px;color:#111111;font-size:20px;">${escapeHtml(o.title)}</h2>${o.bodyHtml}${cta}</div>${footerHtml(b)}</div></div>
</body>
</html>`
}

/**
 * Échappement HTML des valeurs venues de la BASE (nom de salle, ville, contact).
 *
 * Elles sont saisies par le gérant dans /settings : une apostrophe ou une esperluette dans
 * un nom de salle ne doit pas casser le rendu, et un `<` collé par erreur ne doit pas
 * s'exécuter dans le client mail. Les corps composés par les appelants ne passent PAS par
 * ici — ils contiennent du balisage voulu.
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}
