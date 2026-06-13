// ============================================================
// Auth — Supabase magic link
// ============================================================

let _client = null;

function getClient() {
  if (!_client) {
    _client = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { flowType: 'implicit' }
    });
  }
  return _client;
}

async function isTeacherEmail(email) {
  const { data, error } = await getClient().rpc('is_teacher_email', { p_email: email });
  if (error) return true; // En cas d'erreur RPC, on laisse Supabase gérer
  return !!data;
}

async function signInWithMagicLink(email) {
  // shouldCreateUser: false — on n'autorise que les comptes créés manuellement par l'admin
  const { error } = await getClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false }
  });
  return error;
}

async function verifyOtpCode(email, token) {
  const { error } = await getClient().auth.verifyOtp({ email, token, type: 'email' });
  return error;
}

async function getSession() {
  const { data: { session } } = await getClient().auth.getSession();
  return session;
}

async function signOut() {
  await getClient().auth.signOut();
  window.location.href = 'index.html';
}

async function getCurrentTeacher(email) {
  const { data, error } = await getClient()
    .from('teachers')
    .select('*')
    .eq('email', email)
    .single();
  if (error) return null;
  return data;
}

async function requireAuth() {
  const session = await getSession();
  if (!session) {
    const hash = window.location.hash;
    if (hash.includes('error_code=otp_expired') || hash.includes('error=access_denied')) {
      showToast('Le lien de connexion a expiré. Vous allez être redirigé pour en demander un nouveau.', 'warning');
    } else {
      showToast('Session introuvable. Redirection vers la page de connexion.', 'danger');
    }
    setTimeout(() => { window.location.href = 'index.html'; }, 4000);
    return null;
  }
  const teacher = await getCurrentTeacher(session.user.email);
  if (!teacher) {
    showToast('Accès non autorisé. Contactez l\'administrateur.', 'danger');
    await getClient().auth.signOut();
    setTimeout(() => { window.location.href = 'index.html'; }, 3000);
    return null;
  }
  return { session, teacher };
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const id = 'toast_' + Date.now();
  const bgMap = { info: 'bg-primary', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' };
  const bg = bgMap[type] || 'bg-secondary';
  container.insertAdjacentHTML('beforeend', `
    <div id="${id}" class="toast align-items-center text-white ${bg} border-0" role="alert" data-bs-autohide="true" data-bs-delay="4000">
      <div class="d-flex">
        <div class="toast-body">${escapeHtml(message)}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`);
  const el = document.getElementById(id);
  new bootstrap.Toast(el).show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  return timeStr.substring(0, 5);
}

function durationMinutes(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

function addMinutes(timeStr, mins) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + mins;
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}`;
}
