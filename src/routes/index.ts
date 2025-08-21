import { Router } from "express";
import { AuthController } from "../controllers/authController";
import {
  createCalendar,
  createCalendarEvent,
  createRecurringEvent,
  deleteCalendarEvent,
  getAvailableTimeSlots,
  getCalendarEvent,
  getCalendarEvents,
  getCalendars,
  getFreeBusyInfo,
  updateCalendarEvent,
} from "../controllers/calendarController";
import { requireGoogleAuth } from "../middleware/auth";

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

router.use(requireGoogleAuth)
// Calendar routes
router.post('/calendars', createCalendar);
router.get('/calendars', getCalendars);

// Event management routes
router.post('/calendars/:calendarId/events', createCalendarEvent);
router.get('/calendars/:calendarId/events', getCalendarEvents);
router.get('/calendars/:calendarId/events/:eventId', getCalendarEvent);
router.put('/calendars/:calendarId/events/:eventId', updateCalendarEvent);
router.delete('/calendars/:calendarId/events/:eventId', deleteCalendarEvent);

// Alternative routes for primary calendar
router.post('/events', createCalendarEvent); // Uses primary calendar
router.get('/events', getCalendarEvents); // Uses primary calendar
router.get('/events/:eventId', getCalendarEvent);
router.put('/events/:eventId', updateCalendarEvent);
router.delete('/events/:eventId', deleteCalendarEvent);

// Additional utility routes
router.get('/freebusy', getFreeBusyInfo);
router.get('/available-slots', getAvailableTimeSlots);
router.post('/recurring-events', createRecurringEvent);
router.delete('/events/:eventId', deleteCalendarEvent);

// Recurring events
router.post('/events/recurring', createRecurringEvent);

// Scheduling and availability
router.get('/availability', getAvailableTimeSlots);
router.get('/freebusy', getFreeBusyInfo);

export default router;
