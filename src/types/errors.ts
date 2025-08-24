// Custom error classes for better error handling
export class UserNotLinkedError extends Error {
  constructor(message: string = "Telegram chat not linked to any Google account") {
    super(message);
    this.name = "UserNotLinkedError";
  }
}

export class GoogleAuthRequiredError extends Error {
  constructor(message: string = "Google authentication required") {
    super(message);
    this.name = "GoogleAuthRequiredError";
  }
}

export class CalendarNotFoundError extends Error {
  constructor(message: string = "Calendar not found") {
    super(message);
    this.name = "CalendarNotFoundError";
  }
}