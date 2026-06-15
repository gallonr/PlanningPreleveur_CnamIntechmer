// ============================================================
// Export PDF et Excel
// ============================================================

function exportTeacherPDF(teacher, sessions, assignments) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFontSize(14);
  doc.setTextColor(0, 49, 137);
  doc.text(`Planning — ${teacher.name}`, 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(`DSP Préleveur en Milieu Naturel 2026-2027 — CNAM Intechmer`, 14, 22);
  doc.text(`Exporté le ${new Date().toLocaleDateString('fr-FR')}`, 14, 28);

  const rows = sessions
    .sort((a, b) => a.session_date.localeCompare(b.session_date) || a.start_time.localeCompare(b.start_time))
    .map(s => [
      formatDate(s.session_date),
      `${formatTime(s.start_time)} – ${formatTime(s.end_time)}`,
      s.teaching ? s.teaching.module?.code || '' : 'Divers',
      s.teaching ? s.teaching.title || '' : '',
      s.session_type,
      s.room || '',
      s.student_group || ''
    ]);

  doc.autoTable({
    startY: 34,
    head: [['Date', 'Horaire', 'Module', 'Enseignement', 'Type', 'Salle', 'Groupe']],
    body: rows,
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [0, 49, 137], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [234, 242, 251] },
    columnStyles: { 0: { cellWidth: 42 }, 1: { cellWidth: 28 }, 4: { cellWidth: 14 } }
  });

  doc.save(`planning_${teacher.name.replace(/\s+/g, '_')}_2026-2027.pdf`);
}

function exportWeeklyPDF(weekLabel, weekStart, sessions, allTeachers) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Layout
  const ML = 14, MR = 10;
  const TIME_W = 13;
  const HEADER_H = 30;
  const CAL_X = ML + TIME_W;
  const CAL_Y = HEADER_H + 4;
  const CAL_W = 297 - ML - MR - TIME_W;
  const CAL_H = 210 - CAL_Y - 8;
  const DAY_W = CAL_W / 5;
  const DAY_HDR_H = 7;
  const GRID_Y = CAL_Y + DAY_HDR_H;
  const GRID_H = CAL_H - DAY_HDR_H;

  const SESSION_COLORS = { CM: [26,82,118], TD: [29,131,72], TP: [125,102,8] };
  const toMin = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };

  // Dynamic time range
  let tMin = 8*60, tMax = 18*60;
  sessions.forEach(s => {
    tMin = Math.min(tMin, Math.floor(toMin(s.start_time)/30)*30);
    tMax = Math.max(tMax, Math.ceil(toMin(s.end_time)/30)*30);
  });
  const tSpan = tMax - tMin;
  const timeToY = min => GRID_Y + (min - tMin) / tSpan * GRID_H;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0, 49, 137);
  doc.text(`Emploi du temps — ${weekLabel}`, ML, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(80, 80, 80);
  doc.text('DSP Préleveur en Milieu Naturel 2026-2027 — CNAM Intechmer', ML, 21);
  doc.text(`Exporté le ${new Date().toLocaleDateString('fr-FR')}`, ML, 27);

  // Day headers
  const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
  const monday = new Date(weekStart + 'T00:00:00');
  doc.setFillColor(0, 49, 137);
  doc.rect(CAL_X, CAL_Y, CAL_W, DAY_HDR_H, 'F');
  days.forEach((day, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    const dateStr = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text(`${day} ${dateStr}`, CAL_X + i * DAY_W + DAY_W / 2, CAL_Y + DAY_HDR_H - 2, { align: 'center' });
  });

  // Time grid
  for (let t = tMin; t <= tMax; t += 30) {
    const y = timeToY(t);
    const hh = String(Math.floor(t/60)).padStart(2,'0');
    const mm = String(t%60).padStart(2,'0');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(130, 130, 130);
    doc.text(`${hh}:${mm}`, CAL_X - 1, y + 1, { align: 'right' });
    doc.setDrawColor(t % 60 === 0 ? 190 : 225, t % 60 === 0 ? 190 : 225, t % 60 === 0 ? 190 : 225);
    doc.setLineWidth(t % 60 === 0 ? 0.25 : 0.1);
    doc.line(CAL_X, y, CAL_X + CAL_W, y);
  }

  // Column separators
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.2);
  for (let i = 1; i < 5; i++) doc.line(CAL_X + i*DAY_W, GRID_Y, CAL_X + i*DAY_W, CAL_Y + CAL_H);

  // Outer border
  doc.setDrawColor(80, 80, 80);
  doc.setLineWidth(0.4);
  doc.rect(CAL_X, CAL_Y, CAL_W, CAL_H);

  // Group sessions by day and assign lanes for overlaps
  const byDay = [[],[],[],[],[]];
  sessions.forEach(s => {
    const d = new Date(s.session_date + 'T00:00:00').getDay();
    const idx = [1,2,3,4,5].indexOf(d);
    if (idx >= 0) byDay[idx].push(s);
  });

  byDay.forEach((daySessions, dayIdx) => {
    daySessions.sort((a,b) => a.start_time.localeCompare(b.start_time));
    const laneEnds = [];
    const assigned = daySessions.map(s => {
      const sm = toMin(s.start_time), em = toMin(s.end_time);
      let lane = laneEnds.findIndex(e => e <= sm);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(em); } else { laneEnds[lane] = em; }
      return { s, lane };
    });
    const numLanes = Math.max(laneEnds.length, 1);

    assigned.forEach(({ s, lane }) => {
      const sm = toMin(s.start_time), em = toMin(s.end_time);
      const laneW = DAY_W / numLanes;
      const bx = CAL_X + dayIdx * DAY_W + lane * laneW + 0.5;
      const by = timeToY(sm);
      const bw = laneW - 1;
      const bh = timeToY(em) - by;

      const [r,g,b] = SESSION_COLORS[s.session_type] || [86,101,115];
      doc.setFillColor(r, g, b);
      doc.setDrawColor(Math.floor(r*0.65), Math.floor(g*0.65), Math.floor(b*0.65));
      doc.setLineWidth(0.2);
      doc.roundedRect(bx, by, bw, bh, 0.8, 0.8, 'FD');

      doc.setTextColor(255, 255, 255);
      const code = s.teaching?.module?.code || 'Divers';
      const title = s.teaching?.title || '';
      const teacher = s.teacher?.name || '';
      const timeStr = `${formatTime(s.start_time)}-${formatTime(s.end_time)}`;
      const PAD = 1.2;
      const short = bh < 14;

      if (short) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5);
        doc.text(`${code} ${s.session_type}`, bx+PAD, by+PAD+3.5, { maxWidth: bw-2*PAD });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5);
        doc.text(timeStr, bx+PAD, by+PAD+7, { maxWidth: bw-2*PAD });
      } else {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
        doc.text(code, bx+PAD, by+PAD+3.5, { maxWidth: bw-2*PAD });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6);
        let ty = by + PAD + 7;
        doc.text(s.session_type, bx+PAD, ty, { maxWidth: bw-2*PAD }); ty += 3.5;
        if (title && bh > 22) { doc.text(title, bx+PAD, ty, { maxWidth: bw-2*PAD }); ty += 3.5; }
        if (teacher && bh > 28) { doc.text(teacher, bx+PAD, ty, { maxWidth: bw-2*PAD }); }
        doc.text(timeStr, bx+PAD, by+bh-PAD-1, { maxWidth: bw-2*PAD });
      }
    });
  });

  doc.save(`edt_etudiants_${weekLabel.replace(/\s+/g, '_')}.pdf`);
}

function exportTeacherExcel(teacher, sessions) {
  const rows = sessions
    .sort((a, b) => a.session_date.localeCompare(b.session_date))
    .map(s => ({
      'Date':        s.session_date,
      'Heure début': formatTime(s.start_time),
      'Heure fin':   formatTime(s.end_time),
      'Durée (h)':   (durationMinutes(s.start_time, s.end_time) / 60).toFixed(2),
      'Module':      s.teaching ? s.teaching.module?.code || '' : 'Divers',
      'Enseignement': s.teaching ? s.teaching.title || '' : '',
      'Type':        s.session_type,
      'Salle':       s.room || '',
      'Groupe':      s.student_group || '',
      'Notes':       s.notes || ''
    }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [10, 10, 10, 10, 10, 40, 8, 12, 12, 20].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Planning');
  XLSX.writeFile(wb, `planning_${teacher.name.replace(/\s+/g, '_')}_2026-2027.xlsx`);
}

function exportStatsExcel(statsRows) {
  const ws = XLSX.utils.json_to_sheet(statsRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Statistiques');
  XLSX.writeFile(wb, `stats_heures_DSP_2026-2027.xlsx`);
}
