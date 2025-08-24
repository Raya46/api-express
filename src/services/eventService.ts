import { google } from "googleapis";
import { supabase } from "../config/supabase";

export interface EventData {
  summary: string;
  description?: string;
  start: string | { dateTime: string; timeZone?: string };
  end: string | { dateTime: string; timeZone?: string };
  location?: string;
  attendees?: string[];
  reminders?: any;
  visibility?: string;
  timeZone?: string;
}

export interface RecurringEventData extends EventData {
  frequency?: string;
  interval?: number;
  count?: number;
  until?: string;
  byDay?: string[];
}

export class EventService {
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

  // Helper function to normalize attendees
  private static normalizeAttendees(attendees: any): string[] | undefined {
    if (!attendees) return undefined;

    // If it's an empty string, return undefined
    if (attendees === "" || attendees === null) return undefined;

    // If it's already an array, return it
    if (Array.isArray(attendees)) {
      return attendees.filter(email => email && email.trim() !== "");
    }

    // If it's a string, try to parse it
    if (typeof attendees === "string") {
      // Try to parse as JSON first
      try {
        const parsed = JSON.parse(attendees);
        if (Array.isArray(parsed)) {
          return parsed.filter(email => email && email.trim() !== "");
        }
      } catch (e) {
        // Not JSON, treat as comma-separated string
        const emails = attendees.split(",").map(email => email.trim()).filter(email => email !== "");
        return emails.length > 0 ? emails : undefined;
      }
    }

    return undefined;
  }

  // Helper function to normalize reminders
  private static normalizeReminders(reminders: any) {
    if (!reminders || reminders === "" || reminders === null) {
      return { useDefault: true };
    }

    if (Array.isArray(reminders)) {
      return {
        useDefault: false,
        overrides: reminders
      };
    }

    if (typeof reminders === "string") {
      try {
        const parsed = JSON.parse(reminders);
        if (Array.isArray(parsed)) {
          return {
            useDefault: false,
            overrides: parsed
          };
        }
      } catch (e) {
        // Invalid JSON, use default
      }
    }

    return { useDefault: true };
  }

  // Enhanced validation method
  private static validateEventData(eventData: EventData): string[] {
    const errors: string[] = [];

    if (!eventData.summary?.trim()) {
      errors.push("summary is required and cannot be empty");
    }

    if (!eventData.start) {
      errors.push("start time is required");
    }

    if (!eventData.end) {
      errors.push("end time is required");
    }

    return errors;
  }

  // Extract datetime string from various input formats
  private static extractDateTime(timeInput: string | { dateTime: string; timeZone?: string }): string {
    if (typeof timeInput === 'string') {
      return timeInput;
    } else if (timeInput && typeof timeInput === 'object' && timeInput.dateTime) {
      return timeInput.dateTime;
    }
    throw new Error("Invalid time format");
  }

  // Validate ISO datetime format
  private static isValidISODateTime(dateTime: string): boolean {
    try {
      const date = new Date(dateTime);
      return date instanceof Date && !isNaN(date.getTime()) && dateTime.includes('T');
    } catch {
      return false;
    }
  }

  // Enhanced database save with retry logic
  private static async saveEventToDatabase(eventData: any, calendarId: string, tenantId: string, attendees: string[] | undefined) {
    try {
      const { error } = await supabase.from("events").insert({
        id: eventData.id,
        summary: eventData.summary,
        description: eventData.description || null,
        start_time: eventData.start?.dateTime,
        end_time: eventData.end?.dateTime,
        location: eventData.location || null,
        calendar_id: calendarId,
        user_id: tenantId,
        status: eventData.status,
        attendees: attendees && attendees.length > 0 ? JSON.stringify(attendees) : null,
        html_link: eventData.htmlLink,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (error) {
        console.error("Database save error:", error);
        // Could implement retry logic here if needed
      }
    } catch (dbError) {
      console.error("Database save error:", dbError);
      // Don't fail the request if DB save fails
    }
  }

  static async createEvent(tenantId: string, eventData: EventData, calendarId: string = "primary") {
    try {
      const client = await this.getAuthorizedClient(tenantId);
      const calendar = google.calendar({ version: "v3", auth: client });

      // Enhanced validation with better error messages
      const validationErrors = this.validateEventData(eventData);
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }

      // Normalize and extract datetime values
      const startDateTime = this.extractDateTime(eventData.start);
      const endDateTime = this.extractDateTime(eventData.end);
      const defaultTimeZone = eventData.timeZone || "Asia/Jakarta";

      // Validate datetime format
      if (!this.isValidISODateTime(startDateTime) || !this.isValidISODateTime(endDateTime)) {
        throw new Error("Invalid datetime format. Use ISO 8601 format (YYYY-MM-DDTHH:mm:ss+07:00)");
      }

      // Validate start < end
      if (new Date(startDateTime) >= new Date(endDateTime)) {
        throw new Error("End time must be after start time");
      }

      // Normalize attendees and reminders
      const attendees = this.normalizeAttendees(eventData.attendees);
      const reminders = this.normalizeReminders(eventData.reminders);

      // Build event object with proper structure
      const event: any = {
        summary: eventData.summary.trim(),
        start: {
          dateTime: startDateTime,
          timeZone: defaultTimeZone,
        },
        end: {
          dateTime: endDateTime,
          timeZone: defaultTimeZone,
        },
        reminders,
        visibility: eventData.visibility || "default",
      };

      // Add optional fields only if they have valid values
      if (eventData.description?.trim()) {
        event.description = eventData.description.trim();
      }

      if (eventData.location?.trim()) {
        event.location = eventData.location.trim();
      }

      if (attendees && attendees.length > 0) {
        event.attendees = attendees.map((email: string) => ({ email: email.trim() }));
      }

      console.log("Creating event with payload:", JSON.stringify(event, null, 2));

      const result = await calendar.events.insert({
        calendarId,
        requestBody: event,
        sendUpdates: attendees && attendees.length > 0 ? "all" : "none",
      });

      // Enhanced database save with better error handling
      await this.saveEventToDatabase(result.data, calendarId, tenantId, attendees);

      return {
        id: result.data.id,
        summary: result.data.summary,
        description: result.data.description,
        start: result.data.start,
        end: result.data.end,
        location: result.data.location,
        status: result.data.status,
        htmlLink: result.data.htmlLink,
        created: result.data.created,
        updated: result.data.updated
      };
    } catch (error: any) {
      console.error("Error creating event:", error);

      // Enhanced error handling with specific error types
      if (error.code === 400) {
        throw new Error(`Google Calendar API error: ${error.message}`);
      } else if (error.code === 401 || error.code === 403) {
        throw new Error("Google authentication required or insufficient permissions");
      } else if (error.message.includes("Validation failed")) {
        throw error; // Re-throw validation errors as-is
      } else {
        throw new Error(`Failed to create event: ${error.message}`);
      }
    }
  }

  static async updateEvent(tenantId: string, eventId: string, eventData: Partial<EventData>, calendarId: string = "primary") {
    try {
      const client = await this.getAuthorizedClient(tenantId);
      const calendar = google.calendar({ version: "v3", auth: client });

      const eventUpdate: any = {};

      if (eventData.summary) eventUpdate.summary = eventData.summary;
      if (eventData.description !== undefined) {
        eventUpdate.description = eventData.description?.trim() !== "" ? eventData.description : "";
      }
      if (eventData.location !== undefined) eventUpdate.location = eventData.location;
      if (eventData.start) {
        eventUpdate.start = { dateTime: eventData.start, timeZone: eventData.timeZone || "Asia/Jakarta" };
      }
      if (eventData.end) {
        eventUpdate.end = { dateTime: eventData.end, timeZone: eventData.timeZone || "Asia/Jakarta" };
      }

      // Handle attendees properly
      if (eventData.attendees !== undefined) {
        const attendees = this.normalizeAttendees(eventData.attendees);
        if (attendees && attendees.length > 0) {
          eventUpdate.attendees = attendees.map((email: string) => ({ email }));
        } else {
          eventUpdate.attendees = [];
        }
      }

      // Handle reminders properly
      if (eventData.reminders !== undefined) {
        eventUpdate.reminders = this.normalizeReminders(eventData.reminders);
      }

      if (eventData.visibility) eventUpdate.visibility = eventData.visibility;

      const result = await calendar.events.update({
        calendarId,
        eventId,
        requestBody: eventUpdate,
        sendUpdates: eventUpdate.attendees && eventUpdate.attendees.length > 0 ? "all" : "none",
      });

      // Update in database
      try {
        const updateData: any = {
          updated_at: new Date().toISOString(),
        };

        if (eventData.summary) updateData.summary = eventData.summary;
        if (eventData.description !== undefined) updateData.description = eventData.description;
        if (eventData.location !== undefined) updateData.location = eventData.location;
        if (eventData.start) updateData.start_time = eventData.start;
        if (eventData.end) updateData.end_time = eventData.end;
        if (eventData.attendees !== undefined) {
          const attendees = this.normalizeAttendees(eventData.attendees);
          updateData.attendees = attendees && attendees.length > 0 ? JSON.stringify(attendees) : null;
        }

        await supabase.from("events")
          .update(updateData)
          .eq("id", eventId)
          .eq("user_id", tenantId);
      } catch (dbError) {
        console.error("Database update error:", dbError);
      }

      return result.data;
    } catch (error: any) {
      console.error("Error updating event:", error);
      throw error;
    }
  }

  static async deleteEvent(tenantId: string, eventId: string, calendarId: string = "primary") {
    try {
      const client = await this.getAuthorizedClient(tenantId);
      const calendar = google.calendar({ version: "v3", auth: client });

      await calendar.events.delete({
        calendarId,
        eventId,
        sendUpdates: "all",
      });

      // Delete from database
      try {
        await supabase.from("events")
          .delete()
          .eq("id", eventId)
          .eq("user_id", tenantId);
      } catch (dbError) {
        console.error("Database delete error:", dbError);
      }

      return { success: true, message: "Event deleted successfully" };
    } catch (error: any) {
      console.error("Error deleting event:", error);
      throw error;
    }
  }

  static async getEvent(tenantId: string, eventId: string, calendarId: string = "primary") {
    try {
      const client = await this.getAuthorizedClient(tenantId);
      const calendar = google.calendar({ version: "v3", auth: client });

      const result = await calendar.events.get({
        calendarId,
        eventId,
      });

      const event = result.data;
      const formattedEvent = {
        id: event.id,
        summary: event.summary,
        description: event.description,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        location: event.location,
        status: event.status,
        attendees: event.attendees?.map(attendee => ({
          email: attendee.email,
          responseStatus: attendee.responseStatus,
          displayName: attendee.displayName
        })),
        creator: event.creator,
        organizer: event.organizer,
        htmlLink: event.htmlLink,
        reminders: event.reminders,
        visibility: event.visibility,
      };

      return formattedEvent;
    } catch (error: any) {
      console.error("Error fetching event:", error);
      throw error;
    }
  }

  static async getEvents(tenantId: string, calendarId: string = "primary", queryParams?: any) {
    try {
      const client = await this.getAuthorizedClient(tenantId);
      const calendar = google.calendar({ version: "v3", auth: client });

      const params: any = {
        calendarId,
        maxResults: queryParams?.maxResults || 250,
        singleEvents: queryParams?.singleEvents !== false,
        orderBy: queryParams?.orderBy || "startTime",
      };

      if (queryParams?.timeMin) params.timeMin = queryParams.timeMin;
      if (queryParams?.timeMax) params.timeMax = queryParams.timeMax;
      if (queryParams?.q) params.q = queryParams.q;
      if (queryParams?.updatedMin) params.updatedMin = queryParams.updatedMin;

      const result = await calendar.events.list(params);

      const events = result.data.items?.map(event => ({
        id: event.id,
        summary: event.summary,
        description: event.description,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        location: event.location,
        status: event.status,
        attendees: event.attendees?.map(attendee => ({
          email: attendee.email,
          responseStatus: attendee.responseStatus,
          displayName: attendee.displayName
        })),
        creator: event.creator,
        organizer: event.organizer,
        htmlLink: event.htmlLink,
        reminders: event.reminders,
        visibility: event.visibility,
        recurringEventId: event.recurringEventId,
        originalStartTime: event.originalStartTime,
      })) || [];

      return {
        events,
        total: events.length,
        timeZone: result.data.timeZone,
        nextPageToken: result.data.nextPageToken,
        nextSyncToken: result.data.nextSyncToken,
      };
    } catch (error: any) {
      console.error("Error fetching calendar events:", error);
      throw error;
    }
  }

  static async getFreeBusyInfo(tenantId: string, timeMin: string, timeMax: string, calendarIds: string[] = ["primary"]) {
    try {
      const client = await this.getAuthorizedClient(tenantId);
      const calendar = google.calendar({ version: "v3", auth: client });

      if (!timeMin || !timeMax) {
        throw new Error("timeMin and timeMax are required");
      }

      const freeBusyQuery = {
        timeMin,
        timeMax,
        items: calendarIds.map(id => ({ id }))
      };

      const result = await calendar.freebusy.query({
        requestBody: freeBusyQuery
      });

      return result.data;
    } catch (error: any) {
      console.error("Error fetching free/busy info:", error);
      throw error;
    }
  }

  static async getAvailableTimeSlots(tenantId: string, date: string, options: {
    startTime?: string;
    endTime?: string;
    duration?: string;
    calendarId?: string;
  } = {}) {
    try {
      const client = await this.getAuthorizedClient(tenantId);
      const calendar = google.calendar({ version: "v3", auth: client });

      const {
        startTime = "09:00",
        endTime = "17:00",
        duration = "60",
        calendarId = "primary"
      } = options;

      if (!date) {
        throw new Error("Date parameter is required");
      }

      const startOfDay = new Date(`${date}T${startTime}:00`);
      const endOfDay = new Date(`${date}T${endTime}:00`);

      // Get existing events for the day
      const events = await calendar.events.list({
        calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
      });

      const busySlots = events.data.items?.map(event => ({
        start: new Date(event.start?.dateTime || event.start?.date || ''),
        end: new Date(event.end?.dateTime || event.end?.date || ''),
      })) || [];

      // Generate available slots
      const availableSlots = [];
      const slotDuration = parseInt(duration) * 60000; // Convert to milliseconds
      let currentTime = new Date(startOfDay);

      while (currentTime.getTime() + slotDuration <= endOfDay.getTime()) {
        const slotEnd = new Date(currentTime.getTime() + slotDuration);

        const isAvailable = !busySlots.some(busy =>
          (currentTime >= busy.start && currentTime < busy.end) ||
          (slotEnd > busy.start && slotEnd <= busy.end) ||
          (currentTime <= busy.start && slotEnd >= busy.end)
        );

        if (isAvailable) {
          availableSlots.push({
            start: currentTime.toTimeString().slice(0, 5),
            end: slotEnd.toTimeString().slice(0, 5),
            startDateTime: currentTime.toISOString(),
            endDateTime: slotEnd.toISOString(),
          });
        }

        // Move to next slot (15-minute intervals)
        currentTime = new Date(currentTime.getTime() + (15 * 60000));
      }

      return {
        date,
        availableSlots,
        total: availableSlots.length,
        busySlots: busySlots.length
      };
    } catch (error: any) {
      console.error("Error getting available time slots:", error);
      throw error;
    }
  }

  static async createRecurringEvent(tenantId: string, eventData: RecurringEventData, calendarId: string = "primary") {
    try {
      const client = await this.getAuthorizedClient(tenantId);
      const calendar = google.calendar({ version: "v3", auth: client });

      if (!eventData.summary || !eventData.start || !eventData.end) {
        throw new Error("Missing required fields: summary, start, end");
      }

      // Handle attendees properly
      const attendees = this.normalizeAttendees(eventData.attendees);

      let recurrenceRule = `FREQ=${eventData.frequency || 'WEEKLY'};INTERVAL=${eventData.interval || 1}`;

      if (eventData.count) recurrenceRule += `;COUNT=${eventData.count}`;
      if (eventData.until) recurrenceRule += `;UNTIL=${new Date(eventData.until).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
      if (eventData.byDay && eventData.frequency === 'WEEKLY') recurrenceRule += `;BYDAY=${eventData.byDay.join(',')}`;

      const eventResource: any = {
        summary: eventData.summary,
        location: eventData.location,
        start: {
          dateTime: eventData.start,
          timeZone: eventData.timeZone || "Asia/Jakarta",
        },
        end: {
          dateTime: eventData.end,
          timeZone: eventData.timeZone || "Asia/Jakarta",
        },
        recurrence: [`RRULE:${recurrenceRule}`],
      };

      // Only add description if it's not empty
      if (eventData.description && eventData.description.trim() !== "") {
        eventResource.description = eventData.description;
      }

      // Only add attendees if there are any
      if (attendees && attendees.length > 0) {
        eventResource.attendees = attendees.map((email: string) => ({ email }));
      }

      const result = await calendar.events.insert({
        calendarId,
        requestBody: eventResource,
        sendUpdates: attendees && attendees.length > 0 ? "all" : "none",
      });

      // Save to database with recurrence info
      try {
        await supabase.from("events").insert({
          id: result.data.id,
          summary: result.data.summary,
          description: result.data.description,
          start_time: result.data.start?.dateTime,
          end_time: result.data.end?.dateTime,
          location: result.data.location,
          calendar_id: calendarId,
          user_id: tenantId,
          status: result.data.status,
          attendees: attendees && attendees.length > 0 ? JSON.stringify(attendees) : null,
          recurrence: recurrenceRule,
          created_at: new Date().toISOString(),
        });
      } catch (dbError) {
        console.error("Database save error:", dbError);
      }

      return result.data;
    } catch (error: any) {
      console.error("Error creating recurring event:", error);
      throw error;
    }
  }
}