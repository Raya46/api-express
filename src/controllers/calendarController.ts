import { Request, Response } from "express";
import { google } from "googleapis";
import { supabase } from "../config/supabase";
import { AuthController } from "./authController";

// FIXED: Multi-tenant function to get authorized client with proper error handling
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

    // Create a new OAuth2 client instance for each request
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

    // Set up automatic token refresh handler
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

// FIXED: Helper function to get tenant ID from request
function getTenantId(req: Request): string {
  const tenantId = req.tenantId;
  if (!tenantId) {
    throw new Error("Tenant not identified");
  }
  return tenantId;
}

export async function createCalendar(req: Request, res: Response) {
  try {
    const tenantId = getTenantId(req);
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

export async function getCalendarEvents(req: Request, res: Response) {
  try {
    const tenantId = getTenantId(req);
    const client = await getAuthorizedClient(tenantId);
    
    const calendar = google.calendar({ version: "v3", auth: client });
    
    // FIXED: Better parameter handling
    const {
      calendarId = "primary",
      maxResults = "15",
      timeMin,
      timeMax,
      singleEvents = "true",
      orderBy = "startTime"
    } = req.query;

    const queryParams: any = {
      calendarId: calendarId as string,
      timeMin: timeMin as string || new Date().toISOString(),
      maxResults: parseInt(maxResults as string),
      singleEvents: singleEvents === "true",
      orderBy: orderBy as string,
    };

    if (timeMax) {
      queryParams.timeMax = timeMax as string;
    }

    const eventList = await calendar.events.list(queryParams);

    const events = eventList.data.items;
    if (events && events.length) {
      const mappedEvents = events.map((event) => ({
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
      }));
      res.json({ events: mappedEvents, total: mappedEvents.length });
    } else {
      res.json({ events: [], total: 0, message: "No events found." });
    }
  } catch (error: any) {
    console.error("Error fetching events:", error);
    
    if (error.message.includes("authenticate") || error.code === 401) {
      res.status(401).json({ 
        error: "Google authentication required", 
        needsAuth: true,
      });
    } else {
      res.status(500).json({ 
        error: "Failed to fetch events",
        details: error.message 
      });
    }
  }
}

export async function getCalendars(req: Request, res: Response) {
  try {
    const tenantId = getTenantId(req);
    const client = await getAuthorizedClient(tenantId);
    
    const calendar = google.calendar({ version: "v3", auth: client });
    const calendarList = await calendar.calendarList.list();
    
    // FIXED: Better response formatting
    const calendars = calendarList.data.items?.map(cal => ({
      id: cal.id,
      summary: cal.summary,
      description: cal.description,
      timeZone: cal.timeZone,
      accessRole: cal.accessRole,
      primary: cal.primary,
      backgroundColor: cal.backgroundColor,
      foregroundColor: cal.foregroundColor,
    })) || [];

    res.json({ calendars, total: calendars.length });
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

export async function createCalendarEvent(req: Request, res: Response) {
  try {
    const tenantId = getTenantId(req);
    const client = await getAuthorizedClient(tenantId);
    
    const calendar = google.calendar({ version: "v3", auth: client });

    const {
      summary,
      description,
      start,
      end,
      location,
      attendees,
      reminders,
      visibility = "default",
      timeZone = "Asia/Jakarta"
    } = req.body;

    // FIXED: Validate required fields
    if (!summary || !start || !end) {
      return res.status(400).json({
        error: "Missing required fields: summary, start, end"
      });
    }

    const event = {
      summary,
      description,
      location,
      start: {
        dateTime: start,
        timeZone,
      },
      end: {
        dateTime: end,
        timeZone,
      },
      attendees: attendees?.map((email: string) => ({ email })),
      reminders: reminders ? {
        useDefault: false,
        overrides: reminders
      } : { useDefault: true },
      visibility,
    };

    const calendarId = req.params.calendarId || "primary";
    const result = await calendar.events.insert({
      calendarId,
      requestBody: event,
      sendUpdates: "all", // Send notifications to attendees
    });

    // FIXED: Save to database
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
        attendees: attendees ? JSON.stringify(attendees) : null,
        created_at: new Date().toISOString(),
      });
    } catch (dbError) {
      console.error("Database save error:", dbError);
      // Don't fail the request if DB save fails
    }

    res.status(201).json(result.data);
  } catch (error: any) {
    console.error("Error creating event:", error);
    
    if (error.message.includes("authenticate") || error.code === 401) {
      res.status(401).json({ 
        error: "Google authentication required", 
        needsAuth: true,
      });
    } else {
      res.status(500).json({ 
        error: "Failed to create event",
        details: error.message 
      });
    }
  }
}

// FIXED: New function to update calendar event
export async function updateCalendarEvent(req: Request, res: Response) {
  try {
    const tenantId = getTenantId(req);
    const client = await getAuthorizedClient(tenantId);
    
    const calendar = google.calendar({ version: "v3", auth: client });
    const { eventId } = req.params;
    const calendarId = req.params.calendarId || "primary";

    const {
      summary,
      description,
      start,
      end,
      location,
      attendees,
      reminders,
      visibility,
      timeZone = "Asia/Jakarta"
    } = req.body;

    const eventUpdate: any = {};
    
    if (summary) eventUpdate.summary = summary;
    if (description !== undefined) eventUpdate.description = description;
    if (location !== undefined) eventUpdate.location = location;
    if (start) {
      eventUpdate.start = { dateTime: start, timeZone };
    }
    if (end) {
      eventUpdate.end = { dateTime: end, timeZone };
    }
    if (attendees) {
      eventUpdate.attendees = attendees.map((email: string) => ({ email }));
    }
    if (reminders) {
      eventUpdate.reminders = {
        useDefault: false,
        overrides: reminders
      };
    }
    if (visibility) eventUpdate.visibility = visibility;

    const result = await calendar.events.update({
      calendarId,
      eventId,
      requestBody: eventUpdate,
      sendUpdates: "all",
    });

    // Update in database
    try {
      const updateData: any = {
        updated_at: new Date().toISOString(),
      };

      if (summary) updateData.summary = summary;
      if (description !== undefined) updateData.description = description;
      if (location !== undefined) updateData.location = location;
      if (start) updateData.start_time = start;
      if (end) updateData.end_time = end;
      if (attendees) updateData.attendees = JSON.stringify(attendees);

      await supabase.from("events")
        .update(updateData)
        .eq("id", eventId)
        .eq("user_id", tenantId);
    } catch (dbError) {
      console.error("Database update error:", dbError);
    }

    res.json(result.data);
  } catch (error: any) {
    console.error("Error updating event:", error);
    
    if (error.message.includes("authenticate") || error.code === 401) {
      res.status(401).json({ 
        error: "Google authentication required", 
        needsAuth: true,
      });
    } else {
      res.status(500).json({ 
        error: "Failed to update event",
        details: error.message 
      });
    }
  }
}

// FIXED: New function to delete calendar event
export async function deleteCalendarEvent(req: Request, res: Response) {
  try {
    const tenantId = getTenantId(req);
    const client = await getAuthorizedClient(tenantId);
    
    const calendar = google.calendar({ version: "v3", auth: client });
    const { eventId } = req.params;
    const calendarId = req.params.calendarId || "primary";

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

    res.status(204).send();
  } catch (error: any) {
    console.error("Error deleting event:", error);
    
    if (error.message.includes("authenticate") || error.code === 401) {
      res.status(401).json({ 
        error: "Google authentication required", 
        needsAuth: true,
      });
    } else {
      res.status(500).json({ 
        error: "Failed to delete event",
        details: error.message 
      });
    }
  }
}

// FIXED: New function to get single event
export async function getCalendarEvent(req: Request, res: Response) {
  try {
    const tenantId = getTenantId(req);
    const client = await getAuthorizedClient(tenantId);
    
    const calendar = google.calendar({ version: "v3", auth: client });
    const { eventId } = req.params;
    const calendarId = req.params.calendarId || req.query.calendarId as string || "primary";

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

    res.json(formattedEvent);
  } catch (error: any) {
    console.error("Error fetching event:", error);
    
    if (error.message.includes("authenticate") || error.code === 401) {
      res.status(401).json({ 
        error: "Google authentication required", 
        needsAuth: true,
      });
    } else if (error.code === 404) {
      res.status(404).json({ error: "Event not found" });
    } else {
      res.status(500).json({ 
        error: "Failed to fetch event",
        details: error.message 
      });
    }
  }
}

// FIXED: New function to check availability and get free/busy times
export async function getFreeBusyInfo(req: Request, res: Response) {
  try {
    const tenantId = getTenantId(req);
    const client = await getAuthorizedClient(tenantId);
    
    const calendar = google.calendar({ version: "v3", auth: client });

    const {
      timeMin,
      timeMax,
      calendarIds = ["primary"]
    } = req.query;

    if (!timeMin || !timeMax) {
      return res.status(400).json({
        error: "timeMin and timeMax are required"
      });
    }

    const calendarsArray = Array.isArray(calendarIds) 
      ? calendarIds as string[]
      : [calendarIds as string];

    const freeBusyQuery = {
      timeMin: timeMin as string,
      timeMax: timeMax as string,
      items: calendarsArray.map(id => ({ id }))
    };

    const result = await calendar.freebusy.query({
      requestBody: freeBusyQuery
    });

    res.json(result.data);
  } catch (error: any) {
    console.error("Error fetching free/busy info:", error);
    
    if (error.message.includes("authenticate") || error.code === 401) {
      res.status(401).json({ 
        error: "Google authentication required", 
        needsAuth: true,
      });
    } else {
      res.status(500).json({ 
        error: "Failed to fetch free/busy info",
        details: error.message 
      });
    }
  }
}

// FIXED: New function to get available time slots
export async function getAvailableTimeSlots(req: Request, res: Response) {
  try {
    const tenantId = getTenantId(req);
    const client = await getAuthorizedClient(tenantId);
    
    const calendar = google.calendar({ version: "v3", auth: client });

    const {
      date,
      startTime = "09:00",
      endTime = "17:00",
      duration = "60", // minutes
      calendarId = "primary"
    } = req.query;

    if (!date) {
      return res.status(400).json({ error: "Date parameter is required" });
    }

    const startOfDay = new Date(`${date}T${startTime}:00`);
    const endOfDay = new Date(`${date}T${endTime}:00`);

    // Get existing events for the day
    const events = await calendar.events.list({
      calendarId: calendarId as string,
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
    const slotDuration = parseInt(duration as string) * 60000; // Convert to milliseconds
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

    res.json({ 
      date,
      availableSlots,
      total: availableSlots.length,
      busySlots: busySlots.length
    });
  } catch (error: any) {
    console.error("Error getting available time slots:", error);
    
    if (error.message.includes("authenticate") || error.code === 401) {
      res.status(401).json({ 
        error: "Google authentication required", 
        needsAuth: true,
      });
    } else {
      res.status(500).json({ 
        error: "Failed to get available time slots",
        details: error.message 
      });
    }
  }
}

// FIXED: New function to create recurring events
export async function createRecurringEvent(req: Request, res: Response) {
  try {
    const tenantId = getTenantId(req);
    const client = await getAuthorizedClient(tenantId);
    
    const calendar = google.calendar({ version: "v3", auth: client });

    const {
      summary,
      description,
      start,
      end,
      location,
      attendees,
      frequency = "WEEKLY", // DAILY, WEEKLY, MONTHLY, YEARLY
      interval = 1,
      count, // Number of occurrences
      until, // End date
      byDay, // For weekly: ['MO', 'WE', 'FR']
      timeZone = "Asia/Jakarta",
      calendarId = "primary"
    } = req.body;

    if (!summary || !start || !end) {
      return res.status(400).json({
        error: "Missing required fields: summary, start, end"
      });
    }

    let recurrenceRule = `FREQ=${frequency};INTERVAL=${interval}`;
    
    if (count) recurrenceRule += `;COUNT=${count}`;
    if (until) recurrenceRule += `;UNTIL=${new Date(until).toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
    if (byDay && frequency === 'WEEKLY') recurrenceRule += `;BYDAY=${byDay.join(',')}`;

    const eventResource = {
      summary,
      description,
      location,
      start: {
        dateTime: start,
        timeZone,
      },
      end: {
        dateTime: end,
        timeZone,
      },
      attendees: attendees?.map((email: string) => ({ email })),
      recurrence: [`RRULE:${recurrenceRule}`],
    };

    const result = await calendar.events.insert({
      calendarId,
      requestBody: eventResource,
      sendUpdates: "all",
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
        attendees: attendees ? JSON.stringify(attendees) : null,
        recurrence: recurrenceRule,
        created_at: new Date().toISOString(),
      });
    } catch (dbError) {
      console.error("Database save error:", dbError);
    }

    res.status(201).json(result.data);
  } catch (error: any) {
    console.error("Error creating recurring event:", error);
    
    if (error.message.includes("authenticate") || error.code === 401) {
      res.status(401).json({ 
        error: "Google authentication required", 
        needsAuth: true,
      });
    } else {
      res.status(500).json({ 
        error: "Failed to create recurring event",
        details: error.message 
      });
    }
  }
}