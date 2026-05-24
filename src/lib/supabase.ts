import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabaseDebugConfig = {
  url: supabaseUrl,
  publishableKeyPresent: Boolean(supabasePublishableKey),
  publishableKeyPrefix: supabasePublishableKey ? supabasePublishableKey.slice(0, 24) : "",
};

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

export function getAccessToken() {
  return supabase.auth.getSession().then(({ data }) => data.session?.access_token ?? null);
}
