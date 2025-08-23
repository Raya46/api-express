import { google } from "googleapis";
import { supabase } from "../config/supabase";

export interface CalendarData {
  summary: string;
  description?: string;
  location?: string;
  timeZone?: string;
}

export class CalendarService {
  private static async getAuthorizedClient(tenantId: string) {
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

  static async createCalendar(tenantId: string, calendarData: CalendarData) {
    try {
      const client = await this.getAuthorizedClient(tenantId);
      const calendar = google.calendar({ version: "v3", auth: client });

      const calendarResource = {
        summary: calendarData.summary,
        description: calendarData.description,
        location: calendarData.location,
        timeZone: calendarData.timeZone || "Asia/Jakarta",
      };

      const result = await calendar.calendars.insert({
        requestBody: calendarResource,
      });

      // Save to database
      try {
        await supabase.from("calendars").insert({
          id: result.data.id,
          summary: result.data.summary,
          description: result.data.description,
          location: result.data.location,
          time_zone: result.data.timeZone,
          user_id: tenantId,
          created_at: new Date().toISOString(),
        });
      } catch (dbError) {
        console.error("Database save error:", dbError);
        // Don't fail the request if DB save fails
      }

      return result.data;
    } catch (error: any) {
      console.error("Error creating calendar:", error);
      throw error;
    }
  }

  static async getCalendars(tenantId: string) {
    try {
      const client = await this.getAuthorizedClient(tenantId);
      const calendar = google.calendar({ version: "v3", auth: client });

      const result = await calendar.calendarList.list();

      const calendars = result.data.items?.map(cal => ({
        id: cal.id,
        summary: cal.summary,
        description: cal.description,
        location: cal.location,
        timeZone: cal.timeZone,
        primary: cal.primary || false,
        accessRole: cal.accessRole,
        backgroundColor: cal.backgroundColor,
        foregroundColor: cal.foregroundColor,
      })) || [];

      return {
        calendars,
        total: calendars.length,
      };
    } catch (error: any) {
      console.error("Error fetching calendars:", error);
      throw error;
    }
  }

  static async updateCalendar(tenantId: string, calendarId: string, calendarData: Partial<CalendarData>) {
    try {
      const client = await this.getAuthorizedClient(tenantId);
      const calendar = google.calendar({ version: "v3", auth: client });

      const calendarResource: any = {};

      if (calendarData.summary) calendarResource.summary = calendarData.summary;
      if (calendarData.description !== undefined) calendarResource.description = calendarData.description;
      if (calendarData.location !== undefined) calendarResource.location = calendarData.location;
      if (calendarData.timeZone) calendarResource.timeZone = calendarData.timeZone;

      const result = await calendar.calendars.update({
        calendarId,
        requestBody: calendarResource,
      });

      // Update in database
      try {
        const updateData: any = {
          updated_at: new Date().toISOString(),
        };

        if (calendarData.summary) updateData.summary = calendarData.summary;
        if (calendarData.description !== undefined) updateData.description = calendarData.description;
        if (calendarData.location !== undefined) updateData.location = calendarData.location;
        if (calendarData.timeZone) updateData.time_zone = calendarData.timeZone;

        await supabase.from("calendars")
          .update(updateData)
          .eq("id", calendarId)
          .eq("user_id", tenantId);
      } catch (dbError) {
        console.error("Database update error:", dbError);
      }

      return result.data;
    } catch (error: any) {
      console.error("Error updating calendar:", error);
      throw error;
    }
  }

  static async deleteCalendar(tenantId: string, calendarId: string) {
    try {
      const client = await this.getAuthorizedClient(tenantId);
      const calendar = google.calendar({ version: "v3", auth: client });

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

      return { success: true, message: "Calendar deleted successfully" };
    } catch (error: any) {
      console.error("Error deleting calendar:", error);
      throw error;
    }
  }

  static async getCalendar(tenantId: string, calendarId: string) {
    try {
      const client = await this.getAuthorizedClient(tenantId);
      const calendar = google.calendar({ version: "v3", auth: client });

      const result = await calendar.calendars.get({
        calendarId,
      });

      const cal = result.data;
      const formattedCalendar = {
        id: cal.id,
        summary: cal.summary,
        description: cal.description,
        location: cal.location,
        timeZone: cal.timeZone,
      };

      return formattedCalendar;
    } catch (error: any) {
      console.error("Error fetching calendar:", error);
      throw error;
    }
  }
}