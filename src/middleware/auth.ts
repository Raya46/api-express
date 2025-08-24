import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase';
import { AuthController } from '../controllers/authController';
import { TelegramController } from '../controllers/telegramController';
import { google } from 'googleapis';

// Extend Express Request interface to include user and hasGoogleAuth
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string; // Optional for Telegram users
        full_name: string;
        telegram_chat_id?: number; // For Telegram users
        username?: string; // For Telegram users
        user_type?: 'chatgpt' | 'telegram'; // To distinguish user types
        hasGoogleAuth?: boolean;
      };
      tenantId?: string; // For backward compatibility
    }
  }
}

// Basic JWT authentication middleware
export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        error: 'Access token required',
        needsAuth: true
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'fallback_secret'
    ) as any;

    let user = null;
    let error = null;

    // Check if this is a GPT Action internal token (has user_type: "chatgpt")
    if (decoded.user_type === 'chatgpt') {
      // Verify ChatGPT user exists in database
      const result = await supabase
        .from('users')
        .select('id, email, full_name')
        .eq('id', decoded.userId)
        .single();

      user = result.data;
      error = result.error;

      if (user) {
        user = {
          ...user,
          user_type: 'chatgpt' as const
        };
      }
    }
    // Check if this is a ChatGPT user (has email in decoded token)
    else if (decoded.email) {
      // Verify ChatGPT user exists in database
      const result = await supabase
        .from('users')
        .select('id, email, full_name')
        .eq('id', decoded.userId)
        .single();

      user = result.data;
      error = result.error;

      if (user) {
        user = {
          ...user,
          user_type: 'chatgpt' as const
        };
      }
    } else {
      // This is a Telegram user (no email in decoded token)
      // Verify Telegram user exists in database
      const result = await supabase
        .from('telegram_users')
        .select('id, telegram_chat_id, full_name, username')
        .eq('id', decoded.userId)
        .single();

      if (result.data) {
        user = {
          ...result.data,
          user_type: 'telegram' as const
        };
      }
      error = result.error;
    }

    if (error || !user) {
      return res.status(401).json({
        error: 'Invalid token or user not found',
        needsAuth: true
      });
    }

    req.user = user;
    req.tenantId = user.id; // For backward compatibility
    next();
  } catch (error: any) {
    console.error('Token verification error:', error);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Invalid token',
        needsAuth: true
      });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired',
        needsAuth: true
      });
    }

    return res.status(500).json({ error: 'Authentication error' });
  }
};

// Enhanced middleware that also checks Google token validity
export const requireGoogleAuth = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // First run basic authentication
  authenticateToken(req, res, (err) => {
    if (err) return next(err);
    
    // If basic auth passed, continue with Google token check
    checkGoogleTokenValidity(req, res, next);
  });
};


const checkGoogleTokenValidity = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        error: 'User authentication required',
        needsAuth: true
      });
    }

    const userId = req.user.id;
    const userType = req.user.user_type;

    let tokenInfo: { access_token: string | null, refresh_token: string | null, expiry_date: string | null } | null = null;
    let authUrl = '';

    if (userType === 'telegram') {
      authUrl = `${process.env.BASE_URL}/api/telegram/oauth/generate`; // Define auth URL for telegram
      const { data, error } = await supabase
        .from('tenant_tokens')
        .select('access_token, refresh_token, expiry_date')
        .eq('tenant_id', userId)
        .single();
      if (error) throw new Error("Could not fetch tenant tokens for Telegram user.");
      tokenInfo = data;

    } else { // Assumes 'chatgpt' user
      authUrl = `${process.env.BASE_URL}/api/auth/google`; // Define auth URL for GPT
      const { data, error } = await supabase
        .from('users')
        .select('google_access_token, google_refresh_token, token_expires_at')
        .eq('id', userId)
        .single();
      if (error) throw new Error("Could not fetch user tokens for GPT user.");
      // Standardize the object keys to match tenant_tokens
      tokenInfo = {
          access_token: data?.google_access_token || null,
          refresh_token: data?.google_refresh_token || null,
          expiry_date: data?.token_expires_at || null,
      };
    }

    if (!tokenInfo || !tokenInfo.access_token) {
       return res.status(401).json({
          error: 'Google authentication required',
          needsAuth: true,
          authUrl: authUrl
       });
    }

    const isTokenExpired = tokenInfo.expiry_date ? new Date() > new Date(new Date(tokenInfo.expiry_date).getTime() - (5 * 60 * 1000)) : true;

    if (isTokenExpired) {
      console.log(`Google token for ${userType} user ${userId} requires refresh.`);

      if (!tokenInfo.refresh_token) {
        return res.status(401).json({
          error: 'Google token expired and no refresh token is available.',
          needsAuth: true,
          authUrl: authUrl
        });
      }

      // --- Universal Token Refresh Logic ---
      try {
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET
        );
        oauth2Client.setCredentials({ refresh_token: tokenInfo.refresh_token });
        
        const { credentials } = await oauth2Client.refreshAccessToken();
        const newTokens = credentials;

        console.log('Google token refreshed successfully.');

        // --- Universal Token Update Logic ---
        const updatePayload = {
            access_token: newTokens.access_token,
            expiry_date: newTokens.expiry_date ? new Date(newTokens.expiry_date).toISOString() : null,
            // Only update refresh token if a new one is provided
            ...(newTokens.refresh_token && { refresh_token: newTokens.refresh_token }),
            updated_at: new Date().toISOString(),
        };

        if (userType === 'telegram') {
            const { error } = await supabase.from('tenant_tokens').update(updatePayload).eq('tenant_id', userId);
            if (error) throw new Error("Failed to update refreshed tokens for Telegram user.");
        } else {
            // Adapt keys for the 'users' table
            const userUpdatePayload = {
                google_access_token: updatePayload.access_token,
                token_expires_at: updatePayload.expiry_date,
                ...(updatePayload.refresh_token && { google_refresh_token: updatePayload.refresh_token }),
                updated_at: updatePayload.updated_at,
            };
            const { error } = await supabase.from('users').update(userUpdatePayload).eq('id', userId);
            if (error) throw new Error("Failed to update refreshed tokens for GPT user.");
        }

      } catch (refreshError: any) {
        console.error('Failed to refresh Google token:', refreshError.message);
        return res.status(401).json({
          error: 'Failed to refresh Google token. Please re-authenticate.',
          needsAuth: true,
          authUrl: authUrl
        });
      }
    }

    next();
  } catch (error: any) {
    console.error('Google auth check error:', error);
    res.status(500).json({ error: 'Authentication check failed' });
  }
};

export const telegramAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const telegramChatId = req.headers['x-telegram-chat-id'];

  if (!telegramChatId) {
    return res.status(401).json({ error: "Telegram chat ID required" });
  }

  try {
    const user = await TelegramController.getUserByTelegramId(parseInt(telegramChatId as string));

    // Add user type to identify this as a Telegram user
    req.user = {
      ...user,
      full_name: user.full_name || '',
      username: user.username || undefined,
      user_type: 'telegram' as const
    };

    next();
  } catch (error: any) {
    res.status(401).json({ error: error.message });
  }
};




// Middleware to add CORS headers for auth endpoints
export const corsForAuth = (req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'http://localhost:3000');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
};
