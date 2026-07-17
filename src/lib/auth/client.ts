"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getPublicEnvironment } from "@/lib/public-env";

export function createClient() {
  const { supabaseUrl, supabasePublishableKey } = getPublicEnvironment();

  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
