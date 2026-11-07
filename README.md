# MediConnect

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
