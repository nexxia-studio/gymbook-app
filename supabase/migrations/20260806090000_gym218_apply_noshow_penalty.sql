-- GYM-218 (volet 1) : l'escalade de sanction devient UNE fonction, appelable par les deux
-- moteurs.
--
-- PROBLÈME — deux moteurs de sanction tournent en parallèle, un seul obéit au gérant :
--   · no-show constaté (mark_attendance_atomic) → lit noshow_rules depuis GYM-175 ✅
--   · annulation tardive (Edge cancel-booking)  → seuils CODÉS EN DUR : 1 avertissement,
--     puis 48 h, puis 336 h, et déclenchement figé à « moins de 2 h » ❌
-- Nico règle sa politique dans /settings et elle ne s'applique qu'à la moitié du système,
-- sans qu'aucun écran ne l'indique.
--
-- DÉCISION PRODUIT (Antoine, 06/08) : « Si le membre annule 10 min avant, il est concerné
-- par la politique de Nico : avertissement, 48 h, 2 semaines. Configurable depuis le
-- dashboard. » Une place bloquée est une place bloquée, quelle que soit la façon.
--
-- ─── POURQUOI UNE FONCTION SQL, ET NON LA MÊME RÈGLE RÉÉCRITE EN TYPESCRIPT ──
-- Réécrire l'escalade dans l'Edge Function aurait produit une SECONDE implémentation de
-- la même règle. Elles auraient divergé au premier ajustement — c'est très exactement le
-- défaut que ce lot corrige. La règle vit donc ici, en un seul endroit, et cancel-booking
-- l'appelle.
--
-- Bénéfice collatéral : ATOMICITÉ. L'Edge Function faisait trois écritures séparées
-- (compteur, pénalité, suspension) sans transaction ; un échec au milieu laissait un
-- compteur incrémenté sans sanction. Ici les trois sont dans la même transaction.
--
-- ─── RÈGLE D'ESCALADE — copie fidèle de mark_attendance_atomic (GYM-175) ─────
-- Évaluée du palier le PLUS HAUT au plus bas, pour que les seuils puissent être égaux
-- entre eux sans ambiguïté (chez Dopamine warning_2_at = suspension_at = 2) :
--     count >  suspension_at → suspension de escalated_suspension_hours
--     count =  suspension_at → suspension de suspension_hours
--     count >= warning_2_at  → 2e avertissement  (type 'warning_2')
--     count >= warning_1_at  → 1er avertissement (type 'warning_1')
--     sinon                  → aucune pénalité (le compteur est tout de même incrémenté)
--
-- ⚠️ NON-RÉGRESSION — Dopamine (w1=1, w2=2, susp=2, 48, 336), annulation tardive :
--     count=1 → 1 < 2, 1 < 2, 1 >= 1 → avertissement   (AVANT : 'warning', 1er avert.)
--     count=2 → 2 = 2                → suspension 48 h (AVANT : suspension 48 h)
--     count≥3 → 3 > 2                → suspension 336 h(AVANT : suspension 336 h)
--   Paliers, durées et enchaînement IDENTIQUES à l'ancien code en dur.
--
-- ⚠️ NON-RÉGRESSION — salle SANS ligne noshow_rules, replis = DÉFAUTS DU SCHÉMA
--   (w1=1, w2=2, susp=3, 48, 336) :
--     count=1 → avertissement · count=2 → 2e avertissement
--     count=3 → suspension 48 h · count≥4 → suspension 336 h
--   « Pas de ligne » vaut « politique par défaut », jamais « politique de Dopamine ».
--
-- ─── LIBELLÉS ───────────────────────────────────────────────────────────────
-- Les types émis sont ceux de GYM-175 : 'warning_1', 'warning_2', 'suspension'. Le
-- CHECK penalties_type_check les autorise déjà (il liste aussi 'warning',
-- 'suspension_48h', 'suspension_2w' pour les lignes historiques).
--
-- ─── FORME DES LIBELLÉS — aucun accord de genre ─────────────────────────────
-- « {Libellé} n°{compteur} — {sanction} », soit :
--     « No-show n°1 — 1er avertissement. À 2 : suspension de 48h. »
--     « Annulation tardive n°2 — suspension 48h. »
--
-- La forme ordinale accordée (« 1er annulation tardive ») était fautive : « annulation »
-- est féminin et demandait « 1re ». Plutôt que d'apprendre le genre à la fonction, on
-- SUPPRIME l'accord. `p_incident_label` est un paramètre libre : tout incident ajouté
-- demain reposerait le problème, et une fonction ne peut pas deviner le genre d'une
-- chaîne qu'on lui passe. « n° » ne s'accorde jamais.
--
-- ⚠️ LA MAJUSCULE EST DÉCIDÉE PAR L'APPELANT, pas ici. On aurait pu capitaliser à la
-- volée (upper(left(...,1)) || substr(...,2)), mais ce serait DEVINER : `upper()` dépend
-- de la locale du serveur, et la règle casserait le jour où un libellé doit commencer par
-- un sigle, un chiffre ou une minuscule voulue. L'appelant, lui, SAIT ce qu'il écrit. Le
-- paramètre porte donc le libellé tel qu'il doit s'afficher — et le DEFAULT suit
-- ('No-show'), pour qu'un appel qui l'omet reste bien formé.
--
-- ⚠️ CONSÉQUENCE POUR GYM-214 : cancel-booking émettait 'warning' pour l'annulation
-- tardive, et l'historique disciplinaire s'en servait comme signal d'origine. Ce n'est
-- plus vrai. Le discriminant fiable reste bookings.status ('cancelled' vs 'no_show'),
-- déjà en place ; l'ordre de résolution est corrigé dans le même lot côté dashboard.
-- La durée réelle d'une suspension est portée par expires_at, jamais par le type.

CREATE OR REPLACE FUNCTION public.apply_noshow_penalty(
  p_member_id   uuid,
  p_gym_id      uuid,
  p_booking_id  uuid,
  -- Libellé d'incident repris TEL QUEL dans penalties.notes, majuscule initiale comprise
  -- (cf. en-tête) : l'appelant décide de la casse, la fonction ne devine rien.
  -- La RÈGLE, elle, est strictement la même quelle que soit l'origine.
  p_incident_label text DEFAULT 'No-show'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_warning_1_at    integer;
  v_warning_2_at    integer;
  v_suspension_at   integer;
  v_susp_hours      integer;
  v_esc_hours       integer;
  v_new_count       integer;
  v_penalty_type    text;
  v_suspended_until timestamptz;
  v_notes           text;
  v_hours           integer;
BEGIN
  -- Politique de LA SALLE, avec repli sur les DEFAULT du schéma colonne par colonne
  -- (une ligne peut exister avec des colonnes à NULL).
  SELECT COALESCE(nr.warning_1_at, 1),
         COALESCE(nr.warning_2_at, 2),
         COALESCE(nr.suspension_at, 3),
         COALESCE(nr.suspension_hours, 48),
         COALESCE(nr.escalated_suspension_hours, 336)
    INTO v_warning_1_at, v_warning_2_at, v_suspension_at, v_susp_hours, v_esc_hours
  FROM noshow_rules nr
  WHERE nr.gym_id = p_gym_id;

  IF NOT FOUND THEN
    v_warning_1_at  := 1;
    v_warning_2_at  := 2;
    v_suspension_at := 3;
    v_susp_hours    := 48;
    v_esc_hours     := 336;
  END IF;

  UPDATE profiles
  SET noshow_count = COALESCE(noshow_count, 0) + 1,
      updated_at   = now()
  WHERE id = p_member_id
  RETURNING noshow_count INTO v_new_count;

  IF v_new_count IS NULL THEN
    -- Membre introuvable : rien n'a été incrémenté, on ne sanctionne pas dans le vide.
    RETURN jsonb_build_object('applied', false, 'reason', 'member_not_found');
  END IF;

  v_suspended_until := NULL;

  -- Du palier le PLUS HAUT au plus bas (cf. en-tête).
  IF v_new_count > v_suspension_at THEN
    v_hours           := v_esc_hours;
    v_suspended_until := now() + make_interval(hours => v_esc_hours);
    v_penalty_type    := 'suspension';
    v_notes           := p_incident_label || ' n°' || v_new_count || ' — suspension ' || v_esc_hours || 'h.';
    UPDATE profiles SET suspended_until = v_suspended_until WHERE id = p_member_id;

  ELSIF v_new_count = v_suspension_at THEN
    v_hours           := v_susp_hours;
    v_suspended_until := now() + make_interval(hours => v_susp_hours);
    v_penalty_type    := 'suspension';
    v_notes           := p_incident_label || ' n°' || v_new_count || ' — suspension ' || v_susp_hours || 'h.';
    UPDATE profiles SET suspended_until = v_suspended_until WHERE id = p_member_id;

  ELSIF v_new_count >= v_warning_2_at THEN
    v_penalty_type := 'warning_2';
    v_notes        := p_incident_label || ' n°' || v_new_count || ' — 2e avertissement. À '
                      || v_suspension_at || ' : suspension de ' || v_susp_hours || 'h.';

  ELSIF v_new_count >= v_warning_1_at THEN
    v_penalty_type := 'warning_1';
    v_notes        := p_incident_label || ' n°' || v_new_count || ' — 1er avertissement. À '
                      || v_suspension_at || ' : suspension de ' || v_susp_hours || 'h.';

  ELSE
    -- Sous le 1er seuil : aucune pénalité tracée, mais le compteur a bien bougé —
    -- l'incident est comptabilisé, il n'est simplement pas encore sanctionné.
    v_penalty_type := NULL;
  END IF;

  IF v_penalty_type IS NOT NULL THEN
    INSERT INTO penalties (gym_id, member_id, booking_id, type, applied_at, expires_at, notes)
    VALUES (p_gym_id, p_member_id, p_booking_id, v_penalty_type, now(), v_suspended_until, v_notes);
  END IF;

  RETURN jsonb_build_object(
    'applied',         v_penalty_type IS NOT NULL,
    'type',            v_penalty_type,
    'count',           v_new_count,
    'suspension_hours', v_hours,
    'suspended_until', v_suspended_until
  );
END;
$$;

COMMENT ON FUNCTION public.apply_noshow_penalty(uuid, uuid, uuid, text) IS
  'GYM-218 — Applique la politique d''absences de la salle (noshow_rules) à UN incident : '
  'incrémente profiles.noshow_count, évalue l''escalade du palier le plus haut au plus bas, '
  'insère la pénalité et pose suspended_until. Repli sur les DEFAULT du schéma si la salle '
  'n''a pas de ligne. SEULE implémentation de la règle appelable par plusieurs moteurs : '
  'l''Edge cancel-booking l''appelle pour les annulations tardives, ce qui remplace des '
  'seuils codés en dur. Atomique — les trois écritures étaient auparavant séparées côté '
  'Edge. Ne supprime jamais de ligne penalties.';

-- Sécurité (posture GYM-98) : appelée par l'Edge cancel-booking sous service_role.
-- Jamais exposée au client — un membre pourrait sinon s'auto-sanctionner ou sanctionner
-- autrui, la fonction étant SECURITY DEFINER.
REVOKE ALL ON FUNCTION public.apply_noshow_penalty(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_noshow_penalty(uuid, uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.apply_noshow_penalty(uuid, uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_noshow_penalty(uuid, uuid, uuid, text) TO service_role;
