import axios from "axios";

export interface TinyUrlRequest {
  url: string;
  domain?: string;
  alias?: string;
  tags?: string;
  expires_at?: string;
  description?: string;
}

export interface TinyUrlResponse {
  data: {
    url: string;
    domain: string;
    alias: string;
    tags: string[];
    tiny_url: string;
    expires_at: string | null;
    description: string;
  };
  code: number;
  errors: string[];
}

export class UrlShortenerService {
  private static readonly TINYURL_API_URL = "https://api.tinyurl.com/create";
  private static readonly API_KEY = process.env.TINYURL_API_KEY

  static async shortenUrl(longUrl: string, options?: {
    alias?: string;
    tags?: string;
    expires_at?: string;
    description?: string;
  }): Promise<string> {
    try {
      const requestBody: TinyUrlRequest = {
        url: longUrl,
        domain: "tinyurl.com",
        alias: options?.alias,
        description: options?.description
      };

      const response = await axios.post<TinyUrlResponse>(this.TINYURL_API_URL, requestBody, {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.API_KEY}`
        }
      });

      if (response.data.code !== 0) {
        throw new Error(`TinyURL API error: ${response.data.errors.join(", ")}`);
      }

      return response.data.data.tiny_url;
    } catch (error: any) {
      console.error("Error shortening URL:", error);

      // Fallback: return original URL if shortening fails
      if (error.response) {
        console.error("TinyURL API response error:", error.response.data);
      }

      console.warn("Falling back to original URL due to shortening failure");
      return longUrl;
    }
  }

  static async shortenAuthUrl(authUrl: string, userId?: string): Promise<string> {
    try {
      // Create a meaningful alias for the auth URL
      const alias = userId ? `auth-${userId}-${Date.now()}` : `auth-${Date.now()}`;

      // Set expiration to 30 minutes from now
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      const shortenedUrl = await this.shortenUrl(authUrl, {
        alias,
        tags: "telegram,auth,google",
        expires_at: expiresAt,
        description: "Telegram Google OAuth authentication URL"
      });

      return shortenedUrl;
    } catch (error) {
      console.error("Error shortening auth URL:", error);
      return authUrl; // Return original URL as fallback
    }
  }
}