# Shopify setup for Avonent OS

The Products page now calls the deployed Supabase Edge Function `shopify-sync`.
It requires an Avonent Supabase session and `profiles.role = 'admin'`.
The Shopify catalog sync preserves manual strategy fields when a product is re-synced.

## Shopify 2026 setup
1. In Shopify Settings > Apps > Develop apps > Build apps in Dev Dashboard, create an app named Avonent OS.
2. Release an app version with only `read_products` and install it on the Avonent store.
3. Find the permanent `*.myshopify.com` store domain in Shopify Settings > Domains.
4. In Supabase Edge Function secrets configure `SHOPIFY_SHOP_DOMAIN` and the Shopify app credentials. New Dev Dashboard apps use the client credentials grant, with `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`; older legacy custom apps may have a direct `SHOPIFY_ADMIN_ACCESS_TOKEN`. Never commit any credential.
5. Click Products > Sync Shopify products.
6. The catalog will appear in Supabase `products`, with structured Shopify metadata in `shopify_data`.

Note: The initial deployed sync currently expects a direct `SHOPIFY_ADMIN_ACCESS_TOKEN`. The client credentials grant must be enabled in the function before a newly created Dev Dashboard app can sync.

## Meta research
The existing Playwright collector in `services/meta-scraper` requires deployment on a Docker host, `SCRAPER_API_KEY`, and Supabase secrets `META_SCRAPER_URL` and `META_SCRAPER_KEY`. It reads publicly visible information only, does not bypass blocks, and cannot guarantee video downloads. The Meta Ad Library API does not offer unrestricted US commercial ad research.
