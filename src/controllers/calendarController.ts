import { Request, Response } from "express";
import { CalendarService, CalendarData } from "../services/calendarService";
import { UserNotLinkedError, GoogleAuthRequiredError, CalendarNotFoundError } from "../types/errors";

export class CalendarController {
  static async createCalendar(req: Request, res: Response) {
    try {
      const tenantId = req.user?.id;
      if (!tenantId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const calendarData: CalendarData = {
        summary: req.body.summary || "New Calendar from App",
        timeZone: req.body.timeZone || "Asia/Jakarta",
        description: req.body.description || "",
        location: req.body.location || "",
      };

      const result = await CalendarService.createCalendar(tenantId, calendarData);

      res.status(201).json(result);
    } catch (error: any) {
      console.error("Error creating calendar:", error);

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

  static async getCalendars(req: Request, res: Response) {
    try {
      const tenantId = req.user?.id;
      if (!tenantId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const result = await CalendarService.getCalendars(tenantId);

      res.json(result);
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

  static async updateCalendar(req: Request, res: Response) {
    try {
      const tenantId = req.user?.id;
      if (!tenantId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const { calendarId } = req.params;

      const calendarData: Partial<CalendarData> = {
        summary: req.body.summary,
        description: req.body.description,
        timeZone: req.body.timeZone,
        location: req.body.location,
      };

      const result = await CalendarService.updateCalendar(tenantId, calendarId, calendarData);

      res.json(result);
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

  static async deleteCalendar(req: Request, res: Response) {
    try {
      const tenantId = req.user?.id;
      if (!tenantId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      const { calendarId } = req.params;

      // Don't allow deleting primary calendar
      if (calendarId === "primary") {
        return res.status(400).json({
          error: "Cannot delete primary calendar"
        });
      }

      const result = await CalendarService.deleteCalendar(tenantId, calendarId);

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

// Telegram chat ID methods removed - ChatGPT users now use standard calendar methods
}

