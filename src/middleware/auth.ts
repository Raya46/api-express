import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase';
import { AuthController } from '../controllers/authController';

// Extend Express Request interface to include user and hasGoogleAuth
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        full_name: string;
        hasGoogleAuth?: boolean; // FIX: Added optional property
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

    // Verify user still exists in database
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, full_name')
      .eq('id', decoded.userId)
      .single();

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

    // Check if user has Google token
    const { data: user, error } = await supabase
      .from('users')
      .select('google_access_token, google_refresh_token, token_expires_at')
      .eq('id', req.user.id)
      .single();

    if (error) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user.google_access_token) {
      return res.status(401).json({ 
        error: 'Google authentication required',
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
        console.log('Google token expired or about to expire');

        if (!user.google_refresh_token) {
          return res.status(401).json({ 
            error: 'Google token expired and no refresh token available',
            needsAuth: true,
            authUrl: `${process.env.BASE_URL}/api/auth/google`
          });
        }

        try {
          // Try to refresh the token
          await AuthController.getUserWithGoogleToken(req.user.id);
          console.log('Google token refreshed successfully');
        } catch (refreshError: any) {
          console.error('Failed to refresh Google token:', refreshError);
          
          return res.status(401).json({ 
            error: 'Failed to refresh Google token',
            needsAuth: true,
            authUrl: `${process.env.BASE_URL}/api/auth/google`
          });
        }
      }
    }

    next();
  } catch (error: any) {
    console.error('Google auth check error:', error);
    res.status(500).json({ error: 'Authentication check failed' });
  }
};

// Optional middleware for endpoints that work with or without Google auth
export const optionalGoogleAuth = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  authenticateToken(req, res, async (err) => {
    if (err) return next(err);

    try {
      if (req.user) { // Check if user object exists
        // FIX: Initialize property on the existing user object
        req.user.hasGoogleAuth = false; 

        const { data } = await supabase
          .from('users')
          .select('google_access_token')
          .eq('id', req.user.id)
          .single();

        if (data?.google_access_token) {
          // FIX: Update property on the existing user object
          req.user.hasGoogleAuth = true;
        }
      }
    } catch (dbError) {
      console.error('Optional Google auth DB check failed, but continuing as request is optional.', dbError);
    }
    
    // Always call next() to proceed
    next();
  });
};

// Error handler specifically for authentication errors
export const handleAuthError = (
  error: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('Authentication error:', error);

  if (error.message?.includes('authenticate') || error.code === 401) {
    return res.status(401).json({ 
      error: 'Authentication required',
      needsAuth: true,
      authUrl: `${process.env.BASE_URL}/api/auth/google`
    });
  }

  if (error.message?.includes('refresh token')) {
    return res.status(401).json({ 
      error: 'Token refresh failed - re-authentication required',
      needsAuth: true,
      authUrl: `${process.env.BASE_URL}/api/auth/google`
    });
  }

  next(error);
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
