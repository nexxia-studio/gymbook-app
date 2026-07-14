# Politique de confidentialité — v1 (GYM-109)

> **Statut** : v1 PUBLIABLE — les points en attente (Nico/avocat) sont formulés en défauts prudents, tracés dans l'annexe interne. Plus aucune balise visible dans le texte publiable.
> **Périmètre** : app mobile membre (Dopamine, white-label Viniz) + dashboard gérant.
> **Ancrage** : chaque article correspond à un traitement réellement présent dans le code/schéma (vérifié le 14/07/2026).
> Version EN à produire après gel du texte FR (fait par Claude Code à l'intégration).

---

**Dernière mise à jour : [DATE DE PUBLICATION]** · Version 1.0

## 1. Qui est responsable de vos données ?

L'application est fournie à votre salle de sport par **Nexxia** — Antoine Monie, entreprise en personne physique de droit belge, BCE **BE 1024.997.119**, Rue Grande Bruyère 6 B1, 4840 Welkenraedt, Belgique — éditeur de la plateforme **Viniz**.

- **Votre salle de sport** (dont l'identité complète figure dans l'application et dans ses propres conditions) est **responsable du traitement** de vos données de membre : c'est elle qui décide pourquoi vos données sont collectées (gérer vos réservations, vos paiements, votre abonnement).
- **Nexxia** agit comme **sous-traitant** : elle héberge et traite ces données pour le compte de votre salle, selon ses instructions, et est responsable du traitement pour les données strictement techniques de la plateforme.

Pour toute question relative à vos données : **support@viniz.app** ou directement auprès de votre salle.

## 2. Quelles données collectons-nous ?

**Données de compte** (fournies par vous à l'inscription ou dans votre profil) : nom, prénom, adresse email, mot de passe (stocké sous forme chiffrée irréversible), numéro de téléphone, date de naissance, genre, adresse postale, photo de profil, langue préférée, contact d'urgence (nom et téléphone).

**Données d'utilisation** (générées par votre activité) : réservations de cours (y compris listes d'attente et annulations), crédits et abonnements, historique de présence et absences non signalées, notifications envoyées et préférences de notification.

**Données de paiement** : montant, formule achetée, date, statut et référence de transaction. **Vos données bancaires (carte, IBAN) ne transitent jamais par nos systèmes** : elles sont traitées exclusivement par notre prestataire de paiement Mollie (voir art. 6).

**Données de santé (facultatives)** : si vous ou votre salle renseignez des informations médicales (conditions, restrictions d'activité, certificat médical), celles-ci sont **chiffrées** dans nos bases et accessibles uniquement au personnel autorisé de votre salle. Voir art. 4.

**Données techniques** : identifiant de notification push de votre appareil, horodatage de dernière connexion. L'application ne collecte **aucune donnée de géolocalisation** et n'intègre **aucun traceur publicitaire**.

## 3. Pourquoi et sur quelle base légale ?

| Traitement | Base légale (RGPD art. 6) |
|---|---|
| Gestion du compte, réservations, listes d'attente, abonnements et crédits | Exécution du contrat |
| Traitement des paiements et facturation | Exécution du contrat + obligation légale (comptabilité) |
| Notifications liées au service (place libérée, rappels de cours, confirmations) | Exécution du contrat |
| Application des règles de la salle (no-show, pénalités, suspension) | Intérêt légitime de la salle |
| Communications marketing | **Consentement** (case dédiée, retirable à tout moment) |
| Données de santé | **Consentement explicite** (RGPD art. 9.2.a) |
| Sécurité de la plateforme (journaux techniques) | Intérêt légitime de l'éditeur |

## 4. Données de santé — protection renforcée

Les informations médicales sont une **catégorie particulière de données** (RGPD art. 9). Notre dispositif : elles sont **facultatives**, **chiffrées** dans la base de données (les notes et conditions ne sont jamais stockées en clair), accessibles uniquement au personnel habilité de votre salle, jamais utilisées à d'autres fins que votre sécurité pendant les cours, et **définitivement effacées** lors de la suppression de votre compte (elles ne sont pas conservées sous forme anonymisée). Si votre salle requiert un certificat médical pour certaines activités, celui-ci est conservé avec sa date d'expiration et soumis aux mêmes protections.

## 5. Combien de temps conservons-nous vos données ?

- **Compte actif** : tant que votre compte existe.
- **Suppression de compte** (disponible dans l'app, Profil → Supprimer mon compte) : vos données personnelles sont **anonymisées immédiatement** (nom, email, téléphone, adresse, photo remplacés), vos données de santé **effacées**, et votre connexion définitivement désactivée. Votre adresse email redevient utilisable pour un nouveau compte.
- **Données comptables** (paiements, factures) : conservées **7 ans** sous forme dissociée de votre identité, conformément aux obligations comptables et fiscales belges.
- **Historique de réservations** : conservé sous forme anonymisée à des fins statistiques pour la salle (taux de remplissage), sans lien avec votre identité.

## 6. Qui a accès à vos données ?

**Votre salle de sport** : le gérant et le personnel autorisé accèdent aux données des membres de leur salle uniquement (cloisonnement strict par salle au niveau de la base de données).

**Nos sous-traitants techniques**, chacun limité à sa fonction :

| Prestataire | Fonction | Localisation des données |
|---|---|---|
| Supabase | Hébergement de la base de données et de l'infrastructure | Union européenne (Paris, France) |
| Mollie B.V. | Traitement des paiements (Pays-Bas, agréé DNB) | UE |
| Resend | Envoi des emails transactionnels | Union européenne (Irlande) |
| Expo / Apple | Acheminement des notifications push | UE/États-Unis (clauses contractuelles types) |

Nous ne **vendons ni ne louons** vos données à personne. Aucune donnée n'est transmise à des tiers à des fins publicitaires.

## 7. Transferts hors Union européenne

Vos données sont hébergées et traitées dans l'Union européenne (base de données à Paris, emails en Irlande). Seul l'acheminement des notifications push transite par les infrastructures d'Expo et d'Apple, susceptibles de traiter des identifiants techniques aux États-Unis ; ces transferts sont encadrés par les mécanismes prévus au chapitre V du RGPD (clauses contractuelles types, EU-US Data Privacy Framework le cas échéant).

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

Mesures en place : chiffrement des communications (HTTPS/TLS), chiffrement spécifique des données de santé, cloisonnement des données par salle au niveau de la base (règles d'accès en base de données), secrets et jetons de paiement stockés dans un coffre-fort chiffré, mots de passe soumis à une politique de robustesse, journalisation des accès. Aucun système n'étant infaillible, nous nous engageons à notifier l'APD et les personnes concernées en cas de violation de données dans les conditions prévues aux articles 33-34 du RGPD.

## 10. Mineurs

L'application est destinée aux personnes de **16 ans ou plus**. L'inscription d'un mineur de moins de 16 ans requiert l'accord de son responsable légal et l'acceptation par la salle, selon les conditions propres de celle-ci. Si nous constatons qu'un compte a été créé en violation de cette règle, il sera supprimé.

## 11. Modifications de cette politique

Toute modification substantielle vous sera notifiée dans l'application avant son entrée en vigueur, avec la date de mise à jour en tête de ce document. La version en vigueur est consultable à tout moment sur **viniz.app/legal/privacy** et dans l'app.

## 12. Contact

**Éditeur / sous-traitant** : Nexxia (Antoine Monie) — Rue Grande Bruyère 6 B1, 4840 Welkenraedt, Belgique — BCE BE 1024.997.119 — support@viniz.app
**Responsable du traitement (votre salle)** : voir les informations de votre salle dans l'application.

---

## Annexe interne (ne pas publier) — défauts prudents en attente de confirmation

| Article | Défaut publié | En attente de |
|---|---|---|
| 1 | Identité de la salle renvoyée à "l'application / ses conditions" | NICO : entité légale exacte de Dopamine (BCE, adresse) → à afficher dans l'app (écran infos salle) et dans les CGV |
| 4 | Certificat médical formulé en conditionnel ("si votre salle requiert") | NICO : politique certificat (obligatoire ? quelles activités ?) |
| 10 | Mineurs : 16 ans min. + accord responsable légal + accord salle | NICO : politique mineurs réelle · AVOCAT : dispositif de consentement parental |
| 3, 5, 7 | Qualifications juridiques standard (intérêt légitime no-show, 7 ans comptable, CCT/DPF push) | AVOCAT : relecture globale avant scaling (non bloquant pour la publication v1) |
| 12 | Adresse siège Welkenraedt | ANTOINE : déménagement du siège prévu octobre 2026 → mise à jour de l'adresse + date de version à ce moment |

## Annexe interne (ne pas publier) — mapping traitement ↔ code

| Article | Ancrage technique |
|---|---|
| 2 — compte | `profiles` (identité, adresse, urgence, langue, avatar) |
| 2 — usage | `bookings`, `member_credits`, `member_subscriptions`, `penalties`, `notifications`, `notification_preferences` |
| 2 — paiement | `payments` (montants, mollie_payment_id — jamais de PAN/IBAN) |
| 2 — technique | `profiles.push_token`, `last_seen_at` |
| 4 — santé | `medical_notes` (`notes_encrypted`, `conditions_encrypted`, certificat + expiry, `restricted_activities`) — purge à la suppression (delete-account v1) |
| 5 — suppression | delete-account (anonymisation + neutralisation auth + email libéré, GYM-46/118) ; guard engagement (GYM-113) |
| 5 — comptable | conservation `payments`/`bookings` dissociés du profil anonymisé |
| 8 — export | export-data v1 (mailto) — [évolution : export automatisé] |
| 8 — consentements | `profiles.privacy_policy_accepted_at/version`, `terms_accepted_at/version`, `marketing_consent(_at)`, `data_processing_consent(_at)` |
| 9 — sécurité | RLS multi-tenant, Vault (tokens Mollie, secrets), policy mots de passe (01/07), TLS |
