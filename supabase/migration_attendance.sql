-- ============================================================
-- Migration : module emargement
-- ============================================================

-- Table etudiants (pre-enregistres par l'admin)
CREATE TABLE students (
  id   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- Table tokens QR (un actif par seance, expire toutes les 2 min)
CREATE TABLE attendance_tokens (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table emargements (un seul par etudiant par seance)
CREATE TABLE attendances (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      UUID REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,
  student_id      UUID REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  signed_at       TIMESTAMPTZ DEFAULT NOW(),
  signature_data  TEXT,
  signed_by_admin BOOLEAN DEFAULT FALSE,
  UNIQUE(session_id, student_id)
);

-- RLS
ALTER TABLE students           ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_tokens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendances        ENABLE ROW LEVEL SECURITY;

-- Etudiants : lecture publique (dropdown sur attendance.html sans auth)
CREATE POLICY "read_students_public" ON students
  FOR SELECT TO anon, authenticated USING (true);

-- Etudiants : ecriture admin uniquement
CREATE POLICY "admin_students" ON students FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE));

-- Tokens : lecture + ecriture pour enseignants authentifies
CREATE POLICY "teacher_manage_tokens" ON attendance_tokens FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email()))
  WITH CHECK (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email()));

-- Emargements : lecture par l'enseignant de ses propres seances
CREATE POLICY "teacher_read_own_attendances" ON attendances FOR SELECT TO authenticated
  USING (
    session_id IN (
      SELECT id FROM sessions
       WHERE teacher_id IN (SELECT id FROM teachers WHERE email = auth.email())
    )
  );

-- Emargements : admin acces complet
CREATE POLICY "admin_write_attendances" ON attendances FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE));

-- ============================================================
-- RPC : recuperer infos de seance depuis un token (accessible anon)
-- ============================================================
CREATE OR REPLACE FUNCTION get_session_info_from_token(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'session_id',     s.id,
    'session_date',   s.session_date,
    'start_time',     s.start_time,
    'end_time',       s.end_time,
    'teaching_title', COALESCE(t.title, 'Divers'),
    'module_code',    COALESCE(m.code, ''),
    'teacher_name',   te.name,
    'session_type',   s.session_type
  ) INTO v_result
  FROM attendance_tokens at
  JOIN sessions s  ON s.id  = at.session_id
  LEFT JOIN teachings t  ON t.id  = s.teaching_id
  LEFT JOIN modules m    ON m.id  = t.module_id
  JOIN teachers te ON te.id = s.teacher_id
  WHERE at.token = p_token
    AND at.expires_at > NOW();

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('error', 'token_invalide');
  END IF;

  RETURN v_result;
END;
$$;

-- ============================================================
-- RPC : enregistrer un emargement (accessible anon, logique serveur)
-- ============================================================
CREATE OR REPLACE FUNCTION sign_attendance(
  p_token      TEXT,
  p_student_id UUID,
  p_signature  TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_session_id UUID;
  v_date       DATE;
  v_inserted   BIGINT := 0;
BEGIN
  -- Valider token (non expire)
  SELECT at.session_id, s.session_date
    INTO v_session_id, v_date
    FROM attendance_tokens at
    JOIN sessions s ON s.id = at.session_id
   WHERE at.token = p_token
     AND at.expires_at > NOW();

  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_invalide');
  END IF;

  -- Verifier que la seance est aujourd'hui
  IF v_date <> CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mauvaise_date');
  END IF;

  -- Verifier que l'etudiant existe
  IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'etudiant_inconnu');
  END IF;

  -- Inserer (ON CONFLICT pour idempotence)
  INSERT INTO attendances (session_id, student_id, signature_data)
  VALUES (v_session_id, p_student_id, p_signature)
  ON CONFLICT (session_id, student_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'deja_emarge');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Permissions d'execution pour anon
GRANT EXECUTE ON FUNCTION get_session_info_from_token(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION sign_attendance(TEXT, UUID, TEXT) TO anon;
