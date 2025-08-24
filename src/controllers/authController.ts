import { Request, Response } from "express";
import { AuthService } from "../services/authService";

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
  static googleAuth(req: Request, res: Response) {
    try {
      const url = AuthService.generateGoogleAuthUrl(req.user?.id);
      res.redirect(url);
    } catch (error: any) {
      console.error("Error in googleAuth:", error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Handle Google OAuth callback for ChatGPT users
   */
  static async oauthCallback(req: Request, res: Response) {
    try {
      const { code, state } = req.query;

      if (!code) {
        return res.status(400).send("Authorization code not provided");
      }

      const result = await AuthService.handleGoogleOAuthCallback(
        code as string,
        state as string
      );

      // If this is a Telegram request, redirect to Telegram handler
      if (!result.success && result.token && result.token.includes('/api/auth/callback')) {
        return res.redirect(result.token);
      }

      // For successful ChatGPT authentication, return JSON
      if (result.success) {
        return res.json(result);
      }

      // For errors, send error response
      res.status(500).send(result.message || "Authentication failed");

    } catch (error: any) {
      console.error("Error in oauthCallback:", error);
      res.status(500).send(`Authentication failed: ${error.message}`);
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