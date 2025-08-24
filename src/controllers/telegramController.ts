import { Request, Response } from "express";
import { TelegramService } from "../services/telegramService";

export class TelegramController {
  /**
   * Generate Telegram OAuth URL
   */
  static async generateTelegramOAuthUrl(req: Request, res: Response) {
    try {
      const { telegram_chat_id } = req.body;

      if (!telegram_chat_id) {
        return res.status(400).json({ error: "telegram_chat_id is required" });
      }

      const result = await TelegramService.generateTelegramOAuthUrl(telegram_chat_id);
      res.json(result);

    } catch (error: any) {
      console.error("Error generating Telegram OAuth URL:", error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle Telegram OAuth Callback
   */
  static async handleTelegramOAuthCallback(req: Request, res: Response) {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).send("Authorization code or state not provided");
    }

    try {
      const result = await TelegramService.handleTelegramOAuthCallback(code as string, state as string);

      if (result.success) {
        res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Telegram Authorization Successful</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
              .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; margin: 0 auto; }
              .success { color: #28a745; font-size: 20px; margin-bottom: 20px; }
              .info { color: #666; margin-bottom: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="success">✅ Telegram Authorization Successful!</div>
              <div class="info">Your Google account has been linked to your Telegram chat.</div>
              <div class="info">You can now return to Telegram and start using the bot.</div>
            </div>
          </body>
          </html>
        `);
      } else {
        throw new Error(result.message);
      }

    } catch (error: any) {
      console.error("Error in Telegram OAuth callback:", error);
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Telegram Authorization Failed</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
            .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; margin: 0 auto; }
            .error { color: #dc3545; font-size: 20px; margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="error">❌ Telegram Authorization Failed</div>
            <div>Error: ${error.message}</div>
          </div>
        </body>
        </html>
      `);
    }
  }

  /**
   * Check if Telegram chat is linked
   */
  static async checkTelegramAuth(req: Request, res: Response) {
    try {
      const { telegram_chat_id } = req.params;

      if (!telegram_chat_id) {
        return res.status(400).json({ error: "telegram_chat_id is required" });
      }

      const result = await TelegramService.checkTelegramAuth(telegram_chat_id);

      res.json({
        ...result,
        user: result.user ? {
          ...result.user,
          user_type: "telegram"
        } : undefined
      });

    } catch (error: any) {
      console.error("Error checking Telegram auth:", error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get Telegram user by Telegram chat ID (for internal use)
   */
  static async getUserByTelegramId(telegram_chat_id: number) {
    return await TelegramService.getUserByTelegramId(telegram_chat_id);
  }

  /**
   * Clean expired sessions (for maintenance)
   */
  static async cleanExpiredSessions() {
    await TelegramService.cleanExpiredSessions();
  }

  /**
   * Disconnect Telegram from user account
   */
  static async disconnectTelegram(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const result = await TelegramService.disconnectTelegram(userId);
      res.json(result);

    } catch (error: any) {
      console.error("Error disconnecting Telegram:", error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get user with token (supports both ChatGPT and Telegram users)
   */
  static async getUserWithToken(req: Request, res: Response) {
    try {
      const { userId } = req.params;

      const user = await TelegramService.getUserWithToken(userId);

      res.json({
        success: true,
        user: {
          ...user,
          user_type: user.telegram_chat_id ? "telegram" : "chatgpt"
        }
      });

    } catch (error: any) {
      console.error("Error getting user with token:", error);
      res.status(500).json({ error: error.message });
    }
  }
}

