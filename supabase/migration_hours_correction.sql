-- ============================================================
-- Migration : correction des heures affectees (14/06/2026)
-- Source : correctionHeure14062026.txt
-- A executer dans le SQL Editor Supabase
-- ============================================================

-- STM023 - Analyse en biologie marine
-- Faune (Claire LAGUIONIE) : 4 CM, 4 TP (pas de TD)
UPDATE teaching_assignments ta
SET cm_hours = 4, td_hours = 0, tp_hours = 4
FROM teachings t
JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Claire LAGUIONIE'
WHERE ta.teaching_id = t.id AND ta.teacher_id = te.id
  AND m.code = 'STM023' AND t.title = 'Analyse en biologie marine';

-- Flore (Regis GALLON) : 6 CM, 1 TD, 5 TP
UPDATE teaching_assignments ta
SET cm_hours = 6, td_hours = 1, tp_hours = 5
FROM teachings t
JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Régis GALLON'
WHERE ta.teaching_id = t.id AND ta.teacher_id = te.id
  AND m.code = 'STM023' AND t.title = 'Analyse en biologie marine';

-- Microbio (Isabelle POIRIER) : 6 CM, 1 TD, 5 TP
UPDATE teaching_assignments ta
SET cm_hours = 6, td_hours = 1, tp_hours = 5
FROM teachings t
JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Isabelle POIRIER'
WHERE ta.teaching_id = t.id AND ta.teacher_id = te.id
  AND m.code = 'STM023' AND t.title = 'Analyse en biologie marine';

-- STM023 - Traitement des donnees, mathematiques et cartographie
-- Regis GALLON : 5 TD, 5 TP
UPDATE teaching_assignments ta
SET cm_hours = 0, td_hours = 5, tp_hours = 5
FROM teachings t
JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Régis GALLON'
WHERE ta.teaching_id = t.id AND ta.teacher_id = te.id
  AND m.code = 'STM023' AND t.title = 'Traitement des données, mathématiques et cartographie';

-- Gwendoline GREGOIRE : 5 TD, 5 TP
UPDATE teaching_assignments ta
SET cm_hours = 0, td_hours = 5, tp_hours = 5
FROM teachings t
JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Gwendoline GRÉGOIRE'
WHERE ta.teaching_id = t.id AND ta.teacher_id = te.id
  AND m.code = 'STM023' AND t.title = 'Traitement des données, mathématiques et cartographie';

-- STM025 - Biologie (microbiologie / faune / flore)
-- Faune (Claire LAGUIONIE) : 12 CM, 2 TD
UPDATE teaching_assignments ta
SET cm_hours = 12, td_hours = 2, tp_hours = 0
FROM teachings t
JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Claire LAGUIONIE'
WHERE ta.teaching_id = t.id AND ta.teacher_id = te.id
  AND m.code = 'STM025' AND t.title = 'Biologie (microbiologie / faune / flore)';

-- Flore (Regis GALLON) : 12 CM, 2 TD
UPDATE teaching_assignments ta
SET cm_hours = 12, td_hours = 2, tp_hours = 0
FROM teachings t
JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Régis GALLON'
WHERE ta.teaching_id = t.id AND ta.teacher_id = te.id
  AND m.code = 'STM025' AND t.title = 'Biologie (microbiologie / faune / flore)';

-- Microbio (Isabelle POIRIER) : 12 CM, 2 TD
UPDATE teaching_assignments ta
SET cm_hours = 12, td_hours = 2, tp_hours = 0
FROM teachings t
JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Isabelle POIRIER'
WHERE ta.teaching_id = t.id AND ta.teacher_id = te.id
  AND m.code = 'STM025' AND t.title = 'Biologie (microbiologie / faune / flore)';

-- STM026 - Preservation de la biodiversite
-- Frederik CHEVALLIER : 7 CM, 4 TD
UPDATE teaching_assignments ta
SET cm_hours = 7, td_hours = 4, tp_hours = 0
FROM teachings t
JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Frederik CHEVALLIER'
WHERE ta.teaching_id = t.id AND ta.teacher_id = te.id
  AND m.code = 'STM026' AND t.title = 'Préservation de la biodiversité';

-- Lisa LEFRANCOIS : 7 CM, 4 TD
UPDATE teaching_assignments ta
SET cm_hours = 7, td_hours = 4, tp_hours = 0
FROM teachings t
JOIN modules m ON t.module_id = m.id
JOIN teachers te ON te.name = 'Lisa LEFRANCOIS'
WHERE ta.teaching_id = t.id AND ta.teacher_id = te.id
  AND m.code = 'STM026' AND t.title = 'Préservation de la biodiversité';
