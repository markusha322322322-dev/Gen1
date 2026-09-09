# Server connector contract
Only trusted operators place `.mjs` files here via reviewed repository changes. An owner/admin then registers a filename in Settings. Never accept uploaded executable code.

Export `async function sync({config, token, signal})` returning an array of at most 1000 normalized records. Required: platform, external_id, title. Optional: url, description, budget, currency, payment_type (fixed/hourly), skills[], client{}, geography, responses, published_at, source_updated_at, source_status. Use null for unknowns. Honor the AbortSignal; execution budget is 25 seconds.

Modules execute trusted server code with service privileges. They must enforce source authorization, rate limits and network allowlists. For permitted scraping implement the platform-specific behavior here. Never bypass CAPTCHA, login restrictions, robots/access policies or source rate limits. The bundled HTTP helper rejects redirects/private IPv4 endpoints and pins the DNS result. Built-in RSS and JSON connectors require CONNECTOR_ALLOWED_HOSTS.

JSON API sources return this same record array. RSS/Atom maps only fields actually provided; budget and other unstructured fields are null. Real marketplace APIs require their own access agreement and mapping module; none are falsely represented as pre-integrated.
