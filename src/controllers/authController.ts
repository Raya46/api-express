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


static async googleAuth(req: Request, res: Response) {
  try {
    // Tentukan tipe login sebagai 'chatgpt'
    const { auth_url } = await AuthService.generateGoogleAuthUrl(req.user?.id, 'chatgpt');
    res.redirect(auth_url);
  } catch (error: any) {
    console.error("Error in googleAuth:", error);
    res.status(500).json({ error: error.message });
  }
}

static async oauthCallback(req: Request, res: Response) {
    const { code, state } = req.query;

    console.log("OAuth callback received:", { 
      hasCode: !!code, 
      hasState: !!state,
      state: state ? String(state).substring(0, 100) + '...' : 'none' // Log partial state for debugging
    });

    if (!code || !state) {
      console.error("Missing required parameters:", { code: !!code, state: !!state });
      return res.status(400).send("Authorization code or state not provided.");
    }

    try {
      console.log("Parsing state data...");
      const stateData = JSON.parse(state as string);
      const loginType = stateData.type;
      
      console.log("Login type determined:", loginType);

      if (loginType === 'telegram_oauth') {
        console.log("Processing Telegram OAuth callback...");
        
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
        console.log("Processing ChatGPT OAuth callback...");
        
        try {
          const result = await AuthService.handleGoogleOAuthCallback(code as string, state as string);
          
          console.log("OAuth callback result:", {
            success: result.success,
            hasToken: !!result.token,
            hasUser: !!result.user,
            userEmail: result.user?.email
          });

          return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Authentication Successful</title>
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
                .debug-info {
                  background-color: #f8f9fa;
                  padding: 15px;
                  border-radius: 5px;
                  margin: 20px 0;
                  font-size: 12px;
                  color: #666;
                  text-align: left;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="success">✅ Authentication Successful!</div>
                <div class="info">You can close this window and return to ChatGPT.</div>
                <div class="debug-info">
                  <strong>Debug Info:</strong><br>
                  User: ${result.user?.email || 'N/A'}<br>
                  Token: ${result.token ? 'Generated' : 'Not generated'}<br>
                  Timestamp: ${new Date().toISOString()}
                </div>
                <script>
                  console.log('Authentication completed successfully');
                  console.log('User:', ${JSON.stringify(result.user || {})});
                  // Auto close after 3 seconds
                  setTimeout(function() {
                    window.close();
                  }, 3000);
                </script>
              </div>
            </body>
            </html>
          `);
          
        } catch (authError: any) {
          console.error("AuthService.handleGoogleOAuthCallback failed:", authError);
          console.error("Auth error stack:", authError.stack);
          
          throw authError; // Re-throw to be caught by outer catch block
        }
      }
    } catch (error: any) {
      console.error("Error in master OAuth callback:", error.message);
      console.error("Full error object:", error);
      
      if (error.response) {
        console.error("Response data:", error.response.data);
        console.error("Response status:", error.response.status);
      }
      
      // Enhanced error page with debugging info
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Authorization Failed</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              background-color: #fff5f5;
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
            .error {
              color: #dc3545;
              font-size: 24px;
              margin-bottom: 20px;
            }
            .error-details {
              background-color: #f8f9fa;
              padding: 15px;
              border-radius: 5px;
              margin: 20px 0;
              font-size: 14px;
              color: #666;
              text-align: left;
              word-wrap: break-word;
            }
            .retry-button {
              display: inline-block;
              background-color: #007bff;
              color: white;
              padding: 12px 24px;
              text-decoration: none;
              border-radius: 5px;
              font-weight: bold;
              margin-top: 20px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="error">❌ Authorization Failed</div>
            <div>Something went wrong during authentication.</div>
            <div class="error-details">
              <strong>Error Details:</strong><br>
              Message: ${error.message}<br>
              Type: ${error.constructor.name}<br>
              Timestamp: ${new Date().toISOString()}<br>
              ${error.code ? `Code: ${error.code}<br>` : ''}
              ${error.hint ? `Hint: ${error.hint}<br>` : ''}
            </div>
            <a href="${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/google" class="retry-button">
              🔄 Try Again
            </a>
          </div>
        </body>
        </html>
      `);
    }
  }

  static async exchangeCodeForToken(req: Request, res: Response) {
    try {
      const { code, client_id, client_secret } = req.body;

      console.log("Exchange code for token request:", {
        hasCode: !!code,
        client_id: client_id,
        hasClientSecret: !!client_secret
      });

      if (client_id !== process.env.GOOGLE_CLIENT_ID || client_secret !== process.env.GOOGLE_CLIENT_SECRET) {
        console.error("Invalid client credentials provided");
        return res.status(401).json({ error: 'Invalid client credentials' });
      }

      console.log("Exchanging authorization code for tokens...");

      const result = await AuthService.handleGoogleOAuthCallback(code);

      console.log("Exchange result:", {
        success: result.success,
        hasUser: !!result.user,
        userEmail: result.user?.email
      });

      if (!result.success || !result.user) {
        console.error("OAuth exchange failed:", result);
        return res.status(400).json({ error: 'invalid_grant' });
      }

      const internalToken = jwt.sign(
        {
          userId: result.user.id,
          email: result.user.email,
          user_type: "chatgpt"
        },
        process.env.JWT_SECRET || "fallback_secret",
        { expiresIn: '1h' } // 1 hour expiration
      );

      console.log("Generated internal token for user:", result.user.email);

      res.json({
        access_token: internalToken,
        token_type: 'Bearer',
        expires_in: 3600, // 1 hour in seconds
      });

    } catch (error: any) {
      console.error("Error exchanging code for token:", error);
      console.error("Exchange error stack:", error.stack);
      res.status(400).json({ error: 'invalid_grant' });
    }
  }

 
  static async getMe(req: Request, res: Response) {
    try {
      const user = await AuthService.getCurrentUser();
      res.json(user);
    } catch (error: any) {
      console.error("Error in getMe:", error);
      res.status(500).json({ error: error.message });
    }
  }

  
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