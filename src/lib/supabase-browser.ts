"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser Supabase client for STAFF sign-in and MFA only. It uses the publishable key
// (safe to expose); it never touches commerce data, which is reachable only through the
// application API. Customers never use Supabase Auth (guest checkout).
let client: ReturnType<typeof createBrowserClient> | undefined;

export function staffAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Staff sign-in is not configured in this environment.");
  client ??= createBrowserClient(url, key);
  return client;
}
