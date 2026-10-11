/**
 * Batch Vital workout history backfill via Edge Function (admin mode).
 *
 * Requires in .env (or .env.local):
 *   SUPABASE_SERVICE_ROLE_KEY
 *   VITAL_BACKFILL_ADMIN_SECRET  — must match Supabase secret VITAL_BACKFILL_ADMIN_SECRET
 *
 * Optional:
 *   SUPABASE_URL  — defaults to getSupabaseUrl() from repo
 *   DRY_RUN=1      — passed in JSON body; fetch only, no DB writes
 *
 * Usage:
 *   npx tsx src/scripts/backfillVitalActivities.ts
 *   npx tsx src/scripts/backfillVitalActivities.ts --user=<uuid>
 *   DRY_RUN=1 npx tsx src/scripts/backfillVitalActivities.ts
 */

import { loadProjectEnv } from "./loadProjectEnv";
import { getSupabaseUrl } from "../lib/supabase-url";

loadProjectEnv();

const baseUrl = process.env.SUPABASE_URL?.trim() || getSupabaseUrl();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const adminSecret = process.env.VITAL_BACKFILL_ADMIN_SECRET?.trim();
const dryRun = process.env.DRY_RUN === "1";

function argUserId(): string | undefined {
  const a = process.argv.find((x) => x.startsWith("--user="));
  if (!a) return undefined;
  return a.slice("--user=".length).trim() || undefined;
}

async function main(): Promise<void> {
  if (!serviceKey) {
    console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!adminSecret) {
    console.error("Missing VITAL_BACKFILL_ADMIN_SECRET (set in .env and Supabase Edge secrets)");
    process.exit(1);
  }

  const userId = argUserId();
  const body: Record<string, unknown> = {
    force_full_sync: true,
    dry_run: dryRun,
  };
  if (userId) body.user_id = userId;
  else body.all_vital_users = true;

  const url = `${baseUrl.replace(/\/$/, "")}/functions/v1/vital-backfill`;
  console.log("POST", url, { batch: !userId, userId, dryRun });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      "x-cade-admin-secret": adminSecret,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  try {
    const json = JSON.parse(text) as unknown;
    console.log(JSON.stringify(json, null, 2));
  } catch {
    console.log(text);
  }

  if (!res.ok) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
