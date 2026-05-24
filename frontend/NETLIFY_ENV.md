## Netlify environment variables (OGFX frontend)

Set these in Netlify → Site settings → Environment variables.

### Required
- `NEXT_PUBLIC_SUPABASE_URL`: `https://iwvgdaswmxzxgnptgghb.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: your publishable/anon key (safe for browser)
- `NEXT_PUBLIC_API_URL`: your Railway backend URL (e.g. `https://ogfx-backend.up.railway.app`)

### Notes
- Supabase email confirmations must redirect to: `/auth/confirm`
- In Supabase Dashboard → Auth → URL Configuration → add your Netlify domain + confirm route:
  - `https://<your-netlify-domain>/auth/confirm`

