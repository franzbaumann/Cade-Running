import { useState, useEffect, useRef } from "react";
import { CadeAvatar } from "@/components/CadeAvatar";
import { useQuery } from "@tanstack/react-query";
import { ReadinessRing } from "@/components/ReadinessRing";
import { WorkoutBadge } from "@/components/WorkoutBadge";
import { Sparkline } from "@/components/Sparkline";
import { AppLayout } from "@/components/AppLayout";
import { useGreeting } from "@/hooks/useGreeting";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useIntervalsIntegration } from "@/hooks/useIntervalsIntegration";
import { useIntervalsSync } from "@/hooks/useIntervalsSync";
import { useSeason } from "@/hooks/useSeason";
import { isRunningActivity } from "@/lib/analytics";
import { predictRaceTime, predictRaceTimeV2, formatRaceTime, calculateZonePaces, findBestEffort } from "@/lib/race-prediction";
import { useZoneSource } from "@/hooks/useZoneSource";
import { calculateTaperStart, daysUntil } from "@/lib/season/periodisation";
import { format, parseISO } from "date-fns";
import { TrendingDown, Moon, Heart, ChevronRight, ChevronDown, Loader2, Trophy, AlertTriangle, Flame, Brain, RefreshCw, Check } from "lucide-react";
import { useDailyLoad } from "@/hooks/useDailyLoad";
import { useDailyCheckIn } from "@/components/DailyCheckInContext";
import { supabase } from "@/integrations/supabase/client";
import { formatSleepHours } from "@/lib/format";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WeekProposal } from "@/components/WeekProposal";
import { toast } from "sonner";
import { formatCoachText } from "@/lib/format-coach-text";
import { useAuth } from "@/hooks/use-auth";

const RACE_DISTANCES: { km: number; label: string }[] = [
  { km: 5, label: "5K" },
  { km: 10, label: "10K" },
  { km: 21.0975, label: "Half Marathon" },
  { km: 42.195, label: "Marathon" },
];

function goalRaceToKm(goalRace: string): number {
  const t = String(goalRace || "").toLowerCase();
  if (t.includes("marathon") && !t.includes("half")) return 42.195;
  if (t.includes("half")) return 21.0975;
  if (t.includes("10")) return 10;
  if (t.includes("5")) return 5;
  return 21.0975;
}

function goalRaceToLabel(goalRace: string): string {
  const t = String(goalRace || "").toLowerCase();
  if (t.includes("marathon") && !t.includes("half")) return "Marathon";
  if (t.includes("half")) return "Half Marathon";
  if (t.includes("10")) return "10K";
  if (t.includes("5")) return "5K";
  return "Half Marathon";
}

/** Light mode: theme colors. Dark mode: match ActivityDetail bar (hex) */
const HR_ZONE_LIGHT = ["bg-secondary", "bg-accent/60", "bg-primary/60", "bg-warning/80", "bg-destructive/70"] as const;

const fadeIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.3 },
};

function RacePredictionCard({
  activities,
  ctl,
  atl,
  tsb,
  rampRate,
  goalRaceType,
  athleteProfile,
  readinessRows,
}: {
  activities: Array<{ distance_km: number | null; duration_seconds: number | null; date: string; type?: string | null; id?: string; splits?: unknown }>;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  rampRate: number | null;
  goalRaceType: string;
  athleteProfile: { vdot: number | null; vo2max: number | null; lactateThresholdPace: string | null; injuryHistoryText?: string | null } | null;
  readinessRows: Array<{ date: string; vo2max?: number | null; ctl?: number | null; icu_ctl?: number | null }>;
}) {
  const [open, setOpen] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const goalKm = goalRaceToKm(goalRaceType);
  const goalLabel = goalRaceToLabel(goalRaceType);
  const baselineCTL = ctl != null ? Math.max(ctl * 0.7, 20) : 20;

  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const twentyEightDaysAgo = new Date(now - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const runningActivities = activities.filter((a) => isRunningActivity(a.type));
  const recentVolume7dKm = runningActivities
    .filter((a) => a.date >= sevenDaysAgo)
    .reduce((sum, a) => sum + (a.distance_km ?? 0), 0);
  const recentVolume28dKm = runningActivities
    .filter((a) => a.date >= twentyEightDaysAgo)
    .reduce((sum, a) => sum + (a.distance_km ?? 0), 0);

  const prediction = predictRaceTimeV2({
    activities: activities as import("@/hooks/useActivities").ActivityRow[],
    targetDistanceKm: goalKm,
    ctl,
    atl,
    tsb,
    rampRate,
    athleteProfile,
    readiness: readinessRows,
    recentVolume7dKm,
    recentVolume28dKm,
    injuryHistoryText: athleteProfile?.injuryHistoryText ?? null,
  });

  const best = findBestEffort(activities);
  if (!prediction && (!best || !ctl)) return null;

  const predictedSeconds = prediction?.predictedTimeSeconds ?? (best && ctl
    ? predictRaceTime(best.timeSeconds, best.distanceKm, goalKm, ctl, baselineCTL)
    : 0);
  const paces = prediction
    ? { zone2: prediction.zone2Pace, threshold: prediction.thresholdPace, vo2max: prediction.vo2maxPace }
    : calculateZonePaces(predictedSeconds, goalKm, {
        lactateThresholdPace: athleteProfile?.lactateThresholdPace ?? null,
        recentRunsMedianPaceSecPerKm: (() => {
          const recent = activities.filter((a) => isRunningActivity(a.type) && (a.date >= new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10)) && (a.distance_km ?? 0) >= 3 && (a.duration_seconds ?? 0) > 0);
          if (recent.length < 2) return null;
          const p = recent.map((a) => (a.duration_seconds ?? 0) / (a.distance_km ?? 1)).filter((x) => x >= 180 && x <= 600);
          if (p.length < 2) return null;
          const s = [...p].sort((a, b) => a - b);
          return s[Math.floor(s.length / 2)];
        })(),
      });

  const allPredictions = RACE_DISTANCES.map(({ km, label }) => {
    const p = predictRaceTimeV2({
      activities: activities as import("@/hooks/useActivities").ActivityRow[],
      targetDistanceKm: km,
      ctl,
      atl,
      tsb,
      rampRate,
      athleteProfile,
      readiness: readinessRows,
      recentVolume7dKm,
      recentVolume28dKm,
      injuryHistoryText: athleteProfile?.injuryHistoryText ?? null,
    });
    const fallback = best && ctl ? predictRaceTime(best.timeSeconds, best.distanceKm, km, ctl, baselineCTL) : 0;
    return { label, km, time: p?.predictedTimeSeconds ?? fallback };
  });

  const basedOn = prediction?.basedOn ?? (best ? `best effort (${best.distanceKm.toFixed(1)} km)` : "CTL");

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => e.key === "Enter" && setOpen(true)}
        className="glass-card p-5 h-full w-full hover:border-gray-300 transition-colors cursor-pointer dark:hover:border-muted-foreground/30"
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <span className="text-sm">🏁</span>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Race Prediction</p>
            <p className="text-xs text-muted-foreground">{goalLabel}</p>
          </div>
        </div>
        <p className="text-4xl font-bold tabular-nums text-foreground mb-4">{formatRaceTime(predictedSeconds)}</p>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground">Z2</p>
            <p className="text-base font-medium text-foreground">{paces.zone2}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Threshold</p>
            <p className="text-base font-medium text-foreground">{paces.threshold}</p>
          </div>
          <div>
            <p className="text-muted-foreground">VO2max</p>
            <p className="text-base font-medium text-foreground">{paces.vo2max}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          {basedOn}
          {prediction?.metricsBreakdown && (
            <>
              {ctl != null && ` · CTL ${Math.round(ctl)}`}
              {prediction.metricsBreakdown.tsb != null && ` · TSB ${Math.round(prediction.metricsBreakdown.tsb * 10) / 10}`}
              {` · ${Math.round(prediction.metricsBreakdown.vol7dKm)} km/7d · ${Math.round(prediction.metricsBreakdown.vol28dKm)} km/28d`}
            </>
          )}
          {!prediction?.metricsBreakdown && ctl != null && ` · CTL ${Math.round(ctl)}`}
        </p>
        <div className="flex items-center gap-1 mt-2 text-xs text-primary font-medium">
          View all distances <ChevronRight className="w-3.5 h-3.5" />
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Race Predictions</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-4">
            {basedOn}
            {prediction?.metricsBreakdown && (
              <>
                {ctl != null && ` · CTL ${Math.round(ctl)}`}
                {prediction.metricsBreakdown.tsb != null && ` · TSB ${prediction.metricsBreakdown.tsb.toFixed(1)}`}
                {` · ${prediction.metricsBreakdown.vol7dKm.toFixed(0)} km/7d · ${prediction.metricsBreakdown.vol28dKm.toFixed(0)} km/28d`}
              </>
            )}
            {!prediction?.metricsBreakdown && ctl != null && ` · CTL ${Math.round(ctl)}`}
          </p>
          <div className="space-y-3">
            {allPredictions.map(({ label, km, time }) => (
              <div
                key={km}
                className="flex items-center justify-between rounded-lg border px-4 py-3 bg-muted/30"
              >
                <span className="font-medium text-foreground">{label}</span>
                <span className="tabular-nums font-semibold text-foreground">{formatRaceTime(time)}</span>
              </div>
            ))}
          </div>
          {prediction?.metricsBreakdown && (
            <div className="mt-4 border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setShowBreakdown((b) => !b)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
              >
                How we calculated this
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showBreakdown ? "rotate-180" : ""}`} />
              </button>
              {showBreakdown && (
                <div className="px-4 pb-4 pt-0 space-y-2 text-xs text-muted-foreground border-t">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-3">
                    <span>CTL</span>
                    <span>{prediction.metricsBreakdown.ctl != null ? prediction.metricsBreakdown.ctl.toFixed(1) : "—"}</span>
                    <span>TSB</span>
                    <span>{prediction.metricsBreakdown.tsb != null ? prediction.metricsBreakdown.tsb.toFixed(1) : "—"}</span>
                    <span>Vol 7d</span>
                    <span>{prediction.metricsBreakdown.vol7dKm.toFixed(1)} km</span>
                    <span>Vol 28d</span>
                    <span>{prediction.metricsBreakdown.vol28dKm.toFixed(1)} km</span>
                    <span>Injury</span>
                    <span>{prediction.metricsBreakdown.injuryApplied ? "Yes" : "No"}</span>
                    <span>Ramp</span>
                    <span>{prediction.metricsBreakdown.rampRate != null ? prediction.metricsBreakdown.rampRate.toFixed(1) : "—"}</span>
                  </div>
                  <p className="text-[10px] font-medium text-foreground pt-2">Multipliers</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <span>CTL adj</span>
                    <span>{prediction.metricsBreakdown.multipliers.ctl.toFixed(2)}x</span>
                    <span>Volume adj</span>
                    <span>{prediction.metricsBreakdown.multipliers.volume.toFixed(2)}x</span>
                    <span>Injury adj</span>
                    <span>{prediction.metricsBreakdown.multipliers.injury.toFixed(2)}x</span>
                    <span>TSB adj</span>
                    <span>{prediction.metricsBreakdown.multipliers.tsb.toFixed(2)}x</span>
                    <span>Ramp adj</span>
                    <span>{prediction.metricsBreakdown.multipliers.ramp.toFixed(2)}x</span>
                    <span>CTL trend</span>
                    <span>{prediction.metricsBreakdown.multipliers.ctlTrend.toFixed(2)}x</span>
                  </div>
                </div>
              )}
            </div>
          )}
          <Link
            to="/stats"
            className="block mt-4 text-center text-sm text-primary font-medium hover:underline"
            onClick={() => setOpen(false)}
          >
            View stats
          </Link>
        </DialogContent>
      </Dialog>
    </>
  );
}

const DASHBOARD_SNIPPET_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getDashboardSnippetCacheKey(userId: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `dashboard_snippet_${userId}_${today}`;
}

function CoachCadeWidget() {
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef(false);
  const { isConnected } = useIntervalsIntegration();

  useEffect(() => {
    if (fetchedRef.current) {
      setLoading(false);
      return;
    }
    fetchedRef.current = true;
    (async () => {
      try {
        await supabase.auth.refreshSession();
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user?.id;
        if (userId) {
          const cacheKey = getDashboardSnippetCacheKey(userId);
          const cached = sessionStorage.getItem(cacheKey);
          if (cached) {
            try {
              const { message: cachedMsg, ts } = JSON.parse(cached) as { message: string; ts: number };
              if (Date.now() - ts < DASHBOARD_SNIPPET_CACHE_TTL_MS && typeof cachedMsg === "string" && cachedMsg.length > 5) {
                setMessage(cachedMsg);
                setLoading(false);
                return;
              }
            } catch { /* invalid cache */ }
          }
        }
        const { data, error } = await supabase.functions.invoke("coach-opening", {
          body: { short: true },
        });
        if (error) {
          setLoading(false);
          return;
        }
        const msg = data?.message;
        if (typeof msg === "string" && msg.length > 5 && !/invalid jwt|unauthorized|error/i.test(msg)) {
          setMessage(msg);
          if (userId) {
            const cacheKey = getDashboardSnippetCacheKey(userId);
            sessionStorage.setItem(cacheKey, JSON.stringify({ message: msg, ts: Date.now() }));
          }
        }
        if (data?.rateLimitHit) {
          toast.error("AI rate limit reached. Try again later or upgrade your plan.");
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const displayText = message ?? (loading ? "" : null);
  const isFallback = !message && !loading;

  return (
    <Link to="/coach?from=dashboard" className="block h-full">
          <div className="glass-card p-6 h-full hover:opacity-95 transition-opacity cursor-pointer flex flex-col">
        <div className="flex items-center gap-2 mb-3">
          <CadeAvatar size="md" />
          <span className="text-sm font-semibold text-foreground">Coach Cade</span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Reading your data…</span>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <p className="text-sm text-foreground leading-relaxed">
              {displayText ? `"${formatCoachText(displayText)}"` : isFallback ? (isConnected ? "Ask Coach Cade for a quick training check-in." : "Connect intervals.icu in Settings to get personalized coaching.") : "\u2014"}
            </p>
          </div>
        )}
        <div className="flex items-center gap-1 mt-3 text-sm text-[#2563EB] dark:text-primary shrink-0">
          Ask Coach Cade <ChevronRight className="w-3.5 h-3.5" />
        </div>
      </div>
    </Link>
  );
}

function SeasonWidget() {
  const { activeSeason, nextRace, nextARace, nextRaceTaperStart, nextRaceDaysAway, seasonPhase, loading } = useSeason();

  if (loading || !activeSeason) return null;

  const taperDaysAway = nextRaceTaperStart ? daysUntil(nextRaceTaperStart) : null;
  const progressToTaper = nextRaceDaysAway != null && taperDaysAway != null && nextRaceDaysAway > 0
    ? Math.max(0, Math.min(100, ((nextRaceDaysAway - taperDaysAway) / nextRaceDaysAway) * 100))
    : null;

  const secondRace = activeSeason.races
    .filter((r) => r.status === "upcoming" && r.date >= new Date().toISOString().slice(0, 10))
    .sort((a, b) => a.date.localeCompare(b.date))[1] ?? null;

  return (
    <Link to="/season" className="block">
      <div className="glass-card p-5 hover:opacity-95 transition-opacity cursor-pointer">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Trophy className="w-4 h-4 text-primary" />
          </div>
          <span className="text-sm font-semibold text-foreground">{activeSeason.name}</span>
          <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium capitalize">{seasonPhase.replace("_", " ")}</span>
        </div>
        {nextRace ? (
          <div>
            <p className="text-sm text-foreground font-medium">
              Next: {nextRace.name} {nextRace.distance}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(nextRace.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {nextRaceDaysAway} days · {nextRace.priority}-race
            </p>
            {progressToTaper != null && nextRaceTaperStart && (
              <div className="mt-2">
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progressToTaper}%` }} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Taper {new Date(nextRaceTaperStart + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </p>
              </div>
            )}
            {secondRace && (
              <p className="text-xs text-muted-foreground mt-2">
                Then: {secondRace.name} · {secondRace.priority} · {new Date(secondRace.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No upcoming races</p>
        )}
        <div className="flex items-center gap-1 mt-3 text-xs text-primary font-medium">
          View season <ChevronRight className="w-3.5 h-3.5" />
        </div>
      </div>
    </Link>
  );
}

const MEMORY_CHIP_COLORS: Record<string, string> = {
  goal: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  injury: "bg-red-500/15 text-red-700 dark:text-red-400",
  lifestyle: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  race: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  preference: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  personality: "bg-pink-500/15 text-pink-700 dark:text-pink-400",
  other: "bg-gray-500/15 text-gray-600 dark:text-gray-400",
};

function CoachingMemoryWidget() {
  const { user } = useAuth();

  const { data: memories = [], isLoading } = useQuery({
    queryKey: ["coaching_memory_dashboard", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("coaching_memory")
        .select("id, category, content, importance")
        .eq("user_id", user.id)
        .order("importance", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(3);
      if (error) return [];
      return data as { id: string; category: string; content: string; importance: number }[];
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  if (isLoading) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" />
          What Cade knows about you
        </p>
        <Link to="/settings" className="text-xs text-primary hover:underline">
          View all memories →
        </Link>
      </div>
      {memories.length === 0 ? (
        <div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Start sharing with Coach Cade — your goals, injuries, and schedule — and it will remember everything.
          </p>
          <Link to="/coach" className="text-xs font-medium text-primary hover:underline mt-2 inline-block">
            Tell Cade →
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {memories.map((m) => (
            <span
              key={m.id}
              className={`text-xs font-medium px-2.5 py-1 rounded-full ${MEMORY_CHIP_COLORS[m.category] ?? MEMORY_CHIP_COLORS.other}`}
            >
              <span className="capitalize">{m.category}</span>:{" "}
              {m.content.length > 32 ? m.content.slice(0, 32) + "…" : m.content}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const greeting = useGreeting();
  const navigate = useNavigate();
  const zoneSource = useZoneSource();
  const { weekStats, lastActivity, recoveryMetrics, readiness, readinessRows, weekPlan, next7DaysHasPlannedSessions, todaysWorkout, athlete, athleteProfile, planProgress, isSampleData, activities } = useDashboardData();
  const { isConnected: intervalsConnected } = useIntervalsIntegration();
  const { syncing, progress: syncProgress, runQuickSync } = useIntervalsSync();
  const { todayLoad } = useDailyLoad();
  const { openCheckIn, currentStreak, longestStreak, hasCheckedInToday } = useDailyCheckIn();
  const isCurrentWeekInPlan = weekStats.isCurrentWeekInPlan && weekStats.plannedKm != null && weekStats.plannedKm > 0;
  const progressPct = isCurrentWeekInPlan ? Math.round((weekStats.actualKm / weekStats.plannedKm!) * 100) : 0;

  const syncDone = !syncing && syncProgress?.done && syncProgress.stage === "done";
  const syncError = !syncing && syncProgress?.stage === "error";

  async function handleQuickSync() {
    await runQuickSync();
    if (syncProgress?.stage === "error") {
      toast.error(syncProgress.detail ?? "Sync failed");
    }
  }

  return (
    <AppLayout>
      <motion.div {...fadeIn} className="flex flex-col gap-6">
        {!intervalsConnected && !isSampleData && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground flex items-center justify-between gap-3">
            <span>Connect intervals.icu to sync your activities and wellness data</span>
            <Link
              to="/settings"
              className="shrink-0 text-sm font-medium text-primary hover:underline"
            >
              Settings
            </Link>
          </div>
        )}
        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="page-title text-foreground">{greeting}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {planProgress
                ? planProgress.planNotStarted
                  ? `Your plan starts ${format(parseISO(planProgress.planStartDate), "MMM d")} — ${planProgress.daysUntilStart} day${planProgress.daysUntilStart === 1 ? "" : "s"} to go`
                  : `Week ${planProgress.currentWeek} of ${planProgress.totalWeeks} · ${planProgress.phase.charAt(0).toUpperCase() + planProgress.phase.slice(1)} Phase · ${planProgress.raceType ?? athlete.goalRace.type} in ${planProgress.totalWeeks - planProgress.currentWeek + 1} weeks`
                : athlete.goalRace.weeksRemaining != null
                  ? `${athlete.goalRace.type} in ${athlete.goalRace.weeksRemaining} weeks`
                  : athlete.goalRace.type}
            </p>
          </div>
          {intervalsConnected && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleQuickSync}
                  disabled={syncing}
                  className={`shrink-0 mt-1 w-8 h-8 rounded-lg flex items-center justify-center transition-colors border ${
                    syncDone
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                      : syncError
                      ? "border-destructive/30 bg-destructive/10 text-destructive"
                      : "border-border bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted/80"
                  }`}
                  aria-label="Sync intervals.icu"
                >
                  {syncDone ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {syncing ? "Syncing…" : syncDone ? `Done — ${syncProgress?.runsCount ?? 0} activities` : syncError ? syncProgress?.detail : "Sync intervals.icu (last 30 days)"}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Build-your-plan CTA — shown when user has data but no training plan yet */}
        {!planProgress && !isSampleData && (
          <div
            className="rounded-xl border border-primary/30 bg-primary/5 px-5 py-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-primary/[0.08] transition-colors"
            onClick={() => navigate("/coach")}
            role="button"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">You don't have a training plan yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">Coach Cade will build one around your goal, schedule and fitness data.</p>
            </div>
            <Button size="sm" className="shrink-0" onClick={(e) => { e.stopPropagation(); navigate("/coach"); }}>
              Build plan <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
            </Button>
          </div>
        )}

        {/* Readiness Card — clickable to Stats; check-in row when needed */}
        <Link to="/stats" className="block">
          <div className="glass-card p-6 relative hover:border-gray-300 transition-colors cursor-pointer min-h-0 dark:hover:border-muted-foreground/30">
            {isSampleData && (
              <span className="absolute top-3 right-3 text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">Sample</span>
            )}
            {!isSampleData && intervalsConnected && (
              <span className="absolute top-3 right-3 text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                Synced from intervals.icu
              </span>
            )}
            <div className="flex items-center gap-6">
              <ReadinessRing score={readiness.score} size={96} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-base font-semibold text-foreground">Today's Readiness</h2>
                  <WorkoutBadge type={todaysWorkout.type} />
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {readiness.aiSummary}
                </p>
                {todaysWorkout.type === "rest" &&
                  readiness.score != null &&
                  readiness.score > 75 &&
                  isCurrentWeekInPlan &&
                  progressPct > 100 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                      Rest recommended — weekly load is {progressPct}% of target
                    </p>
                  )}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Heart className="w-3.5 h-3.5 shrink-0" />
                    <span>HRV</span>
                    <span className="font-medium text-foreground">{readiness.hrv}ms</span>
                    <TrendingDown className="w-3 h-3 text-warning" />
                  </span>
                  <span className="flex items-center gap-1">
                    <Moon className="w-3.5 h-3.5 shrink-0" />
                    <span>Sleep</span>
                    <span className="font-medium text-foreground">{formatSleepHours(readiness.sleepHours)}</span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">TSB </span>
                    <span className="font-medium text-foreground mono-text tabular-nums">{readiness.tsb != null ? Math.round(readiness.tsb * 10) / 10 : "—"}</span>
                  </span>
                  {hasCheckedInToday && currentStreak > 0 && (
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                      <Flame className="w-3 h-3" /> {currentStreak}-day streak{longestStreak > currentStreak ? ` · Best: ${longestStreak}` : ""}
                    </span>
                  )}
                  {todayLoad?.total_load_score != null && (
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); openCheckIn(); }}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-medium ${
                        (todayLoad.total_load_score ?? 0) < 50 ? "text-green-600 dark:text-green-400"
                        : (todayLoad.total_load_score ?? 0) < 65 ? "text-yellow-600 dark:text-yellow-400"
                        : (todayLoad.total_load_score ?? 0) < 80 ? "text-orange-600 dark:text-orange-400"
                        : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      TLS {Math.round(todayLoad.total_load_score!)}
                      {(todayLoad.total_load_score ?? 0) > 65 && <AlertTriangle className="w-3 h-3" />}
                    </button>
                  )}
                </div>
                {!hasCheckedInToday && !isSampleData && (
                  <div className="mt-4 pt-4 border-t border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">30-second check-in</p>
                      <p className="text-xs text-muted-foreground">
                        {currentStreak > 0
                          ? `You're on a ${currentStreak}-day streak — check in today to keep it going.`
                          : "Help Coach Cade understand your full load today"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 text-[#2563EB] border-[#2563EB]/30 hover:bg-blue-50 dark:text-primary dark:border-primary/30"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); openCheckIn(); }}
                    >
                      Start <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                    </Button>
                  </div>
                )}
                <div className="flex items-center gap-1 mt-3 text-sm text-[#2563EB] dark:text-primary">
                  View details <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </div>
          </div>
        </Link>

        {/* Coaching Memory widget */}
        <CoachingMemoryWidget />

        {/* Your Week — proposal or current week */}
        <WeekProposal />

        {/* Race prediction — full width under week calendar */}
        <RacePredictionCard
          activities={activities}
          ctl={readiness.ctl}
          atl={readiness.atl}
          tsb={readiness.tsb}
          rampRate={readiness.rampRate ?? null}
          goalRaceType={athlete.goalRace.type}
          athleteProfile={athleteProfile ?? { vdot: null, vo2max: null, lactateThresholdPace: null, injuryHistoryText: null }}
          readinessRows={readinessRows ?? []}
        />

        {/* Season widget */}
        <SeasonWidget />

        {/* 3-column grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1 — This Week — clickable to Activities */}
          <Link to="/activities" className="block">
            <div className="glass-card p-6 space-y-4 hover:opacity-95 transition-opacity cursor-pointer h-full">
              <p className="section-header">This Week</p>
            <div>
              {planProgress?.planNotStarted ? (
                <p className="text-sm text-muted-foreground">
                  First session in {planProgress.daysUntilStart} day{planProgress.daysUntilStart === 1 ? "" : "s"} — enjoy the rest!
                </p>
              ) : (
                <>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-foreground font-medium">
                      {isCurrentWeekInPlan
                        ? `${weekStats.actualKm} / ${weekStats.plannedKm} km`
                        : `${weekStats.actualKm} km`}
                    </span>
                    {isCurrentWeekInPlan && (
                      <span className="mono-text text-muted-foreground">{progressPct}%</span>
                    )}
                  </div>
                  {isCurrentWeekInPlan && (
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(progressPct, 100)}%` }}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
            {isCurrentWeekInPlan && (
            <div className="flex items-center justify-between text-sm gap-2">
              <span className="text-muted-foreground">Quality sessions</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 cursor-help">
                    <span className="text-xs text-muted-foreground">
                      {weekStats.qualityDone} of {weekStats.qualityPlanned} done
                    </span>
                    <span className="flex gap-0.5">
                      {Array.from({ length: weekStats.qualityPlanned }).map((_, i) => (
                        <span
                          key={i}
                          className={`inline-block w-2 h-2 rounded-full ${
                            i < weekStats.qualityDone ? "bg-primary" : "bg-muted"
                          }`}
                          aria-hidden
                        />
                      ))}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px]">
                  <p className="text-xs">Tempo, interval, or long run sessions this week</p>
                </TooltipContent>
              </Tooltip>
            </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground mb-1">Load trend</p>
              <Sparkline data={weekStats.tssData} />
            </div>
            <div className="flex items-center gap-1 mt-2 text-xs text-primary font-medium">
              View activities <ChevronRight className="w-3.5 h-3.5" />
            </div>
            </div>
          </Link>

          {/* Card 2 — Last Activity — clickable to Activity Detail */}
          {lastActivity.detailId ? (
            <Link to={`/activities/${lastActivity.detailId}`} className="block">
              <div className="glass-card p-6 space-y-3 hover:opacity-95 transition-opacity cursor-pointer h-full">
                <p className="section-header">Last Activity</p>
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-medium text-foreground">{lastActivity.type}</h3>
                  <span className="text-xs text-muted-foreground">{lastActivity.date}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Distance</p>
                    <p className="mono-text font-medium text-foreground">{lastActivity.distance} km</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Avg Pace</p>
                    <p className="mono-text font-medium text-foreground">{lastActivity.avgPace}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Avg HR</p>
                    <p className="mono-text font-medium text-foreground">{lastActivity.avgHr != null ? `${lastActivity.avgHr} bpm` : "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Duration</p>
                    <p className="mono-text font-medium text-foreground">{lastActivity.duration}</p>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-xs text-muted-foreground">HR Zones</p>
                    {!lastActivity.needsMaxHrForZones && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                        {lastActivity.hrZonesEstimated ? "Estimated from avg HR" : zoneSource}
                      </span>
                    )}
                  </div>
                  {lastActivity.needsMaxHrForZones ? (
                    <div onClick={(e) => e.stopPropagation()} className="space-y-1">
                      <p className="text-xs text-muted-foreground">Zones unavailable — set max HR for accurate zones</p>
                      <button
                        type="button"
                        onClick={() => navigate("/settings")}
                        className="text-xs text-primary font-medium hover:underline"
                      >
                        Set max HR in Settings
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex h-3 rounded-full overflow-hidden">
                        <div className={`${HR_ZONE_LIGHT[0]} dark:bg-[#94a3b8]`} style={{ width: `${lastActivity.hrZones.z1}%` }} />
                        <div className={`${HR_ZONE_LIGHT[1]} dark:bg-[#3b82f6]`} style={{ width: `${lastActivity.hrZones.z2}%` }} />
                        <div className={`${HR_ZONE_LIGHT[2]} dark:bg-[#22c55e]`} style={{ width: `${lastActivity.hrZones.z3}%` }} />
                        <div className={`${HR_ZONE_LIGHT[3]} dark:bg-[#f97316]`} style={{ width: `${lastActivity.hrZones.z4}%` }} />
                        <div className={`${HR_ZONE_LIGHT[4]} dark:bg-[#ef4444]`} style={{ width: `${lastActivity.hrZones.z5}%` }} />
                      </div>
                      <div className="flex mt-1 text-[10px] text-muted-foreground">
                        {([1, 2, 3, 4, 5] as const).map((i) => {
                          const pct = lastActivity.hrZones[`z${i}` as keyof typeof lastActivity.hrZones] ?? 0;
                          return (
                            <span key={i} className="text-center shrink-0" style={{ width: `${pct}%`, minWidth: pct > 0 ? "1ch" : 0 }}>
                              {pct >= 5 ? `Z${i}` : pct > 0 ? "+" : ""}
                            </span>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-2 text-xs text-primary font-medium">
                  View activity <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </Link>
          ) : (
            <div className="glass-card p-5 space-y-3 h-full">
              <p className="section-header">Last Activity</p>
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-medium text-foreground">{lastActivity.type}</h3>
                <span className="text-xs text-muted-foreground">{lastActivity.date}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Distance</p>
                  <p className="mono-text font-medium text-foreground">{lastActivity.distance} km</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Avg Pace</p>
                  <p className="mono-text font-medium text-foreground">{lastActivity.avgPace}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Avg HR</p>
                  <p className="mono-text font-medium text-foreground">{lastActivity.avgHr != null ? `${lastActivity.avgHr} bpm` : "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Duration</p>
                  <p className="mono-text font-medium text-foreground">{lastActivity.duration}</p>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <p className="text-xs text-muted-foreground">HR Zones</p>
                  {!lastActivity.needsMaxHrForZones && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                      {lastActivity.hrZonesEstimated ? "Estimated from avg HR" : zoneSource}
                    </span>
                  )}
                </div>
                {lastActivity.needsMaxHrForZones ? (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Zones unavailable — set max HR for accurate zones</p>
                    <Link to="/settings" className="text-xs text-primary font-medium hover:underline">
                      Set max HR in Settings
                    </Link>
                  </div>
                ) : (
                  <>
                    <div className="flex h-3 rounded-full overflow-hidden">
                      <div className={`${HR_ZONE_LIGHT[0]} dark:bg-[#94a3b8]`} style={{ width: `${lastActivity.hrZones.z1}%` }} />
                      <div className={`${HR_ZONE_LIGHT[1]} dark:bg-[#3b82f6]`} style={{ width: `${lastActivity.hrZones.z2}%` }} />
                      <div className={`${HR_ZONE_LIGHT[2]} dark:bg-[#22c55e]`} style={{ width: `${lastActivity.hrZones.z3}%` }} />
                      <div className={`${HR_ZONE_LIGHT[3]} dark:bg-[#f97316]`} style={{ width: `${lastActivity.hrZones.z4}%` }} />
                      <div className={`${HR_ZONE_LIGHT[4]} dark:bg-[#ef4444]`} style={{ width: `${lastActivity.hrZones.z5}%` }} />
                    </div>
                    <div className="flex mt-1 text-[10px] text-muted-foreground">
                      {([1, 2, 3, 4, 5] as const).map((i) => {
                        const pct = lastActivity.hrZones[`z${i}` as keyof typeof lastActivity.hrZones] ?? 0;
                        return (
                          <span key={i} className="text-center shrink-0" style={{ width: `${pct}%`, minWidth: pct > 0 ? "1ch" : 0 }}>
                            {pct >= 5 ? `Z${i}` : pct > 0 ? "+" : ""}
                          </span>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Card 3 — Recovery Metrics — clickable to Stats */}
          <Link to="/stats" className="block">
            <div className="glass-card p-6 space-y-3 hover:opacity-95 transition-opacity cursor-pointer h-full">
            <p className="section-header">Recovery</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">HRV</p>
                <div className="flex items-center gap-1.5">
                  <span className="mono-text text-lg font-semibold text-foreground">
                    {recoveryMetrics.hrv}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    / {recoveryMetrics.hrv7dayAvg} avg
                  </span>
                  <TrendingDown className="w-3.5 h-3.5 text-warning" />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Sleep</p>
                <div className="flex items-center gap-1.5">
                  <span className="mono-text text-lg font-semibold text-foreground">
                    {formatSleepHours(recoveryMetrics.sleepHours)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {recoveryMetrics.sleepScore != null
                      ? `Score ${recoveryMetrics.sleepScore}`
                      : recoveryMetrics.sleepQuality != null
                        ? `${recoveryMetrics.sleepQuality}/10`
                        : ""}
                  </span>
                </div>
              </div>
            </div>
                <div>
              <p className="text-xs text-muted-foreground mb-1">HRV (7 days)</p>
              <Sparkline data={recoveryMetrics.hrvTrend} color="hsl(141, 72%, 50%)" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Resting HR (7 days)</p>
              <Sparkline data={recoveryMetrics.restingHrTrend} color="hsl(0, 84%, 60%)" />
            </div>
            <div className="flex items-center gap-1 mt-2 text-xs text-primary font-medium">
              View stats <ChevronRight className="w-3.5 h-3.5" />
            </div>
            </div>
          </Link>
        </div>

        {/* Next 7 days — only when plan has sessions this week */}
        {next7DaysHasPlannedSessions ? (
          <div>
            <p className="section-header">Next 7 Days</p>
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
              {weekPlan.map((day) => {
                const content = (
                  <div
                    className={`glass-card glass-card-hover p-4 cursor-pointer w-[120px] min-h-[100px] flex-shrink-0 ${
                      day.isToday ? "ring-2 ring-[#2563EB] dark:ring-primary" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs font-medium ${day.isToday ? "text-[#2563EB] dark:text-primary" : "text-muted-foreground"}`}>
                        {day.isToday ? "Today" : day.day}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{day.date}</span>
                    </div>
                    <WorkoutBadge type={day.type} />
                    <p className="text-sm font-medium text-foreground mt-2 leading-tight">{day.title}</p>
                    {day.distance > 0 && (
                      <p className="mono-text text-xs text-muted-foreground mt-1">
                        {Math.round(day.distance * 10) / 10} km
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-1">{day.detail}</p>
                  </div>
                );
                return day.detailId ? (
                  <Link key={day.day} to={`/activities/${day.detailId}`} className="block">
                    {content}
                  </Link>
                ) : (
                  <Link key={day.day} to="/plan" className="block">
                    {content}
                  </Link>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-200 dark:border-border bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground">
            {planProgress?.planStartDate && planProgress.planStartDate > new Date().toISOString().slice(0, 10) ? (
              <>
                Plan starts{" "}
                {new Date(planProgress.planStartDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                <Link to="/plan" className="text-[#2563EB] dark:text-primary font-medium hover:underline">
                  View plan →
                </Link>
              </>
            ) : (
              <>
                No sessions planned yet.{" "}
                <Link to="/plan" className="text-[#2563EB] dark:text-primary font-medium hover:underline">
                  Generate your week
                </Link>
                {" →"}
              </>
            )}
          </div>
        )}

        <CoachCadeWidget />
      </motion.div>
    </AppLayout>
  );
}
