import { useEffect, useMemo, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { useTheme } from "@/hooks/useTheme";
import { useActivityDetail, type ActivityStreams, type EnhancingSupplements } from "@/hooks/useActivityDetail";
import { useZoneSource } from "@/hooks/useZoneSource";
import { useAthleteProfile } from "@/hooks/useAthleteProfile";
import { useAuth } from "@/hooks/use-auth";
import { getZoneFromBpm, getZoneBounds, computeHrZoneTimesFromStream } from "@/lib/hr-zones";
import { useParams, useNavigate } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { isNonDistanceActivity } from "@/lib/analytics";
import { formatDistance, formatCadence, formatElevation, normalizePaceDisplay, cadenceToDisplaySpm } from "@/lib/format";
import { ArrowLeft, BarChart3, Heart, Mountain, MessageCircle, Loader2, FileText, Coffee, Droplets, Download, Trophy, Send, ImagePlus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSafeAccessToken } from "@/lib/supabase-auth-safe";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MapContainer, TileLayer, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Line,
  Area,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  BarChart as RechartsBarChart,
} from "recharts";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { ActivityPhotos } from "@/components/ActivityPhotos";
import { ActivityPlannedSessionBlock } from "@/components/training/ActivityPlannedSessionBlock";

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatPace(val: number): string {
  if (!val || val <= 0 || val > 20) return "--";
  let min = Math.floor(val);
  let sec = Math.round((val % 1) * 60);
  if (sec >= 60) {
    min += 1;
    sec = 0;
  }
  return `${min}:${String(sec).padStart(2, "0")}`;
}

type ChartPoint = {
  t: number;
  km: number;
  timeLabel: string;
  pace: number;
  hr: number;
  altitude: number;
  cadence: number;
  temperature: number;
  respiration_rate: number;
};

/** Clamp outlier pace values and interpolate from neighbours (red light stops, GPS glitches) */
function smoothPace(raw: number[], minPace = 2.0, maxPace = 12.0): number[] {
  const out = [...raw];
  for (let i = 0; i < out.length; i++) {
    if (out[i] < minPace || out[i] > maxPace || out[i] === 0) {
      let left = 0;
      let right = 0;
      for (let j = i - 1; j >= 0; j--) {
        if (out[j] >= minPace && out[j] <= maxPace) { left = raw[j]; break; }
      }
      for (let j = i + 1; j < out.length; j++) {
        if (raw[j] >= minPace && raw[j] <= maxPace) { right = raw[j]; break; }
      }
      out[i] = left && right ? (left + right) / 2 : left || right || 6;
    }
  }
  return out;
}

/** Downsample to ~targetN points using LTTB-like max-min preservation */
function downsample<T>(data: T[], targetN: number): T[] {
  if (data.length <= targetN) return data;
  const step = (data.length - 2) / (targetN - 2);
  const result: T[] = [data[0]];
  for (let i = 1; i < targetN - 1; i++) {
    const start = Math.floor((i - 1) * step) + 1;
    const end = Math.min(Math.floor(i * step) + 1, data.length - 1);
    const mid = Math.floor((start + end) / 2);
    result.push(data[mid]);
  }
  result.push(data[data.length - 1]);
  return result;
}

/** Rolling average for smoother lines */
function rollingAvg(arr: number[], window: number): number[] {
  if (window <= 1) return arr;
  const half = Math.floor(window / 2);
  return arr.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
      sum += arr[j];
      count++;
    }
    return sum / count;
  });
}

function buildChartData(streams: ActivityStreams): ChartPoint[] {
  const { time, heartrate, altitude, cadence, pace, velocity_smooth, temperature, respiration_rate } = streams;
  const n = Math.max(time.length, heartrate.length, altitude.length, (temperature?.length ?? 0), (respiration_rate?.length ?? 0), 1);

  const rawPace: number[] = [];
  for (let i = 0; i < n; i++) {
    if (pace && pace.length > 0) {
      rawPace.push(pace[i] ?? 0);
    } else if (velocity_smooth && velocity_smooth.length > 0) {
      const v = velocity_smooth[i] ?? 0;
      rawPace.push(v > 0.1 ? 1000 / v / 60 : 0);
    } else {
      rawPace.push(0);
    }
  }

  const cleanPace = smoothPace(rawPace);
  const smoothedPace = rollingAvg(cleanPace, 15);
  const smoothedHr = rollingAvg(heartrate.length ? heartrate.map(Number) : [], 10);
  const smoothedCad = rollingAvg(cadence.length ? cadence.map(Number) : [], 10);
  const smoothedTemp = rollingAvg(temperature?.length ? temperature.map(Number) : [], 5);
  const smoothedResp = rollingAvg(respiration_rate?.length ? respiration_rate.map(Number) : [], 5);

  const distArr = streams.distance ?? [];
  const data: ChartPoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = time[i] ?? 0;
    const km = distArr.length > i ? distArr[i] / 1000 : (streams.distance_km ?? 0) * (i / (n - 1 || 1));
    const rawCad = smoothedCad[i] ?? 0;
    const displayCad = rawCad >= 25 && rawCad <= 130 ? rawCad * 2 : rawCad;
    data.push({
      t,
      km: Math.round(km * 100) / 100,
      timeLabel: formatDuration(t),
      pace: smoothedPace[i] ?? 0,
      hr: smoothedHr[i] ?? 0,
      altitude: altitude[i] ?? 0,
      cadence: displayCad,
      temperature: smoothedTemp[i] ?? 0,
      respiration_rate: smoothedResp[i] ?? 0,
    });
  }
  return data;
}

function MapFitBounds({ latlng }: { latlng: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (latlng.length >= 2) {
      map.fitBounds(
        [
          [Math.min(...latlng.map((p) => p[0])), Math.min(...latlng.map((p) => p[1]))],
          [Math.max(...latlng.map((p) => p[0])), Math.max(...latlng.map((p) => p[1]))],
        ],
        { padding: [24, 24] }
      );
    }
  }, [map, latlng]);
  return null;
}

const PACE_COLOR = "hsl(211 100% 52%)";
const HR_COLOR = "hsl(0 84% 60%)";
const ELEV_COLOR = "hsl(142 71% 45%)";
const CAD_COLOR = "hsl(280 70% 55%)";
const TEMP_COLOR = "hsl(25 95% 53%)";
const RESP_COLOR = "hsl(180 70% 45%)";

const HR_ZONE_COLORS = [
  "#94a3b8", // Z1 Recovery - grey
  "#3b82f6", // Z2 Aerobic - blue
  "#22c55e", // Z3 Tempo - green
  "#f97316", // Z4 Threshold - orange
  "#ef4444", // Z5 VO2max - red
  "#dc2626", // Z5+ Anaerobic - dark red
];
const HR_ZONE_NAMES = ["Z1 Recovery", "Z2 Aerobic", "Z3 Tempo", "Z4 Threshold", "Z5 VO2max", "Z5+ Anaerobic"];
const PACE_ZONE_NAMES = ["Z1 Easy", "Z2 Moderate", "Z3 Tempo", "Z4 Threshold", "Z5 Interval", "Z6 Sprint"];

function ZoneBar({ times, names, colors, label }: { times: number[]; names: string[]; colors: string[]; label: string }) {
  const total = times.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex h-6 rounded-md overflow-hidden">
        {times.map((t, i) => {
          const pct = (t / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div key={i} style={{ width: `${pct}%`, backgroundColor: colors[i] ?? colors[colors.length - 1] }} className="relative group transition-all">
              <div className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity">
                {Math.round(pct)}%
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {times.map((t, i) => {
          if (t <= 0) return null;
          const mins = Math.round(t / 60);
          return (
            <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colors[i] ?? colors[colors.length - 1] }} />
              <span>{names[i] ?? `Zone ${i + 1}`}</span>
              <span className="font-medium text-foreground">{mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60}m` : `${mins}m`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TILE_LIGHT = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_DARK = "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png";

type ActivityTab = "charts" | "data" | "notes";

function ZoneSourceBadge() {
  const zoneSource = useZoneSource();
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
      {zoneSource}
    </span>
  );
}

function ActivitySocialBar({
  activityId,
  edgeLikes,
  edgeComments,
}: {
  activityId: string;
  edgeLikes?: { id: string; user_id: string }[];
  edgeComments?: { id: string; user_id: string; content: string; created_at: string }[];
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState("");

  const { data: directLikes, error: likesError, refetch: refetchLikes } = useQuery({
    queryKey: ["activity-likes-detail", activityId],
    queryFn: async () => {
      await supabase.auth.refreshSession();
      const { data } = await supabase
        .from("activity_like")
        .select("id, user_id")
        .eq("activity_id", activityId);
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const { data: directComments, error: commentsError, refetch: refetchComments } = useQuery({
    queryKey: ["activity-comments-detail", activityId],
    queryFn: async () => {
      await supabase.auth.refreshSession();
      const { data } = await supabase
        .from("activity_comment")
        .select("id, user_id, content, created_at")
        .eq("activity_id", activityId)
        .order("created_at", { ascending: true });
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const likes = (directLikes && directLikes.length > 0) ? directLikes : (edgeLikes ?? directLikes ?? []);
  const comments = (directComments && directComments.length > 0) ? directComments : (edgeComments ?? directComments ?? []);

  const { data: names } = useQuery({
    queryKey: ["social-names", activityId],
    queryFn: async () => {
      const allIds = new Set<string>();
      for (const l of likes ?? []) allIds.add(l.user_id);
      for (const c of comments ?? []) allIds.add(c.user_id);
      if (allIds.size === 0) return new Map<string, string>();
      const { data } = await supabase
        .from("athlete_profile")
        .select("user_id, name")
        .in("user_id", [...allIds]);
      return new Map((data ?? []).map((p) => [p.user_id, p.name]));
    },
    enabled: (likes?.length ?? 0) > 0 || (comments?.length ?? 0) > 0,
    staleTime: 60_000,
  });

  const likeCount = likes?.length ?? 0;
  const userLiked = likes?.some((l) => l.user_id === user?.id) ?? false;
  const commentCount = comments?.length ?? 0;

  const toggleLike = useMutation({
    mutationFn: async () => {
      if (!user) return;
      if (userLiked) {
        await supabase.from("activity_like").delete().eq("activity_id", activityId).eq("user_id", user.id);
      } else {
        await supabase.from("activity_like").insert({ activity_id: activityId, user_id: user.id });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activity-likes-detail", activityId] }),
  });

  const addComment = useMutation({
    mutationFn: async (content: string) => {
      if (!user) return;
      await supabase.from("activity_comment").insert({ activity_id: activityId, user_id: user.id, content });
    },
    onSuccess: () => {
      setCommentText("");
      qc.invalidateQueries({ queryKey: ["activity-comments-detail", activityId] });
      qc.invalidateQueries({ queryKey: ["social-names", activityId] });
    },
  });

  const socialError = likesError || commentsError;
  if (socialError) {
    return (
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-xs text-muted-foreground">Couldn&apos;t load likes and comments.</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            refetchLikes();
            refetchComments();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (likeCount === 0 && commentCount === 0 && !showComments) {
    return (
      <div className="flex items-center gap-4 px-1">
        <button
          onClick={() => toggleLike.mutate()}
          className={`flex items-center gap-2 text-sm transition-colors ${userLiked ? "text-red-500" : "text-muted-foreground hover:text-red-500"}`}
          disabled={toggleLike.isPending}
        >
          <Heart className={`w-5 h-5 ${userLiked ? "fill-current" : ""}`} />
          Like
        </button>
        <button
          onClick={() => setShowComments(true)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageCircle className="w-5 h-5" />
          Comment
        </button>
      </div>
    );
  }

  return (
    <div className="card-standard p-4 space-y-3">
      <div className="flex items-center gap-4">
        <button
          onClick={() => toggleLike.mutate()}
          className={`flex items-center gap-2 text-sm transition-colors ${userLiked ? "text-red-500" : "text-muted-foreground hover:text-red-500"}`}
          disabled={toggleLike.isPending}
        >
          <Heart className={`w-5 h-5 ${userLiked ? "fill-current" : ""}`} />
          {likeCount > 0 && <span>{likeCount}</span>}
        </button>
        <button
          onClick={() => setShowComments(!showComments)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageCircle className="w-5 h-5" />
          {commentCount > 0 && <span>{commentCount}</span>}
        </button>
        {likeCount > 0 && names && (
          <span className="text-sm text-muted-foreground ml-auto">
            Liked by {likes!.slice(0, 3).map((l) => l.user_id === user?.id ? "you" : names.get(l.user_id) ?? "friend").join(", ")}
            {likeCount > 3 && ` and ${likeCount - 3} more`}
          </span>
        )}
      </div>

      {(showComments || commentCount > 0) && (
        <div className="pt-2 border-t border-border/50 space-y-3">
          {(comments ?? []).map((c) => (
            <div key={c.id} className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-sm font-semibold shrink-0">
                {(c.user_id === user?.id ? "You" : names?.get(c.user_id) ?? "Friend").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-medium">
                    {c.user_id === user?.id ? "You" : names?.get(c.user_id) ?? "Friend"}
                  </span>{" "}
                  <span className="text-muted-foreground">{c.content}</span>
                </p>
                <p className="text-xs text-muted-foreground/80 mt-0.5">
                  {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                </p>
              </div>
            </div>
          ))}
          <div className="flex gap-2 mt-2">
            <Input
              placeholder="Add a comment..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && commentText.trim()) addComment.mutate(commentText.trim());
              }}
              className="text-sm h-9"
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-9 px-2"
              onClick={() => commentText.trim() && addComment.mutate(commentText.trim())}
              disabled={!commentText.trim() || addComment.isPending}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ActivityDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { resolved: themeMode } = useTheme();
  const { data: activity, isLoading, error } = useActivityDetail(id);
  const { profile: athleteProfile } = useAthleteProfile();
  const [tab, setTab] = useState<ActivityTab>("charts");
  const isOwner = activity != null && (activity.user_id == null || activity.user_id === user?.id);
  const detailTabs = isOwner ? (["charts", "data", "notes"] as const) : (["charts", "data"] as const);

  useEffect(() => {
    if (activity && !isOwner && tab === "notes") setTab("charts");
  }, [activity, isOwner, tab]);

  const actIdForPb = id?.startsWith("icu_") ? id.replace(/^icu_/, "") : id;
  const { data: pbRecords = [] } = useQuery({
    queryKey: ["personal-records-for-activity", actIdForPb, id],
    queryFn: async () => {
      if (!actIdForPb && !id) return [];
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      if (!user) return [];
      const ids = [actIdForPb, id].filter(Boolean) as string[];
      const { data } = await supabase
        .from("personal_records")
        .select("distance")
        .eq("user_id", user.id)
        .in("activity_id", [...new Set(ids)]);
      return (data ?? []) as { distance: string }[];
    },
    enabled: !!activity && (!!actIdForPb || !!id),
  });
  const isPb = pbRecords.length > 0;
  const isMarathonPb = pbRecords.some((r) => /marathon|42\.195|42\s/i.test(r.distance ?? ""));

  const chartData = useMemo(() => {
    if (!activity?.streams) return [];
    const hasAny =
      (activity.streams.heartrate?.length ?? 0) > 0 ||
      (activity.streams.altitude?.length ?? 0) > 0 ||
      (activity.streams.pace?.length ?? 0) > 0 ||
      (activity.streams.velocity_smooth?.length ?? 0) > 0 ||
      (activity.streams.cadence?.length ?? 0) > 0 ||
      (activity.streams.temperature?.length ?? 0) > 0 ||
      (activity.streams.respiration_rate?.length ?? 0) > 0;
    if (!hasAny) return [];
    const raw = buildChartData(activity.streams);
    return downsample(raw, 350);
  }, [activity]);

  /** Stored avg_hr is often 0/null when Vital/streams have HR; derive from splits or stream mean */
  const derivedAvgHr = useMemo(() => {
    if (!activity) return null;
    const stored = activity.avg_hr;
    if (stored != null && stored > 0) return Math.round(stored);
    const splitHrs = (activity.splits ?? [])
      .map((s) => s.hr)
      .filter((h): h is number => typeof h === "number" && Number.isFinite(h) && h > 0);
    if (splitHrs.length > 0) {
      return Math.round(splitHrs.reduce((a, b) => a + b, 0) / splitHrs.length);
    }
    if (chartData.length > 0) {
      const hrs = chartData.map((d) => d.hr).filter((h) => Number.isFinite(h) && h > 0);
      if (hrs.length > 0) return Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
    }
    return null;
  }, [activity, chartData]);

  /** HR zone times for table: from stream with athlete zones when available, else normalized source data */
  const { hrZoneTimesForTable, hrZonesFromStream } = useMemo(() => {
    const effectiveMaxHr = athleteProfile?.max_hr ?? activity?.max_hr ?? null;
    const restingHr = athleteProfile?.resting_hr ?? null;
    const hasHrInChart = chartData.length > 0 && chartData.some((d) => d.hr > 0);
    if (hasHrInChart && effectiveMaxHr != null && effectiveMaxHr > 0) {
      const computed = computeHrZoneTimesFromStream(
        chartData.map((d) => ({ t: d.t, hr: d.hr })),
        effectiveMaxHr,
        restingHr
      );
      if (computed.some((t) => t > 0)) {
        return { hrZoneTimesForTable: computed, hrZonesFromStream: true };
      }
    }
    const raw = activity?.hr_zone_times;
    if (raw && raw.length > 0) {
      const normalized = [...raw];
      while (normalized.length < 6) normalized.push(0);
      return { hrZoneTimesForTable: normalized.slice(0, 6), hrZonesFromStream: false };
    }
    return { hrZoneTimesForTable: null, hrZonesFromStream: false };
  }, [activity, athleteProfile, chartData]);

  const hasPace = chartData.some((d) => d.pace > 0);
  const hasHr = chartData.some((d) => d.hr > 0);
  const hasAlt = chartData.some((d) => d.altitude > 0);
  const hasCad = chartData.some((d) => d.cadence > 0);
  const hasTemp = chartData.some((d) => d.temperature > 0);
  const hasResp = chartData.some((d) => d.respiration_rate > 0);
  const hasGraphs = hasPace || hasHr || hasAlt || hasTemp || hasResp;

  const chartsEmptyMessage = useMemo(() => {
    if (!activity) return "";
    if (activity.streamFetchError) return "Could not load charts (check console).";
    const src = String(activity.source ?? "").toLowerCase();
    if (src === "vital") {
      return "No GPS or heart-rate time series for this activity. Some device connections only send summary stats (distance, pace, max HR). Use the Data tab for those numbers.";
    }
    if (!activity.streams) {
      return "No pace, HR, or elevation time series is stored for this activity. Summary stats are on the Data tab.";
    }
    return "No chart data available for this activity.";
  }, [activity]);

  // ── New computed stats ──────────────────────────────────────────────────────

  /** Best (fastest) pace from the stream, ignoring stops and GPS glitches */
  const bestPace = useMemo(() => {
    if (!chartData.length) return null;
    const valid = chartData.map((d) => d.pace).filter((p) => p > 2 && p < 12);
    return valid.length ? Math.min(...valid) : null;
  }, [chartData]);

  /** Total elevation loss (sum of negative altitude deltas) from the raw stream */
  const elevationLoss = useMemo(() => {
    const alt = activity?.streams?.altitude;
    if (!alt || alt.length < 2) return null;
    let loss = 0;
    for (let i = 1; i < alt.length; i++) {
      const diff = alt[i] - alt[i - 1];
      if (diff < 0) loss += Math.abs(diff);
    }
    return loss > 1 ? Math.round(loss) : null;
  }, [activity]);

  /**
   * TSS: use intervals.icu training load when available; otherwise compute
   * rTSS = (dur_h) × (threshold_pace / avg_pace)² × 100
   */
  const tss = useMemo(() => {
    if (activity?.load != null && activity.load > 0) return Math.round(activity.load);
    const durSec = activity?.duration_seconds ?? 0;
    const paceStr = activity?.avg_pace;
    if (!durSec || !paceStr) return null;
    const m = paceStr.match(/(\d+):(\d+)/);
    if (!m) return null;
    const avgPaceSec = parseInt(m[1]) * 60 + parseInt(m[2]);
    if (avgPaceSec <= 0) return null;
    const ltPaceStr = athleteProfile?.lactate_threshold_pace;
    let thresholdSec = 300; // default 5:00/km
    if (ltPaceStr) {
      const lt = String(ltPaceStr).match(/(\d+):(\d+)/);
      if (lt) thresholdSec = parseInt(lt[1]) * 60 + parseInt(lt[2]);
    }
    return Math.round((durSec / 3600) * Math.pow(thresholdSec / avgPaceSec, 2) * 100);
  }, [activity, athleteProfile]);

  /** Efficiency Factor = avg pace (m/s) / avg HR — higher is more efficient */
  const ef = useMemo(() => {
    const avgHr = derivedAvgHr;
    const paceStr = activity?.avg_pace;
    if (!avgHr || avgHr <= 0 || !paceStr) return null;
    const m = paceStr.match(/(\d+):(\d+)/);
    if (!m) return null;
    const paceSec = parseInt(m[1]) * 60 + parseInt(m[2]);
    if (paceSec <= 0) return null;
    return ((1000 / paceSec) / avgHr).toFixed(3);
  }, [activity, derivedAvgHr]);

  /**
   * Aerobic Decoupling % = ((EF_first_half - EF_second_half) / EF_first_half) × 100
   * Split by number of chart points (proxy for distance midpoint).
   */
  const aerobicDecoupling = useMemo(() => {
    const pts = chartData.filter((d) => d.pace > 0 && d.hr > 0);
    if (pts.length < 20) return null;
    const mid = Math.floor(pts.length / 2);
    const halfEF = (data: typeof pts) => {
      const ap = data.reduce((s, d) => s + d.pace, 0) / data.length;
      const ah = data.reduce((s, d) => s + d.hr, 0) / data.length;
      return ah > 0 && ap > 0 ? (1000 / (ap * 60)) / ah : 0;
    };
    const e1 = halfEF(pts.slice(0, mid));
    const e2 = halfEF(pts.slice(mid));
    if (e1 <= 0) return null;
    return ((e1 - e2) / e1) * 100;
  }, [chartData]);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="animate-fade-in space-y-6">
          <button onClick={() => navigate("/community")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Back to Feed
          </button>
          <div className="h-[200px] rounded-2xl bg-secondary/30 animate-pulse" />
          <div className="h-24 rounded-xl bg-secondary/30 animate-pulse" />
        </div>
      </AppLayout>
    );
  }

  if (error || !activity) {
    return (
      <AppLayout>
        <div className="animate-fade-in space-y-6">
          <button onClick={() => navigate("/community")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Back to Feed
          </button>
          <div className="glass-card p-12 text-center">
            <p className="text-muted-foreground">Activity not found or unable to load.</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  const validLatlng = activity.latlng.filter(
    (p) => Array.isArray(p) && p.length >= 2 && isFinite(p[0]) && isFinite(p[1]) && p[0] !== 0 && p[1] !== 0
  );
  const hasMap = validLatlng.length >= 2;
  const nonDist = isNonDistanceActivity(activity.type);

  return (
    <AppLayout>
      <div className="animate-fade-in space-y-4 max-w-5xl mx-auto">
        <button onClick={() => navigate("/community")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground -ml-1">
          <ArrowLeft className="w-4 h-4" /> Back to Feed
        </button>

        {/* ── Hero header — big readable stats ── */}
        <div className="card-standard card-standard--no-padding overflow-hidden">
          <div className="px-5 py-5">
            {/* Title + date row */}
            <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-foreground">
                    {activity.name ?? activity.type}
                  </h1>
                  {isPb && (
                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${isMarathonPb ? "bg-amber-500/20 text-amber-700 dark:text-amber-400" : "bg-primary/15 text-primary"}`}>
                      <Trophy className="w-3 h-3" />
                      {isMarathonPb ? "Marathon PB" : "PB"}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">{format(new Date(activity.date), "EEEE, MMMM d, yyyy")}</p>
              </div>
              {activity.source === "intervals_icu" && (
                <GpxDownloadButton activityId={id} activityName={activity.name ?? activity.type ?? "activity"} className="shrink-0" />
              )}
            </div>

            {/* Big hero metrics */}
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              {!nonDist && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Distance</p>
                  <p className="text-3xl font-bold tabular-nums text-foreground">{formatDistance(activity.distance_km)}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Duration</p>
                <p className="text-3xl font-bold tabular-nums text-foreground">{formatDuration(activity.duration_seconds)}</p>
              </div>
              {!nonDist && activity.avg_pace && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Pace</p>
                  <p className="text-3xl font-bold tabular-nums text-foreground">
                    {normalizePaceDisplay(activity.avg_pace) || activity.avg_pace}
                    {!(normalizePaceDisplay(activity.avg_pace) || activity.avg_pace).endsWith("/km") && <span className="text-base font-normal text-muted-foreground ml-1">/km</span>}
                  </p>
                </div>
              )}
              {derivedAvgHr != null && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Avg HR</p>
                  <p className="text-3xl font-bold tabular-nums text-foreground">{derivedAvgHr}<span className="text-base font-normal text-muted-foreground ml-1">bpm</span></p>
                </div>
              )}
            </div>

            {/* Secondary stats row */}
            <div className="flex flex-wrap gap-x-5 gap-y-1 mt-4 text-xs text-muted-foreground">
              {activity.max_hr != null && <StatChip label="Max HR" value={`${activity.max_hr} bpm`} />}
              {bestPace != null && <StatChip label="Best Pace" value={`${formatPace(bestPace)}/km`} />}
              {activity.intensity != null && <StatChip label="Intensity" value={`${Math.round(activity.intensity)}%`} />}
              {tss != null && <StatChip label="TSS" value={`${tss}`} />}
              {activity.trimp != null && <StatChip label="TRIMP" value={`${Math.round(activity.trimp)}`} />}
              {activity.perceived_exertion != null && <StatChip label="RPE" value={`${activity.perceived_exertion}/10`} />}
              {activity.cadence != null && activity.cadence > 0 && <StatChip label="Cadence" value={formatCadence(cadenceToDisplaySpm(activity.cadence) ?? activity.cadence)} />}
              {activity.elevation_gain != null && activity.elevation_gain > 0 && <StatChip label="Elev ↑" value={formatElevation(activity.elevation_gain)} />}
              {elevationLoss != null && <StatChip label="Elev ↓" value={`${elevationLoss} m`} />}
              {ef != null && <StatChip label="EF" value={String(ef)} />}
              {aerobicDecoupling != null && (
                <StatChip
                  label="Decoupling"
                  value={`${aerobicDecoupling > 0 ? "+" : ""}${aerobicDecoupling.toFixed(1)}%`}
                  color={aerobicDecoupling < 5 ? "hsl(142 71% 45%)" : aerobicDecoupling < 8 ? "hsl(38 92% 50%)" : "hsl(0 84% 60%)"}
                />
              )}
              {activity.calories != null && activity.calories > 0 && <StatChip label="Calories" value={`${Math.round(activity.calories)}`} />}
            </div>

            <ActivityPlannedSessionBlock activity={activity} />
          </div>

          {/* Map (if available) */}
          {hasMap && (
            <div className="relative h-[200px] border-t border-border">
              <MapContainer center={[validLatlng[0][0], validLatlng[0][1]]} zoom={13} className="h-full w-full" scrollWheelZoom={false}>
                <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url={themeMode === "dark" ? TILE_DARK : TILE_LIGHT} />
                <Polyline positions={validLatlng} color="hsl(25 95% 53%)" weight={4} opacity={0.95} />
                <MapFitBounds latlng={validLatlng} />
              </MapContainer>
            </div>
          )}

          {/* Photos (visible to everyone when activity has photos) */}
          {(activity.photos?.length ?? 0) > 0 && (
            <div className="border-t border-border p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Photos</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {activity.photos?.map((p, i) => (
                  <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                    <img src={p.url} alt="" className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Social bar (likes / comments from friends) */}
        {activity.id && <ActivitySocialBar activityId={activity.id} edgeLikes={activity.edgeLikes} edgeComments={activity.edgeComments} />}

        {/* ── Tab navigation ── */}
        <div className="flex rounded-lg bg-muted/60 p-1">
          {detailTabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 ${tab === t ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t === "charts" ? "Charts" : t === "data" ? "Data" : "Notes"}
            </button>
          ))}
        </div>

        {/* ── TAB: Charts ── */}
        {tab === "charts" && (
          <div className="space-y-4">
            {/* Intervals bar */}
            {activity.splits.length > 1 && (
              <div className="card-standard card-standard--no-padding overflow-hidden">
                <div className="overflow-x-auto">
                  <div className="flex min-w-max">
                    {activity.splits.map((s, i) => {
                      const zone = s.hr != null ? (s.hr < 130 ? 0 : s.hr < 145 ? 1 : s.hr < 160 ? 2 : s.hr < 175 ? 3 : 4) : 1;
                      return (
                        <div key={i} className="flex-1 min-w-[72px] border-r border-border last:border-r-0 px-2 py-2 text-center">
                          <p className="text-[10px] text-muted-foreground mb-0.5">{s.elapsed_sec != null ? formatDuration(s.elapsed_sec) : `#${i + 1}`}</p>
                          <p className="text-xs font-bold tabular-nums text-foreground">{(normalizePaceDisplay(s.pace) || s.pace) ?? "—"}</p>
                          {s.hr != null && <p className="text-[10px] tabular-nums text-muted-foreground">{s.hr}bpm</p>}
                          <div className="mt-1 h-1.5 rounded-full" style={{ backgroundColor: HR_ZONE_COLORS[zone] }} />
                          <p className="text-[9px] text-muted-foreground mt-0.5">Z{zone + 1}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Stacked charts */}
            {hasGraphs && (
              <div className="card-standard card-standard--no-padding overflow-hidden">
                {hasPace && (
                  <div className="px-2 pt-3 pb-0">
                    <div className="flex items-center gap-2 px-3 mb-1">
                      <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: PACE_COLOR }}>Pace</span>
                    </div>
                    <div className="h-[140px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 4, right: 44, left: -4, bottom: 0 }}>
                          <defs>
                            <linearGradient id="paceGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={PACE_COLOR} stopOpacity={0.15} />
                              <stop offset="100%" stopColor={PACE_COLOR} stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="timeLabel" tick={false} tickLine={false} axisLine={false} height={0} />
                          <YAxis yAxisId="pace" orientation="left" domain={[(d: number) => Math.floor(d) - 1, (d: number) => Math.ceil(d) + 1]} tick={{ fontSize: 9, fill: PACE_COLOR }} tickFormatter={(v: number) => formatPace(v)} reversed allowDecimals={false} tickLine={false} axisLine={false} width={42} />
                          <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} labelFormatter={(l) => String(l)} formatter={(val: number) => [`${formatPace(val)}/km`, "Pace"]} />
                          <Area yAxisId="pace" type="natural" dataKey="pace" fill="url(#paceGrad)" stroke={PACE_COLOR} strokeWidth={1.5} dot={false} activeDot={{ r: 2 }} baseValue="dataMax" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {hasHr && (
                  <div className="px-2 pb-0">
                    <div className="flex items-center gap-2 px-3 mb-1">
                      <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: HR_COLOR }}>Heart Rate</span>
                    </div>
                    <div className="h-[120px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 4, right: 44, left: -4, bottom: 0 }}>
                          <defs>
                            <linearGradient id="hrGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={HR_COLOR} stopOpacity={0.2} />
                              <stop offset="100%" stopColor={HR_COLOR} stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="timeLabel" tick={false} tickLine={false} axisLine={false} height={0} />
                          <YAxis domain={[(d: number) => Math.floor(d / 5) * 5 - 10, (d: number) => Math.ceil(d / 5) * 5 + 10]} tick={{ fontSize: 9, fill: HR_COLOR }} tickFormatter={(v: number) => String(Math.round(v))} allowDecimals={false} tickLine={false} axisLine={false} width={42} />
                          <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} labelFormatter={(l) => String(l)} formatter={(val: number) => [`${Math.round(val)} bpm`, "HR"]} />
                          <Area type="natural" dataKey="hr" fill="url(#hrGrad)" stroke={HR_COLOR} strokeWidth={1.5} dot={false} activeDot={{ r: 2 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {hasCad && (
                  <div className="px-2 pb-0">
                    <div className="flex items-center gap-2 px-3 mb-1">
                      <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: CAD_COLOR }}>Cadence</span>
                    </div>
                    <div className="h-[100px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 4, right: 44, left: -4, bottom: 0 }}>
                          <defs>
                            <linearGradient id="cadGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={CAD_COLOR} stopOpacity={0.2} />
                              <stop offset="100%" stopColor={CAD_COLOR} stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="timeLabel" tick={false} tickLine={false} axisLine={false} height={0} />
                          <YAxis domain={["dataMin - 5", "dataMax + 5"]} tick={{ fontSize: 9, fill: CAD_COLOR }} tickFormatter={(v: number) => String(Math.round(v))} tickLine={false} axisLine={false} width={42} />
                          <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} labelFormatter={(l) => String(l)} formatter={(v: number) => [`${Math.round(v)} spm`, "Cadence"]} />
                          <Area type="natural" dataKey="cadence" fill="url(#cadGrad)" stroke={CAD_COLOR} strokeWidth={1.5} dot={false} activeDot={{ r: 2 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {hasAlt && (
                  <div className={`px-2 ${hasTemp || hasResp ? "pb-0" : "pb-2"}`}>
                    <div className="flex items-center gap-2 px-3 mb-1">
                      <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: ELEV_COLOR }}>Altitude</span>
                    </div>
                    <div className="h-[90px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 4, right: 44, left: -4, bottom: 0 }}>
                          <defs>
                            <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={ELEV_COLOR} stopOpacity={0.35} />
                              <stop offset="100%" stopColor={ELEV_COLOR} stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="timeLabel" tick={false} tickLine={false} axisLine={false} height={0} />
                          <YAxis domain={["dataMin - 5", "dataMax + 5"]} tick={{ fontSize: 9, fill: ELEV_COLOR }} tickFormatter={(v: number) => String(Math.round(v))} tickLine={false} axisLine={false} width={42} />
                          <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} formatter={(v: number) => [`${Math.round(v)} m`, "Elevation"]} labelFormatter={(l) => String(l)} />
                          <Area type="natural" dataKey="altitude" fill="url(#elevGrad)" stroke={ELEV_COLOR} strokeWidth={1.5} dot={false} activeDot={{ r: 2 }} baseValue="dataMin" />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {hasTemp && (
                  <div className={`px-2 ${hasResp ? "pb-0" : "pb-2"}`}>
                    <div className="flex items-center gap-2 px-3 mb-1">
                      <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: TEMP_COLOR }}>Temperature</span>
                    </div>
                    <div className="h-[90px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 4, right: 44, left: -4, bottom: 0 }}>
                          <defs>
                            <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={TEMP_COLOR} stopOpacity={0.25} />
                              <stop offset="100%" stopColor={TEMP_COLOR} stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="timeLabel" tick={false} tickLine={false} axisLine={false} height={0} />
                          <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fontSize: 9, fill: TEMP_COLOR }} tickFormatter={(v: number) => `${Math.round(v)}°`} tickLine={false} axisLine={false} width={42} />
                          <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} formatter={(v: number) => [`${Number(v).toFixed(1)}°C`, "Temp"]} labelFormatter={(l) => String(l)} />
                          <Area type="natural" dataKey="temperature" fill="url(#tempGrad)" stroke={TEMP_COLOR} strokeWidth={1.5} dot={false} activeDot={{ r: 2 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {hasResp && (
                  <div className="px-2 pb-2">
                    <div className="flex items-center gap-2 px-3 mb-1">
                      <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: RESP_COLOR }}>Respiration</span>
                    </div>
                    <div className="h-[90px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 4, right: 44, left: -4, bottom: 0 }}>
                          <defs>
                            <linearGradient id="respGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={RESP_COLOR} stopOpacity={0.25} />
                              <stop offset="100%" stopColor={RESP_COLOR} stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="timeLabel" tick={false} tickLine={false} axisLine={false} height={0} />
                          <YAxis domain={["dataMin - 2", "dataMax + 2"]} tick={{ fontSize: 9, fill: RESP_COLOR }} tickFormatter={(v: number) => `${Math.round(v)}`} tickLine={false} axisLine={false} width={42} />
                          <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} formatter={(v: number) => [`${Number(v).toFixed(1)} rpm`, "Respiration"]} labelFormatter={(l) => String(l)} />
                          <Area type="natural" dataKey="respiration_rate" fill="url(#respGrad)" stroke={RESP_COLOR} strokeWidth={1.5} dot={false} activeDot={{ r: 2 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                <div className="px-2 pb-2">
                  <div className="h-[20px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 0, right: 44, left: -4, bottom: 0 }}>
                        <XAxis
                          dataKey="km"
                          tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                          interval="preserveStartEnd"
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v: number) => `${v.toFixed(1)} km`}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* HR Distribution + Cumulative Time charts */}
            {hasHr && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <HrDistributionChart
                  chartData={chartData}
                  maxHr={athleteProfile?.max_hr ?? activity.max_hr}
                  restingHr={athleteProfile?.resting_hr ?? null}
                />
                <CumulativeHrChart
                  chartData={chartData}
                  maxHr={athleteProfile?.max_hr ?? activity.max_hr}
                  restingHr={athleteProfile?.resting_hr ?? null}
                />
              </div>
            )}

            {/* Mean Maximal HR Curve */}
            {hasHr && <MeanMaxHrChart chartData={chartData} />}

            {/* HR Zones — compact horizontal bars, always visible in charts tab when HR data exists */}
            {hrZoneTimesForTable != null && hrZoneTimesForTable.some((t) => t > 0) && (
              <div className="card-standard card-standard--no-padding overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-2 bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Heart className="w-3.5 h-3.5 text-primary" />
                    <span className="text-xs font-semibold text-foreground">HR Zones</span>
                  </div>
                  {hrZonesFromStream ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">from stream</span>
                  ) : (
                    <ZoneSourceBadge />
                  )}
                </div>
                <div className="p-4 space-y-2">
                  {(() => {
                    const total = hrZoneTimesForTable.reduce((a, b) => a + b, 0);
                    const maxT = Math.max(...hrZoneTimesForTable);
                    return hrZoneTimesForTable.map((t, i) => {
                      if (t <= 0) return null;
                      const pct = total > 0 ? (t / total) * 100 : 0;
                      const barPct = maxT > 0 ? (t / maxT) * 100 : 0;
                      const mins = Math.floor(t / 60);
                      const secs = Math.round(t % 60);
                      return (
                        <div key={i} className="flex items-center gap-3 text-xs">
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: HR_ZONE_COLORS[i] }} />
                          <span className="w-24 text-muted-foreground shrink-0">{HR_ZONE_NAMES[i] ?? `Zone ${i + 1}`}</span>
                          <div className="flex-1 h-3 bg-muted/40 rounded overflow-hidden">
                            <div className="h-full rounded transition-all" style={{ width: `${barPct}%`, backgroundColor: HR_ZONE_COLORS[i] }} />
                          </div>
                          <span className="w-14 text-right tabular-nums text-foreground font-medium shrink-0">
                            {mins}:{String(secs).padStart(2, "0")}
                          </span>
                          <span className="w-10 text-right tabular-nums text-muted-foreground shrink-0">{pct.toFixed(0)}%</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}

            {!hasGraphs && (
              <div className="rounded-xl border border-border bg-card p-8 text-center space-y-3">
                <p className="text-sm text-muted-foreground">{chartsEmptyMessage}</p>
                {!activity?.streamFetchError && id?.startsWith("icu_") && (
                  <button
                    onClick={() => queryClient.invalidateQueries({ queryKey: ["activity-detail", id] })}
                    className="text-xs text-primary hover:underline"
                  >
                    Retry loading graphs from intervals.icu
                  </button>
                )}
                {activity?.streamFetchError && id?.startsWith("icu_") && (
                  <button
                    onClick={() => queryClient.invalidateQueries({ queryKey: ["activity-detail", id] })}
                    className="text-xs text-primary hover:underline"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── TAB: Data ── */}
        {tab === "data" && (
          <div className="space-y-4">
            {/* HR Zone Detail Table — use stream + athlete zones when available, else source data */}
            {hrZoneTimesForTable != null && hrZoneTimesForTable.some((t) => t > 0) && (
              <div className="card-standard card-standard--no-padding overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-2 bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Heart className="w-3.5 h-3.5 text-primary" />
                    <span className="text-xs font-semibold text-foreground">Heart Rate Zones</span>
                  </div>
                  {hrZonesFromStream ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                      Your zones (from stream)
                    </span>
                  ) : (
                    <ZoneSourceBadge />
                  )}
                </div>
                <ZoneDetailTable times={hrZoneTimesForTable} names={HR_ZONE_NAMES} colors={HR_ZONE_COLORS} maxHr={athleteProfile?.max_hr ?? activity.max_hr} restingHr={athleteProfile?.resting_hr ?? null} />
              </div>
            )}

            {/* Pace Zone Detail Table */}
            {activity.pace_zone_times && activity.pace_zone_times.some(t => t > 0) && (
              <div className="card-standard card-standard--no-padding overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-muted/30">
                  <BarChart3 className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-semibold text-foreground">Pace Zones</span>
                </div>
                <ZoneDetailTable times={activity.pace_zone_times} names={PACE_ZONE_NAMES} colors={HR_ZONE_COLORS} />
              </div>
            )}

            {/* Summary Stats Card */}
            <div className="card-standard card-standard--no-padding overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-muted/30">
                <BarChart3 className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-semibold text-foreground">Summary</span>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                  {!nonDist && <SummaryItem label="Distance" value={formatDistance(activity.distance_km)} />}
                  <SummaryItem label="Duration" value={formatDuration(activity.duration_seconds)} />
                  {!nonDist && activity.avg_pace && (
                    <SummaryItem
                      label="Avg Pace"
                      value={`${(normalizePaceDisplay(activity.avg_pace) || activity.avg_pace).replace(/\/km$/i, "")}/km`}
                    />
                  )}
                  <SummaryItem label="Avg HR" value={derivedAvgHr != null ? `${derivedAvgHr} bpm` : "—"} />
                  {activity.max_hr != null && <SummaryItem label="Max HR" value={`${activity.max_hr} bpm`} />}
                  {derivedAvgHr != null && activity.max_hr != null && activity.max_hr > 0 && (
                    <SummaryItem label="HR %" value={`${Math.round((derivedAvgHr / activity.max_hr) * 100)}%`} />
                  )}
                  {activity.load != null && <SummaryItem label="Training Load" value={`${Math.round(activity.load)}`} />}
                  {activity.trimp != null && <SummaryItem label="TRIMP" value={`${Math.round(activity.trimp)}`} />}
                  {activity.intensity != null && <SummaryItem label="Intensity" value={`${Math.round(activity.intensity)}%`} />}
                  {activity.perceived_exertion != null && <SummaryItem label="RPE" value={`${activity.perceived_exertion}/10`} />}
                  {activity.cadence != null && activity.cadence > 0 && <SummaryItem label="Avg Cadence" value={formatCadence(cadenceToDisplaySpm(activity.cadence) ?? activity.cadence)} />}
                  {activity.elevation_gain != null && activity.elevation_gain > 0 && (
                    <SummaryItem label="Elev Gain" value={formatElevation(activity.elevation_gain)} />
                  )}
                  {elevationLoss != null && <SummaryItem label="Elev Loss" value={`${elevationLoss} m`} />}
                  {bestPace != null && <SummaryItem label="Best Pace" value={`${formatPace(bestPace)}/km`} />}
                  {tss != null && <SummaryItem label="TSS" value={`${tss}`} />}
                  {activity.calories != null && activity.calories > 0 && <SummaryItem label="Calories" value={`${Math.round(activity.calories)} kcal`} />}
                  {ef != null && <SummaryItem label="Efficiency Factor" value={String(ef)} />}
                  {aerobicDecoupling != null && (
                    <div>
                      <p className="text-xs text-muted-foreground">Aerobic Decoupling</p>
                      <p className={`font-semibold tabular-nums ${aerobicDecoupling < 5 ? "text-green-500" : aerobicDecoupling < 8 ? "text-amber-500" : "text-red-500"}`}>
                        {aerobicDecoupling > 0 ? "+" : ""}{aerobicDecoupling.toFixed(1)}%
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Splits Table */}
            {activity.splits.length > 0 && (
              <div className="card-standard card-standard--no-padding overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 bg-muted/30">
                  <BarChart3 className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-semibold text-foreground">Splits</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/20">
                        <th className="text-left py-2.5 px-4 font-medium text-muted-foreground">Km</th>
                        <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">Time</th>
                        <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">Pace</th>
                        {activity.splits.some(s => s.hr != null) && <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">Avg HR</th>}
                        {activity.splits.some(s => s.hr != null) && <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">Zone</th>}
                        {activity.splits.some(s => s.elevation != null) && <th className="text-right py-2.5 px-4 font-medium text-muted-foreground">Elev</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {activity.splits.map((s, i) => {
                        const zone = s.hr != null ? (s.hr < 130 ? 1 : s.hr < 145 ? 2 : s.hr < 160 ? 3 : s.hr < 175 ? 4 : 5) : null;
                        const hasElevCol = activity.splits.some(sp => sp.elevation != null);
                        return (
                          <tr key={i} className="border-b border-border/40 hover:bg-muted/20">
                            <td className="py-2 px-4 font-medium tabular-nums text-foreground">{s.km != null ? s.km : i + 1}</td>
                            <td className="py-2 px-4 text-right tabular-nums">{s.elapsed_sec != null ? formatDuration(s.elapsed_sec) : "—"}</td>
                            <td className="py-2 px-4 text-right tabular-nums font-medium text-foreground">{(normalizePaceDisplay(s.pace) || s.pace) ?? "—"}</td>
                            {activity.splits.some(sp => sp.hr != null) && <td className="py-2 px-4 text-right tabular-nums">{s.hr ?? "—"}</td>}
                            {activity.splits.some(sp => sp.hr != null) && (
                              <td className="py-2 px-4 text-right">
                                {zone != null && (
                                  <span className="inline-flex items-center gap-1 text-xs">
                                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: HR_ZONE_COLORS[zone - 1] }} />
                                    {zone}
                                  </span>
                                )}
                              </td>
                            )}
                            {hasElevCol && <td className="py-2 px-4 text-right tabular-nums text-muted-foreground">{s.elevation != null ? `${Math.round(s.elevation)} m` : "—"}</td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: Notes (owner only; notes are private) ── */}
        {tab === "notes" && isOwner && (
          <div className="space-y-4">
            <CoachNote activityId={id} cachedNote={activity.coach_note} />
            <ActivityPhotos
              activityId={activity.dbId ?? activity.id}
              photos={activity.photos ?? []}
              userId={user?.id}
              onUpdate={() => queryClient.invalidateQueries({ queryKey: ["activity-detail", id] })}
            />
            <ActivityNotes
              activityId={id}
              userNotes={activity.user_notes}
              nomioDrink={activity.nomio_drink}
              lactateLevels={activity.lactate_levels}
              enhancingSupplements={activity.enhancing_supplements}
              onUpdate={() => queryClient.invalidateQueries({ queryKey: ["activity-detail", id] })}
            />
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function GpxDownloadButton({ activityId, activityName, className }: { activityId: string; activityName: string; className?: string }) {
  const [loading, setLoading] = useState(false);
  const activityIdForApi = activityId?.startsWith("icu_") ? activityId.replace(/^icu_/, "") : activityId;

  const download = useCallback(async () => {
    if (!activityIdForApi || loading) return;
    setLoading(true);
    try {
      let token: string;
      try {
        token = await getSafeAccessToken();
      } catch {
        return;
      }
      const { data, error } = await supabase.functions.invoke("intervals-proxy", {
        headers: { Authorization: `Bearer ${token}` },
        body: { action: "gpx", activityId: activityIdForApi },
      });
      if (error || (data && typeof data === "object" && "error" in (data as object))) {
        toast({ title: "GPX unavailable", description: "No GPS track for this activity.", variant: "destructive" });
        return;
      }
      const gpx = typeof data === "string" ? data : JSON.stringify(data);
      const blob = new Blob([gpx], { type: "application/gpx+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activityName.replace(/[^a-zA-Z0-9-_]/g, "_")}-${activityIdForApi}.gpx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setLoading(false);
    }
  }, [activityIdForApi, activityName, loading]);

  const base = "flex items-center gap-1.5 rounded-lg bg-background/90 px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm border border-border hover:bg-muted/80 transition-colors";
  return (
    <button
      onClick={download}
      disabled={loading}
      className={className ? `${base} ${className}` : `${base} absolute top-2 right-2 z-[1000]`}
    >
      <Download className="w-3.5 h-3.5" />
      {loading ? "…" : "Download GPX"}
    </button>
  );
}

function parseSupplements(s: EnhancingSupplements | null | undefined): {
  beetrootValue: string;
  beetrootUnit: "ml" | "mg";
  bicarbValue: string;
  caffeineValue: string;
  carbsValue: string;
} {
  const empty = { beetrootValue: "", beetrootUnit: "ml" as const, bicarbValue: "", caffeineValue: "", carbsValue: "" };
  if (!s || typeof s !== "object") return empty;
  return {
    beetrootValue: s.beetroot?.value != null ? String(s.beetroot.value) : "",
    beetrootUnit: s.beetroot?.unit === "mg" ? "mg" : "ml",
    bicarbValue: s.bicarb?.value != null ? String(s.bicarb.value) : "",
    caffeineValue: s.caffeine?.value != null ? String(s.caffeine.value) : "",
    carbsValue: s.carbs?.value != null ? String(s.carbs.value) : "",
  };
}

function buildSupplements(p: ReturnType<typeof parseSupplements>): EnhancingSupplements {
  const out: EnhancingSupplements = {};
  const beetrootVal = p.beetrootValue.trim() ? Number(p.beetrootValue) : NaN;
  if (!isNaN(beetrootVal) && beetrootVal > 0) out.beetroot = { value: beetrootVal, unit: p.beetrootUnit };
  const bicarbVal = p.bicarbValue.trim() ? Number(p.bicarbValue) : NaN;
  if (!isNaN(bicarbVal) && bicarbVal > 0) out.bicarb = { value: bicarbVal, unit: "g" };
  const caffeineVal = p.caffeineValue.trim() ? Number(p.caffeineValue) : NaN;
  if (!isNaN(caffeineVal) && caffeineVal > 0) out.caffeine = { value: caffeineVal, unit: "mg" };
  const carbsVal = p.carbsValue.trim() ? Number(p.carbsValue) : NaN;
  if (!isNaN(carbsVal) && carbsVal > 0) out.carbs = { value: carbsVal, unit: "g" };
  return out;
}

function ActivityNotes({
  activityId,
  userNotes,
  nomioDrink,
  lactateLevels,
  enhancingSupplements,
  onUpdate,
}: {
  activityId: string | undefined;
  userNotes?: string | null;
  nomioDrink?: boolean | null;
  lactateLevels?: string | null;
  enhancingSupplements?: EnhancingSupplements | null;
  onUpdate: () => void;
}) {
  const parsed = parseSupplements(enhancingSupplements);
  const [notes, setNotes] = useState(userNotes ?? "");
  const [nomio, setNomio] = useState(!!nomioDrink);
  const [lactate, setLactate] = useState(lactateLevels ?? "");
  const [beetrootValue, setBeetrootValue] = useState(parsed.beetrootValue);
  const [beetrootUnit, setBeetrootUnit] = useState<"ml" | "mg">(parsed.beetrootUnit);
  const [bicarbValue, setBicarbValue] = useState(parsed.bicarbValue);
  const [caffeineValue, setCaffeineValue] = useState(parsed.caffeineValue);
  const [carbsValue, setCarbsValue] = useState(parsed.carbsValue);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNotes(userNotes ?? "");
    setNomio(!!nomioDrink);
    setLactate(lactateLevels ?? "");
    const p = parseSupplements(enhancingSupplements);
    setBeetrootValue(p.beetrootValue);
    setBeetrootUnit(p.beetrootUnit);
    setBicarbValue(p.bicarbValue);
    setCaffeineValue(p.caffeineValue);
    setCarbsValue(p.carbsValue);
  }, [userNotes, nomioDrink, lactateLevels, enhancingSupplements]);

  const supplements = useMemo(
    () => buildSupplements({ beetrootValue, beetrootUnit, bicarbValue, caffeineValue, carbsValue }),
    [beetrootValue, beetrootUnit, bicarbValue, caffeineValue, carbsValue]
  );

  const save = useCallback(async () => {
    if (!activityId) return;
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      if (!user) return;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activityId);
      const query = supabase
        .from("activity")
        .update({
          user_notes: notes || null,
          nomio_drink: nomio,
          lactate_levels: lactate || null,
          enhancing_supplements: Object.keys(supplements).length ? supplements : {},
        })
        .eq("user_id", user.id);
      const { error } = isUuid
        ? await query.eq("id", activityId)
        : await query.eq("external_id", activityId.startsWith("icu_") ? activityId.replace(/^icu_/, "") : activityId);
      if (!error) onUpdate();
    } finally {
      setSaving(false);
    }
  }, [activityId, notes, nomio, lactate, supplements, onUpdate]);

  useEffect(() => {
    const t = setTimeout(save, 500);
    return () => clearTimeout(t);
  }, [notes, nomio, lactate, supplements]);

  return (
    <div className="card-standard space-y-4">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Training notes</span>
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">How you felt & notes</Label>
        <Textarea
          placeholder="e.g. Legs felt heavy, good session overall..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1.5 min-h-[72px] resize-none"
          rows={3}
        />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coffee className="w-4 h-4 text-muted-foreground" />
          <Label htmlFor="nomio" className="text-sm font-medium cursor-pointer">Nomio drink before</Label>
        </div>
        <Switch id="nomio" checked={nomio} onCheckedChange={setNomio} />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Droplets className="w-3.5 h-3.5" /> Lactate levels
        </Label>
        <Textarea
          placeholder="e.g. After each rep: 4.2, 5.1, 4.8 — or post-session: 3.5"
          value={lactate}
          onChange={(e) => setLactate(e.target.value)}
          className="mt-1.5 min-h-[56px] resize-none text-sm"
          rows={2}
        />
      </div>
      <div className="border-t border-border pt-4 space-y-3">
        <span className="text-xs font-medium text-muted-foreground">Enhancing supplements</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="beetroot" className="text-xs text-muted-foreground">Beetroot</Label>
            <div className="flex gap-2">
              <Input
                id="beetroot"
                type="number"
                min={0}
                step={0.1}
                placeholder="Amount"
                value={beetrootValue}
                onChange={(e) => setBeetrootValue(e.target.value)}
                className="flex-1"
              />
              <select
                value={beetrootUnit}
                onChange={(e) => setBeetrootUnit(e.target.value as "ml" | "mg")}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="ml">ml</option>
                <option value="mg">mg</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bicarb" className="text-xs text-muted-foreground">Sodium bicarbonate (BiCarb)</Label>
            <div className="flex gap-2 items-center">
              <Input
                id="bicarb"
                type="number"
                min={0}
                step={0.1}
                placeholder="g"
                value={bicarbValue}
                onChange={(e) => setBicarbValue(e.target.value)}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-6">g</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="caffeine" className="text-xs text-muted-foreground">Caffeine</Label>
            <div className="flex gap-2 items-center">
              <Input
                id="caffeine"
                type="number"
                min={0}
                step={1}
                placeholder="mg"
                value={caffeineValue}
                onChange={(e) => setCaffeineValue(e.target.value)}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-8">mg</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="carbs" className="text-xs text-muted-foreground">Carbs</Label>
            <div className="flex gap-2 items-center">
              <Input
                id="carbs"
                type="number"
                min={0}
                step={1}
                placeholder="g"
                value={carbsValue}
                onChange={(e) => setCarbsValue(e.target.value)}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-6">g</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CoachNote({ activityId, cachedNote }: { activityId: string | undefined; cachedNote?: string | null }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState<string | null>(cachedNote ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const activityIdForApi = activityId?.startsWith("icu_") ? activityId.replace(/^icu_/, "") : activityId;

  const generate = useCallback(async (forceRegenerate = false) => {
    if (!activityIdForApi || loading) return;
    setLoading(true);
    setError(false);
    try {
      let token: string;
      try {
        token = await getSafeAccessToken();
      } catch {
        setError(true);
        return;
      }
      const { data, error: fnErr } = await supabase.functions.invoke("intervals-proxy", {
        headers: { Authorization: `Bearer ${token}` },
        body: { action: "activity_coach_note", activityId: activityIdForApi, regenerate: forceRegenerate },
      });
      if (fnErr || !data?.note) { setError(true); return; }
      setNote(data.note);
      queryClient.invalidateQueries({ queryKey: ["activity-detail", activityId] });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [activityIdForApi, activityId, loading, queryClient]);

  useEffect(() => {
    if (cachedNote) { setNote(cachedNote); return; }
    if (!note && activityIdForApi) generate();
  }, [cachedNote, activityIdForApi]);

  if (error && !note) {
    return (
      <div className="card-standard flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2 shrink-0">
          <MessageCircle className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground mb-0.5">Coach Cade</p>
          <p className="text-sm text-muted-foreground">Couldn't generate feedback.</p>
        </div>
        <button onClick={generate} className="text-xs text-primary hover:underline shrink-0">Retry</button>
      </div>
    );
  }

  return (
    <div className="card-standard flex items-start gap-3">
      <div className="rounded-lg bg-primary/10 p-2 shrink-0 mt-0.5">
        <MessageCircle className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-muted-foreground mb-1">Coach Cade</p>
        {loading || !note ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Analyzing your activity...</span>
          </div>
        ) : (
          <>
            <p className="text-sm text-foreground leading-relaxed">{note}</p>
            <button
              onClick={() => generate(true)}
              disabled={loading}
              className="mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Regenerate feedback
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** HR Distribution Histogram — time spent at each BPM, colored by athlete zone */
function HrDistributionChart({ chartData, maxHr, restingHr }: { chartData: ChartPoint[]; maxHr?: number | null; restingHr?: number | null }) {
  const effectiveMax = maxHr ?? Math.max(...chartData.map((d) => d.hr).filter(Boolean));
  if (!effectiveMax || effectiveMax <= 0) return null;

  const hrVals = chartData.map((d) => Math.round(d.hr)).filter((h) => h > 0);
  if (hrVals.length === 0) return null;

  const minHr = Math.min(...hrVals);
  const maxHrVal = Math.max(...hrVals);
  const bucketSize = 2;
  const buckets: { bpm: number; seconds: number; zone: number }[] = [];
  const intervalSec = chartData.length > 1 ? Math.max(1, (chartData[chartData.length - 1].t - chartData[0].t) / (chartData.length - 1)) : 1;

  for (let b = Math.floor(minHr / bucketSize) * bucketSize; b <= maxHrVal; b += bucketSize) {
    const count = hrVals.filter((h) => h >= b && h < b + bucketSize).length;
    const zone1Based = getZoneFromBpm(b + bucketSize / 2, effectiveMax, restingHr);
    buckets.push({ bpm: b, seconds: count * intervalSec, zone: zone1Based - 1 });
  }

  return (
    <div className="card-standard">
      <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
        <Heart className="w-3.5 h-3.5 text-red-500" />
        HR Distribution
      </p>
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsBarChart data={buckets} margin={{ top: 4, right: 8, left: -4, bottom: 0 }} barCategoryGap={0} barGap={0}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="bpm" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={36} tickFormatter={(v: number) => v >= 60 ? `${(v / 60).toFixed(0)}m` : `${Math.round(v)}s`} />
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} formatter={(v: number) => [v >= 60 ? `${(v / 60).toFixed(1)}min` : `${Math.round(v)}s`, "Time"]} labelFormatter={(l) => `${l} bpm`} />
            <Bar dataKey="seconds" radius={[1, 1, 0, 0]}>
              {buckets.map((b, i) => (
                <Cell key={i} fill={HR_ZONE_COLORS[b.zone] ?? HR_ZONE_COLORS[HR_ZONE_COLORS.length - 1]} />
              ))}
            </Bar>
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Cumulative Time at HR — total time accumulated at or above each HR */
function CumulativeHrChart({ chartData, maxHr, restingHr }: { chartData: ChartPoint[]; maxHr?: number | null; restingHr?: number | null }) {
  const effectiveMax = maxHr ?? Math.max(...chartData.map((d) => d.hr).filter(Boolean));
  if (!effectiveMax || effectiveMax <= 0) return null;

  const hrVals = chartData.map((d) => Math.round(d.hr)).filter((h) => h > 0);
  if (hrVals.length === 0) return null;

  const intervalSec = chartData.length > 1 ? Math.max(1, (chartData[chartData.length - 1].t - chartData[0].t) / (chartData.length - 1)) : 1;
  const maxHrVal = Math.max(...hrVals);
  const minHr = Math.min(...hrVals);
  const step = 1;
  const data: { bpm: number; cumSeconds: number; zone: number }[] = [];

  for (let bpm = maxHrVal; bpm >= minHr; bpm -= step) {
    const count = hrVals.filter((h) => h >= bpm).length;
    const zone1Based = getZoneFromBpm(bpm, effectiveMax, restingHr);
    data.push({ bpm, cumSeconds: count * intervalSec, zone: zone1Based - 1 });
  }
  data.reverse();

  const bounds = getZoneBounds(effectiveMax, restingHr);
  const zoneBreaks = [bounds.z1[1], bounds.z2[1], bounds.z3[1], bounds.z4[1], bounds.z5[1], effectiveMax];

  return (
    <div className="card-standard">
      <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
        <Heart className="w-3.5 h-3.5 text-red-500" />
        Cumulative Time
      </p>
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 8, left: -4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="bpm" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} reversed interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={36} scale="log" domain={[1, "auto"]} allowDataOverflow tickFormatter={(v: number) => v >= 60 ? `${(v / 60).toFixed(0)}m` : `${Math.round(v)}s`} />
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} formatter={(v: number) => [v >= 60 ? `${(v / 60).toFixed(1)}min` : `${Math.round(v)}s`, "Time ≥"]} labelFormatter={(l) => `≥ ${l} bpm`} />
            {zoneBreaks.map((bpm, i) => (
              <Line key={`zb-${i}`} type="monotone" dataKey={() => null} stroke="none" dot={false} activeDot={false} />
            ))}
            <Area type="stepAfter" dataKey="cumSeconds" fill="url(#cumHrGrad)" stroke={HR_COLOR} strokeWidth={1.5} dot={false} />
            <defs>
              <linearGradient id="cumHrGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={HR_COLOR} stopOpacity={0.3} />
                <stop offset="100%" stopColor={HR_COLOR} stopOpacity={0.03} />
              </linearGradient>
            </defs>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        {zoneBreaks.slice(0, -1).map((bpm, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: HR_ZONE_COLORS[i + 1] ?? HR_ZONE_COLORS[0] }} />
            Z{i + 2} {bpm}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Mean Maximal HR Curve — max sustained HR over increasing time windows */
function MeanMaxHrChart({ chartData }: { chartData: ChartPoint[] }) {
  const hrVals = chartData.map((d) => d.hr).filter(Boolean);
  if (hrVals.length < 10) return null;

  const intervalSec = chartData.length > 1 ? Math.max(1, (chartData[chartData.length - 1].t - chartData[0].t) / (chartData.length - 1)) : 1;

  const durations = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1200, 1800, 2700, 3600].filter(
    (d) => d <= chartData.length * intervalSec
  );

  const mmhr: { duration: number; label: string; maxAvgHr: number }[] = [];
  for (const dur of durations) {
    const windowSize = Math.max(1, Math.round(dur / intervalSec));
    if (windowSize > hrVals.length) continue;
    let maxAvg = 0;
    let windowSum = 0;
    for (let i = 0; i < windowSize; i++) windowSum += hrVals[i];
    maxAvg = windowSum / windowSize;
    for (let i = windowSize; i < hrVals.length; i++) {
      windowSum += hrVals[i] - hrVals[i - windowSize];
      maxAvg = Math.max(maxAvg, windowSum / windowSize);
    }
    const label = dur < 60 ? `${dur}s` : dur < 3600 ? `${Math.round(dur / 60)}m` : `${(dur / 3600).toFixed(1)}h`;
    mmhr.push({ duration: dur, label, maxAvgHr: Math.round(maxAvg) });
  }

  if (mmhr.length < 3) return null;

  return (
    <div className="card-standard">
      <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
        <Heart className="w-3.5 h-3.5 text-red-500" />
        HR Curve (Mean Maximal)
      </p>
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={mmhr} margin={{ top: 4, right: 8, left: -4, bottom: 0 }}>
            <defs>
              <linearGradient id="mmhrGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={HR_COLOR} stopOpacity={0.25} />
                <stop offset="100%" stopColor={HR_COLOR} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
            <YAxis domain={["dataMin - 5", "dataMax + 5"]} tick={{ fontSize: 9, fill: HR_COLOR }} tickLine={false} axisLine={false} width={36} />
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} formatter={(v: number) => [`${v} bpm`, "Max Avg HR"]} />
            <Area type="natural" dataKey="maxAvgHr" fill="url(#mmhrGrad)" stroke={HR_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** intervals.icu-style zone detail table with % range, HR range, colored bar, time, % */
function ZoneDetailTable({ times, names, colors, maxHr, restingHr }: { times: number[]; names: string[]; colors: string[]; maxHr?: number | null; restingHr?: number | null }) {
  const total = times.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const maxTime = Math.max(...times);
  const hrRanges = maxHr && maxHr > 0
    ? (() => {
        const bounds = getZoneBounds(maxHr, restingHr);
        return [
          `${bounds.z1[0]} - ${bounds.z1[1]}`,
          `${bounds.z2[0]} - ${bounds.z2[1]}`,
          `${bounds.z3[0]} - ${bounds.z3[1]}`,
          `${bounds.z4[0]} - ${bounds.z4[1]}`,
          `${bounds.z5[0]} - ${bounds.z5[1]}`,
          `${maxHr}+`,
        ];
      })()
    : null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/20">
            <th className="text-left py-2 px-4 font-medium text-muted-foreground w-[140px]">Zone</th>
            {hrRanges && <th className="text-left py-2 px-4 font-medium text-muted-foreground w-[110px]">HR Range</th>}
            <th className="text-left py-2 px-4 font-medium text-muted-foreground">Distribution</th>
            <th className="text-right py-2 px-4 font-medium text-muted-foreground w-[80px]">Time</th>
            <th className="text-right py-2 px-4 font-medium text-muted-foreground w-[60px]">%</th>
          </tr>
        </thead>
        <tbody>
          {times.map((t, i) => {
            const pct = total > 0 ? (t / total) * 100 : 0;
            const barPct = maxTime > 0 ? (t / maxTime) * 100 : 0;
            const mins = Math.round(t / 60);
            const timeStr = mins >= 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}m` : `${mins}m${String(Math.round(t % 60)).padStart(2, "0")}s`;
            return (
              <tr key={i} className="border-b border-border/40">
                <td className="py-2 px-4">
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colors[i] ?? colors[colors.length - 1] }} />
                    <span className="font-medium text-foreground">{names[i] ?? `Zone ${i + 1}`}</span>
                  </span>
                </td>
                {hrRanges && <td className="py-2 px-4 tabular-nums text-xs text-muted-foreground">{hrRanges[i] ?? ""}</td>}
                <td className="py-2 px-4">
                  <div className="h-4 bg-muted/40 rounded overflow-hidden">
                    <div className="h-full rounded transition-all" style={{ width: `${barPct}%`, backgroundColor: colors[i] ?? colors[colors.length - 1] }} />
                  </div>
                </td>
                <td className="py-2 px-4 text-right tabular-nums text-foreground font-medium">{t > 0 ? timeStr : "—"}</td>
                <td className="py-2 px-4 text-right tabular-nums text-muted-foreground">{pct > 0.5 ? `${pct.toFixed(1)}%` : pct > 0 ? "<1%" : "0%"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

/** Compact stat chip for the intervals.icu-style header bar */
function StatChip({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</span>
      {sub && <span className="text-muted-foreground">{sub}</span>}
    </div>
  );
}
