-- GYM-175 (volet 1) : mark_attendance_atomic lit la politique no-show de la salle.
--
-- LA TABLE DE CONFIGURATION EXISTE DÉJÀ. noshow_rules porte une ligne complète pour
-- Dopamine depuis l'origine et n'est lue par ABSOLUMENT RIEN : les implémentations
-- successives ont recopié les valeurs en dur. Ce volet la branche enfin.
--
-- ─── INTERPRÉTATION DES SEUILS (imposée — levée d'ambiguïté) ─────────────────
-- warning_2_at et suspension_at valent tous deux 2 chez Dopamine, ce qui rendait la
-- lecture des seuils ambiguë. Règle retenue, fondée sur le SEUL suspension_at :
--     count <  suspension_at  → avertissement (aucune suspension)
--     count =  suspension_at  → suspension de suspension_hours
--     count >  suspension_at  → suspension de escalated_suspension_hours
--
-- NON-RÉGRESSION avec les valeurs Dopamine (suspension_at=2, 48h, 336h) :
--     count=1 → 1 < 2 → avertissement            (identique à aujourd'hui)
--     count=2 → 2 = 2 → suspension 48h           (identique à aujourd'hui)
--     count≥3 → 3 > 2 → suspension 336h (2 sem.) (identique à aujourd'hui)
-- Le comportement est donc STRICTEMENT inchangé tant que la salle ne modifie rien.
--
-- ⚠️ warning_1_at et warning_2_at deviennent INERTES sous cette interprétation : le
-- premier avertissement tombe mécaniquement à la première absence, et tout compte
-- inférieur à suspension_at donne un avertissement. Ils sont laissés en base (aucune
-- donnée perdue) mais ne sont volontairement PAS lus ici, pour ne pas laisser croire
-- qu'ils pilotent quelque chose. Voir compte-rendu.
--
-- ─── LIBELLÉS DE PÉNALITÉ : VOLONTAIREMENT INCHANGÉS ────────────────────────
-- Le passage aux types génériques 'warning'/'suspension' a été ÉCARTÉ : une dépendance
-- réelle existe. supabase/functions/mark-attendance/index.ts déduit le texte des
-- notifications du libellé (`const isLong = penaltyType === 'suspension_2w'`), pour le
-- push comme pour l'email. Basculer sur 'suspension' ferait annoncer « 48h » à tout
-- membre suspendu, y compris deux semaines. On conserve donc EXACTEMENT le mapping
-- actuel : 'warning' | 'suspension_48h' (1er palier) | 'suspension_2w' (palier aggravé).
-- ⚠️ Conséquence à traiter (voir compte-rendu) : dès qu'une salle configure une durée
-- autre que 48h/336h, le libellé et le texte de notification deviennent mensongers.
--
-- ─── Constats base live (Règle Zéro) ────────────────────────────────────────
--   - mark_attendance_atomic recopiée de sa définition LIVE (postérieure à GYM-174).
--   - CHECK penalties_type_check réel = ('warning_1','warning_2','suspension','reset',
--     'warning','suspension_48h','suspension_2w') → les libellés conservés sont valides.
--   - Le bloc de SYMÉTRIE (annulation d'un no_show) est repris À L'IDENTIQUE : il
--     supprime la pénalité par booking_id et recalcule suspended_until sans jamais
--     regarder le type ni les seuils. Aucune raison d'y toucher.
--   - ⚠️ Le DEFAULT du schéma pour suspension_at vaut 3, alors que Dopamine utilise 2 :
--     les REPLIS ci-dessous suivent le comportement RÉEL (2), pas le DEFAULT de colonne.

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
    SELECT COALESCE(nr.suspension_at, 2),
           COALESCE(nr.suspension_hours, 48),
           COALESCE(nr.escalated_suspension_hours, 336)
      INTO v_suspension_at, v_susp_hours, v_esc_hours
    FROM noshow_rules nr
    WHERE nr.gym_id = v_booking.gym_id;

    IF NOT FOUND THEN
      v_suspension_at := 2;
      v_susp_hours    := 48;
      v_esc_hours     := 336;
    END IF;

    UPDATE profiles SET noshow_count = COALESCE(noshow_count, 0) + 1, updated_at = now()
    WHERE id = v_booking.member_id
    RETURNING noshow_count INTO v_new_count;

    v_suspended_until := NULL;

    IF v_new_count < v_suspension_at THEN
      v_penalty_type := 'warning';
      v_notes        := v_new_count || 'ème no-show — avertissement. À ' || v_suspension_at
                        || ' : suspension de ' || v_susp_hours || 'h.';
    ELSIF v_new_count = v_suspension_at THEN
      v_suspended_until := now() + make_interval(hours => v_susp_hours);
      -- Libellé conservé (cf. en-tête) : 1er palier de suspension.
      v_penalty_type    := 'suspension_48h';
      v_notes           := v_new_count || 'ème no-show — suspension ' || v_susp_hours || 'h.';
      UPDATE profiles SET suspended_until = v_suspended_until WHERE id = v_booking.member_id;
    ELSE
      v_suspended_until := now() + make_interval(hours => v_esc_hours);
      -- Libellé conservé (cf. en-tête) : palier aggravé.
      v_penalty_type    := 'suspension_2w';
      v_notes           := v_new_count || 'ème no-show — suspension ' || v_esc_hours || 'h.';
      UPDATE profiles SET suspended_until = v_suspended_until WHERE id = v_booking.member_id;
    END IF;

    INSERT INTO penalties (gym_id, member_id, booking_id, type, applied_at, expires_at, notes)
    VALUES (v_booking.gym_id, v_booking.member_id, p_booking_id,
            v_penalty_type, now(), v_suspended_until, v_notes);

    v_penalty := jsonb_build_object(
      'action', 'applied',
      'type', v_penalty_type,
      'noshow_count', v_new_count,
      'expires_at', v_suspended_until
    );

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
