-- GYM-150 : mapping OAuth du nom/prénom dans handle_new_user().
-- ⚠️ DÉJÀ APPLIQUÉE staging + prod via le cockpit — ce fichier ne sert QU'AU
-- versionnement repo. CREATE OR REPLACE → ré-exécution idempotente et sans effet
-- si déjà en place.
--
-- Motif : à la création d'un compte via OAuth (Apple/Google), Supabase ne pose pas
-- 'first_name'/'last_name' mais 'given_name'/'family_name' (ou 'full_name'). Sans
-- ce mapping, le profil est créé sans nom. Seules les colonnes first_name/last_name
-- changent ; le reste du corps de la fonction est STRICTEMENT identique à l'existant.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  meta jsonb := NEW.raw_user_meta_data;
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    role,
    gym_id,
    first_name,
    last_name,
    phone,
    preferred_language,
    privacy_policy_accepted_at,
    terms_accepted_at,
    marketing_consent,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'member'),
    CASE
      WHEN NEW.raw_user_meta_data->>'gym_id' IS NOT NULL
      THEN (NEW.raw_user_meta_data->>'gym_id')::UUID
      ELSE NULL
    END,
    -- GYM-150 — mapping OAuth : first_name / given_name / 1er mot de full_name
    COALESCE(NULLIF(meta->>'first_name',''), NULLIF(meta->>'given_name',''),
             NULLIF(split_part(meta->>'full_name',' ',1),'')),
    -- GYM-150 — mapping OAuth : last_name / family_name / reste de full_name
    COALESCE(NULLIF(meta->>'last_name',''), NULLIF(meta->>'family_name',''),
             NULLIF(btrim(substr(meta->>'full_name',
             length(split_part(meta->>'full_name',' ',1))+1)),'')),
    NEW.raw_user_meta_data->>'phone',
    COALESCE(NEW.raw_user_meta_data->>'preferred_language', 'fr'),
    CASE
      WHEN NEW.raw_user_meta_data->>'privacy_policy_accepted' = 'true'
      THEN now() ELSE NULL
    END,
    CASE
      WHEN NEW.raw_user_meta_data->>'terms_accepted' = 'true'
      THEN now() ELSE NULL
    END,
    COALESCE(
      (NEW.raw_user_meta_data->>'marketing_consent')::boolean,
      false
    ),
    now(),
    now()
  );
  RETURN NEW;
END;
$$;
