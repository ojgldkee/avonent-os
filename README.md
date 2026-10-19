# Avonent OS

Private, self-hosted e-commerce AI automation platform. The current MVP is designed as the secure foundation for the Creative Strategist and future automation agents.

## Included now
- Mobile-friendly private web dashboard
- First-run owner setup, then login/logout
- Passwords hashed with Argon2
- Random server-side sessions stored by SHA-256 token hash
- HttpOnly SameSite session cookie, configurable Secure/HSTS for HTTPS deployment
- CSRF protection on state-changing forms
- Login lockout after repeated failures
- Invite-only team signup with expiring, one-use links
- Roles: owner, admin, editor, viewer
- Audit log table for important actions
- Multiple brands and products
- Manual creative workspace for hooks, scripts, primary text and headlines
- Creative strategist generator
- Creative production status pipeline
- Private asset uploads with extension/size checks and authenticated preview route
- Background scheduled strategist runs with duplicate prevention
- PostgreSQL in Docker, SQLite fallback for local development
- OpenAI-compatible AI adapter
- No credentials or customer data committed to Git

## Role model
- **Owner**: full access.
- **Admin**: business setup, team invites, creative work.
- **Editor**: creative creation/status, product asset uploads and strategist runs.
- **Viewer**: read-only dashboard.

Public self-signup is intentionally **disabled**. The first account is created at `/setup`; after that, owner/admin users create expiring invite links from `/team`.

## Local run
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000`. On a fresh database, `/login` redirects to `/setup` so you can create the owner account.

## Docker run
```bash
cp .env.example .env
# Edit POSTGRES_PASSWORD first.
docker compose up -d --build
```

The app binds to `127.0.0.1:8000`, and PostgreSQL is never published to the host. Put the app behind Tailscale/Coolify/reverse proxy. Once HTTPS is configured, set:

```env
COOKIE_SECURE=true
HSTS_ENABLED=true
```

## AI configuration
If AI settings are blank, Avonent OS uses a deterministic starter concept generator so the app works without API spend. For an OpenAI-compatible provider, fill `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` in `.env` on the server. Never commit `.env`.

## Competitor research safety
This MVP does **not** scrape Meta Ad Library. Automated competitor research will be added through permitted/authorized sources. Research records should keep source URLs and observation dates, and the app must never treat an active competitor ad as proof of profitability.

## Security notes
- Do not hardcode a "secret" password in source code. Real accounts are safer and auditable.
- Keep this repository private because the product roadmap and internal logic are business-sensitive, even though secrets are excluded.
- Store API keys only in server environment variables / secret storage.
- Keep database/admin ports private; use Tailscale or an HTTPS reverse proxy for access.
- Back up the PostgreSQL volume and creative storage separately with encrypted off-site backups.

## Next build milestones
1. Make GitHub repository private and deploy the authenticated MVP.
2. Add knowledge-base upload, chunking, citations and searchable RAG.
3. Add authorized competitor research adapters and evidence storage.
4. Add Meta Ads read-only analytics and creative performance linkage.
5. Add Shopify read-only revenue/margin reporting.
6. Add approval-gated automation actions.
7. Add encrypted backup/restore commands and an admin audit-log UI.
