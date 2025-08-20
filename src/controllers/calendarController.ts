import { Request, Response } from "express";
import { google } from "googleapis";
import { supabase } from "../config/supabase";

async function getAuthorizedClient(tenantId: string) {
  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("access_token, refresh_token, expiry_date")
    .eq("id", tenantId)
    .single();

  if (error || !tenant) {
    throw new Error("Tenant not found or error fetching tokens.");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: tenant.access_token,
    refresh_token: tenant.refresh_token,
    expiry_date: tenant.expiry_date,
  });

  oauth2Client.on("tokens", async (newTokens) => {
    await supabase
      .from("tenants")
      .update({
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token,
        expiry_date: newTokens.expiry_date,
      })
      .eq("id", tenantId);
  });

  return oauth2Client;
}

export async function createCalendar(req: Request, res: Response) {
  try {
    const client = await getAuthorizedClient(req.tenantId!);
    const calendar = google.calendar({ version: "v3", auth: client });
    const newCalendar = await calendar.calendars.insert({
      requestBody: {
        summary: req.body.summary || "New Calendar from App",
        timeZone: req.body.timeZone || "Asia/Jakarta",
      },
    });

    if (newCalendar.data) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { error: dbError } = await supabase.from("calendars").insert({
          id: newCalendar.data.id,
          summary: newCalendar.data.summary,
          description: newCalendar.data.description,
          time_zone: newCalendar.data.timeZone,
          user_id: user.id,
        });

        if (dbError) {
          throw new Error(
            `Failed to save calendar to database: ${dbError.message}`
          );
        }
      }
    }

    res.status(201).json(newCalendar.data);
  } catch (error) {
    console.error("Error creating calendar:", error);
    res.status(500).send("Failed to create calendar.");
  }
}

export async function getCalendarEvents(req: Request, res: Response) {
  try {
    const client = await getAuthorizedClient(req.tenantId!);
    const calendar = google.calendar({ version: "v3", auth: client });
    const eventList = await calendar.events.list({
      calendarId: req.params.calendarId || "primary",
      timeMin: new Date().toISOString(),
      maxResults: 15,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = eventList.data.items;
    if (events && events.length) {
      const mappedEvents = events.map((event) => ({
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
      }));
      res.json(mappedEvents);
    } else {
      res.send("No upcoming events found.");
    }
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).send("Failed to fetch events.");
  }
}

export async function getCalendars(req: Request, res: Response) {
  try {
    const client = await getAuthorizedClient(req.tenantId!);
    const calendar = google.calendar({ version: "v3", auth: client });
    const calendarList = await calendar.calendarList.list();
    res.json(calendarList.data.items);
  } catch (error) {
    console.error("Error fetching calendars:", error);
    res.status(500).send("Failed to fetch calendars.");
  }
}

export async function createCalendarEvent(req: Request, res: Response) {
  try {
    const client = await getAuthorizedClient(req.tenantId!);
    const calendar = google.calendar({ version: "v3", auth: client });

    const event = {
      summary: req.body.summary,
      description: req.body.description,
      start: {
        dateTime: req.body.start,
        timeZone: "Asia/Jakarta",
      },
      end: {
        dateTime: req.body.end,
        timeZone: "Asia/Jakarta",
      },
    };

    const result = await calendar.events.insert({
      calendarId: req.params.calendarId || "primary",
      requestBody: event,
    });

    res.status(201).json(result.data);
  } catch (error) {
    console.error("Error creating event:", error);
    res.status(500).send("Failed to create event.");
  }
}
