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

// Auth routes
router.post("/auth/register", AuthController.register);
router.post("/auth/login", AuthController.login);
router.post("/auth/logout", AuthController.logout);
router.get("/auth/google", AuthController.googleAuth);
router.get("/auth/callback", AuthController.oauthCallback);
router.get("/google/status", AuthController.testGoogleConnection);
router.post("/google/disconnect", AuthController.disconnectGoogle);
router.get("/auth/me", AuthController.getMe);

// telegram
router.post('/telegram/oauth/generate', TelegramAuthController.generateTelegramOAuthUrl);

// OAuth callback (update existing callback to handle telegram)
router.get('/oauth/callback', TelegramAuthController.handleTelegramOAuthCallback);

// Check if telegram is authenticated
router.get('/telegram/check/:telegram_chat_id', TelegramAuthController.checkTelegramAuth);

// Disconnect telegram (authenticated route)
router.post('/telegram/disconnect', TelegramAuthController.disconnectTelegram);

router.use(requireGoogleAuth)

// Calendar management routes
router.post('/calendars', createCalendar); // Create new calendar
router.get('/calendars', getCalendars); // Get all calendars
router.put('/calendars/:calendarId', updateCalendar); // Update calendar
router.delete('/calendars/:calendarId', deleteCalendar); // Delete calendar

// Event management routes for specific calendars
router.post('/calendars/:calendarId/events', createCalendarEvent); // Create event in specific calendar
router.get('/calendars/:calendarId/events', getCalendarEvents); // Get events from specific calendar
router.get('/calendars/:calendarId/events/:eventId', getCalendarEvent); // Get single event
router.put('/calendars/:calendarId/events/:eventId', updateCalendarEvent); // Update event
router.delete('/calendars/:calendarId/events/:eventId', deleteCalendarEvent); // Delete event

// Event management routes for primary calendar (convenience routes)
router.post('/events', createCalendarEvent); // Create event in primary calendar
router.get('/events', getPrimaryCalendarEvents); // Get events from primary calendar
router.get('/events/:eventId', getCalendarEvent); // Get single event from primary calendar
router.put('/events/:eventId', updateCalendarEvent); // Update event in primary calendar
router.delete('/events/:eventId', deleteCalendarEvent); // Delete event from primary calendar

// Recurring events
router.post('/events/recurring', createRecurringEvent); // Create recurring event

// Scheduling and availability
router.get('/freebusy', getFreeBusyInfo); // Get free/busy information
router.get('/availability', getAvailableTimeSlots); // Get available time slots

export default router;
