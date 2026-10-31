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

## Tests

```bash
docker compose exec backend pytest
```

## Progress

- [x] Phase 1 — Docker, JWT auth, roles (patient / doctor / admin)
- [x] Phase 2 — Hospitals, departments, doctors, weekly hours, slot booking
- [x] Phase 3 — Celery + Redis + email notifications
- [x] Phase 4 — Real-time in-app notifications (Django Channels)
- [x] Phase 5 — Elasticsearch search
- [x] Phase 6 — Nearby hospitals map (PostGIS + Leaflet)
- [x] Phase 7 — OpenAI chatbot (live OpenAI call not yet verified: needs a valid API key)
- [ ] Phase 7.5 — On-demand hospital scraper (Playwright)
- [ ] Phase 8 — Playwright end-to-end tests

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
