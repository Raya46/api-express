import { google } from "googleapis";
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { supabase } from "../config/supabase";
import { oauth2Client, scopes } from "../config/google";

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
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      include_granted_scopes: true,
    });
    res.redirect(url);
  }

  static async oauthCallback(req: Request, res: Response) {
    const { code } = req.query;

    if (!code) {
      return res.status(400).send("Authorization code not provided");
    }

    try {
      // Step 1: Exchange code for tokens
      const { tokens } = await oauth2Client.getToken(code as string);

      if (!tokens.access_token) {
        throw new Error("No access token received from Google");
      }

      // Step 2: Set credentials to oauth2Client BEFORE making API calls
      oauth2Client.setCredentials(tokens);

      // Step 3: Get user info from Google (now with proper credentials)
      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      const { data: googleUser } = await oauth2.userinfo.get();

      if (!googleUser.email) {
        throw new Error("No email provided by Google");
      }

      console.log("Google user data:", googleUser);

      // Step 4: Check if user already exists in our users table
      let { data: existingUser } = await supabase
        .from("users")
        .select("*")
        .eq("email", googleUser.email)
        .single();

      let supabaseUser;

      if (!existingUser) {
        // User doesn't exist, create new user using Supabase Auth
        const { data: authData, error: signUpError } =
          await supabase.auth.signUp({
            email: googleUser.email!,
            password: Math.random().toString(36), // Random password for OAuth users
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

        // Now create profile in users table with the UUID from auth.users
        const { data: newUserProfile, error: insertError } = await supabase
          .from("users")
          .insert([
            {
              id: authData.user.id, // This is the UUID from auth.users
              email: googleUser.email,
              full_name: googleUser.name || "",
              google_id: googleUser.id,
              avatar_url: googleUser.picture || null,
              google_access_token: tokens.access_token,
              google_refresh_token: tokens.refresh_token,
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
          // Clean up: delete the auth user if profile creation fails
          await supabase.auth.admin.deleteUser(authData.user.id);
          throw new Error(
            `Failed to create user profile: ${insertError.message}`
          );
        }

        existingUser = newUserProfile;
      } else {
        // User exists, update their information and tokens
        const { error: updateError } = await supabase
          .from("users")
          .update({
            full_name: googleUser.name || existingUser.full_name,
            google_id: googleUser.id,
            avatar_url: googleUser.picture || existingUser.avatar_url,
            google_access_token: tokens.access_token,
            google_refresh_token: tokens.refresh_token,
            token_expires_at: tokens.expiry_date
              ? new Date(tokens.expiry_date).toISOString()
              : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingUser.id);

        if (updateError) {
          throw new Error(
            `Failed to update user profile: ${updateError.message}`
          );
        }

        supabaseUser = existingUser;
      }

      // Step 6: Generate JWT token for your application
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

      // More detailed error logging
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

  // Test Google connection
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

      // Test the connection by making a simple API call
      oauth2Client.setCredentials({
        access_token: user.google_access_token,
        refresh_token: user.google_refresh_token,
      });

      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      await oauth2.userinfo.get();

      res.json({
        connected: true,
        message: "Google account connected successfully",
        user: {
          google_id: user.google_id,
          email: user.email,
          full_name: user.full_name,
          avatar_url: user.avatar_url,
        },
      });
    } catch (error: any) {
      console.error("Google connection test failed:", error);
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

  // Disconnect Google account
  static async disconnectGoogle(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      // Clear Google tokens from database
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
        throw new Error(
          `Failed to disconnect Google account: ${error.message}`
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

  // Additional method to refresh Google tokens
  static async refreshGoogleToken(req: Request, res: Response) {
    try {
      const userId = req.user?.id; // Assuming you have middleware to get user

      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      // Get user's refresh token from database
      const { data: user } = await supabase
        .from("users")
        .select("google_refresh_token, google_access_token")
        .eq("id", userId)
        .single();

      if (!user?.google_refresh_token) {
        return res
          .status(400)
          .json({ error: "No Google refresh token available" });
      }

      // Refresh Google tokens
      oauth2Client.setCredentials({
        refresh_token: user.google_refresh_token,
      });

      const { credentials } = await oauth2Client.refreshAccessToken();

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
        access_token: credentials.access_token,
        expires_in: credentials.expiry_date,
      });
    } catch (error: any) {
      console.error("Error refreshing Google token:", error);
      res.status(500).json({ error: error.message });
    }
  }

  // Method to get user with Google token (useful for calendar API calls)
  static async getUserWithGoogleToken(userId: string) {
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (error || !user) {
      throw new Error("User not found");
    }

    // Check if token is expired (if expiry date exists)
    if (user.token_expires_at) {
      const expiryDate = new Date(user.token_expires_at);
      const now = new Date();
      const bufferTime = 5 * 60 * 1000; // 5 minutes buffer

      if (now.getTime() > expiryDate.getTime() - bufferTime) {
        // Token is expired or about to expire, refresh it
        if (user.google_refresh_token) {
          oauth2Client.setCredentials({
            refresh_token: user.google_refresh_token,
          });

          try {
            const { credentials } = await oauth2Client.refreshAccessToken();

            // Update the token in database
            await supabase
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

            return {
              ...user,
              google_access_token: credentials.access_token,
              google_refresh_token:
                credentials.refresh_token || user.google_refresh_token,
              token_expires_at: credentials.expiry_date
                ? new Date(credentials.expiry_date).toISOString()
                : null,
            };
          } catch (refreshError) {
            console.error("Token refresh failed:", refreshError);
            throw new Error("Failed to refresh Google token");
          }
        } else {
          throw new Error("Token expired and no refresh token available");
        }
      }
    }

    return user;
  }
}
