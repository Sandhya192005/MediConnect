# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MediConnect is a hospital appointment discovery and booking platform (Chennai first, then Tamil Nadu). The owner is a final-year CS student building it to learn Celery, Redis, Docker, Elasticsearch, Playwright, notifications, maps and LLM chatbots: explain important decisions in beginner-friendly language.

Stack (all run in Docker Compose):
- Backend: Django 5.1 + DRF, JWT (simplejwt), PostgreSQL 16 + **PostGIS** (`postgis/postgis` image), Daphne/Channels (WebSockets), Celery + Celery Beat with Redis, Elasticsearch 8.15, pytest.
- Frontend: Next.js 15 (App Router, TypeScript, Tailwind v4), Leaflet/react-leaflet with OpenStreetMap tiles.
- Mailpit catches all email locally.

## Current state

Phases 1–6 are done (see `README.md` → Progress). Remaining, in order: 7 OpenAI chatbot → 7.5 on-demand Playwright hospital scraper → 8 Playwright end-to-end tests. The full plan lives in `C:\Users\Sandhya\.claude\plans\hi-i-am-planing-prancy-bird.md`.

Git branches: `main` (on GitHub, ends at Phase 3), then one branch per phase stacked on the previous one: `feature_notification` (4) → `feature_search` (5) → `feature_map` (6). Start each new phase on a new `feature_*` branch from the latest one. `CLAUDE.md` is not committed unless the owner asks.

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
```

- New Python packages: add to `backend/requirements.txt` (pinned), then rebuild `backend`, `celery_worker` and `celery_beat` images.
- New npm packages: `docker compose exec frontend npm install <pkg>@<version>` (container has its own `node_modules`), then `npm install` on Windows too so VS Code sees the types. Run npm/npx from PowerShell, not Git Bash.
- In Git Bash, docker builds need `export PATH="/c/Users/Sandhya/AppData/Local/Programs/DockerDesktop/resources/bin:$PATH"` (credential helper).

URLs: app http://localhost:3000 · API http://localhost:8000/api/ · Django admin http://localhost:8000/admin/ · Mailpit http://localhost:8025 · Elasticsearch http://localhost:9200 · Postgres from Windows `localhost:5433` (db/user/password `mediconnect`; 5432 is the owner's local PostgreSQL 17). Seed logins: doctors `<first>.<last>@mediconnect.dev` / `Doctor@123`.

## Architecture

`backend/config/` holds settings, root URLs, `asgi.py` (HTTP → Django, WebSocket → Channels with `JwtAuthMiddleware`) and `celery.py`. Apps live in `backend/apps/`:

- `accounts`: email-login custom `User` with `role` (patient/doctor/admin). `permissions.py` has `role_required`, `IsPatient`, `IsDoctor`, `IsAdminRole`, `ReadOnlyOrAdmin`.
- `hospitals`: `Hospital` (PostGIS `geography` point, `location_verified`, `source`, `is_approved`), `Department`. `nearby` and `cities` actions on `HospitalViewSet`.
- `doctors`: `DoctorProfile` (auto-created for doctor users via signal) and `WeeklyAvailability`. `services.py` generates slots from weekly hours, with a Redis cache invalidated by a per-doctor version key.
- `appointments`: `Appointment`. Booking locks the doctor row (`select_for_update`), rechecks the slot, and relies on a partial unique constraint (doctor, start, active statuses) to block double booking.
- `notifications`: email (`emails.py` + templates), in-app `Notification` model, WebSocket consumer (`/ws/notifications/`, close code 4401 = bad token), and Celery tasks (send email, push in-app, reminders every 5 min, auto-complete hourly). Views call `services.notify_appointment()`, which queues tasks on commit.
- `search`: Elasticsearch indexes (`indexes.py`: synonyms, `search_as_you_type`), documents/sync (signals → Celery tasks), queries, `/api/search/` + `/api/search/suggest/`. Returns 503 when ES is down, and the frontend falls back to `/api/doctors/?q=`.

Redis databases: 0 Celery broker, 1 results, 2 cache, 3 Channels. Tests (`backend/conftest.py`) run Celery eagerly, with in-memory email/cache/channel layer and `test_mediconnect_*` ES indexes. Use `django_capture_on_commit_callbacks(execute=True)` to trigger on-commit tasks.

Frontend: `frontend/lib/api.ts` (fetch wrapper with JWT refresh), `lib/auth.tsx`, `lib/notifications.tsx` (WebSocket + reconnect), `components/RoleGuard.tsx` guards role pages (`/patient`, `/doctor`, `/admin`). Leaflet components must be loaded with `next/dynamic(..., { ssr: false })`.

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
- Celery scrape tasks: idempotent, bounded retries, timeouts, rate limits, no overlapping runs for the same hospital, and re-scrape only past a staleness threshold. Never one browser task per patient search.
- Automated tests mock websites and browsers; live checks only against approved sources.

## Open items (agree with the owner before relying on them)

- The owner's original brief listed four roles (patient, doctor, **hospital admin**, platform admin). Only three exist today; a hospital-admin role is not built.
- OpenAPI docs and a Postman collection are not built yet.
