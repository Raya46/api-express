import { Request, Response } from "express";
import { google } from "googleapis";
import jwt from "jsonwebtoken";
import { oauth2Client, scopes } from "../config/google";
import { supabase } from "../config/supabase";

export class AuthController {
  static async register(req: Request, res: Response) {
    const { email, password, full_name } = req.body;

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name,
        },
      },
    });

    if (authError) {
      return res.status(400).json({ error: authError.message });
    }
    if (!authData.user) {
      return res.status(400).json({ error: "User not created" });
    }

    const { error: insertError } = await supabase
      .from("users")
      .insert([{ id: authData.user.id, email, full_name }]);

    if (insertError) {
      console.error("Supabase insert profile error:", insertError);

      await supabase.auth.admin.deleteUser(authData.user.id);
      return res.status(500).json({
        error: "Failed to save user profile.",
        details: insertError,
      });
    }

    res
      .status(201)
      .json({ message: "User created successfully", data: authData });
  }

  static async login(req: Request, res: Response) {
    const { email, password } = req.body;

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const token = data.session.access_token;
    res.json({ token });
  }

  static async logout(req: Request, res: Response) {
    res.json({ message: "Logout successful" });
  }

  static async getCurrentUser(req: Request, res: Response) {
    res.json(req.user);
  }

  static googleAuth(req: Request, res: Response) {
    // FIXED: Add state parameter to track user and force approval
    const state = req.user?.id ? JSON.stringify({ userId: req.user.id }) : '';
    
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      include_granted_scopes: true,
      prompt: 'consent', // FIXED: Force consent to get refresh token
      state: state, // Track the user making the request
    });
    res.redirect(url);
  }

  static async oauthCallback(req: Request, res: Response) {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).send("Authorization code not provided");
    }

    try {
      // FIXED: Create new OAuth2 client for this callback to avoid conflicts
      const callbackOAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      // Step 1: Exchange code for tokens
      const { tokens } = await callbackOAuth2Client.getToken(code as string);

      if (!tokens.access_token) {
        throw new Error("No access token received from Google");
      }

      console.log("Received tokens:", {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiryDate: tokens.expiry_date
      });

      // FIXED: Ensure we have a refresh token
      if (!tokens.refresh_token) {
        console.warn("No refresh token received - user may need to re-authorize");
      }

      // Step 2: Set credentials to get user info
      callbackOAuth2Client.setCredentials(tokens);

      // Step 3: Get user info from Google
      const oauth2 = google.oauth2({ version: "v2", auth: callbackOAuth2Client });
      const { data: googleUser } = await oauth2.userinfo.get();

      if (!googleUser.email) {
        throw new Error("No email provided by Google");
      }

      console.log("Google user data:", googleUser);

      // Step 4: Parse state to get current user if available
      let currentUserId = null;
      if (state) {
        try {
          const parsedState = JSON.parse(state as string);
          currentUserId = parsedState.userId;
        } catch (e) {
          console.log("Could not parse state, proceeding without current user");
        }
      }

      // Step 5: Check if user already exists
      let { data: existingUser } = await supabase
        .from("users")
        .select("*")
        .eq("email", googleUser.email)
        .single();

      let supabaseUser;

      if (!existingUser) {
        // User doesn't exist, create new user
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

        // Create profile with Google tokens
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
            `Failed to create user profile: ${insertError.message}`
          );
        }

        existingUser = newUserProfile;
      } else {
        // FIXED: User exists, update their Google tokens
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
            `Failed to update user profile: ${updateError.message}`
          );
        }

        // FIXED: Get updated user data
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

      // Step 7: Generate JWT token
      const jwtToken = jwt.sign(
        {
          userId: existingUser.id,
          email: existingUser.email,
          full_name: existingUser.full_name,
        },
        process.env.JWT_SECRET || "fallback_secret",
        { expiresIn: "7d" }
      );

      res.json({
        success: true,
        message: "Authentication successful",
        token: jwtToken,
        user: {
          id: existingUser.id,
          email: existingUser.email,
          full_name: existingUser.full_name,
        },
      });

    } catch (error: any) {
      console.error("Error in OAuth callback:", error);

      if (error.response) {
        console.error("Response data:", error.response.data);
        console.error("Response status:", error.response.status);
      }
      
      res.status(500).send(`Authentication failed: ${error.message}`);
    }
  }

  static async getMe(req: Request, res: Response) {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      res.json(user);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  // FIXED: Improved Google connection test with automatic token refresh
  static async testGoogleConnection(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const user = await AuthController.getUserWithGoogleToken(userId);

      if (!user.google_access_token) {
        return res.json({
          connected: false,
          message: "No Google account connected",
          needsAuth: true,
          authUrl: `${
            process.env.BASE_URL || "http://localhost:3000"
          }/api/auth/google`,
        });
      }

      // FIXED: Test with fresh token
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

      res.json({
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
      });
    } catch (error: any) {
      console.error("Google connection test failed:", error);
      
      // FIXED: If token is invalid, try to refresh or require re-auth
      if (error.code === 401 || error.message.includes('invalid_token')) {
        return res.json({
          connected: false,
          error: "Token expired or invalid",
          needsAuth: true,
          authUrl: `${
            process.env.BASE_URL || "http://localhost:3000"
          }/api/auth/google`,
        });
      }

      res.status(500).json({
        connected: false,
        error: error.message,
        needsAuth: true,
        authUrl: `${
          process.env.BASE_URL || "http://localhost:3000"
        }/api/auth/google`,
      });
    }
  }

  static async disconnectGoogle(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      // FIXED: Revoke Google tokens before clearing from database
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

      res.json({
        success: true,
        message: "Google account disconnected successfully",
      });
    } catch (error: any) {
      console.error("Error disconnecting Google:", error);
      res.status(500).json({ error: error.message });
    }
  }

  static async refreshToken(req: Request, res: Response) {
    const { refresh_token } = req.body;
    try {
      const { data, error } = await supabase.auth.refreshSession({
        refresh_token,
      });
      if (error) {
        return res.status(401).json({ error: error.message });
      }
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  // FIXED: Improved Google token refresh
  static async refreshGoogleToken(req: Request, res: Response) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const { data: user } = await supabase
        .from("users")
        .select("google_refresh_token, google_access_token")
        .eq("id", userId)
        .single();

      if (!user?.google_refresh_token) {
        return res.status(400).json({ 
          error: "No Google refresh token available",
          needsReauth: true 
        });
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

      res.json({
        success: true,
        access_token: credentials.access_token,
        expires_in: credentials.expiry_date,
      });
    } catch (error: any) {
      console.error("Error refreshing Google token:", error);
      
      // FIXED: Better error handling for refresh failures
      if (error.code === 400 || error.message.includes('invalid_grant')) {
        res.status(400).json({ 
          error: "Refresh token is invalid or expired",
          needsReauth: true 
        });
      } else {
        res.status(500).json({ error: error.message });
      }
    }
  }

  // FIXED: Improved method to get user with automatic token refresh
  static async getUserWithGoogleToken(userId: string) {
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (error || !user) {
      throw new Error("User not found");
    }

    // FIXED: Check if token exists
    if (!user.google_access_token) {
      throw new Error("No Google access token found");
    }

    // Check if token is expired
    if (user.token_expires_at) {
      const expiryDate = new Date(user.token_expires_at);
      const now = new Date();
      const bufferTime = 5 * 60 * 1000; // 5 minutes buffer

      if (now.getTime() > expiryDate.getTime() - bufferTime) {
        console.log("Token expired or about to expire, refreshing...");
        
        if (!user.google_refresh_token) {
          throw new Error("Token expired and no refresh token available - user needs to re-authenticate");
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

          console.log("Token refreshed successfully");

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
  
}