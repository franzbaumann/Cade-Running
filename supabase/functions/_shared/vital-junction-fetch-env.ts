/** Shared env + pacing for Vital/Junction workout list API calls. */

export function getVitalHistoryStartDate(): string {
  const v = Deno.env.get("VITAL_HISTORY_START_DATE");
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return "2020-01-01";
}

export function getVitalWorkoutChunkDays(): number {
  const n = Number(Deno.env.get("VITAL_WORKOUT_CHUNK_DAYS") ?? "90");
  if (!Number.isFinite(n)) return 90;
  const i = Math.floor(n);
  return i >= 1 && i <= 366 ? i : 90;
}

export function getVitalRateLimitMs(): number {
  const n = Number(Deno.env.get("VITAL_RATE_LIMIT_MS") ?? "200");
  if (!Number.isFinite(n) || n < 0) return 200;
  return Math.floor(n);
}

export async function vitalJunctionDelay(): Promise<void> {
  const ms = getVitalRateLimitMs();
  if (ms <= 0) return;
  await new Promise((r) => setTimeout(r, ms));
}

/** Max cursor pages per (start_date, end_date) for full history chunk fetches. */
export function getVitalWorkoutMaxPagesChunked(): number {
  const n = Number(Deno.env.get("VITAL_WORKOUT_MAX_PAGES") ?? "100");
  if (!Number.isFinite(n) || n < 1) return 100;
  return Math.min(Math.floor(n), 500);
}

/** Max pages for initial endpoint probes (single date window). */
export function getVitalWorkoutMaxPagesProbe(): number {
  const n = Number(Deno.env.get("VITAL_WORKOUT_PROBE_MAX_PAGES") ?? "10");
  if (!Number.isFinite(n) || n < 1) return 10;
  return Math.min(Math.floor(n), 50);
}

/** True when workout upserts should be skipped (fetch + log only). */
export function isVitalBackfillDryRunEnv(): boolean {
  const a = Deno.env.get("DRY_RUN")?.trim();
  const b = Deno.env.get("VITAL_BACKFILL_DRY_RUN")?.trim();
  return a === "1" || b === "1" || b?.toLowerCase() === "true";
}

/**
 * Incremental workout list start: max(historyFloor, dayBefore(lastSync)) in calendar order.
 */
export function resolveVitalIncrementalStartDate(
  historyFloor: string,
  lastSyncedAtIso: string | null,
): string {
  if (!lastSyncedAtIso) return historyFloor;
  const d = new Date(lastSyncedAtIso);
  if (Number.isNaN(d.getTime())) return historyFloor;
  d.setUTCDate(d.getUTCDate() - 1);
  const inc = d.toISOString().slice(0, 10);
  return inc > historyFloor ? inc : historyFloor;
}
