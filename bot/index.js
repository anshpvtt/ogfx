import { Telegraf } from "telegraf";
import { logger } from "../backend-js/src/services/logger.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export class TelegramBot {
  constructor(token) {
    if (!token) {
      logger.warn("Telegram bot token not provided, bot will not start");
      this.bot = null;
      return;
    }

    this.bot = new Telegraf(token);
    this.setupCommands();
    this.setupActions();
  }

  async start() {
    if (!this.bot) {
      logger.warn("Telegram bot not initialized");
      return;
    }

    try {
      // Launch bot
      await this.bot.launch();
      logger.info("Telegram bot started");

      // Enable graceful stop
      process.once("SIGINT", () => this.bot.stop("SIGINT"));
      process.once("SIGTERM", () => this.bot.stop("SIGTERM"));
    } catch (error) {
      logger.error("Error starting Telegram bot:", error);
    }
  }

  setupCommands() {
    // Start command - handles user linking
    this.bot.command("start", async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const username = ctx.from.username || null;
      const firstName = ctx.from.first_name || null;

      // Check if user provided a link code (phone number)
      const messageText = ctx.message.text;
      const phoneMatch = messageText.match(/start\s+(\+?[\d\s-]+)/);
      const phone = phoneMatch ? phoneMatch[1].replace(/\s/g, "") : null;

      try {
        if (phone) {
          // Link telegram to existing user
          const user = await prisma.user.findUnique({
            where: { phone },
          });

          if (user) {
            // Update user with telegram info
            await prisma.user.update({
              where: { id: user.id },
              data: {
                telegramId: username,
                telegramChatId: chatId,
              },
            });

            // Create or update telegram subscription
            await prisma.telegramSubscription.upsert({
              where: { chatId },
              create: {
                userId: user.id,
                chatId,
                username,
                firstName,
                isActive: true,
              },
              update: {
                userId: user.id,
                username,
                firstName,
                isActive: true,
              },
            });

            // Get user's pairs
            const subscriptions = await prisma.userSubscription.findMany({
              where: { userId: user.id, isActive: true },
            });
            const pairs = subscriptions.map((s) => s.pair);

            await ctx.replyWithMarkdown(`
✅ *Successfully Connected!*

Your phone ${phone} is now linked to this Telegram account.

📊 *Your Subscribed Pairs:*
${pairs.length > 0 ? pairs.map((p) => `• ${p}`).join("\n") : "_No pairs subscribed yet_"}

You will now receive signals for these pairs.

*Commands:*
/my_pairs - View your pairs
/add_pair - Add pairs
/remove_pair - Remove pairs
            `);

            logger.info(`User ${phone} linked to Telegram ${chatId}`);
            return;
          } else {
            await ctx.replyWithMarkdown(`
❌ *User Not Found*

No user found with phone number: ${phone}

Please register on the website first:
🔗 https://ogfx.app/signup

Then return and click START again.
            `);
            return;
          }
        }

        // No phone provided - regular start
        const existingSub = await prisma.telegramSubscription.findUnique({
          where: { chatId },
        });

        if (existingSub?.userId) {
          // Already linked
          const user = await prisma.user.findUnique({
            where: { id: existingSub.userId },
            include: { subscriptions: true },
          });

          const pairs = user?.subscriptions
            .filter((s) => s.isActive)
            .map((s) => s.pair) || [];

          await ctx.replyWithMarkdown(`
🚀 *Welcome back to OGFX!*

You're connected as: ${user?.phone || username || "User"}

📊 *Your Pairs:*
${pairs.length > 0 ? pairs.map((p) => `• ${p}`).join("\n") : "_No active subscriptions_"}

*Commands:*
/signals - Latest signals
/my_pairs - Your subscriptions
/help - More options
          `);
        } else {
          // Not linked - show registration instructions
          await ctx.replyWithMarkdown(`
🚀 *Welcome to OGFX Trading Bot!*

Get real-time ELITE trading signals for:
• Gold (XAUUSD)
• Crypto (BTCUSD)
• Forex (EURUSD, GBPUSD, USDJPY)
• Indices (NAS100, SPX500)

*⚠️ To receive signals, you need to:*

1️⃣ Register on our website
   🔗 https://ogfx.app/signup

2️⃣ Select your trading pairs

3️⃣ Connect your Telegram

*Or provide your phone number:*
Type: \`/start +1234567890\`

*About OGFX:*
Institutional-grade SMC trading signals with 85%+ confidence
          `);
        }
      } catch (error) {
        logger.error("Start command error:", error);
        await ctx.reply("❌ Error processing request. Please try again.");
      }
    });

    // Help command
    this.bot.command("help", async (ctx) => {
      const helpMessage = `
📖 *OGFX ELITE Bot Commands*

*User Commands:*
/start - Connect your account
/start +1234567890 - Link with phone
/my_pairs - View your subscriptions
/add_pair - Add trading pairs
/remove_pair - Remove pairs
/signals - Get latest signals
/status - Account status

*About OGFX ELITE:*
Multi-layer filtered SMC trading system.
Only A+ grade signals (85%+ confidence)

🔗 https://ogfx.app
      `;

      await ctx.replyWithMarkdown(helpMessage);
    });

    // My pairs command
    this.bot.command("my_pairs", async (ctx) => {
      const chatId = ctx.chat.id.toString();

      try {
        const telegramSub = await prisma.telegramSubscription.findUnique({
          where: { chatId },
          include: {
            user: {
              include: { subscriptions: true },
            },
          },
        });

        if (!telegramSub?.user) {
          await ctx.replyWithMarkdown(`
❌ *Not Connected*

Please connect your account first:
1. Register at https://ogfx.app/signup
2. Or use: \`/start +YOUR_PHONE\`
          `);
          return;
        }

        const pairs = telegramSub.user.subscriptions
          .filter((s) => s.isActive)
          .map((s) => s.pair);

        if (pairs.length === 0) {
          await ctx.replyWithMarkdown(`
📭 *No Active Subscriptions*

Visit https://ogfx.app/dashboard to select your pairs.

*Available Pairs:*
• XAUUSD (Gold)
• BTCUSD (Bitcoin)
• GBPUSD, EURUSD, USDJPY (Forex)
• NAS100, SPX500 (Indices)
          `);
        } else {
          await ctx.replyWithMarkdown(`
📊 *Your Active Subscriptions*

${pairs.map((p) => `✅ ${p}`).join("\n")}

You'll receive signals for these pairs.

_To change pairs, visit:_
🔗 https://ogfx.app/dashboard
          `);
        }
      } catch (error) {
        logger.error("My pairs error:", error);
        await ctx.reply("❌ Error fetching your pairs.");
      }
    });

    // Status command
    this.bot.command("status", async (ctx) => {
      const chatId = ctx.chat.id.toString();

      try {
        const telegramSub = await prisma.telegramSubscription.findUnique({
          where: { chatId },
          include: {
            user: {
              include: { subscriptions: true },
            },
          },
        });

        if (!telegramSub?.user) {
          await ctx.replyWithMarkdown(`
⚠️ *Account Not Linked*

Use: \`/start +YOUR_PHONE\` to connect
Or register at https://ogfx.app/signup
          `);
          return;
        }

        const user = telegramSub.user;
        const pairs = user.subscriptions.filter((s) => s.isActive);

        await ctx.replyWithMarkdown(`
📊 *Your Account Status*

*Phone:* ${user.phone}
*Telegram:* @${telegramSub.username || "N/A"}
*Status:* ${user.isActive ? "✅ Active" : "❌ Inactive"}
*Pairs:* ${pairs.length} subscribed

*Subscribed Pairs:*
${pairs.map((p) => `• ${p.pair}`).join("\n") || "_None_"}

_Last updated: ${new Date().toLocaleDateString()}_
        `);
      } catch (error) {
        logger.error("Status error:", error);
        await ctx.reply("❌ Error fetching status.");
      }
    });

    // Signals command
    this.bot.command("signals", async (ctx) => {
      try {
        const signals = await prisma.signal.findMany({
          where: { status: "ACTIVE" },
          orderBy: { createdAt: "desc" },
          take: 5,
        });

        if (signals.length === 0) {
          await ctx.reply("📡 No active signals at the moment. Check back soon!");
          return;
        }

        for (const signal of signals) {
          const message = this.formatSignalMessage(signal);
          await ctx.replyWithMarkdown(message);
        }
      } catch (error) {
        logger.error("Error fetching signals:", error);
        await ctx.reply("❌ Error fetching signals. Please try again.");
      }
    });

    // Subscribe command
    this.bot.command("subscribe", async (ctx) => {
      try {
        const chatId = ctx.chat.id.toString();

        // Upsert subscription
        await prisma.telegramSubscription.upsert({
          where: { chatId },
          update: { isActive: true },
          create: {
            chatId,
            username: ctx.from?.username || null,
            firstName: ctx.from?.first_name || null,
            isActive: true,
          },
        });

        await ctx.reply(
          "✅ *Subscribed successfully!*\n\nYou'll now receive real-time trading signals."
        );
      } catch (error) {
        logger.error("Error subscribing:", error);
        await ctx.reply("❌ Error subscribing. Please try again.");
      }
    });

    // Unsubscribe command
    this.bot.command("unsubscribe", async (ctx) => {
      try {
        const chatId = ctx.chat.id.toString();

        await prisma.telegramSubscription.updateMany({
          where: { chatId },
          data: { isActive: false },
        });

        await ctx.reply(
          "🔕 *Unsubscribed*\n\nYou won't receive signal alerts anymore. Use /subscribe to reactivate."
        );
      } catch (error) {
        logger.error("Error unsubscribing:", error);
        await ctx.reply("❌ Error unsubscribing. Please try again.");
      }
    });

    // Status command
    this.bot.command("status", async (ctx) => {
      try {
        const chatId = ctx.chat.id.toString();
        const subscription = await prisma.telegramSubscription.findUnique({
          where: { chatId },
        });

        if (subscription?.isActive) {
          await ctx.reply("✅ You are *subscribed* to OGFX signals.");
        } else {
          await ctx.reply("🔕 You are *not subscribed*. Use /subscribe to start receiving signals.");
        }
      } catch (error) {
        logger.error("Error checking status:", error);
        await ctx.reply("❌ Error checking status.");
      }
    });
  }

  setupActions() {
    // Handle callbacks if needed
    this.bot.on("callback_query", async (ctx) => {
      // Handle button clicks
      await ctx.answerCbQuery();
    });
  }

  formatSignalMessage(signal) {
    const isElite = signal.eliteData !== undefined;
    const isSMC = signal.smcData !== undefined;
    const emoji = signal.type === "BUY" ? "🟢" : "🔴";
    const direction = signal.type === "BUY" ? "📈 BUY" : "📉 SELL";
    
    // Quality indicator based on confidence
    let qualityEmoji = "⚡";
    if (signal.confidence >= 95) qualityEmoji = "🏆";
    else if (signal.confidence >= 90) qualityEmoji = "💎";
    else if (signal.confidence >= 85) qualityEmoji = "✨";
    else if (signal.confidence >= 75) qualityEmoji = "⭐";
    else if (signal.confidence < 65) qualityEmoji = "⚠️";

    // Grade badge for Elite
    const gradeBadge = signal.grade ? `[${signal.grade}] ` : "";

    // Base message
    let message = `
${qualityEmoji} ${emoji} *OGFX ${isElite ? "ELITE " : isSMC ? "SMC " : ""}SIGNAL ${gradeBadge}*

*Pair:* ${signal.pair}
*Type:* ${direction}
*Entry:* \${signal.entry}
*SL:* \${signal.stopLoss}
*TP1:* \${signal.takeProfit}
${signal.takeProfit2 ? `*TP2:* \${signal.takeProfit2}\n` : ""}${signal.takeProfit3 ? `*TP3:* \${signal.takeProfit3}\n` : ""}
*Confidence:* ${signal.confidence}%
*Risk:Reward:* ${signal.riskReward ? signal.riskReward.toFixed(1) : "2.0"}:1
${signal.eliteData?.entryModel ? `*Model:* ${signal.eliteData.entryModel}\n` : ""}
*Reason:*
${signal.reason}
`;

    // Add ELITE-specific details (highest priority)
    if (isElite && signal.eliteData) {
      const { eliteData } = signal;
      
      message += `
📊 *ELITE ANALYSIS:*
`;
      
      // HTF Bias
      if (eliteData.bias) {
        const htfEmoji = eliteData.bias.direction === "bullish" ? "🐂" : 
                        eliteData.bias.direction === "bearish" ? "🐻" : "➡️";
        message += `• HTF: ${htfEmoji} ${eliteData.bias.direction.toUpperCase()} (${eliteData.bias.score}%)\n`;
        message += `• Zone: ${eliteData.bias.zonePosition.toUpperCase()}\n`;
      }
      
      // Liquidity
      if (eliteData.liquidity) {
        message += `• Liquidity: ${eliteData.liquidity.type}`;
        if (eliteData.liquidity.inducement) message += " (Inducement ✓)";
        message += "\n";
      }
      
      // Sweep
      if (eliteData.sweep) {
        message += `• Sweep: ✅ ${eliteData.sweep.type?.replace(/_/g, " ") || "Detected"}\n`;
      }
      
      // Displacement
      if (eliteData.displacement) {
        message += `• Displacement: ${eliteData.displacement.quality}% strength\n`;
      }
      
      // Zone
      if (eliteData.zones) {
        message += `• Zone: ${eliteData.zones.type} (Q:${eliteData.zones.quality})\n`;
      }
      
      // Risk info
      if (signal.risk) {
        message += `\n🛡️ Risk: ${signal.risk.remainingTrades} trades left today\n`;
      }
    }
    // Add SMC-specific details if not Elite
    else if (isSMC && signal.smcData) {
      const { smcData } = signal;
      
      message += `
📊 *SMC Analysis:*
`;
      
      if (smcData.htfBias) {
        const htfEmoji = smcData.htfBias === "bullish" ? "🐂" : smcData.htfBias === "bearish" ? "🐻" : "➡️";
        message += `• HTF: ${htfEmoji} ${smcData.htfBias.toUpperCase()}\n`;
      }
      
      if (smcData.structure) {
        message += `• Structure: ${smcData.structure}\n`;
      }
      
      if (smcData.zone) {
        message += `• Zone: ${smcData.zone.type} (Q:${smcData.zone.quality})\n`;
      }
      
      if (smcData.sweep) {
        const sweepType = smcData.sweep.type === "sell_side_sweep" ? "Sell-side sweep" : "Buy-side sweep";
        message += `• Sweep: ✅ ${sweepType}\n`;
      }
      
      if (smcData.confirmation) {
        const confName = smcData.confirmation.type.replace(/_/g, " ");
        message += `• Confirm: ${confName}\n`;
      }
    }

    // Context info if available
    if (signal.context && signal.context.htfScore) {
      message += `\n🎯 HTF Score: ${signal.context.htfScore}%`;
    }

    // Timestamp
    message += `\n⏰ ${new Date(signal.createdAt || signal.timestamp).toLocaleString()}`;

    return message;
  }

  /**
   * Broadcast signal to subscribed users only
   * Filters by pair subscription
   */
  async broadcastSignal(signal) {
    if (!this.bot) return;

    try {
      const pair = signal.pair;

      // Get users subscribed to this specific pair
      const subscriptions = await prisma.userSubscription.findMany({
        where: {
          pair,
          isActive: true,
          user: {
            isActive: true,
            telegramSub: {
              isActive: true,
            },
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
        .filter((sub) => sub.user.telegramSub?.chatId)
        .map((sub) => ({
          chatId: sub.user.telegramSub.chatId,
          username: sub.user.telegramSub.username,
        }));

      if (subscribers.length === 0) {
        logger.info(`No subscribers for ${pair} - signal not broadcast`);
        return;
      }

      const message = this.formatSignalMessage(signal);

      // Send to subscribers of this pair only
      let sent = 0;
      let failed = 0;

      for (const sub of subscribers) {
        try {
          await this.bot.telegram.sendMessage(sub.chatId, message, {
            parse_mode: "Markdown",
          });
          sent++;
        } catch (error) {
          logger.error(`Error sending to ${sub.chatId}:`, error);
          failed++;

          // If user blocked bot, deactivate subscription
          if (error.response?.error_code === 403) {
            await prisma.telegramSubscription.update({
              where: { chatId: sub.chatId },
              data: { isActive: false },
            });
          }
        }
      }

      logger.info(
        `Signal for ${pair} broadcast to ${sent} subscribers (${failed} failed)`
      );
    } catch (error) {
      logger.error("Error broadcasting signal:", error);
    }
  }
}
