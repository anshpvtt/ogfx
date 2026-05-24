async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...init.headers,
    },
  });

  const body = await response.text();
  return {
    url,
    ok: response.ok,
    status: response.status,
    body: body.slice(0, 500),
    checkedAt: new Date().toISOString(),
  };
}

async function runKeepalive(env) {
  const healthUrl = env.RENDER_HEALTH_URL || "https://ogfx-render-agent-free.onrender.com/health";
  const results = [await requestJson(healthUrl)];

  if (env.RUN_AGENT_TICK === "true") {
    if (!env.AGENT_SECRET) {
      results.push({
        url: env.AGENT_TICK_URL,
        ok: false,
        status: 0,
        body: "AGENT_SECRET is required when RUN_AGENT_TICK=true",
        checkedAt: new Date().toISOString(),
      });
    } else {
      results.push(await requestJson(env.AGENT_TICK_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.AGENT_SECRET}`,
        },
      }));
    }
  }

  if (env.RUN_MARKET_SCAN === "true") {
    if (!env.CRON_SECRET) {
      results.push({
        url: env.CRON_SCAN_URL,
        ok: false,
        status: 0,
        body: "CRON_SECRET is required when RUN_MARKET_SCAN=true",
        checkedAt: new Date().toISOString(),
      });
    } else {
      results.push(await requestJson(env.CRON_SCAN_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-cron-secret": env.CRON_SECRET,
        },
      }));
    }
  }

  return results;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runKeepalive(env));
  },

  async fetch(request, env) {
    const results = await runKeepalive(env);
    return Response.json({ ok: results.every((result) => result.ok), results });
  },
};
