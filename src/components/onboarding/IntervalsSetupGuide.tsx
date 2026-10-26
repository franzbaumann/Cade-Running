import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronRight, ExternalLink, ArrowLeft, Loader2 } from "lucide-react";
import { Marquee } from "@/components/ui/marquee";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getSafeAccessToken } from "@/lib/supabase-auth-safe";
import { useIntervalsIntegration } from "@/hooks/useIntervalsIntegration";
import { useVitalIntegration } from "@/hooks/useVitalIntegration";
import { useIntervalsSync, SyncProgress } from "@/hooks/useIntervalsSync";
import { useOnboardingProgress } from "@/hooks/useOnboardingProgress";
import { CadeLogo } from "@/components/CadeLogo";

// ─── Types ────────────────────────────────────────────────────────────────────

type VerifyStatus = "idle" | "loading" | "ok" | "error";

interface StepMeta {
  number: number;
  title: string;
}

const STEPS: StepMeta[] = [
  { number: 1, title: "Create your account" },
  { number: 2, title: "Connect your watch" },
  { number: 3, title: "Import training history" },
  { number: 4, title: "Connect to Coach Cade" },
  { number: 5, title: "Sync your data" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepIndicator({
  step,
  current,
  completed,
}: {
  step: StepMeta;
  current: number;
  completed: boolean;
}) {
  const isActive = step.number === current;
  const isDone = completed;

  return (
    <div className={`flex items-center gap-3 py-2.5 px-3 rounded-lg transition-colors ${isActive ? "bg-primary/10" : ""}`}>
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold transition-colors ${
          isDone
            ? "bg-green-600 text-white"
            : isActive
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {isDone ? <Check className="w-3.5 h-3.5" /> : step.number}
      </div>
      <span
        className={`text-sm font-medium transition-colors ${
          isActive ? "text-foreground" : isDone ? "text-muted-foreground" : "text-muted-foreground"
        }`}
      >
        {step.title}
      </span>
    </div>
  );
}

function ExternalLinkButton({
  href,
  children,
  variant = "outline",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "outline" | "default";
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      <Button variant={variant} className="gap-2">
        {children}
        <ExternalLink className="w-3.5 h-3.5" />
      </Button>
    </a>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 p-4 rounded-lg bg-muted/40 border border-border text-sm text-muted-foreground leading-relaxed">
      {children}
    </div>
  );
}

function WhyItMatters({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6 border-t border-border pt-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
        Why this matters
      </button>
      {open && (
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{children}</p>
      )}
    </div>
  );
}

// ─── Step 1 ───────────────────────────────────────────────────────────────────

function Step1({
  onNext,
  onMarkDone,
  onGoToSettings,
}: {
  onNext: () => void;
  onMarkDone: () => void;
  onGoToSettings: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Create your intervals.icu account</h2>
        <p className="text-muted-foreground leading-relaxed">
          intervals.icu is the free platform that connects your watch to Coach Cade. It reads your
          training data, HRV, sleep and fitness — and sends it to your coach.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <ExternalLinkButton href="https://intervals.icu" variant="default">
          Open intervals.icu
        </ExternalLinkButton>
        <button
          onClick={() => { onMarkDone(); onNext(); }}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors text-left"
        >
          Already have an account? <span className="underline underline-offset-2">Skip to next step →</span>
        </button>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Using Strava instead?</span> Connect it in{" "}
        <button onClick={onGoToSettings} className="underline underline-offset-2 hover:text-foreground transition-colors">
          Settings
        </button>{" "}
        — then come back to build your plan.
      </div>

      <WhyItMatters>
        Coach Cade doesn't connect directly to Garmin or Apple Watch. intervals.icu acts as the
        bridge — it reads all your device data and makes it available to your coach.
      </WhyItMatters>

      <div className="mt-2">
        <Button onClick={() => { onMarkDone(); onNext(); }} className="gap-2">
          I've created my account <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 2 ───────────────────────────────────────────────────────────────────

const DEVICES = [
  { name: "Garmin", url: "https://intervals.icu/settings#garmin" },
  { name: "Coros", url: "https://intervals.icu/settings#coros" },
  { name: "Polar", url: "https://intervals.icu/settings#polar" },
];

function Step2({
  onNext,
  onMarkDone,
}: {
  onNext: () => void;
  onMarkDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Connect your watch</h2>
        <p className="text-muted-foreground leading-relaxed">
          Link your Garmin, Coros or Polar to intervals.icu so your activities sync automatically.
        </p>
      </div>

      <div className="overflow-hidden -mx-2 py-2 border border-border rounded-xl bg-muted/20">
        <Marquee pauseOnHover direction="left" duration={30} className="py-1" fadeAmount={12}>
          <span className="mx-5 text-sm text-muted-foreground">Garmin</span>
          <span className="mx-5 text-muted-foreground/50">·</span>
          <span className="mx-5 text-sm text-muted-foreground">Coros</span>
          <span className="mx-5 text-muted-foreground/50">·</span>
          <span className="mx-5 text-sm text-muted-foreground">Polar</span>
          <span className="mx-5 text-muted-foreground/50">·</span>
          <span className="mx-5 text-sm text-muted-foreground">Suunto</span>
          <span className="mx-5 text-muted-foreground/50">·</span>
          <span className="mx-5 text-sm text-muted-foreground">Apple Watch</span>
          <span className="mx-5 text-muted-foreground/50">·</span>
          <span className="mx-5 text-sm text-muted-foreground">intervals.icu</span>
        </Marquee>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {DEVICES.map(({ name, url }) => (
          <a
            key={name}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 p-4 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 hover:border-primary/40 transition-colors text-sm font-medium text-foreground"
          >
            {name}
            <ExternalLink className="w-3 h-3 text-muted-foreground" />
          </a>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">
        Using a different device?{" "}
        <a
          href="https://intervals.icu/faq"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground transition-colors"
        >
          Any watch that syncs to intervals.icu works with Coach Cade.
        </a>
      </p>

      <WhyItMatters>
        This is how your runs, HRV and sleep reach Coach Cade. Once connected, everything syncs
        automatically — you never need to do this again.
      </WhyItMatters>

      <Button onClick={() => { onMarkDone(); onNext(); }} className="gap-2 w-fit">
        <Check className="w-4 h-4" /> I've connected my watch
      </Button>
    </div>
  );
}

// ─── Step 3 ───────────────────────────────────────────────────────────────────

function Step3({
  onNext,
  onMarkDone,
}: {
  onNext: () => void;
  onMarkDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Import your training history</h2>
        <p className="text-muted-foreground leading-relaxed">
          This is the most important step. By default, intervals.icu only shows activities from when
          you created your account. To give Coach Cade your full training history — years of runs,
          fitness trends and PRs — you need to request your data from Garmin directly.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex gap-4">
          <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0 text-xs font-semibold text-primary mt-0.5">
            1
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-foreground">Go to Garmin Data Management</p>
            <ExternalLinkButton href="https://www.garmin.com/en-US/account/datamanagement/">
              Open Garmin Data Management
            </ExternalLinkButton>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0 text-xs font-semibold text-primary mt-0.5">
            2
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-1">Click "Export Your Data"</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Request a full export of your Garmin Connect data. Garmin will email you a{" "}
              <strong className="text-foreground">download code</strong> — usually within 24 hours.
            </p>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0 text-xs font-semibold text-primary mt-0.5">
            3
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-foreground">When you receive the code from Garmin</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Go to intervals.icu → Settings → Garmin → "Import historical activities". Enter the
              download code Garmin sent you.
            </p>
            <ExternalLinkButton href="https://intervals.icu/settings#garmin">
              Open intervals.icu Garmin settings
            </ExternalLinkButton>
          </div>
        </div>
      </div>

      <InfoBox>
        <span className="font-medium text-foreground">Using Coros or Polar?</span> Both have
        similar export options in their respective apps.
      </InfoBox>

      <WhyItMatters>
        Coach Cade needs your training history to understand your fitness baseline, detect patterns
        and build a plan that fits where you actually are — not where you started last week.
      </WhyItMatters>

      <div className="flex flex-col gap-3">
        <Button onClick={() => { onMarkDone(); onNext(); }} className="gap-2 w-fit">
          <Check className="w-4 h-4" /> I've requested my historical data
        </Button>
        <p className="text-xs text-muted-foreground max-w-sm">
          No rush — Coach Cade will automatically process your history once Garmin delivers it.
          Continue setup while you wait.
        </p>
      </div>
    </div>
  );
}

// ─── Step 4 ───────────────────────────────────────────────────────────────────

function Step4({
  onNext,
  onMarkDone,
  initialAthleteId,
  initialApiKey,
}: {
  onNext: () => void;
  onMarkDone: () => void;
  initialAthleteId: string;
  initialApiKey: string;
}) {
  const { save, isSaving } = useIntervalsIntegration();
  const [athleteId, setAthleteId] = useState(initialAthleteId);
  const [apiKey, setApiKey] = useState(initialApiKey);
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");
  const [verifyError, setVerifyError] = useState("");

  async function handleVerify() {
    if (!athleteId.trim() || !apiKey.trim()) return;
    setVerifyStatus("loading");
    setVerifyError("");

    // Save credentials first
    save({ athleteId: athleteId.trim(), apiKey: apiKey.trim() });

    // Test connection
    try {
      const token = await getSafeAccessToken();
      const { data, error } = await supabase.functions.invoke("intervals-proxy", {
        headers: { Authorization: `Bearer ${token}` },
        body: { action: "test_connection", athleteId: athleteId.trim(), apiKey: apiKey.trim() },
      });
      if (error) {
        setVerifyStatus("error");
        setVerifyError("Connection failed. Check your credentials and try again.");
        return;
      }
      const result = data as { ok: boolean; error?: string };
      if (result.ok) {
        setVerifyStatus("ok");
        onMarkDone();
      } else {
        setVerifyStatus("error");
        setVerifyError(result.error ?? "That didn't work — double-check your Athlete ID and API key.");
      }
    } catch {
      setVerifyStatus("error");
      setVerifyError("Connection failed. Check your credentials and try again.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Connect intervals.icu to Coach Cade</h2>
        <p className="text-muted-foreground leading-relaxed">
          Almost there. Give Coach Cade read access to your intervals.icu data with an API key.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex gap-4">
          <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0 text-xs font-semibold text-primary mt-0.5">
            1
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-foreground">Open intervals.icu Settings</p>
            <ExternalLinkButton href="https://intervals.icu/settings#api">
              Open intervals.icu Settings
            </ExternalLinkButton>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0 text-xs font-semibold text-primary mt-0.5">
            2
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-1">Find "API Key" under Developer Settings</p>
            <p className="text-sm text-muted-foreground">
              Copy the key — it looks something like:{" "}
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">a1b2c3d4e5f6g7h8</code>
            </p>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0 text-xs font-semibold text-primary mt-0.5">
            3
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-1">Find your Athlete ID</p>
            <p className="text-sm text-muted-foreground">
              Your Athlete ID is in the URL when you're logged in:{" "}
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">intervals.icu/athlete/[YOUR-ID]/...</code>
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 max-w-sm">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Athlete ID</label>
          <input
            type="text"
            value={athleteId}
            onChange={(e) => { setAthleteId(e.target.value); setVerifyStatus("idle"); }}
            placeholder="e.g. 12345"
            className="w-full h-10 px-3 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setVerifyStatus("idle"); }}
            placeholder="e.g. a1b2c3d4e5f6..."
            className="w-full h-10 px-3 rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {verifyStatus === "ok" && (
          <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
            <Check className="w-4 h-4" /> Connected
          </div>
        )}
        {verifyStatus === "error" && (
          <p className="text-sm text-destructive">{verifyError}</p>
        )}

        <Button
          onClick={handleVerify}
          disabled={!athleteId.trim() || !apiKey.trim() || verifyStatus === "loading" || isSaving}
          className="gap-2 w-fit"
        >
          {verifyStatus === "loading" || isSaving ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</>
          ) : (
            <>Save and verify <ChevronRight className="w-4 h-4" /></>
          )}
        </Button>
      </div>

      <WhyItMatters>
        This is a read-only key — Coach Cade can only read your data, never modify it. You can
        revoke it anytime in intervals.icu settings.
      </WhyItMatters>

      {verifyStatus === "ok" && (
        <Button onClick={onNext} className="gap-2 w-fit">
          Continue <ChevronRight className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}

// ─── Step 5 ───────────────────────────────────────────────────────────────────

interface SyncLine {
  key: string;
  label: string;
  activeStages: string[];
  doneStages: string[];
  detail?: (p: SyncProgress) => string;
}

const SYNC_LINES: SyncLine[] = [
  {
    key: "connect",
    label: "Connecting to intervals.icu",
    activeStages: ["starting"],
    doneStages: ["activities", "streams", "intervals", "pbs", "wellness", "done"],
  },
  {
    key: "activities",
    label: "Reading training history",
    activeStages: ["activities"],
    doneStages: ["streams", "intervals", "pbs", "wellness", "done"],
    detail: (p) => (p.runsCount > 0 ? `${p.runsCount} activities` : ""),
  },
  {
    key: "wellness",
    label: "Importing wellness & HRV",
    activeStages: ["wellness"],
    doneStages: ["done"],
    detail: (p) => (p.wellnessDays > 0 ? `${p.wellnessDays} days` : ""),
  },
  {
    key: "fitness",
    label: "Calculating fitness curves",
    activeStages: ["intervals", "pbs"],
    doneStages: ["done"],
  },
  {
    key: "profile",
    label: "Building your athlete profile",
    activeStages: [],
    doneStages: ["done"],
  },
];

function Step5({
  onMarkDone,
}: {
  onMarkDone: () => void;
}) {
  const navigate = useNavigate();
  const { syncing, progress, runSync } = useIntervalsSync();
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (progress?.done && progress.stage !== "error" && progress.stage !== "idle") {
      onMarkDone();
    }
  }, [progress?.done, progress?.stage, onMarkDone]);

  function handleStart() {
    setStarted(true);
    runSync();
  }

  const isDone = progress?.done && progress.stage === "done";
  const isError = progress?.stage === "error";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Sync your data</h2>
        <p className="text-muted-foreground leading-relaxed">
          Coach Cade is about to read your training history, fitness curves, HRV and wellness data.
        </p>
      </div>

      {!started ? (
        <Button onClick={handleStart} size="lg" className="gap-2 w-fit">
          Start full sync <ChevronRight className="w-4 h-4" />
        </Button>
      ) : (
        <div className="flex flex-col gap-3 font-mono text-sm">
          {SYNC_LINES.map((line) => {
            const stage = progress?.stage ?? "idle";
            const isActive = line.activeStages.includes(stage);
            const isDoneLine = line.doneStages.includes(stage) || isDone;
            const detailText = line.detail && progress ? line.detail(progress) : "";

            return (
              <div key={line.key} className="flex items-center gap-3">
                {isDoneLine ? (
                  <Check className="w-4 h-4 text-green-600 shrink-0" />
                ) : isActive ? (
                  <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-muted-foreground/30 shrink-0" />
                )}
                <span className={isDoneLine ? "text-foreground" : isActive ? "text-foreground" : "text-muted-foreground"}>
                  {line.label}
                  {isDoneLine && detailText && (
                    <span className="text-muted-foreground ml-2">({detailText})</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {isError && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-destructive">{progress?.detail}</p>
          <Button variant="outline" onClick={handleStart} className="w-fit gap-2">
            Try again
          </Button>
        </div>
      )}

      {isDone && (
        <div className="flex flex-col gap-4 mt-2">
          <div className="flex items-center gap-2 text-green-600 font-semibold text-lg">
            <Check className="w-5 h-5" /> You're all set.
          </div>
          <p className="text-muted-foreground text-sm">
            Coach Cade has read {progress?.runsCount ?? 0} activities
            {progress?.wellnessDays ? ` and ${progress.wellnessDays} days of wellness data` : ""}.
          </p>
          <Button onClick={() => navigate("/coach")} size="lg" className="gap-2 w-fit">
            Meet Coach Cade <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function IntervalsSetupGuide() {
  const navigate = useNavigate();
  const { progress, markStep } = useOnboardingProgress();
  const { integration, isConnected: intervalsConnected } = useIntervalsIntegration();
  const { isConnected: vitalConnected } = useVitalIntegration();
  const hasDataSource = intervalsConnected || vitalConnected;

  // Resume from last incomplete step (minimum 1)
  const savedStep = progress?.step_completed ?? 0;
  const resumeStep = Math.min(Math.max(savedStep, 0) + 1, 5);

  const [currentStep, setCurrentStep] = useState(resumeStep);

  // Update current step when progress loads
  useEffect(() => {
    if (progress !== undefined && progress !== null) {
      const resume = Math.min(Math.max(progress.step_completed, 0) + 1, 5);
      setCurrentStep(resume);
    }
  }, [progress]);

  function goNext() {
    setCurrentStep((s) => Math.min(s + 1, 5));
  }

  function goBack() {
    setCurrentStep((s) => Math.max(s - 1, 1));
  }

  function handleMarkStep(step: number, fields?: Parameters<typeof markStep>[1]) {
    markStep(step, fields);
  }

  const completedSteps = new Set<number>();
  for (let i = 1; i <= Math.min((progress?.step_completed ?? 0), 5); i++) {
    completedSteps.add(i);
  }
  // Step 4 is complete if api_key_saved
  if (progress?.api_key_saved || integration?.api_key) completedSteps.add(4);
  // Step 5 is complete if first_sync_completed
  if (progress?.first_sync_completed) completedSteps.add(5);

  // Step 4 required — user can only go to step 5 if step 4 is done
  const canAdvanceTo = (step: number) => {
    if (step === 5 && !completedSteps.has(4)) return false;
    return true;
  };

  function handleSidebarClick(step: number) {
    if (step <= currentStep || completedSteps.has(step - 1)) {
      setCurrentStep(step);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <CadeLogo variant="full" size="sm" />
            <span className="text-muted-foreground text-sm hidden sm:inline">· Setup</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">
              Step {currentStep} of {STEPS.length}
            </span>
            <button
              onClick={() => navigate(hasDataSource ? "/" : "/settings")}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
            >
              {hasDataSource ? "Skip to dashboard" : "Using Strava? Go to Settings →"}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-10">
        <div className="flex gap-12">
          {/* Sidebar — desktop only */}
          <aside className="hidden md:flex flex-col gap-1 w-56 shrink-0 pt-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3 px-3">
              Setup
            </p>
            {STEPS.map((step) => (
              <button
                key={step.number}
                onClick={() => handleSidebarClick(step.number)}
                className="text-left w-full"
                disabled={step.number > currentStep && !completedSteps.has(step.number - 1)}
              >
                <StepIndicator
                  step={step}
                  current={currentStep}
                  completed={completedSteps.has(step.number)}
                />
              </button>
            ))}
          </aside>

          {/* Step content */}
          <main className="flex-1 min-w-0">
            {/* Mobile step indicator */}
            <div className="md:hidden mb-6 flex items-center gap-2 overflow-x-auto pb-1">
              {STEPS.map((step, i) => (
                <div key={step.number} className="flex items-center gap-2 shrink-0">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                      completedSteps.has(step.number)
                        ? "bg-green-600 text-white"
                        : step.number === currentStep
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {completedSteps.has(step.number) ? <Check className="w-3.5 h-3.5" /> : step.number}
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`w-6 h-px ${completedSteps.has(step.number) ? "bg-green-600" : "bg-muted"}`} />
                  )}
                </div>
              ))}
            </div>

            <div className="glass-card p-8 rounded-2xl border border-border">
              {currentStep === 1 && (
                <Step1
                  onNext={goNext}
                  onMarkDone={() => handleMarkStep(1, { intervals_connected: true })}
                  onGoToSettings={() => navigate("/settings")}
                />
              )}
              {currentStep === 2 && (
                <Step2
                  onNext={goNext}
                  onMarkDone={() => handleMarkStep(2, { garmin_connected: true })}
                />
              )}
              {currentStep === 3 && (
                <Step3
                  onNext={goNext}
                  onMarkDone={() => handleMarkStep(3, { historical_data_requested: true })}
                />
              )}
              {currentStep === 4 && (
                <Step4
                  onNext={() => { if (canAdvanceTo(5)) goNext(); }}
                  onMarkDone={() => handleMarkStep(4, { api_key_saved: true })}
                  initialAthleteId={integration?.athlete_id ?? ""}
                  initialApiKey={integration?.api_key ?? ""}
                />
              )}
              {currentStep === 5 && (
                <Step5
                  onMarkDone={() => handleMarkStep(5, { first_sync_completed: true, completed_at: new Date().toISOString() })}
                />
              )}

              {/* Back button */}
              {currentStep > 1 && currentStep < 5 && (
                <div className="mt-8 pt-6 border-t border-border">
                  <button
                    onClick={goBack}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" /> Back
                  </button>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default IntervalsSetupGuide;
