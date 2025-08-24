import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { AuthService } from "../services/authService";
import { google } from "googleapis";
import { TelegramService } from "../services/telegramService";
import supabase from "../config/supabase";

export class AuthController {

  /**
   * Logout a user
   */
  static async logout(req: Request, res: Response) {
    res.json({ message: "Logout successful" });
  }

  /**
   * Get current user
   */
  static async getCurrentUser(req: Request, res: Response) {
    res.json(req.user);
  }

  /**
   * Generate Google OAuth URL for ChatGPT users
   */
  static async googleAuth(req: Request, res: Response) {
    try {
      const { auth_url } = await AuthService.generateGoogleAuthUrl(req.user?.id);
      res.redirect(auth_url);
    } catch (error: any) {
      console.error("Error in googleAuth:", error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle Google OAuth callback for ChatGPT users
   */
  // In your AuthController.ts file

static async oauthCallback(req: Request, res: Response) {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send("Authorization code or state not provided.");
  }

  try {
    const stateData = JSON.parse(state as string);

    if (stateData.type === 'telegram_oauth') {

      await TelegramService.handleTelegramOAuthCallback(code as string, state as string);
      
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Authorization Successful</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              background-color: #f0f8f0;
              margin: 0;
              padding: 20px;
              text-align: center;
            }
            .container {
              max-width: 600px;
              margin: 50px auto;
              background: white;
              padding: 30px;
              border-radius: 10px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .success {
              color: #28a745;
              font-size: 24px;
              margin-bottom: 20px;
            }
            .info {
              color: #333;
              font-size: 16px;
              margin-bottom: 30px;
            }
            .telegram-link {
              display: inline-block;
              background-color: #0088cc;
              color: white;
              padding: 12px 24px;
              text-decoration: none;
              border-radius: 5px;
              font-weight: bold;
              transition: background-color 0.3s;
            }
            .telegram-link:hover {
              background-color: #006699;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success">✅ Authorization Successful!</div>
            <div class="info">Your Google account is now linked. You can return to Telegram.</div>
            <a href="https://t.me/proj_exp_bot" class="telegram-link">🔙 Return to Telegram Bot</a>
          </div>
        </body>
        </html>
      `);

    } else {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Authentication Successful</title></head>
        <body>
          <p>Authentication successful! You can close this window and return to ChatGPT.</p>
          <script>window.close();</script>
        </body>
        </html>
      `);
    }
  } catch (error: any) {
    console.error("Error in master OAuth callback:", error.message);
    if (error.response) {
      console.error("Response data:", error.response.data);
      console.error("Response status:", error.response.status);
    }
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authorization Failed</title>
        <style>/* ... your error CSS ... */</style>
      </head>
      <body>
        <div class="container">
            <div class="error">❌ Authorization Failed</div>
            <div>Error: ${error.message}</div>
        </div>
      </body>
      </html>
    `);
  }
}

  static async exchangeCodeForToken(req: Request, res: Response) {
    try {
      const { code, client_id, client_secret } = req.body;

      if (client_id !== process.env.GOOGLE_CLIENT_ID || client_secret !== process.env.GOOGLE_CLIENT_SECRET) {
        return res.status(401).json({ error: 'Invalid client credentials' });
      }

      // Exchange the authorization code for Google tokens
      const result = await AuthService.handleGoogleOAuthCallback(code);

      if (!result.success || !result.user) {
        return res.status(400).json({ error: 'invalid_grant' });
      }

      // Generate internal JWT token for GPT (not exposing Google tokens)
      const internalToken = jwt.sign(
        {
          userId: result.user.id,
          email: result.user.email,
          user_type: "chatgpt"
        },
        process.env.JWT_SECRET || "fallback_secret",
        { expiresIn: '1h' } // 1 hour expiration
      );

      // Return OAuth 2.0 compliant response
      res.json({
        access_token: internalToken,
        token_type: 'Bearer',
        expires_in: 3600, // 1 hour in seconds
      });

    } catch (error: any) {
      console.error("Error exchanging code for token:", error);
      res.status(400).json({ error: 'invalid_grant' });
    }
  }

  /**
   * Get current user from Supabase Auth
   */
  static async getMe(req: Request, res: Response) {
    try {
      const user = await AuthService.getCurrentUser();
      res.json(user);
    } catch (error: any) {
      console.error("Error in getMe:", error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Test Google connection for ChatGPT user
   */
  static async testGoogleConnection(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const result = await AuthService.testGoogleConnection(userId);
      res.json(result);
    } catch (error: any) {
      console.error("Error in testGoogleConnection:", error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Disconnect Google account for ChatGPT user
   */
  static async disconnectGoogle(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const result = await AuthService.disconnectGoogle(userId);
      res.json(result);
    } catch (error: any) {
      console.error("Error in disconnectGoogle:", error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Refresh Supabase session token
   */
  static async refreshToken(req: Request, res: Response) {
    try {
      const { refresh_token } = req.body;

      const result = await AuthService.refreshToken(refresh_token);
      res.json(result);
    } catch (error: any) {
      console.error("Error in refreshToken:", error);
      res.status(401).json({ error: error.message });
    }
  }

  /**
   * Refresh Google token for ChatGPT user
   */
  static async refreshGoogleToken(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const result = await AuthService.refreshGoogleToken(userId);
      res.json(result);
    } catch (error: any) {
      console.error("Error in refreshGoogleToken:", error);

      if (error.message.includes("invalid") || error.message.includes("expired")) {
        res.status(400).json({
          error: error.message,
          needsReauth: true
        });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  }

  /**
   * Get ChatGPT user with Google token (for internal use)
   */
  static async getUserWithGoogleToken(userId: string) {
    return await AuthService.getUserWithGoogleToken(userId);
  }
}