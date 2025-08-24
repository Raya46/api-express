export interface Database {
  public: {
    Tables: {
      // ChatGPT users table - no telegram_chat_id
      users: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
          google_id: string | null;
          google_access_token: string | null;
          google_refresh_token: string | null;
          token_expires_at: string | null;
        };
        Insert: {
          id?: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
          google_id?: string | null;
          google_access_token?: string | null;
          google_refresh_token?: string | null;
          token_expires_at?: string | null;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          updated_at?: string;
          google_id?: string | null;
          google_access_token?: string | null;
          google_refresh_token?: string | null;
          token_expires_at?: string | null;
        };
      };
      // Telegram users table - separate from ChatGPT users
      telegram_users: {
        Row: {
          id: string;
          telegram_chat_id: number;
          full_name: string | null;
          username: string | null;
          user_id: string | null; // References users.id for linked accounts
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          telegram_chat_id: number;
          full_name?: string | null;
          username?: string | null;
          user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          telegram_chat_id?: number;
          full_name?: string | null;
          username?: string | null;
          user_id?: string | null;
          updated_at?: string;
        };
      };
      // Telegram sessions for OAuth flow
      telegram_sessions: {
        Row: {
          id: string;
          telegram_chat_id: number;
          user_id: string | null;
          session_token: string;
          expires_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          telegram_chat_id: number;
          user_id?: string | null;
          session_token: string;
          expires_at: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          telegram_chat_id?: number;
          user_id?: string | null;
          session_token?: string;
          expires_at?: string;
          updated_at?: string;
        };
      };
      // Calendar management
      calendars: {
        Row: {
          id: string;
          user_id: string | null;
          calendar_id: string;
          summary: string | null;
          description: string | null;
          created_at: string;
          updated_at: string;
          time_zone: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          calendar_id: string;
          summary?: string | null;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
          time_zone?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          calendar_id?: string;
          summary?: string | null;
          description?: string | null;
          updated_at?: string;
          time_zone?: string | null;
        };
      };
      // Events table
      events: {
        Row: {
          id: string;
          summary: string | null;
          description: string | null;
          start_time: string | null;
          end_time: string | null;
          location: string | null;
          status: string | null;
          calendar_id: string;
          user_id: string;
          attendees: any | null; // jsonb
          recurrence: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          summary?: string | null;
          description?: string | null;
          start_time?: string | null;
          end_time?: string | null;
          location?: string | null;
          status?: string | null;
          calendar_id: string;
          user_id: string;
          attendees?: any | null;
          recurrence?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          summary?: string | null;
          description?: string | null;
          start_time?: string | null;
          end_time?: string | null;
          location?: string | null;
          status?: string | null;
          calendar_id?: string;
          user_id?: string;
          attendees?: any | null;
          recurrence?: string | null;
          updated_at?: string;
        };
      };
      // List calendar events (for caching)
      list_calendar_event: {
        Row: {
          id: string;
          calendar_id: string | null;
          event_id: string;
          summary: string | null;
          description: string | null;
          start_time: string | null;
          end_time: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          calendar_id?: string | null;
          event_id: string;
          summary?: string | null;
          description?: string | null;
          start_time?: string | null;
          end_time?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          calendar_id?: string | null;
          event_id?: string;
          summary?: string | null;
          description?: string | null;
          start_time?: string | null;
          end_time?: string | null;
          updated_at?: string;
        };
      };
      // Tenant tokens for multi-tenancy
      tenant_tokens: {
        Row: {
          tenant_id: string;
          access_token: string;
          refresh_token: string;
          expiry_date: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          tenant_id: string;
          access_token: string;
          refresh_token: string;
          expiry_date: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          tenant_id?: string;
          access_token?: string;
          refresh_token?: string;
          expiry_date?: string;
          updated_at?: string;
        };
      };
    };
  };
}
