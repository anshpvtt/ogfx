import { logger } from "../services/logger.js";
import { getSupabaseAdmin } from "../services/supabase.js";

function hasSupabase() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function normalize(row) {
  return {
    id: row.id,
    pair: row.pair,
    type: row.signal === "NO_SETUP" ? "WAIT" : row.signal,
    signal: row.signal,
    entry: row.entry,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    confidence: row.confidence,
    reason: row.confirmation_type,
    bias: row.bias,
    riskReward: row.risk_reward,
    createdAt: row.created_at,
    raw: row,
  };
}

export async function signalsRoutes(fastify) {
  fastify.get("/", async (request, reply) => {
    try {
      const { limit = 50, pair } = request.query;

      if (hasSupabase()) {
        let query = getSupabaseAdmin()
          .from("signals")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(Math.min(100, Number(limit) || 50));
        if (pair) query = query.eq("pair", String(pair).toUpperCase());
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        const signals = (data ?? []).map(normalize);
        return { signals, count: signals.length };
      }

      const where = {};
      if (pair) where.pair = pair;
      const signals = await fastify.prisma.signal.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: parseInt(limit),
      });

      return { signals, count: signals.length };
    } catch (error) {
      logger.error("Error fetching signals:", error);
      reply.status(500);
      return { error: "Failed to fetch signals" };
    }
  });

  fastify.get("/active", async () => {
    try {
      if (hasSupabase()) {
        const { data, error } = await getSupabaseAdmin()
          .from("signals")
          .select("*")
          .in("signal", ["BUY", "SELL"])
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) throw new Error(error.message);
        const signals = (data ?? []).map(normalize);
        return { signals, count: signals.length };
      }

      const signals = await fastify.prisma.signal.findMany({
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
      });

      return { signals, count: signals.length };
    } catch (error) {
      logger.error("Error fetching active signals:", error);
      return { signals: [], count: 0 };
    }
  });

  fastify.get("/stats", async () => {
    try {
      if (hasSupabase()) {
        const supabase = getSupabaseAdmin();
        const [{ count: total }, { count: actionable }] = await Promise.all([
          supabase.from("signals").select("id", { count: "exact", head: true }),
          supabase.from("signals").select("id", { count: "exact", head: true }).in("signal", ["BUY", "SELL"]),
        ]);
        return {
          total: total ?? 0,
          active: actionable ?? 0,
          closed: 0,
          profitable: 0,
          winRate: 0,
        };
      }

      const total = await fastify.prisma.signal.count();
      const active = await fastify.prisma.signal.count({ where: { status: "ACTIVE" } });
      const closed = await fastify.prisma.signal.count({ where: { status: "CLOSED" } });
      const profitable = await fastify.prisma.signal.count({ where: { status: "CLOSED", pips: { gt: 0 } } });
      const winRate = closed > 0 ? (profitable / closed) * 100 : 0;
      return { total, active, closed, profitable, winRate: parseFloat(winRate.toFixed(2)) };
    } catch (error) {
      logger.error("Error fetching signal stats:", error);
      return { total: 0, active: 0, closed: 0, profitable: 0, winRate: 0 };
    }
  });

  fastify.get("/:id", async (request, reply) => {
    try {
      const { id } = request.params;

      if (hasSupabase()) {
        const { data, error } = await getSupabaseAdmin()
          .from("signals")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) {
          reply.status(404);
          return { error: "Signal not found" };
        }
        return { signal: normalize(data) };
      }

      const signal = await fastify.prisma.signal.findUnique({ where: { id } });
      if (!signal) {
        reply.status(404);
        return { error: "Signal not found" };
      }
      return { signal };
    } catch (error) {
      logger.error("Error fetching signal:", error);
      reply.status(500);
      return { error: "Failed to fetch signal" };
    }
  });
}
