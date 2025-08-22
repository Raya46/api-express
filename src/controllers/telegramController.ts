import { Request, Response } from "express";
import { google } from "googleapis";
import jwt from "jsonwebtoken";
import { supabase } from "../config/supabase";
import crypto from "crypto";

// Extend AuthController with Telegram functions
export class TelegramAuthController {
  
  // 1. Generate OAuth URL with Telegram state
  static async generateTelegramOAuthUrl(req: Request, res: Response) {
    try {
      const { telegram_chat_id, telegram_username, telegram_first_name, telegram_last_name } = req.body;
      
      if (!telegram_chat_id) {
        return res.status(400).json({ error: "telegram_chat_id is required" });
      }

      // Generate session token for this Telegram user
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
        telegram_username: telegram_username,
        telegram_first_name: telegram_first_name,
        telegram_last_name: telegram_last_name,
        session_token: sessionToken
      });

      const { oauth2Client, scopes } = require("../config/google");
      
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        include_granted_scopes: true,
        prompt: 'consent',
        state: state,
      });

      res.json({
        success: true,
        auth_url: authUrl,
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

      // Check if user exists
      let { data: existingUser } = await supabase
        .from("users")
        .select("*")
        .eq("email", googleUser.email)
        .single();

      let userId: string;

      if (!existingUser) {
        // Create new user with Telegram info
        const { data: authData, error: signUpError } = await supabase.auth.signUp({
          email: googleUser.email!,
          password: Math.random().toString(36),
          options: {
            data: {
              full_name: googleUser.name || "",
              avatar_url: googleUser.picture || "",
              google_id: googleUser.id,
              provider: "google",
            },
          },
        });

        if (signUpError || !authData.user) {
          throw new Error(`Failed to create user: ${signUpError?.message}`);
        }

        // Insert user with Telegram data
        const { data: newUser, error: insertError } = await supabase
          .from("users")
          .insert([
            {
              id: authData.user.id,
              email: googleUser.email,
              full_name: googleUser.name || "",
              google_id: googleUser.id,
              avatar_url: googleUser.picture || null,
              google_access_token: tokens.access_token,
              google_refresh_token: tokens.refresh_token || null,
              token_expires_at: tokens.expiry_date
                ? new Date(tokens.expiry_date).toISOString()
                : null,
              telegram_chat_id: parseInt(stateData.telegram_chat_id),
              updated_at: new Date().toISOString(),
            },
          ])
          .select()
          .single();

        if (insertError) {
          await supabase.auth.admin.deleteUser(authData.user.id);
          throw new Error(`Failed to create user profile: ${insertError.message}`);
        }

        existingUser = newUser;
        userId = authData.user.id;

      } else {
        // Update existing user with Telegram info
        const updateData: any = {
          full_name: googleUser.name || existingUser.full_name,
          google_id: googleUser.id,
          avatar_url: googleUser.picture || existingUser.avatar_url,
          google_access_token: tokens.access_token,
          telegram_chat_id: parseInt(stateData.telegram_chat_id),
          token_expires_at: tokens.expiry_date
            ? new Date(tokens.expiry_date).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        };

        if (tokens.refresh_token) {
          updateData.google_refresh_token = tokens.refresh_token;
        }

        const { error: updateError } = await supabase
          .from("users")
          .update(updateData)
          .eq("id", existingUser.id);

        if (updateError) {
          throw new Error(`Failed to update user: ${updateError.message}`);
        }

        userId = existingUser.id;
      }

      // Update session with user_id
      await supabase
        .from("telegram_sessions")
        .update({ 
          user_id: userId,
          updated_at: new Date().toISOString()
        })
        .eq("id", session.id);

      // Store tokens in tenant_tokens
      await supabase
        .from("tenant_tokens")
        .upsert({
          tenant_id: userId,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || existingUser?.google_refresh_token,
          expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'tenant_id'
        });

      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Authorization Successful</title>
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
            <div class="success">✅ Authorization Successful!</div>
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
          <title>Authorization Failed</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
            .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; margin: 0 auto; }
            .error { color: #dc3545; font-size: 20px; margin-bottom: 20px; }
          </style>
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

  // 3. Check if Telegram chat is linked
  static async checkTelegramAuth(req: Request, res: Response) {
    try {
      const { telegram_chat_id } = req.params;
      
      if (!telegram_chat_id) {
        return res.status(400).json({ error: "telegram_chat_id is required" });
      }

      const { data: user, error } = await supabase
        .from("users")
        .select("id, email, full_name, telegram_chat_id, google_access_token, token_expires_at")
        .eq("telegram_chat_id", parseInt(telegram_chat_id))
        .single();

      if (error || !user) {
        return res.json({
          authenticated: false,
          needs_auth: true,
          message: "Telegram chat not linked to any Google account"
        });
      }

      // Check if Google token is still valid
      if (!user.google_access_token) {
        return res.json({
          authenticated: false,
          needs_auth: true,
          message: "Google account not connected"
        });
      }

      // Check token expiry
      if (user.token_expires_at) {
        const expiryDate = new Date(user.token_expires_at);
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
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          telegram_chat_id: user.telegram_chat_id,
        }
      });

    } catch (error: any) {
      console.error("Error checking Telegram auth:", error);
      res.status(500).json({ error: error.message });
    }
  }

  // 4. Get user by Telegram chat ID
  static async getUserByTelegramId(telegram_chat_id: number) {
    try {
      const { data: user, error } = await supabase
        .from("users")
        .select("*")
        .eq("telegram_chat_id", telegram_chat_id)
        .single();

      if (error || !user) {
        throw new Error("User not found for this Telegram chat");
      }

      return user;
    } catch (error: any) {
      throw new Error(`Failed to get user: ${error.message}`);
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

      const { error } = await supabase
        .from("users")
        .update({
          telegram_chat_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (error) {
        throw new Error(`Failed to disconnect Telegram: ${error.message}`);
      }

      // Clean up sessions
      await supabase
        .from("telegram_sessions")
        .delete()
        .eq("user_id", userId);

      res.json({
        success: true,
        message: "Telegram account disconnected successfully"
      });

    } catch (error: any) {
      console.error("Error disconnecting Telegram:", error);
      res.status(500).json({ error: error.message });
    }
  }
}