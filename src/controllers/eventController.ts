import { Request, Response } from "express";
import { EventService, EventData, RecurringEventData } from "../services/eventService";

export class EventController {
  private static parseEventData(body: any): EventData {
    const {
      summary,
      description,
      start,
      end,
      location,
      attendees,
      reminders,
      visibility ,
      timeZone
    } = body;

    let startDateTime: string;
    let endDateTime: string;

    if (typeof start === 'string') {
      startDateTime = start;
    }
    else if (start && typeof start === 'object' && start.dateTime) {
      startDateTime = start.dateTime;
    }
    else if (typeof start === 'string' && start.startsWith('{')) {
      try {
        const parsed = JSON.parse(start);
        startDateTime = parsed.dateTime || parsed.start?.dateTime;
      } catch (e) {
        throw new Error("Invalid start time format");
      }
    } else {
      throw new Error("Start time is required");
    }

    // Same logic for end time
    if (typeof end === 'string') {
      endDateTime = end;
    } else if (end && typeof end === 'object' && end.dateTime) {
      endDateTime = end.dateTime;
    } else if (typeof end === 'string' && end.startsWith('{')) {
      try {
        const parsed = JSON.parse(end);
        endDateTime = parsed.dateTime || parsed.end?.dateTime;
      } catch (e) {
        throw new Error("Invalid end time format");
      }
    } else {
      throw new Error("End time is required");
    }

    return {
      summary,
      description,
      start: startDateTime,
      end: endDateTime,
      location,
      attendees,
      reminders,
      visibility,
      timeZone
    };
  }

  static async createCalendarEvent(req: Request, res: Response) {
    try {
      const tenantId = req.user?.id;
      if (!tenantId) {
        return res.status(401).json({
          error: "User not authenticated",
          success: false
        });
      }

      const calendarId = req.params.calendarId || "primary";
      console.log("Creating event for calendar:", calendarId);
      console.log("Request body:", JSON.stringify(req.body, null, 2));

      const eventData = EventController.parseEventData(req.body);

      console.log("Parsed event data:", JSON.stringify(eventData, null, 2));

      const result = await EventService.createEvent(tenantId, eventData, calendarId);

      res.status(201).json({
        success: true,
        data: result,
        message: "Event created successfully"
      });
    } catch (error: any) {
      console.error("Controller error creating event:", error);

      // Enhanced error response with more specific error handling
      if (error.message.includes("authentication") || error.message.includes("permissions")) {
        res.status(401).json({
          success: false,
          error: "Google authentication required",
          details: error.message,
          needsAuth: true,
        });
      } else if (error.message.includes("Validation failed")) {
        res.status(400).json({
          success: false,
          error: "Validation error",
          details: error.message
        });
      } else if (error.message.includes("Invalid datetime")) {
        res.status(400).json({
          success: false,
          error: "Invalid datetime format",
          details: error.message,
          expectedFormat: "ISO 8601 (YYYY-MM-DDTHH:mm:ss+07:00)"
        });
      } else {
        res.status(500).json({
          success: false,
          error: "Failed to create event",
          details: error.message
        });
      }
    }
  }

  static async updateCalendarEvent(req: Request, res: Response) {
    try {
      const tenantId = req.user?.id;
      if (!tenantId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const { eventId } = req.params;
      const calendarId = req.params.calendarId || "primary";

      const updateData = EventController.parseEventDataForUpdate(req.body);

      const result = await EventService.updateEvent(tenantId, eventId, updateData, calendarId);

      res.json({
        success: true,
        data: result,
        message: "Event updated successfully"
      });
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

  private static parseEventDataForUpdate(body: any): Partial<EventData> {
    const {
      summary,
      description,
      start,
      end,
      location,
      attendees,
      reminders,
      visibility,
      timeZone
    } = body;

    const updateData: Partial<EventData> = {
      summary,
      description,
      location,
      attendees,
      reminders,
      visibility,
      timeZone
    };

    // Handle start time if provided
    if (start) {
      if (typeof start === 'string') {
        updateData.start = start;
      } else if (start && typeof start === 'object' && start.dateTime) {
        updateData.start = start.dateTime;
      } else if (typeof start === 'string' && start.startsWith('{')) {
        try {
          const parsed = JSON.parse(start);
          updateData.start = parsed.dateTime || parsed.start?.dateTime;
        } catch (e) {
          throw new Error("Invalid start time format");
        }
      }
    }

    // Handle end time if provided
    if (end) {
      if (typeof end === 'string') {
        updateData.end = end;
      } else if (end && typeof end === 'object' && end.dateTime) {
        updateData.end = end.dateTime;
      } else if (typeof end === 'string' && end.startsWith('{')) {
        try {
          const parsed = JSON.parse(end);
          updateData.end = parsed.dateTime || parsed.end?.dateTime;
        } catch (e) {
          throw new Error("Invalid end time format");
        }
      }
    }

    return updateData;
  }

  static async deleteCalendarEvent(req: Request, res: Response) {
    try {
      const tenantId = req.user?.id;
      if (!tenantId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const { eventId } = req.params;
      const calendarId = req.params.calendarId || "primary";

      const result = await EventService.deleteEvent(tenantId, eventId, calendarId);

      res.json({
        success: true,
        message: "Event deleted successfully"
      });
    } catch (error: any) {
      console.error("Error deleting event:", error);

      if (error.message.includes("authenticate") || error.code === 401) {
        res.status(401).json({
          error: "Google authentication required",
          needsAuth: true,
        });
      } else if (error.code === 404) {
        res.status(404).json({ error: "Event not found" });
      } else {
        res.status(500).json({
          error: "Failed to delete event",
          details: error.message
        });
      }
    }
  }

  static async getCalendarEvent(req: Request, res: Response) {
    try {
      const tenantId = req.user?.id;
      if (!tenantId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const { eventId } = req.params;
      const calendarId = req.params.calendarId || req.query.calendarId as string || "primary";

      const result = await EventService.getEvent(tenantId, eventId, calendarId);

      res.json({
        success: true,
        data: result
      });
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

  static async getCalendarEvents(req: Request, res: Response) {
    try {
      const tenantId = req.user?.id;
      if (!tenantId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const calendarId = req.params.calendarId || "primary";

      const result = await EventService.getEvents(tenantId, calendarId, req.query);

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      console.error("Error fetching calendar events:", error);

      if (error.message.includes("authenticate") || error.code === 401) {
        res.status(401).json({
          error: "Google authentication required",
          needsAuth: true,
        });
      } else {
        res.status(500).json({
          error: "Failed to fetch calendar events",
          details: error.message
        });
      }
    }
  }

  static async getPrimaryCalendarEvents(req: Request, res: Response) {
    try {
      const tenantId = req.user?.id;
      if (!tenantId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const calendarId = req.query.calendarId as string || "primary";

      const result = await EventService.getEvents(tenantId, calendarId, req.query);

      res.json({
        success: true,
        data: result
      });
    } catch (error: any) {
      console.error("Error fetching primary calendar events:", error);

      if (error.message.includes("authenticate") || error.code === 401) {
        res.status(401).json({
          error: "Google authentication required",
          needsAuth: true,
        });
      } else {
        res.status(500).json({
          error: "Failed to fetch primary calendar events",
          details: error.message
        });
      }
    }
  }

  static async getFreeBusyInfo(req: Request, res: Response) {
    try {
      const tenantId = req.user?.id;
      if (!tenantId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const { timeMin, timeMax, calendarIds } = req.query;

      const result = await EventService.getFreeBusyInfo(
        tenantId,
        timeMin as string,
        timeMax as string,
        Array.isArray(calendarIds) ? calendarIds as string[] : [calendarIds as string]
      );

      res.json({
        success: true,
        data: result
      });
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

  static async getAvailableTimeSlots(req: Request, res: Response) {
    try {
      const tenantId = req.user?.id;
      if (!tenantId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const { date, startTime, endTime, duration, calendarId } = req.query;

      const result = await EventService.getAvailableTimeSlots(tenantId, date as string, {
        startTime: startTime as string,
        endTime: endTime as string,
        duration: duration as string,
        calendarId: calendarId as string
      });

      res.json({
        success: true,
        data: result
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

  static async createRecurringEvent(req: Request, res: Response) {
    try {
      const tenantId = req.user?.id;
      if (!tenantId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const calendarId = req.params.calendarId || "primary";

      const {
        summary,
        description,
        start,
        end,
        location,
        attendees,
        frequency = "WEEKLY",
        interval = 1,
        count,
        until,
        byDay,
        timeZone
      } = req.body;

      let startDateTime: string;
      let endDateTime: string;

      // Parse start time
      if (typeof start === 'string') {
        startDateTime = start;
      } else if (start && typeof start === 'object' && start.dateTime) {
        startDateTime = start.dateTime;
      } else if (typeof start === 'string' && start.startsWith('{')) {
        try {
          const parsed = JSON.parse(start);
          startDateTime = parsed.dateTime || parsed.start?.dateTime;
        } catch (e) {
          throw new Error("Invalid start time format");
        }
      } else {
        throw new Error("Start time is required");
      }

      // Parse end time
      if (typeof end === 'string') {
        endDateTime = end;
      } else if (end && typeof end === 'object' && end.dateTime) {
        endDateTime = end.dateTime;
      } else if (typeof end === 'string' && end.startsWith('{')) {
        try {
          const parsed = JSON.parse(end);
          endDateTime = parsed.dateTime || parsed.end?.dateTime;
        } catch (e) {
          throw new Error("Invalid end time format");
        }
      } else {
        throw new Error("End time is required");
      }

      const eventData: RecurringEventData = {
        summary,
        description,
        start: startDateTime,
        end: endDateTime,
        location,
        attendees,
        frequency,
        interval,
        count,
        until,
        byDay,
        timeZone
      };

      const result = await EventService.createRecurringEvent(tenantId, eventData, calendarId);

      res.status(201).json({
        success: true,
        data: result,
        message: "Recurring event created successfully"
      });
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
}