// Contenu légal des pages web publiques (/legal/cgu, /legal/terms, /legal/privacy).
//
// ⚠️⚠️ CES TEXTES SONT DES BROUILLONS (v0). GYM-265 livre la MACHINERIE — variables,
// résolution de salle, routes, écran de saisie — comme livrable ferme. Les TEXTES sont
// une base de travail rédigée par un développeur, PAS un avis juridique : ils portent un
// bandeau « version provisoire » (cf. LEGAL_DRAFT) jusqu'à relecture par un juriste. La
// liste des points à faire trancher est dans la PR GYM-265.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// TROIS DOCUMENTS, ET POURQUOI TROIS
// ─────────────────────────────────────────────────────────────────────────────────────
//   /legal/cgu     CGU PLATEFORME   Nexxia ↔ LE GÉRANT. Contrat d'abonnement au logiciel.
//   /legal/terms   CGV DE LA SALLE  LA SALLE ↔ SON MEMBRE. Contrat de vente des séances.
//   /legal/privacy CONFIDENTIALITÉ  Traitement des données. URL PUBLIÉE SUR LES STORES.
//
// 🔴 LE DÉFAUT CORRIGÉ : /signup faisait accepter au futur GÉRANT les CGV… de la salle,
// c'est-à-dire un contrat de vente de séances de sport auquel il n'est pas partie et qui
// désignait « Dopamine Performance Club » comme vendeur. Un gérant de la salle X signait
// les conditions de vente de la salle Y. Les CGU (a) n'existaient tout simplement pas.
//
// ⚠️ /legal/privacy NE CHANGE PAS D'URL. C'est l'adresse déclarée à l'App Store et au Play
// Store : la déplacer casserait les fiches des deux stores. Son CONTENU est corrigé sur
// place, jamais remplacé par un brouillon vide.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// DEUX BLOCS DE VARIABLES
// ─────────────────────────────────────────────────────────────────────────────────────
//   ÉDITEUR → lib/legalEditor.ts    constantes, identiques pour toutes les salles.
//   SALLE   → lib/gymLegalIdentity  colonnes legal_* de nexxia_gyms, lues à l'affichage.
//
// Plus AUCUNE identité n'est écrite en dur dans un texte. La règle est simple et sans
// exception : si une valeur peut changer, elle vient d'un des deux blocs.
//
// ⚠️ CLUB_IDENTITY A DISPARU. C'était « Dopamine Performance Club / Neupré » en dur —
// faux dès la deuxième salle, et déjà faux pour la première (Ougrée depuis GYM-180). Les
// CGV sont désormais un GABARIT paramétré par la salle résolue depuis l'URL.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// DUPLICATION AVEC LE MOBILE : ASSUMÉE, ET NON TRAITÉE ICI
// ─────────────────────────────────────────────────────────────────────────────────────
// apps/mobile/constants/legal/*.ts porte ses propres copies (le monorepo n'a pas de
// package TS partagé entre Metro/Expo et Vite). GYM-265 NE TOUCHE PAS AU MOBILE — c'est
// un chantier à part. Conséquence à connaître : jusqu'à ce chantier, l'app mobile
// continue d'afficher les anciens textes, et son écran « CGU » contient en réalité les
// CGV. L'inventaire complet est dans la PR.
import { EDITEUR, PLATFORM_NAME, editorIdentityLine } from '@/lib/legalEditor'
import {
  composeAddress,
  orToComplete,
  sellerName,
  type GymLegalIdentity,
} from '@/lib/gymLegalIdentity'

export const LEGAL_VERSION = '1.0'
// PLACEHOLDER ISO à figer à la date de publication prod (miroir de constants/legal/meta.ts).
// TODO: figer à la date de publication prod avant déploiement.
export const LEGAL_UPDATED_AT = '2026-07-14'

export type LegalKind = 'cgu' | 'terms' | 'privacy'
export type LegalLang = 'fr' | 'en'

/**
 * Quel document est encore un BROUILLON ?
 *
 * Piloté document par document, pour que la validation juridique puisse être PARTIELLE :
 * le juriste rendra probablement la politique de confidentialité avant les deux contrats.
 * Passer un document en « validé » = un seul `false` à poser ici, rien d'autre.
 *
 * ⚠️ Ne pas confondre avec LEGAL_VERSION : la version identifie le TEXTE accepté par les
 * membres (elle est écrite dans profiles.terms_version au signup) ; ce drapeau ne parle
 * que de l'état de la relecture. Passer un document en validé SANS changer le texte ne
 * doit PAS incrémenter la version — sinon toutes les acceptations existantes deviennent
 * périmées sans raison.
 */
export const LEGAL_DRAFT: Record<LegalKind, boolean> = {
  cgu: true,
  terms: true,
  privacy: true,
}

const header = (title: string, lang: LegalLang) =>
  lang === 'en'
    ? `# ${title}\n\n**Last updated: ${LEGAL_UPDATED_AT}** · Version ${LEGAL_VERSION}\n`
    : `# ${title}\n\n**Dernière mise à jour : ${LEGAL_UPDATED_AT}** · Version ${LEGAL_VERSION}\n`

// ═════════════════════════════════════════════════════════════════════════════════════
// a) CGU PLATEFORME — Nexxia ↔ LE GÉRANT
// ═════════════════════════════════════════════════════════════════════════════════════
// C'est le document qui MANQUAIT. Il n'a aucun équivalent dans le dépôt : les CGV
// parlaient au membre, la politique de confidentialité parlait des données, personne ne
// disait au gérant à quoi il s'engage en ouvrant un compte Viniz.
//
// ⚠️ AUCUN MONTANT EN DUR, NI POUR LES PLANS NI POUR LES COMMISSIONS. Les grilles vivent
// en base (nexxia_plans, commission_*_override) et ont déjà changé une fois depuis le
// début du produit — un chiffre écrit ici serait périmé sans que personne ne le voie. Le
// texte renvoie donc à la grille affichée dans l'application, seule source exacte. C'est
// la même règle que celle appliquée aux clauses opérationnelles des CGV (GYM-197).

function cguDoc(lang: LegalLang): string {
  const editor = editorIdentityLine(lang)

  if (lang === 'en') {
    return `${header(`${PLATFORM_NAME} Terms of Use`, 'en')}
These Terms of Use ("Terms") govern the use of the **${PLATFORM_NAME}** platform by a gym operator ("the Operator"). They form the contract between the Operator and the publisher. They are **not** the terms of sale between a gym and its members — those are specific to each gym and available at ${PLATFORM_NAME.toLowerCase()}.app/legal/terms.

## 1. Publisher

${editor} — publisher of the **${PLATFORM_NAME}** platform ("the Publisher").

Contact for any question relating to these Terms: **${EDITEUR.email}**.

## 2. Purpose

The Publisher provides the Operator with a software service for managing a sports facility: class scheduling, member accounts, bookings and waiting lists, plans and credits, online payment collection, invoicing, and transactional communications with members.

The service is provided **as a software service (SaaS)**, accessible online. The Publisher provides no coaching, no supervision of physical activity, and sells nothing to the Operator's members.

## 3. Account and eligibility

3.1. Creating an account requires a professional email address and acceptance of these Terms. The Operator warrants that it is duly authorised to represent the gym it registers.

3.2. The Operator is responsible for the confidentiality of its credentials and for the actions of the team members it invites to its account.

3.3. The Operator is solely responsible for the accuracy of the legal identity it enters (company name, company number, registered office). This information is reproduced in its invoices and in its own terms of sale.

## 4. Plans, prices and trial period

4.1. The service is offered under several plans, whose scope and prices **are those displayed in the application** at the time of subscription. No amount is stated in this document: the grid in force is the only accurate source.

4.2. A trial period may be offered. At its end, and unless a paid plan is taken out, access is restricted to the functions of the free plan.

4.3. The Publisher may change the plan grid. Any change is notified to the Operator at least **30 days** before it takes effect and never applies retroactively to a period already paid for.

## 5. Payment collection and commissions

5.1. Payments made by members are collected through **Mollie B.V.**, under an account belonging to the Operator. The Publisher never holds the members' funds.

5.2. In addition to the fees charged by the payment provider, the Publisher may apply a **commission** on the transactions processed. The applicable rates **are those displayed in the application**, per payment method.

5.3. Any commission change is notified under the conditions of art. 4.3.

## 6. Obligations of the Operator

6.1. The Operator uses the service in compliance with applicable law, in particular consumer law, tax law and personal data law.

6.2. The Operator is **the seller** of the services sold to its members. It draws up, publishes and honours its own terms of sale, sets its prices, and handles member complaints, refunds and disputes.

6.3. The Operator refrains from any use that would compromise the security or availability of the service, and from any attempt to circumvent access controls.

## 7. Availability and support

7.1. The Publisher undertakes to make its best efforts to keep the service available, without guaranteeing uninterrupted availability. Maintenance operations may cause temporary interruptions.

7.2. Support is provided by email at **${EDITEUR.email}**. No response time is contractually guaranteed at this stage.

## 8. Liability

8.1. The Publisher is liable for the technical operation of the platform. It is **not** liable for the sporting activity, the safety of premises, member supervision, or the commercial relationship between the Operator and its members.

8.2. The Publisher's liability is limited to direct damage and may not exceed the amounts paid by the Operator for the service over the twelve months preceding the event giving rise to liability.

8.3. Nothing in these Terms excludes liability that cannot be excluded under Belgian law, in particular in the event of fraud or wilful misconduct.

## 9. Personal data

9.1. For the data of **its members**, the Operator is the **data controller**: it decides the purposes and means. The Publisher acts as a **processor** on its behalf and on its instructions.

9.2. For the data of the **Operator itself** (account, billing, technical logs), the Publisher is the controller.

9.3. The processing carried out, the sub-processors used and the retention periods are described in the Privacy Policy, which forms an integral part of these Terms.

9.4. The Publisher does not use member data for its own purposes, does not sell it and does not use it for advertising.

## 10. Intellectual property

The platform, its source code, its interfaces and its trademarks remain the exclusive property of the Publisher. These Terms grant a right of use for the duration of the contract, non-exclusive and non-transferable. The data entered by the Operator and its members remains the property of the Operator.

## 11. Term and termination

11.1. The contract is entered into for an indefinite term and may be terminated by the Operator at any time from the application. Termination takes effect at the end of the period already paid for; no pro-rata refund is made.

11.2. The Publisher may terminate the contract with **30 days'** notice, or immediately in the event of a serious breach of art. 6 or of non-payment.

11.3. Upon termination, the Operator may export its data. The Publisher retains the data for a reasonable period to allow this export, then deletes or anonymises it, subject to legal retention obligations.

## 12. Changes to these Terms

Any substantial change is notified to the Operator in the application at least **30 days** before it takes effect. Continued use of the service after that date constitutes acceptance.

## 13. Governing law and disputes

These Terms are governed by **Belgian law**. The parties shall seek an amicable settlement. Failing that, the courts of the judicial district of **Liège** shall have jurisdiction, without prejudice to mandatory rules of jurisdiction.

## 14. Contact

**Publisher**: ${EDITEUR.nomCommercial} (${EDITEUR.exploitant}) — ${EDITEUR.adresse}, Belgium — company number ${EDITEUR.bce} — ${EDITEUR.email}
`
  }

  return `${header(`Conditions générales d'utilisation ${PLATFORM_NAME}`, 'fr')}
Les présentes conditions générales d'utilisation (« CGU ») régissent l'utilisation de la plateforme **${PLATFORM_NAME}** par un exploitant de salle de sport (« le Gérant »). Elles forment le contrat entre le Gérant et l'Éditeur. Elles ne sont **pas** les conditions de vente entre une salle et ses membres : celles-ci sont propres à chaque salle et consultables sur ${PLATFORM_NAME.toLowerCase()}.app/legal/terms.

## 1. Éditeur

${editor} — éditeur de la plateforme **${PLATFORM_NAME}** (« l'Éditeur »).

Contact pour toute question relative aux présentes CGU : **${EDITEUR.email}**.

## 2. Objet du service

L'Éditeur met à la disposition du Gérant un service logiciel de gestion de salle de sport : planification des cours, comptes membres, réservations et listes d'attente, formules et crédits, encaissement des paiements en ligne, facturation, et communications transactionnelles avec les membres.

Le service est fourni **en tant que service logiciel (SaaS)**, accessible en ligne. L'Éditeur ne fournit aucun encadrement sportif, aucune surveillance d'activité physique, et ne vend rien aux membres du Gérant.

## 3. Compte et éligibilité

3.1. La création d'un compte suppose une adresse email professionnelle et l'acceptation des présentes CGU. Le Gérant garantit être dûment habilité à représenter la salle qu'il enregistre.

3.2. Le Gérant est responsable de la confidentialité de ses identifiants et des agissements des membres d'équipe qu'il invite sur son compte.

3.3. Le Gérant est seul responsable de l'exactitude de l'identité légale qu'il renseigne (raison sociale, numéro d'entreprise, siège social). Ces informations sont reproduites sur ses factures et dans ses propres conditions de vente.

## 4. Formules, prix et période d'essai

4.1. Le service est proposé selon plusieurs formules, dont le périmètre et les prix **sont ceux affichés dans l'application** au moment de la souscription. Aucun montant n'est énoncé dans le présent document : la grille en vigueur est la seule source exacte.

4.2. Une période d'essai peut être offerte. À son terme, et à défaut de souscription à une formule payante, l'accès est restreint aux fonctions de la formule gratuite.

4.3. L'Éditeur peut faire évoluer la grille des formules. Toute modification est portée à la connaissance du Gérant au moins **30 jours** avant son entrée en vigueur et ne s'applique jamais rétroactivement à une période déjà payée.

## 5. Encaissement et commissions

5.1. Les paiements effectués par les membres sont encaissés via **Mollie B.V.**, sur un compte appartenant au Gérant. L'Éditeur ne détient jamais les fonds des membres.

5.2. En sus des frais prélevés par le prestataire de paiement, l'Éditeur peut appliquer une **commission** sur les transactions traitées. Les taux applicables **sont ceux affichés dans l'application**, par moyen de paiement.

5.3. Toute évolution des commissions est notifiée dans les conditions de l'art. 4.3.

## 6. Obligations du Gérant

6.1. Le Gérant utilise le service dans le respect de la législation applicable, notamment en droit de la consommation, en droit fiscal et en matière de données personnelles.

6.2. Le Gérant est **le vendeur** des prestations vendues à ses membres. Il rédige, publie et honore ses propres conditions générales de vente, fixe ses prix, et assume les réclamations, remboursements et litiges de ses membres.

6.3. Le Gérant s'abstient de tout usage susceptible de compromettre la sécurité ou la disponibilité du service, et de toute tentative de contournement des contrôles d'accès.

## 7. Disponibilité et support

7.1. L'Éditeur s'engage à mettre en œuvre ses meilleurs efforts pour maintenir le service disponible, sans garantir une disponibilité ininterrompue. Des opérations de maintenance peuvent entraîner des interruptions temporaires.

7.2. Le support est assuré par email à **${EDITEUR.email}**. Aucun délai de réponse n'est garanti contractuellement à ce stade.

## 8. Responsabilité

8.1. L'Éditeur répond du fonctionnement technique de la plateforme. Il n'est **pas** responsable de l'activité sportive, de la sécurité des locaux, de l'encadrement des membres, ni de la relation commerciale entre le Gérant et ses membres.

8.2. La responsabilité de l'Éditeur est limitée aux dommages directs et ne peut excéder les sommes versées par le Gérant au titre du service sur les douze mois précédant le fait générateur.

8.3. Aucune stipulation des présentes n'exclut la responsabilité qui ne peut l'être en droit belge, notamment en cas de dol ou de faute intentionnelle.

## 9. Données personnelles

9.1. Pour les données de **ses membres**, le Gérant est **responsable du traitement** : c'est lui qui en détermine les finalités et les moyens. L'Éditeur agit en **sous-traitant** pour son compte et sur ses instructions.

9.2. Pour les données du **Gérant lui-même** (compte, facturation, journaux techniques), l'Éditeur est responsable du traitement.

9.3. Les traitements réalisés, les sous-traitants employés et les durées de conservation sont décrits dans la Politique de confidentialité, qui fait partie intégrante des présentes.

9.4. L'Éditeur n'exploite les données des membres à aucune fin propre, ne les vend pas et ne les utilise pas à des fins publicitaires.

## 10. Propriété intellectuelle

La plateforme, son code source, ses interfaces et ses marques demeurent la propriété exclusive de l'Éditeur. Les présentes CGU confèrent un droit d'usage pour la durée du contrat, non exclusif et non cessible. Les données saisies par le Gérant et ses membres restent la propriété du Gérant.

## 11. Durée et résiliation

11.1. Le contrat est conclu pour une durée indéterminée et peut être résilié par le Gérant à tout moment depuis l'application. La résiliation prend effet au terme de la période déjà payée ; aucun remboursement au prorata n'est effectué.

11.2. L'Éditeur peut résilier moyennant un préavis de **30 jours**, ou sans préavis en cas de manquement grave à l'art. 6 ou de défaut de paiement.

11.3. À la résiliation, le Gérant peut exporter ses données. L'Éditeur les conserve pendant un délai raisonnable permettant cet export, puis les supprime ou les anonymise, sous réserve des obligations légales de conservation.

## 12. Modification des CGU

Toute modification substantielle est portée à la connaissance du Gérant dans l'application au moins **30 jours** avant son entrée en vigueur. La poursuite de l'utilisation du service au-delà de cette date vaut acceptation.

## 13. Droit applicable et litiges

Les présentes CGU sont régies par le **droit belge**. Les parties rechercheront une solution amiable. À défaut, les tribunaux de l'arrondissement judiciaire de **Liège** sont compétents, sans préjudice des règles impératives de compétence.

## 14. Contact

**Éditeur** : ${EDITEUR.nomCommercial} (${EDITEUR.exploitant}) — ${EDITEUR.adresse}, Belgique — BCE ${EDITEUR.bce} — ${EDITEUR.email}
`
}

// ═════════════════════════════════════════════════════════════════════════════════════
// c) POLITIQUE DE CONFIDENTIALITÉ — URL DES STORES, CONTENU CORRIGÉ SUR PLACE
// ═════════════════════════════════════════════════════════════════════════════════════
// Le fond de ce texte était déjà juste : il désignait correctement la salle comme
// responsable du traitement et Nexxia comme sous-traitant. GYM-265 y apporte deux
// changements et pas un de plus :
//   1. l'identité de l'éditeur n'est plus recopiée à la main — elle vient d'EDITEUR ;
//   2. une section 2 dédiée « votre salle et vos données », parce que la distinction
//      responsable/sous-traitant était énoncée en deux puces au milieu d'un article et
//      qu'elle est LA question que se pose un membre : à qui je m'adresse ?
// Les articles suivants sont décalés d'un rang, à contenu inchangé.

function privacyDoc(lang: LegalLang): string {
  const editor = editorIdentityLine(lang)

  if (lang === 'en') {
    return `${header('Privacy Policy', 'en')}
## 1. Who is responsible for your data?

The application is provided to your gym by ${editor} — publisher of the **${PLATFORM_NAME}** platform.

- **Your gym** is the **data controller** for your member data: it decides why your data is collected (managing your bookings, payments and membership).
- **${EDITEUR.nomCommercial}** acts as a **data processor**: it hosts and processes this data on behalf of your gym, on its instructions, and is the controller for data strictly related to the platform's technical operation.

For any question about your data: **${EDITEUR.email}** or directly with your gym.

## 2. Your gym and your data

The gym you are a member of is an **independent business**. It is not a branch of the publisher, and the publisher does not decide what it does with your data.

- **Who to contact first**: your gym, for anything concerning your membership, your bookings, your payments or the correction of your data. Its full identity and contact details appear in the application and in its terms of sale.
- **Who to contact for the platform**: ${EDITEUR.email}, for anything concerning the technical operation of the application, a security incident, or if your gym does not respond.
- **What your gym cannot see**: the data of members of another gym. Isolation is enforced at the database level, not merely in the interface.
- **What ${EDITEUR.nomCommercial} does not do**: use your data for its own purposes, sell it, or use it for advertising.

Your rights (art. 9) can be exercised with either party: we forward requests to whoever is competent.

## 3. What data do we collect?

**Account data** (provided by you at sign-up or in your profile): last name, first name, email address, password (stored in irreversibly hashed form), phone number, date of birth, gender, postal address, profile picture, preferred language, emergency contact (name and phone).

**Usage data** (generated by your activity): class bookings (including waitlists and cancellations), credits and subscriptions, attendance history and unreported absences, notifications sent and notification preferences.

**Payment data**: amount, plan purchased, date, status and transaction reference. **Your banking details (card, IBAN) never pass through our systems**: they are handled exclusively by our payment provider Mollie (see art. 7).

**Health data (optional)**: if you or your gym record medical information (conditions, activity restrictions, medical certificate), it is **encrypted** in our databases and accessible only to your gym's authorised staff. See art. 5.

**Technical data**: your device's push notification identifier, last-connection timestamp. The application collects **no geolocation data** and includes **no advertising trackers**.

## 4. Why and on what legal basis?

- **Account management, bookings, waitlists, subscriptions and credits** — Performance of the contract.
- **Payment processing and invoicing** — Performance of the contract + legal obligation (accounting).
- **Service-related notifications (spot freed up, class reminders, confirmations)** — Performance of the contract.
- **Enforcement of gym rules (no-show, penalties, suspension)** — Legitimate interest of the gym.
- **Marketing communications** — Consent (dedicated opt-in, withdrawable at any time).
- **Health data** — Explicit consent (GDPR art. 9.2.a).
- **Platform security (technical logs)** — Legitimate interest of the publisher.

## 5. Health data — enhanced protection

Medical information is a **special category of data** (GDPR art. 9). Our safeguards: it is **optional**, **encrypted** in the database (notes and conditions are never stored in clear text), accessible only to your gym's authorised staff, never used for any purpose other than your safety during classes, and **permanently erased** when your account is deleted (it is not kept in anonymised form). If your gym requires a medical certificate for certain activities, it is kept with its expiry date and subject to the same protections.

## 6. How long do we keep your data?

- **Active account**: for as long as your account exists.
- **Account deletion** (available in the app, Profile → Delete my account): your personal data is **anonymised immediately** (name, email, phone, address, photo replaced), your health data **erased**, and your login permanently disabled. Your email address becomes usable again for a new account.
- **Accounting data** (payments, invoices): kept for **7 years** in a form dissociated from your identity, in accordance with Belgian accounting and tax obligations.
- **Booking history**: kept in anonymised form for statistical purposes for the gym (occupancy rates), with no link to your identity.

## 7. Who has access to your data?

**Your gym**: the manager and authorised staff access the data of members of their gym only (strict per-gym isolation at the database level).

**Our technical sub-processors**, each limited to its function:

- **Supabase** — Database and infrastructure hosting · European Union (Paris, France).
- **Mollie B.V.** — Payment processing (Netherlands, DNB-licensed) · EU.
- **Resend** — Sending of transactional emails · European Union (Ireland).
- **Expo / Apple** — Delivery of push notifications · EU/United States (standard contractual clauses).

We do **not sell or rent** your data to anyone. No data is shared with third parties for advertising purposes.

## 8. Transfers outside the European Union

Your data is hosted and processed in the European Union (database in Paris, emails in Ireland). Only the delivery of push notifications transits through the infrastructures of Expo and Apple, which may process technical identifiers in the United States; these transfers are governed by the mechanisms provided in Chapter V of the GDPR (standard contractual clauses, EU-US Data Privacy Framework where applicable).

## 9. Your rights

In accordance with the GDPR, you have the following rights:

- **Access and portability**: request a copy of your data from the app (Profile → Export my data) or by email.
- **Rectification**: edit your information directly in your profile.
- **Erasure**: delete your account directly in the app (see art. 6). Restriction: if a subscription with a commitment is ongoing, deletion is possible at its end.
- **Withdrawal of consent**: disable marketing communications in your preferences at any time.
- **Objection and restriction**: contact us at ${EDITEUR.email}.
- **Complaint**: you may lodge a complaint with the **Data Protection Authority** (APD/GBA), rue de la Presse 35, 1000 Brussels — www.autoriteprotectiondonnees.be.

We respond to any request within a maximum of one month.

## 10. Security

Measures in place: encryption of communications (HTTPS/TLS), specific encryption of health data, per-gym data isolation at the database level (database access rules), secrets and payment tokens stored in an encrypted vault, passwords subject to a strength policy, access logging. As no system is infallible, we undertake to notify the DPA and the persons concerned in the event of a data breach under the conditions set out in Articles 33-34 of the GDPR.

## 11. Minors

The application is intended for persons **aged 16 or over**. Registration of a minor under 16 requires the consent of their legal guardian and acceptance by the gym, subject to the gym's own conditions. If we find that an account has been created in breach of this rule, it will be deleted.

## 12. Changes to this policy

Any substantial change will be notified to you in the application before it takes effect, with the update date at the top of this document. The version in force can be consulted at any time at **${PLATFORM_NAME.toLowerCase()}.app/legal/privacy** and in the app.

## 13. Contact

**Publisher / processor**: ${EDITEUR.nomCommercial} (${EDITEUR.exploitant}) — ${EDITEUR.adresse}, Belgium — company number ${EDITEUR.bce} — ${EDITEUR.email}

**Data controller (your gym)**: see your gym's information in the application.
`
  }

  return `${header('Politique de confidentialité', 'fr')}
## 1. Qui est responsable de vos données ?

L'application est fournie à votre salle de sport par ${editor} — éditeur de la plateforme **${PLATFORM_NAME}**.

- **Votre salle de sport** est **responsable du traitement** de vos données de membre : c'est elle qui décide pourquoi vos données sont collectées (gérer vos réservations, vos paiements, votre abonnement).
- **${EDITEUR.nomCommercial}** agit comme **sous-traitant** : elle héberge et traite ces données pour le compte de votre salle, selon ses instructions, et est responsable du traitement pour les données strictement techniques de la plateforme.

Pour toute question relative à vos données : **${EDITEUR.email}** ou directement auprès de votre salle.

## 2. Votre salle et vos données

La salle dont vous êtes membre est une **entreprise indépendante**. Elle n'est pas une filiale de l'éditeur, et l'éditeur ne décide pas de ce qu'elle fait de vos données.

- **À qui s'adresser en premier** : à votre salle, pour tout ce qui concerne votre adhésion, vos réservations, vos paiements ou la correction de vos données. Son identité complète et ses coordonnées figurent dans l'application et dans ses conditions de vente.
- **À qui s'adresser pour la plateforme** : ${EDITEUR.email}, pour tout ce qui concerne le fonctionnement technique de l'application, un incident de sécurité, ou si votre salle ne répond pas.
- **Ce que votre salle ne peut pas voir** : les données des membres d'une autre salle. Le cloisonnement est appliqué au niveau de la base de données, pas seulement dans l'interface.
- **Ce que ${EDITEUR.nomCommercial} ne fait pas** : exploiter vos données à ses propres fins, les vendre, ou les utiliser à des fins publicitaires.

Vos droits (art. 9) s'exercent auprès de l'une ou l'autre : nous transmettons les demandes à qui est compétent.

## 3. Quelles données collectons-nous ?

**Données de compte** (fournies par vous à l'inscription ou dans votre profil) : nom, prénom, adresse email, mot de passe (stocké sous forme chiffrée irréversible), numéro de téléphone, date de naissance, genre, adresse postale, photo de profil, langue préférée, contact d'urgence (nom et téléphone).

**Données d'utilisation** (générées par votre activité) : réservations de cours (y compris listes d'attente et annulations), crédits et abonnements, historique de présence et absences non signalées, notifications envoyées et préférences de notification.

**Données de paiement** : montant, formule achetée, date, statut et référence de transaction. **Vos données bancaires (carte, IBAN) ne transitent jamais par nos systèmes** : elles sont traitées exclusivement par notre prestataire de paiement Mollie (voir art. 7).

**Données de santé (facultatives)** : si vous ou votre salle renseignez des informations médicales (conditions, restrictions d'activité, certificat médical), celles-ci sont **chiffrées** dans nos bases et accessibles uniquement au personnel autorisé de votre salle. Voir art. 5.

**Données techniques** : identifiant de notification push de votre appareil, horodatage de dernière connexion. L'application ne collecte **aucune donnée de géolocalisation** et n'intègre **aucun traceur publicitaire**.

## 4. Pourquoi et sur quelle base légale ?

- **Gestion du compte, réservations, listes d'attente, abonnements et crédits** — Exécution du contrat.
- **Traitement des paiements et facturation** — Exécution du contrat + obligation légale (comptabilité).
- **Notifications liées au service (place libérée, rappels de cours, confirmations)** — Exécution du contrat.
- **Application des règles de la salle (no-show, pénalités, suspension)** — Intérêt légitime de la salle.
- **Communications marketing** — Consentement (case dédiée, retirable à tout moment).
- **Données de santé** — Consentement explicite (RGPD art. 9.2.a).
- **Sécurité de la plateforme (journaux techniques)** — Intérêt légitime de l'éditeur.

## 5. Données de santé — protection renforcée

Les informations médicales sont une **catégorie particulière de données** (RGPD art. 9). Notre dispositif : elles sont **facultatives**, **chiffrées** dans la base de données (les notes et conditions ne sont jamais stockées en clair), accessibles uniquement au personnel habilité de votre salle, jamais utilisées à d'autres fins que votre sécurité pendant les cours, et **définitivement effacées** lors de la suppression de votre compte (elles ne sont pas conservées sous forme anonymisée). Si votre salle requiert un certificat médical pour certaines activités, celui-ci est conservé avec sa date d'expiration et soumis aux mêmes protections.

## 6. Combien de temps conservons-nous vos données ?

- **Compte actif** : tant que votre compte existe.
- **Suppression de compte** (disponible dans l'app, Profil → Supprimer mon compte) : vos données personnelles sont **anonymisées immédiatement** (nom, email, téléphone, adresse, photo remplacés), vos données de santé **effacées**, et votre connexion définitivement désactivée. Votre adresse email redevient utilisable pour un nouveau compte.
- **Données comptables** (paiements, factures) : conservées **7 ans** sous forme dissociée de votre identité, conformément aux obligations comptables et fiscales belges.
- **Historique de réservations** : conservé sous forme anonymisée à des fins statistiques pour la salle (taux de remplissage), sans lien avec votre identité.

## 7. Qui a accès à vos données ?

**Votre salle de sport** : le gérant et le personnel autorisé accèdent aux données des membres de leur salle uniquement (cloisonnement strict par salle au niveau de la base de données).

**Nos sous-traitants techniques**, chacun limité à sa fonction :

- **Supabase** — Hébergement de la base de données et de l'infrastructure · Union européenne (Paris, France).
- **Mollie B.V.** — Traitement des paiements (Pays-Bas, agréé DNB) · UE.
- **Resend** — Envoi des emails transactionnels · Union européenne (Irlande).
- **Expo / Apple** — Acheminement des notifications push · UE/États-Unis (clauses contractuelles types).

Nous ne **vendons ni ne louons** vos données à personne. Aucune donnée n'est transmise à des tiers à des fins publicitaires.

## 8. Transferts hors Union européenne

Vos données sont hébergées et traitées dans l'Union européenne (base de données à Paris, emails en Irlande). Seul l'acheminement des notifications push transite par les infrastructures d'Expo et d'Apple, susceptibles de traiter des identifiants techniques aux États-Unis ; ces transferts sont encadrés par les mécanismes prévus au chapitre V du RGPD (clauses contractuelles types, EU-US Data Privacy Framework le cas échéant).

## 9. Vos droits

Conformément au RGPD, vous disposez des droits suivants :

- **Accès et portabilité** : demandez une copie de vos données depuis l'app (Profil → Exporter mes données) ou par email.
- **Rectification** : modifiez vos informations directement dans votre profil.
- **Effacement** : supprimez votre compte directement dans l'app (voir art. 6). Restriction : si un abonnement avec engagement est en cours, la suppression est possible au terme de celui-ci.
- **Retrait du consentement** : désactivez les communications marketing dans vos préférences à tout moment.
- **Opposition et limitation** : contactez-nous à ${EDITEUR.email}.
- **Réclamation** : vous pouvez saisir l'**Autorité de protection des données** (APD/GBA), rue de la Presse 35, 1000 Bruxelles — www.autoriteprotectiondonnees.be.

Nous répondons à toute demande dans un délai maximum d'un mois.

## 10. Sécurité

Mesures en place : chiffrement des communications (HTTPS/TLS), chiffrement spécifique des données de santé, cloisonnement des données par salle au niveau de la base (règles d'accès en base de données), secrets et jetons de paiement stockés dans un coffre-fort chiffré, mots de passe soumis à une politique de robustesse, journalisation des accès. Aucun système n'étant infaillible, nous nous engageons à notifier l'APD et les personnes concernées en cas de violation de données dans les conditions prévues aux articles 33-34 du RGPD.

## 11. Mineurs

L'application est destinée aux personnes de **16 ans ou plus**. L'inscription d'un mineur de moins de 16 ans requiert l'accord de son responsable légal et l'acceptation par la salle, selon les conditions propres de celle-ci. Si nous constatons qu'un compte a été créé en violation de cette règle, il sera supprimé.

## 12. Modifications de cette politique

Toute modification substantielle vous sera notifiée dans l'application avant son entrée en vigueur, avec la date de mise à jour en tête de ce document. La version en vigueur est consultable à tout moment sur **${PLATFORM_NAME.toLowerCase()}.app/legal/privacy** et dans l'app.

## 13. Contact

**Éditeur / sous-traitant** : ${EDITEUR.nomCommercial} (${EDITEUR.exploitant}) — ${EDITEUR.adresse}, Belgique — BCE ${EDITEUR.bce} — ${EDITEUR.email}

**Responsable du traitement (votre salle)** : voir les informations de votre salle dans l'application.
`
}

// ═════════════════════════════════════════════════════════════════════════════════════
// b) CGV DE LA SALLE — GABARIT, PARAMÉTRÉ PAR LA SALLE RÉSOLUE DANS L'URL
// ═════════════════════════════════════════════════════════════════════════════════════
// PRINCIPE REPRIS DE GYM-197 : la salle fournit des PARAMÈTRES, Viniz fournit le CADRE
// JURIDIQUE. Le gérant ne rédige jamais de prose contractuelle — il renseigne son identité
// légale dans /settings, et le gabarit s'en sert. Les clauses juridiques (responsabilité,
// rétractation, droit applicable, litiges, âge minimum) restent FIXES : elles ne dépendent
// pas de la salle.
//
// ⚠️ LES CLAUSES OPÉRATIONNELLES N'ÉNONCENT AUCUN CHIFFRE, et c'est délibéré (GYM-197) :
// limite de réservations, délai de confirmation, barème d'absences et remise à zéro sont
// configurables par salle. Un chiffre écrit ici serait faux pour la salle suivante. Ils
// renvoient donc à la valeur affichée dans l'application, où elle est exacte.
//
// ⚠️ « le Club » A ÉTÉ REMPLACÉ PAR « la Salle » dans tout le document. « Club » était le
// vocabulaire de Dopamine ; il n'a aucune raison d'être imposé aux salles suivantes.

/** CGV génériques : aucune salle n'a pu être résolue depuis l'URL. */
function termsGeneric(lang: LegalLang): string {
  if (lang === 'en') {
    return `${header('Terms and Conditions of Sale', 'en')}
## These terms belong to your gym, not to ${PLATFORM_NAME}

Each gym using ${PLATFORM_NAME} is an **independent business**. It sets its own prices, its own plans and its own rules, and it is **the seller** of the services you purchase. There is therefore no single set of terms of sale: **there is one per gym**.

## How to find yours

- **In the application**: Profile → Terms and Conditions. The version shown there is always the one of the gym you are a member of.
- **From the link sent by your gym**: the emails and links from your gym carry its identifier and open its terms directly.
- **By asking your gym**: its contact details appear on its page in the application.

## What is common to all gyms

Two documents are published by the platform's publisher and apply regardless of your gym:

- The **Privacy Policy** — /legal/privacy
- The **Terms of Use** of the ${PLATFORM_NAME} platform, which bind the publisher and the gym operator — /legal/cgu

## Publisher

${editorIdentityLine('en')} — ${EDITEUR.email}
`
  }

  return `${header('Conditions générales de vente', 'fr')}
## Ces conditions sont celles de votre salle, pas celles de ${PLATFORM_NAME}

Chaque salle qui utilise ${PLATFORM_NAME} est une **entreprise indépendante**. Elle fixe ses prix, ses formules et ses règles, et c'est elle **le vendeur** des prestations que vous achetez. Il n'existe donc pas des conditions générales de vente uniques : **il y en a une par salle**.

## Comment trouver les vôtres

- **Dans l'application** : Profil → Conditions générales. La version qui s'y affiche est toujours celle de la salle dont vous êtes membre.
- **Depuis le lien envoyé par votre salle** : les emails et les liens de votre salle portent son identifiant et ouvrent directement ses conditions.
- **En demandant à votre salle** : ses coordonnées figurent sur sa page dans l'application.

## Ce qui est commun à toutes les salles

Deux documents sont publiés par l'éditeur de la plateforme et s'appliquent quelle que soit votre salle :

- La **Politique de confidentialité** — /legal/privacy
- Les **Conditions générales d'utilisation** de la plateforme ${PLATFORM_NAME}, qui lient l'éditeur et l'exploitant de la salle — /legal/cgu

## Éditeur

${editorIdentityLine('fr')} — ${EDITEUR.email}
`
}

function termsDoc(lang: LegalLang, gym: GymLegalIdentity | null): string {
  if (!gym) return termsGeneric(lang)

  // ── LE BLOC VENDEUR — le seul endroit où l'identité de la salle est composée ────────
  const seller = sellerName(gym, lang)
  const legalName = orToComplete(gym.legalName, lang)
  const legalForm = gym.legalForm ? `${gym.legalForm} ` : ''
  const vat = orToComplete(gym.vatNumber, lang)
  const office = composeAddress(gym.legalAddress, gym.legalPostalCode, gym.legalCity, lang)
  const venue = composeAddress(gym.address, gym.postalCode, gym.city, lang)
  const contact = orToComplete(gym.email, lang)
  const phone = gym.phone ? ` · ${gym.phone}` : ''
  const editor = editorIdentityLine(lang)

  if (lang === 'en') {
    return `${header(`Terms and Conditions of Sale — ${seller}`, 'en')}
### 1. Identification and purpose

These terms govern the use of the application and the purchase of services from **${legalForm}${legalName}**, trading as **${seller}**, company number **${vat}**, registered office **${office}** ("the Gym"), the seller of the services. Place of business: ${venue}. Contact: ${contact}${phone}.

The application is published by ${editor} ("the Publisher"), technical provider and processor for the Gym. The Publisher sells nothing to members. Payments are processed by **Mollie B.V.** on behalf of the Gym.

### 2. Member account

2.1. An account is required in order to book. The member warrants the accuracy of their information and the confidentiality of their credentials.

2.2. Registration is open to persons **aged 16 and over**. Minors under 16 may register only with the consent of their legal representative and the agreement of the Gym, subject to the Gym's own conditions.

2.3. The account may be deleted at any time in the application (Profile): personal data is anonymised, transactional data is kept in accordance with accounting obligations (see the Privacy Policy). Deletion is possible at the end of any ongoing subscription (art. 10).

### 3. Plans and prices

3.1. Two types of plan, at the prices in euros including tax displayed in the application: **single purchases** (drop-in, packs — crediting sessions) and **subscriptions** (unlimited access for the chosen period, monthly SEPA direct debits).

3.2. **Purchased sessions have no expiry date.** Any future change to this rule will never apply to sessions already purchased.

3.3. Credits and packs may be freely accumulated. Only one active subscription at a time. While a subscription is active, single purchases are unavailable (access is already unlimited); credits held are retained and become usable again when the subscription ends.

3.4. The applicable prices are those displayed at the time of purchase. The conditions of an ongoing subscription are never changed.

### 4. Payment

4.1. Payments are processed via Mollie. Single purchases: immediate payment by the means offered on the payment screen (in particular Bancontact and card). Subscriptions: the first payment establishes a SEPA direct debit mandate; subsequent monthly instalments are collected automatically.

4.2. If a monthly direct debit fails and is not regularised after the member has been informed, the Gym may suspend access to bookings until it is regularised, without prejudice to the sums due.

### 5. Right of withdrawal

5.1. In accordance with Articles VI.47 et seq. of the Belgian Code of Economic Law, a consumer member has **14 days** from the distance purchase to withdraw without giving reasons.

5.2. By purchasing, the member expressly requests that performance begin before the end of that period. In the event of withdrawal within the period: sessions already used are deducted pro rata from the price paid; for a subscription that has started, the refund is reduced by the value of the period elapsed. The right of withdrawal is lost if the service has been fully performed before the end of the period (art. VI.53, 1° CEL).

5.3. The right is exercised by email to the Gym's contact address (${contact}), or via ${EDITEUR.email}, which will forward it to the Gym, where applicable using the statutory withdrawal form.

### 6. Bookings

6.1. Booking — including joining a waiting list — requires an active subscription or at least one available session.

6.2. The maximum number of **confirmed upcoming bookings** at any one time is set by the Gym and displayed in the application.

6.3. A session is deducted only when the place is **confirmed** (never on a waiting list; never under a subscription).

6.4. Each class has a maximum capacity; if a class is full, registration on the waiting list is possible.

### 7. Waiting list

7.1. The order of the list is the order of registration.

7.2. When a place becomes available, the first person on the list is notified (notification and email) and has a **confirmation period set by the Gym** — displayed in the application — to confirm their place (the session is deducted on confirmation, except under a subscription).

7.3. Failing confirmation within the period, the waiting-list registration expires and the place is offered to the next person. The member may register on the waiting list again.

### 8. Cancellation by the member

8.1. **Free of charge up to 2 hours before** the start of the class: the session is immediately re-credited (nothing to re-credit under a subscription).

8.2. **Less than 2 hours before**: the cancellation is treated as an unexcused absence (art. 9) — no re-credit, scale 9.2 applies.

8.3. Withdrawing from a waiting list is free and without consequence.

### 9. Unexcused absences ("no-show")

9.1. A confirmed member who does not attend without having cancelled is in unexcused absence.

9.2. An automatic cumulative scale applies: the first absences give rise to a warning, subsequent ones to a temporary suspension of bookings, of increasing duration in the event of repetition. The exact thresholds and durations are set by the Gym and displayed in the application.

9.3. The session is not re-credited. The absence counter is cumulative; it is automatically reset after a period without a new absence, the duration of which is set by the Gym and displayed in the application.

### 10. Subscriptions — term, expiry, termination

10.1. The subscription is entered into for the chosen period, paid by SEPA monthly instalments. It ends automatically at its term, **without tacit renewal**: no debit occurs beyond the end date.

10.2. The subscription constitutes a **firm commitment for the chosen period**: it cannot be terminated early and the monthly instalments remain due until the term, without prejudice to the right of withdrawal (art. 5) and to the cases of legitimate grounds provided for by law. The application displays the commitment end date.

10.3. During the subscription, single sessions held are retained but unused (art. 3.3).

### 11. Refunds

11.1. Re-crediting of sessions operates in accordance with articles 7 and 8.

11.2. If a class is cancelled by the Gym, the deducted session is automatically re-credited. Any other monetary refund, outside the right of withdrawal, is at the Gym's discretion, without prejudice to the consumer's statutory rights.

### 12. Conduct, safety and health

12.1. The member complies with the Gym's internal rules, displayed on its premises and/or in the application.

12.2. Intensive physical activity requires suitable physical condition: the member declares that they have no known medical contraindication. If the Gym requires a medical certificate for certain activities, it must be provided before participation. Information on the Gym's insurance is available from the Gym on request.

### 13. Personal data

Data processing is described in the Privacy Policy, accessible in the application (Profile → Privacy) and at ${PLATFORM_NAME.toLowerCase()}.app/legal/privacy. Data controller: the Gym. Main processor: ${EDITEUR.nomCommercial} (${PLATFORM_NAME} platform); other sub-processors: Supabase, Mollie, Resend, Expo/Apple.

### 14. Changes

Any change to these terms is brought to members' attention via the application at least **30 days** before it takes effect. It never applies retroactively to purchases already made.

### 15. Governing law and disputes

These terms are governed by Belgian law. In the event of a dispute, the member may refer the matter to the Consumer Mediation Service (mediationconsommateur.be) or to the European online dispute resolution platform (ec.europa.eu/odr). Failing amicable settlement, the courts of the judicial district in which the Gym has its registered office shall have jurisdiction, without prejudice to mandatory rules of jurisdiction.
`
  }

  return `${header(`Conditions générales de vente — ${seller}`, 'fr')}
### 1. Identification et objet

Les présentes conditions régissent l'utilisation de l'application et l'achat de prestations auprès de **${legalForm}${legalName}**, exploitant sous l'enseigne **${seller}**, numéro d'entreprise **${vat}**, siège social **${office}** (« la Salle »), vendeur des prestations. Lieu d'exploitation : ${venue}. Contact : ${contact}${phone}.

L'application est éditée par ${editor} (« l'Éditeur »), prestataire technique et sous-traitant de la Salle. L'Éditeur ne vend rien aux membres. Les paiements sont traités par **Mollie B.V.** pour le compte de la Salle.

### 2. Compte membre

2.1. Un compte est requis pour réserver. Le membre garantit l'exactitude de ses informations et la confidentialité de ses identifiants.

2.2. L'inscription est ouverte aux personnes de **16 ans et plus**. Les mineurs de moins de 16 ans ne peuvent s'inscrire qu'avec l'accord de leur représentant légal et l'accord de la Salle, selon les conditions propres de celle-ci.

2.3. La suppression du compte est possible à tout moment dans l'application (Profil) : les données personnelles sont anonymisées, les données transactionnelles conservées conformément aux obligations comptables (cf. Politique de confidentialité). La suppression est possible au terme d'un éventuel abonnement en cours (art. 10).

### 3. Formules et prix

3.1. Deux types de formules, aux prix en euros TTC affichés dans l'application : **à l'unité** (Drop-in, cartes — créditent des séances) et **abonnements** (accès illimité pour la durée choisie, mensualités par domiciliation SEPA).

3.2. **Les séances achetées n'ont pas de date d'expiration.** Toute évolution future de cette règle ne s'appliquera jamais aux séances déjà achetées.

3.3. Les crédits et cartes sont cumulables librement. Un seul abonnement actif à la fois. Pendant un abonnement actif, l'achat à l'unité est indisponible (l'accès est déjà illimité) ; les crédits détenus sont conservés et redeviennent utilisables à l'échéance de l'abonnement.

3.4. Les prix applicables sont ceux affichés au moment de l'achat. Les conditions d'un abonnement en cours ne sont jamais modifiées.

### 4. Paiement

4.1. Les paiements sont opérés via Mollie. Achats à l'unité : paiement immédiat par les moyens proposés à l'écran de paiement (notamment Bancontact et carte). Abonnements : le premier paiement établit un mandat de domiciliation SEPA, les mensualités suivantes sont prélevées automatiquement.

4.2. En cas d'échec d'un prélèvement mensuel non régularisé après information du membre, la Salle peut suspendre l'accès aux réservations jusqu'à régularisation, sans préjudice des sommes dues.

### 5. Droit de rétractation

5.1. Conformément aux articles VI.47 et suivants du Code de droit économique, le membre consommateur dispose d'un délai de **14 jours** à compter de l'achat à distance pour se rétracter sans motif.

5.2. En achetant, le membre demande expressément que la prestation commence avant l'expiration de ce délai. En cas de rétractation dans le délai : les séances déjà consommées sont déduites au prorata du prix payé ; pour un abonnement entamé, le remboursement est diminué de la valeur de la période écoulée. Le droit de rétractation est perdu si la prestation a été pleinement exécutée avant la fin du délai (art. VI.53, 1° CDE).

5.3. Le droit s'exerce par email à l'adresse de contact de la Salle (${contact}), ou via ${EDITEUR.email} qui transmettra à la Salle, le cas échéant au moyen du formulaire légal de rétractation.

### 6. Réservations

6.1. Réserver — y compris rejoindre une liste d'attente — requiert un abonnement actif ou au moins une séance disponible.

6.2. Le nombre maximum de **réservations confirmées à venir** simultanément est fixé par la Salle et affiché dans l'application.

6.3. Une séance n'est décomptée qu'à la **confirmation** de la place (jamais en liste d'attente ; jamais sous abonnement).

6.4. Chaque cours a une capacité maximale ; cours complet → inscription en liste d'attente possible.

### 7. Liste d'attente

7.1. L'ordre de la liste est l'ordre d'inscription.

7.2. Lorsqu'une place se libère, le premier de la liste est notifié (notification et email) et dispose d'un **délai de confirmation fixé par la Salle** — affiché dans l'application — pour confirmer sa place (la séance est décomptée à la confirmation, sauf abonnement).

7.3. À défaut de confirmation dans le délai, l'inscription en liste d'attente expire et la place est proposée au suivant. Le membre peut se réinscrire en liste d'attente.

### 8. Annulation par le membre

8.1. **Gratuite jusqu'à 2 heures avant** le début du cours : la séance est immédiatement re-créditée (rien à re-créditer sous abonnement).

8.2. **Moins de 2 heures avant** : l'annulation est assimilée à une absence non excusée (art. 9) — pas de re-crédit, barème 9.2 applicable.

8.3. Se retirer d'une liste d'attente est libre et sans conséquence.

### 9. Absences non excusées (« no-show »)

9.1. Est en absence non excusée le membre confirmé qui ne se présente pas sans avoir annulé.

9.2. Un barème automatique cumulatif s'applique : les premières absences donnent lieu à un avertissement, les suivantes à une suspension temporaire des réservations, de durée croissante en cas de récidive. Les seuils et durées exacts sont fixés par la Salle et affichés dans l'application.

9.3. La séance n'est pas re-créditée. Le compteur d'absences est cumulatif ; il est automatiquement remis à zéro après une période sans nouvelle absence, dont la durée est fixée par la Salle et affichée dans l'application.

### 10. Abonnements — durée, échéance, résiliation

10.1. L'abonnement est conclu pour la durée choisie, payée par mensualités SEPA. Il prend fin de plein droit à son échéance, **sans tacite reconduction** : aucun prélèvement n'intervient au-delà du terme.

10.2. L'abonnement constitue un **engagement ferme pour la durée choisie** : il ne peut pas être résilié de manière anticipée et les mensualités restent dues jusqu'au terme, sans préjudice du droit de rétractation (art. 5) et des cas de motif légitime prévus par la loi. L'application affiche la date de fin d'engagement.

10.3. Pendant l'abonnement, les séances à l'unité détenues sont conservées mais inutilisées (art. 3.3).

### 11. Remboursements

11.1. Le re-crédit de séances s'opère selon les articles 7 et 8.

11.2. Si un cours est annulé par la Salle, la séance décomptée est automatiquement re-créditée. Tout autre remboursement monétaire, hors droit de rétractation, relève de l'appréciation de la Salle, sans préjudice des droits légaux du consommateur.

### 12. Comportement, sécurité et santé

12.1. Le membre respecte le règlement intérieur de la Salle, affiché dans ses locaux et/ou dans l'application.

12.2. La pratique d'activités physiques intensives requiert une condition physique adaptée : le membre déclare ne présenter aucune contre-indication médicale connue. Si la Salle exige un certificat médical pour certaines activités, il doit être fourni avant la participation. Les informations relatives aux assurances de la Salle sont disponibles sur demande auprès de celle-ci.

### 13. Données personnelles

Le traitement des données est décrit dans la Politique de confidentialité, accessible dans l'application (Profil → Confidentialité) et sur ${PLATFORM_NAME.toLowerCase()}.app/legal/privacy. Responsable du traitement : la Salle. Sous-traitant principal : ${EDITEUR.nomCommercial} (plateforme ${PLATFORM_NAME}) ; autres sous-traitants : Supabase, Mollie, Resend, Expo/Apple.

### 14. Modifications

Toute modification des présentes conditions est portée à la connaissance des membres via l'application au moins **30 jours** avant son entrée en vigueur. Elle ne s'applique jamais rétroactivement aux achats effectués.

### 15. Droit applicable et litiges

Les présentes conditions sont régies par le droit belge. En cas de litige, le membre peut recourir au Service de Médiation pour le Consommateur (mediationconsommateur.be) ou à la plateforme européenne de règlement en ligne des litiges (ec.europa.eu/odr). À défaut de résolution amiable, les tribunaux de l'arrondissement judiciaire du siège social de la Salle sont compétents, sans préjudice des règles impératives de compétence.
`
}

// ═════════════════════════════════════════════════════════════════════════════════════
// POINT D'ENTRÉE UNIQUE
// ═════════════════════════════════════════════════════════════════════════════════════
/**
 * Rend un document légal.
 *
 * `gym` n'est utilisé que par les CGV : les CGU et la politique de confidentialité sont
 * publiées par l'éditeur et identiques pour tout le monde. Le passer partout garde la
 * signature stable et évite un appelant qui devrait savoir quel document est templaté.
 */
export function getLegalDoc(
  kind: LegalKind,
  lang: LegalLang,
  gym: GymLegalIdentity | null = null,
): string {
  switch (kind) {
    case 'cgu':
      return cguDoc(lang)
    case 'terms':
      return termsDoc(lang, gym)
    case 'privacy':
      return privacyDoc(lang)
  }
}

// Le dashboard supporte fr/en/nl/de ; le contenu légal n'existe qu'en fr/en.
// Toute autre langue retombe sur le français (langue primaire du déploiement).
export function resolveLegalLang(language: string | undefined): LegalLang {
  return language?.toLowerCase().startsWith('en') ? 'en' : 'fr'
}
