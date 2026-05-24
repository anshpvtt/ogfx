# OGFX Render Keepalive Worker

Free Cloudflare Worker cron that pings the Render backend every 10 minutes.

This is a free best-effort keepalive for Render Free. It is not a hard 24/7 guarantee.

## Deploy

```powershell
cd cloudflare/keepalive-worker
npm install
npx wrangler login
npx wrangler deploy
```

This Cloudflare account now has the free account subdomain `ogfx-ansh74619.workers.dev` registered. Cloudflare requires one account-level `workers.dev` subdomain before cron triggers can be saved.

The worker itself has `workers_dev = false`, so it does not expose a public Worker URL. If deploying from a different Cloudflare account, choose a short unique subdomain such as `ogfx-yourname`; do not enter `https://ogfx-frontend.vercel.app`, because that is the Vercel frontend URL, not a Cloudflare `workers.dev` account subdomain.

## Optional Agent Tick

The default config only calls `/health`. To trigger the agent endpoint too:

```powershell
npx wrangler secret put AGENT_SECRET
```

Then set `RUN_AGENT_TICK = "true"` in `wrangler.toml` and deploy again.

Keep `LIVE_AGENT_ENABLED=false` on Render unless all production secrets are configured.
