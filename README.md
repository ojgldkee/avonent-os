# Avonent Creative

Avonent Creative is a focused private creative workspace for e-commerce advertising.

## Live MVP

The current MVP runs as a static frontend on GitHub Pages with Supabase providing the real backend.

### Core product
- Public dashboard shell with private data hidden until login
- Email/password login and signup through Supabase Auth
- Private per-user PostgreSQL data protected with Row Level Security
- Creative Chat with persistent conversation history
- Creative Library for ideas, hooks, scripts, briefs, primary text, headlines, concepts and notes
- Creative production statuses:
  `Idea → Research → Brief → Editing → Review → Approved → Launched → Winner / Loser / Retest`
- Pipeline board for moving saved creatives through production
- Favorites, filters, search, editing and deletion
- Private Supabase Storage bucket prepared for creative files
- Mobile-first black-and-white interface

## AI status

The chat/data layer is live. The AI generation layer is intentionally not faked: an AI provider still needs to be connected through a secure server-side function before Creative Chat generates strategy, hooks or scripts automatically.

Never place an AI provider secret key in GitHub Pages JavaScript.

## Supabase

The app uses a browser-safe Supabase publishable key. Sensitive authorization is enforced in Postgres with RLS. The Supabase service-role secret is not committed to this repository.

Primary tables:
- `profiles`
- `creative_chats`
- `chat_messages`
- `creative_items`
- `creative_assets`

Private storage bucket:
- `creative-assets`

## Security

- Private creative rows require an authenticated Supabase user.
- RLS isolates each user's records.
- Signed-out visitors can see the application shell but cannot query private creative data.
- Do not commit API secrets, service-role keys or customer information.
- AI provider keys should be stored only as server-side/Edge Function secrets.

## Direction

Keep Avonent focused on creative strategy and production. Do not add inventory, finance, product-research, Shopify operations or general business-OS modules unless the product direction changes intentionally.
