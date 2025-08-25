import { google } from "googleapis";
import jwt from "jsonwebtoken";
import { supabase } from "../config/supabase";
import { UrlShortenerService } from "./urlShortenerService";
import { randomBytes } from 'crypto'; 

export interface GoogleUser {
  id: string;
  email: string;
  name?: string;
  picture?: string;
}

export interface GoogleUser {
  id: string;
  email: string;
  name?: string;
  picture?: string;
}

export interface AuthResult {
  success: boolean;
  message: string;
  token?: string;
  user?: any;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  google_id?: string;
  avatar_url?: string;
  google_access_token?: string;
  google_refresh_token?: string;
  token_expires_at?: string;
}

export class AuthService {

  /**
   * Generate Google OAuth URL for ChatGPT users
   */
 static async generateGoogleAuthUrl(userId?: string, type: 'chatgpt' | 'telegram' = 'chatgpt'): Promise<{
  auth_url: string;
  original_url: string;
}> {
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

  // SELALU BUAT OBJEK STATE YANG VALID
  const stateObject: any = {
    type: type === 'telegram' ? 'telegram_oauth' : 'chatgpt_oauth', // Bedakan tipe login
    nonce: randomBytes(16).toString('hex') // Tambahkan nonce untuk keamanan
  };

  // Hanya tambahkan userId jika ada
  if (userId) {
    stateObject.userId = userId;
  }

  const state = JSON.stringify(stateObject);

  const originalUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    include_granted_scopes: true,
    prompt: 'consent',
    state: state, // State sekarang dijamin tidak pernah kosong
  });

  const shortenedAuthUrl = await UrlShortenerService.shortenAuthUrl(originalUrl, userId);

  return {
    auth_url: shortenedAuthUrl,
    original_url: originalUrl
  };
}

  static async handleGoogleOAuthCallback(code: string, state?: string): Promise<AuthResult> {
    try {
      // Check if this is a Telegram OAuth request
      let isTelegramRequest = false;
      if (state) {
        try {
          const parsedState = JSON.parse(state);
          if (parsedState.type === 'telegram_oauth') {
            isTelegramRequest = true;
          }
        } catch (e) {
          // Not a JSON state, continue as ChatGPT request
        }
      }

      // If this is a Telegram request, return redirect info
      if (isTelegramRequest) {
        const redirectUrl = `${process.env.BASE_URL || "http://localhost:3000"}/api/auth/callback?code=${code}&state=${state}`;
        return {
          success: false,
          message: "Telegram OAuth request detected",
          token: redirectUrl // Use token field for redirect URL
        };
      }

      // Handle ChatGPT OAuth flow - create new OAuth2 client instance
      const callbackOAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      // Step 1: Exchange code for tokens
      const { tokens } = await callbackOAuth2Client.getToken(code);

      if (!tokens.access_token) {
        throw new Error("No access token received from Google");
      }

      console.log("ChatGPT OAuth - Received tokens:", {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiryDate: tokens.expiry_date
      });

      // Step 2: Set credentials to get user info
      callbackOAuth2Client.setCredentials(tokens);

      // Step 3: Get user info from Google
      const oauth2 = google.oauth2({ version: "v2", auth: callbackOAuth2Client });
      const { data: googleUser } = await oauth2.userinfo.get();

      if (!googleUser.email) {
        throw new Error("No email provided by Google");
      }

      console.log("ChatGPT OAuth - Google user data:", googleUser);

      // Step 4: Parse state to get current user if available
      let currentUserId = null;
      if (state) {
        try {
          const parsedState = JSON.parse(state);
          currentUserId = parsedState.userId;
        } catch (e) {
          console.log("Could not parse state, proceeding without current user");
        }
      }

      // Step 5: Check if ChatGPT user already exists
      let { data: existingUser } = await supabase
        .from("users")
        .select("*")
        .eq("email", googleUser.email)
        .single();

      let supabaseUser;

      if (!existingUser) {
        // Create new ChatGPT user
        const { data: authData, error: signUpError } =
          await supabase.auth.signUp({
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

        if (signUpError) {
          throw new Error(`Supabase auth signup error: ${signUpError.message}`);
        }

        if (!authData.user) {
          throw new Error("Failed to create user in Supabase Auth");
        }

        supabaseUser = authData.user;

        // Create ChatGPT user profile (no telegram_chat_id)
        const { data: newUserProfile, error: insertError } = await supabase
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
              updated_at: new Date().toISOString(),
            },
          ])
          .select()
          .single();

        if (insertError) {
          console.error("Insert error details:", insertError);
          await supabase.auth.admin.deleteUser(authData.user.id);
          throw new Error(
            `Failed to create ChatGPT user profile: ${insertError.message}`
          );
        }

        existingUser = newUserProfile;
      } else {
        // Update existing ChatGPT user's Google tokens
        const updateData: any = {
          full_name: googleUser.name || existingUser.full_name,
          google_id: googleUser.id,
          avatar_url: googleUser.picture || existingUser.avatar_url,
          google_access_token: tokens.access_token,
          token_expires_at: tokens.expiry_date
            ? new Date(tokens.expiry_date).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        };

        // Only update refresh token if we received a new one
        if (tokens.refresh_token) {
          updateData.google_refresh_token = tokens.refresh_token;
        }

        const { error: updateError } = await supabase
          .from("users")
          .update(updateData)
          .eq("id", existingUser.id);

        if (updateError) {
          throw new Error(
            `Failed to update ChatGPT user profile: ${updateError.message}`
          );
        }

        // Get updated user data
        const { data: updatedUser } = await supabase
          .from("users")
          .select("*")
          .eq("id", existingUser.id)
          .single();

        existingUser = updatedUser || existingUser;
        supabaseUser = existingUser;
      }

      // Step 6: Store/update Google tokens in tenant_tokens table for multi-tenancy
      const tenantId = existingUser.id; // Using user ID as tenant ID
      const { error: tenantTokenError } = await supabase
        .from("tenant_tokens")
        .upsert({
          tenant_id: tenantId,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || existingUser.google_refresh_token,
          expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'tenant_id'
        });

      if (tenantTokenError) {
        console.error("Error storing tenant tokens:", tenantTokenError);
        // Don't fail the authentication, just log the error
      }

      // Step 7: Generate JWT token for ChatGPT user
      const jwtToken = jwt.sign(
        {
          userId: existingUser.id,
          email: existingUser.email,
          full_name: existingUser.full_name,
          user_type: "chatgpt" // Identify as ChatGPT user
        },
        process.env.JWT_SECRET || "fallback_secret",
        { expiresIn: "7d" }
      );

      return {
        success: true,
        message: "ChatGPT authentication successful",
        token: jwtToken,
        user: {
          id: existingUser.id,
          email: existingUser.email,
          full_name: existingUser.full_name,
          user_type: "chatgpt"
        },
      };

    } catch (error: any) {
      console.error("Error in ChatGPT OAuth callback:", error);

      if (error.response) {
        console.error("Response data:", error.response.data);
        console.error("Response status:", error.response.status);
      }

      throw new Error(`ChatGPT authentication failed: ${error.message}`);
    }
  }

  /**
   * Test Google connection for ChatGPT user
   */
  static async testGoogleConnection(userId: string) {
    try {
      const user = await this.getUserWithGoogleToken(userId);

      if (!user.google_access_token) {
        return {
          connected: false,
          message: "No Google account connected",
          needsAuth: true,
          authUrl: `${process.env.BASE_URL || "http://localhost:3000"}/api/auth/google`,
        };
      }

      // Test with fresh token
      const testOAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      testOAuth2Client.setCredentials({
        access_token: user.google_access_token,
        refresh_token: user.google_refresh_token,
      });

      const oauth2 = google.oauth2({ version: "v2", auth: testOAuth2Client });
      const { data: userInfo } = await oauth2.userinfo.get();

      return {
        connected: true,
        message: "Google account connected successfully",
        user: {
          google_id: user.google_id,
          email: user.email,
          full_name: user.full_name,
          avatar_url: user.avatar_url,
        },
        tokenStatus: {
          hasAccessToken: !!user.google_access_token,
          hasRefreshToken: !!user.google_refresh_token,
          expiresAt: user.token_expires_at,
        }
      };
    } catch (error: any) {
      console.error("Google connection test failed:", error);

      // If token is invalid, try to refresh or require re-auth
      if (error.code === 401 || error.message.includes('invalid_token')) {
        return {
          connected: false,
          error: "Token expired or invalid",
          needsAuth: true,
          authUrl: `${process.env.BASE_URL || "http://localhost:3000"}/api/auth/google`,
        };
      }

      throw new Error(error.message);
    }
  }

  /**
   * Disconnect Google account for ChatGPT user
   */
  static async disconnectGoogle(userId: string) {
    try {
      // Revoke Google tokens before clearing from database
      const { data: user } = await supabase
        .from("users")
        .select("google_access_token, google_refresh_token")
        .eq("id", userId)
        .single();

      if (user?.google_access_token) {
        try {
          const revokeOAuth2Client = new google.auth.OAuth2();
          await revokeOAuth2Client.revokeToken(user.google_access_token);
        } catch (revokeError) {
          console.warn("Failed to revoke Google token:", revokeError);
          // Continue with local cleanup even if revoke fails
        }
      }

      // Clear Google tokens from users table
      const { error } = await supabase
        .from("users")
        .update({
          google_access_token: null,
          google_refresh_token: null,
          google_id: null,
          token_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (error) {
        throw new Error(`Failed to clear user tokens: ${error.message}`);
      }

      // Also clear tokens from tenant_tokens table
      const { error: tenantTokenError } = await supabase
        .from("tenant_tokens")
        .delete()
        .eq("tenant_id", userId);

      if (tenantTokenError) {
        throw new Error(
          `Failed to disconnect Google account: ${tenantTokenError.message}`
        );
      }

      return {
        success: true,
        message: "Google account disconnected successfully",
      };
    } catch (error: any) {
      console.error("Error disconnecting Google:", error);
      throw error;
    }
  }

  /**
   * Refresh Google token for ChatGPT user
   */
  static async refreshGoogleToken(userId: string) {
    try {
      const { data: user } = await supabase
        .from("users")
        .select("google_refresh_token, google_access_token")
        .eq("id", userId)
        .single();

      if (!user?.google_refresh_token) {
        throw new Error("No Google refresh token available");
      }

      const refreshOAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      refreshOAuth2Client.setCredentials({
        refresh_token: user.google_refresh_token,
      });

      const { credentials } = await refreshOAuth2Client.refreshAccessToken();

      if (!credentials.access_token) {
        throw new Error("Failed to get new access token");
      }

      // Update tokens in database
      const { error: updateError } = await supabase
        .from("users")
        .update({
          google_access_token: credentials.access_token,
          google_refresh_token:
            credentials.refresh_token || user.google_refresh_token,
          token_expires_at: credentials.expiry_date
            ? new Date(credentials.expiry_date).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);

      if (updateError) {
        throw new Error(`Failed to update tokens: ${updateError.message}`);
      }

      return {
        success: true,
        access_token: credentials.access_token,
        expires_in: credentials.expiry_date,
      };
    } catch (error: any) {
      console.error("Error refreshing Google token:", error);

      // Better error handling for refresh failures
      if (error.code === 400 || error.message.includes('invalid_grant')) {
        throw new Error("Refresh token is invalid or expired");
      } else {
        throw error;
      }
    }
  }

  /**
   * Get ChatGPT user with automatic token refresh
   */
  static async getUserWithGoogleToken(userId: string): Promise<UserProfile> {
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (error || !user) {
      throw new Error("ChatGPT user not found");
    }

    // Check if token exists
    if (!user.google_access_token) {
      throw new Error("No Google access token found for ChatGPT user");
    }

    // Check if token is expired
    if (user.token_expires_at) {
      const expiryDate = new Date(user.token_expires_at);
      const now = new Date();
      const bufferTime = 5 * 60 * 1000; // 5 minutes buffer

      if (now.getTime() > expiryDate.getTime() - bufferTime) {
        console.log("ChatGPT user token expired or about to expire, refreshing...");

        if (!user.google_refresh_token) {
          throw new Error("Token expired and no refresh token available - ChatGPT user needs to re-authenticate");
        }

        const refreshOAuth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );

        refreshOAuth2Client.setCredentials({
          refresh_token: user.google_refresh_token,
        });

        try {
          const { credentials } = await refreshOAuth2Client.refreshAccessToken();

          if (!credentials.access_token) {
            throw new Error("Failed to refresh token");
          }

          // Update the token in database
          const { error: updateError } = await supabase
            .from("users")
            .update({
              google_access_token: credentials.access_token,
              google_refresh_token:
                credentials.refresh_token || user.google_refresh_token,
              token_expires_at: credentials.expiry_date
                ? new Date(credentials.expiry_date).toISOString()
                : null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", userId);

          if (updateError) {
            throw new Error(`Failed to update refreshed token: ${updateError.message}`);
          }

          console.log("ChatGPT user token refreshed successfully");

          return {
            ...user,
            google_access_token: credentials.access_token,
            google_refresh_token:
              credentials.refresh_token || user.google_refresh_token,
            token_expires_at: credentials.expiry_date
              ? new Date(credentials.expiry_date).toISOString()
              : null,
          };
        } catch (refreshError: any) {
          console.error("ChatGPT user token refresh failed:", refreshError);

          if (refreshError.code === 400 || refreshError.message.includes('invalid_grant')) {
            throw new Error("Refresh token is invalid - ChatGPT user needs to re-authenticate");
          }

          throw new Error(`Failed to refresh Google token: ${refreshError.message}`);
        }
      }
    }

    return user;
  }

  /**
   * Get current user from Supabase Auth
   */
  static async getCurrentUser() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  /**
   * Refresh Supabase session token
   */
  static async refreshToken(refreshToken: string) {
    try {
      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: refreshToken,
      });
      if (error) {
        throw new Error(error.message);
      }
      return data;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }
}