import { Router } from "express";
import { AuthController } from "../controllers/authController";
import { CalendarController } from "../controllers/calendarController";

import { EventController } from "../controllers/eventController";
import { requireGoogleAuth, telegramAuthMiddleware } from "../middleware/auth";
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
router.post("/calendars", telegramAuthMiddleware, CalendarController.createCalendar);
router.get("/calendars", telegramAuthMiddleware, CalendarController.getCalendars);
router.put("/calendars/:calendarId", telegramAuthMiddleware, CalendarController.updateCalendar);
router.delete("/calendars/:calendarId", telegramAuthMiddleware, CalendarController.deleteCalendar);

// Event management routes for specific calendars (require Google auth)
router.post("/calendars/:calendarId/events", telegramAuthMiddleware, EventController.createCalendarEvent);
router.get("/calendars/:calendarId/events", telegramAuthMiddleware, EventController.getCalendarEvents);
router.get("/calendars/:calendarId/events/:eventId", telegramAuthMiddleware, EventController.getCalendarEvent);
router.put("/calendars/:calendarId/events/:eventId", telegramAuthMiddleware, EventController.updateCalendarEvent);
router.delete("/calendars/:calendarId/events/:eventId", telegramAuthMiddleware, EventController.deleteCalendarEvent);

// Event management routes for primary calendar (require Google auth)
router.post("/events", telegramAuthMiddleware, EventController.createCalendarEvent);
router.get("/events", telegramAuthMiddleware, EventController.getPrimaryCalendarEvents);
router.get("/events/:eventId", telegramAuthMiddleware, EventController.getCalendarEvent);
router.put("/events/:eventId", telegramAuthMiddleware, EventController.updateCalendarEvent);
router.delete("/events/:eventId", telegramAuthMiddleware, EventController.deleteCalendarEvent);

// Recurring events (require Google auth)
router.post("/events/recurring", telegramAuthMiddleware, EventController.createRecurringEvent);

// Scheduling and availability (require Google auth)
router.get("/freebusy", telegramAuthMiddleware, EventController.getFreeBusyInfo);
router.get("/availability", telegramAuthMiddleware, EventController.getAvailableTimeSlots);

export default router;