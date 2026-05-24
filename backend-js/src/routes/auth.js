import { logger } from "../services/logger.js";

// In-memory OTP store (use Redis in production)
const otpStore = new Map();

export async function authRoutes(fastify) {
  // Send OTP
  fastify.post("/send-otp", async (request, reply) => {
    try {
      const { phone } = request.body;

      if (!phone) {
        reply.status(400);
        return { error: "Phone number required" };
      }

      // Generate 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      // Store OTP with expiry (5 minutes)
      otpStore.set(phone, {
        otp,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });

      // In production, send SMS via Twilio or similar
      logger.info(`OTP for ${phone}: ${otp}`);

      return {
        success: true,
        message: "OTP sent successfully",
        // Only for development
        ...(process.env.NODE_ENV !== "production" && { otp }),
      };
    } catch (error) {
      logger.error("Error sending OTP:", error);
      reply.status(500);
      return { error: "Failed to send OTP" };
    }
  });

  // Verify OTP and login
  fastify.post("/verify-otp", async (request, reply) => {
    try {
      const { phone, otp } = request.body;

      if (!phone || !otp) {
        reply.status(400);
        return { error: "Phone and OTP required" };
      }

      const stored = otpStore.get(phone);

      if (!stored || stored.expiresAt < Date.now()) {
        reply.status(400);
        return { error: "OTP expired or invalid" };
      }

      if (stored.otp !== otp) {
        reply.status(400);
        return { error: "Invalid OTP" };
      }

      // Clear OTP
      otpStore.delete(phone);

      // Find or create user
      let user = await fastify.prisma.user.findUnique({
        where: { phone },
      });

      if (!user) {
        user = await fastify.prisma.user.create({
          data: {
            phone,
            isActive: true,
          },
        });
      }

      // Generate JWT
      const token = fastify.jwt.sign({
        userId: user.id,
        phone: user.phone,
      });

      return {
        success: true,
        token,
        user: {
          id: user.id,
          phone: user.phone,
          isActive: user.isActive,
        },
      };
    } catch (error) {
      logger.error("Error verifying OTP:", error);
      reply.status(500);
      return { error: "Failed to verify OTP" };
    }
  });

  // Verify JWT token
  fastify.get("/verify", async (request, reply) => {
    try {
      await request.jwtVerify();
      return { valid: true, user: request.user };
    } catch {
      reply.status(401);
      return { valid: false, error: "Invalid token" };
    }
  });
}
