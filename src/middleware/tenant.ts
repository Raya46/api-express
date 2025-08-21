import { Request, Response, NextFunction } from "express";
import { supabase } from "../config/supabase";

export async function tenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Try to get tenant ID from multiple sources
  let tenantId = req.headers['x-tenant-id'] as string ||
                 req.query.tenantId as string;

  // If no tenant ID from headers, try to get from authenticated user
  if (!tenantId) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session) {
      tenantId = session.user.id;
    }
  }

  if (!tenantId) {
    return res.status(401).json({ error: "Tenant not identified" });
  }

  req.tenantId = tenantId;
  next();
}