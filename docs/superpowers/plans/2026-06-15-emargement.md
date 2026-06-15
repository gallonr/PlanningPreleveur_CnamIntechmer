# Module d'émargement numérique — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un module d'émargement numérique par QR code rotatif avec signature tactile, visible par l'enseignant en temps réel et exportable en PDF.

**Architecture:** L'enseignant voit un widget QR qui s'ouvre automatiquement dans `app.html` quand une de ses séances est en cours ; le QR change toutes les 2 min. L'étudiant scanne → `attendance.html` → choisit son nom (mémorisé en localStorage) → signe → la RPC PostgreSQL `sign_attendance()` valide et enregistre côté serveur.

**Tech Stack:** Supabase (tables + RPC SECURITY DEFINER), QRCode.js 1.5.4 (CDN), SignaturePad 4.2.0 (CDN), jsPDF 2.5.1 (déjà présent), Bootstrap 5.3.2 (déjà présent), JS vanilla.

**Spec:** `docs/superpowers/specs/2026-06-15-emargement-design.md`

---

## Structure des fichiers

| Fichier | Action | Responsabilité |
|---|---|---|
| `supabase/migration_attendance.sql` | Créer | Tables, RLS, RPC, fonctions helper |
| `supabase/schema.sql` | Modifier | Ajouter les nouvelles tables au schéma de référence |
| `assets/js/config.js` | Modifier | Ajouter `ABSENCE_ALERT_THRESHOLD` et URL CDN |
| `app.html` | Modifier | CDN QRCode+SignaturePad, widget QR, onglet Présences admin, export dropdown |
| `attendance.html` | Créer | Page étudiant (scan QR → nom → signature → confirmation) |
| `assets/js/attendance.js` | Créer | Logique page étudiant (token, localStorage, SignaturePad, RPC) |
| `assets/js/app.js` | Modifier | Détection séances live, génération/rotation tokens, widget QR, onglet admin Présences |
| `assets/js/export.js` | Modifier | PDF feuille remplie, PDF feuille vierge, Excel présences |
| `assets/css/style.css` | Modifier | Styles widget QR, page attendance, onglet admin Présences |

---

## Task 1 : Migration SQL — tables, RLS, RPC

**Files:**
- Create: `supabase/migration_attendance.sql`

- [ ] **Créer `supabase/migration_attendance.sql`** avec le contenu suivant :

```sql
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
  v_inserted   BOOLEAN := FALSE;
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
```

- [ ] **Exécuter la migration** dans l'éditeur SQL Supabase (copier-coller le fichier entier).

- [ ] **Vérifier** en SQL :
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('students', 'attendance_tokens', 'attendances');
-- Doit retourner 3 lignes

SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('sign_attendance', 'get_session_info_from_token');
-- Doit retourner 2 lignes
```

- [ ] **Insérer quelques étudiants de test** :
```sql
INSERT INTO students (name) VALUES
  ('Alice MARTIN'),
  ('Bob DURAND'),
  ('Claire PETIT');
```

- [ ] **Commit** :
```bash
git add supabase/migration_attendance.sql
git commit -m "feat: add attendance tables, RLS and server-side RPCs"
```

---

## Task 2 : Mettre à jour schema.sql et config.js

**Files:**
- Modify: `supabase/schema.sql` (après la dernière table)
- Modify: `assets/js/config.js`

- [ ] **Ouvrir `supabase/schema.sql`** et ajouter à la fin (avant les données initiales ou à la toute fin du fichier) :

```sql
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
```

- [ ] **Ouvrir `assets/js/config.js`** et ajouter dans l'objet `CONFIG`, après `sessionColors` :

```javascript
  // Seuil d'alerte d'absences (0.20 = 20%)
  ABSENCE_ALERT_THRESHOLD: 0.20
```

- [ ] **Commit** :
```bash
git add supabase/schema.sql assets/js/config.js
git commit -m "feat: add attendance tables to schema and absence threshold to config"
```

---

## Task 3 : Ajouter les CDN et le widget QR à `app.html`

**Files:**
- Modify: `app.html`

- [ ] **Ajouter les CDN** dans `<head>` de `app.html`, après la ligne Bootstrap Icons :

```html
  <!-- QR Code & Signature (émargement) -->
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js"></script>
```

- [ ] **Ajouter le widget QR** dans `app.html`, entre `</div>` (fin sidebar) et `<div class="main-content">` (ligne 109 environ) :

```html
  <!-- WIDGET EMARGEMENT (affiché automatiquement si séance en cours) -->
  <div id="attendanceWidgets" class="attendance-widgets-bar d-none"></div>
```

- [ ] **Ajouter l'onglet Présences** dans `app.html`, dans `<ul id="adminTabs">`, après l'onglet Enseignants :

```html
      <li class="nav-item">
        <button class="nav-link" data-bs-toggle="tab" data-bs-target="#tabPresences"
                onclick="App.renderAdminPresences()">
          <i class="bi bi-person-check me-1"></i>Présences
        </button>
      </li>
```

- [ ] **Ajouter le panneau Présences** dans `app.html`, dans `<div class="tab-content">`, après `<div class="tab-pane fade" id="tabTeachers">...</div>` :

```html
      <div class="tab-pane fade" id="tabPresences">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <small class="text-muted">Présences et absences par séance</small>
          <div class="d-flex gap-1">
            <button class="btn btn-sm btn-outline-secondary" onclick="App.renderAdminPresences()">
              <i class="bi bi-arrow-clockwise"></i>
            </button>
          </div>
        </div>
        <!-- Sélecteur de vue -->
        <div class="btn-group btn-group-sm mb-3 w-100" role="group">
          <button type="button" class="btn btn-outline-primary active" id="presViewBySession"
                  onclick="App.switchPresView('session')">Par séance</button>
          <button type="button" class="btn btn-outline-primary" id="presViewByStudent"
                  onclick="App.switchPresView('student')">Par étudiant</button>
          <button type="button" class="btn btn-outline-primary" id="presViewStats"
                  onclick="App.switchPresView('stats')">Statistiques</button>
        </div>
        <div id="presencesContainer"></div>
        <!-- Gestion des étudiants -->
        <hr>
        <div class="d-flex justify-content-between align-items-center mb-2">
          <small class="fw-bold">Liste des étudiants</small>
          <button class="btn btn-sm btn-outline-success" onclick="App.openAddStudentModal()">
            <i class="bi bi-plus me-1"></i>Ajouter
          </button>
        </div>
        <div id="studentsListContainer"></div>
      </div>
```

- [ ] **Ajouter items dans le dropdown export** (dans le `<ul class="dropdown-menu">` existant), après le dernier `<li>` :

```html
          <li><hr class="dropdown-divider"></li>
          <li><h6 class="dropdown-header">Émargement</h6></li>
          <li><a class="dropdown-item" href="#" onclick="App.exportBlankAttendancePDF()">
            <i class="bi bi-file-pdf me-2"></i>Feuille vierge — séance en cours</a></li>
```

- [ ] **Ajouter la modale d'ajout d'étudiant** dans `app.html`, avant `</body>` :

```html
<!-- Modal ajout étudiant -->
<div class="modal fade" id="studentModal" tabindex="-1">
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title">Ajouter un étudiant</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <div class="mb-3">
          <label class="form-label">Nom complet <span class="text-danger">*</span></label>
          <input type="text" id="studentName" class="form-control" placeholder="Prénom NOM">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" data-bs-dismiss="modal">Annuler</button>
        <button class="btn btn-primary" onclick="App.saveStudent()">Enregistrer</button>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Commit** :
```bash
git add app.html
git commit -m "feat: add attendance CDN, QR widget container and admin tab to app.html"
```

---

## Task 4 : Créer `attendance.html` (page étudiant)

**Files:**
- Create: `attendance.html`

- [ ] **Créer `attendance.html`** :

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Émargement — DSP CNAM Intechmer</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="https://cdn.jsdelivr.net/npm/signature_pad@4.2.0/dist/signature_pad.umd.min.js"></script>
  <script src="assets/js/config.js"></script>
  <style>
    body { background: #f0f4f8; min-height: 100vh; }
    .attendance-card { max-width: 480px; margin: 2rem auto; }
    #signatureCanvas { border: 2px solid #dee2e6; border-radius: 8px; width: 100%; touch-action: none; cursor: crosshair; background: #fff; }
    .session-badge { font-size: 0.8rem; }
    #errorScreen, #successScreen { display: none; }
  </style>
</head>
<body>

<div class="container py-3">
  <div class="attendance-card">

    <!-- En-tête -->
    <div class="text-center mb-3">
      <div class="fw-bold text-primary">CNAM Intechmer</div>
      <div class="text-muted small">Émargement numérique</div>
    </div>

    <!-- Ecran : erreur token -->
    <div id="errorScreen" class="alert alert-danger text-center">
      <i class="bi bi-exclamation-triangle-fill me-2"></i>
      <span id="errorMsg">QR code expiré. Demandez à l'enseignant d'afficher un nouveau QR.</span>
    </div>

    <!-- Ecran : chargement -->
    <div id="loadingScreen" class="text-center py-5">
      <div class="spinner-border text-primary" role="status"></div>
      <div class="mt-2 text-muted small">Vérification en cours…</div>
    </div>

    <!-- Ecran : sélection étudiant -->
    <div id="selectorScreen" class="card shadow-sm d-none">
      <div class="card-body">
        <div id="sessionBadge" class="mb-3"></div>
        <h5 class="card-title">Qui êtes-vous ?</h5>
        <p class="text-muted small">Sélectionnez votre nom. Ce choix sera mémorisé sur cet appareil.</p>
        <select id="studentSelect" class="form-select mb-3">
          <option value="">-- Choisissez votre nom --</option>
        </select>
        <button class="btn btn-primary w-100" onclick="Att.confirmStudentSelection()">
          Continuer <i class="bi bi-arrow-right ms-1"></i>
        </button>
      </div>
    </div>

    <!-- Ecran : signature -->
    <div id="signatureScreen" class="card shadow-sm d-none">
      <div class="card-body">
        <div id="sessionBadge2" class="mb-3"></div>
        <div class="d-flex justify-content-between align-items-center mb-1">
          <span id="welcomeMsg" class="fw-semibold"></span>
          <a href="#" class="text-muted small" onclick="Att.resetStudent(); return false;">
            <i class="bi bi-person-x me-1"></i>Ce n'est pas moi
          </a>
        </div>
        <p class="text-muted small mb-2">Signez ci-dessous pour confirmer votre présence :</p>
        <canvas id="signatureCanvas" height="160"></canvas>
        <div class="d-flex gap-2 mt-2">
          <button class="btn btn-sm btn-outline-secondary flex-fill" onclick="Att.clearSignature()">
            <i class="bi bi-eraser me-1"></i>Effacer
          </button>
          <button class="btn btn-primary flex-fill" id="btnConfirm" onclick="Att.submitAttendance()">
            <i class="bi bi-check2-circle me-1"></i>Confirmer ma présence
          </button>
        </div>
      </div>
    </div>

    <!-- Ecran : succès -->
    <div id="successScreen" class="card shadow-sm border-success d-none">
      <div class="card-body text-center py-4">
        <i class="bi bi-check-circle-fill text-success" style="font-size:3rem"></i>
        <h4 class="mt-3 text-success">Présence enregistrée</h4>
        <p id="successMsg" class="text-muted"></p>
      </div>
    </div>

  </div>
</div>

<script src="assets/js/attendance.js"></script>
</body>
</html>
```

- [ ] **Commit** :
```bash
git add attendance.html
git commit -m "feat: create student attendance page HTML"
```

---

## Task 5 : Créer `assets/js/attendance.js`

**Files:**
- Create: `assets/js/attendance.js`

- [ ] **Créer `assets/js/attendance.js`** :

```javascript
// ============================================================
// Logique page émargement étudiant
// ============================================================

const Att = {
  db: null,
  token: null,
  sessionInfo: null,
  signaturePad: null,
  studentId: null,
  studentName: null,
  students: [],

  async init() {
    Att.db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);

    const params = new URLSearchParams(location.search);
    Att.token = params.get('token');

    if (!Att.token) {
      Att.showError('Lien invalide. Scannez le QR code affiché en classe.');
      return;
    }

    // Charger les infos de séance depuis le token
    const { data, error } = await Att.db.rpc('get_session_info_from_token', { p_token: Att.token });
    if (error || (data && data.error)) {
      Att.showError('QR code expiré ou invalide. Demandez à l\'enseignant d\'afficher un nouveau QR.');
      return;
    }
    Att.sessionInfo = data;

    // Charger la liste des étudiants
    const { data: studs } = await Att.db.from('students').select('id, name').order('name');
    Att.students = studs || [];

    // Lire identité mémorisée
    Att.studentId   = localStorage.getItem('attendance_student_id');
    Att.studentName = localStorage.getItem('attendance_student_name');

    // Vérifier que l'id mémorisé existe toujours dans la liste
    if (Att.studentId && !Att.students.find(s => s.id === Att.studentId)) {
      Att.studentId = null;
      Att.studentName = null;
      localStorage.removeItem('attendance_student_id');
      localStorage.removeItem('attendance_student_name');
    }

    document.getElementById('loadingScreen').classList.add('d-none');

    if (Att.studentId) {
      Att.showSignatureScreen();
    } else {
      Att.showSelectorScreen();
    }
  },

  buildSessionBadgeHTML() {
    const s = Att.sessionInfo;
    const date = new Date(s.session_date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return `<div class="d-flex flex-wrap gap-1 session-badge">
      <span class="badge bg-primary">${s.teaching_title}</span>
      <span class="badge bg-secondary">${s.module_code}</span>
      <span class="badge bg-light text-dark border">${date}</span>
      <span class="badge bg-light text-dark border">${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}</span>
      <span class="badge bg-light text-dark border"><i class="bi bi-person me-1"></i>${s.teacher_name}</span>
    </div>`;
  },

  showSelectorScreen() {
    document.getElementById('sessionBadge').innerHTML = Att.buildSessionBadgeHTML();
    const sel = document.getElementById('studentSelect');
    Att.students.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      sel.appendChild(opt);
    });
    document.getElementById('selectorScreen').classList.remove('d-none');
  },

  confirmStudentSelection() {
    const sel = document.getElementById('studentSelect');
    if (!sel.value) { alert('Veuillez sélectionner votre nom.'); return; }
    const student = Att.students.find(s => s.id === sel.value);
    Att.studentId   = student.id;
    Att.studentName = student.name;
    localStorage.setItem('attendance_student_id',   Att.studentId);
    localStorage.setItem('attendance_student_name', Att.studentName);
    document.getElementById('selectorScreen').classList.add('d-none');
    Att.showSignatureScreen();
  },

  showSignatureScreen() {
    document.getElementById('sessionBadge2').innerHTML = Att.buildSessionBadgeHTML();
    document.getElementById('welcomeMsg').textContent = `Bonjour, ${Att.studentName}`;
    document.getElementById('signatureScreen').classList.remove('d-none');
    Att.initSignaturePad();
  },

  initSignaturePad() {
    const canvas = document.getElementById('signatureCanvas');
    // Adapter la taille au DPI de l'écran
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width  = canvas.offsetWidth  * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext('2d').scale(ratio, ratio);
    Att.signaturePad = new SignaturePad(canvas, { backgroundColor: 'rgb(255,255,255)' });
  },

  clearSignature() {
    if (Att.signaturePad) Att.signaturePad.clear();
  },

  resetStudent() {
    localStorage.removeItem('attendance_student_id');
    localStorage.removeItem('attendance_student_name');
    Att.studentId = null;
    Att.studentName = null;
    document.getElementById('signatureScreen').classList.add('d-none');
    document.getElementById('studentSelect').value = '';
    Att.showSelectorScreen();
  },

  async submitAttendance() {
    if (!Att.signaturePad || Att.signaturePad.isEmpty()) {
      alert('Veuillez signer avant de confirmer votre présence.');
      return;
    }
    const btn = document.getElementById('btnConfirm');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Envoi…';

    const svgData = Att.signaturePad.toSVG();

    const { data, error } = await Att.db.rpc('sign_attendance', {
      p_token:      Att.token,
      p_student_id: Att.studentId,
      p_signature:  svgData
    });

    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check2-circle me-1"></i>Confirmer ma présence';

    if (error) {
      Att.showError('Erreur réseau. Vérifiez votre connexion et réessayez.');
      return;
    }

    document.getElementById('signatureScreen').classList.add('d-none');

    if (data.ok) {
      const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      document.getElementById('successMsg').textContent =
        `${Att.studentName} — ${Att.sessionInfo.teaching_title} à ${now}`;
      document.getElementById('successScreen').classList.remove('d-none');
    } else if (data.error === 'deja_emarge') {
      document.getElementById('successMsg').textContent = 'Vous avez déjà émargé pour ce cours.';
      document.getElementById('successScreen').classList.remove('d-none');
      document.getElementById('successScreen').querySelector('h4').textContent = 'Déjà émargé';
    } else if (data.error === 'token_invalide') {
      Att.showError('QR code expiré pendant l\'envoi. Rescannez le QR code.');
    } else {
      Att.showError('Erreur inattendue : ' + (data.error || 'inconnu'));
    }
  },

  showError(msg) {
    document.getElementById('loadingScreen').classList.add('d-none');
    document.getElementById('selectorScreen').classList.add('d-none');
    document.getElementById('signatureScreen').classList.add('d-none');
    document.getElementById('errorMsg').textContent = msg;
    document.getElementById('errorScreen').style.display = 'block';
  }
};

document.addEventListener('DOMContentLoaded', () => Att.init());
```

- [ ] **Test manuel** : Ouvrir `attendance.html?token=INVALID` dans le navigateur → doit afficher le message d'erreur "QR code expiré ou invalide".

- [ ] **Commit** :
```bash
git add assets/js/attendance.js
git commit -m "feat: create attendance.js student-side logic with SignaturePad and Supabase RPC"
```

---

## Task 6 : Widget QR enseignant dans `app.js`

**Files:**
- Modify: `assets/js/app.js`

- [ ] **Ajouter l'état d'émargement** dans l'objet `App`, après `App.sessions = []` (autour ligne 10-20, dans la déclaration initiale de l'objet) :

```javascript
  // --- Émargement ---
  attIntervals: {},    // sessionId -> intervalId
  attTokens:    {},    // sessionId -> token UUID courant
  attStudents:  [],    // liste des étudiants chargée une fois
  attOpen:      {},    // sessionId -> true/false (émargement ouvert ou fermé manuellement)
```

- [ ] **Ajouter `App.initAttendance()`** dans `app.js`, après `App.renderHoursCounter` :

```javascript
  async initAttendance() {
    // Charger les étudiants (pour le widget admin et l'émargement manuel)
    const { data } = await App.db.from('students').select('id, name').order('name');
    App.attStudents = data || [];
    App.renderAttendanceWidgets();
    // Relancer la détection toutes les 60s (gère les séances qui commencent)
    setInterval(() => App.renderAttendanceWidgets(), 60000);
  },

  detectLiveSessions() {
    const now   = new Date();
    const y     = now.getFullYear();
    const mo    = String(now.getMonth() + 1).padStart(2, '0');
    const d     = String(now.getDate()).padStart(2, '0');
    const today = `${y}-${mo}-${d}`;
    const nowMin = now.getHours() * 60 + now.getMinutes();

    return App.sessions.filter(s => {
      if (s.session_date !== today) return false;
      const [sh, sm] = s.start_time.split(':').map(Number);
      const [eh, em] = s.end_time.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin   = eh * 60 + em;
      // Ouvrir 5 min avant le début, fermer à la fin
      if (nowMin < startMin - 5 || nowMin > endMin) return false;
      return App.isAdmin || s.teacher_id === App.teacher.id;
    });
  },

  renderAttendanceWidgets() {
    const live = App.detectLiveSessions();
    const bar  = document.getElementById('attendanceWidgets');
    if (!bar) return;

    // Stopper les intervalles pour les séances qui ne sont plus live
    Object.keys(App.attIntervals).forEach(sid => {
      if (!live.find(s => s.id === sid)) App.stopAttendanceSession(sid);
    });

    if (live.length === 0) {
      bar.classList.add('d-none');
      return;
    }
    bar.classList.remove('d-none');

    // Un widget par séance live
    live.forEach(session => {
      if (App.attOpen[session.id] === false) return; // fermé manuellement
      if (!App.attIntervals[session.id]) App.startAttendanceSession(session);

      let widget = document.getElementById(`att-widget-${session.id}`);
      if (!widget) {
        widget = document.createElement('div');
        widget.id = `att-widget-${session.id}`;
        widget.className = 'att-widget card shadow-sm';
        bar.appendChild(widget);
      }
      App.updateAttendanceWidget(session, widget);
    });
  },

  async startAttendanceSession(session) {
    await App.rotateToken(session.id);
    // Rotation toutes les 2 min
    App.attIntervals[session.id] = setInterval(() => App.rotateToken(session.id), 120000);
    // Abonnement realtime aux émargements de cette séance
    App.db.channel(`att-${session.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'attendances',
        filter: `session_id=eq.${session.id}`
      }, () => {
        const widget = document.getElementById(`att-widget-${session.id}`);
        if (widget) App.updateAttendanceWidget(session, widget);
      })
      .subscribe();
  },

  async rotateToken(sessionId) {
    const token      = crypto.randomUUID();
    const expiresAt  = new Date(Date.now() + 130000).toISOString(); // 2min + 10s buffer
    // Supprimer tous les tokens expirés de cette séance
    await App.db.from('attendance_tokens').delete().eq('session_id', sessionId);
    // Insérer le nouveau
    const { error } = await App.db.from('attendance_tokens')
      .insert({ session_id: sessionId, token, expires_at: expiresAt });
    if (!error) {
      App.attTokens[sessionId] = token;
      App.renderQR(sessionId, token);
    }
  },

  renderQR(sessionId, token) {
    const el = document.getElementById(`qr-canvas-${sessionId}`);
    if (!el || typeof QRCode === 'undefined') return;
    const url = CONFIG.appUrl + `attendance.html?token=${token}`;
    QRCode.toCanvas(el, url, { width: 180, margin: 2 }, () => {});
  },

  async updateAttendanceWidget(session, widget) {
    // Récupérer les émargements actuels
    const { data: atts } = await App.db
      .from('attendances')
      .select('student_id, signed_at, signed_by_admin')
      .eq('session_id', session.id);

    const signed    = new Set((atts || []).map(a => a.student_id));
    const present   = App.attStudents.filter(s => signed.has(s.id));
    const absent    = App.attStudents.filter(s => !signed.has(s.id));
    const total     = App.attStudents.length;
    const teaching  = App.teachings.find(t => t.id === session.teaching_id);
    const label     = teaching ? teaching.title : 'Séance';

    widget.innerHTML = `
      <div class="card-header d-flex justify-content-between align-items-center py-2">
        <strong><i class="bi bi-qr-code me-1"></i>${label}
          <span class="badge bg-success ms-1">${present.length}/${total}</span>
        </strong>
        <div class="d-flex gap-1">
          <button class="btn btn-sm btn-outline-secondary" title="Feuille vierge"
                  onclick="exportBlankAttendancePDFForSession('${session.id}')">
            <i class="bi bi-file-pdf"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger" title="Fermer l'émargement"
                  onclick="App.closeAttendanceSession('${session.id}')">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
      </div>
      <div class="card-body p-2 d-flex gap-3 flex-wrap">
        <div>
          <canvas id="qr-canvas-${session.id}" width="180" height="180"></canvas>
          <div class="text-center" style="font-size:10px;color:#888">
            <i class="bi bi-arrow-repeat me-1"></i>Se renouvelle automatiquement
          </div>
        </div>
        <div class="flex-fill" style="min-width:160px">
          <div class="mb-1"><span class="badge bg-success-subtle text-success-emphasis border border-success-subtle">
            <i class="bi bi-check-circle me-1"></i>${present.length} présent${present.length>1?'s':''}
          </span></div>
          <ul class="list-unstyled mb-2" style="font-size:13px">
            ${present.map(s => `<li class="text-success"><i class="bi bi-check me-1"></i>${s.name}</li>`).join('')}
          </ul>
          ${absent.length > 0 ? `
          <div class="mb-1"><span class="badge bg-danger-subtle text-danger-emphasis border border-danger-subtle">
            <i class="bi bi-x-circle me-1"></i>${absent.length} absent${absent.length>1?'s':''}
          </span></div>
          <ul class="list-unstyled mb-0" style="font-size:13px">
            ${absent.map(s => `<li class="text-danger d-flex align-items-center gap-1">
              <i class="bi bi-dash me-1"></i>${s.name}
              <button class="btn btn-xs btn-outline-secondary ms-auto" style="font-size:10px;padding:1px 5px"
                      onclick="App.manualSign('${session.id}','${s.id}','${s.name}')">
                Émarger
              </button>
            </li>`).join('')}
          </ul>` : ''}
        </div>
      </div>`;

    // Re-rendre le QR (le canvas a été recréé dans le innerHTML)
    if (App.attTokens[session.id]) App.renderQR(session.id, App.attTokens[session.id]);
  },

  async manualSign(sessionId, studentId, studentName) {
    if (!confirm(`Émarger manuellement ${studentName} ?`)) return;
    const { error } = await App.db.from('attendances').insert({
      session_id: sessionId, student_id: studentId, signed_by_admin: true
    });
    if (error && !error.message.includes('duplicate')) {
      showToast('Erreur lors de l\'émargement manuel.', 'danger');
    }
    // Le realtime met à jour le widget automatiquement
  },

  closeAttendanceSession(sessionId) {
    App.attOpen[sessionId] = false;
    App.stopAttendanceSession(sessionId);
    const widget = document.getElementById(`att-widget-${sessionId}`);
    if (widget) widget.remove();
    const bar = document.getElementById('attendanceWidgets');
    if (bar && !bar.querySelector('.att-widget')) bar.classList.add('d-none');
  },

  stopAttendanceSession(sessionId) {
    if (App.attIntervals[sessionId]) {
      clearInterval(App.attIntervals[sessionId]);
      delete App.attIntervals[sessionId];
    }
    delete App.attTokens[sessionId];
  },
```

- [ ] **Appeler `initAttendance`** dans `App.init()`, après `App.renderHoursCounter()` :

```javascript
    App.initAttendance();
```

- [ ] **Test** : Ouvrir `app.html` à une heure où aucune séance n'est en cours → widget absent. Créer une séance pour maintenant dans la DB (ou ajuster l'heure d'une séance existante) → recharger → le widget doit apparaître avec le QR.

- [ ] **Commit** :
```bash
git add assets/js/app.js
git commit -m "feat: add live QR attendance widget with token rotation and realtime presence list"
```

---

## Task 7 : Panneau admin Présences dans `app.js`

**Files:**
- Modify: `assets/js/app.js`

- [ ] **Ajouter les fonctions du panneau admin** dans `app.js` à la suite des fonctions existantes :

```javascript
  // ============================================================
  // ADMIN — Panneau Présences
  // ============================================================

  presView: 'session', // 'session' | 'student' | 'stats'

  switchPresView(view) {
    App.presView = view;
    ['session', 'student', 'stats'].forEach(v => {
      const btn = document.getElementById(`presViewBy${v.charAt(0).toUpperCase() + v.slice(1)}`);
      if (btn) btn.classList.toggle('active', v === view);
    });
    App.renderAdminPresences();
  },

  async renderAdminPresences() {
    if (!App.isAdmin) return;
    const container = document.getElementById('presencesContainer');
    if (!container) return;
    container.innerHTML = '<div class="text-center py-3"><span class="spinner-border spinner-border-sm"></span></div>';

    if (App.presView === 'session')  await App.renderPresencesBySession(container);
    if (App.presView === 'student')  await App.renderPresencesByStudent(container);
    if (App.presView === 'stats')    await App.renderPresencesStats(container);

    // Toujours afficher la liste des étudiants
    App.renderStudentsList();
  },

  async renderPresencesBySession(container) {
    // Sélecteur de date
    const today = new Date().toISOString().split('T')[0];
    container.innerHTML = `
      <div class="d-flex gap-2 mb-3 align-items-center">
        <label class="form-label mb-0 small">Date :</label>
        <input type="date" id="presDateFilter" class="form-control form-control-sm" style="width:auto"
               value="${today}" onchange="App.loadPresenceForDate(this.value)">
      </div>
      <div id="presSessionList"></div>`;
    App.loadPresenceForDate(today);
  },

  async loadPresenceForDate(dateStr) {
    const list = document.getElementById('presSessionList');
    if (!list) return;

    // Séances du jour
    const daySessions = App.sessions.filter(s => s.session_date === dateStr);
    if (daySessions.length === 0) {
      list.innerHTML = '<p class="text-muted small">Aucune séance ce jour.</p>';
      return;
    }

    // Charger les émargements pour ces séances
    const sessionIds = daySessions.map(s => s.id);
    const { data: atts } = await App.db
      .from('attendances')
      .select('session_id, student_id, signed_at, signed_by_admin, signature_data')
      .in('session_id', sessionIds);

    list.innerHTML = daySessions.map(session => {
      const teaching = App.teachings.find(t => t.id === session.teaching_id);
      const teacher  = App.teachers.find(t => t.id === session.teacher_id);
      const sessAtts = (atts || []).filter(a => a.session_id === session.id);
      const signedIds = new Set(sessAtts.map(a => a.student_id));
      const present  = App.attStudents.filter(s => signedIds.has(s.id));
      const absent   = App.attStudents.filter(s => !signedIds.has(s.id));

      return `
        <div class="card mb-3">
          <div class="card-header d-flex justify-content-between align-items-center py-2">
            <div>
              <strong>${teaching?.title || 'Séance'}</strong>
              <span class="text-muted small ms-2">${session.start_time.slice(0,5)}–${session.end_time.slice(0,5)}</span>
              <span class="badge bg-secondary ms-1">${session.session_type}</span>
              <span class="text-muted small ms-1">— ${teacher?.name || ''}</span>
            </div>
            <div class="d-flex gap-1">
              <button class="btn btn-xs btn-outline-secondary" style="font-size:11px;padding:2px 7px"
                      onclick="exportFilledAttendancePDF('${session.id}')">
                <i class="bi bi-file-pdf me-1"></i>Remplie
              </button>
              <button class="btn btn-xs btn-outline-secondary" style="font-size:11px;padding:2px 7px"
                      onclick="exportBlankAttendancePDFForSession('${session.id}')">
                <i class="bi bi-file-pdf me-1"></i>Vierge
              </button>
            </div>
          </div>
          <div class="card-body p-2">
            <div class="row g-2">
              <div class="col-6">
                <div class="text-success small fw-semibold mb-1"><i class="bi bi-check-circle me-1"></i>Présents (${present.length})</div>
                ${present.map(s => {
                  const att = sessAtts.find(a => a.student_id === s.id);
                  return `<div class="d-flex align-items-center gap-1 mb-1" style="font-size:12px">
                    <span>${s.name}</span>
                    ${att?.signed_by_admin ? '<span class="badge bg-warning-subtle text-warning-emphasis" title="Émargé par admin" style="font-size:9px">admin</span>' : ''}
                    ${att?.signature_data ? `<img src="${App.svgToDataUrl(att.signature_data)}" height="20" style="border:1px solid #eee;border-radius:3px">` : ''}
                  </div>`;
                }).join('') || '<span class="text-muted small">—</span>'}
              </div>
              <div class="col-6">
                <div class="text-danger small fw-semibold mb-1"><i class="bi bi-x-circle me-1"></i>Absents (${absent.length})</div>
                ${absent.map(s => `<div style="font-size:12px" class="text-danger">${s.name}</div>`).join('') || '<span class="text-muted small">—</span>'}
              </div>
            </div>
          </div>
        </div>`;
    }).join('');
  },

  svgToDataUrl(svgStr) {
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
  },

  async renderPresencesByStudent(container) {
    const { data: atts } = await App.db
      .from('attendances')
      .select('session_id, student_id, signed_at, signed_by_admin');

    const byStudent = {};
    (atts || []).forEach(a => {
      if (!byStudent[a.student_id]) byStudent[a.student_id] = [];
      byStudent[a.student_id].push(a);
    });

    const totalSessions = App.sessions.length;

    container.innerHTML = App.attStudents.map(student => {
      const stuAtts  = byStudent[student.id] || [];
      const rate     = totalSessions > 0 ? stuAtts.length / totalSessions : 0;
      const absRate  = 1 - rate;
      const alert    = absRate > CONFIG.ABSENCE_ALERT_THRESHOLD;
      return `
        <div class="card mb-2 ${alert ? 'border-danger' : ''}">
          <div class="card-body py-2 d-flex justify-content-between align-items-center">
            <div>
              <strong>${student.name}</strong>
              ${alert ? '<span class="badge bg-danger ms-2">Taux d\'absence élevé</span>' : ''}
            </div>
            <div class="text-end">
              <span class="badge bg-success-subtle text-success-emphasis border border-success-subtle">
                ${stuAtts.length} présence${stuAtts.length>1?'s':''}
              </span>
              <span class="badge bg-danger-subtle text-danger-emphasis border border-danger-subtle ms-1">
                ${totalSessions - stuAtts.length} absence${(totalSessions-stuAtts.length)>1?'s':''}
              </span>
            </div>
          </div>
        </div>`;
    }).join('');
  },

  async renderPresencesStats(container) {
    const { data: atts } = await App.db
      .from('attendances')
      .select('session_id, student_id');

    // Regrouper séances par module
    const statsByModule = {};
    App.sessions.forEach(s => {
      const teaching = App.teachings.find(t => t.id === s.teaching_id);
      const mod = teaching?.module?.code || 'DIVERS';
      if (!statsByModule[mod]) statsByModule[mod] = { sessions: [], label: teaching?.module?.title || mod };
      statsByModule[mod].sessions.push(s.id);
    });

    const signedSet = new Set((atts || []).map(a => `${a.session_id}_${a.student_id}`));

    const rows = App.attStudents.map(student => {
      const cells = Object.keys(statsByModule).map(mod => {
        const sessIds = statsByModule[mod].sessions;
        const pres = sessIds.filter(sid => signedSet.has(`${sid}_${student.id}`)).length;
        const pct  = sessIds.length > 0 ? Math.round(pres / sessIds.length * 100) : null;
        const color = pct === null ? '' : pct >= 80 ? '#d4edda' : pct >= 60 ? '#fff3cd' : '#f8d7da';
        return `<td class="text-center" style="font-size:12px;background:${color}">${pct !== null ? pct + '%' : '—'}</td>`;
      }).join('');
      return `<tr><td style="font-size:12px;white-space:nowrap">${student.name}</td>${cells}</tr>`;
    }).join('');

    const headers = Object.keys(statsByModule)
      .map(mod => `<th class="text-center" style="font-size:11px">${mod}</th>`).join('');

    container.innerHTML = `
      <div style="overflow-x:auto">
        <table class="table table-bordered table-sm">
          <thead><tr><th>Étudiant</th>${headers}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <small class="text-muted">Taux de présence par module. Rouge < 60%, Orange 60-79%, Vert ≥ 80%.</small>
      </div>
      <button class="btn btn-sm btn-outline-success mt-2" onclick="exportAttendanceExcel()">
        <i class="bi bi-file-excel me-1"></i>Exporter Excel
      </button>`;
  },

  // Gestion de la liste des étudiants
  renderStudentsList() {
    const container = document.getElementById('studentsListContainer');
    if (!container) return;
    if (App.attStudents.length === 0) {
      container.innerHTML = '<p class="text-muted small">Aucun étudiant enregistré.</p>';
      return;
    }
    container.innerHTML = `<ul class="list-group list-group-flush">
      ${App.attStudents.map(s => `
        <li class="list-group-item d-flex justify-content-between align-items-center py-1 px-0">
          <span style="font-size:13px">${s.name}</span>
          <button class="btn btn-xs btn-outline-danger" style="font-size:11px;padding:1px 6px"
                  onclick="App.deleteStudent('${s.id}','${s.name}')">
            <i class="bi bi-trash"></i>
          </button>
        </li>`).join('')}
    </ul>`;
  },

  openAddStudentModal() {
    document.getElementById('studentName').value = '';
    new bootstrap.Modal(document.getElementById('studentModal')).show();
  },

  async saveStudent() {
    const name = document.getElementById('studentName').value.trim();
    if (!name) { alert('Nom requis.'); return; }
    const { error } = await App.db.from('students').insert({ name });
    if (error) { showToast('Erreur : ' + error.message, 'danger'); return; }
    bootstrap.Modal.getInstance(document.getElementById('studentModal'))?.hide();
    const { data } = await App.db.from('students').select('id, name').order('name');
    App.attStudents = data || [];
    App.renderAdminPresences();
    showToast(`${name} ajouté(e).`, 'success');
  },

  async deleteStudent(id, name) {
    if (!confirm(`Supprimer ${name} ? Ses émargements seront perdus.`)) return;
    await App.db.from('students').delete().eq('id', id);
    App.attStudents = App.attStudents.filter(s => s.id !== id);
    App.renderAdminPresences();
  },
```

- [ ] **Commit** :
```bash
git add assets/js/app.js
git commit -m "feat: add admin presence panel with views by session, student and stats"
```

---

## Task 8 : Exports PDF et Excel dans `export.js`

**Files:**
- Modify: `assets/js/export.js`

- [ ] **Ouvrir `assets/js/export.js`** et ajouter à la fin les fonctions suivantes :

```javascript
// ============================================================
// Export — Feuille d'émargement remplie (PDF)
// ============================================================
async function exportFilledAttendancePDF(sessionId) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Récupérer les données
  const session  = App.sessions.find(s => s.id === sessionId);
  if (!session) { showToast('Séance introuvable.', 'danger'); return; }
  const teaching = App.teachings.find(t => t.id === session.teaching_id);
  const teacher  = App.teachers.find(t => t.id === session.teacher_id);

  const { data: atts } = await App.db
    .from('attendances')
    .select('student_id, signed_at, signed_by_admin, signature_data')
    .eq('session_id', sessionId);

  _renderAttendancePDF(doc, session, teaching, teacher, App.attStudents, atts || [], false);
  const dateStr = session.session_date.replace(/-/g, '');
  doc.save(`emargement_${dateStr}_${(teaching?.title || 'seance').replace(/\s+/g,'_')}.pdf`);
}

// ============================================================
// Export — Feuille d'émargement vierge (PDF)
// ============================================================
async function exportBlankAttendancePDFForSession(sessionId) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const session  = App.sessions.find(s => s.id === sessionId);
  if (!session) { showToast('Séance introuvable.', 'danger'); return; }
  const teaching = App.teachings.find(t => t.id === session.teaching_id);
  const teacher  = App.teachers.find(t => t.id === session.teacher_id);

  _renderAttendancePDF(doc, session, teaching, teacher, App.attStudents, [], true);
  const dateStr = session.session_date.replace(/-/g, '');
  doc.save(`emargement_vierge_${dateStr}_${(teaching?.title || 'seance').replace(/\s+/g,'_')}.pdf`);
}

// Feuille vierge depuis le bouton export "séance en cours" (navbar)
function exportBlankAttendancePDF() {
  const live = App.detectLiveSessions ? App.detectLiveSessions() : [];
  if (live.length === 0) { showToast('Aucune séance en cours.', 'warning'); return; }
  exportBlankAttendancePDFForSession(live[0].id);
}

// ============================================================
// Fonction commune de rendu PDF émargement
// ============================================================
function _renderAttendancePDF(doc, session, teaching, teacher, students, atts, blank) {
  const margin  = 15;
  const pageW   = 210;
  const usableW = pageW - margin * 2;
  let y = margin;

  // En-tête
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('CNAM Intechmer — Feuille d\'émargement', pageW / 2, y, { align: 'center' });
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const dateLabel = new Date(session.session_date + 'T00:00:00')
    .toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  doc.text([
    `Module : ${teaching?.module?.code || ''} — ${teaching?.module?.title || ''}`,
    `Enseignement : ${teaching?.title || 'Séance'}`,
    `Date : ${dateLabel}   Horaire : ${session.start_time.slice(0,5)} – ${session.end_time.slice(0,5)}`,
    `Enseignant(e) : ${teacher?.name || ''}   Type : ${session.session_type}`,
    blank ? 'FEUILLE VIERGE — À conserver' : `Exportée le : ${new Date().toLocaleDateString('fr-FR')}`
  ], margin, y);
  y += 28;

  // Ligne de séparation
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 5;

  // En-têtes du tableau
  const colN    = 8;
  const colName = 70;
  const colTime = 28;
  const colSign = usableW - colN - colName - colTime;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('N°',      margin,                  y);
  doc.text('Nom',     margin + colN,            y);
  doc.text('Heure',   margin + colN + colName,  y);
  doc.text('Signature', margin + colN + colName + colTime, y);
  y += 4;
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 3;

  // Lignes étudiants
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const rowH = blank ? 14 : 12;

  students.forEach((student, i) => {
    if (y + rowH > 280) {
      doc.addPage();
      y = margin;
    }

    const att = atts.find(a => a.student_id === student.id);
    doc.text(String(i + 1), margin + 2, y + 5);
    doc.text(student.name,  margin + colN, y + 5);

    if (!blank && att) {
      const heure = new Date(att.signed_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      doc.text(heure, margin + colN + colName + 2, y + 5);

      if (att.signature_data) {
        try {
          // Convertir SVG en data URL et insérer comme image
          const svgB64 = btoa(unescape(encodeURIComponent(att.signature_data)));
          doc.addImage(
            'data:image/svg+xml;base64,' + svgB64,
            'SVG',
            margin + colN + colName + colTime,
            y,
            colSign,
            rowH - 1
          );
        } catch (e) {
          doc.text('[signature]', margin + colN + colName + colTime + 2, y + 5);
        }
      }
      if (att.signed_by_admin) {
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text('admin', margin + colN + colName + colTime + 2, y + rowH - 2);
        doc.setFontSize(9);
        doc.setTextColor(0);
      }
    }

    // Bordure de la ligne
    doc.setLineWidth(0.1);
    doc.rect(margin, y, usableW, rowH);
    // Séparateurs colonnes
    doc.line(margin + colN,                   y, margin + colN,                   y + rowH);
    doc.line(margin + colN + colName,         y, margin + colN + colName,         y + rowH);
    doc.line(margin + colN + colName + colTime, y, margin + colN + colName + colTime, y + rowH);

    y += rowH;
  });

  // Pied de page
  y += 8;
  doc.setFontSize(8);
  doc.setTextColor(130);
  doc.text(
    blank
      ? 'Feuille d\'émargement papier — Formation DSP Préleveur en Milieu Naturel — CNAM Intechmer'
      : `Document généré automatiquement — ${students.length} étudiant${students.length > 1 ? 's' : ''} — DSP Préleveur CNAM Intechmer`,
    pageW / 2, y, { align: 'center' }
  );
  doc.setTextColor(0);
}

// ============================================================
// Export — Présences Excel (tableau croisé)
// ============================================================
async function exportAttendanceExcel() {
  const { data: atts } = await App.db
    .from('attendances')
    .select('session_id, student_id, signed_at');

  const signedSet = new Set((atts || []).map(a => `${a.session_id}_${a.student_id}`));

  // En-têtes : Étudiant + une colonne par séance
  const sortedSessions = [...App.sessions].sort((a, b) =>
    a.session_date.localeCompare(b.session_date) || a.start_time.localeCompare(b.start_time));

  const header = ['Étudiant', ...sortedSessions.map(s => {
    const t = App.teachings.find(x => x.id === s.teaching_id);
    return `${s.session_date} ${t?.title || 'Séance'}`;
  })];

  const dataRows = App.attStudents.map(student => [
    student.name,
    ...sortedSessions.map(s => signedSet.has(`${s.id}_${student.id}`) ? 'P' : 'A')
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Présences');
  XLSX.writeFile(wb, 'presences_etudiants_DSP_2026-2027.xlsx');
}
```

- [ ] **Commit** :
```bash
git add assets/js/export.js
git commit -m "feat: add filled and blank attendance PDF exports and Excel presence export"
```

---

## Task 9 : Styles CSS

**Files:**
- Modify: `assets/css/style.css`

- [ ] **Ajouter à la fin de `assets/css/style.css`** :

```css
/* ============================================================
   Module émargement
   ============================================================ */

/* Barre de widgets QR (au-dessus du calendrier) */
.attendance-widgets-bar {
  padding: 8px 12px;
  background: #f8f9fa;
  border-bottom: 1px solid #dee2e6;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

/* Carte d'un widget QR */
.att-widget {
  min-width: 340px;
  max-width: 500px;
  flex: 1;
}

.att-widget .card-header {
  background: #e8f4f8;
  border-bottom: 1px solid #bee3f8;
  font-size: 13px;
}

/* Page attendance.html */
.attendance-card {
  max-width: 480px;
  margin: 1.5rem auto;
}

#signatureCanvas {
  border: 2px solid #dee2e6;
  border-radius: 8px;
  width: 100%;
  height: 160px;
  touch-action: none;
  cursor: crosshair;
  background: #fff;
  display: block;
}

/* Bouton extra-small (absent du Bootstrap de base) */
.btn-xs {
  padding: 1px 6px;
  font-size: 11px;
  line-height: 1.4;
  border-radius: 3px;
}
```

- [ ] **Commit** :
```bash
git add assets/css/style.css
git commit -m "feat: add CSS for QR attendance widget and attendance page"
```

---

## Task 10 : Inscrire les 16 étudiants réels et tester de bout en bout

**Files:** aucun (données uniquement)

- [ ] **Insérer les 16 étudiants** dans Supabase (SQL Editor) — remplacer par les vrais noms :

```sql
INSERT INTO students (name) VALUES
  ('Étudiant 1 NOM'),
  ('Étudiant 2 NOM'),
  -- ... (16 lignes)
  ('Étudiant 16 NOM');
```

- [ ] **Test de bout en bout** :
  1. Se connecter à `app.html` en tant qu'admin
  2. Créer une séance pour maintenant (session_date = aujourd'hui, start_time = heure actuelle - 2 min)
  3. Le widget QR doit apparaître automatiquement
  4. Scanner le QR avec un téléphone → `attendance.html?token=...` s'ouvre
  5. Sélectionner un étudiant dans la liste → signer → confirmer
  6. Le compteur dans le widget doit passer de 0/16 à 1/16 en temps réel
  7. Ouvrir le panneau Admin → onglet Présences → "Par séance" → la signature doit être visible
  8. Tester "Feuille remplie PDF" et "Feuille vierge PDF" → vérifier le rendu
  9. Attendre 2 min → le QR doit se renouveler silencieusement
  10. Scanner l'ancien QR (expiré) → message d'erreur "QR expiré"

- [ ] **Push final** :
```bash
git push origin main
```

---

## Récapitulatif des fichiers modifiés

| Fichier | Type |
|---|---|
| `supabase/migration_attendance.sql` | Nouveau |
| `supabase/schema.sql` | Modifié |
| `assets/js/config.js` | Modifié |
| `app.html` | Modifié |
| `attendance.html` | Nouveau |
| `assets/js/attendance.js` | Nouveau |
| `assets/js/app.js` | Modifié |
| `assets/js/export.js` | Modifié |
| `assets/css/style.css` | Modifié |
