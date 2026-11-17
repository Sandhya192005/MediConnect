# MediConnect

[![Tests](https://github.com/Sandhya192005/MediConnect/actions/workflows/tests.yml/badge.svg)](https://github.com/Sandhya192005/MediConnect/actions/workflows/tests.yml)

Hospital appointment booking app — Next.js frontend, Django REST backend, PostgreSQL/PostGIS, Redis, all in Docker.

## Run it

```bash
cp .env.example .env          # then set DJANGO_SECRET_KEY
docker compose up -d --build
docker compose exec backend python manage.py seed              # sample hospitals + doctors
docker compose exec backend python manage.py createsuperuser   # admin login
```

- App: http://localhost:3000
- API: http://localhost:8000/api/
- Django admin: http://localhost:8000/admin/
- Mailpit (all emails the app sends): http://localhost:8025
- PostgreSQL from your PC (pgAdmin etc.): `localhost:5433`, db/user/password `mediconnect`

### Background jobs (Celery)

- `celery_worker` sends emails (booked / confirmed / cancelled / reminders). Logs: `docker compose logs -f celery_worker`
- `celery_beat` runs every 5 min (24h + 1h reminders) and hourly (mark past appointments completed).
- Redis: db 0 = Celery queue, db 1 = task results, db 2 = Django cache (doctor time slots), db 3 = Channels.

### Search (Elasticsearch)

- PostgreSQL is the source of truth; Elasticsearch (http://localhost:9200) keeps a search copy of doctors and hospitals.
- Indexes are kept in sync automatically: model signals → Celery task → Elasticsearch.
- Rebuild from scratch any time: `docker compose exec backend python manage.py search_index --rebuild` (the `seed` command does this too).
- Features: typo tolerance (fuzzy), everyday-word synonyms ("heart" → cardiology), autocomplete, department/city facets, fee filter, highlights.
- If Elasticsearch is down, `/api/search/` returns 503 and the frontend falls back to the basic database search.

| Endpoint | What |
|---|---|
| `GET /api/search/?q=&department=&city=&min_fee=&max_fee=&page=` | doctor search + facets |
| `GET /api/search/?type=hospitals&q=&city=` | hospital search |
| `GET /api/search/suggest/?q=` | autocomplete |

### Nearby hospitals (PostGIS + Leaflet)

- `GET /api/hospitals/nearby/?lat=&lng=&radius_km=10&limit=20&department=`: hospitals inside the radius, nearest first, with `distance_km` and `doctor_count`. PostGIS `ST_DWithin` + `ST_Distance` on a spatially indexed `geography` column.
- Input is validated: lat −90..90, lng −180..180, radius 0.5–50 km, limit ≤ 50.
- `GET /api/hospitals/cities/`: browse by city without sharing your location (`/api/hospitals/?city=`).
- `location_verified`: set by an admin (Django admin action) after checking the pin. Unverified pins show as "Approximate location". Moving a pin resets it.
- Frontend `/hospitals` (map + list) and `/hospitals/<id>` (hospital page with its doctors). Map tiles from OpenStreetMap.

### All hospitals on the map (OpenStreetMap directory)

- The map and city search show **every hospital** in the area, not only partners. `GET /api/hospitals/nearby/` and `GET /api/hospitals/city/?name=Chennai` return `is_partner`, `has_website`, and `loading_more`.
- The map is split into ~11 km tiles (`OsmTile`). A tile not refreshed in 24 h is downloaded in the background (Celery `sync_osm_tile_task`, Overpass API, no key), saved as `source=osm` hospitals, and indexed in one bulk Elasticsearch update. Existing hospitals (same name within 300 m) are linked by `osm_id`, never duplicated or overwritten.
- Search (`/doctors`, "Find hospitals or doctors") shows three groups:
  - **MediConnect hospitals** (`GET /api/search/partner-hospitals/?q=&department=&city=&max_fee=`): partner hospitals, each with its specialties and the specialists that match the search ("heart" → the hospitals with cardiologists, typos allowed). Opening one shows its doctors grouped by specialty (`/hospitals/<id>?specialty=Cardiology`). Works without Elasticsearch too (plain database matching).
  - **Other hospitals**: not on MediConnect yet, from the map and their own websites.
  - **Doctors listed on hospital websites** (`GET /api/search/listed-doctors/?q=`).
- Opening a hospital page (logged in) reads its website with Playwright if the saved copy is older than 24 h. The page has a doctor search box.
- Most OpenStreetMap entries have no website, so MediConnect looks for it on **Wikidata** (free, no key): first through the Wikidata link on the map entry (during the map import), then, when a patient opens a hospital without one, by name. A name match is accepted only if it's within 15 km, or a hospital group from the same country (`DIRECTORY_COUNTRY_QID`, default India). Each hospital is searched at most once per 30 days; the patient can still paste a website. The page shows where a website came from (`website_source`: OpenStreetMap / Wikidata / added by a patient, the last two "not confirmed by the hospital").

### Hospital lookup from its own website (Playwright)

Flow: patient looks up a hospital → served from PostgreSQL if collected < 24 h ago → otherwise a background job: OpenStreetMap (address, pin, website) → URL safety + robots.txt → Playwright (Chromium) reads up to 6 useful pages on that site → OpenAI extracts doctors/departments/timings/contacts (rule-based fallback without a key) → saved with source URL + time → live notification.

- `POST /api/scraper/lookup/` `{q}` or `{url}` → `{matches, job}`; `GET /api/scraper/jobs/<id>/`; `GET /api/scraper/hospitals/<id>/`; `POST /api/scraper/hospitals/<id>/refresh/` (at most hourly per hospital; 10 lookups/hour per user).
- Doctor pages the homepage doesn't link to (common on big hospital sites, e.g. MIOT's "Meet the doctors" profiles) are found through the site's **sitemap**. A page titled "Dr. Name | …" counts as that doctor's profile, with the specialty taken from its address. Removed (404) pages are skipped, and reading stops after 100 s.
- A hospital mapped twice ("MIOT Hospital" and "MIOT International", 140 m apart) borrows its twin's website, labelled "from the same hospital listed nearby".
- Scraped hospitals are `source=scraped`, `is_approved=False`: viewable for checking, not listed as partners. `ScrapedDoctor` rows are information only, never bookable slots.
- Non-partner hospitals: the hospital's own booking link/phone, plus `POST /api/appointment-requests/` (always "Pending – not confirmed" until an admin confirms at `/admin/requests`).
- Booked on the hospital's own website/phone? `POST /api/external-appointments/` lets the patient add it ("Booked directly with the hospital – added by you"). MediConnect only sends the 24 h / 1 h reminders; it never blocks a slot or counts as a MediConnect booking.
- Containers: `scraper_worker` (Celery `scraper` queue, Chromium, 1 browser at a time) and `mockhospital` (fictional demo site at http://localhost:8090, `http://mockhospital/` inside Docker).
- Real-browser test: `docker compose exec -e SCRAPER_LIVE=1 scraper_worker pytest apps/scraper/tests.py::test_live_mock_site`

### AI assistant (OpenAI)

- Set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`, default `gpt-4o-mini`) in `.env`, then `docker compose up -d --force-recreate backend`.
- `POST /api/chat/` `{message, session_id?, location?: {lat, lng}}` → `{session_id, reply, proposals, emergency, emergency_notice}`; `GET /api/chat/history/`.
- The model uses tools that run our own code: `search_doctors`, `get_available_slots`, `find_hospitals`, `my_appointments`, `propose_booking`.
- **The assistant never books.** `propose_booking` only rechecks the slot and returns a card; the patient books with the card's Confirm button (normal `/api/appointments/` API).
- Safety: no diagnosis or medicines (system prompt), emergency keywords always show a 112/108 banner, 1000-char message limit, 20 messages / 10 min per user (Redis), key stays on the server.
- Tests use a scripted fake OpenAI client (no key, no cost).

### Live notifications (Django Channels)

- The backend runs on Daphne (ASGI), so it serves HTTP and WebSockets on port 8000.
- Browser connects to `ws://localhost:8000/ws/notifications/?token=<JWT access token>`.
- When the Celery worker creates a notification it publishes it to Redis; Channels delivers it to every open tab of that user.
- Messages from the server: `hello` (unread count), `notification` (new item + unread count), `pong`. Close code `4401` = token invalid → frontend refreshes and reconnects.

Seeded doctor logins: `anita.rao@mediconnect.dev` (and others from `apps/doctors/management/commands/seed.py`) / `Doctor@123`.

### Home page (designed with the taste skill)

- `/` is a standalone page, `frontend/public/home/index.html`, built with the taste-skill UI kit (its parts in `frontend/public/home/assets`) and served through a rewrite in `frontend/next.config.ts`.
- Sections: hero with the assistant offering a free slot, bookings beside a doctor's calendar, features (hospitals near you, hospital websites, reminders, visits booked by phone), requests to other hospitals, 3 booking steps, FAQ, and the close with the footer.
- The app pages share its look: Funnel Display and Funnel Sans, navy ink, the teal `#0e8073`, pill buttons and flat colour.

## Tests

```bash
docker compose exec backend pytest
```

### End-to-end tests (Playwright)

A real Chromium drives the real app: the Next.js frontend plus the Docker backend. Run from PowerShell:

```powershell
cd e2e
npm install                      # first time only
npx playwright install chromium  # first time only (~90 MB browser)
npx playwright test              # starts the frontend itself if it isn't already running on :3000
npx playwright test --headed     # watch the browser
npx playwright show-report       # HTML report; failed tests keep a screenshot, video and trace
```

Before each run, `global-setup.ts` calls `manage.py e2e_setup`. It resets its own `e2e.*` accounts (password `E2e@12345`), an "E2E Partner Hospital" with a doctor who works every day, and an "E2E Mock Website Hospital" whose website is the mock site. It never touches other data, and refuses to run unless `DJANGO_DEBUG=1`.

| Test | What it proves |
|---|---|
| `auth.spec.ts` | sign up, log out, wrong password, role-protected pages |
| `booking.spec.ts` | two browsers: the patient books, the doctor's bell updates live (WebSocket), the slot shows as taken, the patient cancels |
| `search.spec.ts` | MediConnect hospitals with matching specialists (typos, everyday words), specialists grouped by specialty, autocomplete |
| `map.spec.ts` | fake GPS in Chennai, Leaflet map with tiles and pins, partners-only filter, open a hospital |
| `hospital-website.spec.ts` | opening a hospital → Celery → Playwright in `scraper_worker` reads the mock site → doctors appear → search inside them |
| `chatbot.spec.ts` | the assistant's reply is faked in the browser (no OpenAI call); its booking card books through the real API |

Real hospital websites and OpenAI are never called by these tests.

## Progress

- [x] Phase 1 — Docker, JWT auth, roles (patient / doctor / admin)
- [x] Phase 2 — Hospitals, departments, doctors, weekly hours, slot booking
- [x] Phase 3 — Celery + Redis + email notifications
- [x] Phase 4 — Real-time in-app notifications (Django Channels)
- [x] Phase 5 — Elasticsearch search
- [x] Phase 6 — Nearby hospitals map (PostGIS + Leaflet)
- [x] Phase 7 — OpenAI chatbot (live OpenAI call not yet verified: needs a valid API key)
- [x] Phase 7.5 — Hospital lookup from its own website (Playwright) + appointment requests
- [x] Phase 8 — Playwright end-to-end tests (`e2e/`)

### Dashboards plan (patient / doctor / admin)

Owner decisions (2026-11-16): one admin per hospital; a doctor may open the records of any patient who has had an appointment at their hospital, and every view is logged; the logged-in pages follow the owner's reference design (the public home page keeps its own look).

- [x] Step 1 — New look (frontend only): sidebar layout, login with Patient / Doctor / Admin tabs, and the three dashboards built from existing data. Planned features show "Soon" instead of made-up numbers.
- [x] Step 2 — Medical records: patients upload reports, scans and X-rays (stored privately, downloaded only through a permission check); patient IDs; doctors open records by patient ID, with an access log.
- [x] Step 3 — Patient queue for doctors: check-in, waiting / in consultation / done, token numbers, live updates.
- [x] Step 4 — Hospital management for admins: admins linked to one hospital, staff records for doctors and nurses (join date, salary, department), patient list, staff charts.
- [ ] Step 5 — Tests, docs and push.

#### The new look (Step 1)

- Logged-in users get the dashboard layout (`components/AppShell.tsx`): a sidebar with the role's menu, a top bar with quick search, notifications and the user. Patients get a dark teal sidebar, doctors and admins a light one. On phones the sidebar slides in from the menu button. `components/AppChrome.tsx` decides which frame a page gets: login/sign-up are full-screen, `/patient`, `/doctor`, `/admin`, `/doctors` and `/hospitals` use the dashboard layout when logged in, everything else the public bar and footer.
- Menus live in `lib/nav.ts`. Planned items are greyed out with "Soon" and aren't links.
- Login: role tabs (they only change the wording: the account decides which dashboard opens), show/hide password, and **Remember me** (unticked = the login is kept in `sessionStorage` and ends when the browser closes).
- Patient dashboard: next appointment, hospitals near you (asks for the location only when you click "Use my location"), MediConnect hospitals with a Book button, upcoming appointments.
- Doctor dashboard: today's appointments, visits still to see, next patient, today's schedule with status pills, today's duty hours and hospital. It refreshes when a live notification arrives.
- Admin dashboard: bookable doctors, partner hospitals, today's appointments, and hospitals and appointment requests waiting for approval.

#### Medical records (Step 2)

- **Patient ID:** every patient gets a random ID like `P483920` (`accounts.PatientProfile`, created at sign-up; existing patients got one in a migration). It's in `GET /api/auth/me/` as `patient_id` and on the records page.
- **Patients** (`/patient/records`): upload PDF, JPG or PNG files up to 10 MB with a title, type (lab report, scan, X-ray, prescription, discharge summary, other), date and notes; download and delete them; see **Who opened your records**. Files are checked by their first bytes, not just the name, so a renamed program is refused.
- **Private files:** stored in the Docker volume `record_files` (`PRIVATE_MEDIA_ROOT=/data/private_media`), outside the code folder and OneDrive, under random names. They have no public URL: the only way to get one is `GET /api/records/<id>/file/`, which checks who is asking every time and always sends it as a download. Deleting a record (or the account) deletes the file.
- **Doctors** (`/doctor/records`, or the patient-ID box on the doctor dashboard): enter a patient ID to see the patient's records. Allowed only if the patient has a booked, confirmed or completed appointment with any doctor at the doctor's hospital (cancelled bookings don't count). An unknown ID and "not your hospital's patient" give the same answer, and lookups are limited to 30 a minute, so IDs can't be guessed.
- **Access log:** every doctor lookup and file download is recorded (`records.RecordAccess`: who, which hospital, which file, when) and shown to the patient. The same doctor repeating the same action within a minute (a reload) counts once. Superusers can read the log in Django admin; the records themselves aren't in Django admin.
- Admins can't open records yet: per-hospital admins arrive in Step 4.

#### Patient queue (Step 3)

On the day of a visit: **not arrived → waiting (token) → in consultation → done**. The rules are in `backend/apps/appointments/queue.py`.

- **Check-in:** the patient taps **I've arrived** on their dashboard or My appointments page (allowed from 2 hours before their slot), or the doctor checks them in from the queue (any time that day). Check-in gives the next **token** for that doctor that day (1, 2, 3… in arrival order). Each step locks the doctor's row, so two patients checking in together never get the same token.
- **Doctor's queue** (`/doctor/queue`): now consulting (with **Open records** and **Done**), waiting by token (**Call in**), not arrived yet (**Check in**), done today. Only one patient can be in consultation per doctor: the app says "mark them done first", and a database rule (`one_consultation_at_a_time_per_doctor`) guarantees it.
- **Patient's view:** token number, how many people are ahead (a count only, never who), then **It's your turn**.
- **Live updates:** "Patient checked in" goes to the doctor and "It's your turn" to the patient, as in-app notifications over the existing WebSocket (no emails: one per queue step would be spam). Pages also refresh every 30 s.
- **Doctor dashboard:** Patients waiting and Current patient (#token, consulting…), with Waiting / In progress / Completed pills in today's schedule.
- The hourly auto-complete job no longer completes patients who checked in today: if the doctor is running late, they stay in the queue until marked done or the day ends.

#### Hospital admins (Step 4)

Owner decisions (2026-11-17): hospital admins open records under the same rule as doctors (logged); nurses are staff records without a login.

- **Two kinds of admin.** A **hospital admin** is a user with role `admin` linked to one hospital (`staff.HospitalAdmin`). They see only that hospital's staff, patients and appointments. The **platform admin** is a Django superuser: hospital approvals, departments, requests to non-partner hospitals and other users' website lookups are platform-only. Before Step 4 any `admin` account could approve any hospital.
- **Making someone a hospital admin:** in Django admin, create the user with role "admin", then add a **Hospital admin** entry linking them to the hospital. There is no public sign-up for admins.
- **Doctors / Nurses** (`/admin/doctors`, `/admin/nurses`): staff records (`staff.StaffMember`) with department, designation, phone, email, join date, leaving date and monthly salary. A doctor's record can be linked to their MediConnect doctor account (only accounts at the same hospital, one record per doctor). The database refuses negative salaries, links on nurse records, and leaving before joining. Salaries are visible only to that hospital's admins (and superusers).
- **Patients** (`/admin/patients`): everyone with a booked, confirmed or completed visit at the hospital, with visits, last and next visit, and how many records they have. **Records** opens them with the same rule and access log as doctors; the patient sees "(hospital admin)" in their log.
- **Staff & salary** (`/admin/salary`): monthly payroll in total, for doctors and nurses, and by department.
- **Dashboard:** total doctors, nurses and patients, today's appointments and how many are waiting, the staff chart (doctors and nurses on staff at the end of each of the last 6 months; colours checked with a colour-blindness validator, with marker shapes and end labels as a second cue), and recent activity.
- A platform admin without a hospital sees the platform overview (hospitals awaiting approval, appointment requests).

## Main API endpoints

| Endpoint | Who | What |
|---|---|---|
| `POST /api/auth/register/`, `login/`, `refresh/`, `GET me/` | anyone | accounts + JWT |
| `GET /api/hospitals/`, `/api/departments/` | anyone (admin writes) | hospital data |
| `GET /api/doctors/?q=&department=&hospital=&city=` | anyone | doctor search |
| `GET /api/doctors/<id>/slots/?date=YYYY-MM-DD` | anyone | free time slots |
| `GET/PATCH /api/doctors/me/`, `GET/PUT /api/doctors/me/availability/` | doctor | own profile + hours |
| `GET/POST /api/appointments/` | patient / doctor / admin | list + book |
| `POST /api/appointments/<id>/cancel/` `confirm/` `complete/` | by role | change status |
| `POST /api/appointments/<id>/check-in/` | the patient (from 2 h before) or their doctor, on the day | join the queue, get a token |
| `POST /api/appointments/<id>/call-in/` | doctor | call a waiting patient in (one at a time) |
| `GET /api/appointments/queue/` | doctor | today's queue: `in_consultation`, `waiting`, `not_arrived`, `done` |
| `GET /api/hospital-admin/overview/` | hospital admin | dashboard counts, payroll, 6-month staff chart, recent activity |
| `GET/POST /api/hospital-admin/staff/`, `GET/PATCH/DELETE …/staff/<id>/` | hospital admin | doctors and nurses (`?kind=`, `?q=`, `?status=active\|left`) |
| `GET /api/hospital-admin/doctor-accounts/` | hospital admin | doctor accounts at the hospital without a staff record |
| `GET /api/hospital-admin/patients/?q=` | hospital admin | the hospital's patients with visits and record counts |
| `GET/POST /api/records/`, `GET/PATCH/DELETE /api/records/<id>/` | patient | own medical records (upload: multipart `title`, `record_type`, `record_date`, `notes`, `file`) |
| `GET /api/records/access-log/` | patient | who opened their records |
| `GET /api/records/patients/<patient_id>/` | doctor | a patient's records, if they have an appointment at the doctor's hospital (logged, 30/min) |
| `GET /api/records/<id>/file/` | the patient, or a permitted doctor (logged) | download the file |
