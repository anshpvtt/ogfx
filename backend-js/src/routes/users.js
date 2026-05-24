/**
 * User Routes - Registration and Subscription Management
 */

import { prisma } from "../services/prisma.js";
import { logger } from "../services/logger.js";

const AVAILABLE_PAIRS = [
  "XAUUSD",
  "BTCUSD",
  "GBPUSD",
  "EURUSD",
  "USDJPY",
  "USOIL",
  "NAS100",
  "SPX500",
];

export default async function (fastify) {
  // Get available pairs
  fastify.get("/pairs", async () => {
    return {
      success: true,
      pairs: AVAILABLE_PAIRS,
    };
  });

  // Register new user with subscriptions
  fastify.post("/register", async (request, reply) => {
    try {
      const { phone, telegramId, pairs } = request.body;

      // Validate input
      if (!phone || !pairs || !Array.isArray(pairs) || pairs.length === 0) {
        reply.status(400);
        return {
          success: false,
          error: "Phone number and at least one pair required",
        };
      }

      // Validate pairs
      const invalidPairs = pairs.filter((p) => !AVAILABLE_PAIRS.includes(p));
      if (invalidPairs.length > 0) {
        reply.status(400);
        return {
          success: false,
          error: `Invalid pairs: ${invalidPairs.join(", ")}`,
        };
      }

      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { phone },
      });

      if (existingUser) {
        // Update existing user
        await prisma.user.update({
          where: { phone },
          data: {
            telegramId: telegramId || existingUser.telegramId,
            isActive: true,
          },
        });

        // Update subscriptions
        await prisma.userSubscription.deleteMany({
          where: { userId: existingUser.id },
        });

        for (const pair of pairs) {
          await prisma.userSubscription.create({
            data: {
              userId: existingUser.id,
              pair,
            },
          });
        }

        logger.info(`User updated: ${phone} with pairs: ${pairs.join(", ")}`);

        return {
          success: true,
          message: "User updated successfully",
          userId: existingUser.id,
          pairs,
        };
      }

      // Create new user
      const user = await prisma.user.create({
        data: {
          phone,
          telegramId: telegramId || null,
        },
      });

      // Create subscriptions
      for (const pair of pairs) {
        await prisma.userSubscription.create({
          data: {
            userId: user.id,
            pair,
          },
        });
      }

      logger.info(`New user registered: ${phone} with pairs: ${pairs.join(", ")}`);

      return {
        success: true,
        message: "User registered successfully",
        userId: user.id,
        pairs,
      };
    } catch (error) {
      logger.error("Registration failed:", error);
      reply.status(500);
      return {
        success: false,
        error: "Registration failed",
      };
    }
  });

  // Get user by phone
  fastify.get("/user/:phone", async (request, reply) => {
    try {
      const { phone } = request.params;

      const user = await prisma.user.findUnique({
        where: { phone },
        include: {
          subscriptions: true,
          telegramSub: true,
        },
      });

      if (!user) {
        reply.status(404);
        return {
          success: false,
          error: "User not found",
        };
      }

      return {
        success: true,
        user: {
          id: user.id,
          phone: user.phone,
          telegramId: user.telegramId,
          telegramChatId: user.telegramChatId,
          isActive: user.isActive,
          pairs: user.subscriptions
            .filter((s) => s.isActive)
            .map((s) => s.pair),
          telegramConnected: !!user.telegramSub,
        },
      };
    } catch (error) {
      logger.error("Get user failed:", error);
      reply.status(500);
      return {
        success: false,
        error: "Failed to get user",
      };
    }
  });

  // Update user subscriptions
  fastify.put("/user/:phone/subscriptions", async (request, reply) => {
    try {
      const { phone } = request.params;
      const { pairs } = request.body;

      if (!pairs || !Array.isArray(pairs)) {
        reply.status(400);
        return {
          success: false,
          error: "Pairs array required",
        };
      }

      const user = await prisma.user.findUnique({
        where: { phone },
      });

      if (!user) {
        reply.status(404);
        return {
          success: false,
          error: "User not found",
        };
      }

      // Delete existing subscriptions
      await prisma.userSubscription.deleteMany({
        where: { userId: user.id },
      });

      // Create new subscriptions
      for (const pair of pairs) {
        if (AVAILABLE_PAIRS.includes(pair)) {
          await prisma.userSubscription.create({
            data: {
              userId: user.id,
              pair,
            },
          });
        }
      }

      return {
        success: true,
        message: "Subscriptions updated",
        pairs,
      };
    } catch (error) {
      logger.error("Update subscriptions failed:", error);
      reply.status(500);
      return {
        success: false,
        error: "Failed to update subscriptions",
      };
    }
  });

  // Get all users subscribed to a specific pair (for broadcasting)
  fastify.get("/subscribers/:pair", async (request, reply) => {
    try {
      const { pair } = request.params;

      const subscriptions = await prisma.userSubscription.findMany({
        where: {
          pair,
          isActive: true,
          user: {
            isActive: true,
          },
        },
        include: {
          user: {
            include: {
              telegramSub: true,
            },
          },
        },
      });

      const subscribers = subscriptions
        .filter((sub) => sub.user.telegramSub?.isActive)
        .map((sub) => ({
          userId: sub.user.id,
          chatId: sub.user.telegramSub.chatId,
          username: sub.user.telegramSub.username,
        }));

      return {
        success: true,
        pair,
        count: subscribers.length,
        subscribers,
      };
    } catch (error) {
      logger.error("Get subscribers failed:", error);
      reply.status(500);
      return {
        success: false,
        error: "Failed to get subscribers",
      };
    }
  });

  // Get subscription stats
  fastify.get("/stats/subscriptions", async () => {
    try {
      const stats = await prisma.userSubscription.groupBy({
        by: ["pair"],
        where: {
          isActive: true,
          user: {
            isActive: true,
          },
        },
        _count: {
          pair: true,
        },
      });

      const totalUsers = await prisma.user.count({
        where: { isActive: true },
      });

      return {
        success: true,
        totalUsers,
        pairStats: stats.map((s) => ({
          pair: s.pair,
          subscribers: s._count.pair,
        })),
      };
    } catch (error) {
      logger.error("Get stats failed:", error);
      return {
        success: false,
        error: "Failed to get stats",
      };
    }
  });
}
