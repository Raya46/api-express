import { Router } from "express";
import { AuthController } from "../controllers/authController";
import { CalendarController } from "../controllers/calendarController";

import { EventController } from "../controllers/eventController";
import { requireGoogleAuth, telegramAuthMiddleware } from "../middleware/auth";
import { TelegramController } from "../controllers/telegramController";

const router = Router();


// Standard Auth routes (public)
router.post("/auth/logout", AuthController.logout);
router.get("/auth/google", AuthController.googleAuth);
router.get("/auth/me", AuthController.getMe);

// Telegram Auth routes (public) - MUST be before requireGoogleAuth middleware
router.post("/telegram/oauth/generate", TelegramController.generateTelegramOAuthUrl);
router.get("/telegram/check/:telegram_chat_id", TelegramController.checkTelegramAuth);
router.get("/auth/user/:userId/with-token", TelegramController.getUserWithToken);

// OAuth callback route (handles both ChatGPT and Telegram OAuth)
router.get("/auth/callback", AuthController.oauthCallback);

// Google-specific routes (require Google auth)
router.get("/google/status", requireGoogleAuth, AuthController.testGoogleConnection);
router.post("/google/disconnect", requireGoogleAuth, AuthController.disconnectGoogle);
router.post("/telegram/disconnect", requireGoogleAuth, TelegramController.disconnectTelegram);

// Calendar management routes for ChatGPT users (require Google auth)
router.post("/gpt/calendars", requireGoogleAuth, CalendarController.createCalendar);
router.get("/gpt/calendars", requireGoogleAuth, CalendarController.getCalendars);
router.put("/gpt/calendars/:calendarId", requireGoogleAuth, CalendarController.updateCalendar);
router.delete("/gpt/calendars/:calendarId", requireGoogleAuth, CalendarController.deleteCalendar);

// Calendar management routes for Telegram users (require Telegram auth)
router.post("/calendars", telegramAuthMiddleware, CalendarController.createCalendar);
router.get("/calendars", telegramAuthMiddleware, CalendarController.getCalendars);
router.put("/calendars/:calendarId", telegramAuthMiddleware, CalendarController.updateCalendar);
router.delete("/calendars/:calendarId", telegramAuthMiddleware, CalendarController.deleteCalendar);

// Event management routes for ChatGPT users (require Google auth)
router.post("/gpt/calendars/:calendarId/events", requireGoogleAuth, EventController.createCalendarEvent);
router.get("/gpt/calendars/:calendarId/events", requireGoogleAuth, EventController.getCalendarEvents);
router.get("/gpt/calendars/:calendarId/events/:eventId", requireGoogleAuth, EventController.getCalendarEvent);
router.put("/gpt/calendars/:calendarId/events/:eventId", requireGoogleAuth, EventController.updateCalendarEvent);
router.delete("/gpt/calendars/:calendarId/events/:eventId", requireGoogleAuth, EventController.deleteCalendarEvent);

// Event management routes for Telegram users (require Telegram auth)
router.post("/calendars/:calendarId/events", telegramAuthMiddleware, EventController.createCalendarEvent);
router.get("/calendars/:calendarId/events", telegramAuthMiddleware, EventController.getCalendarEvents);
router.get("/calendars/:calendarId/events/:eventId", telegramAuthMiddleware, EventController.getCalendarEvent);
router.put("/calendars/:calendarId/events/:eventId", telegramAuthMiddleware, EventController.updateCalendarEvent);
router.delete("/calendars/:calendarId/events/:eventId", telegramAuthMiddleware, EventController.deleteCalendarEvent);

// Primary calendar event routes for ChatGPT users (require Google auth)
router.post("/gpt/events", requireGoogleAuth, EventController.createCalendarEvent);
router.get("/gpt/events", requireGoogleAuth, EventController.getPrimaryCalendarEvents);
router.get("/gpt/events/:eventId", requireGoogleAuth, EventController.getCalendarEvent);
router.put("/gpt/events/:eventId", requireGoogleAuth, EventController.updateCalendarEvent);
router.delete("/gpt/events/:eventId", requireGoogleAuth, EventController.deleteCalendarEvent);

// Primary calendar event routes for Telegram users (require Telegram auth)
router.post("/events", telegramAuthMiddleware, EventController.createCalendarEvent);
router.get("/events", telegramAuthMiddleware, EventController.getPrimaryCalendarEvents);
router.get("/events/:eventId", telegramAuthMiddleware, EventController.getCalendarEvent);
router.put("/events/:eventId", telegramAuthMiddleware, EventController.updateCalendarEvent);
router.delete("/events/:eventId", telegramAuthMiddleware, EventController.deleteCalendarEvent);

// Recurring events for ChatGPT users (require Google auth)
router.post("/gpt/events/recurring", requireGoogleAuth, EventController.createRecurringEvent);

// Recurring events for Telegram users (require Telegram auth)
router.post("/events/recurring", telegramAuthMiddleware, EventController.createRecurringEvent);

// Scheduling and availability for ChatGPT users (require Google auth)
router.get("/gpt/freebusy", requireGoogleAuth, EventController.getFreeBusyInfo);
router.get("/gpt/availability", requireGoogleAuth, EventController.getAvailableTimeSlots);

// Scheduling and availability for Telegram users (require Telegram auth)
router.get("/freebusy", telegramAuthMiddleware, EventController.getFreeBusyInfo);
router.get("/availability", telegramAuthMiddleware, EventController.getAvailableTimeSlots);

export default router;