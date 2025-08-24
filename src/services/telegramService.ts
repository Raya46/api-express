import { google } from "googleapis";
import jwt from "jsonwebtoken";
import { supabase } from "../config/supabase";
import { UrlShortenerService } from "./urlShortenerService";

export interface TelegramUser {
  id: string;
  telegram_chat_id: number;
  full_name: string | null;
  username: string | null;
  user_id: string | null;
}

export interface TelegramSession {
  id: string;
  telegram_chat_id: number;
  user_id: string | null;
  session_token: string;
  expires_at: string;
}

export interface TelegramOAuthResult {
  success: boolean;
  message: string;
  user?: TelegramUser;
}

export class TelegramService {
  /**
   * Generate Telegram OAuth URL
   */
  static async generateTelegramOAuthUrl(telegramChatId: string): Promise<{
    success: boolean;
    auth_url: string;
    original_url: string;
    session_token: string;
    expires_at: Date;
  }> {
    try {
      const crypto = await import("crypto");
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

      // Store session in database
      const { error: sessionError } = await supabase
        .from("telegram_sessions")
        .insert({
          telegram_chat_id: parseInt(telegramChatId),
          session_token: sessionToken,
          expires_at: expiresAt.toISOString(),
        });

      if (sessionError) {
        console.error("Error creating telegram session:", sessionError);
        throw new Error("Failed to create session");
      }

      // Create state with Telegram info
      const state = JSON.stringify({
        type: 'telegram_oauth',
        telegram_chat_id: telegramChatId,
        session_token: sessionToken
      });

      // Create OAuth2 client instance
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      const scopes = [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      ];

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        include_granted_scopes: true,
        prompt: 'consent',
        state: state,
      });

      // Shorten the auth URL using TinyURL
      const shortenedAuthUrl = await UrlShortenerService.shortenAuthUrl(authUrl, telegramChatId);

      return {
        success: true,
        auth_url: shortenedAuthUrl,
        original_url: authUrl,
        session_token: sessionToken,
        expires_at: expiresAt
      };

    } catch (error: any) {
      console.error("Error generating Telegram OAuth URL:", error);
      throw error;
    }
  }

  /**
   * Handle Telegram OAuth callback
   */
  static async handleTelegramOAuthCallback(code: string, state: string): Promise<TelegramOAuthResult> {
    try {
      // Parse state
      const stateData = JSON.parse(state);

      if (stateData.type !== 'telegram_oauth') {
        throw new Error("Invalid state type");
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
        throw new Error("Invalid or expired session");
      }

      // Exchange code for tokens
      const callbackOAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      const { tokens } = await callbackOAuth2Client.getToken(code);

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
              username: null,
              user_id: null,
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

      return {
        success: true,
        message: "Telegram authorization successful",
        user: existingTelegramUser
      };

    } catch (error: any) {
      console.error("Error in Telegram OAuth callback:", error);
      throw error;
    }
  }

  /**
   * Check if Telegram chat is linked
   */
  static async checkTelegramAuth(telegramChatId: string): Promise<{
    authenticated: boolean;
    needs_auth: boolean;
    message: string;
    user?: TelegramUser;
  }> {
    try {
      // Check if Telegram user exists
      const { data: telegramUser, error: telegramError } = await supabase
        .from("telegram_users")
        .select("id, telegram_chat_id, full_name, username, user_id")
        .eq("telegram_chat_id", parseInt(telegramChatId))
        .single();

      if (telegramError || !telegramUser) {
        return {
          authenticated: false,
          needs_auth: true,
          message: "Telegram chat not linked to any Google account"
        };
      }

      // Check if Google token exists in tenant_tokens
      const { data: tenantToken, error: tokenError } = await supabase
        .from("tenant_tokens")
        .select("access_token, refresh_token, expiry_date")
        .eq("tenant_id", telegramUser.id)
        .single();

      if (tokenError || !tenantToken || !tenantToken.access_token) {
        return {
          authenticated: false,
          needs_auth: true,
          message: "Google account not connected"
        };
      }

      // Check token expiry
      if (tenantToken.expiry_date) {
        const expiryDate = new Date(tenantToken.expiry_date);
        const now = new Date();
        if (now > expiryDate) {
          return {
            authenticated: false,
            needs_auth: true,
            message: "Google token expired, re-authentication required"
          };
        }
      }

      return {
        authenticated: true,
        needs_auth: false,
        message: "Telegram chat is authenticated",
        user: telegramUser
      };

    } catch (error: any) {
      console.error("Error checking Telegram auth:", error);
      throw error;
    }
  }

  /**
   * Get Telegram user by Telegram chat ID
   */
  static async getUserByTelegramId(telegramChatId: number): Promise<TelegramUser> {
    try {
      const { data: telegramUser, error } = await supabase
        .from("telegram_users")
        .select("*")
        .eq("telegram_chat_id", telegramChatId)
        .single();

      if (error || !telegramUser) {
        throw new Error("Telegram user not found for this chat ID");
      }

      return telegramUser;
    } catch (error: any) {
      throw new Error(`Failed to get Telegram user: ${error.message}`);
    }
  }

  /**
   * Clean expired sessions
   */
  static async cleanExpiredSessions(): Promise<void> {
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

  /**
   * Disconnect Telegram from user account
   */
  static async disconnectTelegram(userId: string): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      // Find Telegram user linked to this ChatGPT user
      const { data: telegramUser, error: findError } = await supabase
        .from("telegram_users")
        .select("id")
        .eq("user_id", userId)
        .single();

      if (findError || !telegramUser) {
        throw new Error("No linked Telegram account found");
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

      return {
        success: true,
        message: "Telegram account disconnected successfully"
      };

    } catch (error: any) {
      console.error("Error disconnecting Telegram:", error);
      throw error;
    }
  }

  /**
   * Get user with token (supports both ChatGPT and Telegram users)
   */
  static async getUserWithToken(userId: string): Promise<any> {
    try {
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
          throw new Error("No Google tokens found for this Telegram user");
        }

        return {
          id: telegramUser.id,
          telegram_chat_id: telegramUser.telegram_chat_id,
          full_name: telegramUser.full_name,
          username: telegramUser.username,
          google_access_token: tenantToken.access_token,
          google_refresh_token: tenantToken.refresh_token,
          token_expires_at: tenantToken.expiry_date,
          user_type: "telegram"
        };
      }

      // If not a Telegram user, try to get as ChatGPT user
      const { data: chatgptUser, error: chatgptError } = await supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .single();

      if (chatgptError || !chatgptUser) {
        throw new Error("User not found");
      }

      return {
        id: chatgptUser.id,
        email: chatgptUser.email,
        full_name: chatgptUser.full_name,
        google_access_token: chatgptUser.google_access_token,
        token_expires_at: chatgptUser.token_expires_at,
        user_type: "chatgpt"
      };

    } catch (error: any) {
      console.error("Error getting user with token:", error);
      throw error;
    }
  }
}