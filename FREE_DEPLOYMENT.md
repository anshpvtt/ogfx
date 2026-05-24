# Free Deployment Mode

This repo is configured for a free-first deployment:

- GitHub public repository
- Render Free web service
- Cloudflare Worker Cron keepalive every 10 minutes
- Supabase free project, if you add the required keys

Free mode is best-effort only. Render Free services can still sleep, restart, run out of free hours, or cold start. Do not treat this as guaranteed 24/7 trading infrastructure.

## Current Free Backend

Backend URL:

```text
https://ogfx-render-agent-free.onrender.com
```

Health:

```text
https://ogfx-render-agent-free.onrender.com/health
```

## Required Render Secrets Before Trading

Set these in Render Environment:

```text
DATABASE_URL
DIRECT_URL
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY
JWT_SECRET
AGENT_SECRET
```

Optional:

```text
TWELVEDATA_API_KEY
```

After secrets are valid, set:

```text
LIVE_AGENT_ENABLED=true
```

## Free Keepalive

Deploy the worker in:

```text
cloudflare/keepalive-worker
```

It pings `/health` every 10 minutes. Keepalive reduces sleep, but does not make Render Free equivalent to a paid always-on server.
