-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  GYM-336 — DEMANDE D'EXÉCUTION ANTICIPÉE : LA PREUVE, RATTACHÉE À L'ACHAT             ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- 🔴 CE FICHIER N'EST PAS APPLIQUÉ PAR CE LOT. Le cockpit l'exécute, staging puis prod.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- POURQUOI CETTE COLONNE EXISTE
-- ─────────────────────────────────────────────────────────────────────────────────────
-- GYM-333b a SUPPRIMÉ des CGV la présomption d'exécution anticipée : « en achetant, le
-- membre demande expressément que la prestation commence » présumait un consentement que
-- personne n'avait jamais recueilli. L'art. B4.4 dit donc aujourd'hui la vérité — à défaut
-- de demande expresse, le remboursement est INTÉGRAL, quelle que soit la période écoulée.
-- Un membre peut souscrire douze mois, en consommer un, se rétracter et tout récupérer.
--
-- La case à cocher répare cela. Mais UNE CASE COCHÉE QUI NE LAISSE PAS DE TRACE NE PROTÈGE
-- DE RIEN : devant un juge, ce n'est pas l'affichage qui compte, c'est la preuve. C'est
-- cette colonne, et non l'écran, qui est le cœur du lot.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- POURQUOI SUR `payments`, ET NON AILLEURS
-- ─────────────────────────────────────────────────────────────────────────────────────
-- `payments` est LA ligne de l'achat. Les deux flux en ligne (create-payment,
-- create-subscription) l'écrivent déjà, côté serveur, dans le même INSERT que le reste de
-- la commande : la preuve naît avec l'achat ou pas du tout — aucune fenêtre où l'un
-- existerait sans l'autre.
--
-- ✅ ELLE SURVIT AU REMBOURSEMENT : un remboursement CHANGE LE STATUT de la ligne, il ne
--    la supprime pas. Vérifié — le dépôt ne contient AUCUN `delete` sur `payments`, et
--    delete-account conserve explicitement le transactionnel (obligations comptables,
--    10 ans, cf. politique de confidentialité art. 5).
-- ✅ ELLE SURVIT À L'ANNULATION DE L'ABONNEMENT : celle-ci n'écrit que
--    `member_subscriptions` (status/cancelled_at) et ne touche jamais `payments`.
-- ✅ ELLE EST INFALSIFIABLE PAR LE CLIENT : la RLS de `payments` n'accorde au membre
--    qu'un `FOR SELECT` (« Membres voient leurs paiements »). Il n'existe AUCUNE policy
--    INSERT ni UPDATE pour un rôle `authenticated` — seuls le service role (edge
--    functions) et le gym_admin de la salle écrivent. Le mobile ne PEUT pas poser cette
--    valeur, même en essayant.
--
-- ⚠️ `member_subscriptions` A ÉTÉ ÉCARTÉE. La ligne d'abonnement n'existe pas encore au
--    moment du consentement (c'est le webhook qui la crée, après le paiement), et le flux
--    drop-in n'en produit aucune. Elle ne peut donc pas porter une preuve qui doit être
--    posée à l'achat, pour TOUS les achats.
--
-- ⚠️ `consent_history` A ÉTÉ ÉCARTÉE, malgré son nom. Elle est keyée sur `user_id` SEUL :
--    une ligne y dirait « ce membre a consenti le 10/09 à 14 h 32 » sans pouvoir dire À
--    QUEL ACHAT. Or chaque achat ouvre SON PROPRE délai de rétractation ; un membre qui
--    achète trois fois doit produire trois demandes distinctes, et les recoller par
--    proximité d'horodatage est exactement la fragilité qu'on cherche à éviter. Son CHECK
--    `consent_type` ne prévoit d'ailleurs pas ce type, et son écriture passe par un
--    trigger sur `profiles` — un tout autre chemin. Le journal reste le bon endroit pour
--    les consentements ATTACHÉS À LA PERSONNE (CGU, confidentialité, marketing) ; celui-ci
--    est attaché à une COMMANDE.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 1. LES DEUX COLONNES
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ PAS DE COLONNE BOOLÉENNE, ET C'EST VOLONTAIRE. `early_performance_requested_at`
-- porte À LA FOIS le fait et sa date : NULL = aucune demande expresse au dossier, non-NULL
-- = demande formulée, à cet instant. Un booléen à côté ouvrirait un troisième état
-- incohérent (`true` sans date) qu'aucune règle métier ne saurait interpréter.
--
-- ⚠️ L'HORODATAGE VIENT DU SERVEUR, JAMAIS DE L'APPAREIL. Les edge functions posent la
-- valeur depuis leur propre horloge, dans l'INSERT ; l'app n'envoie qu'un booléen. Une
-- date fournie par le client serait sans valeur probante.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS early_performance_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS early_performance_consent_version text;

COMMENT ON COLUMN public.payments.early_performance_requested_at IS
  'GYM-336 — Demande expresse d''exécution anticipée (art. VI.53, 1° CDE / CGV art. B4), '
  'horodatée par le serveur au moment de l''achat. NULL = AUCUNE demande au dossier : le '
  'remboursement en cas de rétractation est alors INTÉGRAL. Écrite uniquement par '
  'create-payment / create-subscription ; le membre n''a qu''un droit de SELECT sur cette '
  'table.';

COMMENT ON COLUMN public.payments.early_performance_consent_version IS
  'GYM-336 — Version du LIBELLÉ effectivement affiché au membre quand il a coché. Une '
  'preuve doit identifier le texte accepté, pas seulement le fait de l''acceptation : le '
  'jour où le libellé change, les demandes anciennes doivent rester lisibles. Vaut '
  '''unknown'' si le client a affirmé un consentement sans transmettre de version '
  'identifiable — on enregistre alors ce qu''on sait, sans jamais inventer la version.';

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 2. LA COHÉRENCE DES DEUX COLONNES, GARANTIE EN BASE
-- ═════════════════════════════════════════════════════════════════════════════════════
-- Les deux valeurs décrivent un seul fait : elles sont posées ensemble ou pas du tout.
-- Une date sans version serait une preuve muette sur ce qui a été accepté ; une version
-- sans date, une acceptation hors du temps. Ni l'une ni l'autre ne vaut quoi que ce soit,
-- et la base est le seul endroit où l'invariant tient quel que soit l'appelant.
--
-- ⚠️ `NOT VALID` puis `VALIDATE` : la table porte l'historique de production. Le CHECK
-- vaut immédiatement pour toute écriture NOUVELLE ; la validation des lignes existantes
-- se fait ensuite, sans verrou exclusif prolongé. Les lignes antérieures ont les deux
-- colonnes à NULL et satisfont donc le CHECK — la validation ne peut pas échouer.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payments_early_performance_coherence'
      AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_early_performance_coherence
      CHECK ((early_performance_requested_at IS NULL) = (early_performance_consent_version IS NULL))
      NOT VALID;

    ALTER TABLE public.payments
      VALIDATE CONSTRAINT payments_early_performance_coherence;
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 3. CE QUE CETTE MIGRATION NE FAIT PAS
-- ═════════════════════════════════════════════════════════════════════════════════════
-- 🔴 AUCUNE REPRISE D'HISTORIQUE, et ce n'est pas un oubli. Les achats antérieurs n'ont
-- JAMAIS recueilli de demande expresse — la case n'existait pas. Leur poser une valeur
-- reviendrait à fabriquer une preuve. Ils restent à NULL, ce qui est exactement leur
-- situation juridique : remboursement intégral en cas de rétractation. Même raisonnement
-- que GYM-199, qui a refusé de journaliser après coup des consentements non tracés.
--
-- ⚠️ AUCUN INDEX. Cette colonne ne se lit pas en liste : elle se lit ligne à ligne, sur
-- une commande précise, au moment d'un litige. `payments` porte déjà idx_payments_member
-- (member_id, status) pour retrouver les achats d'un membre. Un index de plus coûterait à
-- chaque écriture pour un chemin de lecture qui n'existe pas.
