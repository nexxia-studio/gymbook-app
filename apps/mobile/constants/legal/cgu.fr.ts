// Conditions générales — v1 PUBLIABLE.
// Source de vérité : docs/legal/cgv-v1.md (corps publiable UNIQUEMENT ; les annexes
// internes de la source ne sont JAMAIS reproduites ici).
// 🔴 GYM-293b — L'IDENTITÉ DU CLUB EST UN PLACEHOLDER, PLUS UNE INTERPOLATION.
// `${CLUB_IDENTITY.name}` était évalué À L'IMPORT du module : la valeur de Dopamine était
// donc SCELLÉE dans la chaîne avant que la moindre salle soit connue. Chez une autre salle,
// le membre acceptait les CGV de Dopamine — et le nom de l'application était Dopamine
// aussi. Les trois valeurs passent maintenant par `{{…}}`, résolues AU RENDU.
// Chaque sous-clause « N.x » est séparée par une ligne vide : le renderer MarkdownText
// fusionne sinon les lignes contiguës dans un même paragraphe.
//
// ─────────────────────────────────────────────────────────────────────────────────────
// 🔴 GYM-333b (§ 2 de l'audit) — DEUX CONTRATS, ET LE DOCUMENT LE DIT ENFIN
// ─────────────────────────────────────────────────────────────────────────────────────
// Ce texte a toujours couvert DEUX contrats : l'usage de l'application (membre ↔ Éditeur)
// et l'achat de prestations (membre ↔ Club). Il ne le disait NULLE PART. Un membre lisant
// « art. 10.2 » ne pouvait pas savoir qui s'engageait envers lui, et l'Éditeur se trouvait
// implicitement garant de prestations sportives qu'il ne fournit pas.
//
// NUMÉROTATION PRÉFIXÉE, ET C'EST LE CŒUR DE LA CORRECTION. « art. B4 » nomme son contrat
// dans la citation elle-même ; une numérotation continue 1..N aurait recréé l'ambiguïté
// dès le premier renvoi croisé. Aucun renvoi externe aux numéros d'articles n'existe dans
// le code (vérifié sur locales/, app/, components/, dashboard/src) : la renumérotation est
// sans effet de bord.
//
// TROISIÈME BLOC ASSUMÉ. Force majeure, réclamations, divisibilité, droit applicable et
// litiges valent pour LES DEUX contrats. Les dupliquer dans A et B aurait été pire que de
// les regrouper : deux rédactions d'une même règle finissent toujours par diverger.
//
// ⚠️ ANNEXE ET NON LIEN. MarkdownText ne gère ni liens ni tableaux (#/##/###, « - »,
// **gras**, _italique_ pleine ligne). Le formulaire de rétractation (art. VI.53 et annexe 2
// du Livre VI CDE) est donc REPRODUIT en fin de document — c'est la seule forme qui le
// rende réellement accessible depuis les CGV dans l'app.
//
// ⚠️ LEGAL_VERSION RESTE 1.0, sur consigne : elle passera à 2.0 avec GYM-330 (écran
// d'acceptation), en une seule fois, quand les textes seront définitifs. Conséquence
// connue et acceptée : deux membres peuvent avoir accepté « 1.0 » sans avoir lu le même
// document. C'est GYM-330 qui referme ça.
//
// ⚠️ LA CASE D'EXÉCUTION ANTICIPÉE N'EXISTE PAS ENCORE (son propre ticket : elle exige une
// migration pour horodater la preuve). L'art. B4 ne la PRÉSUME donc PAS — c'était le
// défaut relevé. Il s'appuie sur l'exclusion VI.53, 12°, qui ne demande aucune déclaration
// du membre, et dit explicitement que sans demande expresse le remboursement est INTÉGRAL.
// Quand la case sera livrée, c'est B4.4 qui accueillera la clause de renonciation.
import { LEGAL_VERSION, LEGAL_UPDATED_AT } from './meta'

export const cguFr = `# Conditions générales

**Dernière mise à jour : ${LEGAL_UPDATED_AT}** · Version ${LEGAL_VERSION}

## Préambule — deux contrats, un document

Ce document réunit **deux contrats distincts**, et il importe de savoir lequel s'applique.

La **Partie A** régit votre utilisation de l'application {{app_name}}, éditée par **Nexxia** — Antoine Monie, entreprise en personne physique de droit belge, BCE BE 1024.997.119, Rue Grande Bruyère 6 B1, 4840 Welkenraedt (« l'Éditeur »). Ce contrat vous lie à l'Éditeur.

La **Partie B** régit vos achats de prestations auprès de **{{club_name}}**{{club_commune}} (« le Club »), vendeur des prestations. Ce contrat vous lie au Club. L'Éditeur n'y est pas partie : il intervient comme prestataire technique et sous-traitant du Club. Les paiements sont traités par **Mollie B.V.** pour le compte du Club.

Les **Dispositions communes** s'appliquent aux deux contrats. L'**Annexe** reproduit le formulaire de rétractation.

En cas de contradiction entre une clause de la Partie A et une clause de la Partie B, celle qui régit le contrat concerné prévaut.

## Partie A — Votre utilisation de l'application

### A1. Objet et identification de l'Éditeur

A1.1. La Partie A régit la mise à disposition de l'application {{app_name}} et son utilisation par le membre. L'accès à l'application n'est pas facturé au membre.

A1.2. Éditeur : **Nexxia** — Antoine Monie, entreprise en personne physique de droit belge, BCE BE 1024.997.119, Rue Grande Bruyère 6 B1, 4840 Welkenraedt. Contact : support@viniz.app.

### A2. Compte membre

A2.1. Un compte est requis pour réserver. Le membre garantit l'exactitude de ses informations et la confidentialité de ses identifiants.

A2.2. La suppression du compte est possible à tout moment dans l'application (Profil) : les données personnelles sont anonymisées, les données transactionnelles conservées conformément aux obligations comptables (cf. Politique de confidentialité). Elle est possible au terme d'un éventuel abonnement en cours (art. B9).

### A3. Mineurs

A3.1. L'inscription est ouverte aux personnes de **16 ans et plus**. Ce seuil est un choix de l'Éditeur et **non une obligation légale** : en Belgique, l'âge à partir duquel un mineur peut consentir seul au traitement de ses données dans le cadre des services de la société de l'information est de 13 ans.

A3.2. Un mineur de moins de 16 ans ne peut être inscrit qu'avec l'accord de son représentant légal et l'accord du Club, selon les conditions propres de celui-ci.

A3.3. Dans ce cas, **c'est le représentant légal qui est partie au contrat**, Partie A comme Partie B. Il accepte les présentes conditions, il est titulaire des droits et obligations qui en découlent, et il est **seul redevable des sommes dues** au titre des achats effectués depuis le compte. Le mineur est l'utilisateur du service ; il n'en est pas l'acheteur.

### A4. Disponibilité du service et responsabilité de l'Éditeur

A4.1. L'Éditeur met en œuvre les moyens raisonnables pour assurer la disponibilité, la continuité et la sécurité de l'application. Il est tenu à cet égard d'une **obligation de moyens**.

A4.2. L'application peut être temporairement indisponible pour maintenance ou mise à jour, ou du fait d'un tiers dont l'Éditeur dépend (hébergement, prestataire de paiement, service de notification, magasin d'applications, réseau de l'appareil). Lorsque l'interruption est programmée et de durée significative, l'Éditeur en informe les membres.

A4.3. **L'Éditeur n'est pas partie au contrat de vente.** Il ne fournit aucune prestation sportive, ne fixe ni les prix, ni les horaires, ni la capacité des cours, ni le règlement intérieur, et ne répond ni de leur exécution, ni de la sécurité dans les locaux du Club. Ces obligations relèvent exclusivement du Club (Partie B).

A4.4. La responsabilité de l'Éditeur envers le membre est limitée aux **dommages directs** résultant d'une faute de sa part. Cette limitation ne joue **en aucun cas** en cas de dol, de faute lourde, d'atteinte à la vie ou à l'intégrité physique, ni dans les hypothèses où la loi l'interdit.

A4.5. Aucune clause de la présente Partie ne réduit les droits que le membre consommateur tient de dispositions impératives, notamment du Livre VI du Code de droit économique.

### A5. Données personnelles

Le traitement des données est décrit dans la Politique de confidentialité, accessible dans l'application (Profil → Confidentialité) et sur viniz.app/legal/privacy. Responsable du traitement : le Club. Sous-traitant principal : Nexxia (plateforme Viniz) ; autres sous-traitants : Supabase, Mollie, Resend, Vercel, PostHog, Sentry, Expo/Apple.

## Partie B — Vos achats auprès du Club

### B1. Objet et identification du Club

B1.1. La Partie B régit l'achat de prestations auprès du Club et leur exécution. Elle lie le membre au Club, **vendeur des prestations**.

B1.2. Vendeur : **{{club_name}}**{{club_commune}}, dont l'identité complète (dénomination légale, numéro d'entreprise, siège) et les coordonnées de contact sont affichées dans l'application, écran d'informations du Club.

B1.3. Les paiements sont traités par **Mollie B.V.** pour le compte du Club. L'Éditeur n'encaisse pas le prix des prestations.

### B2. Formules et prix

B2.1. Deux types de formules, aux prix en euros TTC affichés dans l'application : **à l'unité** (Drop-in, cartes — créditent des séances) et **abonnements** (accès illimité pour la durée choisie, mensualités par domiciliation SEPA).

B2.2. **Les séances achetées n'ont pas de date d'expiration.** Toute évolution future de cette règle ne s'appliquera jamais aux séances déjà achetées.

B2.3. Les crédits et cartes sont cumulables librement. Un seul abonnement actif à la fois. Pendant un abonnement actif, l'achat à l'unité est indisponible (l'accès est déjà illimité) ; les crédits détenus sont conservés et redeviennent utilisables à l'échéance de l'abonnement.

B2.4. Les prix applicables sont ceux affichés au moment de l'achat. Les conditions d'un abonnement en cours ne sont jamais modifiées.

### B3. Paiement

B3.1. Les paiements sont opérés via Mollie. Achats à l'unité : paiement immédiat par les moyens proposés à l'écran de paiement (notamment Bancontact et carte). Abonnements : le premier paiement établit un mandat de domiciliation SEPA, les mensualités suivantes sont prélevées automatiquement.

B3.2. En cas d'échec d'un prélèvement mensuel non régularisé après information du membre, le Club peut suspendre l'accès aux réservations jusqu'à régularisation, sans préjudice des sommes dues.

### B4. Droit de rétractation

B4.1. Le membre consommateur qui achète à distance dispose en principe d'un délai de **14 jours** pour se rétracter sans avoir à motiver sa décision, conformément aux articles VI.47 et suivants du Code de droit économique. Le délai court à compter de la conclusion du contrat.

B4.2. **Séances réservées à une date déterminée : pas de droit de rétractation.** L'article **VI.53, 12° du Code de droit économique** exclut du droit de rétractation les contrats portant sur des services liés à des activités de loisirs lorsque le contrat prévoit une date ou une période d'exécution déterminée. La réservation d'un cours à une date et une heure données relève de cette exclusion. Elle demeure annulable dans les conditions de l'article B7, plus favorables au membre.

B4.3. **Crédits non consommés et abonnements : le droit s'applique.** L'achat de crédits non encore affectés à un cours, et la souscription d'un abonnement, restent rétractables pendant le délai de 14 jours.

B4.4. **Effet de la rétractation.** Pour les crédits, le remboursement porte sur les **crédits non consommés** ; un crédit affecté à un cours réservé à une date déterminée relève de l'exclusion de l'article B4.2. Pour un abonnement, le remboursement est **intégral**, sauf si le membre a expressément demandé que l'accès commence avant la fin du délai de rétractation : dans ce seul cas, la valeur de la période déjà écoulée est déduite au prorata de la durée totale (art. VI.51 CDE). Le droit de rétractation n'est perdu du fait de l'exécution complète de la prestation que si celle-ci a eu lieu avec l'accord préalable exprès du membre et sa reconnaissance de la perte de ce droit (art. VI.53, 1° CDE).

B4.5. **Exercice du droit.** Le membre informe le Club de sa décision au moyen d'une déclaration dénuée d'ambiguïté, par email à l'adresse de contact du Club indiquée dans l'application, ou via support@viniz.app qui la transmettra au Club. Il peut utiliser le formulaire reproduit en **annexe** du présent document ; son usage n'est pas obligatoire.

B4.6. **Délai de remboursement.** Le Club rembourse les sommes dues **au plus tard 14 jours** après avoir été informé de la décision de rétractation, en utilisant le même moyen de paiement que celui employé pour l'achat, sans frais pour le membre (art. VI.50 CDE).

### B5. Réservations

B5.1. Réserver — y compris rejoindre une liste d'attente — requiert un abonnement actif ou au moins une séance disponible.

B5.2. {{booking_limit_clause}}

B5.3. Une séance n'est décomptée qu'à la **confirmation** de la place (jamais en liste d'attente ; jamais sous abonnement).

B5.4. Chaque cours a une capacité maximale ; cours complet → inscription en liste d'attente possible.

### B6. Liste d'attente

B6.1. L'ordre de la liste est l'ordre d'inscription.

B6.2. Lorsqu'une place se libère, le premier de la liste est notifié (notification et email) et dispose d'un **délai de {{waitlist_confirmation_minutes}}** — affiché dans l'application — pour confirmer sa place (la séance est décomptée à la confirmation, sauf abonnement).

B6.3. À défaut de confirmation dans le délai, l'inscription en liste d'attente expire et la place est proposée au suivant. Le membre peut se réinscrire en liste d'attente.

### B7. Annulation par le membre

B7.1. **Gratuite jusqu'à 2 heures avant** le début du cours : la séance est immédiatement re-créditée (rien à re-créditer sous abonnement).

B7.2. **Moins de 2 heures avant** : l'annulation est assimilée à une absence non excusée (art. B8) — pas de re-crédit, barème B8.2 applicable.

B7.3. Se retirer d'une liste d'attente est libre et sans conséquence.

### B8. Absences non excusées (« no-show »)

B8.1. Est en absence non excusée le membre confirmé qui ne se présente pas sans avoir annulé.

B8.2. {{noshow_scale_clause}}

B8.3. La séance n'est pas re-créditée. {{counter_reset_clause}}

### B9. Abonnements — durée, échéance, résiliation

B9.1. L'abonnement est conclu pour la durée choisie, payée par mensualités SEPA. Il prend fin de plein droit à son échéance, **sans tacite reconduction** : aucun prélèvement n'intervient au-delà du terme.

B9.2. L'abonnement constitue un **engagement ferme pour la durée choisie** : il ne peut pas être résilié de manière anticipée et les mensualités restent dues jusqu'au terme, sans préjudice du droit de rétractation (art. B4) et des cas de sortie anticipée de l'article B9.3. L'application affiche la date de fin d'engagement.

B9.3. **Cas de sortie anticipée.** Par exception à l'article B9.2, l'abonnement prend fin avant son terme, sans indemnité, dans les cas suivants :

- **décès du membre** ;
- **incapacité médicale durable** rendant la pratique impossible, établie par un certificat médical transmis directement au Club, hors de l'application ;
- **déménagement** rendant l'accès aux locaux du Club manifestement impraticable, sur justificatif ;
- **fermeture définitive du Club** ou cessation durable de son activité (art. C1) ;
- **refus d'une modification** des présentes conditions (art. C2) ;
- tout autre **motif légitime** reconnu par la loi ou accepté par le Club.

B9.4. La demande est adressée au Club, accompagnée de ses justificatifs ; le Club y répond dans les conditions de l'article C3. Les mensualités échues avant la fin de l'abonnement restent dues ; les sommes payées d'avance au titre de la période postérieure sont remboursées au prorata dans les **14 jours**.

B9.5. Pendant l'abonnement, les séances à l'unité détenues sont conservées mais inutilisées (art. B2.3).

### B10. Remboursements

B10.1. Le re-crédit de séances s'opère selon les articles B6 et B7.

B10.2. Si un cours est annulé par le Club, la séance décomptée est automatiquement re-créditée. Tout autre remboursement monétaire, hors droit de rétractation, relève de l'appréciation du Club, sans préjudice des droits légaux du consommateur.

### B11. Comportement, sécurité et santé

B11.1. Le membre respecte le règlement intérieur du Club, affiché dans ses locaux et/ou dans l'application.

B11.2. La pratique d'activités physiques intensives requiert une condition physique adaptée : le membre déclare ne présenter aucune contre-indication médicale connue. Si le Club exige un certificat médical pour certaines activités, il doit être fourni avant la participation. Les informations relatives aux assurances du Club sont disponibles sur demande auprès de celui-ci.

## Dispositions communes

### C1. Force majeure

C1.1. Aucune des parties ne répond de l'inexécution de ses obligations lorsqu'elle résulte d'un événement de force majeure — imprévisible, insurmontable et extérieur à sa volonté : notamment fermeture administrative, épidémie, sinistre affectant les locaux, catastrophe naturelle, ou panne durable d'un réseau ou d'un service tiers indispensable.

C1.2. La partie empêchée en informe l'autre dans les meilleurs délais et met en œuvre ce qui est raisonnablement en son pouvoir pour en limiter les effets.

C1.3. **Effets sur les prestations achetées.** Si des cours ne peuvent être dispensés pour cette raison, les séances décomptées sont **re-créditées** et les abonnements en cours sont **suspendus** pour la durée de l'empêchement, leur terme étant reporté d'autant ; aucune mensualité n'est prélevée pendant la suspension. Si l'empêchement se prolonge au-delà de **deux mois**, chacune des parties peut mettre fin à l'abonnement, les sommes payées d'avance au titre de la période postérieure étant remboursées au prorata dans les **14 jours**.

C1.4. La force majeure ne dispense du paiement d'aucune somme déjà exigible avant sa survenance.

### C2. Modifications des présentes conditions

C2.1. Toute modification est portée à la connaissance des membres via l'application au moins **30 jours** avant son entrée en vigueur. La modification de la Partie A relève de l'Éditeur ; celle de la Partie B relève du Club.

C2.2. La modification **ne s'applique jamais rétroactivement** aux achats déjà effectués : les conditions d'un abonnement ou de crédits en cours restent celles en vigueur au moment de l'achat.

C2.3. **Le membre peut refuser la modification.** Le refus s'exprime par tout moyen auprès de son auteur, avant la date d'entrée en vigueur. Il emporte, à cette date :

- pour la Partie A, la clôture du compte ;
- pour la Partie B, la fin de l'abonnement en cours sans indemnité (art. B9.3), les sommes payées d'avance au titre de la période postérieure étant remboursées au prorata dans les **14 jours**.

C2.4. Le silence gardé jusqu'à la date d'entrée en vigueur, ou l'usage du service après celle-ci, vaut acceptation de la modification.

### C3. Réclamations

C3.1. **À qui s'adresser.** Une réclamation portant sur une prestation, un prix, un paiement, une réservation ou l'exécution d'un cours s'adresse au **Club**, à l'adresse de contact indiquée dans l'application. Une réclamation portant sur le fonctionnement de l'application s'adresse à l'**Éditeur**, à support@viniz.app. En cas de doute sur le destinataire, le membre peut écrire à support@viniz.app, qui transmet au Club le cas échéant.

C3.2. **Forme.** La réclamation est formulée par écrit et mentionne le compte concerné, la date et l'objet des faits, ainsi que la demande du membre.

C3.3. **Délais.** Le destinataire en accuse réception sous **7 jours** et y apporte une réponse motivée sous **30 jours** à compter de sa réception. Si l'examen requiert davantage de temps, le membre en est informé avant l'expiration de ce délai, avec l'indication du délai supplémentaire nécessaire.

C3.4. **Recours.** L'absence de réponse dans ces délais, ou une réponse insatisfaisante, ouvre les voies de recours de l'article C5. Le présent article **n'est pas un préalable obligatoire** : il ne prive le membre d'aucun recours direct.

### C4. Divisibilité et non-renonciation

C4.1. **Divisibilité.** Si une clause des présentes conditions est jugée nulle, non écrite ou inapplicable — notamment parce qu'elle serait abusive au sens du Livre VI du Code de droit économique — elle est réputée non écrite et **les autres clauses demeurent en vigueur**. Elle est remplacée, dans la mesure du possible, par une clause valable poursuivant le même objet ; à défaut, la règle légale applicable y supplée.

C4.2. **Non-renonciation.** Le fait pour l'Éditeur ou pour le Club de ne pas se prévaloir d'une clause, ou de tolérer un manquement, ne vaut pas renonciation à s'en prévaloir ultérieurement. Une renonciation n'est opposable que si elle est écrite et expresse, et vaut pour le seul cas visé.

C4.3. Aucune stipulation des présentes conditions ne prive le membre consommateur des droits qu'il tient de dispositions impératives.

### C5. Droit applicable et litiges

Les présentes conditions sont régies par le droit belge. Après avoir suivi, s'il le souhaite, la procédure de réclamation de l'article C3, le membre peut recourir au Service de Médiation pour le Consommateur (mediationconsommateur.be). À défaut de résolution amiable, les juridictions compétentes sont celles désignées par les règles légales de compétence, y compris les règles protectrices du consommateur qui lui permettent notamment de saisir le tribunal de son propre domicile.

## Annexe — Formulaire de rétractation

_À ne compléter et renvoyer que si vous souhaitez vous rétracter du contrat. Son usage n'est pas obligatoire : toute déclaration dénuée d'ambiguïté suffit (art. B4.5)._

À l'attention de **{{club_name}}**{{club_commune}}, dont l'adresse postale et l'adresse électronique sont indiquées dans l'application, écran d'informations du Club :

Je vous notifie par la présente ma rétractation du contrat portant sur la prestation de services ci-dessous.

- Prestation commandée :
- Commandée le :
- Nom du consommateur :
- Adresse du consommateur :
- Date :
- Signature du consommateur (uniquement si le présent formulaire est notifié sur papier) :
`
