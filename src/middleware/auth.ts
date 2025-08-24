import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase';
import { AuthController } from '../controllers/authController';
import { TelegramController } from '../controllers/telegramController';

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

    let hasValidToken = false;
    let needsRefresh = false;
    let authUrl = '';

    if (userType === 'telegram') {
      // Check Telegram user's Google token in tenant_tokens table
      const { data: tenantToken, error } = await supabase
        .from('tenant_tokens')
        .select('access_token, refresh_token, expiry_date')
        .eq('tenant_id', userId)
        .single();

      if (error || !tenantToken || !tenantToken.access_token) {
        return res.status(401).json({
          error: 'Google authentication required for Telegram user',
          needsAuth: true,
          authUrl: `${process.env.BASE_URL}/api/telegram/oauth/generate`
        });
      }

      // Check if token is expired
      if (tenantToken.expiry_date) {
        const expiryDate = new Date(tenantToken.expiry_date);
        const now = new Date();
        const bufferTime = 5 * 60 * 1000; // 5 minutes buffer

        if (now.getTime() > expiryDate.getTime() - bufferTime) {
          console.log('Telegram user Google token expired or about to expire');

          if (!tenantToken.refresh_token) {
            return res.status(401).json({
              error: 'Google token expired and no refresh token available',
              needsAuth: true,
              authUrl: `${process.env.BASE_URL}/api/telegram/oauth/generate`
            });
          }

          needsRefresh = true;
          authUrl = `${process.env.BASE_URL}/api/telegram/oauth/generate`;
        }
      }

      hasValidToken = !!tenantToken.access_token;

    } else {
      // Check ChatGPT user's Google token in users table
      const { data: user, error } = await supabase
        .from('users')
        .select('google_access_token, google_refresh_token, token_expires_at')
        .eq('id', userId)
        .single();

      if (error) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!user.google_access_token) {
        return res.status(401).json({
          error: 'Google authentication required for ChatGPT user',
          needsAuth: true,
          authUrl: `${process.env.BASE_URL}/api/auth/google`
        });
      }

      // Check if token is expired
      if (user.token_expires_at) {
        const expiryDate = new Date(user.token_expires_at);
        const now = new Date();
        const bufferTime = 5 * 60 * 1000; // 5 minutes buffer

        if (now.getTime() > expiryDate.getTime() - bufferTime) {
          console.log('ChatGPT user Google token expired or about to expire');

          if (!user.google_refresh_token) {
            return res.status(401).json({
              error: 'Google token expired and no refresh token available',
              needsAuth: true,
              authUrl: `${process.env.BASE_URL}/api/auth/google`
            });
          }

          needsRefresh = true;
          authUrl = `${process.env.BASE_URL}/api/auth/google`;
        }
      }

      hasValidToken = !!user.google_access_token;
    }

    if (!hasValidToken) {
      return res.status(401).json({
        error: 'Google authentication required',
        needsAuth: true,
        authUrl: authUrl || `${process.env.BASE_URL}/api/auth/google`
      });
    }

    // Try to refresh token if needed
    if (needsRefresh) {
      try {
        if (userType === 'telegram') {
          // For Telegram users, we need to implement token refresh logic
          // This would typically involve calling Google's refresh token endpoint
          console.log('Telegram user token refresh needed - would implement refresh logic here');
        } else {
          // For ChatGPT users, use existing refresh logic
          await AuthController.getUserWithGoogleToken(userId);
        }
        console.log('Google token refreshed successfully');
      } catch (refreshError: any) {
        console.error('Failed to refresh Google token:', refreshError);

        return res.status(401).json({
          error: 'Failed to refresh Google token',
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
