// ============================================================
// Application principale — Planning DSP
// ============================================================

const App = {
  db: null,
  session: null,
  teacher: null,
  isAdmin: false,

  modules: [],
  teachings: [],
  teachers: [],
  assignments: [],
  sessions: [],
  centrePeriods: [],
  requests: [],
  calendar: null,

  centreSet: new Set(),
  filterTeacherId: null,   // admin: filtrer par enseignant
  editingSession: null,
  _duplicatingSession: null,

  async init() {
    App.db = getClient();

    const auth = await requireAuth();
    if (!auth) return;
    App.session = auth.session;
    App.teacher = auth.teacher;
    App.isAdmin = auth.teacher.is_admin;
    App.filterTeacherId = App.isAdmin ? null : App.teacher.id;

    document.getElementById('userDisplay').textContent = App.teacher.name;
    if (App.isAdmin) {
      document.getElementById('adminBtnWrap').classList.remove('d-none');
      document.getElementById('teacherFilterWrap').classList.remove('d-none');
    }

    await App.loadReferenceData();
    App.buildCentreSet();
    App.renderTeacherFilter();
    await App.loadSessions();
    App.initCalendar();
    App.renderHoursCounter();
    if (App.isAdmin) await App.loadRequests();

    // Écouter les changements temps réel (toutes les séances pour voir celles des collègues)
    App.db.channel('sessions-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, () => App.refresh())
      .subscribe();
  },

  async loadReferenceData() {
    const [
      { data: modules },
      { data: teachings },
      { data: teachers },
      { data: assignments },
      { data: periods }
    ] = await Promise.all([
      App.db.from('modules').select('*').order('sort_order'),
      App.db.from('teachings').select('*, module:modules(id,code,title)').order('sort_order'),
      App.db.from('teachers').select('*').order('name'),
      App.db.from('teaching_assignments').select('*, teaching:teachings(id,title,module:modules(id,code,title))').order('id'),
      App.db.from('centre_periods').select('*').order('start_date')
    ]);
    App.modules = modules || [];
    App.teachings = teachings || [];
    App.teachers = teachers || [];
    App.assignments = assignments || [];
    App.centrePeriods = periods || [];
  },

  buildCentreSet() {
    App.centreSet = new Set(App.centrePeriods.map(p => p.start_date));
  },

  isEnterpriseDate(date) {
    const d = date instanceof Date ? date : new Date(date + 'T00:00:00');
    // Trouver le lundi de la semaine
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    const mondayStr = `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`;
    return !App.centreSet.has(mondayStr);
  },

  async loadSessions() {
    const { data } = await App.db.from('sessions')
      .select('*, teacher:teachers(id,name), teaching:teachings(id,title,module:modules(id,code,title))')
      .order('session_date').order('start_time');
    App.sessions = data || [];
  },

  async loadRequests() {
    const { data } = await App.db.from('modification_requests')
      .select('*, teacher:teachers(name), session:sessions(*)')
      .order('created_at', { ascending: false });
    App.requests = data || [];
    App.renderRequestsBadge();
  },

  async refresh() {
    await App.loadSessions();
    if (App.calendar) {
      App.calendar.removeAllEvents();
      App.calendar.addEventSource(App.buildCalendarEvents());
    }
    App.renderHoursCounter();
  },

  // ---- Calendar ----

  initCalendar() {
    const el = document.getElementById('calendar');
    App.calendar = new FullCalendar.Calendar(el, {
      locale: 'fr',
      initialView: 'timeGridWeek',
      firstDay: 1,
      slotMinTime: '07:00:00',
      slotMaxTime: '21:00:00',
      slotDuration: '00:30:00',
      slotLabelInterval: '01:00:00',
      allDaySlot: false,
      weekends: false,
      nowIndicator: true,
      height: 'parent',
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,timeGridDay'
      },
      initialDate: '2026-09-01',
      events: App.buildCalendarEvents(),
      eventContent: App.renderEventContent,
      eventClick: App.handleEventClick,
      select: App.handleSelect,
      selectable: true,
      selectMirror: true,
      businessHours: { daysOfWeek: [1,2,3,4,5], startTime: '07:00', endTime: '21:00' }
    });
    App.calendar.render();
  },

  buildCalendarEvents() {
    const events = [];

    // Fond hachuré pour les semaines en entreprise
    const start = new Date(CONFIG.calendarStart);
    const end   = new Date(CONFIG.calendarEnd);
    let monday  = new Date(start);
    while (monday <= end) {
      const ms = monday.toISOString().split('T')[0];
      if (!App.centreSet.has(ms)) {
        const saturday = new Date(monday);
        saturday.setDate(saturday.getDate() + 5);
        events.push({
          start: ms,
          end:   saturday.toISOString().split('T')[0],
          display: 'background',
          classNames: ['enterprise-bg'],
          extendedProps: { type: 'enterprise' }
        });
      }
      monday.setDate(monday.getDate() + 7);
    }

    // Séances
    App.sessions.forEach(s => {
      const isOwn = App.filterTeacherId
        ? s.teacher_id === App.filterTeacherId
        : App.isAdmin || s.teacher_id === App.teacher.id;
      const color = CONFIG.sessionColors[s.session_type] || '#566573';
      events.push({
        id: s.id,
        title: s.id,
        start: `${s.session_date}T${s.start_time}`,
        end:   `${s.session_date}T${s.end_time}`,
        backgroundColor: color,
        borderColor: color,
        textColor: '#fff',
        classNames: isOwn ? [] : ['other-teacher-session'],
        extendedProps: { type: 'session', session: s, isOwn }
      });
    });

    return events;
  },

  renderEventContent(info) {
    if (info.event.display === 'background') return null;
    const s = info.event.extendedProps.session;
    if (!s) return null;

    const moduleCode = s.teaching ? s.teaching.module?.code : 'Divers';
    const teachingTitle = s.teaching ? (s.teaching.title || '') : '';
    const teacherName = s.teacher ? s.teacher.name : '';
    const mins = durationMinutes(s.start_time, s.end_time);
    const short = mins <= 60;
    const isOwn = info.event.extendedProps.isOwn !== false;

    if (!isOwn) {
      if (short) {
        return { html: `<div class="fc-event-main"><span class="event-teacher">${escapeHtml(teacherName)}</span> <span class="event-module">${escapeHtml(moduleCode || 'Divers')}</span></div>` };
      }
      return {
        html: `<div class="fc-event-main">
          <div class="event-teacher" style="font-weight:700">${escapeHtml(teacherName)}</div>
          <div class="event-module">${escapeHtml(moduleCode || 'Divers')} <span class="event-type-badge">${escapeHtml(s.session_type)}</span></div>
          <div class="event-teaching">${escapeHtml(teachingTitle)}</div>
        </div>`
      };
    }

    if (short) {
      return { html: `<div class="fc-event-main"><span class="event-module">${escapeHtml(moduleCode || 'Divers')}</span> <span class="event-type-badge">${escapeHtml(s.session_type)}</span></div>` };
    }
    return {
      html: `<div class="fc-event-main">
        <div class="event-module">${escapeHtml(moduleCode || 'Divers')} <span class="event-type-badge">${escapeHtml(s.session_type)}</span></div>
        <div class="event-teaching">${escapeHtml(teachingTitle)}</div>
        <div class="event-teacher">${escapeHtml(teacherName)}</div>
        ${s.notes ? `<div class="event-notes">${escapeHtml(s.notes)}</div>` : ''}
      </div>`
    };
  },

  handleEventClick(info) {
    if (info.event.extendedProps.type !== 'session') return;
    App.openViewModal(info.event.extendedProps.session);
  },

  handleSelect(info) {
    const startDate = info.start.toISOString().split('T')[0];
    if (App.isEnterpriseDate(startDate)) {
      App.calendar.unselect();
      showToast('Semaine en entreprise — impossible de planifier un cours.', 'warning');
      return;
    }
    const startTime = info.startStr.includes('T') ? info.startStr.split('T')[1].substring(0,5) : '08:00';
    const endTime   = info.endStr.includes('T')   ? info.endStr.split('T')[1].substring(0,5)   : '10:00';
    App.calendar.unselect();
    App.openAddModal(startDate, startTime, endTime);
  },

  // ---- Session modal (ajout / modification) ----

  openAddModal(date, startTime, endTime) {
    App.editingSession = null;
    document.getElementById('sessionModalTitle').textContent = 'Ajouter une séance';
    App.fillSessionForm(null, date, startTime, endTime);
    new bootstrap.Modal(document.getElementById('sessionModal')).show();
  },

  openDuplicateModal(session) {
    App._duplicatingSession = session;

    // Build session summary
    const modCode   = session.teaching?.module?.code || '';
    const teaching  = session.teaching?.title || '';
    const timeStr   = `${formatTime(session.start_time)} – ${formatTime(session.end_time)}`;
    const color     = CONFIG.sessionColors[session.session_type] || '#566573';
    document.getElementById('dupSessionSummary').innerHTML =
      `${modCode ? '<strong>' + escapeHtml(modCode) + '</strong> — ' : ''}${escapeHtml(teaching)}` +
      ` <span class="badge ms-1" style="background:${color}">${escapeHtml(session.session_type)}</span>` +
      ` <span class="ms-2 text-muted">${escapeHtml(timeStr)}</span>`;

    const origDow = new Date(session.session_date + 'T00:00:00').getDay();
    const available = App._buildAvailableDates(session.session_date);
    App._renderDuplicateDates(available, origDow);
    App._updateDupCount();

    document.getElementById('dupFilterSameDay').onclick = () => {
      document.querySelectorAll('#dupDateList input[type=checkbox]').forEach(cb => {
        const selected = new Date(cb.value + 'T00:00:00').getDay() === origDow;
        cb.checked = selected;
        cb.closest('label').classList.toggle('selected', selected);
      });
      App._updateDupCount();
    };
    document.getElementById('dupSelectAll').onclick = () => {
      document.querySelectorAll('#dupDateList input[type=checkbox]').forEach(cb => {
        cb.checked = true;
        cb.closest('label').classList.add('selected');
      });
      App._updateDupCount();
    };
    document.getElementById('dupSelectNone').onclick = () => {
      document.querySelectorAll('#dupDateList input[type=checkbox]').forEach(cb => {
        cb.checked = false;
        cb.closest('label').classList.remove('selected');
      });
      App._updateDupCount();
    };
    document.getElementById('btnExecuteDuplicate').onclick = () => App.executeDuplicate();

    new bootstrap.Modal(document.getElementById('duplicateModal')).show();
  },

  _buildAvailableDates(excludeDate) {
    const dates = [];
    const end = new Date(CONFIG.calendarEnd + 'T00:00:00');
    const d   = new Date(CONFIG.calendarStart + 'T00:00:00');
    while (d <= end) {
      const day = d.getDay();
      if (day >= 1 && day <= 5) {
        const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (str !== excludeDate && !App.isEnterpriseDate(str)) dates.push(str);
      }
      d.setDate(d.getDate() + 1);
    }
    return dates;
  },

  _renderDuplicateDates(dates, preSelectDow) {
    const dayNames = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
    const byMonth  = {};
    dates.forEach(str => {
      const key = str.substring(0, 7);
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(str);
    });
    document.getElementById('dupDateList').innerHTML = Object.entries(byMonth).map(([key, ds]) => {
      const monthLabel = new Date(key + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      const boxes = ds.map(str => {
        const d   = new Date(str + 'T00:00:00');
        const sel = preSelectDow !== undefined && d.getDay() === preSelectDow;
        return `<label class="dup-date-label${sel ? ' selected' : ''}">` +
          `<input type="checkbox" value="${str}"${sel ? ' checked' : ''} onchange="this.closest('label').classList.toggle('selected',this.checked);App._updateDupCount()">` +
          `${escapeHtml(dayNames[d.getDay()])} ${d.getDate()}</label>`;
      }).join('');
      return `<div class="dup-month-block"><div class="dup-month-title">${escapeHtml(monthLabel)}</div>` +
             `<div class="dup-dates-grid">${boxes}</div></div>`;
    }).join('');
  },

  _updateDupCount() {
    document.getElementById('dupSelectedCount').textContent =
      document.querySelectorAll('#dupDateList input[type=checkbox]:checked').length;
  },

  async executeDuplicate() {
    const session = App._duplicatingSession;
    if (!session) return;
    const checked = [...document.querySelectorAll('#dupDateList input[type=checkbox]:checked')];
    if (!checked.length) { showToast('Sélectionnez au moins une date.', 'warning'); return; }

    const teacherId = App.isAdmin ? session.teacher_id : App.teacher.id;
    const rows = checked.map(cb => ({
      teaching_id:   session.teaching_id || null,
      teacher_id:    teacherId,
      session_date:  cb.value,
      start_time:    session.start_time,
      end_time:      session.end_time,
      session_type:  session.session_type,
      room:          session.room || '',
      student_group: session.student_group || '',
      notes:         session.notes || ''
    }));

    const btn = document.getElementById('btnExecuteDuplicate');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Création…';

    const { error } = await App.db.from('sessions').insert(rows);
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-copy me-1"></i>Créer les séances';

    if (error) { showToast('Erreur : ' + error.message, 'danger'); return; }

    bootstrap.Modal.getInstance(document.getElementById('duplicateModal'))?.hide();
    showToast(`${rows.length} séance(s) créée(s).`, 'success');
    await App.refresh();
  },

  openEditModal(session) {
    App.editingSession = session;
    document.getElementById('sessionModalTitle').textContent = 'Modifier une séance';
    App.fillSessionForm(session, session.session_date, session.start_time, session.end_time);
    new bootstrap.Modal(document.getElementById('sessionModal')).show();
  },

  fillSessionForm(session, date, startTime, endTime) {
    document.getElementById('fDate').value       = date || '';
    document.getElementById('fStartTime').value  = formatTime(startTime || '08:00');
    document.getElementById('fRoom').value        = session?.room || '';
    document.getElementById('fGroup').value       = session?.student_group || '';
    document.getElementById('fNotes').value       = session?.notes || '';

    // Durée
    const mins = startTime && endTime ? durationMinutes(startTime, endTime) : 120;
    const durSelect = document.getElementById('fDuration');
    durSelect.innerHTML = CONFIG.slotDurations.map((m, i) =>
      `<option value="${m}" ${m === mins ? 'selected' : ''}>${CONFIG.slotLabels[i]}</option>`
    ).join('');

    // Remplir le select module
    const modSelect = document.getElementById('fModule');
    const myModuleIds = App.isAdmin
      ? App.modules.map(m => m.id)
      : [...new Set(App.assignments.map(a => a.teaching?.module?.id).filter(Boolean))];

    const visibleModules = App.isAdmin
      ? App.modules
      : App.modules.filter(m => myModuleIds.includes(m.id));

    modSelect.innerHTML = '<option value="">— Sélectionner un module —</option>'
      + visibleModules.map(m => `<option value="${escapeHtml(m.id)}" ${session?.teaching?.module?.id === m.id ? 'selected' : ''}>${escapeHtml(m.code)} — ${escapeHtml(m.title)}</option>`).join('')
      + `<option value="divers" ${!session?.teaching_id ? 'selected' : ''}>Divers (hors module)</option>`;

    App.onModuleChange(session?.teaching?.module?.id || '', session?.teaching_id || '');
    modSelect.onchange = () => App.onModuleChange(modSelect.value);

    // Type
    const typeSelect = document.getElementById('fType');
    typeSelect.value = session?.session_type || 'CM';

    // Enseignant (admin only)
    const teacherWrap = document.getElementById('fTeacherWrap');
    if (App.isAdmin) {
      teacherWrap.classList.remove('d-none');
      const teacherSelect = document.getElementById('fTeacher');
      teacherSelect.innerHTML = App.teachers.map(t =>
        `<option value="${escapeHtml(t.id)}" ${t.id === (session?.teacher_id || App.teacher.id) ? 'selected' : ''}>${escapeHtml(t.name)}</option>`
      ).join('');
    } else {
      teacherWrap.classList.add('d-none');
    }
  },

  onModuleChange(moduleId, preselectedTeachingId) {
    const teachingSelect = document.getElementById('fTeaching');
    if (!moduleId || moduleId === 'divers') {
      teachingSelect.innerHTML = '<option value="">Aucun (Divers)</option>';
      teachingSelect.disabled = true;
      return;
    }
    teachingSelect.disabled = false;
    const teachings = App.isAdmin
      ? App.teachings.filter(t => t.module?.id === moduleId)
      : App.teachings.filter(t =>
          t.module?.id === moduleId &&
          App.assignments.some(a => a.teaching?.id === t.id)
        );
    teachingSelect.innerHTML = '<option value="">— Sélectionner un enseignement —</option>'
      + teachings.map(t => `<option value="${escapeHtml(t.id)}" ${t.id === preselectedTeachingId ? 'selected' : ''}>${escapeHtml(t.title)}</option>`).join('');
  },

  async saveSession() {
    const date       = document.getElementById('fDate').value;
    const startTime  = document.getElementById('fStartTime').value;
    const duration   = parseInt(document.getElementById('fDuration').value);
    const endTime    = addMinutes(startTime, duration);
    const moduleVal  = document.getElementById('fModule').value;
    const teachingId = document.getElementById('fTeaching').value || null;
    const type       = document.getElementById('fType').value;
    const room       = document.getElementById('fRoom').value.trim();
    const group      = document.getElementById('fGroup').value.trim();
    const notes      = document.getElementById('fNotes').value.trim();
    const teacherId  = App.isAdmin
      ? document.getElementById('fTeacher').value
      : App.teacher.id;

    if (!date || !startTime || !type) {
      showToast('Veuillez remplir tous les champs obligatoires.', 'danger'); return;
    }
    if (App.isEnterpriseDate(date)) {
      showToast('Semaine en entreprise — impossible de planifier un cours.', 'danger'); return;
    }
    if (endTime > '19:00') {
      showToast('La séance dépasse 19h00.', 'danger'); return;
    }

    const payload = {
      teaching_id:   (moduleVal === 'divers' || !moduleVal) ? null : (teachingId || null),
      teacher_id:    teacherId,
      session_date:  date,
      start_time:    startTime + ':00',
      end_time:      endTime + ':00',
      session_type:  type,
      room,
      student_group: group,
      notes
    };

    if (App.editingSession && App.isAdmin) {
      const { error } = await App.db.from('sessions').update(payload).eq('id', App.editingSession.id);
      if (error) { showToast('Erreur : ' + error.message, 'danger'); return; }
      showToast('Séance modifiée.', 'success');
    } else if (App.editingSession && !App.isAdmin) {
      await App.submitModificationRequest(App.editingSession, payload);
      return;
    } else {
      const { error } = await App.db.from('sessions').insert(payload);
      if (error) { showToast('Erreur : ' + error.message, 'danger'); return; }
      showToast('Séance ajoutée.', 'success');
    }

    bootstrap.Modal.getInstance(document.getElementById('sessionModal'))?.hide();
    await App.refresh();
  },

  // ---- Vue d'une séance ----

  openViewModal(session) {
    const m = document.getElementById('viewModal');
    const mod = session.teaching?.module;
    const ownSession = session.teacher_id === App.teacher.id;

    document.getElementById('viewModuleCode').textContent  = mod?.code || 'Divers';
    document.getElementById('viewTeaching').textContent    = session.teaching?.title || '—';
    document.getElementById('viewTeacher').textContent     = session.teacher?.name || '—';
    document.getElementById('viewDate').textContent        = formatDate(session.session_date);
    document.getElementById('viewTime').textContent        = `${formatTime(session.start_time)} – ${formatTime(session.end_time)}`;
    document.getElementById('viewType').innerHTML          = `<span class="type-badge ${session.session_type}">${session.session_type}</span>`;
    document.getElementById('viewRoom').textContent        = session.room || '—';
    document.getElementById('viewGroup').textContent       = session.student_group || '—';
    document.getElementById('viewNotes').textContent       = session.notes || '—';

    document.getElementById('btnDirectEdit').classList.toggle('d-none', !App.isAdmin);
    document.getElementById('btnDirectDelete').classList.toggle('d-none', !App.isAdmin);
    document.getElementById('btnReqModify').classList.toggle('d-none', App.isAdmin || !ownSession);
    document.getElementById('btnReqDelete').classList.toggle('d-none', App.isAdmin || !ownSession);
    document.getElementById('btnDuplicate').classList.toggle('d-none', !ownSession && !App.isAdmin);

    document.getElementById('btnDuplicate').onclick     = () => { bootstrap.Modal.getInstance(m).hide(); App.openDuplicateModal(session); };
    document.getElementById('btnDirectEdit').onclick   = () => { bootstrap.Modal.getInstance(m).hide(); App.openEditModal(session); };
    document.getElementById('btnDirectDelete').onclick = () => App.directDelete(session, m);
    document.getElementById('btnReqModify').onclick    = () => { bootstrap.Modal.getInstance(m).hide(); App.openEditModal(session); };
    document.getElementById('btnReqDelete').onclick    = () => App.requestDeletion(session, m);

    new bootstrap.Modal(m).show();
  },

  async directDelete(session, modalEl) {
    if (!confirm('Supprimer définitivement cette séance ?')) return;
    const { error } = await App.db.from('sessions').delete().eq('id', session.id);
    if (error) { showToast('Erreur : ' + error.message, 'danger'); return; }
    bootstrap.Modal.getInstance(modalEl)?.hide();
    showToast('Séance supprimée.', 'success');
    await App.refresh();
  },

  async submitModificationRequest(oldSession, newData) {
    const payload = {
      session_id:  oldSession.id,
      teacher_id:  App.teacher.id,
      action_type: 'modify',
      old_data:    oldSession,
      new_data:    newData
    };
    const { error } = await App.db.from('modification_requests').insert(payload);
    if (error) { showToast('Erreur : ' + error.message, 'danger'); return; }
    await App.sendEmailAlert('modification', oldSession);
    bootstrap.Modal.getInstance(document.getElementById('sessionModal'))?.hide();
    showToast('Demande de modification envoyée à l\'administrateur.', 'info');
  },

  async requestDeletion(session, modalEl) {
    if (!confirm('Envoyer une demande de suppression pour cette séance ?')) return;
    const payload = {
      session_id:  session.id,
      teacher_id:  App.teacher.id,
      action_type: 'delete',
      old_data:    session,
      new_data:    null
    };
    const { error } = await App.db.from('modification_requests').insert(payload);
    if (error) { showToast('Erreur : ' + error.message, 'danger'); return; }
    bootstrap.Modal.getInstance(modalEl)?.hide();
    await App.sendEmailAlert('suppression', session);
    showToast('Demande de suppression envoyée à l\'administrateur.', 'info');
  },

  async sendEmailAlert(action, session) {
    if (!CONFIG.emailjs.publicKey || CONFIG.emailjs.publicKey === 'VOTRE_PUBLIC_KEY') return;
    try {
      emailjs.init({ publicKey: CONFIG.emailjs.publicKey });
      await emailjs.send(CONFIG.emailjs.serviceId, CONFIG.emailjs.templateId, {
        to_email:    CONFIG.adminEmail,
        teacher_name: App.teacher.name,
        action_type: action,
        session_date: formatDate(session.session_date),
        session_time: `${formatTime(session.start_time)} – ${formatTime(session.end_time)}`,
        module_code:  session.teaching?.module?.code || 'Divers',
        app_url:      CONFIG.appUrl + 'app.html'
      });
    } catch (e) { console.warn('EmailJS error:', e); }
  },

  // ---- Compteur d'heures ----

  renderHoursCounter() {
    const container = document.getElementById('hoursCounter');
    if (!container) return;

    if (App.isAdmin && !App.filterTeacherId) {
      container.innerHTML = '<p class="text-muted" style="font-size:12px">Sélectionnez un enseignant dans le filtre pour voir son décompte d\'heures.</p>';
      return;
    }

    // Calculer les heures posées par (teaching_id, type) pour l'enseignant affiché
    const targetTeacherId = App.filterTeacherId || App.teacher.id;
    const placed = {};
    App.sessions.forEach(s => {
      if (!s.teaching_id || s.teacher_id !== targetTeacherId) return;
      const key = `${s.teaching_id}_${s.session_type}`;
      placed[key] = (placed[key] || 0) + durationMinutes(s.start_time, s.end_time) / 60;
    });

    // Grouper les assignments par module
    const myAssignments = App.assignments.filter(a => a.teacher_id === targetTeacherId);

    const byModule = {};
    myAssignments.forEach(a => {
      const code = a.teaching?.module?.code;
      if (!code) return;
      if (!byModule[code]) byModule[code] = { assignments: [], module: a.teaching.module };
      byModule[code].assignments.push(a);
    });

    if (Object.keys(byModule).length === 0) {
      container.innerHTML = '<p class="text-muted" style="font-size:12px">Aucun enseignement affecté.</p>';
      return;
    }

    let html = '';
    Object.entries(byModule).sort(([a],[b]) => a.localeCompare(b)).forEach(([code, { assignments, module }]) => {
      const totals = { cm: 0, td: 0, tp: 0 };
      const done   = { cm: 0, td: 0, tp: 0 };
      assignments.forEach(a => {
        totals.cm += a.cm_hours || 0;
        totals.td += a.td_hours || 0;
        totals.tp += a.tp_hours || 0;
        done.cm   += placed[`${a.teaching_id}_CM`]  || 0;
        done.td   += placed[`${a.teaching_id}_TD`]  || 0;
        done.tp   += placed[`${a.teaching_id}_TP`]  || 0;
      });

      const pills = [];
      if (totals.cm > 0) pills.push(App.hoursPill('CM', done.cm, totals.cm));
      if (totals.td > 0) pills.push(App.hoursPill('TD', done.td, totals.td));
      if (totals.tp > 0) pills.push(App.hoursPill('TP', done.tp, totals.tp));

      html += `<div class="module-block">
        <div class="module-code">${escapeHtml(code)}</div>
        <div class="module-title">${escapeHtml(module?.title || '')}</div>
        <div class="hours-row">${pills.join('')}</div>
      </div>`;
    });
    container.innerHTML = html;
  },

  hoursPill(type, done, total) {
    const cls = `type-${type.toLowerCase()}`;
    const over = done > total;
    const doneClass = over ? 'over' : 'done';
    return `<span class="hours-pill ${cls}" title="${type} : ${done.toFixed(1)}h / ${total.toFixed(1)}h">
      ${type}: <span class="${doneClass}">${done.toFixed(1)}</span>/${total.toFixed(1)}h
    </span>`;
  },

  // ---- Filtre enseignant (admin) ----

  renderTeacherFilter() {
    const sel = document.getElementById('teacherFilter');
    if (!sel) return;
    sel.innerHTML = '<option value="">Tous les enseignants</option>'
      + App.teachers.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');
    sel.onchange = async () => {
      App.filterTeacherId = sel.value || null;
      await App.loadSessions();
      await App.calendar?.removeAllEvents();
      App.calendar?.addEventSource(App.buildCalendarEvents());
      App.renderHoursCounter();
    };
  },

  // ---- Admin panel ----

  renderRequestsBadge() {
    const badge = document.getElementById('requestsBadge');
    if (!badge) return;
    const pending = App.requests.filter(r => r.status === 'pending').length;
    badge.textContent = pending;
    badge.classList.toggle('d-none', pending === 0);
  },

  openAdminPanel() {
    App.renderAdminStats();
    App.renderAdminRequests();
    App.renderAdminTeachers();
    new bootstrap.Offcanvas(document.getElementById('adminPanel')).show();
  },

  renderAdminStats() {
    const container = document.getElementById('statsContainer');

    const placed = {};
    App.sessions.forEach(s => {
      if (!s.teaching_id || !s.teacher_id) return;
      const key = `${s.teaching_id}_${s.teacher_id}_${s.session_type}`;
      placed[key] = (placed[key] || 0) + durationMinutes(s.start_time, s.end_time) / 60;
    });

    const rows = App.assignments.map(a => {
      const teacher = App.teachers.find(t => t.id === a.teacher_id);
      const mod = a.teaching?.module;
      const cm_done = placed[`${a.teaching_id}_${a.teacher_id}_CM`]  || 0;
      const td_done = placed[`${a.teaching_id}_${a.teacher_id}_TD`]  || 0;
      const tp_done = placed[`${a.teaching_id}_${a.teacher_id}_TP`]  || 0;
      return { teacher, mod, a, cm_done, td_done, tp_done };
    }).filter(r => r.teacher && r.mod);

    rows.sort((a,b) => (a.mod?.code||'').localeCompare(b.mod?.code||'') || (a.a.teaching?.title||'').localeCompare(b.a.teaching?.title||'') || (a.teacher?.name||'').localeCompare(b.teacher?.name||''));

    container.innerHTML = `<table class="table table-sm table-bordered stat-table">
      <thead><tr>
        <th>Module</th><th>Enseignement</th><th>Enseignant</th>
        <th>CM prévu</th><th>CM posé</th>
        <th>TD prévu</th><th>TD posé</th>
        <th>TP prévu</th><th>TP posé</th>
      </tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td><strong>${escapeHtml(r.mod?.code)}</strong></td>
        <td>${escapeHtml(r.a.teaching?.title || '')}</td>
        <td>${escapeHtml(r.teacher?.name)}</td>
        <td>${r.a.cm_hours}h</td><td class="${r.cm_done > r.a.cm_hours ? 'text-danger fw-bold' : r.cm_done >= r.a.cm_hours && r.a.cm_hours > 0 ? 'text-success' : ''}">${r.cm_done.toFixed(1)}h</td>
        <td>${r.a.td_hours}h</td><td class="${r.td_done > r.a.td_hours ? 'text-danger fw-bold' : r.td_done >= r.a.td_hours && r.a.td_hours > 0 ? 'text-success' : ''}">${r.td_done.toFixed(1)}h</td>
        <td>${r.a.tp_hours}h</td><td class="${r.tp_done > r.a.tp_hours ? 'text-danger fw-bold' : r.tp_done >= r.a.tp_hours && r.a.tp_hours > 0 ? 'text-success' : ''}">${r.tp_done.toFixed(1)}h</td>
      </tr>`).join('')}</tbody>
    </table>`;
  },

  renderAdminRequests() {
    const container = document.getElementById('requestsContainer');
    const pending = App.requests.filter(r => r.status === 'pending');
    if (pending.length === 0) {
      container.innerHTML = '<div class="empty-state"><i class="bi bi-check-circle"></i><br>Aucune demande en attente.</div>';
      return;
    }
    container.innerHTML = pending.map(r => {
      const s = r.old_data;
      return `<div class="card mb-2">
        <div class="card-body p-2">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <span class="badge ${r.action_type === 'delete' ? 'bg-danger' : 'bg-warning text-dark'} me-1">${r.action_type === 'delete' ? 'Suppression' : 'Modification'}</span>
              <strong>${escapeHtml(r.teacher?.name)}</strong>
              <div class="text-muted" style="font-size:11px">${formatDate(s.session_date)} ${formatTime(s.start_time)}–${formatTime(s.end_time)}</div>
              ${r.action_type === 'modify' && r.new_data ? `<div style="font-size:11px" class="text-info">→ ${formatDate(r.new_data.session_date)} ${formatTime(r.new_data.start_time)}–${formatTime(r.new_data.end_time)}</div>` : ''}
            </div>
            <div class="d-flex gap-1">
              <button class="btn btn-sm btn-success" onclick="App.approveRequest('${r.id}')"><i class="bi bi-check"></i></button>
              <button class="btn btn-sm btn-danger" onclick="App.rejectRequest('${r.id}')"><i class="bi bi-x"></i></button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');
  },

  async approveRequest(requestId) {
    const req = App.requests.find(r => r.id === requestId);
    if (!req) return;
    if (req.action_type === 'delete') {
      await App.db.from('sessions').delete().eq('id', req.session_id);
    } else if (req.action_type === 'modify' && req.new_data) {
      const allowed = ['teaching_id', 'session_date', 'start_time', 'end_time', 'session_type', 'room', 'student_group', 'notes'];
      const safeData = Object.fromEntries(Object.entries(req.new_data).filter(([k]) => allowed.includes(k)));
      await App.db.from('sessions').update(safeData).eq('id', req.session_id);
    }
    await App.db.from('modification_requests').update({ status: 'approved' }).eq('id', requestId);
    showToast('Demande approuvée.', 'success');
    await App.loadRequests();
    await App.refresh();
    App.renderAdminRequests();
  },

  async rejectRequest(requestId) {
    await App.db.from('modification_requests').update({ status: 'rejected' }).eq('id', requestId);
    showToast('Demande rejetée.', 'info');
    await App.loadRequests();
    App.renderAdminRequests();
  },

  renderAdminTeachers() {
    const container = document.getElementById('teachersContainer');
    container.innerHTML = `
      <div class="mb-2">
        <button class="btn btn-sm btn-primary" onclick="App.openAddTeacherModal()"><i class="bi bi-plus"></i> Ajouter un enseignant</button>
      </div>
      <table class="table table-sm table-hover">
        <thead><tr><th>Nom</th><th>Type</th><th>Email</th><th>Admin</th><th></th></tr></thead>
        <tbody>
          ${App.teachers.map(t => `<tr>
            <td>${escapeHtml(t.name)}</td>
            <td><span class="badge ${t.teacher_type === 'CNAM' ? 'bg-primary' : 'bg-secondary'}">${escapeHtml(t.teacher_type)}</span></td>
            <td><small class="${t.email ? '' : 'text-danger'}">${escapeHtml(t.email) || '⚠ non renseigné'}</small></td>
            <td>${t.is_admin ? '<i class="bi bi-shield-check text-success"></i>' : ''}</td>
            <td><button class="btn btn-sm btn-outline-primary" onclick="App.openEditTeacherModal('${t.id}')"><i class="bi bi-pencil"></i></button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  },

  openAddTeacherModal() {
    document.getElementById('teacherModalTitle').textContent = 'Ajouter un enseignant';
    document.getElementById('tId').value    = '';
    document.getElementById('tName').value  = '';
    document.getElementById('tEmail').value = '';
    document.getElementById('tType').value  = 'CNAM';
    document.getElementById('tAdmin').checked = false;
    new bootstrap.Modal(document.getElementById('teacherModal')).show();
  },

  openEditTeacherModal(id) {
    const t = App.teachers.find(x => x.id === id);
    if (!t) return;
    document.getElementById('teacherModalTitle').textContent = 'Modifier un enseignant';
    document.getElementById('tId').value    = t.id;
    document.getElementById('tName').value  = t.name;
    document.getElementById('tEmail').value = t.email || '';
    document.getElementById('tType').value  = t.teacher_type;
    document.getElementById('tAdmin').checked = t.is_admin;
    new bootstrap.Modal(document.getElementById('teacherModal')).show();
  },

  async saveTeacher() {
    const id    = document.getElementById('tId').value;
    const name  = document.getElementById('tName').value.trim();
    const email = document.getElementById('tEmail').value.trim().toLowerCase() || null;
    const type  = document.getElementById('tType').value;
    const admin = document.getElementById('tAdmin').checked;

    if (!name) { showToast('Le nom est obligatoire.', 'danger'); return; }

    const payload = { name, email, teacher_type: type, is_admin: admin };
    let error;
    if (id) {
      ({ error } = await App.db.from('teachers').update(payload).eq('id', id));
    } else {
      ({ error } = await App.db.from('teachers').insert(payload));
    }
    if (error) { showToast('Erreur : ' + error.message, 'danger'); return; }

    bootstrap.Modal.getInstance(document.getElementById('teacherModal'))?.hide();
    showToast(id ? 'Enseignant modifié.' : 'Enseignant ajouté.', 'success');
    await App.loadReferenceData();
    App.renderAdminTeachers();
    App.renderTeacherFilter();
  },

  // ---- Export ----

  exportMine() {
    const target = App.filterTeacherId ? App.teachers.find(t => t.id === App.filterTeacherId) : App.teacher;
    const sessions = App.sessions.filter(s => s.teacher_id === target.id);
    exportTeacherPDF(target, sessions, App.assignments);
  },

  exportMineExcel() {
    const target = App.filterTeacherId ? App.teachers.find(t => t.id === App.filterTeacherId) : App.teacher;
    const sessions = App.sessions.filter(s => s.teacher_id === target.id);
    exportTeacherExcel(target, sessions);
  },

  exportWeekPDF() {
    const visibleDate = App.calendar?.getDate();
    if (!visibleDate) return;
    const monday = new Date(visibleDate);
    const day = monday.getDay();
    monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1));
    const pad = n => String(n).padStart(2, '0');
    const localStr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const mondayStr = localStr(monday);
    const friday = new Date(monday);
    friday.setDate(friday.getDate() + 4);
    const fridayStr = localStr(friday);
    const weekSessions = App.sessions.filter(s => s.session_date >= mondayStr && s.session_date <= fridayStr);
    const label = `Semaine du ${monday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    exportWeeklyPDF(label, mondayStr, weekSessions, App.teachers);
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
