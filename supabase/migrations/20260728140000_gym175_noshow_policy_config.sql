-- GYM-175 (volet 1) : mark_attendance_atomic lit la politique no-show de la salle.
--
-- LA TABLE DE CONFIGURATION EXISTE DÉJÀ. noshow_rules porte une ligne complète pour
-- Dopamine depuis l'origine et n'est lue par ABSOLUMENT RIEN : les implémentations
-- successives ont recopié les valeurs en dur. Ce volet la branche enfin.
--
-- ─── POLITIQUE À TROIS PALIERS (les trois seuils sont utilisés) ─────────────
-- Règle évaluée du palier le PLUS HAUT au plus bas, pour que les seuils puissent être
-- égaux entre eux sans ambiguïté (chez Dopamine warning_2_at = suspension_at = 2) :
--     count >  suspension_at → suspension de escalated_suspension_hours
--     count =  suspension_at → suspension de suspension_hours
--     count >= warning_2_at  → 2e avertissement  (type 'warning_2')
--     count >= warning_1_at  → 1er avertissement (type 'warning_1')
--     sinon                  → aucune pénalité
--
-- L'ordre d'évaluation est ce qui rend le paramétrage lisible : une salle qui veut
-- « avertir, avertir, suspendre » pose w1=1, w2=2, suspension_at=3 ; une salle plus
-- stricte pose w2 = suspension_at et le 2e avertissement n'a jamais lieu.
--
-- NON-RÉGRESSION 1 — Dopamine (w1=1, w2=2, susp=2, 48, 336) :
--     count=1 → 1 < 2, 1 < 2, 1 >= 1 → avertissement          (identique à aujourd'hui)
--     count=2 → 2 = 2                → suspension 48h         (identique à aujourd'hui)
--     count≥3 → 3 > 2                → suspension 336h        (identique à aujourd'hui)
--
-- NON-RÉGRESSION 2 — salle SANS ligne, replis = DÉFAUTS DU SCHÉMA
-- (w1=1, w2=2, susp=3, 48, 336) :
--     count=1 → avertissement · count=2 → 2e avertissement
--     count=3 → suspension 48h · count≥4 → suspension 336h
--     « Pas de ligne » signifie donc « politique par défaut », et non « politique de
--     Dopamine » : les replis suivent les DEFAULT de colonne, pas les valeurs d'une salle.
--
-- ─── LIBELLÉS DE PÉNALITÉ ───────────────────────────────────────────────────
-- Avertissements : 'warning_1' et 'warning_2' (déjà autorisés par le CHECK) remplacent le
-- 'warning' générique — le palier atteint devient lisible dans l'historique.
--
-- Suspensions : 'suspension_48h' et 'suspension_2w' sont CONSERVÉS tels quels. Ils sont
-- désormais de simples étiquettes, sans conséquence : le commit précédent de ce lot a
-- rendu la notification indépendante du libellé (la durée annoncée se calcule sur
-- expires_at − applied_at). Plus AUCUN code ne lit penalties.type. Les renommer serait
-- donc possible, mais gratuit et coûteux en données historiques — reporté.
-- ⚠️ 'warning' reste produit par un AUTRE émetteur : cancel-booking insère ce type pour
-- les annulations tardives. Les trois valeurs coexisteront dans penalties ; tout futur
-- consommateur devra les traiter ensemble.
--
-- ─── Constats base live (Règle Zéro) ────────────────────────────────────────
--   - mark_attendance_atomic recopiée de sa définition LIVE (postérieure à GYM-174).
--   - CHECK penalties_type_check réel = ('warning_1','warning_2','suspension','reset',
--     'warning','suspension_48h','suspension_2w') → les libellés conservés sont valides.
--   - Le bloc de SYMÉTRIE (annulation d'un no_show) est repris À L'IDENTIQUE : il
--     supprime la pénalité par booking_id et recalcule suspended_until sans jamais
--     regarder le type ni les seuils. Aucune raison d'y toucher.
--   - DEFAULT du schéma : warning_1_at 1 · warning_2_at 2 · suspension_at 3 ·
--     suspension_hours 48 · escalated_suspension_hours 336. Les REPLIS ci-dessous les
--     reprennent EXACTEMENT : une salle sans ligne applique la politique par défaut.

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
      -- Libellé conservé (cf. en-tête) : palier aggravé.
      v_penalty_type    := 'suspension_2w';
      v_notes           := v_new_count || 'ème no-show — suspension ' || v_esc_hours || 'h.';
      UPDATE profiles SET suspended_until = v_suspended_until WHERE id = v_booking.member_id;

    ELSIF v_new_count = v_suspension_at THEN
      v_suspended_until := now() + make_interval(hours => v_susp_hours);
      -- Libellé conservé (cf. en-tête) : 1er palier de suspension.
      v_penalty_type    := 'suspension_48h';
      v_notes           := v_new_count || 'ème no-show — suspension ' || v_susp_hours || 'h.';
      UPDATE profiles SET suspended_until = v_suspended_until WHERE id = v_booking.member_id;

    ELSIF v_new_count >= v_warning_2_at THEN
      v_penalty_type := 'warning_2';
      v_notes        := v_new_count || 'ème no-show — 2e avertissement. À '
                        || v_suspension_at || ' : suspension de ' || v_susp_hours || 'h.';

    ELSIF v_new_count >= v_warning_1_at THEN
      v_penalty_type := 'warning_1';
      v_notes        := v_new_count || 'ème no-show — 1er avertissement. À '
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
