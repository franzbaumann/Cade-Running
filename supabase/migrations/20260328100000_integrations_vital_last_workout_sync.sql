-- Track last successful Vital workout list sync for incremental fetches.
ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS vital_last_workout_sync_at timestamptz;

COMMENT ON COLUMN public.integrations.vital_last_workout_sync_at IS
  'Last time a Vital workout sync or backfill completed successfully for this user.';
