import { Router } from "express";
import { AuthController } from "../controllers/authController";
import {
  createCalendar,
  getCalendars,
  updateCalendar,
  deleteCalendar,
} from "../controllers/calendarController";

import {
  createCalendarEvent,
  getCalendarEvents,
  getPrimaryCalendarEvents,
  getCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  getFreeBusyInfo,
  getAvailableTimeSlots,
  createRecurringEvent,
} from "../controllers/eventController";
import { requireGoogleAuth } from "../middleware/auth";
import { TelegramAuthController } from "../controllers/telegramController";

const router = Router();


// Standard Auth routes (public)
router.post("/auth/register", AuthController.register);
router.post("/auth/login", AuthController.login);
router.post("/auth/logout", AuthController.logout);
router.get("/auth/google", AuthController.googleAuth);
router.get("/auth/me", AuthController.getMe);

// Telegram Auth routes (public) - MUST be before requireGoogleAuth middleware
router.post("/telegram/oauth/generate", TelegramAuthController.generateTelegramOAuthUrl);
router.get("/auth/callback", TelegramAuthController.handleTelegramOAuthCallback);
router.get("/telegram/check/:telegram_chat_id", TelegramAuthController.checkTelegramAuth);
router.get("/auth/user/:userId/with-token", TelegramAuthController.getUserWithToken);

// Google-specific routes (require Google auth)
router.get("/google/status", requireGoogleAuth, AuthController.testGoogleConnection);
router.post("/google/disconnect", requireGoogleAuth, AuthController.disconnectGoogle);
router.post("/telegram/disconnect", requireGoogleAuth, TelegramAuthController.disconnectTelegram);

// Calendar management routes (require Google auth)
router.post("/calendars", requireGoogleAuth, createCalendar);
router.get("/calendars", requireGoogleAuth, getCalendars);
router.put("/calendars/:calendarId", requireGoogleAuth, updateCalendar);
router.delete("/calendars/:calendarId", requireGoogleAuth, deleteCalendar);

// Event management routes for specific calendars (require Google auth)
router.post("/calendars/:calendarId/events", requireGoogleAuth, createCalendarEvent);
router.get("/calendars/:calendarId/events", requireGoogleAuth, getCalendarEvents);
router.get("/calendars/:calendarId/events/:eventId", requireGoogleAuth, getCalendarEvent);
router.put("/calendars/:calendarId/events/:eventId", requireGoogleAuth, updateCalendarEvent);
router.delete("/calendars/:calendarId/events/:eventId", requireGoogleAuth, deleteCalendarEvent);

// Event management routes for primary calendar (require Google auth)
router.post("/events", requireGoogleAuth, createCalendarEvent);
router.get("/events", requireGoogleAuth, getPrimaryCalendarEvents);
router.get("/events/:eventId", requireGoogleAuth, getCalendarEvent);
router.put("/events/:eventId", requireGoogleAuth, updateCalendarEvent);
router.delete("/events/:eventId", requireGoogleAuth, deleteCalendarEvent);

// Recurring events (require Google auth)
router.post("/events/recurring", requireGoogleAuth, createRecurringEvent);

// Scheduling and availability (require Google auth)
router.get("/freebusy", requireGoogleAuth, getFreeBusyInfo);
router.get("/availability", requireGoogleAuth, getAvailableTimeSlots);

export default router;