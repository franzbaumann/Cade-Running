import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  avg,
  buildHrZonesSeries,
  computeCadenceConsistency,
  computeCardiacDrift,
  computeHrZoneTimesFromSamples,
  computePaceEfficiency,
} from "../_shared/activity-stream-metrics.ts";
import {
  deriveKmSplitsFromDistanceTime,
  fetchVitalWorkoutStreamPayload,
  normalizeVitalStreamPayload,
} from "../_shared/vital-workout-stream.ts";
import {
  getVitalHistoryStartDate,
  getVitalWorkoutChunkDays,
  getVitalWorkoutMaxPagesChunked,
  getVitalWorkoutMaxPagesProbe,
  resolveVitalIncrementalStartDate,
  vitalJunctionDelay,
} from "../_shared/vital-junction-fetch-env.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getVitalBaseUrl(): string {
  const region = Deno.env.get("VITAL_REGION") ?? "us";
  const env = Deno.env.get("VITAL_ENVIRONMENT") ?? "production";
  const host = env === "sandbox" ? `api.sandbox.${region}.junction.com` : `api.${region}.junction.com`;
  return `https://${host}`;
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

type Dict = Record<string, unknown>;

function asDict(value: unknown): Dict | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Dict)
    : null;
}

function asDictArray(value: unknown): Dict[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item !== null && typeof item === "object") as Dict[];
}

function toNum(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
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
    const ms = value > 1_000_000_000_000 ? value : value > 1_000_000_000 ? value * 1000 : NaN;
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

function metricValue(value: unknown): number | null {
  if (value == null) return null;
  const direct = toNum(value);
  if (direct != null) return direct;
  const obj = asDict(value);
  if (!obj) return null;
  return toNum(
    obj.value ?? obj.amount ?? obj.val ?? obj.total ?? obj.avg ?? obj.average ?? obj.mean ??
    obj.seconds ?? obj.duration ?? obj.distance ?? obj.meters ?? obj.kilometers ?? obj.km ??
    obj.miles ?? obj.bpm ?? obj.max
  );
}

function metricUnit(value: unknown): string | null {
  const obj = asDict(value);
  if (!obj) return null;
  return firstString(obj.unit, obj.units, obj.uom, obj.measurement_unit)?.toLowerCase() ?? null;
}

type DateParseSource = "event" | "fallback";

function extractWorkoutDate(workout: Dict, data: Dict): { date: string | null; source: DateParseSource } {
  const eventCandidates: unknown[] = [
    workout.start_time,
    workout.start_date,
    workout.start_date_local,
    workout.calendar_date,
    workout.local_start_time,
    workout.timestamp,
    workout.time,
    workout.datetime,
    data.start_time,
    data.start_date,
    data.start_date_local,
    data.calendar_date,
    data.local_start_time,
    data.timestamp,
    data.time,
    data.datetime,
    asDict(workout.time_start)?.value,
    asDict(data.time_start)?.value,
    asDict(workout.start)?.time,
    asDict(data.start)?.time,
  ];
  for (const candidate of eventCandidates) {
    const date = toDateFromUnknown(candidate);
    if (date) return { date, source: "event" };
  }

  const fallbackCandidates: unknown[] = [
    workout.date,
    data.date,
    workout.created_at,
    data.created_at,
    workout.updated_at,
    data.updated_at,
  ];
  for (const candidate of fallbackCandidates) {
    const date = toDateFromUnknown(candidate);
    if (date) return { date, source: "fallback" };
  }
  return { date: null, source: "fallback" };
}

function extractDistanceKm(workout: Dict, data: Dict): number | null {
  const candidates: unknown[] = [
    data.distance_meters,
    workout.distance_meters,
    data.distance,
    workout.distance,
    data.length,
    workout.length,
    asDict(data.distance)?.value,
    asDict(workout.distance)?.value,
    asDict(data.metrics)?.distance,
    asDict(workout.metrics)?.distance,
  ];
  const units: unknown[] = [
    data.distance_unit,
    workout.distance_unit,
    metricUnit(data.distance),
    metricUnit(workout.distance),
    metricUnit(asDict(data.metrics)?.distance),
    metricUnit(asDict(workout.metrics)?.distance),
  ];
  for (const candidate of candidates) {
    const raw = metricValue(candidate);
    if (raw == null || raw <= 0) continue;
    const unit = firstString(...units)?.toLowerCase() ?? "";
    if (unit.includes("mile")) return Math.round(raw * 1.60934 * 100) / 100;
    if (unit.includes("meter") || unit === "m") return Math.round((raw / 1000) * 100) / 100;
    if (unit.includes("km")) return Math.round(raw * 100) / 100;
    if (raw > 200) return Math.round((raw / 1000) * 100) / 100;
    return Math.round(raw * 100) / 100;
  }
  return null;
}

function extractDurationSeconds(workout: Dict, data: Dict): number | null {
  const candidates: unknown[] = [
    data.duration_seconds,
    workout.duration_seconds,
    data.duration,
    workout.duration,
    data.moving_time,
    workout.moving_time,
    data.elapsed_time,
    workout.elapsed_time,
    data.active_duration,
    workout.active_duration,
    asDict(data.duration)?.value,
    asDict(workout.duration)?.value,
    asDict(data.metrics)?.duration,
    asDict(workout.metrics)?.duration,
  ];
  const units: unknown[] = [
    metricUnit(data.duration),
    metricUnit(workout.duration),
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

function extractHeartRate(workout: Dict, data: Dict): { avgHr: number | null; maxHr: number | null } {
  const hrObj = asDict(data.heart_rate) ?? asDict(data.heartrate) ?? asDict(data.hr) ??
    asDict(workout.heart_rate) ?? asDict(workout.heartrate) ?? asDict(workout.hr) ?? null;
  const avgHr = metricValue(
    hrObj?.avg ?? hrObj?.average ?? hrObj?.avg_bpm ?? hrObj?.mean ??
    data.average_heartrate ?? data.avg_hr ?? workout.average_heartrate ?? workout.avg_hr
  );
  const maxHr = metricValue(
    hrObj?.max ?? hrObj?.max_bpm ??
    data.max_heartrate ?? data.max_hr ?? workout.max_heartrate ?? workout.max_hr
  );
  return {
    avgHr: avgHr != null ? Math.round(avgHr) : null,
    maxHr: maxHr != null ? Math.round(maxHr) : null,
  };
}

function inferActivityType(workout: Dict, data: Dict): string {
  const sportObj = asDict(workout.sport) ?? asDict(data.sport) ?? null;
  const sportSlug = String(
    sportObj?.slug ??
    sportObj?.name ??
    sportObj?.type ??
    data.type ??
    data.activity_type ??
    workout.type ??
    workout.activity_type ??
    "run"
  ).toLowerCase();
  if (sportSlug.includes("run")) return "Run";
  if (sportSlug.includes("ride") || sportSlug.includes("cycl")) return "Ride";
  if (sportSlug.includes("walk") || sportSlug.includes("hike")) return "Walk";
  if (sportSlug.includes("swim")) return "Swim";
  if (sportSlug.includes("strength") || sportSlug.includes("gym")) return "Strength";
  return "Run";
}

function extractArrayPayload(payload: unknown): Dict[] {
  if (Array.isArray(payload)) return asDictArray(payload);
  const obj = asDict(payload);
  if (!obj) return [];

  const directKeys = [
    "workouts",
    "activities",
    "data",
    "results",
    "items",
  ];
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

interface EndpointAttempt {
  endpoint: string;
  status: number;
  pages: number;
  received: number;
  detail?: string;
}

interface ProviderCapability {
  fetched: boolean;
  fetch_status: number | null;
  providers: string[];
  workouts_supported: boolean | null;
  detail?: string;
}

interface DateWindow {
  start: string;
  end: string;
}

async function fetchWorkoutsFromEndpoint(
  endpoint: string,
  headers: Record<string, string>,
  options?: { maxPages?: number },
): Promise<{ workouts: Dict[]; attempt: EndpointAttempt; ok: boolean }> {
  const maxPages = options?.maxPages ?? getVitalWorkoutMaxPagesProbe();
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
      return {
        workouts,
        ok: false,
        attempt: {
          endpoint,
          status: res.status,
          pages,
          received: workouts.length,
          detail: detail.slice(0, 400),
        },
      };
    }

    const payload = (await res.json().catch(() => ({}))) as unknown;
    workouts.push(...extractArrayPayload(payload));
    const next = extractNextCursor(payload);
    if (!next || next === cursor) {
      return {
        workouts,
        ok: true,
        attempt: {
          endpoint,
          status: res.status,
          pages,
          received: workouts.length,
        },
      };
    }
    cursor = next;
    await vitalJunctionDelay();
  }

  return {
    workouts,
    ok: true,
    attempt: {
      endpoint,
      status: 200,
      pages,
      received: workouts.length,
      detail: `Stopped pagination at ${maxPages} pages limit`,
    },
  };
}

function buildDateWindows(startIso: string, endIso: string, chunkDays: number): DateWindow[] {
  const windows: DateWindow[] = [];
  const start = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
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

async function fetchWorkoutsChunked(
  endpointBase: string,
  windows: DateWindow[],
  headers: Record<string, string>,
): Promise<{ workouts: Dict[]; attempts: EndpointAttempt[]; ok: boolean; partialError?: string }> {
  const attempts: EndpointAttempt[] = [];
  const workoutsById = new Map<string, Dict>();
  let successfulWindows = 0;
  let partialError: string | undefined;
  const chunkMaxPages = getVitalWorkoutMaxPagesChunked();

  for (const window of windows) {
    const endpoint = `${endpointBase}?start_date=${window.start}&end_date=${window.end}`;
    const fetched = await fetchWorkoutsFromEndpoint(endpoint, headers, { maxPages: chunkMaxPages });
    attempts.push(fetched.attempt);

    if (!fetched.ok) {
      console.warn("[vital-sync] chunk window failed", {
        endpointBase,
        window,
        status: fetched.attempt.status,
        detail: fetched.attempt.detail,
        pages: fetched.attempt.pages,
      });
      const unsupported = [400, 404, 405, 410, 422].includes(fetched.attempt.status);
      if (unsupported && successfulWindows === 0) {
        return { workouts: [], attempts, ok: false, partialError: fetched.attempt.detail };
      }
      partialError = `Some date windows failed (${fetched.attempt.status}) while backfilling history.`;
      await vitalJunctionDelay();
      continue;
    }

    successfulWindows += 1;
    for (const workout of fetched.workouts) {
      const payload = asDict(workout.data) ?? workout;
      const key = firstString(
        workout.id,
        workout.workout_id,
        workout.activity_id,
        workout.source_id,
        payload.id,
        payload.workout_id,
        payload.activity_id,
        payload.source_id,
        firstString(workout.start_time, workout.timestamp, payload.start_time, payload.timestamp),
      );
      if (!key) continue;
      workoutsById.set(key, workout);
    }
    await vitalJunctionDelay();
  }

  if (successfulWindows === 0) {
    return { workouts: [], attempts, ok: false, partialError };
  }
  return { workouts: [...workoutsById.values()], attempts, ok: true, partialError };
}

function parseProvidersFromPayload(payload: unknown): string[] {
  const names = new Set<string>();
  const rows = extractArrayPayload(payload);
  for (const row of rows) {
    const provider = firstString(
      row.provider,
      row.name,
      row.slug,
      row.source,
      asDict(row.provider)?.name,
      asDict(row.provider)?.slug,
    );
    if (provider) names.add(provider.toLowerCase());
  }
  const root = asDict(payload);
  if (root) {
    const rootProvider = firstString(root.provider, root.name, root.slug, root.source);
    if (rootProvider) names.add(rootProvider.toLowerCase());
  }
  return [...names];
}

function parseWorkoutSupportFromPayload(payload: unknown): boolean | null {
  const rows = extractArrayPayload(payload);
  let hasSignal = false;
  for (const row of rows) {
    const supports = row.supports_workouts;
    const hasWorkouts = row.has_workouts;
    const workoutsAvailable = row.workouts_available;
    if (typeof supports === "boolean") {
      hasSignal = true;
      if (supports) return true;
    }
    if (typeof hasWorkouts === "boolean") {
      hasSignal = true;
      if (hasWorkouts) return true;
    }
    if (typeof workoutsAvailable === "boolean") {
      hasSignal = true;
      if (workoutsAvailable) return true;
    }
    const capabilities = asDict(row.capabilities);
    if (capabilities) {
      const capSupports = capabilities.supports_workouts;
      if (typeof capSupports === "boolean") {
        hasSignal = true;
        if (capSupports) return true;
      }
      const resources = capabilities.resources;
      if (Array.isArray(resources)) {
        hasSignal = true;
        const hasWorkoutResource = resources.some((r) =>
          typeof r === "string" && r.toLowerCase().includes("workout")
        );
        if (hasWorkoutResource) return true;
      }
    }
  }
  return hasSignal ? false : null;
}

async function fetchProviderCapability(
  baseUrl: string,
  vitalUserId: string,
  headers: Record<string, string>,
): Promise<ProviderCapability> {
  const endpoints = [
    `${baseUrl}/v2/user/${vitalUserId}`,
    `${baseUrl}/v2/user/${vitalUserId}/providers`,
    `${baseUrl}/v2/user/providers/${vitalUserId}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, { headers });
      if (!res.ok) continue;
      const payload = (await res.json().catch(() => ({}))) as unknown;
      return {
        fetched: true,
        fetch_status: res.status,
        providers: parseProvidersFromPayload(payload),
        workouts_supported: parseWorkoutSupportFromPayload(payload),
      };
    } catch {
      // Ignore provider capability errors; sync can proceed without this info.
    }
  }

  return {
    fetched: false,
    fetch_status: null,
    providers: [],
    workouts_supported: null,
    detail: "Provider capability metadata unavailable",
  };
}

// ─── Vital daily-summary webhook helpers ──────────────────────────────────────

async function verifySvixSignature(
  svixId: string,
  svixTimestamp: string,
  rawBody: string,
  svixSignature: string,
  webhookSecret: string,
): Promise<boolean> {
  try {
    const secretBytes = webhookSecret.startsWith("whsec_")
      ? Uint8Array.from(atob(webhookSecret.slice(6)), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(webhookSecret);
    const signingContent = `${svixId}.${svixTimestamp}.${rawBody}`;
    const key = await crypto.subtle.importKey(
      "raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingContent));
    const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
    // svix-signature header: space-separated "v1,<b64sig>" pairs
    const signatures = svixSignature.split(" ")
      .map((s) => s.split(",").at(-1))
      .filter(Boolean) as string[];
    return signatures.some((s) => s === expected);
  } catch {
    return false;
  }
}

async function handleDailySummaryWebhook(
  body: Dict,
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<Response> {
  const vitalUserId = firstString(body.user_id, body.client_user_id);
  if (!vitalUserId) return json({ error: "Missing user_id in webhook payload" }, 400);

  const raw = asDict(body.data) ?? {};
  const date = String(raw.calendar_date ?? raw.date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: "Missing or invalid date in payload" }, 400);
  }

  // Resolve Supabase user from Vital user ID
  const { data: integration } = await supabaseAdmin
    .from("integrations")
    .select("user_id")
    .eq("provider", "vital")
    .eq("athlete_id", vitalUserId)
    .maybeSingle();
  if (!integration?.user_id) {
    return json({ error: "Vital user not found", vital_user_id: vitalUserId }, 404);
  }

  // Extract wellness fields — field names vary by provider, try multiple paths
  const hrv = toNum(
    raw.hrv_rmssd ?? raw.hrv ?? raw.average_hrv ?? raw.hrv_sdnn ??
    asDict(raw.hrv_data)?.rmssd ?? asDict(raw.hrv_data)?.value,
  );
  const sleepSecs = toNum(
    raw.sleep_duration_seconds ?? raw.total_sleep_duration ?? raw.sleep_duration ??
    raw.total_sleep ?? raw.duration_asleep ?? asDict(raw.sleep_data)?.duration,
  );
  const sleepHours = sleepSecs != null && sleepSecs > 0
    ? Math.round((sleepSecs / 3600) * 10) / 10
    : null;
  const restingHr = toNum(
    raw.resting_heartrate ?? raw.resting_hr ?? raw.resting_heart_rate ??
    raw.min_heartrate ?? asDict(raw.heart_rate)?.resting,
  );
  const vo2maxRaw = toNum(
    raw.vo2_max ?? raw.vo2max ?? raw.vo2max_ml_per_min_per_kg ??
    asDict(raw.cardiovascular_data)?.vo2_max,
  );

  const upsert: Record<string, unknown> = { user_id: integration.user_id, date };
  if (hrv != null) upsert.hrv = Math.round(hrv * 10) / 10;
  if (sleepHours != null) upsert.sleep_hours = sleepHours;
  if (restingHr != null) upsert.resting_hr = Math.round(restingHr);
  if (vo2maxRaw != null) upsert.vo2max = Math.round(vo2maxRaw * 10) / 10;

  const fieldsUpdated = Object.keys(upsert).filter((k) => k !== "user_id" && k !== "date");
  if (fieldsUpdated.length === 0) {
    return json({
      ok: true,
      detail: "No wellness fields found in payload",
      date,
      vital_user_id: vitalUserId,
    });
  }

  const { error } = await supabaseAdmin
    .from("daily_readiness")
    .upsert(upsert, { onConflict: "user_id,date" });
  if (error) {
    console.error("[vital-sync] daily_readiness webhook upsert failed", error.message);
    return json({ error: error.message }, 500);
  }

  console.log("[vital-sync] webhook upserted daily_readiness", { date, fieldsUpdated });
  return json({ ok: true, date, vital_user_id: vitalUserId, fields_updated: fieldsUpdated });
}

// ──────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ─── Inbound Vital webhook (Svix-signed, no user auth) ──────────────────────
  const isSvixWebhook = req.headers.has("svix-id") && req.headers.has("svix-signature");
  if (isSvixWebhook || req.headers.get("x-vital-event-type") != null) {
    const webhookSecret = Deno.env.get("VITAL_WEBHOOK_SECRET") ?? "";
    const rawBody = await req.text();
    if (webhookSecret && isSvixWebhook) {
      const valid = await verifySvixSignature(
        req.headers.get("svix-id")!,
        req.headers.get("svix-timestamp") ?? "",
        rawBody,
        req.headers.get("svix-signature")!,
        webhookSecret,
      );
      if (!valid) return json({ error: "Invalid webhook signature" }, 400);
    }
    let webhookBody: Dict;
    try {
      webhookBody = JSON.parse(rawBody) as Dict;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const eventType = firstString(webhookBody.event_type, webhookBody.type);
    if (
      eventType === "daily.data.summary.created" ||
      eventType === "daily.data.summary.updated"
    ) {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      return handleDailySummaryWebhook(webhookBody, supabaseAdmin);
    }
    return json({ ok: true, detail: `Event '${eventType ?? "unknown"}' acknowledged but not handled` });
  }
  // ────────────────────────────────────────────────────────────────────────────

  try {
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header", request_id: requestId }, 401);

    const apiKey = Deno.env.get("VITAL_API_KEY");
    if (!apiKey) return json({ error: "Vital API key not configured", request_id: requestId }, 500);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser(
      authHeader.replace("Bearer ", "").trim()
    );
    if (userError || !user) return json({ error: "Unauthorized", request_id: requestId }, 401);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: integration } = await supabaseAdmin
      .from("integrations")
      .select("athlete_id, vital_last_workout_sync_at")
      .eq("user_id", user.id)
      .eq("provider", "vital")
      .maybeSingle();

    if (!integration?.athlete_id) return json({ error: "Vital not connected", request_id: requestId }, 404);

    const vitalUserId = String(integration.athlete_id);
    const baseUrl = getVitalBaseUrl();
    const headers = { "x-vital-api-key": apiKey, Accept: "application/json" };

    const historyFloor = getVitalHistoryStartDate();
    const workoutHistoryStart = resolveVitalIncrementalStartDate(
      historyFloor,
      integration.vital_last_workout_sync_at != null
        ? String(integration.vital_last_workout_sync_at)
        : null,
    );
    const wellnessRangeStart = historyFloor;
    const endDate = todayStr();
    const oneYearStartDate = daysAgo(365);
    const ninetyDaysStartDate = daysAgo(90);
    const historyWindows = buildDateWindows(
      workoutHistoryStart,
      endDate,
      getVitalWorkoutChunkDays(),
    );

    let activitiesUpserted = 0;
    let activitiesSkipped = 0;
    let readinessUpserted = 0;
    const providerBreakdown: Record<string, number> = {};
    const providerCapability = await fetchProviderCapability(baseUrl, vitalUserId, headers);
    const workoutEndpointBases = [
      `${baseUrl}/v2/summary/workouts/${vitalUserId}/raw`,
      `${baseUrl}/v2/summary/workouts/${vitalUserId}`,
      `${baseUrl}/v2/activity/user_id/${vitalUserId}`,
      `${baseUrl}/v2/activity/${vitalUserId}`,
      `${baseUrl}/v2/activity/${vitalUserId}/raw`,
    ];
    const workoutEndpoints = [
      ...workoutEndpointBases.map((base) => `${base}?start_date=${ninetyDaysStartDate}&end_date=${endDate}`),
      ...workoutEndpointBases.map((base) => `${base}?start_date=${oneYearStartDate}&end_date=${endDate}`),
    ];
    const workoutAttempts: EndpointAttempt[] = [];
    const workoutsByStableKey = new Map<string, { workout: Dict; endpointBase: string }>();
    let selectedEndpoint: string | null = null;
    let workoutsFetchStatus = 0;
    let workoutsDetail: string | undefined;
    const successfulProbeCounts: Record<string, number> = {};

    const stableWorkoutKey = (workout: Dict): string | null => {
      const payload = asDict(workout.data) ?? workout;
      return firstString(
        workout.id,
        workout.workout_id,
        workout.activity_id,
        workout.source_id,
        payload.id,
        payload.workout_id,
        payload.activity_id,
        payload.source_id,
        firstString(workout.start_time, workout.timestamp, payload.start_time, payload.timestamp),
      );
    };

    const workoutCandidateScore = (workout: Dict): number => {
      const payload = asDict(workout.data) ?? workout;
      const parsedDate = extractWorkoutDate(workout, payload);
      const distanceKm = extractDistanceKm(workout, payload);
      const durationSeconds = extractDurationSeconds(workout, payload);
      const { avgHr, maxHr } = extractHeartRate(workout, payload);
      let score = 0;
      if (parsedDate.date) score += parsedDate.source === "event" ? 5 : 2;
      if (distanceKm != null) score += 2;
      if (durationSeconds != null) score += 2;
      if (avgHr != null || maxHr != null) score += 1;
      return score;
    };

    const collectWorkouts = (rows: Dict[], endpointBase: string) => {
      for (const workout of rows) {
        const key = stableWorkoutKey(workout);
        if (!key) continue;
        const existing = workoutsByStableKey.get(key);
        if (!existing) {
          workoutsByStableKey.set(key, { workout, endpointBase });
          continue;
        }
        const existingScore = workoutCandidateScore(existing.workout);
        const candidateScore = workoutCandidateScore(workout);
        if (candidateScore > existingScore) {
          workoutsByStableKey.set(key, { workout, endpointBase });
        }
      }
    };

    for (const endpoint of workoutEndpoints) {
      const fetched = await fetchWorkoutsFromEndpoint(endpoint, headers, {
        maxPages: getVitalWorkoutMaxPagesProbe(),
      });
      workoutAttempts.push(fetched.attempt);
      workoutsFetchStatus = fetched.attempt.status;
      if (fetched.ok && fetched.workouts.length > 0) {
        const endpointBase = endpoint.split("?")[0];
        successfulProbeCounts[endpointBase] = Math.max(
          successfulProbeCounts[endpointBase] ?? 0,
          fetched.workouts.length,
        );
        collectWorkouts(fetched.workouts, endpointBase);
        if (!selectedEndpoint) selectedEndpoint = endpoint;
      }
      if (fetched.ok && fetched.workouts.length === 0 && selectedEndpoint == null) {
        selectedEndpoint = endpoint;
      }
      await vitalJunctionDelay();
    }

    // Backfill full history for all successful endpoint bases (limited to top 3).
    const backfillBases = Object.entries(successfulProbeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([base]) => base);
    for (const endpointBase of backfillBases) {
      const backfill = await fetchWorkoutsChunked(endpointBase, historyWindows, headers);
      workoutAttempts.push(...backfill.attempts);
      if (backfill.ok && backfill.workouts.length > 0) {
        collectWorkouts(backfill.workouts, endpointBase);
        continue;
      }
      if (backfill.partialError) {
        workoutsDetail = backfill.partialError;
        console.warn("[vital-sync] partial history backfill:", backfill.partialError);
      }
    }

    const collectedWorkouts = [...workoutsByStableKey.values()];
    const allFailed = workoutAttempts.every((attempt) => attempt.status >= 400);
    if (allFailed) {
      const firstFailure = workoutAttempts.find((attempt) => attempt.status >= 400);
      const detail = firstFailure
        ? `Endpoint ${firstFailure.status} at ${firstFailure.endpoint}${firstFailure.detail ? `: ${firstFailure.detail}` : ""}`
        : "All Vital workout endpoints failed";
      const unsupportedStatuses = new Set([400, 404, 405, 410, 422]);
      const allFallbackNotFound = workoutAttempts.every((attempt) => attempt.status === 404);
      const allFallbackUnsupported = workoutAttempts.every((attempt) => unsupportedStatuses.has(attempt.status));
      const providerSuggestsNoWorkouts = providerCapability.workouts_supported === false;

      if (allFallbackNotFound || allFallbackUnsupported || providerSuggestsNoWorkouts) {
        return json({
          ok: true,
          request_id: requestId,
          detail: providerSuggestsNoWorkouts
            ? "Connected provider currently has no workouts available through Vital."
            : "No supported workout endpoint was available for this Vital connection yet.",
          workouts_endpoint: selectedEndpoint,
          workouts_fetch_status: workoutsFetchStatus,
          workouts_endpoint_attempts: workoutAttempts,
          workouts_received: 0,
          activities_upserted: 0,
          activities_skipped: 0,
          provider_breakdown: providerBreakdown,
          provider_capability: providerCapability,
          hrv_fetch_status: 0,
          sleep_fetch_status: 0,
          readiness_upserted: 0,
        });
      }

      return json({
        error: "Failed to fetch workouts from Vital",
        detail,
        request_id: requestId,
        workouts_fetch_status: workoutsFetchStatus,
        workouts_endpoint_attempts: workoutAttempts,
        provider_capability: providerCapability,
      }, 502);
    }

    const endpointImportedCounts: Record<string, number> = {};
    const mappingQuality = {
      parsed_event_date_count: 0,
      fallback_date_count: 0,
      missing_date_count: 0,
      missing_distance_count: 0,
      missing_duration_count: 0,
      missing_hr_count: 0,
      total_candidates: collectedWorkouts.length,
      deduped_candidates: collectedWorkouts.length,
    };

    for (const collected of collectedWorkouts) {
      const w = collected.workout;
      const endpointBase = collected.endpointBase;
      const data = asDict(w.data) ?? w;
      const id = firstString(
        w.id,
        w.workout_id,
        w.activity_id,
        w.source_id,
        data.id,
        data.workout_id,
        data.activity_id,
        data.source_id,
      );
      if (!id) {
        activitiesSkipped += 1;
        continue;
      }

      const parsedDate = extractWorkoutDate(w, data);
      const date = parsedDate.date;
      if (!date) {
        mappingQuality.missing_date_count += 1;
        activitiesSkipped += 1;
        continue;
      }
      if (parsedDate.source === "event") mappingQuality.parsed_event_date_count += 1;
      else mappingQuality.fallback_date_count += 1;

      const distanceKm = extractDistanceKm(w, data);
      if (distanceKm == null) mappingQuality.missing_distance_count += 1;

      const durationSeconds = extractDurationSeconds(w, data);
      if (durationSeconds == null) mappingQuality.missing_duration_count += 1;
      const avgSpeed = metricValue(
        data.average_speed ?? data.speed ?? w.average_speed ?? w.speed ?? asDict(data.pace)?.speed
      );
      const avgPace = firstString(
        data.avg_pace,
        data.pace,
        w.avg_pace,
        w.pace,
      ) ?? paceFromAvgSpeed(avgSpeed);

      const activityType = inferActivityType(w, data);

      const provider = String(
        w.provider ?? data.provider ?? w.source ?? data.source ?? "unknown"
      ).toLowerCase();
      providerBreakdown[provider] = (providerBreakdown[provider] ?? 0) + 1;

      const { avgHr, maxHr } = extractHeartRate(w, data);
      if (avgHr == null && maxHr == null) mappingQuality.missing_hr_count += 1;
      const cadence = metricValue(data.cadence ?? data.average_cadence ?? w.cadence ?? w.average_cadence);
      const elevationGain = metricValue(data.elevation_gain ?? data.total_elevation_gain ?? w.elevation_gain ?? w.total_elevation_gain);

      const { error } = await supabaseAdmin.from("activity").upsert(
        {
          user_id: user.id,
          date,
          type: activityType,
          name: firstString(data.name, data.title, w.name, w.title),
          distance_km: distanceKm,
          duration_seconds: durationSeconds != null && durationSeconds > 0 ? Math.round(durationSeconds) : null,
          avg_pace: avgPace,
          avg_hr: avgHr,
          max_hr: maxHr,
          cadence: cadence != null ? Math.round(cadence) : null,
          elevation_gain: elevationGain,
          source: "vital",
          vital_id: id,
          external_id: id,
        },
        { onConflict: "user_id,vital_id" }
      );
      if (error) {
        console.warn("[vital-sync] activity upsert failed", { id, date, type: activityType, error: error.message });
        activitiesSkipped += 1;
      } else {
        activitiesUpserted += 1;
        endpointImportedCounts[endpointBase] = (endpointImportedCounts[endpointBase] ?? 0) + 1;
      }
    }

    const { error: vitalSyncAtErr } = await supabaseAdmin
      .from("integrations")
      .update({ vital_last_workout_sync_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("provider", "vital");
    if (vitalSyncAtErr) {
      console.warn("[vital-sync] vital_last_workout_sync_at update failed", vitalSyncAtErr.message);
    }

    // ─── Workout streams (Junction timeseries) → activity_streams + derived metrics / splits ───
    const STREAM_BATCH_SIZE = 5;
    const STREAM_SYNC_MAX = Math.min(
      500,
      Math.max(1, Number(Deno.env.get("VITAL_STREAMS_MAX_PER_SYNC") ?? "40")),
    );
    const streamsWindowStart = ninetyDaysStartDate;
    let streams_ok = 0;
    let streams_fail = 0;
    let streams_candidates = 0;

    const hasStreamableVitalType = (t: string) =>
      ["run", "ride", "walk", "hike", "cycl", "indoor", "virtual", "swim", "elliptical", "row", "trail", "strength", "gym", "yoga", "cross"].some((x) =>
        (t ?? "").toLowerCase().includes(x)
      );

    const { data: existingStreamRows } = await supabaseAdmin
      .from("activity_streams")
      .select("activity_id")
      .eq("user_id", user.id);
    const existingStreamIds = new Set(
      (existingStreamRows ?? []).map((r: { activity_id: string }) => r.activity_id),
    );

    const { data: vitalActsForStreams } = await supabaseAdmin
      .from("activity")
      .select("external_id, type")
      .eq("user_id", user.id)
      .eq("source", "vital")
      .gte("date", streamsWindowStart)
      .not("external_id", "is", null);

    const streamCandidates = (vitalActsForStreams ?? [])
      .filter((a: { external_id: string; type: string }) =>
        Boolean(a.external_id) &&
        !existingStreamIds.has(a.external_id) &&
        hasStreamableVitalType(a.type ?? "")
      )
      .slice(0, STREAM_SYNC_MAX);

    streams_candidates = streamCandidates.length;

    const { data: athleteProf } = await supabaseAdmin
      .from("athlete_profile")
      .select("lactate_threshold_hr, max_hr, resting_hr")
      .eq("user_id", user.id)
      .maybeSingle();
    const apLthr = athleteProf?.lactate_threshold_hr != null
      ? Number(athleteProf.lactate_threshold_hr)
      : null;
    const apMaxHr = athleteProf?.max_hr != null ? Number(athleteProf.max_hr) : null;
    const apRestHr = athleteProf?.resting_hr != null ? Number(athleteProf.resting_hr) : null;

    for (let si = 0; si < streamCandidates.length; si += STREAM_BATCH_SIZE) {
      const batch = streamCandidates.slice(si, si + STREAM_BATCH_SIZE) as { external_id: string }[];
      const batchResults = await Promise.all(
        batch.map(async (a) => {
          const wid = a.external_id;
          try {
            const raw = await fetchVitalWorkoutStreamPayload(baseUrl, headers, wid);
            if (!raw) {
              console.warn("[vital-sync] stream payload null for workout", wid);
              return "fail" as const;
            }

            const norm = normalizeVitalStreamPayload(raw);
            const hasStreamSignal =
              norm.time.length > 0 &&
              (norm.heartrate.some((h) => h > 0) ||
                norm.distance.some((d) => d > 10) ||
                norm.pace.some((p) => p > 0) ||
                norm.altitude.some((alt) => alt !== 0) ||
                norm.latlng.length >= 2);
            if (!hasStreamSignal) {
              console.warn("[vital-sync] stream signal absent for workout", wid, {
                time: norm.time.length,
                hr: norm.heartrate.length,
                dist: norm.distance.length,
                pace: norm.pace.length,
              });
              return "fail" as const;
            }

            const hrZones = norm.heartrate.length && (apLthr != null && apLthr > 0)
              ? buildHrZonesSeries(norm.heartrate, apLthr, apMaxHr)
              : [];

            const { error: se } = await supabaseAdmin.from("activity_streams").upsert(
              {
                user_id: user.id,
                activity_id: wid,
                heartrate: norm.heartrate.some((h) => h > 0) ? norm.heartrate : null,
                cadence: norm.cadence.some((c) => c > 0) ? norm.cadence : null,
                altitude: norm.altitude.some((alt) => alt !== 0) ? norm.altitude : null,
                distance: norm.distance.some((d) => d > 0) ? norm.distance : null,
                pace: norm.pace.some((p) => p > 0) ? norm.pace : null,
                time: norm.time.length ? norm.time : null,
                latlng: norm.latlng.length >= 2 ? norm.latlng : null,
                hr_zones: hrZones.length ? hrZones : null,
              },
              { onConflict: "user_id,activity_id" },
            );
            if (se) {
              console.warn("[vital-sync] activity_streams upsert", se.message);
              return "fail" as const;
            }

            const cardiacDrift = computeCardiacDrift(norm.heartrate);
            const pacePos = norm.pace.filter((p) => p > 0);
            const avgPaceVal = pacePos.length ? avg(pacePos) : 0;
            const hrPos = norm.heartrate.filter((h) => h > 0);
            const avgHrVal = hrPos.length ? avg(hrPos) : 0;
            const paceEff = computePaceEfficiency(avgPaceVal, avgHrVal);
            const cadenceCons = computeCadenceConsistency(norm.cadence);

            const actUpdates: Record<string, unknown> = {};
            if (cardiacDrift != null) actUpdates.cardiac_drift = cardiacDrift;
            if (paceEff != null) actUpdates.pace_efficiency = paceEff;
            if (cadenceCons != null) actUpdates.cadence_consistency = cadenceCons;
            if (apMaxHr != null && apMaxHr > 0) {
              const zt = computeHrZoneTimesFromSamples(norm.heartrate, norm.time, apMaxHr, apRestHr);
              if (zt.some((t) => t > 0)) actUpdates.hr_zone_times = zt;
            }
            const splits = deriveKmSplitsFromDistanceTime(norm.time, norm.distance, norm.heartrate);
            if (splits.length > 0) actUpdates.splits = splits;

            if (Object.keys(actUpdates).length > 0) {
              await supabaseAdmin.from("activity").update(actUpdates).eq("user_id", user.id).eq(
                "external_id",
                wid,
              );
            }
            return "ok" as const;
          } catch (e) {
            console.warn("[vital-sync] stream fetch error", e);
            return "fail" as const;
          }
        }),
      );
      for (const r of batchResults) {
        if (r === "ok") streams_ok += 1;
        else streams_fail += 1;
      }
      if (si + STREAM_BATCH_SIZE < streamCandidates.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    let hrvFetchStatus = 0;
    const hrvRes = await fetch(
      `${baseUrl}/v2/timeseries/${vitalUserId}/hrv/grouped?start_date=${wellnessRangeStart}&end_date=${endDate}`,
      { headers }
    );
    hrvFetchStatus = hrvRes.status;
    if (hrvRes.ok) {
      const hrvData = (await hrvRes.json()) as { groups?: Record<string, Array<{ data?: Array<{ timestamp?: string; value?: number }> }>> };
      const byDate = new Map<string, number[]>();
      for (const providerGroups of Object.values(hrvData.groups ?? {})) {
        for (const group of providerGroups) {
          for (const point of group.data ?? []) {
            const ts = point.timestamp;
            if (!ts) continue;
            const date = ts.slice(0, 10);
            const val = point.value;
            if (val == null) continue;
            if (!byDate.has(date)) byDate.set(date, []);
            byDate.get(date)!.push(val);
          }
        }
      }
      for (const [date, vals] of byDate) {
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        const { error } = await supabaseAdmin.from("daily_readiness").upsert(
          { user_id: user.id, date, hrv: Math.round(avg * 10) / 10 },
          { onConflict: "user_id,date" }
        );
        if (!error) readinessUpserted++;
      }
    }

    let sleepFetchStatus = 0;
    const sleepRes = await fetch(
      `${baseUrl}/v2/summary/sleep/${vitalUserId}?start_date=${wellnessRangeStart}&end_date=${endDate}`,
      { headers }
    );
    sleepFetchStatus = sleepRes.status;
    if (sleepRes.ok) {
      const sleepData = (await sleepRes.json()) as { sleep?: Array<Record<string, unknown>> };
      const sleeps = sleepData.sleep ?? (Array.isArray(sleepData) ? sleepData : []);
      for (const s of sleeps) {
        const date = String(s.calendar_date ?? s.date ?? "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const hours = Number(s.total_sleep ?? s.duration ?? s.sleep_duration ?? 0);
        const sleepHours = hours > 24 ? hours / 3600 : hours;
        if (sleepHours <= 0) continue;
        const { error } = await supabaseAdmin.from("daily_readiness").upsert(
          {
            user_id: user.id,
            date,
            sleep_hours: Math.round(sleepHours * 10) / 10,
            sleep_quality: s.quality != null ? Math.round(Number(s.quality)) : null,
          },
          { onConflict: "user_id,date" }
        );
        if (!error) readinessUpserted++;
      }
    }

    // ─── Resting HR (Vital timeseries) ────────────────────────────────────────
    const restingHrEndpoints = [
      `${baseUrl}/v2/timeseries/${vitalUserId}/resting_heart_rate/grouped?start_date=${wellnessRangeStart}&end_date=${endDate}`,
      `${baseUrl}/v2/timeseries/${vitalUserId}/heartrate/grouped?start_date=${wellnessRangeStart}&end_date=${endDate}`,
    ];
    for (const endpoint of restingHrEndpoints) {
      try {
        const rhrRes = await fetch(endpoint, { headers });
        if (!rhrRes.ok) continue;
        const rhrData = (await rhrRes.json()) as {
          groups?: Record<string, Array<{ data?: Array<{ timestamp?: string; value?: number; type?: string }> }>>;
        };
        const byDate = new Map<string, number[]>();
        for (const providerGroups of Object.values(rhrData.groups ?? {})) {
          for (const group of providerGroups) {
            for (const point of group.data ?? []) {
              // Skip non-resting points when type info is present
              if (point.type && !String(point.type).toLowerCase().includes("rest")) continue;
              const ts = point.timestamp;
              if (!ts) continue;
              const d = ts.slice(0, 10);
              const val = point.value;
              if (val == null) continue;
              if (!byDate.has(d)) byDate.set(d, []);
              byDate.get(d)!.push(val);
            }
          }
        }
        if (byDate.size === 0) continue;
        for (const [d, vals] of byDate) {
          const minHr = Math.min(...vals);
          if (minHr < 30 || minHr > 120) continue; // sanity guard
          const { error } = await supabaseAdmin.from("daily_readiness").upsert(
            { user_id: user.id, date: d, resting_hr: Math.round(minHr) },
            { onConflict: "user_id,date" },
          );
          if (!error) readinessUpserted++;
        }
        break; // success — skip fallback endpoint
      } catch (e) {
        console.warn("[vital-sync] resting HR fetch error", e);
      }
    }

    // ─── VO2max (Vital timeseries) ─────────────────────────────────────────────
    try {
      const vo2Res = await fetch(
        `${baseUrl}/v2/timeseries/${vitalUserId}/vo2_max/grouped?start_date=${wellnessRangeStart}&end_date=${endDate}`,
        { headers },
      );
      if (vo2Res.ok) {
        const vo2Data = (await vo2Res.json()) as {
          groups?: Record<string, Array<{ data?: Array<{ timestamp?: string; value?: number }> }>>;
        };
        for (const providerGroups of Object.values(vo2Data.groups ?? {})) {
          for (const group of providerGroups) {
            for (const point of group.data ?? []) {
              const ts = point.timestamp;
              if (!ts) continue;
              const d = ts.slice(0, 10);
              const val = toNum(point.value);
              if (val == null || val < 10 || val > 90) continue; // sanity guard (ml/kg/min)
              const { error } = await supabaseAdmin.from("daily_readiness").upsert(
                { user_id: user.id, date: d, vo2max: Math.round(val * 10) / 10 },
                { onConflict: "user_id,date" },
              );
              if (!error) readinessUpserted++;
            }
          }
        }
      }
    } catch (e) {
      console.warn("[vital-sync] VO2max fetch error", e);
    }

    const missingDistanceRatio = mappingQuality.total_candidates > 0
      ? mappingQuality.missing_distance_count / mappingQuality.total_candidates
      : 0;
    const missingDurationRatio = mappingQuality.total_candidates > 0
      ? mappingQuality.missing_duration_count / mappingQuality.total_candidates
      : 0;
    const fallbackDateRatio = mappingQuality.total_candidates > 0
      ? mappingQuality.fallback_date_count / mappingQuality.total_candidates
      : 0;
    const mappingWarning = (
      mappingQuality.total_candidates > 0 &&
      (missingDistanceRatio > 0.5 || missingDurationRatio > 0.5 || fallbackDateRatio > 0.5)
    )
      ? "Vital sync imported activities, but many rows were missing core metrics or relied on fallback dates."
      : undefined;

    // Fire-and-forget: recalculate CTL/ATL/TSB from Vital data after sync
    const ctlFnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/calculate-vital-ctl`;
    fetch(ctlFnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ user_id: user.id }),
    }).catch((err) => console.warn("[vital-sync] calculate-vital-ctl trigger failed:", err));

    return json({
      ok: true,
      request_id: requestId,
      detail: collectedWorkouts.length === 0
        ? "No workouts found in Vital for the selected range."
        : mappingWarning ?? workoutsDetail,
      workouts_endpoint: selectedEndpoint,
      workouts_fetch_status: workoutsFetchStatus,
      workouts_endpoint_attempts: workoutAttempts,
      workouts_received: collectedWorkouts.length,
      activities_upserted: activitiesUpserted,
      activities_skipped: activitiesSkipped,
      endpoint_imported_counts: endpointImportedCounts,
      mapping_quality: mappingQuality,
      provider_breakdown: providerBreakdown,
      provider_capability: providerCapability,
      hrv_fetch_status: hrvFetchStatus,
      sleep_fetch_status: sleepFetchStatus,
      readiness_upserted: readinessUpserted,
      streams_candidates,
      streams_ok,
      streams_fail,
      streams_window_start: streamsWindowStart,
    });
  } catch (e) {
    console.error("[vital-sync] Error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
