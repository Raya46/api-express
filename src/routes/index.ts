import { Router } from "express";
import { AuthController } from "../controllers/authController";
import { PostsController } from "../controllers/postsController";
import {
  createCalendar,
  getCalendars,
  getCalendarEvents,
  createCalendarEvent,
} from "../controllers/calendarController";
import { authMiddleware } from "../middleware/auth";
import { tenantMiddleware } from "../middleware/tenant";

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

// Protected posts routes
router.get("/posts", authMiddleware, PostsController.getAllPosts);
router.get("/posts/my", authMiddleware, PostsController.getUserPosts);
router.get("/posts/:id", authMiddleware, PostsController.getPost);
router.post("/posts", authMiddleware, PostsController.createPost);
router.put("/posts/:id", authMiddleware, PostsController.updatePost);
router.delete("/posts/:id", authMiddleware, PostsController.deletePost);

// Calendar routes
router.post("/calendars", tenantMiddleware, createCalendar);
router.get("/calendars", tenantMiddleware, getCalendars);
router.get("/calendars/:calendarId/events", tenantMiddleware, getCalendarEvents);
router.post(
  "/calendars/:calendarId/events",
  tenantMiddleware,
  createCalendarEvent
);

export default router;
