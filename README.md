# MediConnect

[![Tests](https://github.com/Sandhya192005/MediConnect/actions/workflows/tests.yml/badge.svg)](https://github.com/Sandhya192005/MediConnect/actions/workflows/tests.yml)

Hospital appointment booking app — Next.js frontend, Django REST backend, PostgreSQL/PostGIS, Redis, all in Docker.

## Run it

```bash
cp .env.example .env          # then set DJANGO_SECRET_KEY
docker compose up -d --build                                   # everything except the frontend
docker compose exec backend python manage.py seed              # sample hospitals + doctors
docker compose exec backend python manage.py createsuperuser   # admin login
cd frontend; npm install; npm run dev                          # the frontend, on Windows (port 3000)
```

- The frontend runs on Windows with `npm run dev`, not in Docker. Its Docker service has a compose **profile** (`frontend`), so `docker compose up` and Docker Desktop's ▶ Start don't start it, and it can't take port 3000 by accident. To run it in Docker instead (and not `npm run dev` at the same time): `docker compose --profile frontend up -d frontend`.
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
- **Book appointment** (`/doctors`) is the one place where patients find a hospital and book (owner requests 2026-11-18). There is no separate "Find hospitals" page any more: `/hospitals` forwards here, keeping `?q=`. `/hospitals/<id>` is still the hospital page with its doctors and a small OpenStreetMap map of where it is.
  - **Search bar:** hospital, doctor, specialty or area ("Apollo", "heart", "Anna Nagar"), typos allowed; a fee filter; and specialty and city chips.
  - **Buttons:** **Instant booking only**, **Near me** and **Show map**.
  - **Results, in order:**
    1. **MediConnect hospitals:** book instantly, with matching specialists.
    2. **Other hospitals:** every other listed hospital, 20 at a time with "Show more". Cards show the area without house numbers or postcodes, specialties, "Request appointment" and **View details**.
    3. **Doctors listed on hospital websites:** shown when searching.
  - **Near me** asks for the location only when pressed. It then shows one list, nearest first, with "x km away" ("about" when the pin isn't verified) and a distance filter. The first time in an area, that area's hospitals load from OpenStreetMap in the background. `/doctors?near=1` (the footer's "Hospitals near me", the dashboard's nearby card) starts here.
  - **Show map** opens a map of the hospitals currently listed, with the patient (blue), MediConnect hospitals (teal) and others (grey). Tapping a pin highlights its card. Hospitals without a pin are counted, never placed.
  - **Backend:** `GET /api/search/?type=hospitals&q=&city=&partners=0|1&size=20&page=` (`0` = not partners, `1` = partners only) also returns `cities`; `partner-hospitals` results include `latitude`/`longitude`. Every word typed must match.

### All hospitals on the map (OpenStreetMap directory)

- Near me shows **every hospital** in the area, not only partners. `GET /api/hospitals/nearby/` and `GET /api/hospitals/city/?name=Chennai` return `is_partner`, `has_website`, and `loading_more`.
- The map is split into ~11 km tiles (`OsmTile`). A tile not refreshed in 24 h is downloaded in the background (Celery `sync_osm_tile_task`, Overpass API, no key), saved as `source=osm` hospitals, and indexed in one bulk Elasticsearch update. Existing hospitals (same name within 300 m) are linked by `osm_id`, never duplicated or overwritten.
- Search (`/doctors`, "Find hospitals or doctors") shows three groups:
  - **MediConnect hospitals** (`GET /api/search/partner-hospitals/?q=&department=&city=&max_fee=`): partner hospitals, each with its specialties and the specialists that match the search ("heart" → the hospitals with cardiologists, typos allowed). Opening one shows its doctors grouped by specialty (`/hospitals/<id>?specialty=Cardiology`). Works without Elasticsearch too (plain database matching).
  - **Other hospitals**: not on MediConnect yet, from the map and their own websites.
  - **Doctors listed on hospital websites** (`GET /api/search/listed-doctors/?q=`).
- Opening a hospital page (logged in) reads its website with Playwright if the saved copy is older than 24 h. The page has a doctor search box.
- Most OpenStreetMap entries have no website, so MediConnect looks for it on **Wikidata** (free, no key): first through the Wikidata link on the map entry (during the map import), then, when a patient opens a hospital without one, by name. A name match is accepted only if it's within 15 km, or a hospital group from the same country (`DIRECTORY_COUNTRY_QID`, default India). Each hospital is searched at most once per 30 days; the patient can still paste a website. The page shows where a website came from (`website_source`: OpenStreetMap / Wikidata / added by a patient, the last two "not confirmed by the hospital").

### Hospital lookup from its own website (Playwright)

Flow: patient looks up a hospital → served from PostgreSQL if collected < 24 h ago → otherwise a background job: OpenStreetMap (address, pin, website) → URL safety + robots.txt → Playwright (Chromium) reads up to 6 useful pages on that site → built-in patterns extract doctors/departments/timings/contacts (no AI: the OpenAI key is only for the chatbot) → saved with source URL + time → live notification.

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

Before each run, `global-setup.ts` calls `manage.py e2e_setup`. It resets its own `e2e.*` accounts (password `E2e@12345`), an "E2E Partner Hospital" with a doctor who works every day, and an "E2E Mock Website Hospital" whose website is the mock site. It never touches other data, and refuses to run unless `DJANGO_DEBUG=1`. To remove that test data afterwards (e.g. to keep your own accounts and dashboards clean), run `docker compose exec backend python manage.py e2e_cleanup`: it deletes only `e2e.*` accounts (with everything they created) and the "E2E …" hospitals, then rebuilds the search index.

### Demo data for a project review

`demo_setup` creates a clearly-labelled demo you can show live, and `demo_cleanup` removes it again. It never touches other data and only runs with `DJANGO_DEBUG=1`.

```powershell
docker compose exec backend python manage.py demo_setup      # run it on the morning of the review
docker compose exec backend python manage.py demo_cleanup    # afterwards
```

- **Five made-up hospitals, all connected:** "MediConnect Demo Hospital", "Demo Children's Hospital", "Demo Bone & Joint Clinic" and "Demo Women's Care Hospital" in Chennai, plus "Demo Multispeciality Hospital" in Coimbatore. They have no real address and an unverified map pin, because they don't exist. A real hospital's name is never used for demo data.
- **11 doctors** across Cardiology, General Medicine, Pediatrics, Orthopedics, Neurology, Gynecology, Dermatology and ENT. The main demo hospital's two doctors work 08:00–20:00 every day, so a live booking always works; the others work Monday–Saturday.
- **Hospital logins:** two of the hospitals (the main one and the Children's) have one, with staff records (doctors and nurses, with salaries). So the platform dashboard shows 5 connected hospitals but 2 hospital accounts.
- **Patients:** three, with health details: one with an allergy, one who answered "No" to everything, one with conditions and medicines.
- **Appointments:**
  - 15 completed visits over the past four weeks;
  - 8 upcoming bookings, only on each doctor's working days;
  - today's queue: one patient checked in with token 1, and one still to arrive. This only works between 08:00 and 20:00, which is why the command is run on the review day.
- **Logins:** written to `backend/.demo-logins.json` (gitignored). All demo accounts share one password: a new random one each run, or your own with `--password`. Accounts are `demo.*@mediconnect.dev`.
- **Platform dashboard:** while the demo exists, its counts include the demo accounts and demo hospitals.

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
- [x] Phase 7 — OpenAI chatbot (the key now works; a live chat with it hasn't been checked by hand yet)
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
- **Hospital sign-up** (owner request 2026-11-18; phase 1 of 2): sign-up's "I am a" offers **Patient, Doctor or Hospital**, and the login page's Hospital tab links to "Create a hospital account".
  - A hospital uses MediConnect as its management software (doctors, nurses, staff, salaries, patient records), connected or not.
  - Signing up creates the manager's login plus a **private** hospital (`source=account`). Patients can't see or book it until the platform admin connects it, and the dashboard says "Not connected to MediConnect yet".
  - Owner decision: like self-registered doctors, a new hospital account can open patients' records by patient ID straight away (no verification); every view is logged and shown to the patient.
  - **Phase 2, Connect with MediConnect** (done 2026-11-18):
    - The hospital dashboard shows "Request connection": address and phone (required, saved on the hospital because patients will see them) plus an optional message.
    - The platform admin gets a notification, a **Connection requests** page (`/admin/connections`, also in "Waiting for you") and **Approve / Decline**. A decline needs a reason, which the hospital sees, and it can "Ask again".
    - Approving connects the hospital (`is_approved`, `approved_at`): patients can find it, and doctors can choose it in their profile and take bookings. The hospital's admins are notified either way.
    - Model `hospitals.ConnectionRequest` (table `hospital_connection_request`; the database allows one pending request per hospital). API: `GET/POST /api/hospital-admin/connection/`, `GET /api/platform/connection-requests/?status=pending`, `POST …/<id>/approve/` and `…/<id>/decline/` (`{note}`).
    - A connected hospital has no map pin until one is set in Django admin; we never invent coordinates.
- **Hospital Appointments: the hospital confirms first** (owner request 2026-11-18):
  - **When it applies:** at a hospital with a Hospital account, as long as its switch "Confirm bookings before they reach doctors" is **on** (the default; `Hospital.confirm_bookings`).
  - **Booking:** the slot is **held** at once, so nobody else can take it (`Appointment.awaiting_hospital`). The patient sees "Waiting for hospital" and gets an email. The hospital's admins get a notification; the **doctor gets nothing yet**.
  - **The Appointments page** (`/admin/appointments`, in the hospital sidebar) has tabs To confirm (with a count), Today, Upcoming, Past and Cancelled, plus a doctor filter and the switch.
    - **Confirm:** the booking becomes confirmed, and the doctor gets it in their list with a notification and email, as does the patient.
    - **Decline:** needs a reason. The slot is freed, and the patient sees the reason (in-app and email).
  - **Rules for unconfirmed bookings:** not in the doctor's list or queue, no check-in, no reminders, never auto-completed. If one is cancelled before a Confirm (by the patient or the hospital), the doctor never sees it, and a patient's cancellation notifies the hospital.
  - **Hospitals without a Hospital account,** or with the switch off, work as before: the booking goes straight to the doctor.
  - **API:** `POST /api/appointments/<id>/hospital-confirm/`, `…/hospital-decline/` (`{reason}`), `GET /api/appointments/?awaiting=1`, `GET/PATCH /api/hospital-admin/booking-settings/`. The hospital overview has `counts.to_confirm`.
  - **Tests:** `e2e_setup` turns the switch off for "E2E Partner Hospital"; `hospital-appointments.spec.ts` turns it on for its own test. `demo_setup` adds 2 bookings waiting at MediConnect Demo Hospital.
- Login: four tabs, **Patient | Doctor | Hospital | Admin**. Hospital is for a hospital's manager (hospital admin), Admin only for the MediConnect platform admin. An account can only log in on its own tab: e.g. a patient on the Doctor tab gets "This is a patient account… Choose the Patient tab", and nothing is saved. Show/hide password, and **Remember me** (unticked = the login is kept in `sessionStorage` and ends when the browser closes).
- Patient dashboard: next appointment, hospitals near you (asks for the location only when you click "Use my location"), MediConnect hospitals with a Book button, upcoming appointments.
- Doctor dashboard: today's appointments, visits still to see, next patient, today's schedule with status pills, today's duty hours and hospital. It refreshes when a live notification arrives.
- Admin dashboard: bookable doctors, partner hospitals, today's appointments, and hospitals and appointment requests waiting for approval.

#### Medical records (Step 2)

- **Patient ID:** every patient gets a random ID like `P483920` (`accounts.PatientProfile`, created at sign-up; existing patients got one in a migration). It's in `GET /api/auth/me/` as `patient_id` and on the records page.
- **Patients** (`/patient/records`): upload PDF, JPG or PNG files up to 10 MB with a title, type (lab report, scan, X-ray, prescription, discharge summary, other), date and notes; download and delete them; see **Who opened your records**. Files are checked by their first bytes, not just the name, so a renamed program is refused.
- **Private files:** stored in the Docker volume `record_files` (`PRIVATE_MEDIA_ROOT=/data/private_media`), outside the code folder and OneDrive, under random names. They have no public URL: the only way to get one is `GET /api/records/<id>/file/`, which checks who is asking every time and always sends it as a download. Deleting a record (or the account) deletes the file.
- **Doctors** (`/doctor/records`, or the patient-ID box on the doctor dashboard): enter a patient ID to see the patient's medical history. **The patient ID is a general ID** (owner decision 2026-11-17, replacing the first rule of "patients with an appointment at your hospital"): any doctor or admin account can open any patient's records with it, wherever the patient was treated. Lookups are limited to 30 a minute per account. Known risk, accepted by the owner: doctor accounts aren't verified, so anyone who signs up as a doctor can do this too.
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

Owner decisions (2026-11-17): hospital admins open records like doctors (with the general patient ID, logged); nurses are staff records without a login.

- **Two kinds of admin.** A **hospital admin** (since 2026-11-19: a hospital account, role `hospital`) is linked to one hospital (`staff.HospitalAdmin`). They see only that hospital's staff, patients and appointments. The **platform admin** is a Django superuser: hospital approvals, departments, requests to non-partner hospitals and other users' website lookups are platform-only. Before Step 4 any `admin` account could approve any hospital.
- **Hospital accounts (since 2026-11-19):** a hospital is an account of its own, role `hospital`, logging in with the **hospital's email** (not a person's). It is made by the hospital sign-up (hospital name, hospital email, password, city, phone), or by a platform admin in Django admin (a user with role Hospital + a **Hospital profile** entry). Before 2026-11-19 these logins had role `admin`; migration `accounts 0008` converted them, named them after their hospital and copied their email into `all_hospitals.email`.
- **Doctors / Nurses** (`/admin/doctors`, `/admin/nurses`): staff records (`staff.StaffMember`) with department, designation, phone, email, join date, leaving date and monthly salary. A doctor's record can be linked to their MediConnect doctor account (only accounts at the same hospital, one record per doctor). The database refuses negative salaries, links on nurse records, and leaving before joining. Salaries are visible only to that hospital's admins (and superusers).
- **Patients** (`/admin/patients`): everyone with a booked, confirmed or completed visit at the hospital, with visits, last and next visit, and how many records they have. **Records** opens them, and **Open by patient ID** opens any patient's history; the patient sees "(hospital admin)" in their log.
- **Staff & salary** (`/admin/salary`): monthly payroll in total, for doctors and nurses, and by department.
- **Dashboard:** total doctors, nurses and patients, today's appointments and how many are waiting, the staff chart (doctors and nurses on staff at the end of each of the last 6 months; colours checked with a colour-blindness validator, with marker shapes and end labels as a second cue), and recent activity.
- A platform admin without a hospital sees the platform overview (hospitals awaiting approval, appointment requests).

### Reference-design features, Part 1 (shared by all three users)

- **Avatar menu** (top bar): Profile & settings, Contact support, Sign out.
- **Profile & settings** (`/settings`, owner's reference design 2026-11-18):
  - Opens as a clean **read-only profile**: a header card with initials, name, account type, patient ID, Phone / Email / Copy ID tiles, "Profile X% complete".
  - Then sections with UPPERCASE headings and label → value rows: Personal information, Body, Medical, Emergency contact, Security. Empty answers show "Not added".
  - **Edit** opens one form (name and phone plus health details) with **Save changes** / **Cancel**; both go back to the profile.
  - **Change password** (under Security; current password required, weak passwords refused).
  - Doctors and admins see Personal information and Security only.
- **Health details** (patients, on Profile & settings; owner request 2026-11-18). All optional:
  - date of birth (age is worked out), gender, height, weight (with its "updated on" date), BMI (worked out), blood group;
  - allergies, long-term conditions (tick list + other), current medicines, emergency contact.
  - Allergies, long-term conditions and medicines are each a **Yes / No question**; Yes opens the details (and needs something written), No is saved as "none", so a doctor can tell "none" from "not filled in".
  - A "Profile X% complete" bar counts the 9 questions.
  - Range checks: height 30–250 cm, weight 1–300 kg, phone 7–15 digits.
  - Doctors and admins see them read-only when they open the patient's records by patient ID, with allergies first in red.
- **Forgot password?** (login page → `/forgot-password` → email → `/reset-password`): a one-time link that expires after 1 hour. The answer is the same for unknown emails, and requests are limited to 3 an hour per email address and 20 an hour per network address. Locally the email arrives in Mailpit.
- **Need help? Contact support** (sidebar card → `/support`): send a message with a topic and see your messages and replies. Support's inbox gets an email (`SUPPORT_EMAIL`). The platform admin answers in Django admin → Support requests; saving a reply marks the request answered and notifies the user. Limited to 10 an hour per user.

### Other staff (hospital accounts)

Owner request (2026-11-18): besides doctors and nurses, a hospital manages its **other staff**.
- **Menu:** Doctors · Nurses · **Other staff** · Patients · Staff & salary.
- **Roles:** lab technician, pharmacist, receptionist, office / admin staff, housekeeping, security, and **Other**, which needs a job title (e.g. "Ambulance driver").
- **Other staff page** (`/admin/staff`): the same features as Doctors and Nurses (search, working now / left, add, edit with a leaving date, delete), plus a role filter.
- **API:** `GET /api/hospital-admin/staff/?kind=other_staff` (every kind except doctors and nurses) or `?kind=pharmacist,receptionist`.
- **Dashboard:** an "Other staff" card; the payroll and recent activity include them ("New ambulance driver added"). **Staff & salary** has an Other staff card and column.
- The staff chart still compares doctors and nurses.
- **Sidebar** (owner request 2026-11-18): Doctor management · Nurse management · Staff management (other staff) · Patient management · Staff & salary. Page headings match.
- **Payroll per month** (Staff & salary, `GET /api/hospital-admin/payroll/?months=6|12`, max 24):
  - the salary cost of each month, as a bar chart (axis in lakhs, full amount on hover) and a table (staff, doctors, nurses, other staff, total);
  - a person counts in every month they worked at least one day, with their full monthly salary.
  - MediConnect stores only each person's **current** salary, so past months use today's salaries; the page says so. Raises would need a salary history to show up.
- `demo_setup` adds other staff to both demo hospitals that have a Hospital login.

### Patient management: simple list columns (2026-11-22)

Owner request: the list shows only three things per patient (plus name, ID, phone, email and Open):
- **Visit**: the patient's visit date. The hospital sets or changes it inside the patient's page in a **Visit** box under the patient's name (**Set visit date** / **Change visit date** / **Clear**; moved out of Edit details because it was hard to find; past, today or upcoming; stored on `hospital_patient.visited_on`, migration `staff 0007`, column only added). If it isn't set, today's appointment at the hospital is used, else the next upcoming one, else the last completed one. The list shows **Not set** when there's no date.
- **Visit status** (added the same day, between Visit and Records): worked out from the visit date each day: before today **Past**, today **Current**, after today **Upcoming** (`staff/patients.pick_visit`).
- **Records**: how many records **this hospital uploaded** for the patient (not the patient's own uploads, and not ones the hospital deleted).
- **Payment**: **Pending ₹X** while any slip is unpaid, **Completed** when every slip is paid, "—" without slips.
- The old Visits / Last visit / Next visit columns are gone. Tests: `staff/test_patients.py` (+1), `staff/tests.py` updated; e2e `patient-management.spec.ts` sets an upcoming date and checks the columns.

### Patient management: fixing an email (2026-11-22)

- The list keeps only **Open** (owner request: editing stays inside the patient's page, **Edit details**). An Edit button in the list was tried and removed the same day.
- The hospital can now **set or change the email** of a patient it created, as long as the patient hasn't started using the app (no password): it's what the hospital's staff typed, so they can fix it. A patient who logs in themselves (or one the hospital didn't create) keeps their own email (`staff/patients.may_edit_email`, `can_edit_email` on the patient page).
- Tests: `staff/test_patients.py` covers both cases; e2e `patient-management.spec.ts` opens the patient, edits and fixes an email typo.

### Hospital profile as a professional profile (2026-11-24)

**Hospital profile** (`/admin/hospital`) now opens read-only: a header card (name, Connected / Not connected yet badge, address, **Edit profile**), three key facts (departments, map pin, patients can book), and sections **Contact** (phone, website, login email), **Address**, **Departments** (chips) and **Location** (map + Get directions as patients see it). **Edit profile** opens the same form as before (with **Cancel**); saving returns to the profile with "Saved." e2e `hospital-profile.spec.ts` updated.

### Doctor dashboard: no comparison with yesterday (2026-11-25)

The **Today's appointments** card shows today's count and "N completed" only; the "+N / −N from yesterday" line is gone (no extra request for yesterday's list). e2e `auth.spec.ts`.

### Need help?: emergency line for patients only (2026-11-25)

The red "In a medical emergency, call 112 or an ambulance on 108. Support can't help with emergencies." box on **Need help?** (`/support`) is no longer shown to doctor and hospital accounts; patients (and the platform admin) still see it. e2e `settings.spec.ts`.

### Date filter on hospital appointments (2026-11-24)

**Appointments** (hospital) has a **Date** filter next to **All doctors**, on every tab: Any date, Today, Tomorrow, Yesterday, This week (Mon–Sun), Next 7 days, Last 7 days, This month, Last month, **On a date…** (one date box) and **Between dates…** (From / To; reversed dates still work). **Clear filters** resets doctor and date. It filters the loaded list in the browser (`lib/dateFilter.ts`, local calendar dates). e2e `appointment-date-filter.spec.ts`.

### Hospitals write their own departments (2026-11-24)

**Suggestions while typing:** under the department box, matching departments appear as you type; click one (or ↓/↑ + Enter) to tick it. Spelling mistakes and doctor-style words are tolerated (`lib/departmentMatch.ts`: "gynocologist" → Gynecology, "kardiology" → Cardiology, "pediatrician" → Pediatrics; it compares word stems with an edit distance of 1 letter per 4 typed). The last option adds the typed text as a new department. Synonyms (e.g. "skin" → Dermatology) aren't covered.

In **Edit hospital profile → Departments**, besides ticking listed departments, the hospital can type one that isn't listed (**+ Add** or Enter). On save (`new_departments` on `PATCH /api/hospital-admin/profile/`) a name matching an existing department ignoring case reuses it; otherwise it's created and joins the shared list (patients can filter by it). Names: 2–100 characters, letters/digits/spaces and `& - ( ) . / , '`. Departments a hospital writes are marked as its own (`Department.created_by`, migration `hospitals/0019`); Every department the hospital has (and every one it wrote) gets an **×** in the form (`DELETE /api/hospital-admin/profile/departments/<id>/`): it's removed from the hospital at once; a department the hospital wrote also leaves the shared list when no other hospital, doctor account or staff record uses it (staff keep their department; platform departments like Cardiology always stay in the list). Tests in `staff/test_profile.py`; e2e departments named "E2E Dept …" are removed by `e2e_setup` / `e2e_cleanup`.

### Show on map from the hospital list (2026-11-24)

Each hospital card on **Book appointment** (MediConnect hospitals, Other hospitals, Near me) has **Get directions** (Google Maps, new tab) and **Show on map** side by side (bordered buttons). **Show on map** (when the hospital has a pin): it opens the map, zooms to that hospital, highlights its pin and opens its popup (View hospital · Get directions). `HospitalMap` `FocusSelected` (zooms only when the chosen hospital changes, so the patient can still move the map), and the fit-all-pins step is skipped then. e2e `hospitals.spec.ts`.

### Get directions on the hospital map (2026-11-24)

A **hospital's page** (Book appointment → a hospital) now has **Get directions** and **Show on map** buttons next to its name (Show on map scrolls to the page's map and opens the pin) and a **Get directions in Google Maps ↗** link under its map (the popup alone was too hidden). On **Book appointment → Show map**, each hospital pin's popup also has **Get directions ↗** (Google Maps, opens in a new tab) next to "View hospital". It uses the same link as on appointments: the exact pin when the location is confirmed, else the hospital's name and address. `directionsUrl` moved to `lib/directions.ts` (still re-exported from `HospitalPlace.tsx`). e2e `hospitals.spec.ts` checks the link.

### Doctor, nurse and staff pages, like Patient management (2026-11-22)

Owner request: the lists show each person with their department up front, and **Open** shows all their details.
- **Lists** (Doctor, Nurse and Staff management), laid out in labelled columns like Patient management (name | **Role** | **Department** | **Status** | Open; stacks on phones): only the **name**, a **role** badge (Doctor, Nurse, Housekeeping, Pharmacist…; the job title for "Other"), a **department** badge, a **Working here** / **Left …** badge and **Open** (simplified the same day at the owner's request: contact number, joined date, role line and salary are inside Open). Edit and Delete moved to the person's page. Search still finds department, specialization, phone and email.
- **A person's page** (`/admin/doctors/staff/<id>`, `/admin/nurses/<id>`, `/admin/staff/<id>`; `components/StaffMemberPage.tsx`): status (Working here / Left), **Work** (role, designation, department, specialization, qualification, joined, left on, time here) and **Contact and salary** (contact number, email, monthly and yearly salary, MediConnect account), with **Edit** (the same form) and **Delete**. A doctor with a MediConnect account also shows their **MediConnect doctor profile** (specialization, qualification, experience, fee, slot length, bookable) and their **Accepted / Rejected / Waiting** appointments (`components/DoctorAppointmentsPanel.tsx`, shared with `/admin/doctors/<doctor id>`).
- New optional fields on staff records: **specialization** and **qualification** (migration `staff 0006`, columns only added). For a linked doctor, the account's values are shown when the record leaves them empty. The staff API also returns `doctor_profile`.
- Tests: 1 new in `staff/tests.py`; 298 backend tests pass; all 42 Playwright tests pass in one run (incl. queue and notes). e2e `staff-pages.spec.ts` (a nurse: add, list with department, open, details, edit salary, delete; a doctor with an account: profile and appointments).

### Payment slips — Phase 2 of 2 (screens) (2026-11-21)

- **Patient management → a patient's page → Payments:** Pending and Paid totals; **New payment slip** with lines (description, quantity, price; + Add line, remove), discount, slip date, optional visit, notes, a **live total**, and "Already paid" (with the method) for bills paid on the spot. Each slip shows its number, status badge, total and lines, with **Slip** (view/print), **Mark as paid** (method + date), **Edit** and **Cancel** while pending, and **Back to pending** (reason required) once paid.
- **Patient list:** a **Pending** column with what each patient still owes the hospital (`pending_amount` in `GET /api/hospital-admin/patients/`).
- **Printable slip** (`/admin/payments/<id>`, `/patient/payments/<id>`): hospital name, address, phone and email; slip number, date and status; patient and patient ID; the visit; lines, subtotal, discount and total; paid on/by or "Payment pending. Amount due". **Print or save as PDF** uses the browser's print dialog; print styles show only the slip, on white (`.print-area` in `globals.css`). No new library.
- **Patient:** new menu item **My payments** (`/patient/payments`): Pending and Paid totals and every slip from every hospital, each openable and printable. It has the "MediConnect is your Better Partner" top bar like the other patient pages without search.
- `e2e_setup` clears the test hospital's slips each run. e2e `payments.spec.ts`: bill the E2E patient with two lines and a discount (live total ₹1,100.00) → print page → mark paid by UPI (locked) → the patient sees it in My payments.

### Payment slips in Patient management (2026-11-21) — Phase 1 of 2 (backend)

Owner decisions: an **itemised** slip, status **Pending / Completed**, the **patient sees** their slips, a **printable** slip page, and **completed slips are locked**.
- New app `billing`: tables `payment_slip` and `payment_item`. A slip has a number per hospital and year from the hospital's initials (`EPH-2026-0001`), a date, an optional visit, lines (description × quantity × price), an optional discount, notes, and the **total worked out by the server** (a total sent by the browser is ignored). Database checks: no negative amounts, one number per hospital, a completed slip always has a method and paid date.
- **Pending** slips can be edited or **cancelled** (optional reason). **Completed** = paid with **Cash, Card, UPI, Insurance or Other** and a paid date (today by default); it's locked and can only go **back to Pending with a reason**, which stays on the slip. A slip can also be created already paid.
- The patient gets in-app notifications: "New payment slip" and "Payment received".
- API: hospital `GET/POST /api/hospital-admin/payments/` (`?patient=`, `?status=`; totals pending/completed), `GET/PATCH …/<id>/`, `POST …/<id>/complete/`, `…/reopen/`, `…/cancel/` (only patients in its list, only its own slips); patient `GET /api/payments/` and `/api/payments/<id>/` (read-only). Each slip includes the hospital's name, address and phone, and the patient's name and ID, for the printed slip. Read-only in Django admin.
- Tests: `billing/tests.py` (6); 297 backend tests pass.

### Hospital Patient management — Phase 2 of 2 (screens) (2026-11-21)

- **Patient management** (`/admin/patients`): an **Add patient** box with two tabs, **Has a patient ID** and **New patient** (first and last name, phone; email, date of birth, gender optional; the page explains that no password is needed). The list shows every patient added or with a visit, with phone, email (or "No email"), visits, records and "Added by you", and an **Open** button. Search also finds phone numbers.
- **A patient's page** (`/admin/patients/<patient_id>`): name, ID, age, gender, phone, email, whether they use the app; **Edit details** (name, phone, email if they have none, and the same health details form the patient uses); **Medical records** (all of them, "Uploaded by <hospital>" on yours, Delete only on your uploads: "The patient keeps their copy") with an **Upload a record** form; **Visits at your hospital**; **Treatment notes**; **Add to my patients** / **Remove from my patients**. Opening it is logged for the patient.
- The separate **Patient records** menu item is gone for hospitals (doctors keep theirs); old `/admin/patients/records?id=` links open the patient's page.
- **Patient side:** My medical records shows "Uploaded by <hospital>"; deleting one says "<hospital> keeps its copy".
- Shared pieces: `components/RecordUploadForm.tsx` (moved out of the patient's page, `endpoint` prop), `HealthDetailsForm` takes `load`/`save` (patient's own API by default), `RecordList` shows the uploader and asks the right delete question.
- e2e: new `patient-management.spec.ts` (new patient without email → edit details → upload; add the E2E patient by ID → upload → the patient sees and removes it → the hospital still has it and deletes its copy); `admin` and `notes` specs updated.

### Hospital Patient management: add patients, details and records in one place (2026-11-21) — Phase 1 of 2 (backend)

Owner decisions: the hospital adds **every patient who visits**, whether or not they have a MediConnect account, and manages their details and medical records inside Patient management (the separate "Patient records" menu item goes in Phase 2).
- **The hospital's patient list** = patients it added (new table `hospital_patient`) + everyone with a visit booked there.
- **Add a patient** (`POST /api/hospital-admin/patients/add/`): by **patient ID** (already on MediConnect), or **new**: name and phone, optional email, date of birth, gender. A new patient gets a patient ID but **no password and no email** (hospitals and doctors open records by ID). Without an email they get a hidden placeholder on the reserved `no-email.mediconnect.invalid` domain, which never receives mail. A patient with an email can claim the account later with "Forgot password?". A used email is refused without revealing whose it is.
- **Open a patient** (`GET /api/hospital-admin/patients/<patient_id>/`): details, health details, records, treatment notes and visits at this hospital; logged in the patient's access log, like every records view. Any patient can be opened by ID; **editing** (`PATCH`: name, phone, email if they had none, health details) and **uploading records** need the patient in the hospital's list. **Both the hospital and the patient can edit health details.** `DELETE` removes a patient the hospital added from its list (the account stays; patients with visits stay listed).
- **Records the hospital uploads** (`POST …/records/`, `DELETE …/records/<id>/`): the patient sees them in My medical records ("Uploaded by <hospital>") and gets a "New medical record" notification. **Each side's Delete removes only its own copy** (`hidden_for_patient` / `hidden_for_hospital` on `MedicalRecord`); the record and file are deleted once neither side keeps it. The hospital can delete only its own uploads; the patient can't edit a hospital upload's details. Doctors and other hospitals see what the patient keeps.
- Tests: `staff/test_patients.py` (6); 291 backend tests pass. `e2e_setup`/`e2e_cleanup` remove patients created by E2E hospitals.

### New booking flow — Phase 2 of 2 (screens) (2026-11-21)

- **Booking page** (`/doctors/<id>`): reached from a hospital's specialist list (`?via=hospital`) it sends a hospital request and says "Booking through <hospital>: the hospital accepts your request and assigns a doctor, then the doctor confirms"; reached directly it says "Personal request to Dr. …". The chatbot's booking is a personal request ("✓ Request sent! Your time is held until the doctor accepts").
- **Statuses** everywhere: "Waiting for hospital", "Waiting for doctor", then Confirmed; the patient sees "Declined by the doctor/hospital: <reason>" or "Not confirmed before the appointment time".
- **Doctor → Appointments:** requests given to the doctor are highlighted ("Assigned to you by <hospital>" / "Personal request to you") with **Accept** and **Reject** (a reason is required).
- **Doctor → Duty schedule:** new **Duty assigned for you** list (accepted appointments still ahead, and from where) and a "N requests waiting for your answer" link; the weekly hours editor stays below.
- **Hospital → Appointments:** the on/off switch is gone (a short "How bookings reach your doctors" note instead). Tabs **To assign** and **Waiting for doctors** with counts. Each request has an **Accept & assign** box: a doctor dropdown (the patient's choice first; doctors who aren't free then are greyed out; a doctor who rejected it is marked) and Decline with a reason. After a rejection it shows "Dr X rejected it: <reason>" with **Reassign**.
- **Hospital → Doctor management:** an **Appointments** button on each doctor with a MediConnect account opens their page (`/admin/doctors/<id>`) with **Accepted / Rejected / Waiting for answer** tabs (a rejection shows the reason and "now with Dr Y" after a reassignment). A box lists doctors who chose the hospital in their profile but aren't on the staff list yet.
- **Hospital dashboard:** "N bookings to assign · N waiting for doctors".
- Fixed on the way: the hospital's Appointments page re-loaded (and lost a doctor just picked) whenever a notification refreshed the logged-in user; a late, repeated load of the doctor list could also undo a doctor just picked (it's now ignored, and a pick is never overwritten); the Assign dropdown says "Choose a doctor…" instead of showing an unselected doctor.
- Results: all 37 Playwright tests pass in one full run; type check and lint clean.
- e2e: `bookAsPatient` has the doctor accept by default (`{ accept: false }` / `{ source: "hospital" }` for requests); `booking.spec` (personal: doctor accepts live), `hospital-appointments.spec` rewritten (book through the hospital page → decline one → assign → doctor rejects → reassign → doctor accepts → Duty assigned → doctor page Accepted/Rejected); `chatbot` and `search` specs updated.

### New booking flow: hospital assigns, doctor accepts or rejects (2026-11-21) — Phase 1 of 2 (backend)

Owner decisions: **how the patient booked decides who approves.**

```
HOSPITAL request (patient booked through the hospital's page):
  patient books → hospital: Accept & assign (the chosen doctor, or another free doctor of theirs) / Decline (reason)
                → doctor:   Accept → "confirmed"  /  Reject (reason) → back to the hospital: reassign or decline
PERSONAL request (patient found the doctor directly), or a hospital without a hospital account:
  patient books → doctor:   Accept → "confirmed"  /  Reject (reason) → declined, the patient is told why
```
- New fields `appointments.source` (personal / hospital) and `awaiting_doctor`; new table `doctor_rejection` (every rejection is kept, also after the hospital reassigns). Rules in `appointments/flow.py`. Migration `appointments 0008` marks bookings already waiting for a hospital as hospital requests.
- The hospital's switch **"Confirm bookings before they reach doctors" is removed** (column `all_hospitals.confirm_bookings` dropped, migration `hospitals 0018`; database backed up first). The kind of request decides the flow instead.
- The slot stays held until the request is declined or cancelled, so there's no double booking. Only accepted appointments get reminders, the queue, treatment notes, no-show and auto-complete. Requests nobody answered before their time are cancelled by a new hourly job ("Booking not confirmed", `expire_unanswered_requests`).
- API: `POST /api/appointments/` takes `source`; `hospital-confirm/ {doctor?}` = Accept & assign; `GET assignable-doctors/` (the hospital's doctors: free at that time? already rejected it?); `doctor-accept/`; `doctor-reject/ {reason}`; `?awaiting=doctor` lists requests waiting for the doctor; `GET /api/hospital-admin/doctors/<id>/appointments/` (one doctor's waiting / accepted / rejected, for Doctor management). `booking-settings/` is gone.
- Notifications: the patient is emailed for "Booking received", "Appointment confirmed" (doctor accepted), declines (with the reason) and expiry; doctors and the hospital get in-app notifications ("New appointment request", "New appointment to accept", "Doctor rejected an appointment").
- Tests: `appointments/test_booking_flow.py` (9) replaces `test_hospital_confirmation.py`; 285 backend tests pass. Phase 2 (below) added the screens.

### Doctor's "My hospital & profile" redesigned (2026-11-21)

Owner request: a professional look after editing. The page (`/doctor/profile`) used to be only an open form. Now:
- It opens as a **read-only profile**: avatar, "Dr. name", specialization · qualification, hospital, an **Accepting bookings / Not bookable yet** badge, and three key facts (experience, consultation fee as "₹700", slot length). Below: **Hospital**, **Practice details** and **About you** sections. **View public page** opens what patients see.
- If patients can't book the doctor yet, a box says why: choose a hospital, set working hours (link to Duty schedule), or the hospital isn't connected yet.
- **Edit profile** opens the form, grouped into the same sections, with **Save changes** and **Cancel**; saving returns to the profile with "Profile saved.". The page heading matches the menu ("My hospital & profile").
- No backend change. e2e `doctor-profile.spec.ts` (view, cancel, save, puts the bio back).

### Duty schedule with AM/PM (2026-11-21)

The doctor's **Duty schedule** used the browser's time box, which shows AM/PM only on some computers (it follows the system clock setting), so the owner saw 24-hour times. Each time is now three dropdowns, **hour (1–12) : minutes (5-minute steps) AM/PM** (`components/TimeSelect.tsx`), the same on every computer and phone. The API still stores 24-hour "HH:MM", so nothing else changed. The doctor dashboard's "Today's duty" panel (renamed from "Duty today") shows times as "6:00 AM – 10:00 PM". e2e `duty-schedule.spec.ts` (changes a time, checks it after a reload, puts it back).

### Small menu and search changes (2026-11-21)

- The "Emergency? Call 112 or ambulance 108" line under Need help? is now shown to **patients only** (removed from the doctor, hospital and platform admin menus).
- Patients no longer get the top-bar "Search doctors, hospitals…" box on **My appointments**, **My medical records** and **Profile & settings** (it stays on their dashboard; Book appointment has its own search). On those pages and on Book appointment, the top bar shows "MediConnect is your Better Partner" instead. Doctors and hospitals (no top-bar search at all) see that line in the top bar on every page.
- e2e `admin`, `settings` and `no-show` specs check both.

### % trends on the hospital dashboard (2026-11-21)

The five cards on the hospital dashboard now show a change in percent (green ↑, red ↓, grey → for no change), counted from real data (`GET /api/hospital-admin/overview/` → `trends`, each `{now, before, change_pct}`):
- **Doctors, nurses, other staff:** on staff today vs on the last day of last month (from join and leave dates).
- **Patients:** the hospital's patients now vs at the start of this month (by when their booking was made).
- **Today's appointments:** vs the same weekday last week ("vs 2 last Saturday"), because weekdays differ.
- When there's nothing earlier (e.g. a new hospital, or 0 before), the card says "No earlier data to compare" instead of a made-up %.
- Tests: `staff/test_trends.py` (3, clock frozen on 2026-11-21); e2e `admin.spec.ts` checks the empty case.

### Patient ID shown, locked, on the patient's profile (2026-11-21)

- **Profile & settings → Personal information** has a **Patient ID** row with a "Can't be changed" badge (the header already showed it with Copy ID).
- **Edit profile** shows the Patient ID as a locked (greyed-out) field: "Given by MediConnect; it can't be changed."
- How it's made: when a patient account is created, a signal (`accounts/signals.py`) calls `PatientProfile.for_user`, which picks a random 6-digit number with Python's `secrets` (`P100000`–`P999999`, not counting up, so it can't be guessed) and retries if the database's unique check finds it taken. It is `editable=False` and read-only in the API.
- Tests: `test_the_patient_id_can_never_be_changed` (sending a new ID to `/api/auth/me/` or `/api/auth/me/patient/` changes nothing); e2e `settings.spec.ts` checks the row and the locked field.

### Patient records: its own menu item (2026-11-21)

Owner request: opening a patient's records by patient ID is a separate feature in the left menu, not on the dashboard.
- **Hospital:** new sidebar item **Patient records** (`/admin/patients/records`, after Patient management). It was only reachable through Patient management → "Open by patient ID" (that button is removed; each patient in the list still has its own Records link).
- **Doctor:** already had **Patient records** in the sidebar; the "Quick access to patient records" box is removed from the doctor dashboard.
- **Top bar:** doctors and hospitals no longer get a "Search patient by ID" box there (owner choice); patients keep their "Search doctors, hospitals…" box.
- Nothing changed in the backend; every records view is still logged for the patient. e2e `auth`, `records` and `admin` specs now open records through the menu item.

### No-show: "Didn't come" (2026-11-21)

Owner decisions: a no-show is marked **by hand** (never automatically: hospitals that don't use check-in would see real visits counted as missed), by the **doctor or the hospital**, and the patient gets an **in-app notification**.
- New appointment status `no_show`, shown as **Missed** (red), plus `no_show_by` (doctor / hospital); migration `appointments 0007`. Rules in `appointments/no_show.py`.
- **Didn't come** (`POST /api/appointments/<id>/no-show/`): only once the visit time has started, for up to 7 days, and only if nothing shows the patient came (not checked in, never called in, no treatment note). A visit the hourly job already auto-completed can still be marked (the job can't know). **Undo missed** (`undo-no-show/`) turns it back into a completed visit within the same 7 days.
- The API tells each viewer whether they may use the buttons (`can_mark_no_show`, `can_undo_no_show`), so the page doesn't repeat the rules.
- Buttons: the doctor's **Appointments → Past** and the hospital's **Appointments** (Today / Past). A missed visit gets no "Write note" button. The patient sees "You didn't come to this visit" and a "Missed appointment" notification (no email); Undo sends "Visit no longer marked as missed".
- **Hospital Reports** count no-shows: "N missed (no-show)" under Completed visits and a **Missed** column for doctors and departments. A no-show isn't a visit, so it doesn't make someone a new or returning patient. Earlier missed visits were auto-completed and can't be told apart.
- Fixed: the appointment lists (patient, doctor, hospital) could show an old answer when reloads overlapped (switching to Past while live notifications arrive showed "No past appointments"). Only the newest request fills the list now.
- Tests: `appointments/test_no_show.py` (12), report tests updated; e2e `no-show.spec.ts` (doctor marks + undoes, hospital marks, reports count it, the patient sees it). `e2e_setup` adds the patient "Mani Noshow" with a visit two days ago.

### Doctors added by the hospital are shown to patients (2026-11-26, phase 1 of 2)

Owner request: "all the doctors should be listed whether they have a doctor account in MediConnect or not". Shiva, a neurologist ABC Hospital added in Doctor management (no doctor account), didn't appear when patients searched "neurology", because the search only listed doctors with an account and working hours.
- New `staff/listed.py`: working doctors (staff records) of **connected** hospitals who can't be booked online (no account, or an account without working hours). Doctors who have left, nurses and other staff are never shown; a doctor whose linked account is bookable is shown once, as bookable.
- Only safe details are public: name, specialization, department, qualification, designation. Phone, email, salary and dates stay on the hospital's own pages.
- Search (`/api/search/partner-hospitals/`): hospitals now also appear with only hospital-added doctors; each result has `bookable_count` and `matching_listed_doctors` (matched by name or specialty, with the word-root / everyday-word / typo matching of `search/specialties.py`: "neurology", "nerology", "brain" all find Shiva). A fee limit leaves them out (no fee known). The hospital page API (`/api/scraper/hospitals/<id>/`) adds `hospital_listed_doctors`.
- Frontend: the search card says "Listed by the hospital · not bookable online" under such a doctor, and "Instant booking" only when the hospital has a bookable doctor. The hospital page has a "Doctors listed by the hospital" section with a "Not bookable online" badge and the hospital's phone number.
- Phase 2 (next): "Request appointment" on these doctors; the hospital confirms or declines it.
- Tests: `staff/test_listed.py` (13); 340 backend tests pass (1 opt-in live browser test skipped). Checked on the running server with ABC Hospital's real data.

### Specialist search for website doctors (2026-11-26)

Owner report: searching "gynecologist" among doctors read from hospital websites listed a cardiologist, a dermatologist and a neurologist. Cause: the typo-tolerant search compared letters, and almost every specialty ends in "-ologist".
- New `search/specialties.py`: specialties are compared by their **word root** (the ending is cut off first: "gynecologist" → "gynec", "cardiologist" → "cardi"), with typo tolerance only for medical words.
- It uses the **same everyday words** as the bookable search (`indexes.SYNONYMS`), so "women" and "pregnancy" find gynecologists too. Added "gynaecologist, obstetrics, obstetrician" to that list (run `manage.py search_index --rebuild` so Elasticsearch picks them up).
- Typed text matches a specialty only from the start of a word ("urologist" no longer matches "Neurologist"). The doctor-name typo check ignores specialty words, because some websites put the specialty in the name.
- Tests: `search/test_specialties.py` (21); 329 backend tests pass (1 opt-in live browser test skipped). Checked on the running server: "gynecologist", "gynocologist", "women" and "pregnancy" find only the SRM gynecologist; "urologist" finds nobody.

### Support inbox: Open / Closed only (2026-11-25)

A message gets one reply (the sender can't write back on it), so "Answered" and "Closed" meant the same thing to the sender. Owner decision: keep only **Open / Closed / All**.
- **Send reply** now closes the message (the "Send and close" button is gone). **Reopen** still brings a message back to Open; editing the reply closes it again. A reply written in Django admin closes it too.
- Migration `support/0002` turns any old "answered" message into "closed" (the dev database had none).
- On the sender's Need help? page, a closed message with a reply shows **Replied**; one closed without a reply shows **Closed**.
- Tests: `support/tests.py` updated (replying closes, "answered" is refused); e2e `settings.spec.ts` checks the Answered tab is gone and the doctor sees "Replied".

### Support inbox for the platform admin (2026-11-20)

"Need help?" messages from patients, doctors and hospitals used to be answered only in Django admin, and the platform admin got no notification. Now:
- A new message sends every platform admin an in-app notification ("New support message", links to the inbox). The email to the support address stays.
- **Support inbox** (`/admin/support`, platform admin menu): Open / Answered / Closed / All tabs (Answered removed 2026-11-25, see above); each message shows who sent it (patient, doctor or hospital), the topic and the text. **Send reply** (→ Answered) or **Send and close**; **Close** / **Reopen**. The sender gets a "Support replied" notification and sees the reply on their Need help? page, as before.
- The platform admin's sidebar box shows **Support inbox** with the open count (instead of "Need help?"), and the account menu says "Support inbox". Open messages also appear under "Waiting for you" on the platform dashboard.
- **Close without reply** (added 2026-11-21) on Open messages that need no answer (e.g. "thanks, it works now"): the message moves to Closed with no reply; the sender sees it as Closed. **Reopen** brings it back.
- API: `GET /api/support/inbox/?status=`, `POST /api/support/inbox/<id>/reply/ {reply, close}`, `POST /api/support/inbox/<id>/status/ {status}` (platform admin only). Django admin still works as a backup.
- Tests: 4 new in `support/tests.py`; e2e `settings.spec.ts` "contact support" now goes doctor → platform admin reply → doctor sees it.

### Connected hospitals replaces "Add hospital" (2026-11-20)

Owner decision: hospitals join MediConnect only by signing up and asking to connect; the platform admin accepts or declines (Connection requests). So the platform admin's old **Hospital approvals** page (an "Add hospital" form for hospitals without a login, plus a silent approve/unapprove toggle) is now **Connected hospitals** (`/admin/hospitals`):
- Lists the connected hospitals with their hospital account email, doctors, map pin and connection date; search by name or city (`GET /api/platform/connected-hospitals/?q=`).
- **Disconnect** needs a reason (`POST /api/platform/connected-hospitals/<id>/disconnect/ {note}`): patients can't find or book the hospital any more, appointments already booked stay, and the hospital gets a notification. Its dashboard shows "Disconnected from MediConnect" with the reason and **Ask again**. Kept in the connection history as a new status `disconnected` (migration `hospitals 0017`).
- The platform dashboard no longer lists "Hospital awaiting approval" (hand-added or website hospitals); it shows connection and appointment requests.
- Nothing in the database was deleted. Hospitals can still be edited in Django admin.
- Tests: 3 new in `hospitals/test_connections.py`; e2e `platform.spec.ts` now also disconnects the hospital.

### Hospital profile (2026-11-20)

New hospital menu item **Hospital profile** (`/admin/hospital`, `GET/PATCH /api/hospital-admin/profile/`, `staff/profile.py`): the hospital edits its own details.
- **Name, address, city, state, phone, website** and **departments** (picked from MediConnect's list). Changes apply at once, also for a connected hospital: patients see them straight away. A name or city change sends the platform admin an in-app notification. The account name follows the hospital's name (the dashboard greeting changes too).
- **Map pin:** the hospital clicks its entrance on the map (or uses "Use my current location"). Owner decision: the hospital's own pin counts as confirmed (`location_verified`), so patients' "Get directions" goes to that exact pin; the platform admin isn't involved and gets no notification for pins. Without a pin the hospital doesn't appear on the map or in "Near me".
- A connected hospital can change its address and phone but can't empty them (patients need them).
- The hospital email is the login, so it is read-only here (change it through Support).
- Tests: `staff/test_profile.py` (12), e2e `hospital-profile.spec.ts`. `e2e_cleanup` also removes "hospital details changed" notifications about E2E hospitals. Fixed an order-dependent chatbot test (it relied on the test search index not existing yet; it now uses the database search on purpose).

### Hospital Reports (2026-11-20)

The hospital menu's **Reports** item (was "Soon") now opens the hospital's own reports at `/admin/reports` (the platform admin still gets the platform reports at the same address). Period switch: 6 / 12 / 24 months. Everything is counted from the hospital's real appointments (`GET /api/hospital-admin/reports/?months=`, `staff/reports.py`):
- **Totals:** appointments (not cancelled), still upcoming, completed visits (with %), patients (with how many are new), cancellations split by who cancelled (patient, doctor, or declined by the hospital).
- **Appointments per month:** booked vs completed, by visit date.
- **Patients per month:** new (first visit at this hospital that month) vs returning.
- **Doctors** and **Departments** tables: appointments, completed, cancelled and patients in the period.
- No-shows were added on 2026-11-21 (see above). Staff and payroll stay on Staff & salary.

### Hospital accounts get their own role (2026-11-19)

Owner request: a hospital logs in as the hospital, not as a person.
- New role **`hospital`** in `users.role`; `admin` now means only the platform admin (superuser).
- New column **`all_hospitals.email`**: for a hospital account it is also its login email.
- **Sign-up:** choosing Hospital asks only for the hospital's name, city, phone, **hospital email** and password (no person's name). The account is named after the hospital, so the dashboard says "Good evening, ABC Hospital!".
- **Login:** Hospital tab = role `hospital`, Admin tab = the platform admin.
- **Existing accounts:** the demo hospital logins were converted by a migration. The test hospital "ABC Hospital" and its person login were deleted at the owner's request (database backed up first).
- Hospital pages keep their `/admin/...` addresses; their dashboard heading is now "Hospital dashboard". "Who opened your records" shows hospitals as "(hospital)".

### New logo and blue theme (2026-11-19)

- **Logo:** the owner's new design (navy `#00295C`). All logo files (full logo, icon, see-through icon, browser-tab icons) are generated from `frontend/public/logo-original.png`. The login panel shows the logo's tagline "Connect · Consult · Care".
- **Theme:** all blue, teal removed (owner's choice):
  - text in the logo navy, buttons and links in a brand blue made from it (`#1f4f9e`; white text on it reads 7.6:1);
  - light blue tints and a blue-grey ground; the patient sidebar in the logo navy.
  - Tailwind's `teal-*` scale is re-tuned to these blues in `globals.css`, so the whole app changed in one place.
- **Charts and maps:** brand blue + teal `#0f8f7e` for the second series, checked with the dataviz validator (colour-blind safe). On maps, MediConnect hospitals are blue and "You" is teal.
- **Home page:** its palette is regenerated with the taste skill's `start.mjs brand`. Its dark sections use the deepest navy (the kit's rule), and the layout checker passes at all five sizes. Mentions of "the map" were updated now that Find hospitals is part of Book appointment.
- **Status colours unchanged:** red for allergies, emergencies and errors; amber for waiting; green for done.

### Directions to the hospital (patients)

Owner request (2026-11-18): from their appointments, patients can find their way to the hospital.
- **Each upcoming appointment** (My appointments) shows the hospital's area plus three buttons:
  - **Get directions:** opens Google Maps in a new tab with the route. The patient's phone or browser supplies their own location; MediConnect never sees it. Verified pins use their exact coordinates; unverified ones use the hospital's name and address, since the pin could be wrong.
  - **Show on map:** a small OpenStreetMap map inside the card ("Approximate location: confirm with the hospital before you travel" when the pin isn't verified).
  - **Call hospital.**
- **"Your visit today"** has a **Directions** button next to "I've arrived".
- **Also on appointment requests** to hospitals that aren't on MediConnect (e.g. MIOT; pending or confirmed) and on **visits booked directly with a hospital**. A hospital typed in by hand gets directions by its name. All three use `components/HospitalPlace.tsx`.
- **API:** bookings include `hospital`, and requests and direct bookings include `hospital_place` (`id`, `address`, `city`, `phone`, `latitude`, `longitude`, `location_verified`); one helper, `appointments.serializers.hospital_place`.

### Reference-design features, Part 3 (doctor)

- **"+N from yesterday"** on the doctor dashboard's Today's appointments ("+2 from yesterday", "−1 from yesterday", "Same as yesterday"), from real appointments; cancelled visits aren't counted. *Removed 2026-11-25 (owner request): the card shows only today's count and how many are completed.*
- **Search patient by ID** in the top bar for doctors and hospital admins: typing an ID opens the patient's records. Patients keep the hospital and doctor search.
- **Treatment notes** (owner decision 2026-11-19: the patient and any doctor read them):
  - **Contents:** one note per visit, with a diagnosis, medicines (name and strength, dose, how often, days; up to 20), advice and an optional follow-up date.
  - **Writing:** the visit's doctor writes it on the day of the visit or after, from the **Patient queue** (while the patient is in consultation) or from **Appointments** (Write note / Edit note). Only that doctor can edit it; edits are marked "edited". No notes for cancelled, future or not-yet-confirmed visits.
  - **Reading:** the patient (My medical records → **Visit notes**), and any doctor or hospital admin through the patient-ID lookup, which is logged in the patient's "Who opened your records". Notes are not in Django admin, like reports.
  - **API:** `GET/POST /api/records/notes/` (patient: own notes; doctor: notes they wrote, `?appointment=`), `PATCH /api/records/notes/<id>/`. The patient lookup `/api/records/patients/<id>/` includes `notes`, and appointments include `treatment_note` (its id).
- **Patient Details panel** for the patient in consultation (Patient queue): name, patient ID, age and gender, health details (allergies first in red), recent reports and earlier visit notes. It uses the logged patient lookup. The dashboard's Current patient card links to it.

### Reference-design features, Part 2 (login and patient)

- **Login and sign-up panel:**
  - a drawn hospital illustration (`components/HospitalThumb.tsx`). It's drawn rather than a photo, because a photo would suggest a specific real hospital. It's hidden on screens under 800 px tall, so the panel never scrolls.
  - four feature icons: Book appointments, Hospitals near you, **Access medical records**, Trusted & secure.
  - Each tab's button says what it creates: "Create a patient / doctor / hospital account".
  - The button still says "Log in" rather than the reference's "Sign In", to match the rest of the site.
- **Patient menu:** "Find doctors" is now **Book appointment** (the MediConnect hospitals and their doctors, where booking starts).
- **Patient dashboard:**
  - **Download** buttons on Recent medical reports.
  - The Nearby hospitals card shows, after the patient shares their location, the **nearest hospital**: a small drawn picture, name, distance ("about" when its map pin isn't verified), area and "Instant booking" for partners. The area comes from the address without house numbers or postcodes.
  - No star ratings: MediConnect has no reviews, and made-up ratings would mislead patients.

### Platform analytics (platform admin)

The platform admin (the MediConnect owner, a Django superuser) gets a dashboard about the whole platform:

- **Dashboard** (`/admin`): totals of **patients**, **doctors** and **connected hospitals** with growth since the start of the month; **appointments this month** vs the same days last month; a chart of **active patients vs active doctors** (with at least one appointment that month, last 6 months); recent sign-ups and newly connected hospitals; and what's waiting for approval.
- **Reports & analytics** (`/admin/reports`, period 6 / 12 / 24 months):
  - **Platform usage:** new sign-ups (patients, doctors), active users, appointments booked vs completed, medical records uploaded, queue check-ins.
  - **Hospital growth:** connected hospitals at the end of each month, new hospitals per month, total patients and doctors alongside, and a table of every connected hospital with when it joined, its doctors, patients and appointments (all-time and last 30 days).
- **Hospital accounts:** hospitals that also run their management on MediConnect (staff, salaries, patient records), i.e. they have at least one **Hospital** login (an `admin_profile`). Counted on the dashboard (with growth and how many keep staff records), charted against connected hospitals in Reports, and shown per hospital ("Hospital account: Yes/No", staff count) in the connected-hospitals table. The date is when the hospital's first manager login was linked.
- A hospital counts as **connected** once approved. `Hospital.approved_at` records when; hospitals approved before 2026-11-17 use the date they were added, marked "approx.".
- Charts are plain SVG (`components/Charts.tsx`), one y-axis each, with colours checked for colour blindness, marker shapes, end labels, tooltips and a hidden data table for screen readers.
- API (platform admin only): `GET /api/platform/overview/`, `GET /api/platform/reports/?months=12`.

## Users and profiles in the database

Every login is one row in `users`; its `role` says which profile table holds the rest (renamed from Django's default names on 2026-11-17, no data changed).

| Table | One row per | Holds |
|---|---|---|
| `users` | login (patient, doctor, hospital or platform admin) | email, hashed password, name, phone, `role`, `is_superuser` |
| `patient_profile` | patient | the general patient ID (e.g. `P319973`), date of birth, gender, health details (height, weight, blood group, allergies, conditions, medicines, emergency contact) |
| `doctor_profile` | doctor | hospital, department, specialization, qualification, experience, fee |
| `hospital_profile` | hospital account (role `hospital`) | the one hospital it manages (renamed from `admin_profile` on 2026-11-19) |
| `all_hospitals` | hospital (from the map, signed up, or added by hand) | name, address, phone, website, map pin, connected (`is_approved`), "Hospital confirms first"; signed-up and map-imported hospitals alike (renamed from `hospitals_hospital` on 2026-11-19, then to `all_hospitals` the same day; its departments link table is `all_hospitals_departments`) |
| `staff_member` | doctor or nurse on a hospital's staff | join/leave date, monthly salary, department (nurses have no login) |

- **Patients and doctors** sign up on the website.
- **The platform admin** (the owner) is a user with `is_superuser` on, created once with `docker compose exec backend python manage.py createsuperuser`. It approves hospitals and creates hospital admins.
- **Hospital accounts** (role `hospital`) sign up themselves with the hospital's email, or a platform admin adds one in Django admin (user with role Hospital, then a **Hospital profile** linking it to the hospital).

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
| `GET /api/records/patients/<patient_id>/` | doctor / admin | any patient's records by their general patient ID (logged, 30/min) |
| `GET /api/records/<id>/file/` | the patient, or any doctor / admin (logged) | download the file |
