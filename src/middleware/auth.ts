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

    const tenantId = req.user.id;
    const userType = req.user.user_type;
    
    // Tentukan authUrl berdasarkan tipe pengguna
    const authUrl = userType === 'telegram'
      ? `${process.env.BASE_URL}/api/telegram/oauth/generate`
      : `${process.env.BASE_URL}/api/auth/google`;

    // --- LOGIKA TERUNIFIKASI: SELALU GUNAKAN 'tenant_tokens' ---
    const { data: tokenInfo, error: fetchError } = await supabase
      .from('tenant_tokens')
      .select('access_token, refresh_token, expiry_date')
      .eq('tenant_id', tenantId)
      .single();

    if (fetchError || !tokenInfo || !tokenInfo.access_token) {
      return res.status(401).json({
        error: 'Google authentication required. No valid tokens found.',
        needsAuth: true,
        authUrl: authUrl
      });
    }

    const isTokenExpired = tokenInfo.expiry_date ? new Date() > new Date(new Date(tokenInfo.expiry_date).getTime() - (5 * 60 * 1000)) : true;

    if (isTokenExpired) {
      console.log(`Google token for tenant ${tenantId} requires refresh.`);

      if (!tokenInfo.refresh_token) {
        return res.status(401).json({
          error: 'Google token expired and no refresh token is available.',
          needsAuth: true,
          authUrl: authUrl
        });
      }

      try {
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET
        );
        oauth2Client.setCredentials({ refresh_token: tokenInfo.refresh_token });
        
        const { credentials } = await oauth2Client.refreshAccessToken();
        const newTokens = credentials;

        console.log(`Google token for tenant ${tenantId} refreshed successfully.`);

        // --- LOGIKA UPDATE TERUNIFIKASI: SELALU UPDATE 'tenant_tokens' ---
        const updatePayload = {
          access_token: newTokens.access_token,
          expiry_date: newTokens.expiry_date ? new Date(newTokens.expiry_date).toISOString() : null,
          ...(newTokens.refresh_token && { refresh_token: newTokens.refresh_token }),
          updated_at: new Date().toISOString(),
        };

        const { error: updateError } = await supabase
          .from('tenant_tokens')
          .update(updatePayload)
          .eq('tenant_id', tenantId);
          
        if (updateError) throw new Error(`Failed to update refreshed tokens for tenant ${tenantId}.`);

      } catch (refreshError: any) {
        console.error(`Failed to refresh Google token for tenant ${tenantId}:`, refreshError.message);
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

export const requireGoogleAuth = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // First run basic authentication
  authenticateToken(req, res, (err) => {
    if (err) return next(err);
    
    checkGoogleTokenValidity(req, res, next);
  });
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

    // Check Google token validity for Telegram users
    const userId = req.user.id;
    const { data: tenantToken, error: tokenError } = await supabase
      .from('tenant_tokens')
      .select('access_token, refresh_token, expiry_date')
      .eq('tenant_id', userId)
      .single();

    if (tokenError || !tenantToken || !tenantToken.access_token) {
      return res.status(401).json({
        error: 'Google authentication required',
        needsAuth: true,
        authUrl: `${process.env.BASE_URL}/api/telegram/oauth/generate`
      });
    }

    // Check if token is expired (with 5-minute buffer)
    const isTokenExpired = tenantToken.expiry_date ? new Date() > new Date(new Date(tenantToken.expiry_date).getTime() - (5 * 60 * 1000)) : true;

    if (isTokenExpired) {
      console.log(`Google token for Telegram user ${userId} requires refresh.`);

      if (!tenantToken.refresh_token) {
        return res.status(401).json({
          error: 'Google token expired and no refresh token is available.',
          needsAuth: true,
          authUrl: `${process.env.BASE_URL}/api/telegram/oauth/generate`
        });
      }

      // Attempt to refresh the token
      try {
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET
        );
        oauth2Client.setCredentials({ refresh_token: tenantToken.refresh_token });

        const { credentials } = await oauth2Client.refreshAccessToken();
        const newTokens = credentials;

        console.log('Google token refreshed successfully for Telegram user.');

        // Update the token in tenant_tokens table
        const updatePayload = {
          access_token: newTokens.access_token,
          expiry_date: newTokens.expiry_date ? new Date(newTokens.expiry_date).toISOString() : null,
          ...(newTokens.refresh_token && { refresh_token: newTokens.refresh_token }),
          updated_at: new Date().toISOString(),
        };

        const { error: updateError } = await supabase
          .from('tenant_tokens')
          .update(updatePayload)
          .eq('tenant_id', userId);

        if (updateError) {
          console.error('Failed to update refreshed tokens for Telegram user:', updateError);
          return res.status(401).json({
            error: 'Failed to refresh Google token. Please re-authenticate.',
            needsAuth: true,
            authUrl: `${process.env.BASE_URL}/api/telegram/oauth/generate`
          });
        }

      } catch (refreshError: any) {
        console.error('Failed to refresh Google token for Telegram user:', refreshError.message);
        return res.status(401).json({
          error: 'Failed to refresh Google token. Please re-authenticate.',
          needsAuth: true,
          authUrl: `${process.env.BASE_URL}/api/telegram/oauth/generate`
        });
      }
    }

    next();
  } catch (error: any) {
    console.error('Telegram auth middleware error:', error);
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
