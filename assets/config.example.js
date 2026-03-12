// Rename to `config.js` and fill with your Supabase values.
// This file is loaded by `index.html` BEFORE `app.js`.
// It is safe to expose the ANON key in the browser. The service role key must NEVER be in frontend.
window.__APP_CONFIG__ = {
  // Example: "https://xyzcompany.supabase.co"
  SUPABASE_URL: "",
  // Example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  SUPABASE_ANON_KEY: "",
  // Edge Function name used for shared storage
  SUPABASE_FUNCTION_NAME: "instructions",
};

