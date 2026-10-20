// Deployed function source lives here for Git history.
// See docs/SHOPIFY_SETUP.md for credential configuration.
// Shopify Admin GraphQL: products(first:50) cursor pagination.
// Authentication: validate Supabase bearer token and require profiles.role=admin.
// Secrets: SHOPIFY_SHOP_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN.
// Writes: products.shopify_product_id, shopify_data, shopify_synced_at.
// Existing marketing fields must never be overwritten by a catalog sync.
