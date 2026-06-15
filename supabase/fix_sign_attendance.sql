-- ============================================================
-- Correctif : fix alias "at" → "tok" dans sign_attendance
-- Erreur : missing FROM-clause entry for table "at"
-- À exécuter dans Supabase > SQL Editor
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
  SELECT tok.session_id, s.session_date
    INTO v_session_id, v_date
    FROM attendance_tokens tok
    JOIN sessions s ON s.id = tok.session_id
   WHERE tok.token = p_token
     AND tok.expires_at > NOW();

  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_invalide');
  END IF;

  -- Verifier que la seance est aujourd'hui
  IF v_date <> (NOW() AT TIME ZONE 'Europe/Paris')::DATE THEN
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

GRANT EXECUTE ON FUNCTION sign_attendance(TEXT, UUID, TEXT) TO anon;
