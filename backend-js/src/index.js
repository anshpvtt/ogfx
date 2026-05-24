import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { setupRoutes } from "./routes/index.js";
import { setupWebSocket } from "./ws/index.js";
import { SignalEngine } from "./engine/signalEngine.js";
import { LiveTradingAgent } from "./services/liveTradingAgent.js";
import { logger } from "./services/logger.js";

dotenv.config();

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    ...(process.env.NODE_ENV === "production"
      ? {}
      : {
          transport: {
            target: "pino-pretty",
            options: { colorize: true },
          },
        }),
  },
});

export const prisma = new PrismaClient();
export const signalEngine = new SignalEngine();
export const liveTradingAgent = new LiveTradingAgent(signalEngine);

async function build() {
  await fastify.register(cors, {
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
  });

  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET || "change-this-secret-in-production",
  });

  await fastify.register(websocket);
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: "OGFX Trading API",
        description: "Real-time OGFX trading signals and demo execution API",
        version: "1.0.0",
      },
      servers: [{ url: process.env.API_URL || "http://localhost:3001" }],
    },
  });
  await fastify.register(swaggerUi, { routePrefix: "/docs" });

  fastify.decorate("prisma", prisma);
  fastify.decorate("signalEngine", signalEngine);
  fastify.decorate("liveTradingAgent", liveTradingAgent);

  await setupRoutes(fastify);
  await setupWebSocket(fastify);

  return fastify;
}

async function start() {
  try {
    await build();

    const port = Number(process.env.PORT || 3001);
    const host = process.env.HOST || "0.0.0.0";

    await fastify.listen({ port, host });
    logger.info(`OGFX backend running on http://${host}:${port}`);
    logger.info(`API documentation: http://${host}:${port}/docs`);

    await signalEngine.start();
    logger.info("Signal engine started");

    liveTradingAgent.start();
    logger.info("Live trading agent ready");
  } catch (err) {
    logger.error("Error starting server:", err);
    process.exit(1);
  }
}

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);
  liveTradingAgent.stop();
  await signalEngine.stop();
  await fastify.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start();
