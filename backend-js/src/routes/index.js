import { signalsRoutes } from "./signals.js";
import { authRoutes } from "./auth.js";
import { symbolsRoutes } from "./symbols.js";
import { analyzeRoutes } from "./analyze.js";
import { healthRoutes } from "./health.js";
import { backtestRoutes } from "./backtest.js";
import { agentRoutes } from "./agent.js";
import { apiRoutes } from "./api.js";

export async function setupRoutes(fastify) {
  fastify.get("/", async () => ({
    service: "ogfx-render-agent",
    status: "online",
    health: "/health",
    docs: "/docs",
    agent: "/agent/status",
  }));

  // Health check (no auth required)
  await fastify.register(healthRoutes, { prefix: "/health" });

  // Auth routes (no auth required)
  await fastify.register(authRoutes, { prefix: "/auth" });

  // Signals routes
  await fastify.register(signalsRoutes, { prefix: "/signals" });

  // Symbols routes
  await fastify.register(symbolsRoutes, { prefix: "/symbols" });

  // Analyze routes
  await fastify.register(analyzeRoutes, { prefix: "/analyze" });

  // 24/7 Render agent routes
  await fastify.register(agentRoutes, { prefix: "/agent" });

  // Backtest routes (Supabase persistence)
  await fastify.register(backtestRoutes, { prefix: "/" });

  // Production dashboard API contract
  await fastify.register(apiRoutes, { prefix: "/" });
}
