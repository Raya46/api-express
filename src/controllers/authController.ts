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

    // --- This is the traffic controller logic ---
    if (stateData.type === 'telegram_oauth') {
      // --- If it's a Telegram user, execute the old, proven logic ---
      
      // We will essentially run your old handleTelegramOAuthCallback logic here.
      // For simplicity, I'm putting the logic directly here. You can also move this
      // into a separate private method if you prefer.

      // 1. Verify session
      const { data: session, error: sessionError } = await supabase
        .from("telegram_sessions")
        .select("*")
        .eq("telegram_chat_id", parseInt(stateData.telegram_chat_id))
        .eq("session_token", stateData.session_token)
        .gt("expires_at", new Date().toISOString())
        .single();

      if (sessionError || !session) {
        throw new Error("Invalid or expired Telegram session.");
      }

      // 2. Exchange code for tokens
      const callbackOAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );
      const { tokens } = await callbackOAuth2Client.getToken(code as string);
      
      // 3. Get Google user info
      callbackOAuth2Client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: "v2", auth: callbackOAuth2Client });
      const { data: googleUser } = await oauth2.userinfo.get();
      if (!googleUser.email) throw new Error("Could not retrieve Google user info.");

      // 4. Find/Create User and Store Tokens (using your existing logic from TelegramService)
      // This part handles creating/updating the telegram_user and tenant_tokens
      await TelegramService.handleTelegramOAuthCallback(code as string, state as string);
      
      // 5. IMPORTANT: Send the final success page to STOP the loop.
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Authorization Successful</title>
          <style>/* ... your success CSS ... */</style>
        </head>
        <body>
          <div class="container">
            <div class="success">✅ Authorization Successful!</div>
            <div class="info">Your Google account is now linked. You can return to Telegram.</div>
          </div>
        </body>
        </html>
      `);

    } else {
      // --- If it's a GPT user, show a simple success page that closes itself ---
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
    console.error("Error in master OAuth callback:", error);
    // Send the final error page to STOP the loop
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

  /**
   * Exchange authorization code for internal JWT token (for GPT Actions)
   */
  static async exchangeCodeForToken(req: Request, res: Response) {
    try {
      const { code, client_id, client_secret } = req.body;

      // Validate GPT Action client credentials
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