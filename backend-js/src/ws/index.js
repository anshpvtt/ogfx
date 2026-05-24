import { logger } from "../services/logger.js";

const connections = new Set();

export async function setupWebSocket(fastify) {
  // Store reference for broadcasting
  fastify.decorate("broadcast", broadcast);
  fastify.decorate("broadcastSignal", broadcastSignal);

  fastify.get("/ws", { websocket: true }, (connection, req) => {
    logger.info("WebSocket client connected");
    connections.add(connection);

    // Send initial welcome
    connection.socket.send(
      JSON.stringify({
        type: "CONNECTED",
        message: "WebSocket connected to OGFX",
        timestamp: new Date().toISOString(),
      })
    );

    // Handle messages from client
    connection.socket.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        handleClientMessage(connection, data);
      } catch (error) {
        logger.error("WebSocket message error:", error);
      }
    });

    // Handle disconnect
    connection.socket.on("close", () => {
      logger.info("WebSocket client disconnected");
      connections.delete(connection);
    });

    // Handle errors
    connection.socket.on("error", (error) => {
      logger.error("WebSocket error:", error);
      connections.delete(connection);
    });
  });

  // Set up signal callback from engine
  setupSignalCallback(fastify);
}

function handleClientMessage(connection, data) {
  switch (data.type) {
    case "SUBSCRIBE":
      // Client subscribing to specific symbols
      connection.subscriptions = data.symbols || [];
      connection.socket.send(
        JSON.stringify({
          type: "SUBSCRIBED",
          symbols: connection.subscriptions,
        })
      );
      break;

    case "PING":
      connection.socket.send(JSON.stringify({ type: "PONG" }));
      break;

    default:
      logger.warn("Unknown WebSocket message type:", data.type);
  }
}

function broadcast(message) {
  const messageStr = JSON.stringify(message);
  connections.forEach((conn) => {
    if (conn.socket.readyState === 1) {
      // OPEN
      conn.socket.send(messageStr);
    }
  });
}

function broadcastSignal(signal) {
  broadcast({
    type: "NEW_SIGNAL",
    data: signal,
    timestamp: new Date().toISOString(),
  });
}

function setupSignalCallback(fastify) {
  // Connect signal engine to WebSocket
  fastify.signalEngine.onSignalGenerated = (signal) => {
    // Save to database
    saveSignal(fastify.prisma, signal);

    // Broadcast to WebSocket clients
    broadcastSignal(signal);

    // Send to Telegram bot subscribers
    if (fastify.telegramBot) {
      fastify.telegramBot.broadcastSignal(signal);
    }
  };
}

async function saveSignal(prisma, signalData) {
  if (process.env.ENABLE_PRISMA_SIGNAL_SAVE !== "true") return;

  try {
    await prisma.signal.create({
      data: {
        pair: signalData.pair,
        type: signalData.type,
        entry: signalData.entry,
        stopLoss: signalData.stopLoss,
        takeProfit: signalData.takeProfit,
        confidence: signalData.confidence,
        reason: signalData.reason,
        status: "ACTIVE",
        context: signalData.context,
      },
    });
  } catch (error) {
    logger.error("Error saving signal:", error);
  }
}
