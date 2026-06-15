// ============================================================
// Logique page emargement etudiant
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
    // Adapter la taille au DPI de l'écran pour éviter le flou
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
      document.getElementById('successScreen').querySelector('h4').textContent = 'Déjà émargé';
      document.getElementById('successScreen').classList.remove('d-none');
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
