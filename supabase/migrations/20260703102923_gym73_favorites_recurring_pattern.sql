-- GYM-73 : refonte favorites en modèle "motif récurrent" (activité + jour + heure locale)
-- Aucune donnée à préserver (favoris volatils Zustand, table prod vide). Remplacement structurel.

DROP TABLE IF EXISTS public.favorites CASCADE;

CREATE TABLE public.favorites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id       uuid NOT NULL REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES public.profiles(id)    ON DELETE CASCADE,
  activity_id  uuid NOT NULL REFERENCES public.activities(id)  ON DELETE CASCADE,
  day_of_week  smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  local_time   time NOT NULL,
  added_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, activity_id, day_of_week, local_time)
);

CREATE INDEX idx_favorites_member ON public.favorites(member_id);
CREATE INDEX idx_favorites_match  ON public.favorites(gym_id, activity_id, day_of_week, local_time);

ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Gérer ses propres favoris"
  ON public.favorites FOR ALL
  USING (member_id = auth.uid())
  WITH CHECK (member_id = auth.uid());

-- Cron obsolète (favori récurrent n'expire pas)
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-expired-favorites');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DROP FUNCTION IF EXISTS public.cleanup_expired_favorites();
