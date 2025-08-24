import { Request, Response } from "express";
import { EventService, EventData, RecurringEventData } from "../services/eventService";

export class EventController {
  static async createCalendarEvent(req: Request, res: Response) {
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
        reminders,
        visibility = "default",
        timeZone = "Asia/Jakarta"
      } = req.body;

      const eventData: EventData = {
        summary,
        description,
        start,
        end,
        location,
        attendees,
        reminders,
        visibility,
        timeZone
      };

      const result = await EventService.createEvent(tenantId, eventData, calendarId);

      res.status(201).json({
        success: true,
        data: result,
        message: "Event created successfully"
      });
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

  static async updateCalendarEvent(req: Request, res: Response) {
    try {
      const tenantId = req.user?.id;
      if (!tenantId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

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

      const eventData: Partial<EventData> = {
        summary,
        description,
        start,
        end,
        location,
        attendees,
        reminders,
        visibility,
        timeZone
      };

      const result = await EventService.updateEvent(tenantId, eventId, eventData, calendarId);

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
        timeZone = "Asia/Jakarta"
      } = req.body;

      const eventData: RecurringEventData = {
        summary,
        description,
        start,
        end,
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