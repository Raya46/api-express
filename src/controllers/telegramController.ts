import { Request, Response } from "express";
import { google } from "googleapis";
import jwt from "jsonwebtoken";
import { supabase } from "../config/supabase";
import crypto from "crypto";
import { AuthController } from "./authController";
import { oauth2Client, scopes } from "../config/google";
import { UrlShortenerService } from "../services/urlShortenerService";

export class TelegramAuthController {
  
  static async generateTelegramOAuthUrl(req: Request, res: Response) {
    try {
      const { telegram_chat_id } = req.body;
      
      if (!telegram_chat_id) {
        return res.status(400).json({ error: "telegram_chat_id is required" });
      }

      const sessionToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

      // Store session in database
      const { error: sessionError } = await supabase
        .from("telegram_sessions")
        .insert({
          telegram_chat_id: parseInt(telegram_chat_id),
          session_token: sessionToken,
          expires_at: expiresAt.toISOString(),
        });

      if (sessionError) {
        console.error("Error creating telegram session:", sessionError);
        return res.status(500).json({ error: "Failed to create session" });
      }

      // Create state with Telegram info
      const state = JSON.stringify({
        type: 'telegram_oauth',
        telegram_chat_id: telegram_chat_id,
        session_token: sessionToken
      });

      
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        include_granted_scopes: true,
        prompt: 'consent',
        state: state,
      });

      // Shorten the auth URL using TinyURL
      const shortenedAuthUrl = await UrlShortenerService.shortenAuthUrl(authUrl, telegram_chat_id);

      res.json({
        success: true,
        auth_url: shortenedAuthUrl,
        original_url: authUrl, // Keep original for debugging
        session_token: sessionToken,
        expires_at: expiresAt
      });

    } catch (error: any) {
      console.error("Error generating Telegram OAuth URL:", error);
      res.status(500).json({ error: error.message });
    }
  }

  // 2. Handle Telegram OAuth Callback
  static async handleTelegramOAuthCallback(req: Request, res: Response) {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).send("Authorization code or state not provided");
    }

    try {
      // Parse state
      const stateData = JSON.parse(state as string);

      if (stateData.type !== 'telegram_oauth') {
        return res.status(400).send("Invalid state type");
      }

      // Verify session is still valid
      const { data: session, error: sessionError } = await supabase
        .from("telegram_sessions")
        .select("*")
        .eq("telegram_chat_id", parseInt(stateData.telegram_chat_id))
        .eq("session_token", stateData.session_token)
        .gt("expires_at", new Date().toISOString())
        .single();

      if (sessionError || !session) {
        return res.status(400).send("Invalid or expired session");
      }

      // Exchange code for tokens
      const callbackOAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      const { tokens } = await callbackOAuth2Client.getToken(code as string);

      if (!tokens.access_token) {
        throw new Error("No access token received from Google");
      }

      // Get user info from Google
      callbackOAuth2Client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: "v2", auth: callbackOAuth2Client });
      const { data: googleUser } = await oauth2.userinfo.get();

      if (!googleUser.email) {
        throw new Error("No email provided by Google");
      }

      console.log("Telegram OAuth - Google user data:", googleUser);

      // Check if Telegram user already exists
      let { data: existingTelegramUser } = await supabase
        .from("telegram_users")
        .select("*")
        .eq("telegram_chat_id", parseInt(stateData.telegram_chat_id))
        .single();

      let telegramUserId: string;

      if (!existingTelegramUser) {
        // Create new Telegram user
        const { data: newTelegramUser, error: insertError } = await supabase
          .from("telegram_users")
          .insert([
            {
              telegram_chat_id: parseInt(stateData.telegram_chat_id),
              full_name: googleUser.name || "",
              username: null, // Will be updated when available
              user_id: null, // No linked ChatGPT user initially
              updated_at: new Date().toISOString(),
            },
          ])
          .select()
          .single();

        if (insertError) {
          throw new Error(`Failed to create Telegram user profile: ${insertError.message}`);
        }

        existingTelegramUser = newTelegramUser;
        telegramUserId = newTelegramUser.id;

      } else {
        // Update existing Telegram user
        const { error: updateError } = await supabase
          .from("telegram_users")
          .update({
            full_name: googleUser.name || existingTelegramUser.full_name,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingTelegramUser.id);

        if (updateError) {
          throw new Error(`Failed to update Telegram user: ${updateError.message}`);
        }

        telegramUserId = existingTelegramUser.id;
      }

      // Update session with telegram user_id
      await supabase
        .from("telegram_sessions")
        .update({
          user_id: telegramUserId,
          updated_at: new Date().toISOString()
        })
        .eq("id", session.id);

      // Store tokens in tenant_tokens using telegram user ID
      await supabase
        .from("tenant_tokens")
        .upsert({
          tenant_id: telegramUserId,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'tenant_id'
        });

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

  // 3. Check if Telegram chat is linked
  static async checkTelegramAuth(req: Request, res: Response) {
    try {
      const { telegram_chat_id } = req.params;

      if (!telegram_chat_id) {
        return res.status(400).json({ error: "telegram_chat_id is required" });
      }

      // Check if Telegram user exists
      const { data: telegramUser, error: telegramError } = await supabase
        .from("telegram_users")
        .select("id, telegram_chat_id, full_name, username, user_id")
        .eq("telegram_chat_id", parseInt(telegram_chat_id))
        .single();

      if (telegramError || !telegramUser) {
        return res.json({
          authenticated: false,
          needs_auth: true,
          message: "Telegram chat not linked to any Google account"
        });
      }

      // Check if Google token exists in tenant_tokens
      const { data: tenantToken, error: tokenError } = await supabase
        .from("tenant_tokens")
        .select("access_token, refresh_token, expiry_date")
        .eq("tenant_id", telegramUser.id)
        .single();

      if (tokenError || !tenantToken || !tenantToken.access_token) {
        return res.json({
          authenticated: false,
          needs_auth: true,
          message: "Google account not connected"
        });
      }

      // Check token expiry
      if (tenantToken.expiry_date) {
        const expiryDate = new Date(tenantToken.expiry_date);
        const now = new Date();
        if (now > expiryDate) {
          return res.json({
            authenticated: false,
            needs_auth: true,
            message: "Google token expired, re-authentication required"
          });
        }
      }

      res.json({
        authenticated: true,
        needs_auth: false,
        user: {
          id: telegramUser.id,
          telegram_chat_id: telegramUser.telegram_chat_id,
          full_name: telegramUser.full_name,
          username: telegramUser.username,
          user_type: "telegram"
        }
      });

    } catch (error: any) {
      console.error("Error checking Telegram auth:", error);
      res.status(500).json({ error: error.message });
    }
  }

  // 4. Get Telegram user by Telegram chat ID
  static async getUserByTelegramId(telegram_chat_id: number) {
    try {
      const { data: telegramUser, error } = await supabase
        .from("telegram_users")
        .select("*")
        .eq("telegram_chat_id", telegram_chat_id)
        .single();

      if (error || !telegramUser) {
        throw new Error("Telegram user not found for this chat ID");
      }

      return telegramUser;
    } catch (error: any) {
      throw new Error(`Failed to get Telegram user: ${error.message}`);
    }
  }

  // 5. Clean expired sessions (untuk maintenance)
  static async cleanExpiredSessions() {
    try {
      const { error } = await supabase
        .from("telegram_sessions")
        .delete()
        .lt("expires_at", new Date().toISOString());

      if (error) {
        console.error("Error cleaning expired sessions:", error);
      } else {
        console.log("Expired sessions cleaned successfully");
      }
    } catch (error) {
      console.error("Error in cleanExpiredSessions:", error);
    }
  }

  // 6. Disconnect Telegram from user account
  static async disconnectTelegram(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      // Find Telegram user linked to this ChatGPT user
      const { data: telegramUser, error: findError } = await supabase
        .from("telegram_users")
        .select("id")
        .eq("user_id", userId)
        .single();

      if (findError || !telegramUser) {
        return res.status(404).json({ error: "No linked Telegram account found" });
      }

      // Remove the link between Telegram user and ChatGPT user
      const { error } = await supabase
        .from("telegram_users")
        .update({
          user_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", telegramUser.id);

      if (error) {
        throw new Error(`Failed to disconnect Telegram: ${error.message}`);
      }

      // Clean up sessions
      await supabase
        .from("telegram_sessions")
        .delete()
        .eq("user_id", telegramUser.id);

      // Clean up tenant tokens
      await supabase
        .from("tenant_tokens")
        .delete()
        .eq("tenant_id", telegramUser.id);

      res.json({
        success: true,
        message: "Telegram account disconnected successfully"
      });

    } catch (error: any) {
      console.error("Error disconnecting Telegram:", error);
      res.status(500).json({ error: error.message });
    }
  }
 // GET /api/auth/user/:userId/with-token
 static async getUserWithToken(req: Request, res: Response) {
   try {
     const { userId } = req.params;

     // Check if this is a Telegram user ID
     const { data: telegramUser, error: telegramError } = await supabase
       .from("telegram_users")
       .select("id, telegram_chat_id, full_name, username, user_id")
       .eq("id", userId)
       .single();

     if (!telegramError && telegramUser) {
       // This is a Telegram user, get their tokens from tenant_tokens
       const { data: tenantToken, error: tokenError } = await supabase
         .from("tenant_tokens")
         .select("access_token, refresh_token, expiry_date")
         .eq("tenant_id", userId)
         .single();

       if (tokenError || !tenantToken) {
         return res.status(404).json({ error: "No Google tokens found for this Telegram user" });
       }

       return res.json({
         success: true,
         user: {
           id: telegramUser.id,
           telegram_chat_id: telegramUser.telegram_chat_id,
           full_name: telegramUser.full_name,
           username: telegramUser.username,
           google_access_token: tenantToken.access_token,
           google_refresh_token: tenantToken.refresh_token,
           token_expires_at: tenantToken.expiry_date,
           user_type: "telegram"
         }
       });
     }

     // If not a Telegram user, try to get as ChatGPT user
     try {
       const user = await AuthController.getUserWithGoogleToken(userId);

       return res.json({
         success: true,
         user: {
           id: user.id,
           email: user.email,
           full_name: user.full_name,
           google_access_token: user.google_access_token,
           token_expires_at: user.token_expires_at,
           user_type: "chatgpt"
         }
       });
     } catch (chatgptError) {
       return res.status(404).json({ error: "User not found" });
     }

   } catch (error: any) {
     console.error("Error getting user with token:", error);
     res.status(500).json({ error: error.message });
   }
 }
}

