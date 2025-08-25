// authService.ts - Fixed version dengan logging dan error handling yang lebih baik
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

    const stateObject: any = {
      type: type === 'telegram' ? 'telegram_oauth' : 'chatgpt_oauth',
      nonce: randomBytes(16).toString('hex')
    };

    if (userId) {
      stateObject.userId = userId;
    }

    const state = JSON.stringify(stateObject);

    const originalUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      include_granted_scopes: true,
      prompt: 'consent',
      state: state,
    });

    const shortenedAuthUrl = await UrlShortenerService.shortenAuthUrl(originalUrl, userId);

    return {
      auth_url: shortenedAuthUrl,
      original_url: originalUrl
    };
  }

  static async handleGoogleOAuthCallback(code: string, state?: string): Promise<AuthResult> {
    console.log("=== Starting OAuth Callback Handler ===");
    console.log("Code received:", !!code);
    console.log("State received:", state);

    try {
      // Check if this is a Telegram OAuth request
      let isTelegramRequest = false;
      if (state) {
        try {
          const parsedState = JSON.parse(state);
          console.log("Parsed state:", parsedState);
          if (parsedState.type === 'telegram_oauth') {
            isTelegramRequest = true;
          }
        } catch (e) {
          console.log("State is not JSON, treating as ChatGPT request");
        }
      }

      // If this is a Telegram request, return redirect info
      if (isTelegramRequest) {
        console.log("Detected Telegram OAuth request, redirecting...");
        const redirectUrl = `${process.env.BASE_URL || "http://localhost:3000"}/api/auth/callback?code=${code}&state=${state}`;
        return {
          success: false,
          message: "Telegram OAuth request detected",
          token: redirectUrl
        };
      }

      console.log("Processing ChatGPT OAuth flow...");

      // Handle ChatGPT OAuth flow
      const callbackOAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      // Step 1: Exchange code for tokens
      console.log("=== Step 1: Exchanging code for tokens ===");
      const { tokens } = await callbackOAuth2Client.getToken(code);

      if (!tokens.access_token) {
        throw new Error("No access token received from Google");
      }

      console.log("✅ Tokens received:", {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiryDate: tokens.expiry_date
      });

      // Step 2: Get user info from Google
      console.log("=== Step 2: Getting user info from Google ===");
      callbackOAuth2Client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: "v2", auth: callbackOAuth2Client });
      const { data: googleUser } = await oauth2.userinfo.get();

      if (!googleUser.email) {
        throw new Error("No email provided by Google");
      }

      console.log("✅ Google user data:", {
        id: googleUser.id,
        email: googleUser.email,
        name: googleUser.name,
        picture: !!googleUser.picture
      });

      // Step 3: Check if user exists in public.users table
      console.log("=== Step 3: Checking existing user ===");
      const { data: existingUser, error: selectError } = await supabase
        .from("users")
        .select("*")
        .eq("email", googleUser.email)
        .maybeSingle(); // Menggunakan maybeSingle() sebagai ganti single()

      if (selectError) {
        console.error("❌ Error checking existing user:", selectError);
        throw new Error(`Database error when checking user: ${selectError.message}`);
      }

      console.log("User exists:", !!existingUser);

      let authUserId;
      let finalUser;

      if (!existingUser) {
        console.log("=== Step 4: Creating new user ===");
        
        // Try to create new user directly, handle "already registered" gracefully
        const randomPassword = Math.random().toString(36).substring(2, 15) + 
                             Math.random().toString(36).substring(2, 15);

        console.log("Attempting to create Supabase Auth user...");
        const { data: authData, error: signUpError } = await supabase.auth.signUp({
          email: googleUser.email!,
          password: randomPassword,
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
          console.error("❌ Supabase auth signup error:", signUpError);
          
          // If user already registered, we need to get the existing user ID
          if (signUpError.message.includes("User already registered")) {
            console.log("User already registered in auth.users, need to find existing user ID...");
            
            // Method 1: Try anonymous sign-in to reset, then get user by email through a different approach
            try {
              // Create a temporary password reset request to potentially get user info
              const { data: resetData, error: resetError } = await supabase.auth.resetPasswordForEmail(
                googleUser.email!,
                { 
                  redirectTo: `${process.env.BASE_URL}/auth/callback` // This won't be used, just to satisfy the method
                }
              );
              
              if (resetError) {
                console.log("Reset password method failed:", resetError.message);
              } else {
                console.log("Password reset initiated successfully - user exists in auth");
              }
            } catch (resetErr) {
              console.log("Reset password approach failed");
            }

            // Method 2: Try to use a known pattern for existing users
            // Since we can't easily get the auth user ID without admin privileges,
            // let's create a deterministic UUID based on the email
            // This is a fallback approach
            console.log("Using fallback approach for existing auth user...");
            
            // Try to query public.users with different approaches to find any existing record
            const { data: existingByGoogleId, error: googleIdError } = await supabase
              .from("users")
              .select("*")
              .eq("google_id", googleUser.id)
              .maybeSingle();
            
            if (!googleIdError && existingByGoogleId) {
              console.log("✅ Found existing user by Google ID:", existingByGoogleId.id);
              authUserId = existingByGoogleId.id;
              finalUser = existingByGoogleId;
              
              // Update the existing record with new tokens
              const updateData = {
                full_name: googleUser.name || existingByGoogleId.full_name,
                avatar_url: googleUser.picture || existingByGoogleId.avatar_url,
                google_access_token: tokens.access_token,
                google_refresh_token: tokens.refresh_token || existingByGoogleId.google_refresh_token,
                token_expires_at: tokens.expiry_date
                  ? new Date(tokens.expiry_date).toISOString()
                  : null,
                updated_at: new Date().toISOString(),
              };

              const { data: updatedUser, error: updateError } = await supabase
                .from("users")
                .update(updateData)
                .eq("id", authUserId)
                .select()
                .single();

              if (updateError) {
                console.error("❌ Update existing user error:", updateError);
                throw new Error(`Failed to update existing user: ${updateError.message}`);
              }

              console.log("✅ Updated existing user found by Google ID");
              finalUser = updatedUser;
              
              // Skip the normal user creation process
              console.log("Skipping normal user creation, proceeding to tenant tokens...");
            } else {
              // If we still can't find the user, this is a problematic state
              // The user exists in auth.users but we can't find them and can't create them
              console.error("❌ Critical: User exists in auth but cannot be found or created in public.users");
              throw new Error(
                `User already registered in authentication system but cannot be accessed. ` +
                `Please contact support or try signing in through a different method. ` +
                `Error: ${signUpError.message}`
              );
            }
          } else {
            // Other signup errors
            throw new Error(`Supabase auth signup error: ${signUpError.message}`);
          }
        } else {
          // Normal successful signup
          if (!authData.user) {
            console.error("❌ No user returned from Supabase Auth");
            throw new Error("Failed to create user in Supabase Auth");
          }
          authUserId = authData.user.id;
          console.log("✅ Created new Supabase Auth user with ID:", authUserId);
        }

        // Only create user profile if we haven't already found and updated an existing one
        if (!finalUser && authUserId) {
          // Prepare user profile data
          const userProfileData = {
            id: authUserId,
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
          };

          console.log("Inserting user profile data:", {
            id: authUserId,
            email: googleUser.email,
            hasAccessToken: !!tokens.access_token,
            hasRefreshToken: !!tokens.refresh_token
          });

          const { data: newUserProfile, error: insertError } = await supabase
            .from("users")
            .insert([userProfileData])
            .select()
            .single();

          if (insertError) {
            console.error("❌ Insert user profile error:", insertError);
            console.error("Insert error details:", {
              message: insertError.message,
              details: insertError.details,
              hint: insertError.hint,
              code: insertError.code
            });
            
            // Cleanup: delete the auth user if profile creation fails (only if we created a new one)
            if (authData?.user) {
              try {
                console.log("Cleaning up auth user...");
                await supabase.auth.admin.deleteUser(authUserId);
                console.log("✅ Cleaned up auth user after profile creation failure");
              } catch (cleanupError) {
                console.error("❌ Failed to cleanup auth user:", cleanupError);
              }
            }
            
            throw new Error(`Failed to create user profile: ${insertError.message}`);
          }

          console.log("✅ Successfully created user profile");
          finalUser = newUserProfile;
        } else if (!finalUser) {
          throw new Error("No user ID available for profile creation");
        }

      } else {
        console.log("=== Step 4: Updating existing user ===");
        
        authUserId = existingUser.id;
        
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

        console.log("Updating user profile with data:", {
          id: authUserId,
          hasAccessToken: !!tokens.access_token,
          hasRefreshToken: !!tokens.refresh_token,
          willUpdateRefreshToken: !!tokens.refresh_token
        });

        const { data: updatedUser, error: updateError } = await supabase
          .from("users")
          .update(updateData)
          .eq("id", authUserId)
          .select()
          .single();

        if (updateError) {
          console.error("❌ Update user profile error:", updateError);
          console.error("Update error details:", {
            message: updateError.message,
            details: updateError.details,
            hint: updateError.hint,
            code: updateError.code
          });
          throw new Error(`Failed to update user profile: ${updateError.message}`);
        }

        console.log("✅ Successfully updated user profile");
        finalUser = updatedUser;
      }

      // Step 5: Handle tenant_tokens dengan strategi yang lebih robust
      console.log("=== Step 5: Managing tenant tokens ===");
      
      const tenantTokenData = {
        tenant_id: authUserId, // Explicitly set tenant_id
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || finalUser.google_refresh_token,
        expiry_date: tokens.expiry_date 
          ? new Date(tokens.expiry_date).toISOString() 
          : null,
        updated_at: new Date().toISOString(),
      };

      console.log("Upserting tenant tokens:", {
        tenant_id: authUserId,
        hasAccessToken: !!tenantTokenData.access_token,
        hasRefreshToken: !!tenantTokenData.refresh_token
      });

      // First try to check if record exists
      const { data: existingToken, error: checkError } = await supabase
        .from("tenant_tokens")
        .select("tenant_id")
        .eq("tenant_id", authUserId)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') {
        console.error("❌ Error checking existing tenant token:", checkError);
      }

      let tenantTokenResult;
      if (existingToken) {
        // Update existing record
        console.log("Updating existing tenant token...");
        tenantTokenResult = await supabase
          .from("tenant_tokens")
          .update({
            access_token: tenantTokenData.access_token,
            refresh_token: tenantTokenData.refresh_token,
            expiry_date: tenantTokenData.expiry_date,
            updated_at: tenantTokenData.updated_at,
          })
          .eq("tenant_id", authUserId)
          .select();
      } else {
        // Insert new record
        console.log("Inserting new tenant token...");
        tenantTokenResult = await supabase
          .from("tenant_tokens")
          .insert([tenantTokenData])
          .select();
      }

      if (tenantTokenResult.error) {
        console.error("❌ Tenant token operation error:", tenantTokenResult.error);
        console.error("Tenant token error details:", {
          message: tenantTokenResult.error.message,
          details: tenantTokenResult.error.details,
          hint: tenantTokenResult.error.hint,
          code: tenantTokenResult.error.code
        });
        // Log warning but don't fail authentication
        console.warn("⚠️ Warning: Failed to store tenant tokens, continuing with authentication");
      } else {
        console.log("✅ Successfully stored tenant tokens");
      }

      // Step 6: Generate JWT token
      console.log("=== Step 6: Generating JWT token ===");
      const jwtPayload = {
        userId: finalUser.id,
        email: finalUser.email,
        full_name: finalUser.full_name,
        user_type: "chatgpt"
      };

      console.log("JWT payload:", jwtPayload);

      const jwtToken = jwt.sign(
        jwtPayload,
        process.env.JWT_SECRET || "fallback_secret",
        { expiresIn: "7d" }
      );

      console.log("✅ OAuth flow completed successfully for user:", finalUser.email);
      console.log("=== End OAuth Callback Handler ===");

      return {
        success: true,
        message: "ChatGPT authentication successful",
        token: jwtToken,
        user: {
          id: finalUser.id,
          email: finalUser.email,
          full_name: finalUser.full_name,
          user_type: "chatgpt"
        },
      };

    } catch (error: any) {
      console.error("=== OAuth Callback Error ===");
      console.error("❌ Error in ChatGPT OAuth callback:", error.message);
      console.error("Error stack:", error.stack);

      if (error.response) {
        console.error("Response data:", error.response.data);
        console.error("Response status:", error.response.status);
      }

      throw new Error(`ChatGPT authentication failed: ${error.message}`);
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
        console.log("Token expired, refreshing...");

        if (!user.google_refresh_token) {
          throw new Error("Token expired and no refresh token available");
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

          // Update tokens in both users and tenant_tokens tables
          const updatePromises = [
            // Update users table
            supabase
              .from("users")
              .update({
                google_access_token: credentials.access_token,
                google_refresh_token: credentials.refresh_token || user.google_refresh_token,
                token_expires_at: credentials.expiry_date
                  ? new Date(credentials.expiry_date).toISOString()
                  : null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", userId),
            
            // Update tenant_tokens table
            supabase
              .from("tenant_tokens")
              .update({
                access_token: credentials.access_token,
                refresh_token: credentials.refresh_token || user.google_refresh_token,
                expiry_date: credentials.expiry_date
                  ? new Date(credentials.expiry_date).toISOString()
                  : null,
                updated_at: new Date().toISOString(),
              })
              .eq("tenant_id", userId)
          ];

          const results = await Promise.all(updatePromises);
          
          // Check for errors
          const updateError = results.find(result => result.error);
          if (updateError?.error) {
            throw new Error(`Failed to update refreshed token: ${updateError.error.message}`);
          }

          console.log("Token refreshed successfully");

          return {
            ...user,
            google_access_token: credentials.access_token,
            google_refresh_token: credentials.refresh_token || user.google_refresh_token,
            token_expires_at: credentials.expiry_date
              ? new Date(credentials.expiry_date).toISOString()
              : null,
          };
        } catch (refreshError: any) {
          console.error("Token refresh failed:", refreshError);

          if (refreshError.code === 400 || refreshError.message.includes('invalid_grant')) {
            throw new Error("Refresh token is invalid - user needs to re-authenticate");
          }

          throw new Error(`Failed to refresh Google token: ${refreshError.message}`);
        }
      }
    }

    return user;
  }

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

  static async disconnectGoogle(userId: string) {
    try {
      // Get current user tokens
      const { data: user } = await supabase
        .from("users")
        .select("google_access_token, google_refresh_token")
        .eq("id", userId)
        .single();

      // Revoke Google tokens
      if (user?.google_access_token) {
        try {
          const revokeOAuth2Client = new google.auth.OAuth2();
          await revokeOAuth2Client.revokeToken(user.google_access_token);
        } catch (revokeError) {
          console.warn("Failed to revoke Google token:", revokeError);
        }
      }

      // Clear tokens from both tables
      const clearPromises = [
        // Clear from users table
        supabase
          .from("users")
          .update({
            google_access_token: null,
            google_refresh_token: null,
            google_id: null,
            token_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId),
        
        // Clear from tenant_tokens table
        supabase
          .from("tenant_tokens")
          .delete()
          .eq("tenant_id", userId)
      ];

      const results = await Promise.all(clearPromises);
      const clearError = results.find(result => result.error);
      
      if (clearError?.error) {
        throw new Error(`Failed to clear tokens: ${clearError.error.message}`);
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

  static async refreshGoogleToken(userId: string) {
    try {
      const user = await this.getUserWithGoogleToken(userId);
      return {
        success: true,
        access_token: user.google_access_token,
        expires_in: user.token_expires_at,
      };
    } catch (error: any) {
      console.error("Error refreshing Google token:", error);
      throw error;
    }
  }

  static async getCurrentUser() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

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