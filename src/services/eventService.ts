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

  private static normalizeAttendees(attendees: any): string[] | undefined {
    if (!attendees) return undefined;

    // If it's an empty string or null, return undefined
    if (attendees === "" || attendees === null || attendees === undefined) return undefined;

    // If it's already an array, filter and validate emails
    if (Array.isArray(attendees)) {
      const validEmails = attendees
        .filter(email => email && typeof email === 'string' && email.trim() !== "")
        .map(email => email.trim())
        .filter(email => this.isValidEmail(email));
      return validEmails.length > 0 ? validEmails : undefined;
    }

    // If it's a string, try to parse it
    if (typeof attendees === "string") {
      const trimmed = attendees.trim();
      if (trimmed === "") return undefined;

      // Try to parse as JSON first
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const validEmails = parsed
            .filter(email => email && typeof email === 'string' && email.trim() !== "")
            .map(email => email.trim())
            .filter(email => this.isValidEmail(email));
          return validEmails.length > 0 ? validEmails : undefined;
        }
      } catch (e) {
        // Not JSON, treat as comma-separated string
        const emails = trimmed
          .split(",")
          .map(email => email.trim())
          .filter(email => email !== "" && this.isValidEmail(email));
        return emails.length > 0 ? emails : undefined;
      }
    }

    return undefined;
  }

  private static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private static normalizeReminders(reminders: any) {
    // Handle null, undefined, or empty string
    if (!reminders || reminders === "" || reminders === null) {
      return { useDefault: true };
    }

    if (typeof reminders === 'object' && !Array.isArray(reminders)) {
      if (reminders.useDefault !== undefined || reminders.overrides !== undefined) {
        return reminders;
      }
    }

    // If it's an array of reminder objects
    if (Array.isArray(reminders)) {
      const validReminders = reminders.filter(reminder => 
        reminder && 
        typeof reminder === 'object' && 
        reminder.method && 
        typeof reminder.minutes === 'number'
      );
      
      return validReminders.length > 0 ? {
        useDefault: false,
        overrides: validReminders
      } : { useDefault: true };
    }

    // If it's a JSON string
    if (typeof reminders === "string") {
      const trimmed = reminders.trim();
      if (trimmed === "") return { useDefault: true };

      try {
        const parsed = JSON.parse(trimmed);
        
        // If parsed result is an array
        if (Array.isArray(parsed)) {
          const validReminders = parsed.filter(reminder => 
            reminder && 
            typeof reminder === 'object' && 
            reminder.method && 
            typeof reminder.minutes === 'number'
          );
          
          return validReminders.length > 0 ? {
            useDefault: false,
            overrides: validReminders
          } : { useDefault: true };
        }
        
        // If parsed result is an object
        if (typeof parsed === 'object' && parsed !== null) {
          if (parsed.useDefault !== undefined || parsed.overrides !== undefined) {
            return parsed;
          }
        }
      } catch (e) {
        console.warn("Invalid reminders JSON format:", e);
      }
    }

    return { useDefault: true };
  }

  private static validateEventData(eventData: EventData): string[] {
    const errors: string[] = [];

    // Validate summary
    if (!eventData.summary?.trim()) {
      errors.push("summary is required and cannot be empty");
    } else if (eventData.summary.trim().length > 1024) {
      errors.push("summary cannot exceed 1024 characters");
    }

    // Validate start time
    if (!eventData.start) {
      errors.push("start time is required");
    }

    // Validate end time
    if (!eventData.end) {
      errors.push("end time is required");
    }

    // Validate description length if provided
    if (eventData.description && eventData.description.length > 8192) {
      errors.push("description cannot exceed 8192 characters");
    }

    // Validate location length if provided
    if (eventData.location && eventData.location.length > 1024) {
      errors.push("location cannot exceed 1024 characters");
    }

    return errors;
  }

  private static extractDateTime(timeInput: string | { dateTime: string; timeZone?: string }): string {
    if (typeof timeInput === 'string') {
      return timeInput.trim();
    } else if (timeInput && typeof timeInput === 'object' && timeInput.dateTime) {
      return timeInput.dateTime.trim();
    }
    throw new Error("Invalid time format - expected string or object with dateTime property");
  }

  private static isValidISODateTime(dateTime: string): boolean {
    try {
      // Check if string contains 'T' separator
      if (!dateTime.includes('T')) {
        return false;
      }

      const date = new Date(dateTime);
      
      // Check if date is valid
      if (!(date instanceof Date) || isNaN(date.getTime())) {
        return false;
      }

      // Check if it's in ISO format (basic validation)
      const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)?$/;
      return isoRegex.test(dateTime);
    } catch {
      return false;
    }
  }

  private static async saveEventToDatabase(eventData: any, calendarId: string, tenantId: string, attendees: string[] | undefined) {
    try {
      const insertData = {
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
      };

      const { error } = await supabase.from("events").insert(insertData);

      if (error) {
        console.error("Database save error:", error);
        
        // If it's a duplicate key error, try to update instead
        if (error.code === '23505') { // PostgreSQL unique violation
          console.log("Event already exists, attempting to update...");
          const { error: updateError } = await supabase
            .from("events")
            .update({
              ...insertData,
              created_at: undefined, // Don't update created_at
            })
            .eq("id", eventData.id)
            .eq("user_id", tenantId);
          
          if (updateError) {
            console.error("Database update after duplicate error:", updateError);
          }
        }
      } else {
        console.log("Event saved to database successfully");
      }
    } catch (dbError) {
      console.error("Database save error:", dbError);
      // Don't fail the request if DB save fails
    }
  }

  // ✅ MAIN CREATE EVENT METHOD - Enhanced with better error messages
  static async createEvent(tenantId: string, eventData: EventData, calendarId: string = "primary") {
    try {
      console.log("Creating event - Input data:", JSON.stringify(eventData, null, 2));
      
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

      console.log("Extracted datetimes:", { startDateTime, endDateTime, defaultTimeZone });

      // Validate datetime format
      if (!this.isValidISODateTime(startDateTime)) {
        throw new Error(`Invalid start datetime format: "${startDateTime}". Use ISO 8601 format (YYYY-MM-DDTHH:mm:ss+07:00)`);
      }
      
      if (!this.isValidISODateTime(endDateTime)) {
        throw new Error(`Invalid end datetime format: "${endDateTime}". Use ISO 8601 format (YYYY-MM-DDTHH:mm:ss+07:00)`);
      }

      // Validate start < end
      const startDate = new Date(startDateTime);
      const endDate = new Date(endDateTime);
      
      if (startDate >= endDate) {
        throw new Error(`End time (${endDateTime}) must be after start time (${startDateTime})`);
      }

      // Normalize attendees and reminders
      const attendees = this.normalizeAttendees(eventData.attendees);
      const reminders = this.normalizeReminders(eventData.reminders);

      console.log("Normalized data:", { attendees, reminders });

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

      console.log("Final event payload:", JSON.stringify(event, null, 2));

      const result = await calendar.events.insert({
        calendarId,
        requestBody: event,
        sendUpdates: attendees && attendees.length > 0 ? "all" : "none",
      });

      console.log("Event created successfully:", result.data.id);

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
        updated: result.data.updated,
        attendees: result.data.attendees
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
      } else if (error.message.includes("Invalid") && error.message.includes("datetime")) {
        throw error; // Re-throw datetime validation errors as-is
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

      if (eventData.summary?.trim()) {
        eventUpdate.summary = eventData.summary.trim();
      }
      
      if (eventData.description !== undefined) {
        eventUpdate.description = eventData.description?.trim() || "";
      }
      
      if (eventData.location !== undefined) {
        eventUpdate.location = eventData.location?.trim() || "";
      }
      
      if (eventData.start) {
        const startDateTime = this.extractDateTime(eventData.start);
        if (!this.isValidISODateTime(startDateTime)) {
          throw new Error(`Invalid start datetime format: "${startDateTime}"`);
        }
        eventUpdate.start = { 
          dateTime: startDateTime, 
          timeZone: eventData.timeZone || "Asia/Jakarta" 
        };
      }
      
      if (eventData.end) {
        const endDateTime = this.extractDateTime(eventData.end);
        if (!this.isValidISODateTime(endDateTime)) {
          throw new Error(`Invalid end datetime format: "${endDateTime}"`);
        }
        eventUpdate.end = { 
          dateTime: endDateTime, 
          timeZone: eventData.timeZone || "Asia/Jakarta" 
        };
      }

      // Validate start < end if both are provided
      if (eventUpdate.start && eventUpdate.end) {
        const startDate = new Date(eventUpdate.start.dateTime);
        const endDate = new Date(eventUpdate.end.dateTime);
        
        if (startDate >= endDate) {
          throw new Error("End time must be after start time");
        }
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

      if (eventData.visibility) {
        eventUpdate.visibility = eventData.visibility;
      }

      console.log("Updating event with payload:", JSON.stringify(eventUpdate, null, 2));

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

        if (eventData.summary?.trim()) updateData.summary = eventData.summary.trim();
        if (eventData.description !== undefined) updateData.description = eventData.description?.trim() || null;
        if (eventData.location !== undefined) updateData.location = eventData.location?.trim() || null;
        if (eventData.start) {
          updateData.start_time = this.extractDateTime(eventData.start);
        }
        if (eventData.end) {
          updateData.end_time = this.extractDateTime(eventData.end);
        }
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
      
      if (error.message.includes("Invalid") && error.message.includes("datetime")) {
        throw error; // Re-throw datetime validation errors as-is
      }
      
      throw new Error(`Failed to update event: ${error.message}`);
    }
  }

  // ✅ REST OF THE METHODS REMAIN THE SAME (keeping them for completeness)
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

  static async createRecurringEvent(tenantId: string, eventData: RecurringEventData, calendarId: string = "primary") {
    try {
      const client = await this.getAuthorizedClient(tenantId);
      const calendar = google.calendar({ version: "v3", auth: client });

      // Enhanced validation
      const validationErrors = this.validateEventData(eventData);
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }

      // Extract and validate datetime
      const startDateTime = this.extractDateTime(eventData.start);
      const endDateTime = this.extractDateTime(eventData.end);

      if (!this.isValidISODateTime(startDateTime) || !this.isValidISODateTime(endDateTime)) {
        throw new Error("Invalid datetime format. Use ISO 8601 format (YYYY-MM-DDTHH:mm:ss+07:00)");
      }

      // Validate start < end
      if (new Date(startDateTime) >= new Date(endDateTime)) {
        throw new Error("End time must be after start time");
      }

      // Handle attendees properly
      const attendees = this.normalizeAttendees(eventData.attendees);

      let recurrenceRule = `FREQ=${eventData.frequency || 'WEEKLY'};INTERVAL=${eventData.interval || 1}`;

      if (eventData.count) recurrenceRule += `;COUNT=${eventData.count}`;
      if (eventData.until) recurrenceRule += `;UNTIL=${new Date(eventData.until).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
      if (eventData.byDay && eventData.frequency === 'WEEKLY') recurrenceRule += `;BYDAY=${eventData.byDay.join(',')}`;

      const eventResource: any = {
        summary: eventData.summary.trim(),
        start: {
          dateTime: startDateTime,
          timeZone: eventData.timeZone || "Asia/Jakarta",
        },
        end: {
          dateTime: endDateTime,
          timeZone: eventData.timeZone || "Asia/Jakarta",
        },
        recurrence: [`RRULE:${recurrenceRule}`],
      };

      // Add optional fields
      if (eventData.description?.trim()) {
        eventResource.description = eventData.description.trim();
      }

      if (eventData.location?.trim()) {
        eventResource.location = eventData.location.trim();
      }

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

  // ✅ OTHER METHODS REMAIN UNCHANGED FOR BREVITY
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
}