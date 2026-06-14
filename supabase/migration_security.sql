-- ============================================================
-- Migration sécurité — à exécuter dans le SQL Editor Supabase
-- ============================================================

-- 1. Restreindre la lecture aux utilisateurs authentifiés
DROP POLICY IF EXISTS "read_modules"     ON modules;
DROP POLICY IF EXISTS "read_teachings"   ON teachings;
DROP POLICY IF EXISTS "read_teachers"    ON teachers;
DROP POLICY IF EXISTS "read_assignments" ON teaching_assignments;
DROP POLICY IF EXISTS "read_periods"     ON centre_periods;
DROP POLICY IF EXISTS "read_sessions"    ON sessions;

CREATE POLICY "read_modules"      ON modules              FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_teachings"    ON teachings            FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_teachers"     ON teachers             FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_assignments"  ON teaching_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_periods"      ON centre_periods       FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_sessions"     ON sessions             FOR SELECT TO authenticated USING (true);

-- 2. Demandes de modification : vérifier que la séance appartient à l'enseignant
DROP POLICY IF EXISTS "insert_own_requests" ON modification_requests;

CREATE POLICY "insert_own_requests" ON modification_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    teacher_id IN (SELECT id FROM teachers WHERE email = auth.email())
    AND session_id IN (
      SELECT id FROM sessions WHERE teacher_id IN (
        SELECT id FROM teachers WHERE email = auth.email()
      )
    )
  );

-- 3. Contraintes sur les séances
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS chk_times;
ALTER TABLE sessions ADD CONSTRAINT chk_times CHECK (start_time < end_time);

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS chk_date_range;
ALTER TABLE sessions ADD CONSTRAINT chk_date_range
  CHECK (session_date >= '2026-08-31' AND session_date <= '2027-07-31');

-- 4. Fonction RPC accessible sans authentification (anon)
--    Permet de vérifier qu'un email est dans la table teachers
--    avant d'envoyer l'OTP, sans exposer la liste complète des emails.
CREATE OR REPLACE FUNCTION is_teacher_email(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM teachers WHERE lower(email) = lower(p_email)
  );
$$;

-- Autoriser l'appel depuis le client anonyme (non connecté)
GRANT EXECUTE ON FUNCTION is_teacher_email(TEXT) TO anon;
