-- ============================================================
-- Schéma Supabase — Planning DSP Préleveur en Milieu Naturel
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Périodes en centre (semaines où les étudiants sont à l'INTECHMER)
CREATE TABLE centre_periods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  week_name TEXT NOT NULL UNIQUE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL
);

-- Modules de la formation
CREATE TABLE modules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  ects INTEGER,
  sort_order INTEGER DEFAULT 0
);

-- Enseignements (sous-thèmes au sein d'un module)
CREATE TABLE teachings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  module_id UUID REFERENCES modules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- Enseignants
CREATE TABLE teachers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  teacher_type TEXT NOT NULL CHECK (teacher_type IN ('CNAM', 'Ext')),
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Affectations (enseignant → enseignement + heures prévues)
CREATE TABLE teaching_assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  teaching_id UUID REFERENCES teachings(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
  cm_hours NUMERIC(5,1) DEFAULT 0,
  td_hours NUMERIC(5,1) DEFAULT 0,
  tp_hours NUMERIC(5,1) DEFAULT 0,
  UNIQUE(teaching_id, teacher_id)
);

-- Séances planifiées
CREATE TABLE sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  teaching_id UUID REFERENCES teachings(id) ON DELETE SET NULL,
  teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE NOT NULL,
  session_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('CM', 'TD', 'TP', 'Divers')),
  room TEXT DEFAULT '',
  student_group TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_times CHECK (start_time < end_time),
  CONSTRAINT chk_date_range CHECK (session_date >= '2026-08-31' AND session_date <= '2027-07-31')
);

-- Demandes de modification / suppression
CREATE TABLE modification_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('modify', 'delete')),
  old_data JSONB NOT NULL,
  new_data JSONB,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger updated_at sur sessions
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================
ALTER TABLE modules              ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE teaching_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE modification_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE centre_periods       ENABLE ROW LEVEL SECURITY;

-- Lecture restreinte aux utilisateurs authentifiés
CREATE POLICY "read_modules"      ON modules              FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_teachings"    ON teachings            FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_teachers"     ON teachers             FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_assignments"  ON teaching_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_periods"      ON centre_periods       FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_sessions"     ON sessions             FOR SELECT TO authenticated USING (true);

-- Enseignants : insérer leurs propres séances
CREATE POLICY "insert_own_sessions" ON sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    teacher_id IN (SELECT id FROM teachers WHERE email = auth.email())
  );

-- Enseignants : insérer des demandes de modification (uniquement sur leurs propres séances)
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

-- Modification requests : lecture de ses propres demandes (+ admin voit tout)
CREATE POLICY "read_requests" ON modification_requests
  FOR SELECT TO authenticated
  USING (
    teacher_id IN (SELECT id FROM teachers WHERE email = auth.email())
    OR EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE)
  );

-- Admin : accès complet à toutes les tables
CREATE POLICY "admin_sessions"     ON sessions              FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE));

CREATE POLICY "admin_teachers"     ON teachers              FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE));

CREATE POLICY "admin_requests"     ON modification_requests FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE));

CREATE POLICY "admin_modules"      ON modules               FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE));

CREATE POLICY "admin_teachings"    ON teachings             FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE));

CREATE POLICY "admin_assignments"  ON teaching_assignments  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE));

CREATE POLICY "admin_periods"      ON centre_periods        FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM teachers WHERE email = auth.email() AND is_admin = TRUE));

-- ============================================================
-- DONNÉES INITIALES
-- ============================================================

-- Périodes en centre (23 semaines — année 2026-2027)
INSERT INTO centre_periods (week_name, start_date, end_date) VALUES
  ('Semaine_36-2026', '2026-08-31', '2026-09-04'),
  ('Semaine_37-2026', '2026-09-07', '2026-09-11'),
  ('Semaine_40-2026', '2026-09-28', '2026-10-02'),
  ('Semaine_41-2026', '2026-10-05', '2026-10-09'),
  ('Semaine_44-2026', '2026-10-26', '2026-10-30'),
  ('Semaine_45-2026', '2026-11-02', '2026-11-06'),
  ('Semaine_48-2026', '2026-11-23', '2026-11-27'),
  ('Semaine_49-2026', '2026-11-30', '2026-12-04'),
  ('Semaine_01-2027', '2027-01-04', '2027-01-08'),
  ('Semaine_02-2027', '2027-01-11', '2027-01-15'),
  ('Semaine_05-2027', '2027-02-01', '2027-02-05'),
  ('Semaine_06-2027', '2027-02-08', '2027-02-12'),
  ('Semaine_09-2027', '2027-03-01', '2027-03-05'),
  ('Semaine_10-2027', '2027-03-08', '2027-03-12'),
  ('Semaine_13-2027', '2027-03-29', '2027-04-02'),
  ('Semaine_14-2027', '2027-04-05', '2027-04-09'),
  ('Semaine_17-2027', '2027-04-26', '2027-04-30'),
  ('Semaine_18-2027', '2027-05-03', '2027-05-07'),
  ('Semaine_26-2027', '2027-06-28', '2027-07-02'),
  ('Semaine_27-2027', '2027-07-05', '2027-07-09'),
  ('Semaine_28-2027', '2027-07-12', '2027-07-16'),
  ('Semaine_29-2027', '2027-07-19', '2027-07-23'),
  ('Semaine_30-2027', '2027-07-26', '2027-07-30');

-- Modules
INSERT INTO modules (code, title, ects, sort_order) VALUES
  ('STM022', 'Techniques d''échantillonnage environnementaux', 9, 1),
  ('STM023', 'Techniques d''analyse en laboratoire et sur le terrain', 9, 2),
  ('STM024', 'Calibration et métrologie', 6, 3),
  ('STM025', 'Compréhension de l''écosystème', 8, 4),
  ('STM026', 'Réglementation et suivi de la qualité environnementale', 8, 5),
  ('STM027', 'Communication - Langues etrangeres', 6, 6),
  ('STM028', 'Économie, gestion et organisation de l''entreprise', 4, 7),
  ('UATM011', 'Projet tutoré', 2, 8),
  ('UATM012', 'Expérience professionnelle', 8, 9);

-- Enseignements STM022
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Technique de collecte des échantillons', 1 FROM modules WHERE code = 'STM022';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Techniques de traitement des échantillons', 2 FROM modules WHERE code = 'STM022';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Techniques de conditionnement et stockage', 3 FROM modules WHERE code = 'STM022';

-- Enseignements STM023
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Analyse des paramètres physico-chimiques', 1 FROM modules WHERE code = 'STM023';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Faune', 2 FROM modules WHERE code = 'STM023';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Flore', 3 FROM modules WHERE code = 'STM023';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Microbiologie', 4 FROM modules WHERE code = 'STM023';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Analyse en sédimentologie', 5 FROM modules WHERE code = 'STM023';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Traitement des données, mathématiques et cartographie', 6 FROM modules WHERE code = 'STM023';

-- Enseignements STM024
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Instrumentation', 1 FROM modules WHERE code = 'STM024';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Assurance qualité', 2 FROM modules WHERE code = 'STM024';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Métrologie', 3 FROM modules WHERE code = 'STM024';

-- Enseignements STM025
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Faune', 1 FROM modules WHERE code = 'STM025';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Flore', 2 FROM modules WHERE code = 'STM025';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Microbiologie', 3 FROM modules WHERE code = 'STM025';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Chimie de l''eau', 4 FROM modules WHERE code = 'STM025';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Physique de l''environnement', 5 FROM modules WHERE code = 'STM025';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Géologie de l''environnement', 6 FROM modules WHERE code = 'STM025';

-- Enseignements STM026
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Réglementation', 1 FROM modules WHERE code = 'STM026';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Analyse et suivi de la qualité environnementale', 2 FROM modules WHERE code = 'STM026';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Préservation de la biodiversité', 3 FROM modules WHERE code = 'STM026';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Gestion et lutte contre la pollution', 4 FROM modules WHERE code = 'STM026';

-- Enseignements STM027
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Anglais technique et professionnel', 1 FROM modules WHERE code = 'STM027';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Tronc commun (français)', 2 FROM modules WHERE code = 'STM027';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Tronc commun (mathématiques)', 3 FROM modules WHERE code = 'STM027';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Outils et techniques de communication', 4 FROM modules WHERE code = 'STM027';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Technique de recherche d''emploi', 5 FROM modules WHERE code = 'STM027';

-- Enseignements STM028
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Fonctionnement de l''entreprise', 1 FROM modules WHERE code = 'STM028';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Droit et devoir du travail', 2 FROM modules WHERE code = 'STM028';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Droit du travail - contrat d''apprentissage', 3 FROM modules WHERE code = 'STM028';

-- Enseignements UATM011 / UATM012
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Projet tutoré', 1 FROM modules WHERE code = 'UATM011';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Expérience professionnelle en entreprise', 1 FROM modules WHERE code = 'UATM012';

-- Module Divers (activités hors enseignement académique)
INSERT INTO modules (code, title, sort_order) VALUES ('DIVERS', 'Divers', 10);

INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Réunion', 1 FROM modules WHERE code = 'DIVERS';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Sorties', 2 FROM modules WHERE code = 'DIVERS';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Accueil', 3 FROM modules WHERE code = 'DIVERS';

-- Enseignants (admin seul avec email — les autres à renseigner via l'interface admin)
INSERT INTO teachers (name, email, teacher_type, is_admin) VALUES
  ('Régis GALLON', 'regis.gallon@lecnam.net', 'CNAM', TRUE);

INSERT INTO teachers (name, teacher_type) VALUES
  ('Marjorie LORMELET',   'Ext'),
  ('Grégory THIRIET',     'Ext'),
  ('Florian CESBRON',     'CNAM'),
  ('Sofiène TLILI',       'CNAM'),
  ('Isabelle POIRIER',    'CNAM'),
  ('Claire LAGUIONIE',    'CNAM'),
  ('Gwendoline GRÉGOIRE', 'CNAM'),
  ('Kelton ACUNA',        'Ext'),
  ('Mathilde BAZET',      'Ext'),
  ('Sébastien DONNET',    'CNAM'),
  ('Claire MARION',       'CNAM'),
  ('Frederik CHEVALLIER', 'Ext'),
  ('Lisa LEFRANCOIS',     'Ext'),
  ('Claire HELWIG',       'Ext'),
  ('Mathieu ROUSSEL',     'Ext'),
  ('Céline ABIKHALIL',    'Ext'),
  ('Mathilde AMIARD',     'Ext');

-- Affectations enseignant → enseignement (heures prévues)
-- STM022
INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 16, 4, 12
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Marjorie LORMELET'
WHERE m.code = 'STM022' AND t.title = 'Technique de collecte des échantillons';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 16, 4, 12
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Marjorie LORMELET'
WHERE m.code = 'STM022' AND t.title = 'Techniques de traitement des échantillons';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 16, 4, 12
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Marjorie LORMELET'
WHERE m.code = 'STM022' AND t.title = 'Techniques de conditionnement et stockage';

-- STM023
INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 5, 2, 4
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Grégory THIRIET'
WHERE m.code = 'STM023' AND t.title = 'Analyse des paramètres physico-chimiques';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 5, 0, 0
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Florian CESBRON'
WHERE m.code = 'STM023' AND t.title = 'Analyse des paramètres physico-chimiques';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 2, 0, 4
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Sofiène TLILI'
WHERE m.code = 'STM023' AND t.title = 'Analyse des paramètres physico-chimiques';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 4, 0, 4
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Claire LAGUIONIE'
WHERE m.code = 'STM023' AND t.title = 'Faune';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 6, 1, 5
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Régis GALLON'
WHERE m.code = 'STM023' AND t.title = 'Flore';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 6, 1, 5
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Isabelle POIRIER'
WHERE m.code = 'STM023' AND t.title = 'Microbiologie';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 12, 2, 8
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Gwendoline GRÉGOIRE'
WHERE m.code = 'STM023' AND t.title = 'Analyse en sédimentologie';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 0, 5, 5
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Régis GALLON'
WHERE m.code = 'STM023' AND t.title = 'Traitement des données, mathématiques et cartographie';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 0, 5, 5
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Gwendoline GRÉGOIRE'
WHERE m.code = 'STM023' AND t.title = 'Traitement des données, mathématiques et cartographie';

-- STM024
INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 6, 4, 6
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Kelton ACUNA'
WHERE m.code = 'STM024' AND t.title = 'Assurance qualité';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 8, 4, 8
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Mathilde BAZET'
WHERE m.code = 'STM024' AND t.title = 'Métrologie';

-- STM025
INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 12, 2, 0
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Claire LAGUIONIE'
WHERE m.code = 'STM025' AND t.title = 'Faune';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 12, 2, 0
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Régis GALLON'
WHERE m.code = 'STM025' AND t.title = 'Flore';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 12, 2, 0
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Isabelle POIRIER'
WHERE m.code = 'STM025' AND t.title = 'Microbiologie';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 14, 6, 0
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Grégory THIRIET'
WHERE m.code = 'STM025' AND t.title = 'Chimie de l''eau';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 12, 6, 0
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Sébastien DONNET'
WHERE m.code = 'STM025' AND t.title = 'Physique de l''environnement';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 14, 6, 0
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Claire MARION'
WHERE m.code = 'STM025' AND t.title = 'Géologie de l''environnement';

-- STM026
INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 14, 8, 0
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Marjorie LORMELET'
WHERE m.code = 'STM026' AND t.title = 'Analyse et suivi de la qualité environnementale';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 7, 4, 0
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Frederik CHEVALLIER'
WHERE m.code = 'STM026' AND t.title = 'Préservation de la biodiversité';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 7, 4, 0
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Lisa LEFRANCOIS'
WHERE m.code = 'STM026' AND t.title = 'Préservation de la biodiversité';

-- STM027
INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 0, 16, 0
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Claire HELWIG'
WHERE m.code = 'STM027' AND t.title = 'Anglais technique et professionnel';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 0, 12, 0
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Mathieu ROUSSEL'
WHERE m.code = 'STM027' AND t.title = 'Tronc commun (mathématiques)';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 0, 6, 0
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Céline ABIKHALIL'
WHERE m.code = 'STM027' AND t.title = 'Outils et techniques de communication';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 0, 8, 0
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Céline ABIKHALIL'
WHERE m.code = 'STM027' AND t.title = 'Technique de recherche d''emploi';

-- STM028
INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 4, 10, 0
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Mathilde AMIARD'
WHERE m.code = 'STM028' AND t.title = 'Fonctionnement de l''entreprise';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 4, 6, 0
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Mathilde AMIARD'
WHERE m.code = 'STM028' AND t.title = 'Droit et devoir du travail';

INSERT INTO teaching_assignments (teaching_id, teacher_id, cm_hours, td_hours, tp_hours)
SELECT t.id, te.id, 4, 6, 0
FROM teachings t JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Mathilde AMIARD'
WHERE m.code = 'STM028' AND t.title = 'Droit du travail - contrat d''apprentissage';

-- ============================================================
-- Module emargement
-- ============================================================
CREATE TABLE students (
  id   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE attendance_tokens (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE attendances (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id      UUID REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,
  student_id      UUID REFERENCES students(id) ON DELETE CASCADE NOT NULL,
  signed_at       TIMESTAMPTZ DEFAULT NOW(),
  signature_data  TEXT,
  signed_by_admin BOOLEAN DEFAULT FALSE,
  UNIQUE(session_id, student_id)
);

ALTER TABLE students           ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_tokens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendances        ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_attendance_tokens_session ON attendance_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_attendances_session       ON attendances(session_id);
CREATE INDEX IF NOT EXISTS idx_attendances_student       ON attendances(student_id);

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
  FROM attendance_tokens tok
  JOIN sessions s  ON s.id  = tok.session_id
  LEFT JOIN teachings t  ON t.id  = s.teaching_id
  LEFT JOIN modules m    ON m.id  = t.module_id
  JOIN teachers te ON te.id = s.teacher_id
  WHERE tok.token = p_token
    AND tok.expires_at > NOW();

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

-- Permissions d'execution pour anon
GRANT EXECUTE ON FUNCTION get_session_info_from_token(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION sign_attendance(TEXT, UUID, TEXT) TO anon;

-- Note: les insertions anon dans attendances ne sont possibles que via sign_attendance() (SECURITY DEFINER).
-- Aucune policy INSERT directe pour anon n'est intentionnelle.