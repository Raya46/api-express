import { Request, Response } from "express";
import { google } from "googleapis";
import { supabase } from "../config/supabase";

// Multi-tenant function to get authorized client
async function getAuthorizedClient(tenantId: string) {
  try {
    // Get tenant tokens from tenant_tokens table
    const { data: tenantToken, error } = await supabase
      .from("tenant_tokens")
      .select("access_token, refresh_token, expiry_date")
      .eq("tenant_id", tenantId)
      .single();

    if (error || !tenantToken) {
      throw new Error("Tenant tokens not found. Please authenticate with Google first.");
    }

    if (!tenantToken.access_token) {
      throw new Error("No Google access token available - tenant needs to authenticate");
    }

    // Create OAuth2 client instance
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      access_token: tenantToken.access_token,
      refresh_token: tenantToken.refresh_token,
      expiry_date: tenantToken.expiry_date ? new Date(tenantToken.expiry_date).getTime() : undefined,
    });

    // Auto-refresh tokens when they expire
    oauth2Client.on("tokens", async (newTokens) => {
      console.log("New tokens received, updating tenant_tokens table...");

      try {
        const updateData: any = {
          updated_at: new Date().toISOString(),
        };

        if (newTokens.access_token) {
          updateData.access_token = newTokens.access_token;
        }

        if (newTokens.refresh_token) {
          updateData.refresh_token = newTokens.refresh_token;
        }

        if (newTokens.expiry_date) {
          updateData.expiry_date = new Date(newTokens.expiry_date).toISOString();
        }

        await supabase
          .from("tenant_tokens")
          .update(updateData)
          .eq("tenant_id", tenantId);

        console.log("Tenant tokens updated successfully in database");
      } catch (error) {
        console.error("Failed to update tenant tokens in database:", error);
      }
    });

    return oauth2Client;
  } catch (error: any) {
    console.error("Error getting authorized client:", error);
    throw error;
  }
}


export async function createCalendar(req: Request, res: Response) {
  try {
    const tenantId = req.body.tenantId
    const client = await getAuthorizedClient(tenantId);

    const calendar = google.calendar({ version: "v3", auth: client });
    const newCalendar = await calendar.calendars.insert({
      requestBody: {
        summary: req.body.summary || "New Calendar from App",
        timeZone: req.body.timeZone || "Asia/Jakarta",
        description: req.body.description || "",
      },
    });

    if (newCalendar.data) {
      // FIXED: Use the userId we already have instead of getting from Supabase auth
      const { error: dbError } = await supabase.from("calendars").insert({
        id: newCalendar.data.id,
        summary: newCalendar.data.summary,
        description: newCalendar.data.description,
        time_zone: newCalendar.data.timeZone,
        user_id: tenantId,
        created_at: new Date().toISOString(),
      });

      if (dbError) {
        console.error("Database error:", dbError);
        // Don't throw here, calendar was created successfully in Google
      }
    }

    res.status(201).json(newCalendar.data);
  } catch (error: any) {
    console.error("Error creating calendar:", error);

    // FIXED: Better error responses based on error type
    if (error.message.includes("authenticate") || error.code === 401) {
      res.status(401).json({
        error: "Google authentication required",
        needsAuth: true,
      });
    } else {
      res.status(500).json({
        error: "Failed to create calendar",
        details: error.message
      });
    }
  }
}

// FIXED: New function to get all calendars
export async function getCalendars(req: Request, res: Response) {
  try {
    const tenantId = req.body.tenantId
    const client = await getAuthorizedClient(tenantId);

    const calendar = google.calendar({ version: "v3", auth: client });

    const result = await calendar.calendarList.list({
      showHidden: true,
    });

    const calendars = result.data.items?.map(cal => ({
      id: cal.id,
      summary: cal.summary,
      description: cal.description,
      timeZone: cal.timeZone,
      primary: cal.primary || false,
      selected: cal.selected || false,
      accessRole: cal.accessRole,
      backgroundColor: cal.backgroundColor,
      foregroundColor: cal.foregroundColor,
    })) || [];

    res.json(calendars);
  } catch (error: any) {
    console.error("Error fetching calendars:", error);

    if (error.message.includes("authenticate") || error.code === 401) {
      res.status(401).json({
        error: "Google authentication required",
        needsAuth: true,
      });
    } else {
      res.status(500).json({
        error: "Failed to fetch calendars",
        details: error.message
      });
    }
  }
}

// FIXED: New function to update calendar
export async function updateCalendar(req: Request, res: Response) {
  try {
    const tenantId = req.body.tenantId
    const client = await getAuthorizedClient(tenantId);

    const calendar = google.calendar({ version: "v3", auth: client });
    const { calendarId } = req.params;

    const {
      summary,
      description,
      timeZone,
      location,
      hidden,
      selected
    } = req.body;

    const updateData: any = {};

    if (summary !== undefined) updateData.summary = summary;
    if (description !== undefined) updateData.description = description;
    if (timeZone !== undefined) updateData.timeZone = timeZone;
    if (location !== undefined) updateData.location = location;
    if (hidden !== undefined) updateData.hidden = hidden;
    if (selected !== undefined) updateData.selected = selected;

    const result = await calendar.calendars.update({
      calendarId,
      requestBody: updateData,
    });

    // Update in database
    try {
      const dbUpdateData: any = {
        updated_at: new Date().toISOString(),
      };

      if (summary !== undefined) dbUpdateData.summary = summary;
      if (description !== undefined) dbUpdateData.description = description;
      if (timeZone !== undefined) dbUpdateData.time_zone = timeZone;

      await supabase.from("calendars")
        .update(dbUpdateData)
        .eq("id", calendarId)
        .eq("user_id", tenantId);
    } catch (dbError) {
      console.error("Database update error:", dbError);
    }

    res.json(result.data);
  } catch (error: any) {
    console.error("Error updating calendar:", error);

    if (error.message.includes("authenticate") || error.code === 401) {
      res.status(401).json({
        error: "Google authentication required",
        needsAuth: true,
      });
    } else if (error.code === 404) {
      res.status(404).json({ error: "Calendar not found" });
    } else {
      res.status(500).json({
        error: "Failed to update calendar",
        details: error.message
      });
    }
  }
}

// FIXED: New function to delete calendar
export async function deleteCalendar(req: Request, res: Response) {
  try {
    const tenantId = req.body.tenantId
    const client = await getAuthorizedClient(tenantId);

    const calendar = google.calendar({ version: "v3", auth: client });
    const { calendarId } = req.params;

    // Don't allow deleting primary calendar
    if (calendarId === "primary") {
      return res.status(400).json({
        error: "Cannot delete primary calendar"
      });
    }

    await calendar.calendars.delete({
      calendarId,
    });

    // Delete from database
    try {
      await supabase.from("calendars")
        .delete()
        .eq("id", calendarId)
        .eq("user_id", tenantId);
    } catch (dbError) {
      console.error("Database delete error:", dbError);
    }

    res.status(204).send();
  } catch (error: any) {
    console.error("Error deleting calendar:", error);

    if (error.message.includes("authenticate") || error.code === 401) {
      res.status(401).json({
        error: "Google authentication required",
        needsAuth: true,
      });
    } else if (error.code === 404) {
      res.status(404).json({ error: "Calendar not found" });
    } else {
      res.status(500).json({
        error: "Failed to delete calendar",
        details: error.message
      });
    }
  }
}

