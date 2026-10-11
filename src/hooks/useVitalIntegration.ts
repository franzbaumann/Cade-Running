import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getSupabaseUrl } from "@/lib/supabase-url";
import { useAuth } from "@/hooks/use-auth";
import {
  AuthTokenError,
  createRequestId,
  getFunctionRequestHeaders,
  getSafeAccessToken,
} from "@/lib/supabase-auth-safe";

interface VitalIntegration {
  athlete_id: string;
}

interface VitalFunctionError {
  error?: string;
  detail?: string;
  request_id?: string;
}

interface VitalSyncResponse extends VitalFunctionError {
  ok?: boolean;
  activities_upserted?: number;
  activities_skipped?: number;
  workouts_received?: number;
  endpoint_imported_counts?: Record<string, number>;
  mapping_quality?: {
    parsed_event_date_count?: number;
    fallback_date_count?: number;
    missing_date_count?: number;
    missing_distance_count?: number;
    missing_duration_count?: number;
    missing_hr_count?: number;
    total_candidates?: number;
    deduped_candidates?: number;
  };
  workouts_endpoint?: string;
  workouts_fetch_status?: number;
  hrv_fetch_status?: number;
  sleep_fetch_status?: number;
  readiness_upserted?: number;
  streams_candidates?: number;
  streams_ok?: number;
  streams_fail?: number;
  provider_capability?: {
    fetched?: boolean;
    providers?: string[];
    workouts_supported?: boolean | null;
    detail?: string;
  };
}

async function parseJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    return {} as T;
  }
}

function buildErrorMessage(
  payload: VitalFunctionError,
  fallback: string,
  status?: number,
): string {
  const errorText = payload.error?.trim();
  const detailText = payload.detail?.trim();
  let base = fallback;

  if (errorText && detailText && !detailText.includes(errorText)) {
    base = `${errorText}: ${detailText}`;
  } else if (detailText) {
    base = detailText;
  } else if (errorText) {
    base = errorText;
  }

  if (payload.request_id) {
    base = `${base} [request_id: ${payload.request_id}]`;
  }

  return status != null ? `${base} (HTTP ${status})` : base;
}

export function useVitalIntegration() {
  const queryClient = useQueryClient();
  const { user, session } = useAuth();

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "vital-connected") {
        queryClient.invalidateQueries({ queryKey: ["vital-integration"] });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [queryClient]);

  const { data: integration, isLoading } = useQuery({
    queryKey: ["vital-integration"],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("integrations")
        .select("athlete_id")
        .eq("user_id", user.id)
        .eq("provider", "vital")
        .maybeSingle();
      if (error) throw error;
      return data as VitalIntegration | null;
    },
    enabled: !!user,
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      // Open popup immediately (must be from direct user gesture to avoid blocker)
      const popup = window.open("", "vital-link", "width=600,height=700");
      if (!popup) throw new Error("Popup blocked. Allow popups for this site and try again.");

      const requestId = createRequestId("vital_connect");
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const redirectUrl = `${origin}/auth/vital/callback`;
      const baseUrl = getSupabaseUrl();

      try {
        const accessToken = session?.access_token ?? await getSafeAccessToken();
        const res = await fetch(`${baseUrl}/functions/v1/vital-link-token`, {
          method: "POST",
          headers: getFunctionRequestHeaders(accessToken, requestId),
          body: JSON.stringify({ redirect_url: redirectUrl }),
        });
        const result = await parseJson<{ link_web_url?: string; link_token?: string } & VitalFunctionError>(res);
        if (!res.ok) {
          throw new Error(buildErrorMessage(result, "Failed to open Vital Link", res.status));
        }

        const linkUrl = result.link_web_url ?? result.link_token ?? "";
        if (!linkUrl) {
          throw new Error("Vital did not return a link URL.");
        }
        popup.location.href = linkUrl;
        return linkUrl;
      } catch (error) {
        popup.close();
        if (error instanceof AuthTokenError) {
          throw new Error(error.message);
        }
        throw error;
      }
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Failed to open Vital Link");
    },
  });

  const confirmConnectionMutation = useMutation({
    mutationFn: async (vitalUserId: string) => {
      const accessToken = session?.access_token ?? await getSafeAccessToken();
      const baseUrl = getSupabaseUrl();
      const requestId = createRequestId("vital_callback");
      const res = await fetch(`${baseUrl}/functions/v1/vital-oauth-callback`, {
        method: "POST",
        headers: getFunctionRequestHeaders(accessToken, requestId),
        body: JSON.stringify({ vital_user_id: vitalUserId }),
      });

      const data = await parseJson<VitalFunctionError>(res);
      if (!res.ok) throw new Error(buildErrorMessage(data, "Failed to save connection", res.status));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vital-integration"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Watch connected! Click Sync to fetch your data.");
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Failed to save connection");
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (): Promise<VitalSyncResponse> => {
      const accessToken = session?.access_token ?? await getSafeAccessToken();
      const baseUrl = getSupabaseUrl();
      const requestId = createRequestId("vital_sync");
      const res = await fetch(`${baseUrl}/functions/v1/vital-sync`, {
        method: "POST",
        headers: getFunctionRequestHeaders(accessToken, requestId),
        body: JSON.stringify({}),
      });

      const data = await parseJson<VitalSyncResponse>(res);
      if (!res.ok) throw new Error(buildErrorMessage(data, "Sync failed", res.status));
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      queryClient.invalidateQueries({ queryKey: ["daily_readiness"] });
      queryClient.invalidateQueries({ queryKey: ["weekStats"] });
      queryClient.invalidateQueries({ queryKey: ["athlete_profile"] });
      queryClient.invalidateQueries({ queryKey: ["activityCount"] });
      queryClient.invalidateQueries({ queryKey: ["personal_records"] });
      queryClient.invalidateQueries({ queryKey: ["intervals-data"] });
      queryClient.invalidateQueries({ queryKey: ["intervals-activities-chunked"] });
      queryClient.invalidateQueries({ queryKey: ["workout-invites"] });
      const imported = data.activities_upserted ?? 0;
      const skipped = data.activities_skipped ?? 0;
      const received = data.workouts_received ?? 0;
      const quality = data.mapping_quality;
      const totalCandidates = quality?.total_candidates ?? 0;
      const fallbackDateRatio = totalCandidates > 0
        ? (quality?.fallback_date_count ?? 0) / totalCandidates
        : 0;
      const missingDistanceRatio = totalCandidates > 0
        ? (quality?.missing_distance_count ?? 0) / totalCandidates
        : 0;
      const missingDurationRatio = totalCandidates > 0
        ? (quality?.missing_duration_count ?? 0) / totalCandidates
        : 0;
      const hasQualityWarning = totalCandidates > 0 &&
        (fallbackDateRatio > 0.5 || missingDistanceRatio > 0.5 || missingDurationRatio > 0.5);
      const streamsFail = data.streams_fail ?? 0;
      const streamsTotal = (data.streams_ok ?? 0) + streamsFail;
      const hasStreamWarning = streamsTotal > 0 && streamsFail > 0 && streamsFail >= Math.ceil(streamsTotal * 0.5);

      if (imported > 0) {
        if (hasQualityWarning) {
          toast.warning(
            `Imported ${imported} activities, but some fields look incomplete (dates/metrics).`
            + (data.detail ? ` ${data.detail}` : ""),
          );
          return;
        }
        if (hasStreamWarning) {
          toast.warning(
            `Imported ${imported} activities from Vital, but chart data failed for ${streamsFail}/${streamsTotal} activities.`
            + (data.detail ? ` ${data.detail}` : ""),
          );
          return;
        }
        toast.success(
          `Imported ${imported} activities from Vital${skipped > 0 ? ` (${skipped} skipped)` : ""}.`
          + (data.detail ? ` ${data.detail}` : ""),
        );
        return;
      }
      if (received === 0) {
        const providerInfo = data.provider_capability?.providers?.length
          ? ` (${data.provider_capability.providers.join(", ")})`
          : "";
        toast.success(data.detail ?? `Connected${providerInfo}, but no workouts found in Vital for the selected date range.`);
        return;
      }
      toast.success(data.detail ?? `Imported 0 activities from Vital (${skipped} skipped).`);
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const uid = user?.id ?? (await supabase.auth.getSession()).data.session?.user?.id;
      if (!uid) throw new Error("Not authenticated. Sign out and sign back in, then try again.");

      const { error } = await supabase
        .from("integrations")
        .delete()
        .eq("user_id", uid)
        .eq("provider", "vital");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vital-integration"] });
      toast.success("Watch disconnected.");
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Failed to disconnect");
    },
  });

  const backfillMutation = useMutation({
    mutationFn: async (startDate?: string): Promise<{ activities_upserted: number; activities_skipped: number; workouts_received: number }> => {
      const accessToken = session?.access_token ?? await getSafeAccessToken();
      const baseUrl = getSupabaseUrl();
      const requestId = createRequestId("vital_backfill");
      const res = await fetch(`${baseUrl}/functions/v1/vital-backfill`, {
        method: "POST",
        headers: getFunctionRequestHeaders(accessToken, requestId),
        body: JSON.stringify(
          startDate
            ? { start_date: startDate, force_full_sync: true }
            : { force_full_sync: true },
        ),
      });

      const data = await parseJson<{ ok?: boolean; activities_upserted?: number; activities_skipped?: number; workouts_received?: number } & VitalFunctionError>(res);
      if (!res.ok) throw new Error(buildErrorMessage(data, "Backfill failed", res.status));
      return {
        activities_upserted: data.activities_upserted ?? 0,
        activities_skipped: data.activities_skipped ?? 0,
        workouts_received: data.workouts_received ?? 0,
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      queryClient.invalidateQueries({ queryKey: ["weekStats"] });
      queryClient.invalidateQueries({ queryKey: ["activityCount"] });
      queryClient.invalidateQueries({ queryKey: ["personal_records"] });
      queryClient.invalidateQueries({ queryKey: ["intervals-activities-chunked"] });
      const imported = data.activities_upserted;
      const skipped = data.activities_skipped;
      if (imported > 0) {
        toast.success(`Imported ${imported} activities from your full history${skipped > 0 ? ` (${skipped} skipped)` : ""}.`);
      } else {
        toast.success(`History scan complete — all ${data.workouts_received} activities already up to date.`);
      }
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "History import failed");
    },
  });

  return {
    integration,
    isLoading,
    isConnected: !!integration?.athlete_id,
    connect: connectMutation.mutate,
    isConnecting: connectMutation.isPending,
    confirmConnection: confirmConnectionMutation.mutate,
    sync: syncMutation.mutate,
    isSyncing: syncMutation.isPending,
    backfill: backfillMutation.mutate,
    isBackfilling: backfillMutation.isPending,
    disconnect: disconnectMutation.mutate,
    disconnectAsync: disconnectMutation.mutateAsync,
    isDisconnecting: disconnectMutation.isPending,
  };
}
