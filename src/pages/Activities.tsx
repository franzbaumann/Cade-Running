import { useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useIntervalsIntegration } from "@/hooks/useIntervalsIntegration";
import { useMergedActivities } from "@/hooks/useMergedIntervalsData";
import { Activity, ArrowRight, ChevronRight, Heart, Timer, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { formatDistance } from "@/lib/format";
import { isNonDistanceActivity } from "@/lib/analytics";
import { UnifiedCalendar } from "@/components/UnifiedCalendar";
import { Marquee } from "@/components/ui/marquee";
import { format, parseISO } from "date-fns";

function formatDuration(sec: number | null): string {
  if (sec == null) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function Activities() {
  const navigate = useNavigate();
  const { isConnected } = useIntervalsIntegration();
  const { data: activities = [], isLoading } = useMergedActivities(730);

  const runs = useMemo(
    () =>
      activities
        .map((a) => {
          const km = a.distance_km ?? 0;
          const nonDist = isNonDistanceActivity(a.type);
          const useKm = !nonDist && km >= 0.01;
          const hasDur = a.duration_seconds != null && a.duration_seconds > 0;
          const dur = formatDuration(a.duration_seconds);
          const detailId =
            a.external_id && a.source === "intervals_icu" ? `icu_${a.external_id}` : a.id;
          const displayName = a.name
            ? a.name
            : useKm
              ? `${a.type ?? "Run"} — ${formatDistance(km)}`
              : `${a.type ?? "Activity"}${hasDur ? ` (${dur})` : ""}`;
          return {
            id: detailId,
            date: a.date,
            dateObj: new Date(a.date),
            name: displayName,
            type: a.type ?? "Run",
            km,
            nonDist,
            pace: nonDist ? null : a.avg_pace ?? null,
            duration: dur,
            hr: a.avg_hr ?? null,
            source: a.source ?? "garmin",
          };
        })
        .filter((r) =>
          r.nonDist ? r.duration && r.duration !== "" : r.km >= 0.01 || (r.duration && r.duration !== "")
        )
        .sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime()),
    [activities]
  );

  const hasAnyData = runs.length > 0;
  const isLoadingAny = isLoading;

  if (!isConnected && !hasAnyData && !isLoading) {
    return (
      <AppLayout>
        <div className="animate-fade-in space-y-6">
          <h1 className="text-2xl font-semibold text-foreground">Activities</h1>
          <div className="glass-card p-12 text-center">
            <Activity className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-medium text-foreground mb-2">Add your activities</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
              Connect intervals.icu in Settings to sync your activities.
            </p>
            <button
              onClick={() => navigate("/settings")}
              className="pill-button bg-primary text-primary-foreground mt-6 gap-2"
            >
              Go to Settings
              <ArrowRight className="w-4 h-4" />
            </button>
            <div className="mt-8 pt-6 border-t border-border overflow-hidden">
              <Marquee pauseOnHover direction="left" duration={40} className="py-1" fadeAmount={12}>
                <span className="mx-6 text-sm text-muted-foreground">Garmin</span>
                <span className="mx-6 text-muted-foreground/50">·</span>
                <span className="mx-6 text-sm text-muted-foreground">Coros</span>
                <span className="mx-6 text-muted-foreground/50">·</span>
                <span className="mx-6 text-sm text-muted-foreground">Apple Watch</span>
                <span className="mx-6 text-muted-foreground/50">·</span>
                <span className="mx-6 text-sm text-muted-foreground">Polar</span>
                <span className="mx-6 text-muted-foreground/50">·</span>
                <span className="mx-6 text-sm text-muted-foreground">Suunto</span>
                <span className="mx-6 text-muted-foreground/50">·</span>
                <span className="mx-6 text-sm text-muted-foreground">intervals.icu</span>
              </Marquee>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (isLoadingAny) {
    return (
      <AppLayout>
        <div className="animate-fade-in space-y-6">
          <h1 className="text-2xl font-semibold text-foreground">Activities</h1>
          <div className="glass-card p-12 text-center text-muted-foreground">Loading activities…</div>
        </div>
      </AppLayout>
    );
  }

  if (runs.length === 0) {
    return (
      <AppLayout>
        <div className="animate-fade-in space-y-6">
          <h1 className="text-2xl font-semibold text-foreground">Activities</h1>
          <div className="glass-card p-12 text-center">
            <Activity className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-medium text-foreground mb-2">No activities yet</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
              {isConnected
                ? "Connected to intervals.icu — if you have activities there, they should sync. Try refreshing the page or check Settings."
                : "Connect intervals.icu in Settings to sync your activities."}
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-6">
              <button
                onClick={() => window.location.reload()}
                className="pill-button bg-primary text-primary-foreground gap-2"
              >
                Refresh page
              </button>
              <Button onClick={() => navigate("/settings")} variant="outline" className="gap-2">
                Go to Settings
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
            <div className="mt-8 pt-6 border-t border-border overflow-hidden">
              <Marquee pauseOnHover direction="left" duration={40} className="py-1" fadeAmount={12}>
                <span className="mx-6 text-sm text-muted-foreground">Garmin</span>
                <span className="mx-6 text-muted-foreground/50">·</span>
                <span className="mx-6 text-sm text-muted-foreground">Coros</span>
                <span className="mx-6 text-muted-foreground/50">·</span>
                <span className="mx-6 text-sm text-muted-foreground">Apple Watch</span>
                <span className="mx-6 text-muted-foreground/50">·</span>
                <span className="mx-6 text-sm text-muted-foreground">Polar</span>
                <span className="mx-6 text-muted-foreground/50">·</span>
                <span className="mx-6 text-sm text-muted-foreground">Suunto</span>
                <span className="mx-6 text-muted-foreground/50">·</span>
                <span className="mx-6 text-sm text-muted-foreground">intervals.icu</span>
              </Marquee>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  const recent = useMemo(() => runs.slice(0, 30), [runs]);

  return (
    <AppLayout>
      <div className="animate-fade-in space-y-6">
        <h1 className="text-2xl font-semibold text-foreground">Activities</h1>

        <div className="glass-card overflow-hidden w-full">
          <UnifiedCalendar defaultView="activities" />
        </div>

        {/* Recent activities list */}
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-2">
            Recent activities
          </h2>
          <div className="glass-card divide-y divide-border overflow-hidden">
            {recent.map((r) => (
              <button
                key={r.id}
                onClick={() => navigate(`/activities/${r.id}`)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{r.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {format(parseISO(r.date), "MMM d")}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    <span className="shrink-0">{r.type}</span>
                    {!r.nonDist && r.km >= 0.01 && (
                      <span className="flex items-center gap-0.5">
                        <Ruler className="w-3 h-3" />
                        {formatDistance(r.km)}
                      </span>
                    )}
                    {r.duration && (
                      <span className="flex items-center gap-0.5">
                        <Timer className="w-3 h-3" />
                        {r.duration}
                      </span>
                    )}
                    {r.pace && (
                      <span>{r.pace}</span>
                    )}
                    {r.hr != null && (
                      <span className="flex items-center gap-0.5">
                        <Heart className="w-3 h-3" />
                        {r.hr}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
