-- ============================================================
-- Migration : division par specialite Faune / Flore / Microbiologie
-- STM023 - Analyse en biologie marine
-- STM025 - Biologie (microbiologie / faune / flore)
-- ============================================================

-- ============================================================
-- STM023 - Analyse en biologie marine → Faune / Flore / Microbiologie
-- ============================================================

-- 1. Decaler les enseignements suivants pour liberer les positions 2-4
UPDATE teachings SET sort_order = 5
WHERE title = 'Analyse en sédimentologie'
  AND module_id = (SELECT id FROM modules WHERE code = 'STM023');
UPDATE teachings SET sort_order = 6
WHERE title = 'Traitement des données, mathématiques et cartographie'
  AND module_id = (SELECT id FROM modules WHERE code = 'STM023');

-- 2. Creer les nouveaux enseignements
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Faune', 2 FROM modules WHERE code = 'STM023';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Flore', 3 FROM modules WHERE code = 'STM023';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Microbiologie', 4 FROM modules WHERE code = 'STM023';

-- 3. Migrer les séances existantes vers le bon enseignement selon l'enseignant
UPDATE sessions SET teaching_id = (
  SELECT t.id FROM teachings t JOIN modules m ON t.module_id = m.id
  WHERE m.code = 'STM023' AND t.title = 'Faune'
)
WHERE teacher_id = (SELECT id FROM teachers WHERE name = 'Claire LAGUIONIE')
  AND teaching_id = (
    SELECT t.id FROM teachings t JOIN modules m ON t.module_id = m.id
    WHERE m.code = 'STM023' AND t.title = 'Analyse en biologie marine'
  );

UPDATE sessions SET teaching_id = (
  SELECT t.id FROM teachings t JOIN modules m ON t.module_id = m.id
  WHERE m.code = 'STM023' AND t.title = 'Flore'
)
WHERE teacher_id = (SELECT id FROM teachers WHERE name = 'Régis GALLON')
  AND teaching_id = (
    SELECT t.id FROM teachings t JOIN modules m ON t.module_id = m.id
    WHERE m.code = 'STM023' AND t.title = 'Analyse en biologie marine'
  );

UPDATE sessions SET teaching_id = (
  SELECT t.id FROM teachings t JOIN modules m ON t.module_id = m.id
  WHERE m.code = 'STM023' AND t.title = 'Microbiologie'
)
WHERE teacher_id = (SELECT id FROM teachers WHERE name = 'Isabelle POIRIER')
  AND teaching_id = (
    SELECT t.id FROM teachings t JOIN modules m ON t.module_id = m.id
    WHERE m.code = 'STM023' AND t.title = 'Analyse en biologie marine'
  );

-- 4. Creer les affectations sur les nouveaux enseignements
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

-- 5. Supprimer l'ancien enseignement (cascade sur teaching_assignments)
DELETE FROM teachings
WHERE title = 'Analyse en biologie marine'
  AND module_id = (SELECT id FROM modules WHERE code = 'STM023');


-- ============================================================
-- STM025 - Biologie (microbiologie / faune / flore) → Faune / Flore / Microbiologie
-- ============================================================

-- 1. Decaler les enseignements suivants pour liberer les positions 1-3
UPDATE teachings SET sort_order = 4
WHERE title = 'Chimie de l''eau'
  AND module_id = (SELECT id FROM modules WHERE code = 'STM025');
UPDATE teachings SET sort_order = 5
WHERE title = 'Physique de l''environnement'
  AND module_id = (SELECT id FROM modules WHERE code = 'STM025');
UPDATE teachings SET sort_order = 6
WHERE title = 'Géologie de l''environnement'
  AND module_id = (SELECT id FROM modules WHERE code = 'STM025');

-- 2. Creer les nouveaux enseignements
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Faune', 1 FROM modules WHERE code = 'STM025';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Flore', 2 FROM modules WHERE code = 'STM025';
INSERT INTO teachings (module_id, title, sort_order)
SELECT id, 'Microbiologie', 3 FROM modules WHERE code = 'STM025';

-- 3. Migrer les séances existantes vers le bon enseignement selon l'enseignant
UPDATE sessions SET teaching_id = (
  SELECT t.id FROM teachings t JOIN modules m ON t.module_id = m.id
  WHERE m.code = 'STM025' AND t.title = 'Faune'
)
WHERE teacher_id = (SELECT id FROM teachers WHERE name = 'Claire LAGUIONIE')
  AND teaching_id = (
    SELECT t.id FROM teachings t JOIN modules m ON t.module_id = m.id
    WHERE m.code = 'STM025' AND t.title = 'Biologie (microbiologie / faune / flore)'
  );

UPDATE sessions SET teaching_id = (
  SELECT t.id FROM teachings t JOIN modules m ON t.module_id = m.id
  WHERE m.code = 'STM025' AND t.title = 'Flore'
)
WHERE teacher_id = (SELECT id FROM teachers WHERE name = 'Régis GALLON')
  AND teaching_id = (
    SELECT t.id FROM teachings t JOIN modules m ON t.module_id = m.id
    WHERE m.code = 'STM025' AND t.title = 'Biologie (microbiologie / faune / flore)'
  );

UPDATE sessions SET teaching_id = (
  SELECT t.id FROM teachings t JOIN modules m ON t.module_id = m.id
  WHERE m.code = 'STM025' AND t.title = 'Microbiologie'
)
WHERE teacher_id = (SELECT id FROM teachers WHERE name = 'Isabelle POIRIER')
  AND teaching_id = (
    SELECT t.id FROM teachings t JOIN modules m ON t.module_id = m.id
    WHERE m.code = 'STM025' AND t.title = 'Biologie (microbiologie / faune / flore)'
  );

-- 4. Creer les affectations sur les nouveaux enseignements
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

-- 5. Supprimer l'ancien enseignement (cascade sur teaching_assignments)
DELETE FROM teachings
WHERE title = 'Biologie (microbiologie / faune / flore)'
  AND module_id = (SELECT id FROM modules WHERE code = 'STM025');
