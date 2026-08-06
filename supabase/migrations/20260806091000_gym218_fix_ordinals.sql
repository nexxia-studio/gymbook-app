-- GYM-218 (correctif QA staging, 06/08) : ordinaux français corrects dans les libellés
-- de pénalité de mark_attendance_atomic.
--
-- COQUILLE RELEVÉE EN QA (cockpit) — l'historique disciplinaire (GYM-214) affichait au
-- gérant « 1ème no-show — 1er avertissement… ». La forme « 1ème » n'existe pas en
-- français ; et « 2ème » / « 3ème », bien que courants, s'abrègent « 2e » / « 3e ».
--     1 → « 1er »  ·  2 → « 2e »  ·  3 → « 3e »  ·  n → « ne »
--
-- ─── PÉRIMÈTRE STRICT ───────────────────────────────────────────────────────
-- Cette fonction porte le bloc de SYMÉTRIE (annulation d'un no-show : décrément du
-- compteur, suppression de la pénalité par booking_id, recalcul de suspended_until). Le
-- moindre écart y serait un défaut silencieux sur un chemin peu emprunté.
--
-- La définition ci-dessous est donc EXTRAITE MOT POUR MOT de la dernière migration qui la
-- définit (20260728140000_gym175_noshow_policy_config.sql, confirmée conforme au live par
-- le cockpit) et seules les QUATRE affectations de `v_notes` diffèrent — vérifié ligne à
-- ligne, à nombre de lignes constant. Ni la règle d'escalade, ni les seuils, ni les types
-- de pénalité, ni le bloc de symétrie ne sont touchés.
--
-- ─── POURQUOI UNE EXPRESSION INLINE, ET NON UNE FONCTION D'ORDINAL PARTAGÉE ──
-- Une fonction partagée créerait une dépendance entre deux fonctions de sanction pour
-- trois lignes de texte, et un objet de plus à déployer, versionner et sécuriser. Le CASE
-- inline est lisible sur place et sans couplage. À reconsidérer si un troisième appelant
-- apparaît.
--
-- ⚠️ ACCORD EN GENRE — apply_noshow_penalty reçoit son libellé d'incident en paramètre.
-- Pour « annulation tardive » (féminin), le strict français demanderait « 1re » et non
-- « 1er ». La règle appliquée ici est celle demandée, à la lettre ; le point est signalé
-- au compte-rendu car il ne peut se corriger sans toucher à la signature de la fonction.

CREATE OR REPLACE FUNCTION public.mark_attendance_atomic(p_booking_id uuid, p_new_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_booking          record;
  v_prev             text;
  v_credit_movement  text := NULL;
  v_penalty          jsonb := NULL;
  v_new_count        integer;
  v_suspended_until  timestamptz;
  v_penalty_type     text;
  v_notes            text;
  v_deleted_expires  timestamptz;
  v_prev_suspended   timestamptz;
  v_checked_in_at    timestamptz;
  v_checked_method   text;
  -- GYM-175 — politique lue sur la salle du booking.
  v_warning_1_at     integer;
  v_warning_2_at     integer;
  v_suspension_at    integer;
  v_susp_hours       integer;
  v_esc_hours        integer;
BEGIN
  IF p_new_status NOT IN ('attended', 'no_show', 'excused') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  SELECT id, member_id, gym_id, status, debited_credit_id
    INTO v_booking
  FROM bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  v_prev := v_booking.status;

  IF v_prev = p_new_status THEN
    RETURN jsonb_build_object(
      'status', 'unchanged',
      'previous_status', v_prev,
      'credit_movement', NULL,
      'penalty', NULL
    );
  END IF;

  IF v_prev NOT IN ('confirmed', 'attended', 'no_show', 'excused') THEN
    RAISE EXCEPTION 'INVALID_SOURCE_STATUS';
  END IF;

  IF v_booking.debited_credit_id IS NOT NULL THEN
    IF p_new_status = 'excused' AND v_prev IN ('confirmed', 'attended', 'no_show') THEN
      UPDATE member_credits
      SET credits_used = GREATEST(credits_used - 1, 0),
          updated_at   = now()
      WHERE id = v_booking.debited_credit_id;
      v_credit_movement := 'refunded';
    ELSIF v_prev = 'excused' AND p_new_status IN ('attended', 'no_show') THEN
      UPDATE member_credits
      SET credits_used = LEAST(credits_used + 1, credits_total),
          updated_at   = now()
      WHERE id = v_booking.debited_credit_id;
      v_credit_movement := 'debited';
    END IF;
  END IF;

  IF p_new_status = 'no_show' THEN
    -- GYM-175 — politique de la salle, avec REPLI sur le comportement historique si la
    -- salle n'a pas de ligne noshow_rules (cas d'une salle neuve). Les COALESCE couvrent
    -- aussi les colonnes NULL d'une ligne partiellement remplie.
    SELECT COALESCE(nr.warning_1_at, 1),
           COALESCE(nr.warning_2_at, 2),
           COALESCE(nr.suspension_at, 3),
           COALESCE(nr.suspension_hours, 48),
           COALESCE(nr.escalated_suspension_hours, 336)
      INTO v_warning_1_at, v_warning_2_at, v_suspension_at, v_susp_hours, v_esc_hours
    FROM noshow_rules nr
    WHERE nr.gym_id = v_booking.gym_id;

    IF NOT FOUND THEN
      v_warning_1_at  := 1;
      v_warning_2_at  := 2;
      v_suspension_at := 3;
      v_susp_hours    := 48;
      v_esc_hours     := 336;
    END IF;

    UPDATE profiles SET noshow_count = COALESCE(noshow_count, 0) + 1, updated_at = now()
    WHERE id = v_booking.member_id
    RETURNING noshow_count INTO v_new_count;

    v_suspended_until := NULL;

    -- Évaluation du palier le PLUS HAUT au plus bas (cf. en-tête) : c'est ce qui permet
    -- à warning_2_at et suspension_at d'être égaux sans que la règle devienne ambiguë.
    IF v_new_count > v_suspension_at THEN
      v_suspended_until := now() + make_interval(hours => v_esc_hours);
      -- Type générique : la durée réelle est portée par expires_at (cf. en-tête).
      v_penalty_type    := 'suspension';
      v_notes           := (CASE WHEN v_new_count = 1 THEN '1er' ELSE v_new_count || 'e' END) || ' no-show — suspension ' || v_esc_hours || 'h.';
      UPDATE profiles SET suspended_until = v_suspended_until WHERE id = v_booking.member_id;

    ELSIF v_new_count = v_suspension_at THEN
      v_suspended_until := now() + make_interval(hours => v_susp_hours);
      -- Type générique : la durée réelle est portée par expires_at (cf. en-tête).
      v_penalty_type    := 'suspension';
      v_notes           := (CASE WHEN v_new_count = 1 THEN '1er' ELSE v_new_count || 'e' END) || ' no-show — suspension ' || v_susp_hours || 'h.';
      UPDATE profiles SET suspended_until = v_suspended_until WHERE id = v_booking.member_id;

    ELSIF v_new_count >= v_warning_2_at THEN
      v_penalty_type := 'warning_2';
      v_notes        := (CASE WHEN v_new_count = 1 THEN '1er' ELSE v_new_count || 'e' END) || ' no-show — 2e avertissement. À '
                        || v_suspension_at || ' : suspension de ' || v_susp_hours || 'h.';

    ELSIF v_new_count >= v_warning_1_at THEN
      v_penalty_type := 'warning_1';
      v_notes        := (CASE WHEN v_new_count = 1 THEN '1er' ELSE v_new_count || 'e' END) || ' no-show — 1er avertissement. À '
                        || v_suspension_at || ' : suspension de ' || v_susp_hours || 'h.';

    ELSE
      -- Compte inférieur au 1er seuil d'avertissement : aucune pénalité n'est tracée.
      -- Le compteur a malgré tout été incrémenté, l'absence est donc bien comptabilisée.
      v_penalty_type := NULL;
    END IF;

    IF v_penalty_type IS NOT NULL THEN
      INSERT INTO penalties (gym_id, member_id, booking_id, type, applied_at, expires_at, notes)
      VALUES (v_booking.gym_id, v_booking.member_id, p_booking_id,
              v_penalty_type, now(), v_suspended_until, v_notes);

      v_penalty := jsonb_build_object(
        'action', 'applied',
        'type', v_penalty_type,
        'noshow_count', v_new_count,
        -- GYM-175 — applied_at est exposé pour que la notification puisse calculer la
        -- durée réelle de la suspension sans dépendre du libellé du type.
        'applied_at', now(),
        'expires_at', v_suspended_until
      );
    ELSE
      v_penalty := jsonb_build_object(
        'action', 'none',
        'noshow_count', v_new_count
      );
    END IF;

  ELSIF v_prev = 'no_show' AND p_new_status IN ('attended', 'excused') THEN
    -- ── BLOC DE SYMÉTRIE — REPRIS À L'IDENTIQUE, NE PAS MODIFIER ──────────────
    -- Il annule une pénalité par booking_id et recalcule suspended_until à partir des
    -- pénalités restantes. Il ne lit ni le type ni les seuils : la configuration de la
    -- salle ne le concerne pas, et le rendre « configurable » casserait l'annulation
    -- d'une pénalité posée sous une ancienne politique.
    UPDATE profiles SET noshow_count = GREATEST(COALESCE(noshow_count, 0) - 1, 0), updated_at = now()
    WHERE id = v_booking.member_id
    RETURNING noshow_count INTO v_new_count;

    SELECT suspended_until INTO v_prev_suspended FROM profiles WHERE id = v_booking.member_id;

    DELETE FROM penalties
    WHERE booking_id = p_booking_id
    RETURNING expires_at INTO v_deleted_expires;

    IF v_deleted_expires IS NOT NULL
       AND v_prev_suspended IS NOT NULL
       AND v_prev_suspended = v_deleted_expires THEN
      UPDATE profiles
      SET suspended_until = (
            SELECT MAX(expires_at)
            FROM penalties
            WHERE member_id = v_booking.member_id
              AND expires_at IS NOT NULL
              AND expires_at > now()
          ),
          updated_at = now()
      WHERE id = v_booking.member_id;
    END IF;

    v_penalty := jsonb_build_object(
      'action', 'reverted',
      'noshow_count', v_new_count,
      'removed_expires_at', v_deleted_expires
    );
  END IF;

  IF p_new_status = 'attended' THEN
    v_checked_in_at := now();
    v_checked_method := 'manual';
  ELSE
    v_checked_in_at := NULL;
    v_checked_method := NULL;
  END IF;

  UPDATE bookings
  SET status            = p_new_status,
      checked_in_at     = v_checked_in_at,
      checked_in_method = v_checked_method,
      updated_at        = now()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'status', 'updated',
    'previous_status', v_prev,
    'credit_movement', v_credit_movement,
    'penalty', v_penalty
  );
END;
$function$;
