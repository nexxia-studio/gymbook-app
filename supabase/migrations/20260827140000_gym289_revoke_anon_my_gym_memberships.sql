-- ═══════════════════════════════════════════════════════════════════════════════════════
-- GYM-289 correctif — my_gym_memberships() : retirer le droit d'exécution à `anon`.
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- 🔴 CE QUI ÉTAIT FAUX : LA POSTURE, PAS LE COMPORTEMENT.
--
-- La migration précédente annonçait « GRANT à authenticated seulement » et faisait :
--     revoke execute on function … from public;
--     grant  execute on function … to authenticated;
-- Mesuré après application en staging :
--     has_function_privilege('anon', 'my_gym_memberships()', 'EXECUTE')  →  TRUE
--
-- ⚠️ `PUBLIC` ET `anon` NE SONT PAS LA MÊME CHOSE. `PUBLIC` est le pseudo-rôle « tout le
-- monde » ; `anon` est un RÔLE RÉEL, avec ses propres droits. Le revoke a bien fait son
-- travail sur le premier — et n'a jamais touché le second.
--
-- D'OÙ VIENT ALORS LE DROIT D'`anon` ? De privilèges par défaut posés à l'échelle du
-- schéma, relevés en base :
--     ALTER DEFAULT PRIVILEGES … IN SCHEMA public GRANT EXECUTE ON FUNCTIONS
--       TO postgres, anon, authenticated, service_role
-- (posés par `postgres` ET par `supabase_admin`). Autrement dit : dans ce projet, TOUTE
-- fonction créée dans `public` naît exécutable par `anon`, et aucun `revoke … from public`
-- n'y changera quoi que ce soit. Il faut nommer le rôle.
--
-- ⚠️ AUCUN DANGER N'ÉTAIT EN COURS, ET CE N'EST PAS LA QUESTION. La fonction filtre sur
-- `auth.uid()` : appelée sans session, elle rend un ensemble vide — vérifié. Ce qui se
-- corrige ici, c'est l'écart entre ce que le fichier ANNONCE et ce que la base FAIT. Un
-- écart de cette nature ne se voit pas ; il se recopie. La prochaine fonction écrite sur
-- ce modèle pourrait, elle, rendre quelque chose à un appelant anonyme.

revoke execute on function public.my_gym_memberships() from anon;

comment on function public.my_gym_memberships() is
  'GYM-289 — appartenances du membre appelant (auth.uid()), avec identité visuelle de '
  'chaque salle et drapeau « salle active » lu dans profiles.gym_id. Aucun paramètre : '
  'rien à falsifier. EXECUTE retiré à anon (les privilèges par défaut du schéma public le '
  'lui accordent à la création) — voir 20260827140000.';

-- ── CE QUI A ÉTÉ VÉRIFIÉ AU PASSAGE, ET QU'IL NE FAUT SURTOUT PAS « CORRIGER » ─────────
--
-- · search_gyms, public_gym_branding, public_gym_schedule, public_gym_legal_identity :
--   `anon` = TRUE. C'EST VOULU — ce sont les fonctions publiques du lot 1, elles servent
--   l'app AVANT connexion. Leur posture et leur réalité concordent.
--
-- · switch_active_gym : `anon` = FALSE. Propre, parce que sa migration écrit le revoke en
--   nommant les deux : `REVOKE … FROM PUBLIC, anon`. C'est le modèle à suivre.
--
-- · get_my_gym_id, get_my_role, is_gym_admin, is_super_admin : `anon` = TRUE, et ON N'Y
--   TOUCHE PAS. Elles sont appelées DEPUIS LES POLICIES RLS, dont l'expression est évaluée
--   avec le rôle de l'appelant. Retirer EXECUTE à `anon` transformerait le `false`
--   silencieux qu'elles rendent aujourd'hui en ERREUR DE PERMISSION sur chaque table dont
--   la policy les invoque — c'est-à-dire casser l'accès anonyme au lieu de le durcir.
--   Le même symptôme, une conclusion opposée : la règle n'est pas « anon doit être
--   révoqué partout », elle est « la posture doit dire le réel ».
