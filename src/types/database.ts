export interface Database {
  public: {
    Tables: {
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
      posts: {
        Row: {
          id: string;
          title: string;
          content: string;
          user_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          content: string;
          user_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          content?: string;
          user_id?: string;
          updated_at?: string;
        };
      };
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
