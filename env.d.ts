declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    MOTH_OWNER_USER_ID?: string;
    MOTH_OWNER_EMAIL?: string;
    PUBLIC_DEMO_MODE?: string;
    SITE_URL?: string;
  }
}
