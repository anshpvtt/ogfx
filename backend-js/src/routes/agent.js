import { GeminiAnalyzer } from "../services/geminiAnalyzer.js";
import { getSupabaseAdmin } from "../services/supabase.js";
import { logger } from "../services/logger.js";

const analyzer = new GeminiAnalyzer();

function verifyAgentSecret(request, reply) {
  const secret = process.env.AGENT_SECRET || process.env.CRON_SECRET;
  if (!secret) return true;
  const header = request.headers.authorization || request.headers["x-ogfx-agent-key"];
  const value = String(header || "").replace(/^Bearer\s+/i, "");
  if (value === secret) return true;
  reply.status(401);
  return false;
}

export async function agentRoutes(fastify) {
  fastify.get("/status", async () => ({
    success: true,
    service: "ogfx-render-agent",
    agent: fastify.liveTradingAgent?.status?.() ?? null,
    signalEngine: {
      running: fastify.signalEngine.isRunning(),
      strategy: fastify.signalEngine.getStrategyConfig(),
    },
    timestamp: new Date().toISOString(),
  }));

  fastify.post("/tick", async (request, reply) => {
    if (!verifyAgentSecret(request, reply)) return { error: "Unauthorized" };
    try {
      const summary = await fastify.liveTradingAgent.tick();
      return { success: true, summary, timestamp: new Date().toISOString() };
    } catch (error) {
      logger.error("Agent tick failed:", error);
      reply.status(500);
      return { error: error?.message || "Agent tick failed" };
    }
  });

  fastify.post("/analyze", async (request, reply) => {
    try {
      const body = request.body || {};
      if (!body.assetId && !body.symbol) {
        reply.status(400);
        return { error: "assetId or symbol required" };
      }

      const decision = await analyzer.analyze(body);
      return { success: true, decision, timestamp: new Date().toISOString() };
    } catch (error) {
      logger.error("Agent analyze failed:", error);
      reply.status(502);
      return { error: error?.message || "Agent analyze failed" };
    }
  });

  fastify.get("/signals", async (request, reply) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(request.query?.limit || 30)));
      const pair = request.query?.pair ? String(request.query.pair).toUpperCase() : null;
      const supabase = getSupabaseAdmin();
      let query = supabase
        .from("signals")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (pair) query = query.eq("pair", pair);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return { success: true, signals: data ?? [], count: data?.length ?? 0 };
    } catch (error) {
      logger.error("Agent signals failed:", error);
      reply.status(500);
      return { error: error?.message || "Failed to load agent signals" };
    }
  });
}
