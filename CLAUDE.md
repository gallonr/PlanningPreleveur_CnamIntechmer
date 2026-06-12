# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static web app (GitHub Pages) for managing teaching schedules for the DSP "Préleveur en Milieu Naturel" training program at CNAM Intechmer. No build step — all files are served as-is.

**Live URL:** https://gallonr.github.io/PlanningPreleveur_CnamIntechmer/  
**Admin email:** regis.gallon@lecnam.net

## Deployment

Pushing to `main` deploys automatically via GitHub Pages. There is no build, bundler, or package manager. Test changes by opening `index.html` or `app.html` directly in a browser, or via a local HTTP server:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

After any schema change, re-run `supabase/schema.sql` in the Supabase SQL Editor (copy raw content — do not pipe through the terminal to avoid shell prompt contamination).

## Architecture

All JS runs in the browser with no module system. Scripts are loaded via `<script>` tags in dependency order and share globals:

```
config.js   → CONFIG object (Supabase URL/key, EmailJS keys, constants)
auth.js     → getClient(), requireAuth(), showToast(), date/time helpers
export.js   → exportTeacherPDF(), exportWeeklyPDF(), exportTeacherExcel()
app.js      → App object — all application logic
```

`App` in `app.js` is a plain object holding both state and methods. `App.init()` is the entry point called on `DOMContentLoaded`. State lives in `App.sessions`, `App.modules`, `App.teachings`, `App.assignments`, `App.centrePeriods`, etc.

## Data model (Supabase / PostgreSQL)

```
modules → teachings → teaching_assignments (teacher_id, cm_hours, td_hours, tp_hours)
                                ↓
                           sessions (teacher_id, teaching_id, date, start/end time, type)
                                ↓
                      modification_requests (action: modify|delete, status: pending|approved|rejected)

centre_periods   — weeks when students are on-site (courses allowed)
```

Key constraint: sessions outside `centre_periods` are blocked client-side in `App.isEnterpriseDate()`. The centre/enterprise alternation (23 centre weeks, 25 enterprise weeks) runs Sept 2026 – July 2027.

Hours tracking: `teaching_assignments.{cm,td,tp}_hours` are the targets per (teacher, teaching) pair. Placed hours are summed from `sessions` duration at render time in `App.renderHoursCounter()`.

## Auth flow

Magic link via Supabase Auth. `index.html` calls `signInWithMagicLink(email)` which sends an email with a link redirecting to `app.html`. On load, `app.js` calls `requireAuth()` → if no session, redirects to `index.html`. Teachers are matched by `auth.email()` against `teachers.email` (nullable — admin must fill emails before teachers can log in).

Admin is detected by `teachers.is_admin = TRUE`. The admin email is `regis.gallon@lecnam.net`.

## Modification workflow

Teachers cannot directly edit or delete their own past sessions. Instead, they submit a `modification_requests` row. EmailJS sends an alert to the admin. The admin approves/rejects in the Admin panel offcanvas (`#adminPanel`). On approval, `App.approveRequest()` applies the change to `sessions` directly.

## Key config to update

`assets/js/config.js` contains placeholder values that must be replaced:
- `supabaseUrl` / `supabaseAnonKey` — from Supabase project Settings → API
- `emailjs.*` — from emailjs.com (optional, alerts still work without it)

Supabase dashboard must have `https://gallonr.github.io/PlanningPreleveur_CnamIntechmer/app.html` in Authentication → URL Configuration → Redirect URLs.

## SQL caution

Avoid em dashes (`—`) and en dashes (`–`) inside SQL string literals — they cause parse errors in the Supabase SQL editor. Use plain hyphens (`-`). These characters are safe in SQL comments (`--`).
