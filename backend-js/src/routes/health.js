export async function healthRoutes(fastify) {
  fastify.get("/", async () => {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      uptime: process.uptime(),
      agent: fastify.liveTradingAgent?.status?.() ?? null,
    };
  });
}
