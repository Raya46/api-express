import { Request, Response, NextFunction } from "express";
import { supabase } from "../config/supabase";

export async function tenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  const tenantId = session.user.id;
  if (!tenantId) {
    return res.status(401).json({ error: "Tenant not identified" });
  }

  req.tenantId = tenantId;
  next();
}