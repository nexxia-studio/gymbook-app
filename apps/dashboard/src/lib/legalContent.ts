// Contenu légal des pages web publiques (/legal/privacy, /legal/terms).
//
// SOURCE DE VÉRITÉ : docs/legal/politique-confidentialite-v1.md et docs/legal/cgv-v1.md
// (corps publiables uniquement — jamais les annexes internes).
//
// DUPLICATION ASSUMÉE : le monorepo n'a pas de package TS partagé entre le mobile
// (Metro/Expo) et le dashboard (Vite). Ce fichier reproduit à l'identique les corps de
// apps/mobile/constants/legal/*.ts. Toute modification doit être répercutée des deux côtés
// (mobile + web) à partir de la source docs/legal/*.md.

export interface ClubIdentity {
  name: string
  commune: string
  bce: string
  vat: string
  address: string
  email: string
}

// Miroir de apps/mobile/constants/club.ts (identité du Club interpolée, jamais en dur).
export const CLUB_IDENTITY: ClubIdentity = {
  name: 'Dopamine Performance Club',
  commune: 'Neupré',
  bce: '',
  vat: '',
  address: '',
  email: '',
}

export const LEGAL_VERSION = '1.0'
// PLACEHOLDER ISO à figer à la date de publication prod (miroir de constants/legal/meta.ts).
// TODO: figer à la date de publication prod avant déploiement.
export const LEGAL_UPDATED_AT = '2026-07-14'

export type LegalKind = 'privacy' | 'terms'
export type LegalLang = 'fr' | 'en'

const privacyFr = `# Politique de confidentialité

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

**Données de santé (facultatives)** : si vous ou votre salle renseignez des informations médicales (conditions, restrictions d'activité, certificat médical), celles-ci sont **chiffrées** dans nos bases et accessibles uniquement au personnel autorisé de votre salle. Voir art. 4.

**Données techniques** : identifiant de notification push de votre appareil, horodatage de dernière connexion. L'application ne collecte **aucune donnée de géolocalisation** et n'intègre **aucun traceur publicitaire**.

## 3. Pourquoi et sur quelle base légale ?

- **Gestion du compte, réservations, listes d'attente, abonnements et crédits** — Exécution du contrat.
- **Traitement des paiements et facturation** — Exécution du contrat + obligation légale (comptabilité).
- **Notifications liées au service (place libérée, rappels de cours, confirmations)** — Exécution du contrat.
- **Application des règles de la salle (no-show, pénalités, suspension)** — Intérêt légitime de la salle.
- **Communications marketing** — Consentement (case dédiée, retirable à tout moment).
- **Données de santé** — Consentement explicite (RGPD art. 9.2.a).
- **Sécurité de la plateforme (journaux techniques)** — Intérêt légitime de l'éditeur.

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

- **Supabase** — Hébergement de la base de données et de l'infrastructure · Union européenne (Paris, France).
- **Mollie B.V.** — Traitement des paiements (Pays-Bas, agréé DNB) · UE.
- **Resend** — Envoi des emails transactionnels · Union européenne (Irlande).
- **Expo / Apple** — Acheminement des notifications push · UE/États-Unis (clauses contractuelles types).

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
`

const privacyEn = `# Privacy Policy

**Last updated: ${LEGAL_UPDATED_AT}** · Version ${LEGAL_VERSION}

## 1. Who is responsible for your data?

The application is provided to your gym by **Nexxia** — Antoine Monie, a Belgian sole trader, company number (BCE) **BE 1024.997.119**, Rue Grande Bruyère 6 B1, 4840 Welkenraedt, Belgium — publisher of the **Viniz** platform.

- **Your gym** (whose full identity is shown in the application and in its own terms) is the **data controller** for your member data: it decides why your data is collected (managing your bookings, payments and membership).
- **Nexxia** acts as a **data processor**: it hosts and processes this data on behalf of your gym, on its instructions, and is the controller for data strictly related to the platform's technical operation.

For any question about your data: **support@viniz.app** or directly with your gym.

## 2. What data do we collect?

**Account data** (provided by you at sign-up or in your profile): last name, first name, email address, password (stored in irreversibly hashed form), phone number, date of birth, gender, postal address, profile picture, preferred language, emergency contact (name and phone).

**Usage data** (generated by your activity): class bookings (including waitlists and cancellations), credits and subscriptions, attendance history and unreported absences, notifications sent and notification preferences.

**Payment data**: amount, plan purchased, date, status and transaction reference. **Your banking details (card, IBAN) never pass through our systems**: they are handled exclusively by our payment provider Mollie (see art. 6).

**Health data (optional)**: if you or your gym record medical information (conditions, activity restrictions, medical certificate), it is **encrypted** in our databases and accessible only to your gym's authorised staff. See art. 4.

**Technical data**: your device's push notification identifier, last-connection timestamp. The application collects **no geolocation data** and includes **no advertising trackers**.

## 3. Why and on what legal basis?

- **Account management, bookings, waitlists, subscriptions and credits** — Performance of the contract.
- **Payment processing and invoicing** — Performance of the contract + legal obligation (accounting).
- **Service-related notifications (spot freed up, class reminders, confirmations)** — Performance of the contract.
- **Enforcement of gym rules (no-show, penalties, suspension)** — Legitimate interest of the gym.
- **Marketing communications** — Consent (dedicated opt-in, withdrawable at any time).
- **Health data** — Explicit consent (GDPR art. 9.2.a).
- **Platform security (technical logs)** — Legitimate interest of the publisher.

## 4. Health data — enhanced protection

Medical information is a **special category of data** (GDPR art. 9). Our safeguards: it is **optional**, **encrypted** in the database (notes and conditions are never stored in clear text), accessible only to your gym's authorised staff, never used for any purpose other than your safety during classes, and **permanently erased** when your account is deleted (it is not kept in anonymised form). If your gym requires a medical certificate for certain activities, it is kept with its expiry date and subject to the same protections.

## 5. How long do we keep your data?

- **Active account**: for as long as your account exists.
- **Account deletion** (available in the app, Profile → Delete my account): your personal data is **anonymised immediately** (name, email, phone, address, photo replaced), your health data **erased**, and your login permanently disabled. Your email address becomes usable again for a new account.
- **Accounting data** (payments, invoices): kept for **7 years** in a form dissociated from your identity, in accordance with Belgian accounting and tax obligations.
- **Booking history**: kept in anonymised form for statistical purposes for the gym (occupancy rates), with no link to your identity.

## 6. Who has access to your data?

**Your gym**: the manager and authorised staff access the data of members of their gym only (strict per-gym isolation at the database level).

**Our technical sub-processors**, each limited to its function:

- **Supabase** — Database and infrastructure hosting · European Union (Paris, France).
- **Mollie B.V.** — Payment processing (Netherlands, DNB-licensed) · EU.
- **Resend** — Sending of transactional emails · European Union (Ireland).
- **Expo / Apple** — Delivery of push notifications · EU/United States (standard contractual clauses).

We do **not sell or rent** your data to anyone. No data is shared with third parties for advertising purposes.

## 7. Transfers outside the European Union

Your data is hosted and processed in the European Union (database in Paris, emails in Ireland). Only the delivery of push notifications transits through the infrastructures of Expo and Apple, which may process technical identifiers in the United States; these transfers are governed by the mechanisms provided in Chapter V of the GDPR (standard contractual clauses, EU-US Data Privacy Framework where applicable).

## 8. Your rights

In accordance with the GDPR, you have the following rights:

- **Access and portability**: request a copy of your data from the app (Profile → Export my data) or by email.
- **Rectification**: edit your information directly in your profile.
- **Erasure**: delete your account directly in the app (see art. 5). Restriction: if a subscription with a commitment is ongoing, deletion is possible at its end.
- **Withdrawal of consent**: disable marketing communications in your preferences at any time.
- **Objection and restriction**: contact us at support@viniz.app.
- **Complaint**: you may lodge a complaint with the **Data Protection Authority** (APD/GBA), rue de la Presse 35, 1000 Brussels — www.autoriteprotectiondonnees.be.

We respond to any request within a maximum of one month.

## 9. Security

Measures in place: encryption of communications (HTTPS/TLS), specific encryption of health data, per-gym data isolation at the database level (database access rules), secrets and payment tokens stored in an encrypted vault, passwords subject to a strength policy, access logging. As no system is infallible, we undertake to notify the DPA and the persons concerned in the event of a data breach under the conditions set out in Articles 33-34 of the GDPR.

## 10. Minors

The application is intended for persons **aged 16 or over**. Registration of a minor under 16 requires the consent of their legal guardian and acceptance by the gym, subject to the gym's own conditions. If we find that an account has been created in breach of this rule, it will be deleted.

## 11. Changes to this policy

Any substantial change will be notified to you in the application before it takes effect, with the update date at the top of this document. The version in force can be consulted at any time at **viniz.app/legal/privacy** and in the app.

## 12. Contact

**Publisher / processor**: Nexxia (Antoine Monie) — Rue Grande Bruyère 6 B1, 4840 Welkenraedt, Belgium — BCE BE 1024.997.119 — support@viniz.app

**Data controller (your gym)**: see your gym's information in the application.
`

const termsFr = `# Conditions générales

**Dernière mise à jour : ${LEGAL_UPDATED_AT}** · Version ${LEGAL_VERSION}

### 1. Identification et objet

Les présentes conditions régissent l'utilisation de l'application Dopamine et l'achat de prestations auprès de **${CLUB_IDENTITY.name}**, ${CLUB_IDENTITY.commune} (« le Club »), vendeur des prestations, dont l'identité complète (dénomination légale, numéro d'entreprise, siège) est affichée dans l'application, écran d'informations du Club. L'application est éditée par **Nexxia** — Antoine Monie, entreprise en personne physique de droit belge, BCE BE 1024.997.119, Rue Grande Bruyère 6 B1, 4840 Welkenraedt (« l'Éditeur »), prestataire technique et sous-traitant du Club. Les paiements sont traités par **Mollie B.V.** pour le compte du Club.

### 2. Compte membre

2.1. Un compte est requis pour réserver. Le membre garantit l'exactitude de ses informations et la confidentialité de ses identifiants.

2.2. L'inscription est ouverte aux personnes de **16 ans et plus**. Les mineurs de moins de 16 ans ne peuvent s'inscrire qu'avec l'accord de leur représentant légal et l'accord du Club, selon les conditions propres de celui-ci.

2.3. La suppression du compte est possible à tout moment dans l'application (Profil) : les données personnelles sont anonymisées, les données transactionnelles conservées conformément aux obligations comptables (cf. Politique de confidentialité). La suppression est possible au terme d'un éventuel abonnement en cours (art. 10).

### 3. Formules et prix

3.1. Deux types de formules, aux prix en euros TTC affichés dans l'application : **à l'unité** (Drop-in, cartes — créditent des séances) et **abonnements** (accès illimité pour la durée choisie, mensualités par domiciliation SEPA).

3.2. **Les séances achetées n'ont pas de date d'expiration.** Toute évolution future de cette règle ne s'appliquera jamais aux séances déjà achetées.

3.3. Les crédits et cartes sont cumulables librement. Un seul abonnement actif à la fois. Pendant un abonnement actif, l'achat à l'unité est indisponible (l'accès est déjà illimité) ; les crédits détenus sont conservés et redeviennent utilisables à l'échéance de l'abonnement.

3.4. Les prix applicables sont ceux affichés au moment de l'achat. Les conditions d'un abonnement en cours ne sont jamais modifiées.

### 4. Paiement

4.1. Les paiements sont opérés via Mollie. Achats à l'unité : paiement immédiat par les moyens proposés à l'écran de paiement (notamment Bancontact et carte). Abonnements : le premier paiement établit un mandat de domiciliation SEPA, les mensualités suivantes sont prélevées automatiquement.

4.2. En cas d'échec d'un prélèvement mensuel non régularisé après information du membre, le Club peut suspendre l'accès aux réservations jusqu'à régularisation, sans préjudice des sommes dues.

### 5. Droit de rétractation

5.1. Conformément aux articles VI.47 et suivants du Code de droit économique, le membre consommateur dispose d'un délai de **14 jours** à compter de l'achat à distance pour se rétracter sans motif.

5.2. En achetant, le membre demande expressément que la prestation commence avant l'expiration de ce délai. En cas de rétractation dans le délai : les séances déjà consommées sont déduites au prorata du prix payé ; pour un abonnement entamé, le remboursement est diminué de la valeur de la période écoulée. Le droit de rétractation est perdu si la prestation a été pleinement exécutée avant la fin du délai (art. VI.53, 1° CDE).

5.3. Le droit s'exerce par email à l'adresse de contact du Club indiquée dans l'application, ou via support@viniz.app qui transmettra au Club, le cas échéant au moyen du formulaire légal de rétractation.

### 6. Réservations

6.1. Réserver — y compris rejoindre une liste d'attente — requiert un abonnement actif ou au moins une séance disponible.

6.2. Maximum **2 réservations confirmées à venir** simultanément.

6.3. Une séance n'est décomptée qu'à la **confirmation** de la place (jamais en liste d'attente ; jamais sous abonnement).

6.4. Chaque cours a une capacité maximale ; cours complet → inscription en liste d'attente possible.

### 7. Liste d'attente

7.1. L'ordre de la liste est l'ordre d'inscription.

7.2. Lorsqu'une place se libère, le premier de la liste est notifié (notification et email) et dispose d'un **délai de 30 minutes** — affiché dans l'application — pour confirmer sa place (la séance est décomptée à la confirmation, sauf abonnement).

7.3. À défaut de confirmation dans le délai, l'inscription en liste d'attente expire et la place est proposée au suivant. Le membre peut se réinscrire en liste d'attente.

### 8. Annulation par le membre

8.1. **Gratuite jusqu'à 2 heures avant** le début du cours : la séance est immédiatement re-créditée (rien à re-créditer sous abonnement).

8.2. **Moins de 2 heures avant** : l'annulation est assimilée à une absence non excusée (art. 9) — pas de re-crédit, barème 9.2 applicable.

8.3. Se retirer d'une liste d'attente est libre et sans conséquence.

### 9. Absences non excusées (« no-show »)

9.1. Est en absence non excusée le membre confirmé qui ne se présente pas sans avoir annulé.

9.2. Barème automatique cumulatif : **1ʳᵉ absence** = avertissement · **2ᵉ** = suspension des réservations pendant **48 heures** · **3ᵉ et suivantes** = suspension de **2 semaines**.

9.3. La séance n'est pas re-créditée. Le compteur d'absences est cumulatif ; le Club peut le réinitialiser à sa discrétion.

### 10. Abonnements — durée, échéance, résiliation

10.1. L'abonnement est conclu pour la durée choisie, payée par mensualités SEPA. Il prend fin de plein droit à son échéance, **sans tacite reconduction** : aucun prélèvement n'intervient au-delà du terme.

10.2. L'abonnement constitue un **engagement ferme pour la durée choisie** : il ne peut pas être résilié de manière anticipée et les mensualités restent dues jusqu'au terme, sans préjudice du droit de rétractation (art. 5) et des cas de motif légitime prévus par la loi. L'application affiche la date de fin d'engagement.

10.3. Pendant l'abonnement, les séances à l'unité détenues sont conservées mais inutilisées (art. 3.3).

### 11. Remboursements

11.1. Le re-crédit de séances s'opère selon les articles 7 et 8.

11.2. Si un cours est annulé par le Club, la séance décomptée est automatiquement re-créditée. Tout autre remboursement monétaire, hors droit de rétractation, relève de l'appréciation du Club, sans préjudice des droits légaux du consommateur.

### 12. Comportement, sécurité et santé

12.1. Le membre respecte le règlement intérieur du Club, affiché dans ses locaux et/ou dans l'application.

12.2. La pratique d'activités physiques intensives requiert une condition physique adaptée : le membre déclare ne présenter aucune contre-indication médicale connue. Si le Club exige un certificat médical pour certaines activités, il doit être fourni avant la participation. Les informations relatives aux assurances du Club sont disponibles sur demande auprès de celui-ci.

### 13. Données personnelles

Le traitement des données est décrit dans la Politique de confidentialité, accessible dans l'application (Profil → Confidentialité) et sur viniz.app/legal/privacy. Responsable du traitement : le Club. Sous-traitant principal : Nexxia (plateforme Viniz) ; autres sous-traitants : Supabase, Mollie, Resend, Expo/Apple.

### 14. Modifications

Toute modification des présentes conditions est portée à la connaissance des membres via l'application au moins **30 jours** avant son entrée en vigueur. Elle ne s'applique jamais rétroactivement aux achats effectués.

### 15. Droit applicable et litiges

Les présentes conditions sont régies par le droit belge. En cas de litige, le membre peut recourir au Service de Médiation pour le Consommateur (mediationconsommateur.be) ou à la plateforme européenne de règlement en ligne des litiges (ec.europa.eu/odr). À défaut de résolution amiable, les tribunaux de l'arrondissement de **Liège** sont compétents, sans préjudice des règles impératives de compétence.
`

const termsEn = `# Terms & Conditions

**Last updated: ${LEGAL_UPDATED_AT}** · Version ${LEGAL_VERSION}

### 1. Identification and purpose

These terms govern the use of the Dopamine application and the purchase of services from **${CLUB_IDENTITY.name}**, ${CLUB_IDENTITY.commune} ("the Club"), the seller of the services, whose full identity (legal name, company number, registered office) is displayed in the application, on the Club information screen. The application is published by **Nexxia** — Antoine Monie, a Belgian sole trader, BCE BE 1024.997.119, Rue Grande Bruyère 6 B1, 4840 Welkenraedt ("the Publisher"), technical provider and processor for the Club. Payments are processed by **Mollie B.V.** on behalf of the Club.

### 2. Member account

2.1. An account is required to book. The member warrants the accuracy of their information and the confidentiality of their credentials.

2.2. Registration is open to persons **aged 16 and over**. Minors under 16 may only register with the consent of their legal representative and the agreement of the Club, subject to the Club's own conditions.

2.3. Account deletion is available at any time in the application (Profile): personal data is anonymised, transactional data is retained in accordance with accounting obligations (see the Privacy Policy). Deletion is possible at the end of any ongoing subscription (art. 10).

### 3. Plans and prices

3.1. Two types of plans, at the prices in euros incl. VAT shown in the application: **per-session** (Drop-in, passes — credit sessions) and **subscriptions** (unlimited access for the chosen duration, monthly instalments by SEPA direct debit).

3.2. **Purchased sessions have no expiry date.** Any future change to this rule will never apply to sessions already purchased.

3.3. Credits and passes are freely cumulative. Only one active subscription at a time. During an active subscription, per-session purchase is unavailable (access is already unlimited); credits held are kept and become usable again when the subscription ends.

3.4. The applicable prices are those displayed at the time of purchase. The terms of an ongoing subscription are never modified.

### 4. Payment

4.1. Payments are processed via Mollie. Per-session purchases: immediate payment by the means offered on the payment screen (notably Bancontact and card). Subscriptions: the first payment establishes a SEPA direct debit mandate, subsequent instalments are collected automatically.

4.2. In the event of a failed monthly direct debit not regularised after the member has been informed, the Club may suspend access to bookings until regularisation, without prejudice to the amounts due.

### 5. Right of withdrawal

5.1. In accordance with Articles VI.47 et seq. of the Code of Economic Law, the consumer member has a period of **14 days** from the distance purchase to withdraw without giving a reason.

5.2. By purchasing, the member expressly requests that the service begin before the expiry of this period. In the event of withdrawal within the period: sessions already used are deducted pro rata from the price paid; for a subscription already started, the refund is reduced by the value of the elapsed period. The right of withdrawal is lost if the service has been fully performed before the end of the period (art. VI.53, 1° CEL).

5.3. The right is exercised by email to the Club's contact address shown in the application, or via support@viniz.app which will forward it to the Club, where applicable using the legal withdrawal form.

### 6. Bookings

6.1. Booking — including joining a waitlist — requires an active subscription or at least one available session.

6.2. Maximum **2 confirmed upcoming bookings** at a time.

6.3. A session is only debited upon **confirmation** of the spot (never on a waitlist; never under a subscription).

6.4. Each class has a maximum capacity; class full → waitlist registration possible.

### 7. Waitlist

7.1. The order of the list is the order of registration.

7.2. When a spot frees up, the first person on the list is notified (notification and email) and has a **30-minute window** — shown in the application — to confirm their spot (the session is debited on confirmation, except under a subscription).

7.3. Failing confirmation within the window, the waitlist registration expires and the spot is offered to the next person. The member may re-register on the waitlist.

### 8. Cancellation by the member

8.1. **Free up to 2 hours before** the start of the class: the session is immediately re-credited (nothing to re-credit under a subscription).

8.2. **Less than 2 hours before**: the cancellation is treated as an unexcused absence (art. 9) — no re-credit, scale 9.2 applies.

8.3. Withdrawing from a waitlist is free and without consequence.

### 9. Unexcused absences ("no-show")

9.1. An unexcused absence is a confirmed member who does not attend without having cancelled.

9.2. Automatic cumulative scale: **1st absence** = warning · **2nd** = booking suspension for **48 hours** · **3rd and beyond** = suspension for **2 weeks**.

9.3. The session is not re-credited. The absence counter is cumulative; the Club may reset it at its discretion.

### 10. Subscriptions — duration, term, termination

10.1. The subscription is concluded for the chosen duration, paid by SEPA monthly instalments. It ends automatically at its term, **with no tacit renewal**: no debit occurs beyond the term.

10.2. The subscription constitutes a **firm commitment for the chosen duration**: it cannot be terminated early and the instalments remain due until the term, without prejudice to the right of withdrawal (art. 5) and the legitimate-grounds cases provided by law. The application displays the commitment end date.

10.3. During the subscription, per-session credits held are kept but unused (art. 3.3).

### 11. Refunds

11.1. The re-crediting of sessions operates under Articles 7 and 8.

11.2. If a class is cancelled by the Club, the debited session is automatically re-credited. Any other monetary refund, outside the right of withdrawal, is at the Club's discretion, without prejudice to the consumer's legal rights.

### 12. Conduct, safety and health

12.1. The member complies with the Club's internal rules, displayed on its premises and/or in the application.

12.2. The practice of intensive physical activities requires suitable physical condition: the member declares having no known medical contraindication. If the Club requires a medical certificate for certain activities, it must be provided before participation. Information relating to the Club's insurance is available on request from the Club.

### 13. Personal data

The processing of data is described in the Privacy Policy, accessible in the application (Profile → Privacy) and at viniz.app/legal/privacy. Data controller: the Club. Main processor: Nexxia (Viniz platform); other processors: Supabase, Mollie, Resend, Expo/Apple.

### 14. Changes

Any change to these terms is brought to the members' attention via the application at least **30 days** before it takes effect. It never applies retroactively to purchases already made.

### 15. Governing law and disputes

These terms are governed by Belgian law. In the event of a dispute, the member may use the Consumer Mediation Service (mediationconsommateur.be) or the European online dispute resolution platform (ec.europa.eu/odr). Failing an amicable resolution, the courts of the district of **Liège** have jurisdiction, without prejudice to the mandatory rules of jurisdiction.
`

const DOCS: Record<LegalKind, Record<LegalLang, string>> = {
  privacy: { fr: privacyFr, en: privacyEn },
  terms: { fr: termsFr, en: termsEn },
}

export function getLegalDoc(kind: LegalKind, lang: LegalLang): string {
  return DOCS[kind][lang] ?? DOCS[kind].fr
}

// Le dashboard supporte fr/en/nl/de ; le contenu légal n'existe qu'en fr/en.
// Toute autre langue retombe sur le français (langue primaire du déploiement).
export function resolveLegalLang(language: string | undefined): LegalLang {
  return language?.toLowerCase().startsWith('en') ? 'en' : 'fr'
}
