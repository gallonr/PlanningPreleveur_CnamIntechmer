// ============================================================
// Configuration — à renseigner après création du projet Supabase
// ============================================================

const CONFIG = {
  supabaseUrl:     'https://bwdxyedirjwjssxinjzt.supabase.co',
  supabaseAnonKey: 'sb_publishable_40eHSqPTMnxz2dUGMFF0yg_lnS2FRO2',

  // URL de votre GitHub Pages (doit correspondre exactement)
  appUrl: 'https://gallonr.github.io/PlanningPreleveur_CnamIntechmer/',

  adminEmail: 'regis.gallon@lecnam.net',

  // EmailJS — créer un compte sur emailjs.com
  emailjs: {
    serviceId:  'VOTRE_SERVICE_ID',
    templateId: 'VOTRE_TEMPLATE_ID',
    publicKey:  'VOTRE_PUBLIC_KEY'
  },

  // Année scolaire
  calendarStart: '2026-08-31',
  calendarEnd:   '2027-07-30',

  // Durées de créneaux autorisées (minutes)
  slotDurations: [60, 90, 120, 180, 210, 240],
  slotLabels:    ['1h', '1h30', '2h', '3h', '3h30', '4h'],

  // Couleurs des types de séances
  sessionColors: {
    CM:     '#1a5276',
    TD:     '#1d8348',
    TP:     '#7d6608',
    Divers: '#566573'
  }
};
