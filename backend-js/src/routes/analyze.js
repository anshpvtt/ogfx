import { logger } from "../services/logger.js";
import { runBacktest } from "../engine/backtest/backtester.js";
import { evaluateLsbrSetup } from "../engine/playbooks/lsbr.js";

export async function analyzeRoutes(fastify) {
  // Manual trigger for analysis
  fastify.post("/", async (request, reply) => {
    try {
      const { symbol } = request.body;

      if (!symbol) {
        reply.status(400);
        return { error: "Symbol required" };
      }

      // Run analysis
      const result = await fastify.signalEngine.analyzeSymbol(symbol);

      return {
        success: true,
        symbol,
        result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Error in manual analysis:", error);
      reply.status(500);
      return { error: "Analysis failed" };
    }
  });

  // Analyze all symbols
  fastify.post("/all", async (request, reply) => {
    try {
      const results = await fastify.signalEngine.analyzeAll();

      return {
        success: true,
        results,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Error in batch analysis:", error);
      reply.status(500);
      return { error: "Batch analysis failed" };
    }
  });

  // Get SMC analysis for symbol
  fastify.get("/smc/:symbol", async (request, reply) => {
    try {
      const { symbol } = request.params;
      const analysis = await fastify.signalEngine.getSMCAnalysis(symbol);

      if (!analysis) {
        reply.status(500);
        return { error: "Failed to get SMC analysis" };
      }

      return {
        success: true,
        symbol,
        analysis,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Error getting SMC analysis:", error);
      reply.status(500);
      return { error: "SMC analysis failed" };
    }
  });

  // Get ELITE analysis for symbol
  fastify.get("/elite/:symbol", async (request, reply) => {
    try {
      const { symbol } = request.params;
      const analysis = await fastify.signalEngine.getEliteAnalysis(symbol);

      if (!analysis) {
        reply.status(500);
        return { error: "Failed to get Elite analysis" };
      }

      return {
        success: true,
        symbol,
        analysis,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Error getting Elite analysis:", error);
      reply.status(500);
      return { error: "Elite analysis failed" };
    }
  });

  // Get Elite risk stats
  fastify.get("/elite/risk/stats", async () => {
    try {
      const stats = fastify.signalEngine.eliteEngine.getRiskStats();
      return {
        success: true,
        stats,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Error getting Elite risk stats:", error);
      return { error: "Failed to get risk stats" };
    }
  });

  // Get strategy status
  fastify.get("/strategy", async () => {
    return {
      strategy: fastify.signalEngine.getStrategyConfig(),
      elite: fastify.signalEngine.getEliteConfig(),
      smc: fastify.signalEngine.getSMCConfig(),
      isRunning: fastify.signalEngine.isRunning(),
    };
  });

  // PDF-inspired playbook analysis for the current symbol/timeframe
  fastify.get("/playbook/:symbol", async (request, reply) => {
    try {
      const { symbol } = request.params;
      const timeframe = request.query?.timeframe || "15m";
      const limit = Math.max(120, Math.min(1000, Number(request.query?.limit || 260)));

      const market = await fastify.signalEngine.marketData.fetchData(symbol, {
        timeframe,
        limit,
      });
      const playbook = evaluateLsbrSetup({
        symbol,
        candles: market.candles,
      });
      const engine = await fastify.signalEngine.analyzeSymbol(symbol);

      return {
        success: true,
        symbol,
        timeframe,
        provider: market.provider,
        market: {
          close: market.close,
          high: market.high,
          low: market.low,
          volume: market.volume,
          levels: market.levels,
          indicators: market.indicators,
        },
        playbook,
        engine,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Error getting playbook analysis:", error);
      reply.status(500);
      return { error: "Playbook analysis failed" };
    }
  });

  // Run a lightweight historical backtest (best-effort)
  fastify.post("/backtest", async (request, reply) => {
    try {
      const {
        symbol,
        engine = "AUTO", // ELITE | SMC | FALLBACK | AUTO
        timeframe = "15m",
        limit = 500,
        minConfidence = 70,
        slAtrMult = 2,
        tpAtrMult = 3,
      } = request.body || {};

      if (!symbol) {
        reply.status(400);
        return { error: "symbol required" };
      }

      const data = await fastify.signalEngine.marketData.fetchData(symbol, {
        timeframe,
        limit: Math.max(100, Math.min(5000, Number(limit) || 500)),
      });

      const result = await runBacktest({
        symbol,
        candles: data.candles,
        engineName: String(engine || "AUTO").toUpperCase(),
        engines: {
          eliteEngine: fastify.signalEngine.eliteEngine,
          smcEngine: fastify.signalEngine.smcEngine,
          fallbackEngine: {
            ruleEngine: fastify.signalEngine.ruleEngine,
            contextEngine: fastify.signalEngine.contextEngine,
            generateSignal: fastify.signalEngine.generateSignal.bind(fastify.signalEngine),
          },
        },
        minConfidence: Number(minConfidence) || 70,
        slAtrMult: Number(slAtrMult) || 2,
        tpAtrMult: Number(tpAtrMult) || 3,
      });

      return {
        success: true,
        symbol,
        timeframe,
        provider: data.provider,
        result,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Error running backtest:", error);
      reply.status(500);
      return { error: "Backtest failed" };
    }
  });
}
