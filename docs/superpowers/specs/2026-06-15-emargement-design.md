# Module d'émargement numérique — Spec technique
**Date :** 2026-06-15  
**Projet :** gestionEDT DSP Préleveur — CNAM Intechmer  
**Statut :** Approuvé, prêt pour implémentation

---

## Contexte

L'application de gestion de l'EDT (GitHub Pages + Supabase) gère aujourd'hui les séances planifiées et les enseignants. Ce module ajoute la gestion des présences étudiantes avec émargement numérique signé par QR code, sans compte Supabase pour les étudiants.

**Contraintes clés :**
- 16 étudiants maximum, adresses `@lecnam.net`
- Pas de compte Supabase Auth pour les étudiants (trop lourd)
- Pas de géolocalisation (RGPD)
- Zéro friction pour l'enseignant
- Anti-fraude : QR dynamique (2 min) + identité liée à l'appareil (localStorage)
- Stack identique : HTML/CSS/JS vanilla, Supabase, GitHub Pages

---

## Modèle de données

### Nouvelles tables

```sql
-- Étudiants (pré-enregistrés par l'admin)
CREATE TABLE students (
  id   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- Tokens QR rotatifs (un actif par séance, expire toutes les 2 min)
CREATE TABLE attendance_tokens (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Émargements (un seul par étudiant par séance)
CREATE TABLE attendances (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id     UUID REFERENCES sessions(id) ON DELETE CASCADE,
  student_id     UUID REFERENCES students(id) ON DELETE CASCADE,
  signed_at      TIMESTAMPTZ DEFAULT NOW(),
  signature_data TEXT,       -- SVG path de la signature manuscrite
  signed_by_admin BOOLEAN DEFAULT FALSE,
  UNIQUE(session_id, student_id)
);
```

### RLS

- `students` : lecture publique (`anon`), écriture admin uniquement
- `attendance_tokens` : lecture/écriture admin uniquement (la création se fait côté enseignant authentifié)
- `attendances` : lecture admin uniquement ; insertion via RPC uniquement (pas de policy INSERT directe)

### RPC de validation côté serveur

```sql
CREATE OR REPLACE FUNCTION sign_attendance(
  p_token      TEXT,
  p_student_id UUID,
  p_signature  TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_session_id UUID;
  v_date       DATE;
BEGIN
  -- Valider le token (non expiré)
  SELECT at.session_id, s.session_date
    INTO v_session_id, v_date
    FROM attendance_tokens at
    JOIN sessions s ON s.id = at.session_id
   WHERE at.token = p_token
     AND at.expires_at > NOW();

  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_invalide');
  END IF;

  -- Vérifier que la séance est aujourd'hui
  IF v_date <> CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mauvaise_date');
  END IF;

  -- Insérer (ignoré si déjà émargé)
  INSERT INTO attendances (session_id, student_id, signature_data)
  VALUES (v_session_id, p_student_id, p_signature)
  ON CONFLICT (session_id, student_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'deja_emarge');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;
```

La RPC est appelable par `anon` — la logique métier et la sécurité sont entièrement dans la fonction PostgreSQL.

---

## Nouveau fichier : `attendance.html`

Page légère, sans navigation, optimisée mobile. Chargée uniquement depuis un QR code.

### Dépendances CDN (ajoutées uniquement à cette page)
- `signature_pad.js` — pad de signature tactile
- `qrcode.js` — génération QR côté client (utilisé dans `app.html`)

### Flux étudiant

```
URL : attendance.html?token=<uuid>

1. Lecture du token dans l'URL
2. Appel Supabase pour récupérer les infos de séance associées au token
   → Si token invalide/expiré : page d'erreur "QR expiré, demandez à l'enseignant"
3. Lecture localStorage["my_student_id"]
   → Si absent : afficher liste déroulante des 16 étudiants (ordre alphabétique)
     → Sélection → stocker l'UUID en localStorage
4. Affichage : "Bonjour [Prénom NOM] — [Intitulé séance] le [date] à [heure]"
5. Zone de signature (canvas signature_pad.js)
   → Bouton "Effacer" pour recommencer
6. Bouton "Confirmer ma présence" (activé uniquement si signature présente)
7. Appel RPC sign_attendance(token, student_id, svg_path)
   → Succès : "Présence enregistrée ✓ à [heure]"
   → Déjà émargé : "Vous avez déjà émargé pour ce cours"
   → Erreur token : "QR expiré"
```

### Comportement du localStorage
- Clé : `attendance_student_id` → UUID de l'étudiant sélectionné
- Clé : `attendance_student_name` → nom affiché (pour l'accueil personnalisé)
- Si l'étudiant veut changer d'identité : lien discret "Ce n'est pas moi ?" qui réaffiche la liste

---

## Modifications de `app.html` / `app.js`

### Panneau d'émargement enseignant (auto)

Quand une séance est détectée comme "en cours" (`session_date = aujourd'hui` ET `start_time ≤ heure actuelle ≤ end_time`), un widget apparaît automatiquement dans l'interface :

- **QR code** généré avec `qrcode.js`, encodant l'URL `attendance.html?token=<uuid>`
- Rotation silencieuse toutes les **2 minutes** : nouveau token inséré en base, QR régénéré, tous les tokens expirés de cette séance supprimés
- Compteur temps réel : « **11 / 16** présents » (Supabase Realtime sur `attendances`)
- Liste verte des présents / rouge des absents
- Bouton par absent : « Émarger manuellement » → insère avec `signed_by_admin = true`, sans signature
- Bascule manuelle : « Fermer / Rouvrir l'émargement » (stoppe/reprend la rotation du token)
- Si plusieurs séances simultanées (cas rare) : un widget par séance

### Onglet « Présences » dans le panneau admin

Vue par séance :
- Sélecteur de date + liste des séances du jour ou d'une période
- Tableau : Nom étudiant | Heure d'émargement | Signature (miniature cliquable) | Émargé par admin
- Boutons : émarger manuellement un absent, retirer un émargement

Vue par étudiant :
- Tableau : Date | Module | Enseignant | Présent/Absent
- Taux de présence global et par module

Statistiques globales :
- Tableau croisé étudiants × modules avec taux de présence
- Alerte visuelle si un étudiant dépasse 20% d'absences sur l'ensemble des séances (seuil fixe, modifiable dans `config.js` via `ABSENCE_ALERT_THRESHOLD`)

---

## Exports PDF

### Feuille d'émargement remplie (par séance)

Contenu :
- En-tête : formation, module, date, horaire, enseignant
- Tableau : N° | Nom étudiant | Heure d'émargement | Signature (image SVG inline)
- Pied de page : date d'export, mention "Document généré automatiquement"

Accessible depuis : panneau admin → onglet Présences → bouton "Exporter PDF"

### Feuille d'émargement vierge (par séance)

Même mise en page qu'une feuille remplie mais :
- Colonnes "Heure" et "Signature" vides (lignes pour saisie manuscrite)
- Mention "Feuille d'émargement papier — à conserver"
- Génération possible pour n'importe quelle séance planifiée (passée ou future)

Accessible depuis : panneau admin → onglet Présences → bouton "Feuille vierge PDF"

### Export Excel des présences

Tableau complet exportable : toutes les séances × tous les étudiants, avec statuts présent/absent. Format compatible avec le système d'export Excel existant (`export.js`).

---

## Anti-fraude — synthèse

| Risque | Contre-mesure |
|---|---|
| Émarger depuis chez soi | Token visible uniquement sur le projecteur en classe, expire en 2 min |
| Photographier le QR et l'envoyer | Délai de partage > durée de validité du token (2 min) |
| Émarger pour un camarade absent | `student_id` lié au localStorage de l'appareil ; impossible de changer sans accès physique au téléphone |
| Double émargement | Contrainte `UNIQUE(session_id, student_id)` en base |
| Contourner la validation client | Toute la logique est dans la RPC PostgreSQL côté serveur |
| Faux student_id en API directe | La RPC valide token + date + unicité ; un UUID inventé ne correspondra à aucun étudiant |

---

## Stockage — estimation

- ~150 séances/an × 16 étudiants = ~2 400 émargements
- Signature SVG path : ~3-5 KB chacune
- **Total signatures : ~10 MB** — négligeable (quota gratuit Supabase : 500 MB)

---

## Livrables

1. `supabase/migration_attendance.sql` — nouvelles tables + RPC + RLS
2. `attendance.html` — page d'émargement étudiant
3. `assets/js/app.js` — widget QR enseignant + onglet admin présences
4. `assets/js/export.js` — feuilles d'émargement remplies + vierges + Excel
5. `assets/css/style.css` — styles du widget QR et de la page attendance

---

## Hors périmètre

- Notifications email aux étudiants absents (possible en extension future)
- Authentification Supabase Auth pour les étudiants
- Géolocalisation
