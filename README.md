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

Seeded doctor logins: `anita.rao@mediconnect.dev` (and others from `apps/doctors/management/commands/seed.py`) / `Doctor@123`.

## Tests

```bash
docker compose exec backend pytest
```

## Progress

- [x] Phase 1 — Docker, JWT auth, roles (patient / doctor / admin)
- [x] Phase 2 — Hospitals, departments, doctors, weekly hours, slot booking
- [ ] Phase 3 — Celery + Redis + email notifications
- [ ] Phase 4 — Real-time in-app notifications (Django Channels)
- [ ] Phase 5 — Elasticsearch search
- [ ] Phase 6 — Nearby hospitals map (PostGIS + Leaflet)
- [ ] Phase 7 — OpenAI chatbot
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
