-- ============================================================
-- Fonction : annuler un émargement (enseignant ou admin)
-- À exécuter dans Supabase > SQL Editor
-- ============================================================

CREATE OR REPLACE FUNCTION cancel_attendance(
  p_session_id UUID,
  p_student_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caller_email TEXT := auth.email();
BEGIN
  -- Vérifier que l'appelant est l'enseignant de la séance OU un admin
  IF NOT EXISTS (
    SELECT 1 FROM sessions s
    JOIN teachers t ON t.id = s.teacher_id
    WHERE s.id = p_session_id
      AND (t.email = v_caller_email OR EXISTS (
        SELECT 1 FROM teachers WHERE email = v_caller_email AND is_admin = TRUE
      ))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'non_autorise');
  END IF;

  DELETE FROM attendances
  WHERE session_id = p_session_id
    AND student_id = p_student_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'emargement_introuvable');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Accessible aux enseignants authentifiés uniquement (pas anon)
GRANT EXECUTE ON FUNCTION cancel_attendance(UUID, UUID) TO authenticated;
