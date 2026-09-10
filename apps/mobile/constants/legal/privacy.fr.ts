// Politique de confidentialité — v1 PUBLIABLE.
// Source de vérité : docs/legal/politique-confidentialite-v1.md (corps publiable UNIQUEMENT ;
// les annexes internes de la source ne sont JAMAIS reproduites ici).
// Tableaux de la source (art. 3, art. 6) convertis en listes : le renderer MarkdownText ne
// gère pas les tableaux.
//
// 🔴 GYM-333b (point 3) — L'ART. 4 EST AU CONDITIONNEL, ET CE N'EST PAS UNE PRÉCAUTION
// DE STYLE. La table `medical_notes` existe (notes_encrypted, conditions_encrypted,
// certificate_url, certificate_expires_at) et `activities.requires_medical_check` aussi,
// mais RIEN NE LES ÉCRIT : aucune ligne en prod, aucun écran d'app ou de dashboard, aucune
// routine de chiffrement. Le traitement est PRÉVU, JAMAIS ACTIVÉ. Le texte décrivait
// pourtant un dispositif « en place » — donc six promesses invérifiables sur un traitement
// inexistant. L'article est CONSERVÉ (la capacité existe, le membre doit la connaître) mais
// il annonce désormais ce qui s'appliquerait « si votre salle active cette fonction ».
//
// ⚠️ UNE SEULE PROMESSE EST RESTÉE À L'INDICATIF, parce qu'elle est la seule que le code
// tienne : l'effacement à la suppression du compte. delete-account/index.ts:192 supprime
// medical_notes par member_id, sans condition. Elle est isolée en fin d'article, désignée
// comme telle — mêler une garantie effective à des engagements futurs les aurait tous
// affaiblis.
//
// ⚠️ AVANT TOUTE ACTIVATION, LA RLS DOIT ÊTRE REPRISE. Les policies de medical_notes
// n'ouvrent l'accès qu'au membre lui-même et à `is_super_admin()` — c'est-à-dire NEXXIA.
// Le personnel de la salle, à qui l'article promet l'accès exclusif, n'en a AUCUN. En
// l'état, activer la fonction ferait mentir l'engagement dans les deux sens à la fois.
import { LEGAL_VERSION, LEGAL_UPDATED_AT } from './meta'

export const privacyFr = `# Politique de confidentialité

**Dernière mise à jour : ${LEGAL_UPDATED_AT}** · Version ${LEGAL_VERSION}

## 1. Qui est responsable de vos données ?

L'application est fournie à votre salle de sport par **Nexxia** — Antoine Monie, entreprise en personne physique de droit belge, BCE **BE 1024.997.119**, Rue Grande Bruyère 6 B1, 4840 Welkenraedt, Belgique — éditeur de la plateforme **Viniz**.

- **Votre salle de sport** (dont l'identité complète figure dans l'application et dans ses propres conditions) est **responsable du traitement** de vos données de membre : c'est elle qui décide pourquoi vos données sont collectées (gérer vos réservations, vos paiements, votre abonnement).
- **Nexxia** agit comme **sous-traitant** : elle héberge et traite ces données pour le compte de votre salle, selon ses instructions, et est responsable du traitement pour les données strictement techniques de la plateforme.

Pour toute question relative à vos données : **support@viniz.app** ou directement auprès de votre salle.

## 2. Quelles données collectons-nous ?

**Données de compte** (fournies par vous à l'inscription ou dans votre profil) : nom, prénom, adresse email, mot de passe (stocké sous forme chiffrée irréversible), numéro de téléphone, date de naissance, genre, adresse postale, photo de profil, langue préférée, contact d'urgence (nom et téléphone).

**Données d'utilisation** (générées par votre activité) : réservations de cours (y compris listes d'attente et annulations), crédits et abonnements, historique de présence et absences non signalées, notifications envoyées et préférences de notification.

**Données de paiement** : montant, formule achetée, date, statut et référence de transaction. **Vos données bancaires (carte, IBAN) ne transitent jamais par nos systèmes** : elles sont traitées exclusivement par notre prestataire de paiement Mollie (voir art. 6).

**Données de santé** : l'application prévoit que votre salle puisse recueillir des informations médicales (conditions, restrictions d'activité, certificat médical). **Cette fonction n'est pas active à ce jour et aucune donnée de santé n'est collectée.** Si votre salle l'activait, le régime décrit à l'art. 4 s'appliquerait.

**Données techniques** : identifiant de notification push de votre appareil, horodatage de dernière connexion. L'application ne collecte **aucune donnée de géolocalisation** et n'intègre **aucun traceur publicitaire**.

## 3. Pourquoi et sur quelle base légale ?

- **Gestion du compte, réservations, listes d'attente, abonnements et crédits** — Exécution du contrat.
- **Traitement des paiements et facturation** — Exécution du contrat + obligation légale (comptabilité).
- **Notifications liées au service (place libérée, rappels de cours, confirmations)** — Exécution du contrat.
- **Application des règles de la salle (no-show, pénalités, suspension)** — Intérêt légitime de la salle.
- **Communications marketing** — Consentement (case dédiée, retirable à tout moment).
- **Données de santé**, si votre salle active cette fonction (art. 4) — Consentement explicite (RGPD art. 9.2.a).
- **Sécurité de la plateforme (journaux techniques)** — Intérêt légitime de l'éditeur.

## 4. Données de santé — protection renforcée

**Cette fonction n'est pas active.** L'application prévoit la possibilité, pour une salle, de recueillir des informations médicales — conditions, restrictions d'activité, certificat médical. À ce jour, aucune salle ne l'a activée, aucune donnée de santé n'est enregistrée et aucune activité n'exige de contrôle médical. Le présent article décrit le régime qui s'appliquerait **si votre salle activait cette fonction**.

Les informations médicales sont une **catégorie particulière de données** (RGPD art. 9). Elles seraient **facultatives** et soumises à votre **consentement explicite** ; elles seraient **chiffrées** dans la base de données (notes et conditions jamais stockées en clair), accessibles au seul personnel habilité de votre salle, et ne seraient utilisées à aucune autre fin que votre sécurité pendant les cours. Un certificat médical serait conservé avec sa date d'expiration et soumis aux mêmes protections.

Vous seriez informé dans l'application avant toute activation, et la durée de conservation vous serait précisée à ce moment.

**Une garantie s'applique dès aujourd'hui**, sans attendre cette activation : la suppression de votre compte efface définitivement toute donnée de santé qui aurait été enregistrée, sans conservation sous forme anonymisée (art. 5).

## 5. Combien de temps conservons-nous vos données ?

- **Compte actif** : tant que votre compte existe.
- **Suppression de compte** (disponible dans l'app, Profil → Supprimer mon compte) : vos données personnelles sont **anonymisées immédiatement** (nom, email, téléphone, adresse, photo remplacés), vos données de santé **effacées**, et votre connexion définitivement désactivée. Votre adresse email redevient utilisable pour un nouveau compte.
- **Données comptables et fiscales** (paiements, factures) : conservées **10 ans** à compter du 1er janvier de l'année qui suit l'exercice concerné, conformément aux délais applicables en matière de TVA et d'impôt sur les revenus (loi du 20 novembre 2022, en vigueur depuis le 1er janvier 2023). Les livres et journaux comptables relèvent quant à eux d'un délai de **7 ans** au titre du droit comptable.
- **Ces pièces conservent votre identité**, et nous ne pouvons pas l'en retirer : une facture doit désigner son client pour avoir une valeur probante. Elles ne sont utilisées à aucune autre fin que le respect de ces obligations légales et leur accès est restreint.
- **Historique de réservations** : conservé sous forme anonymisée à des fins statistiques pour la salle (taux de remplissage), sans lien avec votre identité.

## 6. Qui a accès à vos données ?

**Votre salle de sport** : le gérant et le personnel autorisé accèdent aux données des membres de leur salle uniquement (cloisonnement strict par salle au niveau de la base de données).

**Nos sous-traitants techniques**, chacun limité à sa fonction :

- **Supabase** — Hébergement de la base de données et de l'infrastructure · Traite l'ensemble des données de compte, d'utilisation et de paiement, ainsi que les données de santé si la fonction de l'art. 4 était activée · Union européenne (Paris, France).
- **Mollie B.V.** — Traitement des paiements · Traite l'identité de facturation et les données de transaction ; seul destinataire de vos données bancaires (Pays-Bas, agréé DNB) · UE.
- **Resend** — Envoi des emails transactionnels · Traite votre adresse email, votre prénom et le contenu du message · Union européenne (Irlande).
- **Vercel Inc.** — Hébergement du tableau de bord destiné à votre salle · Traite, à l'affichage, les données de compte, de réservation et de paiement des membres de la salle · États-Unis (clauses contractuelles types).
- **PostHog Inc.** — Mesure d'usage de l'application, à des fins d'amélioration du produit · Traite un identifiant technique de compte et des événements d'usage (écrans consultés, actions) ; **aucune donnée de santé, aucun contenu de message** · Hébergement dans l'Union européenne (Allemagne) ; éditeur établi aux États-Unis (clauses contractuelles types).
- **Functional Software Inc. (Sentry)** — Journalisation des erreurs techniques, pour diagnostiquer les pannes · Traite un identifiant technique de compte et le contexte technique de l'erreur · Ingestion dans l'Union européenne (Allemagne) ; éditeur établi aux États-Unis (clauses contractuelles types).
- **Expo / Apple** — Acheminement des notifications push · Traite un jeton d'appareil et le contenu de la notification · UE/États-Unis (clauses contractuelles types).

**Connexion via Google ou Apple** (facultative) : si vous choisissez ce mode de connexion, Google Ireland Ltd ou Apple Inc. nous transmet votre adresse email et votre nom. Ces sociétés agissent alors comme **responsables de traitement autonomes** pour l'authentification — elles ne sont pas nos sous-traitantes — et leurs propres politiques de confidentialité s'appliquent à cette étape.

Nous ne **vendons ni ne louons** vos données à personne. Aucune donnée n'est transmise à des tiers à des fins publicitaires.

## 7. Transferts hors Union européenne

Vos données sont hébergées et traitées dans l'Union européenne : base de données à Paris, emails en Irlande, mesure d'usage et journalisation des erreurs en Allemagne.

Certains prestataires sont toutefois établis aux **États-Unis** et sont susceptibles d'y accéder dans le cadre de leur exploitation : **Vercel** (hébergement du tableau de bord), **PostHog** et **Sentry** (dont l'hébergement reste européen), ainsi qu'**Expo** et **Apple** pour l'acheminement des notifications push. Ces transferts sont encadrés par les mécanismes prévus au chapitre V du RGPD (clauses contractuelles types, EU-US Data Privacy Framework le cas échéant).

## 8. Vos droits

Conformément au RGPD, vous disposez des droits suivants :

- **Accès et portabilité** : demandez une copie de vos données depuis l'app (Profil → Exporter mes données) ou par email.
- **Rectification** : modifiez vos informations directement dans votre profil.
- **Effacement** : supprimez votre compte directement dans l'app (voir art. 5). Restriction : si un abonnement avec engagement est en cours, la suppression est possible au terme de celui-ci.
- **Retrait du consentement** : désactivez les communications marketing dans vos préférences à tout moment.
- **Opposition et limitation** : contactez-nous à support@viniz.app.
- **Réclamation** : vous pouvez saisir l'**Autorité de protection des données** (APD/GBA), rue de la Presse 35, 1000 Bruxelles — www.autoriteprotectiondonnees.be.

Nous répondons à toute demande dans un délai maximum d'un mois.

## 9. Sécurité

Mesures en place : chiffrement des communications (HTTPS/TLS), cloisonnement des données par salle au niveau de la base (règles d'accès en base de données), secrets et jetons de paiement stockés dans un coffre-fort chiffré, mots de passe soumis à une politique de robustesse, journalisation des accès. Le chiffrement spécifique des données de santé relève de l'article 4, dont la fonction n'est pas active à ce jour. Aucun système n'étant infaillible, nous nous engageons à notifier l'APD et les personnes concernées en cas de violation de données dans les conditions prévues aux articles 33-34 du RGPD.

## 10. Mineurs

L'application est destinée aux personnes de **16 ans ou plus**. L'inscription d'un mineur de moins de 16 ans requiert l'accord de son responsable légal et l'acceptation par la salle, selon les conditions propres de celle-ci. Si nous constatons qu'un compte a été créé en violation de cette règle, il sera supprimé.

## 11. Modifications de cette politique

Toute modification substantielle vous sera notifiée dans l'application avant son entrée en vigueur, avec la date de mise à jour en tête de ce document. La version en vigueur est consultable à tout moment sur **viniz.app/legal/privacy** et dans l'app.

## 12. Contact

**Éditeur / sous-traitant** : Nexxia (Antoine Monie) — Rue Grande Bruyère 6 B1, 4840 Welkenraedt, Belgique — BCE BE 1024.997.119 — support@viniz.app

**Responsable du traitement (votre salle)** : voir les informations de votre salle dans l'application.
`
