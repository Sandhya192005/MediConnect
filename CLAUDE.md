# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MediConnect is a hospital appointment discovery and booking platform (Chennai first, then Tamil Nadu). The owner is a final-year CS student building it to learn Celery, Redis, Docker, Elasticsearch, Playwright, notifications, maps and LLM chatbots: explain important decisions in beginner-friendly language.

Stack (all run in Docker Compose):
- Backend: Django 5.1 + DRF, JWT (simplejwt), PostgreSQL 16 + **PostGIS** (`postgis/postgis` image), Daphne/Channels (WebSockets), Celery + Celery Beat with Redis, Elasticsearch 8.15, pytest.
- Frontend: Next.js 15 (App Router, TypeScript, Tailwind v4), Leaflet/react-leaflet with OpenStreetMap tiles.
- Mailpit catches all email locally.

## Current state

All planned phases (1–8) are done (see `README.md` → Progress). Since then: MediConnect hospitals with specialists in search, reading hidden doctor pages via sitemaps (MIOT), the logo, a full brand redesign of the frontend, and deleting notifications. Last results (2026-11-02): 125 backend tests pass (1 opt-in live browser test skipped), 10 Playwright end-to-end tests pass. Still unverified: the chatbot (7) and the scraper's AI extraction with a live OpenAI key (the current key is rejected; the scraper falls back to rule-based extraction). The full plan lives in `C:\Users\Sandhya\.claude\plans\hi-i-am-planing-prancy-bird.md`.

Git branches (each stacked on the previous one, so later branches contain all earlier phases):
- `main` (GitHub): Phases 1–3 only. Merging the feature branches into `main` is still open.
- `feature_notification` (4) → `feature_search` (5) → `feature_map` (6) → `feature_chatbot` (7) → `feature_scraper` (7.5, plus the all-hospitals directory and the Wikidata website finder, which the owner chose to push here).
- Phase 8: local branch `feature_e2e`.
- After Phase 8: `feature_partner_hospitals` (MediConnect hospitals in search, MIOT doctor pages, logo) → `feature_frontend_design` (brand design parts 1–2, deleting notifications, `CLAUDE.md` updates).
- **`automate_test` on GitHub** is the most complete branch: it equals local `feature_frontend_design`. The owner chose to push Phase 8 and everything after it there. Push with `git push origin feature_frontend_design:automate_test`.
- Local-only leftover: `feature_hospital_directory` (same commit as `feature_scraper`).
- Start new work on a new `feature_*` branch from `feature_frontend_design`, and ask the owner which remote branch to push it to. `CLAUDE.md` is not committed unless the owner asks.

## Commands (PowerShell, from the repo root)

Docker Desktop must be running first (it lives at `$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe`).

```powershell
docker compose up -d --build                                   # start everything
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py makemigrations <app>
docker compose exec backend python manage.py seed               # sample hospitals/doctors + rebuilds search index
docker compose exec backend python manage.py search_index --rebuild
docker compose exec backend pytest                             # all backend tests
docker compose exec backend pytest apps/hospitals/tests.py::test_radius_and_limit   # one test
docker compose exec frontend sh -c "npx tsc --noEmit && npx next lint"
docker compose logs -f celery_worker
docker compose exec backend python manage.py e2e_setup          # reset e2e test data (DEBUG only; the e2e run calls it itself)
cd e2e; npx playwright test                                    # end-to-end tests (needs the backend up; starts the frontend if needed)
cd e2e; npx playwright test tests/booking.spec.ts              # one e2e file
cd e2e; npx playwright test --headed                           # watch the browser
cd e2e; npx playwright show-report                             # report with screenshot/video/trace of failures
```

- Owner's daily start: `docker compose up -d db redis elasticsearch mailpit mockhospital backend celery_worker celery_beat scraper_worker`, then `cd frontend; npm run dev`. The owner runs the frontend manually: don't start or stop it for them unless asked.
- If `npm run dev` lands on port 3001, the Docker `frontend` container is holding 3000 (e.g. after ▶ Start on the whole group in Docker Desktop). Stop it with `docker compose stop frontend`. The backend's CORS only allows `http://localhost:3000`, so the app breaks on 3001.

- New Python packages: add to `backend/requirements.txt` (pinned), then rebuild `backend`, `celery_worker` and `celery_beat` images.
- New npm packages: `docker compose exec frontend npm install <pkg>@<version>` (container has its own `node_modules`), then `npm install` on Windows too so VS Code sees the types. Run npm/npx from PowerShell, not Git Bash.
- In Git Bash, docker builds need `export PATH="/c/Users/Sandhya/AppData/Local/Programs/DockerDesktop/resources/bin:$PATH"` (credential helper).

URLs: app http://localhost:3000 · mock hospital site http://localhost:8090 (`http://mockhospital/` inside Docker) · API http://localhost:8000/api/ · Django admin http://localhost:8000/admin/ · Mailpit http://localhost:8025 · Elasticsearch http://localhost:9200 · Postgres from Windows `localhost:5433` (db/user/password `mediconnect`; 5432 is the owner's local PostgreSQL 17). Seed logins: doctors `<first>.<last>@mediconnect.dev` / `Doctor@123`. E2E logins (reset by `e2e_setup`): `e2e.patient@mediconnect.dev`, `e2e.doctor@mediconnect.dev` / `E2e@12345`.

## Architecture

`backend/config/` holds settings, root URLs, `asgi.py` (HTTP → Django, WebSocket → Channels with `JwtAuthMiddleware`) and `celery.py`. Apps live in `backend/apps/`:

- `accounts`: email-login custom `User` with `role` (patient/doctor/admin). `permissions.py` has `role_required`, `IsPatient`, `IsDoctor`, `IsAdminRole`, `ReadOnlyOrAdmin`.
- `hospitals`: `Hospital` (PostGIS `geography` point, `location_verified`, `source`, `is_approved`), `Department`. `nearby` and `cities` actions on `HospitalViewSet`.
- `doctors`: `DoctorProfile` (auto-created for doctor users via signal) and `WeeklyAvailability`. `services.py` generates slots from weekly hours, with a Redis cache invalidated by a per-doctor version key.
- `appointments`: `Appointment`. Booking locks the doctor row (`select_for_update`), rechecks the slot, and relies on a partial unique constraint (doctor, start, active statuses) to block double booking.
- `notifications`: email (`emails.py` + templates), in-app `Notification` model, WebSocket consumer (`/ws/notifications/`, close code 4401 = bad token), and Celery tasks (send email, push in-app, reminders every 5 min, auto-complete hourly). Views call `services.notify_appointment()`, which queues tasks on commit. API: list, `<id>/read/`, `read-all/`, `DELETE <id>/` and `clear/`, always limited to the user's own notifications.
- `chatbot`: OpenAI chat loop (`service.py`) with tools (`tools.py`) that call our own code; `propose_booking` only returns a card, the user's Confirm calls the normal booking API.
- `scraper`: `services.py` decides when to scrape (24 h freshness, one active job per hospital, per-user quota); `pipeline.py` runs a job (geocode → `safety.py` URL/robots checks → `browser.py` Playwright → `extract.py` OpenAI or rules → save `ScrapedDoctor` + hospital fields → notify). Runs on the `scraper` Celery queue in `scraper_worker` (image built with `WITH_BROWSER=1`). Test target: `mockhospital` container. `appointments/requests_api.py` holds `AppointmentRequest` for non-partner hospitals; `appointments/external_api.py` holds `ExternalAppointment` (patient-added bookings made directly with a hospital: reminders only, never a reserved slot).
- Hospital directory: `scraper/directory.py` + `overpass.py` import every hospital per ~11 km `OsmTile` (24 h freshness, conditional-update lock, failed tiles wait 10 min) as `source=osm`, `is_approved=False`. "Listed" = approved or osm/scraped; "partner" = approved + a doctor with working hours (`Hospital.is_partner`, `hospitals/services.listed_hospitals()` annotation). Never overwrite partner fields from OSM (only `source=osm` hospitals take name, pin and address updates from OSM).
- Missing websites: `scraper/wikidata.py` (free API; Wikimedia needs the contact link in `SCRAPER_USER_AGENT`).
  - The map import reads the OSM tags `wikidata`, `operator:wikidata` and `brand:wikidata` (`directory.fill_websites_from_wikidata`).
  - Opening a hospital without a website queues a job that searches Wikidata by name (`pipeline.find_missing_website`). A name match counts only within 15 km, or for a hospital group from `DIRECTORY_COUNTRY_QID` (India).
  - `Hospital.website_source` (osm / wikidata / patient; empty = added by an admin) is shown to patients.
  - `website_checked_at` limits searches to once per 30 days. Wikidata errors are never cached or recorded as "not found".
  - Before Wikidata, `pipeline.nearby_namesake` looks for a saved hospital within 500 m with the same distinctive name (words of 4+ letters) that has a website, e.g. "MIOT Hospital" → "MIOT International", 140 m away. This sets `website_source="nearby"`.
- Doctor pages the homepage doesn't link to: `scraper/sitemap.py` reads the site's sitemap (robots.txt `Sitemap:` line, else /sitemap.xml, /wp-sitemap.xml, /sitemap_index.xml).
  - It picks up to `SCRAPER_MAX_DOCTOR_PAGES` (10) doctor-looking URLs, at most half of them list pages. Every hop is SSRF-checked and the sitemap step stops after 20 s.
  - `browser.fetch_pages` skips 4xx pages without counting them, and stops opening pages after `SCRAPER_TIME_BUDGET_S` (100 s; the task is killed at 150 s).
  - Rules extraction: a page titled "Dr. X | …" is X's profile, and the specialty comes from the URL section ("…/kidney-transplant/meet-the-doctors/dr-x/"). Name variants ("P.V.A." / "P V A") are merged, a "specialty" must contain a medical word, and booking links must be whole words and not `#` anchors.
- Docker Desktop on Windows can make container clocks jump (e.g. after sleep): log and database times then look minutes apart. Trust Celery's own "succeeded in N s".
- `search`: Elasticsearch indexes (`indexes.py`: synonyms, `search_as_you_type`), documents/sync (signals → Celery tasks), queries, `/api/search/` + `/api/search/suggest/`. Returns 503 when ES is down, and the frontend falls back to `/api/doctors/?q=`.
  - "Find hospitals or doctors" (`/doctors`) lists **MediConnect hospitals**, not loose doctors: `GET /api/search/partner-hospitals/?q=&department=&city=&max_fee=` (`search/partners.py`).
  - ES finds matching doctors (typos, synonyms); PostgreSQL decides what's bookable. It falls back to plain DB matching when ES is down (`degraded: true`).
  - A hospital-name match uses only name and city: departments would make "heart" match every cardiology hospital and hide its specialists.
  - Other hospitals come from `/api/search/?type=hospitals`, and website doctors from `/api/search/listed-doctors/`. The page reads `?q=` from the URL (the home page search sends it).
  - `documents.rebuild_all` must loop over `HOSPITAL_QS.all()`: the shared queryset otherwise caches stale rows within one process.

Redis databases: 0 Celery broker, 1 results, 2 cache, 3 Channels. Tests (`backend/conftest.py`) run Celery eagerly, with in-memory email/cache/channel layer and `test_mediconnect_*` ES indexes. Use `django_capture_on_commit_callbacks(execute=True)` to trigger on-commit tasks. The autouse `fake_wikidata` fixture blocks real Wikidata calls: set `.search` / `.entities` on it to script answers.

Frontend: `frontend/lib/api.ts` (fetch wrapper with JWT refresh), `lib/auth.tsx`, `lib/notifications.tsx` (WebSocket + reconnect), `components/RoleGuard.tsx` guards role pages (`/patient`, `/doctor`, `/admin`). Leaflet components must be loaded with `next/dynamic(..., { ssr: false })`. Map pins are `CircleMarker`s (SVG `path.leaflet-interactive`), not image markers.

Frontend design system (keep new pages consistent with it):
- **Colours from the logo:** navy `#0f3b68` (`navy-*` scale) and teal `#12a594`. Tailwind's `teal-*` scale is re-tuned in `app/globals.css`, so existing `teal-*` classes follow the brand. `bg-brand-gradient` / `text-brand-gradient` give the logo's teal→blue gradient.
- **Font:** Plus Jakarta Sans via `next/font` (`--font-jakarta`).
- **Building blocks in `globals.css`:**
  - `btn` and `card` are `@utility` (so they can be `@apply`'d).
  - In `@layer components` (so utilities like `md:hidden` still win): `.btn-primary` (full width), `.btn-solid`, `.btn-outline`, `.btn-ghost`, `.btn-navy`, `.card-hover`, `.input`, `.chip`, `.chip-active`, `.page-title`, `.section-title`.
  - Never put component classes outside a layer: they would override Tailwind utilities.
- **Shared components:**
  - `components/Icons.tsx`: inline SVG icons, no icon package.
  - `PageHeader` (+ `Avatar` initials), `Navbar` (sticky, active link, phone menu), `Footer` (emergency numbers), `AuthLayout` (login/sign-up), `DashboardShell` (gradient greeting; the dashboard name stays the page's `h1`), `HomeSearch`, `SpecialistList` (doctors grouped by specialty; `?specialty=` preselects).
- **Logo files:** `public/logo.png` (full), `public/logo-mark.png` (icon), `app/icon.png` / `app/apple-icon.png` (tab icons, cropped with PowerShell System.Drawing). Use `mix-blend-multiply` on them: the logo background is off-white.
- **Selectors e2e tests rely on (keep them):**
  - day buttons inside `div.overflow-x-auto` and slots as `.grid button` on the doctor page;
  - `article[aria-label=<hospital>]` cards in the "MediConnect hospitals" region;
  - "Log out" visible on desktop;
  - `data-testid="unread-count"`;
  - delete buttons labelled "Delete notification: <title>".
- To check visuals, write a throwaway `e2e/tests/zz-shots.spec.ts` that saves screenshots to the scratchpad, run it, then delete it.

End-to-end tests (`e2e/`): Node `@playwright/test` 1.49.1, separate from the Python Playwright in the scraper.
- `global-setup.ts` runs `manage.py e2e_setup` (in `doctors/management/commands/`). It resets only:
  - the `e2e.*` users;
  - "E2E Partner Hospital": its doctor works daily 06:00–22:00, and the calendar is wiped each run;
  - "E2E Mock Website Hospital", whose website is `http://mockhospital/`.
- The ids are written to `e2e/.e2e-data.json` (gitignored); read them with `e2e()` from `tests/helpers.ts`.
- Tests run one at a time (`workers: 1`), because they share one database.
- The chatbot reply is faked with `page.route`. No test may call a real hospital website or OpenAI.
- `window.confirm` dialogs (e.g. Cancel) must be accepted with `page.once("dialog", …)`.

## Working rules from the project owner

- **Never `git push` without the owner's explicit permission for that push.** Commit locally, then ask.
- Build in phases and don't merge phases into one unreviewed step. Report each phase before starting the next.
- Explain changes before making them; ask before destructive changes. Explain new dependencies before adding them; pin stable, compatible versions.
- Use Windows PowerShell commands in instructions.
- Run migrations and tests and report actual results; state what is unverified. Verify endpoints against the running server, not by code inspection.
- Keep progress tracking (README → Progress) up to date.

## Domain invariants (must hold across the codebase)

- Patients never see other patients' appointments; doctors see only their own (enforced in `AppointmentViewSet.get_queryset`).
- Availability provenance must stay explicit and distinct: **scraped/reported** (from a hospital website) vs **admin/doctor-configured** (`WeeklyAvailability`) vs an **actual reserved appointment**. A scraped slot is informational only: never bookable, never presented as reserved. Every scraped record carries its source URL and collected-at timestamp. Scraped hospitals start `is_approved=False`.
- Booking integrity lives in PostgreSQL (transaction + row lock + partial unique constraint; recheck slot and reject past slots at booking time). Redis/Celery/Elasticsearch are never the source of truth.
- Hospital location is independent of availability. Never invent coordinates or present an unverified pin as confirmed (`location_verified`; moving a pin resets it). Nearby search validates lat/lng/radius and caps results (≤ 50). City browsing must not require the patient's location.

## Data collection (Playwright, Phase 7.5) rules

- Start with a mock hospital adapter. Before writing any real hospital adapter, check that collection is permitted (terms of service, robots.txt). If data isn't accessible, record the limitation instead of inventing data.
- Never bypass CAPTCHAs, logins or anti-bot measures; never touch patient data; never automate real bookings. Block private/internal IPs for user-supplied URLs (SSRF).
- Normalize/validate output, deduplicate, and handle timeouts and site changes.
- Celery scrape tasks: idempotent, bounded retries, timeouts, rate limits, no overlapping runs for the same hospital.
- Owner decision: a patient's hospital search **may trigger** a background scrape, but only when the saved copy is older than 24 h (or the patient presses a rate-limited "Refresh from website"). Fresh copies are served from the database. Never block the search request on the browser, and never start a duplicate job for a hospital already being scraped.
- Owner decision: for scraped-only (non-partner) hospitals, the patient gets the hospital's own booking link/phone plus an **Appointment request** in MediConnect, always shown as "Pending – not confirmed" until an admin/hospital confirms. It is a separate model from `Appointment` and never counts as a reserved slot.
- Automated tests mock websites and browsers; live checks only against approved sources.

## Open items (agree with the owner before relying on them)

- The owner's original brief listed four roles (patient, doctor, **hospital admin**, platform admin). Only three exist today; a hospital-admin role is not built.
- OpenAPI docs and a Postman collection are not built yet.
- Merging the feature branches into `main` (still Phases 1–3 on GitHub) has not been done.
- Real hospital websites checked so far:
  - **MIOT International** (miotinternational.com): checked 2026-11-02 and approved by the owner. robots.txt only blocks thank-you, payment and admin pages; the terms & conditions only cover a campaign form. The site has no doctor directory, only ~8 profiles under "Centers of Excellence / Meet the doctors", found through its sitemap. A full read takes ~110 s (slow pages).
  - Every other site, including Apollo (asked, unanswered), is unchecked. The app reads real sites when patients open hospital pages. One unapproved live read of apollohospitals.com happened during a check on 2026-11-01 (1 page, allowed by robots.txt). No further live checks on real sites without the owner's OK.
- Website coverage: only about 1 in 8 OSM hospitals lists a website. Wikidata adds some (14 in central Chennai from map tags, about 3% by name search); the rest still need a pasted website.
