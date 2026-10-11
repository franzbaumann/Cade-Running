/**
 * vital-backfill — imports full workout history from Vital for a user.
 *
 * Unlike vital-sync (which also handles HRV, sleep, streams, resting HR, VO2max),
 * this function focuses exclusively on fetching ALL workout activities so it can
 * complete without timing out. It is intended to be called once from the Settings
 * page "Import all history" button.
 *
 * POST /vital-backfill
 * Headers: Authorization: Bearer <supabase_access_token>
 * Body (optional): { "start_date": "2022-01-01", "force_full_sync": true, "dry_run": true }
 *
 * Admin batch (requires VITAL_BACKFILL_ADMIN_SECRET):
 * Headers: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>, x-cade-admin-secret: <secret>
 * Body: { "all_vital_users": true } or { "user_id": "<uuid>", "force_full_sync": true }
 *
 * Response: { ok: true, activities_upserted: number, activities_skipped: number,
 *             workouts_received: number, detail?: string }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  getVitalHistoryStartDate,
  getVitalWorkoutChunkDays,
  getVitalWorkoutMaxPagesChunked,
  isVitalBackfillDryRunEnv,
  resolveVitalIncrementalStartDate,
  vitalJunctionDelay,
} from "../_shared/vital-junction-fetch-env.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Vital base URL ────────────────────────────────────────────────────────────

function getVitalBaseUrl(): string {
  const region = Deno.env.get("VITAL_REGION") ?? "us";
  const env = Deno.env.get("VITAL_ENVIRONMENT") ?? "production";
  const host =
    env === "sandbox"
      ? `api.sandbox.${region}.junction.com`
      : `api.${region}.junction.com`;
  return `https://${host}`;
}

// ─── Date helpers ──────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

// ─── Type helpers ──────────────────────────────────────────────────────────────

type Dict = Record<string, unknown>;

function asDict(value: unknown): Dict | null {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Dict)
    : null;
}

function asDictArray(value: unknown): Dict[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item) => item !== null && typeof item === "object",
  ) as Dict[];
}

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

function toDateFromUnknown(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms =
      value > 1_000_000_000_000
        ? value
        : value > 1_000_000_000
        ? value * 1000
        : NaN;
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return toDateFromUnknown(n);
    }
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}

// ─── Field extraction (mirrors vital-sync) ────────────────────────────────────

function metricValue(value: unknown): number | null {
  if (value == null) return null;
  const direct = toNum(value);
  if (direct != null) return direct;
  const obj = asDict(value);
  if (!obj) return null;
  return toNum(
    obj.value ?? obj.amount ?? obj.val ?? obj.total ?? obj.avg ??
      obj.average ?? obj.mean ?? obj.seconds ?? obj.duration ??
      obj.distance ?? obj.meters ?? obj.kilometers ?? obj.km ??
      obj.miles ?? obj.bpm ?? obj.max,
  );
}

function metricUnit(value: unknown): string | null {
  const obj = asDict(value);
  if (!obj) return null;
  return (
    firstString(obj.unit, obj.units, obj.uom, obj.measurement_unit)
      ?.toLowerCase() ?? null
  );
}

type DateParseSource = "event" | "fallback";

function extractWorkoutDate(
  workout: Dict,
  data: Dict,
): { date: string | null; source: DateParseSource } {
  const eventCandidates: unknown[] = [
    workout.start_time, workout.start_date, workout.start_date_local,
    workout.calendar_date, workout.local_start_time, workout.timestamp,
    workout.time, workout.datetime, data.start_time, data.start_date,
    data.start_date_local, data.calendar_date, data.local_start_time,
    data.timestamp, data.time, data.datetime,
    asDict(workout.time_start)?.value, asDict(data.time_start)?.value,
    asDict(workout.start)?.time, asDict(data.start)?.time,
  ];
  for (const candidate of eventCandidates) {
    const date = toDateFromUnknown(candidate);
    if (date) return { date, source: "event" };
  }
  const fallbackCandidates: unknown[] = [
    workout.date, data.date, workout.created_at, data.created_at,
    workout.updated_at, data.updated_at,
  ];
  for (const candidate of fallbackCandidates) {
    const date = toDateFromUnknown(candidate);
    if (date) return { date, source: "fallback" };
  }
  return { date: null, source: "fallback" };
}

function extractDistanceKm(workout: Dict, data: Dict): number | null {
  const candidates: unknown[] = [
    data.distance_meters, workout.distance_meters, data.distance,
    workout.distance, data.length, workout.length,
    asDict(data.distance)?.value, asDict(workout.distance)?.value,
    asDict(data.metrics)?.distance, asDict(workout.metrics)?.distance,
  ];
  const units: unknown[] = [
    data.distance_unit, workout.distance_unit,
    metricUnit(data.distance), metricUnit(workout.distance),
    metricUnit(asDict(data.metrics)?.distance),
    metricUnit(asDict(workout.metrics)?.distance),
  ];
  for (const candidate of candidates) {
    const raw = metricValue(candidate);
    if (raw == null || raw <= 0) continue;
    const unit = firstString(...units)?.toLowerCase() ?? "";
    if (unit.includes("mile")) return Math.round(raw * 1.60934 * 100) / 100;
    if (unit.includes("meter") || unit === "m")
      return Math.round((raw / 1000) * 100) / 100;
    if (unit.includes("km")) return Math.round(raw * 100) / 100;
    if (raw > 200) return Math.round((raw / 1000) * 100) / 100;
    return Math.round(raw * 100) / 100;
  }
  return null;
}

function extractDurationSeconds(workout: Dict, data: Dict): number | null {
  const candidates: unknown[] = [
    data.duration_seconds, workout.duration_seconds, data.duration,
    workout.duration, data.moving_time, workout.moving_time, data.elapsed_time,
    workout.elapsed_time, data.active_duration, workout.active_duration,
    asDict(data.duration)?.value, asDict(workout.duration)?.value,
    asDict(data.metrics)?.duration, asDict(workout.metrics)?.duration,
  ];
  const units: unknown[] = [
    metricUnit(data.duration), metricUnit(workout.duration),
    metricUnit(asDict(data.metrics)?.duration),
    metricUnit(asDict(workout.metrics)?.duration),
  ];
  for (const candidate of candidates) {
    const raw = metricValue(candidate);
    if (raw == null || raw <= 0) continue;
    const unit = firstString(...units)?.toLowerCase() ?? "";
    if (unit.includes("hour") || unit === "h") return Math.round(raw * 3600);
    if (unit.includes("min")) return Math.round(raw * 60);
    if (unit.includes("ms")) return Math.round(raw / 1000);
    if (raw > 86_400 * 3) return Math.round(raw / 1000);
    return Math.round(raw);
  }
  return null;
}

function paceFromAvgSpeed(avgSpeed: number | null): string | null {
  if (avgSpeed == null || avgSpeed <= 0) return null;
  const normalizedMps = avgSpeed > 15 ? avgSpeed / 3.6 : avgSpeed;
  if (normalizedMps <= 0) return null;
  const paceMin = 1000 / normalizedMps / 60;
  if (paceMin < 2 || paceMin > 25) return null;
  const minutes = Math.floor(paceMin);
  const seconds = Math.round((paceMin - minutes) * 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}/km`;
}

function extractHeartRate(
  workout: Dict,
  data: Dict,
): { avgHr: number | null; maxHr: number | null } {
  const hrObj =
    asDict(data.heart_rate) ?? asDict(data.heartrate) ?? asDict(data.hr) ??
    asDict(workout.heart_rate) ?? asDict(workout.heartrate) ??
    asDict(workout.hr) ?? null;
  const avgHr = metricValue(
    hrObj?.avg ?? hrObj?.average ?? hrObj?.avg_bpm ?? hrObj?.mean ??
      data.average_heartrate ?? data.avg_hr ??
      workout.average_heartrate ?? workout.avg_hr,
  );
  const maxHr = metricValue(
    hrObj?.max ?? hrObj?.max_bpm ??
      data.max_heartrate ?? data.max_hr ??
      workout.max_heartrate ?? workout.max_hr,
  );
  return {
    avgHr: avgHr != null ? Math.round(avgHr) : null,
    maxHr: maxHr != null ? Math.round(maxHr) : null,
  };
}

function inferActivityType(workout: Dict, data: Dict): string {
  const sportObj =
    asDict(workout.sport) ?? asDict(data.sport) ?? null;
  const sportSlug = String(
    sportObj?.slug ?? sportObj?.name ?? sportObj?.type ??
      data.type ?? data.activity_type ??
      workout.type ?? workout.activity_type ?? "run",
  ).toLowerCase();
  if (sportSlug.includes("run")) return "Run";
  if (sportSlug.includes("ride") || sportSlug.includes("cycl")) return "Ride";
  if (sportSlug.includes("walk") || sportSlug.includes("hike")) return "Walk";
  if (sportSlug.includes("swim")) return "Swim";
  if (sportSlug.includes("strength") || sportSlug.includes("gym"))
    return "Strength";
  return "Run";
}

// ─── Pagination helpers ────────────────────────────────────────────────────────

function extractArrayPayload(payload: unknown): Dict[] {
  if (Array.isArray(payload)) return asDictArray(payload);
  const obj = asDict(payload);
  if (!obj) return [];
  const directKeys = ["workouts", "activities", "data", "results", "items"];
  for (const key of directKeys) {
    const arr = asDictArray(obj[key]);
    if (arr.length > 0) return arr;
  }
  const nestedData = asDict(obj.data);
  if (nestedData) {
    for (const key of directKeys) {
      const arr = asDictArray(nestedData[key]);
      if (arr.length > 0) return arr;
    }
  }
  return [];
}

function extractNextCursor(payload: unknown): string | null {
  const obj = asDict(payload);
  if (!obj) return null;
  const direct = firstString(
    obj.next_cursor,
    obj.nextCursor,
    obj.cursor,
    obj.next,
  );
  if (direct) return direct;
  const pagination = asDict(obj.pagination);
  return firstString(
    pagination?.next_cursor,
    pagination?.nextCursor,
    pagination?.cursor,
    pagination?.next,
  );
}

// ─── Fetch helpers ─────────────────────────────────────────────────────────────

interface DateWindow {
  start: string;
  end: string;
}

async function fetchPagedWorkouts(
  endpoint: string,
  headers: Record<string, string>,
  maxOverrides?: number,
): Promise<{ workouts: Dict[]; pages: number; ok: boolean; status: number; detail?: string }> {
  const maxPages = maxOverrides ?? getVitalWorkoutMaxPagesChunked();
  const workouts: Dict[] = [];
  let pages = 0;
  let cursor: string | null = null;

  while (pages < maxPages) {
    pages += 1;
    const url = new URL(endpoint);
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { workouts, pages, ok: false, status: res.status, detail: detail.slice(0, 400) };
    }

    const payload = (await res.json().catch(() => ({}))) as unknown;
    workouts.push(...extractArrayPayload(payload));

    const next = extractNextCursor(payload);
    if (!next || next === cursor) {
      return { workouts, pages, ok: true, status: res.status };
    }
    cursor = next;
    await vitalJunctionDelay();
  }

  return {
    workouts,
    pages,
    ok: true,
    status: 200,
    detail: `Stopped at ${maxPages} pages`,
  };
}

function buildDateWindows(
  startIso: string,
  endIso: string,
  chunkDays: number,
): DateWindow[] {
  const windows: DateWindow[] = [];
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start > end
  ) {
    return windows;
  }
  let cursor = new Date(start);
  while (cursor <= end) {
    const next = new Date(cursor);
    next.setUTCDate(next.getUTCDate() + chunkDays - 1);
    const windowEnd = next < end ? next : end;
    windows.push({
      start: cursor.toISOString().slice(0, 10),
      end: windowEnd.toISOString().slice(0, 10),
    });
    cursor = new Date(windowEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return windows;
}

// ─── Stable key / dedup helpers ───────────────────────────────────────────────

function stableWorkoutKey(workout: Dict): string | null {
  const payload = asDict(workout.data) ?? workout;
  return firstString(
    workout.id, workout.workout_id, workout.activity_id, workout.source_id,
    payload.id, payload.workout_id, payload.activity_id, payload.source_id,
    firstString(
      workout.start_time, workout.timestamp,
      payload.start_time, payload.timestamp,
    ),
  );
}

function workoutScore(workout: Dict): number {
  const payload = asDict(workout.data) ?? workout;
  const parsedDate = extractWorkoutDate(workout, payload);
  const distanceKm = extractDistanceKm(workout, payload);
  const durationSecs = extractDurationSeconds(workout, payload);
  const { avgHr, maxHr } = extractHeartRate(workout, payload);
  let score = 0;
  if (parsedDate.date) score += parsedDate.source === "event" ? 5 : 2;
  if (distanceKm != null) score += 2;
  if (durationSecs != null) score += 2;
  if (avgHr != null || maxHr != null) score += 1;
  return score;
}

function resolveBackfillStartDate(params: {
  bodyStart: string | undefined;
  forceFull: boolean;
  lastSyncedAt: string | null;
  historyFloor: string;
}): string {
  if (params.bodyStart && /^\d{4}-\d{2}-\d{2}$/.test(params.bodyStart)) {
    return params.bodyStart;
  }
  if (params.forceFull || !params.lastSyncedAt) {
    return params.historyFloor;
  }
  return resolveVitalIncrementalStartDate(params.historyFloor, params.lastSyncedAt);
}

interface VitalBackfillCoreResult {
  ok: boolean;
  activities_upserted: number;
  activities_skipped: number;
  workouts_received: number;
  start_date: string;
  end_date: string;
  dry_run: boolean;
  error?: string;
  detail?: string;
}

async function runVitalWorkoutBackfillCore(params: {
  supabaseAdmin: ReturnType<typeof createClient>;
  userId: string;
  vitalUserId: string;
  startDate: string;
  requestId: string;
  dryRun: boolean;
}): Promise<VitalBackfillCoreResult> {
  const { supabaseAdmin, userId, vitalUserId, startDate, requestId, dryRun } = params;
  const endDate = todayStr();
  const apiKey = Deno.env.get("VITAL_API_KEY")!;
    const baseUrl = getVitalBaseUrl();
    const headers = { "x-vital-api-key": apiKey, Accept: "application/json" };

    console.log("[vital-backfill] starting backfill", {
    user_id: userId,
      vital_user_id: vitalUserId,
      start_date: startDate,
      end_date: endDate,
    dry_run: dryRun,
      request_id: requestId,
    });

    const probeStart = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 90);
      return d.toISOString().split("T")[0];
    })();

    const endpointBases = [
      `${baseUrl}/v2/summary/workouts/${vitalUserId}/raw`,
      `${baseUrl}/v2/summary/workouts/${vitalUserId}`,
      `${baseUrl}/v2/activity/user_id/${vitalUserId}`,
      `${baseUrl}/v2/activity/${vitalUserId}`,
      `${baseUrl}/v2/activity/${vitalUserId}/raw`,
    ];

    const successfulBases: { base: string; count: number }[] = [];

    for (const base of endpointBases) {
      const probeEndpoint = `${base}?start_date=${probeStart}&end_date=${endDate}`;
      const result = await fetchPagedWorkouts(probeEndpoint, headers, 3);
      if (result.ok) {
        successfulBases.push({ base, count: result.workouts.length });
        console.log("[vital-backfill] probe ok", { base, count: result.workouts.length });
      } else {
      console.log("[vital-backfill] probe failed", {
        base,
        status: result.status,
        unsupported: [400, 404, 405, 410, 422].includes(result.status),
      });
    }
    await vitalJunctionDelay();
    }

    if (successfulBases.length === 0) {
    return {
        ok: false,
        error: "No Vital workout endpoint responded successfully",
        detail: "Make sure your device is synced in Vital and try again.",
        activities_upserted: 0,
        activities_skipped: 0,
        workouts_received: 0,
      start_date: startDate,
      end_date: endDate,
      dry_run: dryRun,
    };
    }

    const topBases = successfulBases
      .sort((a, b) => b.count - a.count)
      .slice(0, 2)
      .map((x) => x.base);

  const windows = buildDateWindows(startDate, endDate, getVitalWorkoutChunkDays());
  const chunkMaxPages = getVitalWorkoutMaxPagesChunked();
    const workoutsByKey = new Map<string, Dict>();

    for (const base of topBases) {
      for (const window of windows) {
        const endpoint = `${base}?start_date=${window.start}&end_date=${window.end}`;
      const result = await fetchPagedWorkouts(endpoint, headers, chunkMaxPages);

        if (!result.ok) {
          console.warn("[vital-backfill] window fetch failed", {
            base,
            window,
            status: result.status,
          detail: result.detail,
          });
        await vitalJunctionDelay();
          continue;
        }

      if (result.detail?.startsWith("Stopped at")) {
        console.warn("[vital-backfill] window pagination cap", {
          base,
          window,
          pages: result.pages,
          workouts: result.workouts.length,
          detail: result.detail,
        });
      }

        for (const workout of result.workouts) {
          const key = stableWorkoutKey(workout);
          if (!key) continue;
          const existing = workoutsByKey.get(key);
          if (!existing || workoutScore(workout) > workoutScore(existing)) {
            workoutsByKey.set(key, workout);
          }
        }
      await vitalJunctionDelay();
      }
    }

    const allWorkouts = [...workoutsByKey.values()];
    console.log("[vital-backfill] fetched deduped workouts", {
      total: allWorkouts.length,
      bases: topBases,
    });

    let activitiesUpserted = 0;
    let activitiesSkipped = 0;

  if (dryRun) {
    console.log("[vital-backfill] DRY_RUN: skipping activity upserts", {
      workouts_received: allWorkouts.length,
    });
    return {
      ok: true,
      activities_upserted: 0,
      activities_skipped: 0,
      workouts_received: allWorkouts.length,
      start_date: startDate,
      end_date: endDate,
      dry_run: true,
      detail: "DRY_RUN: no rows written",
    };
  }

    for (const w of allWorkouts) {
      const data = asDict(w.data) ?? w;

      const id = firstString(
        w.id, w.workout_id, w.activity_id, w.source_id,
        data.id, data.workout_id, data.activity_id, data.source_id,
      );
      if (!id) {
        activitiesSkipped += 1;
        continue;
      }

      const parsedDate = extractWorkoutDate(w, data);
      if (!parsedDate.date) {
        activitiesSkipped += 1;
        continue;
      }

      const distanceKm = extractDistanceKm(w, data);
      const durationSeconds = extractDurationSeconds(w, data);
      const avgSpeed = metricValue(
        data.average_speed ?? data.speed ??
          w.average_speed ?? w.speed ??
          asDict(data.pace)?.speed,
      );
      const avgPace =
        firstString(data.avg_pace, data.pace, w.avg_pace, w.pace) ??
        paceFromAvgSpeed(avgSpeed);
      const { avgHr, maxHr } = extractHeartRate(w, data);
      const cadence = metricValue(
        data.cadence ?? data.average_cadence ?? w.cadence ?? w.average_cadence,
      );
      const elevationGain = metricValue(
        data.elevation_gain ?? data.total_elevation_gain ??
          w.elevation_gain ?? w.total_elevation_gain,
      );
      const activityType = inferActivityType(w, data);

      const { error } = await supabaseAdmin.from("activity").upsert(
        {
        user_id: userId,
          date: parsedDate.date,
          type: activityType,
          name: firstString(data.name, data.title, w.name, w.title),
          distance_km: distanceKm,
          duration_seconds:
            durationSeconds != null && durationSeconds > 0
              ? Math.round(durationSeconds)
              : null,
          avg_pace: avgPace,
          avg_hr: avgHr,
          max_hr: maxHr,
          cadence: cadence != null ? Math.round(cadence) : null,
          elevation_gain: elevationGain,
          source: "vital",
          vital_id: id,
          external_id: id,
        },
        { onConflict: "user_id,vital_id" },
      );

      if (error) {
        console.warn("[vital-backfill] upsert failed", {
          id,
          date: parsedDate.date,
          error: error.message,
        });
        activitiesSkipped += 1;
      } else {
        activitiesUpserted += 1;
      }
    }

  const { error: markErr } = await supabaseAdmin
    .from("integrations")
    .update({ vital_last_workout_sync_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("provider", "vital");
  if (markErr) {
    console.warn("[vital-backfill] vital_last_workout_sync_at update failed", markErr.message);
  }

    console.log("[vital-backfill] done", {
      activities_upserted: activitiesUpserted,
      activities_skipped: activitiesSkipped,
      workouts_received: allWorkouts.length,
    });

  return {
      ok: true,
      activities_upserted: activitiesUpserted,
      activities_skipped: activitiesSkipped,
      workouts_received: allWorkouts.length,
      start_date: startDate,
      end_date: endDate,
    dry_run: false,
  };
}

function parseBackfillBody(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const requestId =
    req.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    const rawBody = req.method === "POST" ? await req.text().catch(() => "") : "";
    const body = parseBackfillBody(rawBody);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header", request_id: requestId }, 401);
    }

    const apiKey = Deno.env.get("VITAL_API_KEY");
    if (!apiKey) {
      return json({ error: "Vital API key not configured", request_id: requestId }, 500);
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const adminSecretConfigured = Deno.env.get("VITAL_BACKFILL_ADMIN_SECRET") ?? "";
    const adminHeader = req.headers.get("x-cade-admin-secret") ?? "";
    const isAdminRequest =
      adminSecretConfigured !== "" &&
      token === serviceRole &&
      adminHeader === adminSecretConfigured;

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const historyFloor = getVitalHistoryStartDate();
    const dryRun =
      isVitalBackfillDryRunEnv() || body.dry_run === true || body.dry_run === "true";
    const bodyStart = typeof body.start_date === "string" ? body.start_date : undefined;
    const forceFull =
      body.force_full_sync === true || body.force_full_sync === "true";

    if (isAdminRequest) {
      const allVitalUsers =
        body.all_vital_users === true || body.all_vital_users === "true";
      const targetUserId = typeof body.user_id === "string" ? body.user_id : undefined;

      if (allVitalUsers) {
        const { data: rows, error: listErr } = await supabaseAdmin
          .from("integrations")
          .select("user_id, athlete_id, vital_last_workout_sync_at")
          .eq("provider", "vital")
          .neq("athlete_id", "");

        if (listErr) {
          return json({ error: listErr.message, request_id: requestId }, 500);
        }

        const results: Array<
          Record<string, unknown> & { user_id: string; ok: boolean }
        > = [];

        for (const row of rows ?? []) {
          const uid = row.user_id as string;
          const aid = row.athlete_id as string;
          if (!aid?.trim()) continue;

          const lastSync = row.vital_last_workout_sync_at != null
            ? String(row.vital_last_workout_sync_at)
            : null;
          const startDate = resolveBackfillStartDate({
            bodyStart,
            forceFull,
            lastSyncedAt: lastSync,
            historyFloor,
          });

          try {
            const core = await runVitalWorkoutBackfillCore({
              supabaseAdmin,
              userId: uid,
              vitalUserId: aid,
              startDate,
              requestId,
              dryRun,
            });
            results.push({
              user_id: uid,
              ok: core.ok,
              activities_upserted: core.activities_upserted,
              activities_skipped: core.activities_skipped,
              workouts_received: core.workouts_received,
              start_date: core.start_date,
              end_date: core.end_date,
              dry_run: core.dry_run,
              error: core.error,
              detail: core.detail,
            });
          } catch (e) {
            console.error("[vital-backfill] batch user failed", uid, e);
            results.push({
              user_id: uid,
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }

        return json({
          ok: true,
          batch: true,
          users_processed: results.length,
          results,
          request_id: requestId,
        });
      }

      if (!targetUserId) {
        return json({
          error: "Admin backfill requires all_vital_users: true or user_id",
          request_id: requestId,
        }, 400);
      }

      const { data: integ, error: integErr } = await supabaseAdmin
        .from("integrations")
        .select("athlete_id, vital_last_workout_sync_at")
        .eq("user_id", targetUserId)
        .eq("provider", "vital")
        .maybeSingle();

      if (integErr) {
        return json({ error: integErr.message, request_id: requestId }, 500);
      }
      if (!integ?.athlete_id) {
        return json({ error: "Vital not connected for user", request_id: requestId }, 404);
      }

      const lastSync = integ.vital_last_workout_sync_at != null
        ? String(integ.vital_last_workout_sync_at)
        : null;
      const startDate = resolveBackfillStartDate({
        bodyStart,
        forceFull,
        lastSyncedAt: lastSync,
        historyFloor,
      });

      const core = await runVitalWorkoutBackfillCore({
        supabaseAdmin,
        userId: targetUserId,
        vitalUserId: String(integ.athlete_id),
        startDate,
        requestId,
        dryRun,
      });

      if (!core.ok) {
        return json({
          ok: false,
          error: core.error,
          detail: core.detail,
          activities_upserted: core.activities_upserted,
          activities_skipped: core.activities_skipped,
          workouts_received: core.workouts_received,
          request_id: requestId,
        }, 502);
      }

      return json({
        ok: true,
        admin: true,
        activities_upserted: core.activities_upserted,
        activities_skipped: core.activities_skipped,
        workouts_received: core.workouts_received,
        start_date: core.start_date,
        end_date: core.end_date,
        dry_run: core.dry_run,
        detail: core.detail,
        request_id: requestId,
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser(token);
    if (userError || !user) {
      return json({ error: "Unauthorized", request_id: requestId }, 401);
    }

    const { data: integration, error: integrationError } = await supabaseAdmin
      .from("integrations")
      .select("athlete_id, vital_last_workout_sync_at")
      .eq("user_id", user.id)
      .eq("provider", "vital")
      .maybeSingle();

    if (integrationError) {
      return json({ error: integrationError.message, request_id: requestId }, 500);
    }

    if (!integration?.athlete_id) {
      return json({ error: "Vital not connected", request_id: requestId }, 404);
    }

    const lastSyncUser = integration.vital_last_workout_sync_at != null
      ? String(integration.vital_last_workout_sync_at)
      : null;
    const startDate = resolveBackfillStartDate({
      bodyStart,
      forceFull,
      lastSyncedAt: lastSyncUser,
      historyFloor,
    });

    const core = await runVitalWorkoutBackfillCore({
      supabaseAdmin,
      userId: user.id,
      vitalUserId: String(integration.athlete_id),
      startDate,
      requestId,
      dryRun,
    });

    if (!core.ok) {
      return json({
        ok: false,
        error: core.error,
        detail: core.detail,
        activities_upserted: core.activities_upserted,
        activities_skipped: core.activities_skipped,
        workouts_received: core.workouts_received,
        request_id: requestId,
      }, 502);
    }

    return json({
      ok: true,
      activities_upserted: core.activities_upserted,
      activities_skipped: core.activities_skipped,
      workouts_received: core.workouts_received,
      start_date: core.start_date,
      end_date: core.end_date,
      dry_run: core.dry_run,
      detail: core.detail,
      request_id: requestId,
    });
  } catch (err) {
    console.error("[vital-backfill] unexpected error", err);
    return json(
      {
        error: "Unexpected error during backfill",
        detail: err instanceof Error ? err.message : String(err),
        request_id: requestId,
      },
      500,
    );
  }
});
