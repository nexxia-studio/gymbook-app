-- GYM-93 — Le rappel « la veille » est ancré sur le fuseau de la SALLE.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ CE QUI A ÉTÉ VÉRIFIÉ AVANT D'ÉCRIRE : LE RAPPEL N'EST PAS MANQUÉ.
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Le ticket redoutait qu'aucun rappel ne parte la nuit du 25 octobre. Simulation exécutée
-- (cron toutes les 15 min, fenêtre glissante de 60 min), sur un cours du dimanche 09:30 :
--
--   18/10 (semaine ordinaire) : 5 ticks attrapent le créneau -> ENVOYÉ, à 09:00 la veille
--   25/10 (nuit de bascule)   : 5 ticks attrapent le créneau -> ENVOYÉ, à 10:00 la veille
--   01/11 (après bascule)     : 5 ticks attrapent le créneau -> ENVOYÉ, à 09:00 la veille
--
-- Aucun créneau ne peut « sauter » la fenêtre : elle glisse à la vitesse du temps réel,
-- fait 60 minutes de large, et le cron l'échantillonne toutes les 15. L'arithmétique
-- absolue sur `timestamptz` est insensible au changement d'heure — c'est précisément
-- pourquoi elle avait été choisie.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- CE QUI EST RÉELLEMENT FAUX, ET QUE CETTE MIGRATION CORRIGE
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Le rappel DÉRIVE D'UNE HEURE SUR L'HORLOGE. Pour un cours du dimanche 09:30, il arrive
-- habituellement à 09:00 la veille ; la nuit du 25 octobre, à 10:00. Vingt-quatre heures
-- RÉELLES ne font pas vingt-quatre heures MURALES quand l'horloge recule.
--
-- Or « 24 h » n'est pas une durée dans l'esprit du membre : c'est « la veille, à la même
-- heure ». Un rappel qui glisse d'une heure deux fois par an est le genre de détail qui
-- fait douter du produit sans qu'on sache le nommer.
--
-- DÉCISION (cockpit) : ANCRER LA FENÊTRE SUR LE FUSEAU DU GYM plutôt qu'élargir la
-- tolérance. Élargir à ±35 min traiterait le symptôme deux nuits par an et laisserait le
-- calcul faux le reste du temps ; ancrer est juste en permanence.
--
-- ⚠️ LE RAPPEL 2 h RESTE EN TEMPS ABSOLU, ET C'EST VOULU. « Ton cours commence dans
-- 2 heures » EST une durée : l'ancrer sur l'horloge murale enverrait, la nuit de la
-- bascule, un rappel 3 heures réelles avant le cours. Même raisonnement que les
-- `interval '48 hours'` des suspensions, laissés en l'état par décision produit.
--
-- ⚠️ ANTI-DRIFT : corps recopié depuis la définition du dépôt (baseline_prod, jamais
-- redéfinie depuis — les trois migrations qui la mentionnent ne touchent que search_path,
-- les ACL et des commentaires). La vérification en base live n'a pas pu être faite dans
-- cette session : le MCP Supabase demande une autorisation OAuth. SEUL le prédicat de
-- fenêtre du bloc 24 h est modifié ; tout le reste est à l'identique.
--
-- ⚠️ L'IDEMPOTENCE N'EST PAS TOUCHÉE. Elle ne repose PAS sur la fenêtre mais sur le
-- marqueur `bookings.reminder_24h_sent_at IS NULL`, posé par `mark_reminder_sent` après
-- envoi. Ce prédicat est conservé mot pour mot. Il couvre d'ailleurs un cas propre à
-- l'ancrage mural : la nuit du 25 octobre, l'heure locale 02:00–03:00 est vécue DEUX FOIS,
-- donc une fenêtre murale peut matcher deux fois — le marqueur fait que le membre ne
-- reçoit qu'un seul message. Sans lui, ancrer aurait introduit un doublon.
--
-- ⚠️ PAS DE TROU AU PASSAGE À L'HEURE D'ÉTÉ NON PLUS. La comparaison porte sur des
-- `timestamp` SANS fuseau (résultat de `AT TIME ZONE`), et un timestamp naïf n'a ni saut
-- ni heure manquante : l'heure locale 02:30 du dernier dimanche de mars, qui n'existe pas
-- sur l'horloge, existe bien comme valeur comparable. Aucun créneau ne peut tomber dans un
-- « trou » de la fenêtre.

CREATE OR REPLACE FUNCTION public.get_pending_reminders()
RETURNS TABLE(booking_id uuid, member_id uuid, gym_id uuid, slot_id uuid, slot_starts_at timestamp with time zone, activity_name text, coach_name text, member_email text, member_first_name text, push_token text, reminder_type text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- ── Rappels 24h — ANCRÉS SUR L'HORLOGE DE LA SALLE (GYM-93) ──────────────
  -- Fenêtre : cours dont l'heure murale « moins 24 h » tombe à ±30 min de l'heure
  -- murale courante. Le membre reçoit donc toujours son rappel la veille à la même
  -- heure, que l'horloge ait reculé ou non dans l'intervalle.
  RETURN QUERY
  SELECT
    b.id,
    b.member_id,
    b.gym_id,
    b.slot_id,
    s.starts_at,
    a.name::text,
    COALESCE(c.name, '')::text,
    p.email,
    p.first_name,
    p.push_token,
    '24h'::text
  FROM bookings b
  JOIN time_slots s  ON s.id = b.slot_id
  JOIN activities  a ON a.id = s.activity_id
  LEFT JOIN coaches c ON c.id = s.coach_id
  JOIN profiles p    ON p.id = b.member_id
  -- GYM-93 — SEULE JOINTURE AJOUTÉE : le fuseau vient de la salle du CRÉNEAU, jamais
  -- d'une constante. COALESCE parce que `timezone` est nullable en base ; une salle sans
  -- fuseau renseigné retombe sur Europe/Brussels et garde le comportement d'avant.
  JOIN nexxia_gyms g ON g.id = s.gym_id
  WHERE b.status               = 'confirmed'
    AND b.reminder_24h_sent_at IS NULL
    AND (s.starts_at AT TIME ZONE COALESCE(g.timezone, 'Europe/Brussels')) - INTERVAL '24 hours'
        BETWEEN (NOW() AT TIME ZONE COALESCE(g.timezone, 'Europe/Brussels')) - INTERVAL '30 minutes'
            AND (NOW() AT TIME ZONE COALESCE(g.timezone, 'Europe/Brussels')) + INTERVAL '30 minutes'
    -- Respecter les préférences de notification du membre
    AND (
      p.notification_preferences IS NULL
      OR (p.notification_preferences->>'reminders')::boolean IS NOT FALSE
    );

  -- ── Rappels 2h — TEMPS ABSOLU, INCHANGÉ ──────────────────────────────────
  -- « Dans 2 heures » est une DURÉE : l'ancrer sur l'horloge murale enverrait, la nuit du
  -- 25 octobre, un rappel 3 heures réelles avant le cours. Ce bloc est recopié à
  -- l'identique, y compris sa fenêtre.
  RETURN QUERY
  SELECT
    b.id,
    b.member_id,
    b.gym_id,
    b.slot_id,
    s.starts_at,
    a.name::text,
    COALESCE(c.name, '')::text,
    p.email,
    p.first_name,
    p.push_token,
    '2h'::text
  FROM bookings b
  JOIN time_slots s  ON s.id = b.slot_id
  JOIN activities  a ON a.id = s.activity_id
  LEFT JOIN coaches c ON c.id = s.coach_id
  JOIN profiles p    ON p.id = b.member_id
  WHERE b.status              = 'confirmed'
    AND b.reminder_2h_sent_at IS NULL
    AND s.starts_at BETWEEN NOW() + INTERVAL '1 hour 30 minutes'
                        AND NOW() + INTERVAL '2 hours 30 minutes'
    AND (
      p.notification_preferences IS NULL
      OR (p.notification_preferences->>'reminders')::boolean IS NOT FALSE
    );
END;
$$;

-- Droits recopiés du durcissement GYM-hardening (20260720161810) : un CREATE OR REPLACE
-- les conserve, mais les réaffirmer coûte une ligne et interdit toute dérive silencieuse.
REVOKE ALL ON FUNCTION public.get_pending_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_reminders() TO service_role;

COMMENT ON FUNCTION public.get_pending_reminders() IS
  'GYM-32 / GYM-93 — bookings à rappeler. Rappel 24 h ANCRÉ SUR L''HORLOGE DE LA SALLE '
  '(nexxia_gyms.timezone) : le membre le reçoit la veille à la même heure murale, y '
  'compris la nuit du changement d''heure. Rappel 2 h laissé en temps ABSOLU — « dans '
  '2 heures » est une durée. Idempotence portée par reminder_24h_sent_at / '
  'reminder_2h_sent_at, jamais par la fenêtre.';
