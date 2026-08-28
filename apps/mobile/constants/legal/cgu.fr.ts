// Conditions générales de vente — v1 PUBLIABLE.
// Source de vérité : docs/legal/cgv-v1.md (corps publiable UNIQUEMENT ; les annexes
// internes de la source ne sont JAMAIS reproduites ici).
// 🔴 GYM-293b — L'IDENTITÉ DU CLUB EST UN PLACEHOLDER, PLUS UNE INTERPOLATION.
// `${CLUB_IDENTITY.name}` était évalué À L'IMPORT du module : la valeur de Dopamine était
// donc SCELLÉE dans la chaîne avant que la moindre salle soit connue. Chez une autre salle,
// le membre acceptait les CGV de Dopamine — et le nom de l'application était Dopamine
// aussi. Les trois valeurs passent maintenant par `{{…}}`, résolues AU RENDU.
// Chaque sous-clause « N.x » est séparée par une ligne vide : le renderer MarkdownText
// fusionne sinon les lignes contiguës dans un même paragraphe.
import { LEGAL_VERSION, LEGAL_UPDATED_AT } from './meta'

export const cguFr = `# Conditions générales

**Dernière mise à jour : ${LEGAL_UPDATED_AT}** · Version ${LEGAL_VERSION}

### 1. Identification et objet

Les présentes conditions régissent l'utilisation de l'application {{app_name}} et l'achat de prestations auprès de **{{club_name}}**{{club_commune}} (« le Club »), vendeur des prestations, dont l'identité complète (dénomination légale, numéro d'entreprise, siège) est affichée dans l'application, écran d'informations du Club. L'application est éditée par **Nexxia** — Antoine Monie, entreprise en personne physique de droit belge, BCE BE 1024.997.119, Rue Grande Bruyère 6 B1, 4840 Welkenraedt (« l'Éditeur »), prestataire technique et sous-traitant du Club. Les paiements sont traités par **Mollie B.V.** pour le compte du Club.

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

6.2. {{booking_limit_clause}}

6.3. Une séance n'est décomptée qu'à la **confirmation** de la place (jamais en liste d'attente ; jamais sous abonnement).

6.4. Chaque cours a une capacité maximale ; cours complet → inscription en liste d'attente possible.

### 7. Liste d'attente

7.1. L'ordre de la liste est l'ordre d'inscription.

7.2. Lorsqu'une place se libère, le premier de la liste est notifié (notification et email) et dispose d'un **délai de {{waitlist_confirmation_minutes}}** — affiché dans l'application — pour confirmer sa place (la séance est décomptée à la confirmation, sauf abonnement).

7.3. À défaut de confirmation dans le délai, l'inscription en liste d'attente expire et la place est proposée au suivant. Le membre peut se réinscrire en liste d'attente.

### 8. Annulation par le membre

8.1. **Gratuite jusqu'à 2 heures avant** le début du cours : la séance est immédiatement re-créditée (rien à re-créditer sous abonnement).

8.2. **Moins de 2 heures avant** : l'annulation est assimilée à une absence non excusée (art. 9) — pas de re-crédit, barème 9.2 applicable.

8.3. Se retirer d'une liste d'attente est libre et sans conséquence.

### 9. Absences non excusées (« no-show »)

9.1. Est en absence non excusée le membre confirmé qui ne se présente pas sans avoir annulé.

9.2. {{noshow_scale_clause}}

9.3. La séance n'est pas re-créditée. {{counter_reset_clause}}

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
