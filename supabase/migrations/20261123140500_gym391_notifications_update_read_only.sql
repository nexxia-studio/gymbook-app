-- GYM-391 — un membre ne peut plus modifier que `read` et `read_at` de ses messages.
--
-- 🔴 CE QUI ÉTAIT POSSIBLE. La règle « Marquer ses notifications comme lues » restreint la
-- LIGNE (member_id = auth.uid()), pas les COLONNES : une règle RLS ne filtre pas par
-- colonne. Avec le droit UPDATE posé sur toute la table, un membre pouvait réécrire le
-- titre, le corps, le type, `data`, `gym_id` et même `member_id` de ses propres messages,
-- donc fabriquer un « message de la salle », ou pousser une ligne dans la boîte d'un autre
-- (la règle n'avait pas de WITH CHECK).
--
-- Motif GYM-203 (20260729100000_gym203_profiles_column_whitelist.sql) : UPDATE est retiré
-- au niveau table, puis rendu colonne par colonne.
--
-- Vérifié avant d'écrire : au 23/11, aucun code du dépôt ne modifie `notifications` avec le
-- jeton d'un membre. Ni l'app mobile ni le dashboard ne lisent ou n'écrivent la table ; les
-- seules écritures viennent des Edge Functions, en service_role, que ces droits ne
-- concernent pas.
--
-- Rejouable : REVOKE et GRANT sont sans effet s'ils sont déjà posés.

REVOKE UPDATE ON public.notifications FROM anon;
REVOKE UPDATE ON public.notifications FROM authenticated;

GRANT UPDATE (read, read_at) ON public.notifications TO authenticated;

-- La règle gagne un WITH CHECK. Avec les droits par colonne, `member_id` n'est plus
-- modifiable, donc le contrôle ne peut plus échouer ; il reste là pour que la règle se
-- lise seule, et tienne si un droit de colonne était un jour rendu par erreur.
DROP POLICY IF EXISTS "Marquer ses notifications comme lues" ON public.notifications;
CREATE POLICY "Marquer ses notifications comme lues" ON public.notifications
  FOR UPDATE
  USING      (member_id = auth.uid())
  WITH CHECK (member_id = auth.uid());

COMMENT ON POLICY "Marquer ses notifications comme lues" ON public.notifications IS
  'GYM-391 : restreint la LIGNE (les siennes). Les COLONNES modifiables sont fixées par le '
  'GRANT UPDATE (read, read_at) TO authenticated de la même migration : une règle RLS ne '
  'filtre pas par colonne.';
