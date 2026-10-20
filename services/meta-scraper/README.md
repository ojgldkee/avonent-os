# Avonent Meta Scraper

Self-hosted Playwright service for public Meta Ad Library pages.

## What it does

- Opens public Meta Ad Library search URLs in Chromium.
- Scrolls the rendered page.
- Extracts visible Library IDs, advertiser names, ad text, start/end dates, links and exposed media URLs.
- Calculates days running.
- Returns JSON to Avonent/Supabase.

## What it intentionally does not do

- No Facebook account login automation.
- No cookie theft/reuse.
- No CAPTCHA bypass.
- No proxy rotation or fingerprint evasion.
- No private/internal GraphQL endpoint replay.

If Meta blocks the browser, the service returns `blocked: true`.

## Environment

```
SCRAPER_API_KEY=generate-a-long-random-value
PORT=8080
```

## Local Docker run

```
docker build -t avonent-meta-scraper .
docker run --rm -p 8080:8080 \
  -e SCRAPER_API_KEY=change-me \
  avonent-meta-scraper
```

Health check:

```
GET /health
```

Search:

```
POST /v1/meta/search
Authorization: Bearer <SCRAPER_API_KEY>
Content-Type: application/json

{
  "query": "Resilia",
  "country": "US",
  "active_status": "active",
  "max_ads": 50
}
```

You can also send a full public Meta Ad Library URL as `url`.

## Production

Deploy this container on a small Linux VPS or other Docker host. Chromium needs more memory than a static site; 2 GB RAM is a practical minimum, 4 GB is more comfortable if scans overlap.

Set the scraper URL and key as Supabase Edge Function secrets:

```
META_SCRAPER_URL=https://your-scraper.example.com
META_SCRAPER_KEY=<same secret>
```

Then Avonent's `scan-competitor-ads` worker calls this service automatically.
