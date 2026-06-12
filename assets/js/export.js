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

  doc.setFontSize(14);
  doc.setTextColor(0, 49, 137);
  doc.text(`Emploi du temps étudiant — ${weekLabel}`, 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(`DSP Préleveur en Milieu Naturel 2026-2027 — CNAM Intechmer`, 14, 22);

  const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
  const rows = [];

  const byDay = {};
  sessions.forEach(s => {
    const d = new Date(s.session_date + 'T00:00:00').getDay();
    const key = d === 1 ? 0 : d === 2 ? 1 : d === 3 ? 2 : d === 4 ? 3 : d === 5 ? 4 : -1;
    if (key < 0) return;
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(s);
  });

  const maxRows = Math.max(...days.map((_, i) => (byDay[i] || []).length), 1);
  for (let r = 0; r < maxRows; r++) {
    const row = [];
    for (let d = 0; d < 5; d++) {
      const s = (byDay[d] || [])[r];
      if (s) {
        const teacherName = s.teacher ? s.teacher.name : '';
        const code = s.teaching ? s.teaching.module?.code || 'Divers' : 'Divers';
        const title = s.teaching ? s.teaching.title || '' : '';
        row.push(`${formatTime(s.start_time)}-${formatTime(s.end_time)}\n${code} ${s.session_type}\n${title}\n${teacherName}${s.room ? ' • ' + s.room : ''}`);
      } else {
        row.push('');
      }
    }
    rows.push(row);
  }

  doc.autoTable({
    startY: 28,
    head: [days],
    body: rows,
    styles: { fontSize: 8, cellPadding: 3, valign: 'top' },
    headStyles: { fillColor: [0, 49, 137], textColor: 255, fontStyle: 'bold', halign: 'center' },
    alternateRowStyles: { fillColor: [234, 242, 251] },
    columnStyles: { 0: { cellWidth: 54 }, 1: { cellWidth: 54 }, 2: { cellWidth: 54 }, 3: { cellWidth: 54 }, 4: { cellWidth: 54 } }
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
