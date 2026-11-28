# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MediConnect is a hospital appointment discovery and booking platform (Chennai first, then Tamil Nadu). It is a learning project for Celery, Redis, Docker, Elasticsearch, Playwright, notifications, maps and LLM chatbots: explain important decisions in beginner-friendly language.

Stack (all run in Docker Compose):
- Backend: Django 5.1 + DRF, JWT (simplejwt), PostgreSQL 16 + **PostGIS** (`postgis/postgis` image), Daphne/Channels (WebSockets), Celery + Celery Beat with Redis, Elasticsearch 8.15, pytest.
- Frontend: Next.js 15 (App Router, TypeScript, Tailwind v4), Leaflet/react-leaflet with OpenStreetMap tiles.
- Mailpit catches all email locally.

Feature history lives in `README.md` → Progress (keep it up to date). Machine-specific notes (plan location, local paths, test logins, what's in the dev database) live in `CLAUDE.local.md`, which is gitignored.

## Current state

Last results (2026-11-26): 345 backend tests pass (1 opt-in live browser test skipped); 47 Playwright e2e tests (22 files) pass. The OpenAI key works and is used only by the chatbot (not yet tried by hand with real replies). The scraper is rules-only.

## Gotchas (read first)

- Use PowerShell, not Git Bash, for npm/npx and in instructions to the owner.
- The frontend must run on port 3000 (see Commands). The owner runs it by hand: don't start or stop it unless asked.
- The dev database holds real accounts only: **never run `seed`**, back up (`pg_dump -Fc`) before deleting anything, and run `manage.py e2e_cleanup` after any e2e run.
- `queue.spec.ts` needs a free slot later today, so it fails after ~21:30 IST. A test occasionally times out on a page's first compile in `next dev` and passes on rerun.
- Docker Desktop on Windows can make container clocks jump (e.g. after sleep): log and database times then look minutes apart. Trust Celery's own "succeeded in N s".

## Git

- **Never create a branch, merge, or `git push` without asking the owner first**, for each push (owner rule 2026-11-26). Commit locally, then ask; propose a branch name and wait for a yes. Only the owner merges into `main`, through pull requests (for GitHub badges).
- New work: a new `feature_*` branch from `origin/main`, **one pull request per finished feature**. Once allowed, push it to a remote branch of the same name and give the compare link `https://github.com/Sandhya192005/MediConnect/compare/main...<branch>` (`gh` isn't installed).
- `main` contains all earlier branches (PRs #1–#5 merged).
- **Current branch: `feature_specialist_search`** (from `main` at `9717b7b`; the owner keeps adding to it). **Don't merge yet: more changes are coming** (owner, 2026-11-26).
- `CLAUDE.md` is committed only when the owner asks.
- GitHub Actions (`.github/workflows/tests.yml`) runs backend `pytest` on every push and on PRs to `main`. Run the full backend suite after changing `e2e_setup` too (`test_e2e_setup.py` checks its output).

## Commands (PowerShell, from the repo root)

Docker Desktop must be running first (`$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe`).

```powershell
docker compose up -d --build                                   # start everything
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py makemigrations <app>
docker compose exec backend python manage.py search_index --rebuild
docker compose exec backend pytest                             # all backend tests
docker compose exec backend pytest apps/hospitals/tests.py::test_radius_and_limit   # one test
docker compose --profile frontend exec frontend sh -c "npx tsc --noEmit && npx next lint"
docker compose logs -f celery_worker
docker compose exec backend python manage.py e2e_setup          # reset e2e data (DEBUG only; the e2e run calls it itself)
docker compose exec backend python manage.py e2e_cleanup        # after any e2e run
cd e2e; npx playwright test                                    # end-to-end tests (needs the backend up; starts the frontend if needed)
cd e2e; npx playwright test tests/booking.spec.ts              # one e2e file
cd e2e; npx playwright test --headed                           # watch the browser
cd e2e; npx playwright show-report                             # screenshots/video/trace of failures
```

- Owner's daily start: `docker compose up -d db redis elasticsearch mailpit mockhospital backend celery_worker celery_beat scraper_worker`, then `cd frontend; npm run dev`.
- The Docker `frontend` service has `profiles: ["frontend"]`: `docker compose up` and Docker Desktop's ▶ Start skip it. Start it only with `docker compose --profile frontend up -d frontend`; container commands then need the profile too. Don't recreate the container unless asked: ▶ Start restarts any existing container in the group, profile or not.
- Port 3000 only: the backend's CORS allows only `http://localhost:3000`. `npm run dev -- -p 3000` fails loudly instead of moving to 3001. If 3000 is taken, it's either
  - a Docker `frontend` container: `docker compose --profile frontend rm -f -s frontend`, or
  - a leftover `next dev` (another terminal, or a Claude session's temporary check server; stop any you start). `Get-NetTCPConnection -LocalPort 3000` may not list it: find it with `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -match 'next|npm-cli'`. Auto mode blocks Claude from stopping processes: give the owner the command.
- `EINVAL: invalid argument, readlink '...\frontend\.next\...'` = corrupt build cache (Docker container's Linux symlinks in the shared `.next`, a dev server killed mid-write, or OneDrive). Stop the dev server, `Remove-Item -Recurse -Force frontend\.next`, restart.
- New Python packages: pin in `backend/requirements.txt`, then rebuild the `backend`, `celery_worker` and `celery_beat` images.
- New npm packages: `docker compose --profile frontend exec frontend npm install <pkg>@<version>` (the container has its own `node_modules`), then `npm install` on Windows too so VS Code sees the types.
- In Git Bash, docker builds need Docker Desktop's `resources/bin` on `PATH` (see `CLAUDE.local.md`).

URLs: app http://localhost:3000 · mock hospital site http://localhost:8090 (`http://mockhospital/` inside Docker) · API http://localhost:8000/api/ · Django admin http://localhost:8000/admin/ · Mailpit http://localhost:8025 · Elasticsearch http://localhost:9200 · Postgres from Windows `localhost:5433` (db/user/password `mediconnect`; 5432 is the owner's own PostgreSQL 17).

Demo data for a project review: `manage.py demo_setup` / `demo_cleanup` (5 made-up connected hospitals named "…Demo…", 11 doctors, `demo.*@mediconnect.dev`; logins in gitignored `backend/.demo-logins.json`, never print the password in chat). Cleanup deletes only those exact names ("Greenfield Demo Hospital" (scraped) and the OSM "Demo Hospital" aren't ours). Demo data is currently removed. Never put demo data under a real hospital's name.

## Architecture

`backend/config/` holds settings, root URLs, `asgi.py` (HTTP → Django, WebSocket → Channels with `JwtAuthMiddleware`) and `celery.py`. Apps live in `backend/apps/`. Redis databases: 0 Celery broker, 1 results, 2 cache, 3 Channels.

### Roles and permissions

- `accounts.User` logs in by email and has a `role`: patient / doctor / hospital / admin.
  - `hospital` = a hospital's own account (logs in with `Hospital.email`), linked to one hospital by `staff.HospitalAdmin`. Code still uses the old "admin" names for it: `admin_hospital(user)`, `IsHospitalAdmin` (sets `request.admin_hospital`), `/api/hospital-admin/`, the `/admin/*` pages.
  - `admin` + superuser = platform admin (`is_platform_admin`, `IsPlatformAdmin`): connection approvals, departments, appointment requests, any scrape job, support inbox, analytics.
  - Nurses and other staff are `StaffMember` records without a login.
- `accounts/permissions.py`: `role_required`, `IsPatient`, `IsDoctor`, `IsAdminRole`, `ReadOnlyOrAdmin` (writes: platform admin only), plus the above.
- Login tabs are strict: Patient | Doctor | Hospital | Admin (`LoginTab`, `fitsTab`, `tabFor` in `lib/auth.tsx`). The tab must match `user.role` exactly, or `login()` throws `WrongRoleError` before storing tokens. "Remember me" picks `localStorage` vs `sessionStorage` (`tokens.set` in `lib/api.ts`).
- Frontend: `RoleGuard` accepts a role, a list (`/admin` = `["hospital","admin"]`), or nothing (any logged-in user). `navFor(role, user)` in `lib/nav.ts` builds the menus; `/admin` shows the hospital overview, the platform overview, or a "not linked" message.
- Table names are set via `db_table`: `users`, `patient_profile`, `doctor_profile`, `hospital_profile` (= `staff.HospitalAdmin`), `all_hospitals` (every hospital: map, signed-up, manual; M2M `all_hospitals_departments`), `staff_member`, `payment_slip`, `payment_item`, `hospital_patient`, `doctor_rejection`, `support_request`. Others keep Django's `app_model` names.

### Patients and records

- `PatientProfile` (signal-created; use `PatientProfile.for_user(user)`) holds the random patient ID (`P` + 6 digits) and optional health details (height/weight with DB range checks, blood group, allergies, `conditions` = list of `PatientProfile.CONDITIONS` keys, medicines, emergency contact; `no_*` booleans mean "none" as an answer, distinct from empty). `PatientDetailsSerializer` (`/api/auth/me/patient/`) validates them and adds `bmi`/`completeness`. `/api/auth/me/` returns `patient_id` (null for non-patients).
- `records`: `MedicalRecord` files live in `storage.PrivateStorage` (`PRIVATE_MEDIA_ROOT`, volume `record_files`). `.url()` deliberately raises: files are served only by `RecordFileView` after a permission check. Rules in `records/services.py`:
  - `check_upload`: PDF/JPG/PNG by magic bytes, `RECORD_MAX_BYTES`.
  - `may_open_records`: **general patient ID** (owner decision): any doctor or hospital/admin account may open any patient's records by ID, no appointment needed, including unverified self-registered doctors and unconnected signed-up hospitals. Every view is logged (`log_access` → `RecordAccess`, identical repeats within a minute skipped; `viewer_role` + `staff_hospital` for the log). Only an unknown ID gives 404; lookups are throttled (scope `record_lookup`, 30/min).
  - Hospital uploads: `uploaded_by_hospital`; each side deletes only its own view (`hidden_for_patient` / `hidden_for_hospital`, `records_visible_to`, `delete_for_patient`, `delete_for_hospital`). Deleting a record deletes its file on commit.
  - Patients only ever see their own records. `MedicalRecord` is intentionally not in Django admin.
- **Treatment notes were removed on purpose** (prescriptions are uploaded as record PDFs). Don't bring them back without asking.
- Frontend: `RecordList` **Open** fetches the file with the token (`api.fetchFile`) into an in-page viewer (PDF in a blob-URL `<iframe>`, images as `<img>`), logged like Download. Headless Chromium downloads PDFs instead, so e2e only checks the dialog + blob iframe. Patient access history is `/patient/records/access`. Doctors look patients up at `/doctor/records`; hospitals use Patient management.

### Hospitals, doctors, staff

- `hospitals.Hospital`: PostGIS `geography` point, `location_verified`, `source` (osm / scraped / account / …), `is_approved`, `approved_at` (kept in step by `save()` and the Django admin approve action). `nearby` and `cities` actions on `HospitalViewSet`.
  - "Listed" = approved or osm/scraped; "partner" = approved + a doctor with working hours (`Hospital.is_partner`, `hospitals/services.listed_hospitals()`).
  - Hospitals join only by sign-up + connection request: `POST /api/auth/register-hospital/` creates the hospital user + `Hospital(source="account", is_approved=False)` + `HospitalAdmin` in one transaction. **Unapproved = invisible and unbookable everywhere** (lists, search, `DoctorProfile.is_bookable`). `hospitals/connections.py`: `ConnectionRequest` (one pending per hospital, DB constraint), approve/decline (decline needs a note), `disconnect/` (reason required). Doctor accounts can only pick approved hospitals.
  - Hospital profile (`staff/profile.py`): edits apply at once; a name/city change notifies superusers and renames the hospital account. Connected hospitals can't empty address/phone.
- `doctors`: `DoctorProfile` (signal-created) and `WeeklyAvailability`. `services.py` generates slots from weekly hours, cached in Redis with a per-doctor version key.
- `staff`: `StaffMember` kinds doctor, nurse, and "other staff" (`views.OTHER_STAFF_KINDS`; `other` needs a designation); optional OneToOne to a `DoctorProfile` at the same hospital; DB checks salary ≥ 0, only doctors link accounts, `left_on ≥ join_date`; `StaffMember.objects.active(on=date)`. Everything under `/api/hospital-admin/` is scoped to `request.admin_hospital`: overview (with % `trends`), staff, doctor accounts, patients, reports (`staff/reports.py`; no-shows count in totals but aren't visits), payments.
  - Hospital-added doctors (`staff/listed.py`): working `StaffMember` doctors not bookable online are shown to patients ("Listed by the hospital · not bookable online"), **public fields only, never phone/email/salary**. Patients send them an `AppointmentRequest` with `for_hospital=True` that the hospital answers; the platform admin sees only `for_hospital=False`.
  - Patient management (`staff/patients.py`): `HospitalPatient`; `views.hospital_patients()` = patients who visited ∪ patients added. A hospital can create a patient without a password; with no email, it gets the placeholder domain `accounts.models.NO_EMAIL_DOMAIN` (`User.has_real_email`). PATCH/upload need the patient in the list. The hospital may set the email only per `may_edit_email`.
- `billing` (payment slips, rules in `billing/services.py`): numbers `<initials>-<year>-NNNN` under a hospital-row lock; totals computed server-side; pending = editable/cancellable; completed = locked (`reopen` needs a reason; `complete` needs a method). Money is sent as JSON numbers. `/api/hospital-admin/payments/` must stay in `config/urls.py` before the staff URLs; `/api/payments/` is the patient's read-only view.
- `analytics` (`/api/platform/overview/`, `reports/`): counts from real tables only. "Hospital accounts" (≥1 `hospital_profile`) are counted separately from connected (approved) hospitals.
- `support`: `SupportRequest`; platform inbox `/api/support/inbox/` (registered before the user routes; only Open/Closed; `reply/` also closes). New messages notify superusers.

### Appointments

- Booking locks the doctor row (`select_for_update`), rechecks the slot, and relies on a partial unique constraint (doctor, start, active statuses) to block double booking.
- Booking flow (`appointments/flow.py`): `Appointment.source` personal/hospital. A hospital request at a hospital with an account goes to the hospital first (`hospital-confirm/` assigns a doctor if `flow.doctor_is_free`, or `hospital-decline/`), then to the doctor (`doctor-accept/` / `doctor-reject/ {reason}`, which sends it back to the hospital). A personal request, or one at a hospital without an account, goes straight to the doctor, and a reject cancels it. A pending booking holds its slot (status booked) and stays hidden from the doctor until it reaches them. Pending requests get no reminders/queue/no-show/auto-complete, and the hourly `expire_unanswered_requests` expires them.
- Queue (`queue.py`): `checked_in_at`, `token` (per doctor per local day, assigned under the doctor-row lock), `consultation_started_at`; `queue_status` is derived. `check-in/` (patient from 2 h before, or their doctor), `call-in/` (doctor), `queue/`. A partial unique constraint allows one in-consultation appointment per doctor. `complete_past_appointments` skips patients checked in today.
- No-show (`no_show.py`): **marked by hand only, never automatic**, by the doctor or hospital, once the visit has started, ≤ 7 days back, only if not checked in/called in; also allowed from `completed`. The serializer's `can_mark_no_show` / `can_undo_no_show` drive the buttons.
- `requests_api.py`: `AppointmentRequest` for non-partner hospitals. `external_api.py`: `ExternalAppointment` (patient-added bookings made directly with a hospital: reminders only, never a reserved slot).

### Notifications

Email (`emails.py` + templates), in-app `Notification`, WebSocket consumer (`/ws/notifications/`, close code 4401 = bad token), Celery tasks (email, in-app push, reminders every 5 min, auto-complete hourly). `services.notify_appointment()` queues in-app + email on commit; `services.notify_queue()` is in-app only (queue events, no-show). The API is always limited to the user's own notifications.

### Chatbot

OpenAI chat loop (`chatbot/service.py`) with tools that call our own code. **Read-only**: it never confirms, accepts, declines, cancels or deletes; `propose_booking` only returns a card, and the user's Confirm calls the normal booking API. `roles.py` maps the user to patient / doctor / hospital / platform_admin (`role_of`), each with a purpose, a how-to `GUIDE` using the real menu names (**keep it in step with `lib/nav.ts`**) and a tool list. `service.chat` offers only that role's tools, and `run_tool` refuses any other. Tools: `tools.py` (patient, doctor), `hospital_tools.py` (always `admin_hospital(user)`), `platform_tools.py` (each re-checks `is_platform_admin`). Tests use a scripted fake OpenAI and never call the real one.

### Scraper and hospital directory

- `scraper/services.py` decides when to scrape (24 h freshness, one active job per hospital, per-user quota). `pipeline.py` runs a job: geocode → `safety.py` URL/robots checks → `browser.py` Playwright → `extract.py` (**rules only, never OpenAI**; `test_scraping_never_calls_openai_even_with_a_key` guards it) → save `ScrapedDoctor` + hospital fields → notify. Runs on the `scraper` Celery queue in `scraper_worker` (image built with `WITH_BROWSER=1`). Test target: the `mockhospital` container.
- Hidden doctor pages: `scraper/sitemap.py` reads the sitemap (robots.txt `Sitemap:` line, else common paths), picks ≤ `SCRAPER_MAX_DOCTOR_PAGES` (10) doctor-looking URLs, and SSRF-checks every hop. `browser.fetch_pages` stops after `SCRAPER_TIME_BUDGET_S` (100 s; the task is killed at 150 s).
- Directory: `scraper/directory.py` + `overpass.py` import every hospital per ~11 km `OsmTile` (24 h freshness, failed tiles wait 10 min) as `source=osm`, `is_approved=False`. Only `source=osm` hospitals take name/pin/address updates from OSM: **never overwrite partner fields from OSM**.
- Missing websites: OSM wikidata tags, then `pipeline.nearby_namesake` (same distinctive name within 500 m), then a Wikidata name search (`scraper/wikidata.py`; match within 15 km, or a hospital group from India). `Hospital.website_source` is shown to patients; `website_checked_at` limits searches to once per 30 days; Wikidata errors are never cached as "not found". Wikimedia needs the contact link in `SCRAPER_USER_AGENT`.

### Search

- Elasticsearch indexes (`search/indexes.py`: synonyms, `search_as_you_type`), synced by signals → Celery tasks. `/api/search/` + `suggest/` return 503 when ES is down; the frontend then falls back to `/api/doctors/?q=`.
- Book appointment (`/doctors`) lists **MediConnect hospitals**, not loose doctors: `/api/search/partner-hospitals/` (`search/partners.py`). ES finds matching doctors (typos, synonyms); PostgreSQL decides what's bookable; it falls back to plain DB matching when ES is down (`degraded: true`). A hospital-name match uses only name and city (departments would make "heart" match every cardiology hospital).
- Other hospitals: `/api/search/?type=hospitals&partners=0`; website doctors: `/api/search/listed-doctors/` (specialties matched by word roots in `search/specialties.py`).
- `documents.rebuild_all` must loop over `HOSPITAL_QS.all()`: the shared queryset otherwise caches stale rows within one process.

### Backend tests

`backend/conftest.py` runs Celery eagerly, with in-memory email/cache/channel layer and `test_mediconnect_*` ES indexes. Use `django_capture_on_commit_callbacks(execute=True)` to run on-commit tasks. The autouse `fake_wikidata` fixture blocks real Wikidata calls (set `.search` / `.entities` to script answers). Tests point `PRIVATE_MEDIA_ROOT` at `tmp_path`. Queue tests freeze `timezone.now` at noon IST.

### Frontend

- `lib/api.ts` (fetch wrapper with JWT refresh), `lib/auth.tsx`, `lib/notifications.tsx` (WebSocket + reconnect), `lib/nav.ts` (menus; an item without `href` shows "Soon").
- `components/AppChrome.tsx` picks the frame: `/login`, `/register` → `AuthLayout`; logged-in users on `/patient`, `/doctor`, `/admin`, `/doctors`, `/hospitals` → `AppShell` (sidebar + top bar; the sidebar is dark navy for every role); everyone else → `Navbar` + `Footer`. Dashboard blocks are in `DashboardShell.tsx` (`StatCard`, `Panel`, `EmptyState`, `SoonBadge`, `StatusPill`, `IconTile`).
- Dashboards show real numbers from APIs only; planned features show "Soon", never invented numbers.
- Leaflet components must load with `next/dynamic(..., { ssr: false })`. Map pins are `CircleMarker`s (SVG `path.leaflet-interactive`). `/hospitals` redirects to `/doctors` (keeps the query); `/hospitals/<id>` keeps its own small map. `areaOf()` in `lib/types.ts` gives "area, city" without house numbers or postcodes.
- Charts: `components/Charts.tsx` (plain SVG; `LineChart` ≤ 2 series, `BarChart`; `StaffChart` wraps `LineChart`), colours blue `#1f4f9e` + teal `#0f8f7e` (dataviz-validated), marker shapes + end labels as the second cue, hidden data table in a `div.sr-only`.

## Design

- **Colours (all blue):** ink = logo navy `#00295c` (`navy-800`), brand blue `#1f4f9e`. The `teal-*` scale is re-tuned to blues in `app/globals.css`, so the class `teal-600` means brand blue. Ground `#f3f6fb`, app-shell ground `#eef3fa`. Maps: partners blue, the patient teal. Red/amber/green keep their status meanings.
- **Fonts:** Funnel Display (headings, `font-display`) and Funnel Sans (text) via `next/font`. Public pages use weights 400/500 only (`--font-weight-semibold/bold/extrabold` map to 500); the app shell's look (`.dash-card`, `font-[650]` headings) is scoped to `.app-shell`. Never Plus Jakarta Sans, Inter, Poppins or the other faces the taste skill bans.
- Buttons are pill-shaped (`rounded-full`); the nav bar is opaque.
- `globals.css`: `btn` and `card` are `@utility`; `.btn-primary`, `.btn-solid`, `.btn-outline`, `.btn-ghost`, `.btn-navy`, `.card-hover`, `.input`, `.chip`, `.chip-active`, `.page-title`, `.section-title` are in `@layer components`. **Never put component classes outside a layer**: they would override Tailwind utilities.
- Icons are inline SVGs in `components/Icons.tsx` (no icon package).
- Logos: use `public/logo-mark-clear.png` (transparent; light grounds only). The logo files are generated from `public/logo-original.png`. After replacing an image, clear `frontend\.next\cache\images`.
- Public home page `/`: a standalone page built with the taste skill, `frontend/public/home/index.html` + the kit parts it uses in `frontend/public/home/assets`, served via a `beforeFiles` rewrite in `next.config.ts` (there is no `app/page.tsx`). Edit it as plain HTML with the kit's classes, never the kit's own files. Its deal is in the comment at the top of `<body>`; check commands are in `.taste-skill/README.md`.
- Taste skill (user-level, `%USERPROFILE%\.claude\skills\taste-skill`): use it for any redesign or new **public** page (home, find, hospital and doctor pages); app screens keep the design system above. MediConnect's kind: `software` (`data-type="software"`). Use the logo colours via `start.mjs brand`, not a dealt palette. Its house rules here: real photographs and full-colour icons over drawn ones, no captions under pictures, one section per screen, no house-number addresses or real-format phone numbers on public pages. Its full kit stays in the skill folder; deal history goes in `.taste-skill/` (committed).
- To check visuals, write a throwaway `e2e/tests/zz-shots.spec.ts` that saves screenshots to the scratchpad, run it, then delete it.

## End-to-end tests (`e2e/`)

Node `@playwright/test` 1.49.1, separate from the Python Playwright in the scraper.
- `global-setup.ts` runs `manage.py e2e_setup` (in `doctors/management/commands/`), which resets only the `e2e.*` users, "E2E Partner Hospital" (doctor works daily 06:00–22:00, calendar wiped), "E2E Mock Website Hospital" (website `http://mockhospital/`), `E2E Signup Hospital …` and the no-show patient. Ids go to `e2e/.e2e-data.json`; read them with `e2e()` from `tests/helpers.ts`. Test logins: `CLAUDE.local.md`; hospital account `e2e.admin@…`, platform admin `e2e.platform@…`.
- `workers: 1`: the tests share one database. Tests share the E2E patient, so use `cancelPatientBookings`, `bookAsPatient` (auto-accepts as the doctor unless `{ accept: false }` / `{ source: "hospital" }`), `patientToken` and `today()`; for "never booked here", register a fresh `e2e.new.*` patient through the API (see `records.spec.ts`). Tests that count notifications call `clearNotifications()` first.
- No test may call a real hospital website or OpenAI (the chatbot reply is faked with `page.route`). Password tests read Mailpit's API (`/api/v1/search`, `/api/v1/message/<id>`).
- `login()` needs a desktop viewport (it waits for the sidebar's "Log out") and clicks the matching login tab; tests that log in by hand must click the right tab too. The password field is `getByLabel("Password", { exact: true })` (there's a "Show password" button). `window.confirm` dialogs must be accepted with `page.once("dialog", …)`.
- Selectors to keep: day buttons in `div.overflow-x-auto` and slots as `.grid button` on the doctor page; `article[aria-label=<hospital>]` cards in the "MediConnect hospitals" region; "Log out" visible on desktop and the user's email in the top bar; `data-testid="unread-count"`; `data-testid="staff-role"`; "Delete notification: <title>" buttons.

## Working rules from the project owner

- Build in phases and don't merge phases into one unreviewed step. Report each phase before starting the next.
- Explain changes before making them; ask before destructive changes. Explain new dependencies before adding them; pin stable, compatible versions.
- Run migrations and tests and report actual results; state what is unverified. Verify endpoints against the running server, not by code inspection.
- Keep README → Progress up to date.
- Plan steps are called "Step 2–5" so they don't clash with the original Phases 1–8.

## Domain invariants (must hold across the codebase)

- Patients never see other patients' appointments; doctors see only their own; hospital accounts see only their hospital's (`AppointmentViewSet.get_queryset`).
- Availability provenance stays explicit and distinct: **scraped/reported** (from a hospital website) vs **admin/doctor-configured** (`WeeklyAvailability`) vs an **actual reserved appointment**. A scraped slot is informational only: never bookable, never presented as reserved. Every scraped record carries its source URL and collected-at timestamp. Scraped hospitals start `is_approved=False`.
- Booking integrity lives in PostgreSQL (transaction + row lock + partial unique constraint; recheck the slot and reject past slots at booking time). Redis/Celery/Elasticsearch are never the source of truth.
- Hospital location is independent of availability. Never invent coordinates or present an unverified pin as confirmed (`location_verified`; moving a pin resets it, except the pin a hospital account sets on its own profile, which counts as confirmed). Nearby search validates lat/lng/radius and caps results (≤ 50). City browsing must not require the patient's location.

## Data collection rules (scraper)

- Before writing any real hospital adapter, check that collection is permitted (terms of service, robots.txt). If data isn't accessible, record the limitation instead of inventing data.
- Never bypass CAPTCHAs, logins or anti-bot measures; never touch patient data; never automate real bookings. Block private/internal IPs for user-supplied URLs (SSRF).
- Normalize/validate output, deduplicate, and handle timeouts and site changes. Celery scrape tasks: idempotent, bounded retries, timeouts, rate limits, no overlapping runs for the same hospital.
- A patient's hospital search **may trigger** a background scrape, but only when the saved copy is older than 24 h (or the patient presses a rate-limited "Refresh from website"). Never block the search request on the browser, and never start a duplicate job.
- For non-partner hospitals, the patient gets the hospital's own booking link/phone plus an **Appointment request**, always shown as "Pending – not confirmed" until an admin/hospital confirms. It is a separate model from `Appointment` and never counts as a reserved slot.
- Automated tests mock websites and browsers. Approved real site: **MIOT International** only (checked 2026-11-02; no doctor directory, ~8 profiles found through its sitemap; a full read takes ~110 s). Every other site, Apollo included, is unchecked: **no live checks on real sites without the owner's OK**.

## Open items

- OpenAPI docs and a Postman collection are not built yet.
- Only about 1 in 8 OSM hospitals lists a website; Wikidata adds a few, the rest need a pasted website.
