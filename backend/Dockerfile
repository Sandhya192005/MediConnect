# Pinned to Debian 12 (bookworm): Playwright 1.49 supports it; newer Debian isn't supported yet.
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# GDAL/GEOS/PROJ are needed by GeoDjango (PostGIS distance search)
RUN apt-get update && apt-get install -y --no-install-recommends \
        binutils libproj-dev gdal-bin libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Only the scraper worker image needs a real browser (adds ~400 MB), so it's optional:
#   docker compose builds scraper_worker with WITH_BROWSER=1
ARG WITH_BROWSER=0
RUN if [ "$WITH_BROWSER" = "1" ]; then playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*; fi

COPY . .

EXPOSE 8000
