export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activity: {
        Row: {
          ai_analysis: string | null
          avg_hr: number | null
          avg_pace: string | null
          cadence: number | null
          cadence_consistency: number | null
          cardiac_drift: number | null
          coach_note: string | null
          created_at: string
          date: string
          description: string | null
          distance_km: number | null
          duration_seconds: number | null
          elevation_gain: number | null
          enhancing_supplements: Json | null
          external_id: string | null
          gap: number | null
          garmin_id: string | null
          hr_zone_times: Json | null
          hr_zones: Json | null
          icu_aerobic_decoupling: number | null
          icu_avg_hr_reserve: number | null
          icu_efficiency_factor: number | null
          icu_hrss: number | null
          icu_lactate_threshold_hr: number | null
          icu_lactate_threshold_pace: string | null
          icu_power_hr: number | null
          icu_training_load: number | null
          icu_trimp: number | null
          icu_vo2max_estimate: number | null
          id: string
          intensity_factor: number | null
          lactate_levels: string | null
          lap_splits: Json | null
          max_hr: number | null
          name: string | null
          nomio_drink: boolean | null
          pace_efficiency: number | null
          pace_zone_times: Json | null
          perceived_exertion: number | null
          photos: Json | null
          planned_session_label: string | null
          planned_workout_id: string | null
          polyline: string | null
          source: Database["public"]["Enums"]["activity_source"] | null
          splits: Json | null
          strava_id: string | null
          trimp: number | null
          tss: number | null
          type: string | null
          user_id: string
          user_notes: string | null
          workout_type: string | null
        }
        Insert: {
          ai_analysis?: string | null
          avg_hr?: number | null
          avg_pace?: string | null
          cadence?: number | null
          cadence_consistency?: number | null
          cardiac_drift?: number | null
          coach_note?: string | null
          created_at?: string
          date?: string
          description?: string | null
          distance_km?: number | null
          duration_seconds?: number | null
          elevation_gain?: number | null
          enhancing_supplements?: Json | null
          external_id?: string | null
          gap?: number | null
          garmin_id?: string | null
          hr_zone_times?: Json | null
          hr_zones?: Json | null
          icu_aerobic_decoupling?: number | null
          icu_avg_hr_reserve?: number | null
          icu_efficiency_factor?: number | null
          icu_hrss?: number | null
          icu_lactate_threshold_hr?: number | null
          icu_lactate_threshold_pace?: string | null
          icu_power_hr?: number | null
          icu_training_load?: number | null
          icu_trimp?: number | null
          icu_vo2max_estimate?: number | null
          id?: string
          intensity_factor?: number | null
          lactate_levels?: string | null
          lap_splits?: Json | null
          max_hr?: number | null
          name?: string | null
          nomio_drink?: boolean | null
          pace_efficiency?: number | null
          pace_zone_times?: Json | null
          perceived_exertion?: number | null
          photos?: Json | null
          planned_session_label?: string | null
          planned_workout_id?: string | null
          polyline?: string | null
          source?: Database["public"]["Enums"]["activity_source"] | null
          splits?: Json | null
          strava_id?: string | null
          trimp?: number | null
          tss?: number | null
          type?: string | null
          user_id: string
          user_notes?: string | null
          workout_type?: string | null
        }
        Update: {
          ai_analysis?: string | null
          avg_hr?: number | null
          avg_pace?: string | null
          cadence?: number | null
          cadence_consistency?: number | null
          cardiac_drift?: number | null
          coach_note?: string | null
          created_at?: string
          date?: string
          description?: string | null
          distance_km?: number | null
          duration_seconds?: number | null
          elevation_gain?: number | null
          enhancing_supplements?: Json | null
          external_id?: string | null
          gap?: number | null
          garmin_id?: string | null
          hr_zone_times?: Json | null
          hr_zones?: Json | null
          icu_aerobic_decoupling?: number | null
          icu_avg_hr_reserve?: number | null
          icu_efficiency_factor?: number | null
          icu_hrss?: number | null
          icu_lactate_threshold_hr?: number | null
          icu_lactate_threshold_pace?: string | null
          icu_power_hr?: number | null
          icu_training_load?: number | null
          icu_trimp?: number | null
          icu_vo2max_estimate?: number | null
          id?: string
          intensity_factor?: number | null
          lactate_levels?: string | null
          lap_splits?: Json | null
          max_hr?: number | null
          name?: string | null
          nomio_drink?: boolean | null
          pace_efficiency?: number | null
          pace_zone_times?: Json | null
          perceived_exertion?: number | null
          photos?: Json | null
          planned_session_label?: string | null
          planned_workout_id?: string | null
          polyline?: string | null
          source?: Database["public"]["Enums"]["activity_source"] | null
          splits?: Json | null
          strava_id?: string | null
          trimp?: number | null
          tss?: number | null
          type?: string | null
          user_id?: string
          user_notes?: string | null
          workout_type?: string | null
        }
        Relationships: []
      }
      activity_intervals: {
        Row: {
          activity_id: string
          avg_cadence: number | null
          avg_hr: number | null
          avg_pace: number | null
          avg_power: number | null
          created_at: string | null
          distance_km: number | null
          elapsed_time: number | null
          end_index: number | null
          id: string
          intensity_factor: number | null
          interval_number: number
          label: string | null
          max_hr: number | null
          start_index: number | null
          start_time_offset: number | null
          tss: number | null
          type: string | null
          user_id: string
        }
        Insert: {
          activity_id: string
          avg_cadence?: number | null
          avg_hr?: number | null
          avg_pace?: number | null
          avg_power?: number | null
          created_at?: string | null
          distance_km?: number | null
          elapsed_time?: number | null
          end_index?: number | null
          id?: string
          intensity_factor?: number | null
          interval_number: number
          label?: string | null
          max_hr?: number | null
          start_index?: number | null
          start_time_offset?: number | null
          tss?: number | null
          type?: string | null
          user_id: string
        }
        Update: {
          activity_id?: string
          avg_cadence?: number | null
          avg_hr?: number | null
          avg_pace?: number | null
          avg_power?: number | null
          created_at?: string | null
          distance_km?: number | null
          elapsed_time?: number | null
          end_index?: number | null
          id?: string
          intensity_factor?: number | null
          interval_number?: number
          label?: string | null
          max_hr?: number | null
          start_index?: number | null
          start_time_offset?: number | null
          tss?: number | null
          type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      activity_streams: {
        Row: {
          activity_id: string
          altitude: number[] | null
          cadence: number[] | null
          created_at: string
          distance: number[] | null
          fixed_heartrate: number[] | null
          heartrate: number[] | null
          hr_zones: number[] | null
          id: string
          latlng: number[] | null
          pace: number[] | null
          pace_zones: number[] | null
          respiration_rate: number[] | null
          smo2: number[] | null
          temperature: number[] | null
          thb: number[] | null
          time: number[] | null
          user_id: string
        }
        Insert: {
          activity_id: string
          altitude?: number[] | null
          cadence?: number[] | null
          created_at?: string
          distance?: number[] | null
          fixed_heartrate?: number[] | null
          heartrate?: number[] | null
          hr_zones?: number[] | null
          id?: string
          latlng?: number[] | null
          pace?: number[] | null
          pace_zones?: number[] | null
          respiration_rate?: number[] | null
          smo2?: number[] | null
          temperature?: number[] | null
          thb?: number[] | null
          time?: number[] | null
          user_id: string
        }
        Update: {
          activity_id?: string
          altitude?: number[] | null
          cadence?: number[] | null
          created_at?: string
          distance?: number[] | null
          fixed_heartrate?: number[] | null
          heartrate?: number[] | null
          hr_zones?: number[] | null
          id?: string
          latlng?: number[] | null
          pace?: number[] | null
          pace_zones?: number[] | null
          respiration_rate?: number[] | null
          smo2?: number[] | null
          temperature?: number[] | null
          thb?: number[] | null
          time?: number[] | null
          user_id?: string
        }
        Relationships: []
      }
      ai_usage: {
        Row: {
          date: string
          messages_used: number
          user_id: string
        }
        Insert: {
          date?: string
          messages_used?: number
          user_id: string
        }
        Update: {
          date?: string
          messages_used?: number
          user_id?: string
        }
        Relationships: []
      }
      athlete_profile: {
        Row: {
          created_at: string
          days_per_week: number | null
          double_run_days: string[] | null
          double_run_duration: number | null
          double_runs_enabled: boolean | null
          goal_distance: string | null
          goal_race: Json | null
          goal_race_date: string | null
          goal_race_name: string | null
          goal_time: string | null
          height_cm: number | null
          id: string
          injury_history_text: string | null
          lab_name: string | null
          lab_test_date: string | null
          lactate_threshold_hr: number | null
          lactate_threshold_pace: string | null
          lt1_hr: number | null
          lt1_pace: string | null
          max_hr: number | null
          max_hr_measured: number | null
          name: string
          narrative: string | null
          username: string | null
          onboarding_answers: Json | null
          onboarding_complete: boolean | null
          preferred_longrun_day: string | null
          preferred_units: string | null
          race_history: Json | null
          recommended_philosophy: string | null
          resting_hr: number | null
          stripe_customer_id: string | null
          subscription_period_end: string | null
          subscription_plan: string | null
          subscription_status: string | null
          training_philosophy:
            | Database["public"]["Enums"]["training_philosophy"]
            | null
          trial_end: string | null
          updated_at: string
          user_id: string
          vdot: number | null
          vlamax: number | null
          vo2max: number | null
          weight_kg: number | null
          zone_source: string | null
        }
        Insert: {
          created_at?: string
          days_per_week?: number | null
          double_run_days?: string[] | null
          double_run_duration?: number | null
          double_runs_enabled?: boolean | null
          goal_distance?: string | null
          goal_race?: Json | null
          goal_race_date?: string | null
          goal_race_name?: string | null
          goal_time?: string | null
          height_cm?: number | null
          id?: string
          injury_history_text?: string | null
          lab_name?: string | null
          lab_test_date?: string | null
          lactate_threshold_hr?: number | null
          lactate_threshold_pace?: string | null
          lt1_hr?: number | null
          lt1_pace?: string | null
          max_hr?: number | null
          max_hr_measured?: number | null
          name?: string
          narrative?: string | null
          username?: string | null
          onboarding_answers?: Json | null
          onboarding_complete?: boolean | null
          preferred_longrun_day?: string | null
          preferred_units?: string | null
          race_history?: Json | null
          recommended_philosophy?: string | null
          resting_hr?: number | null
          stripe_customer_id?: string | null
          subscription_period_end?: string | null
          subscription_plan?: string | null
          subscription_status?: string | null
          training_philosophy?:
            | Database["public"]["Enums"]["training_philosophy"]
            | null
          trial_end?: string | null
          updated_at?: string
          user_id: string
          vdot?: number | null
          vlamax?: number | null
          vo2max?: number | null
          weight_kg?: number | null
          zone_source?: string | null
        }
        Update: {
          created_at?: string
          days_per_week?: number | null
          double_run_days?: string[] | null
          double_run_duration?: number | null
          double_runs_enabled?: boolean | null
          goal_distance?: string | null
          goal_race?: Json | null
          goal_race_date?: string | null
          goal_race_name?: string | null
          goal_time?: string | null
          height_cm?: number | null
          id?: string
          injury_history_text?: string | null
          lab_name?: string | null
          lab_test_date?: string | null
          lactate_threshold_hr?: number | null
          lactate_threshold_pace?: string | null
          lt1_hr?: number | null
          lt1_pace?: string | null
          max_hr?: number | null
          max_hr_measured?: number | null
          name?: string
          narrative?: string | null
          username?: string | null
          onboarding_answers?: Json | null
          onboarding_complete?: boolean | null
          preferred_longrun_day?: string | null
          preferred_units?: string | null
          race_history?: Json | null
          recommended_philosophy?: string | null
          resting_hr?: number | null
          stripe_customer_id?: string | null
          subscription_period_end?: string | null
          subscription_plan?: string | null
          subscription_status?: string | null
          training_philosophy?:
            | Database["public"]["Enums"]["training_philosophy"]
            | null
          trial_end?: string | null
          updated_at?: string
          user_id?: string
          vdot?: number | null
          vlamax?: number | null
          vo2max?: number | null
          weight_kg?: number | null
          zone_source?: string | null
        }
        Relationships: []
      }
      beta_signups: {
        Row: {
          created_at: string | null
          email: string
          id: string
          source: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          source?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          source?: string | null
        }
        Relationships: []
      }
      coach_message: {
        Row: {
          activity_id: string | null
          content: string
          created_at: string
          id: string
          message_type: string | null
          role: Database["public"]["Enums"]["coach_role"]
          timestamp: string
          triggered_by: Database["public"]["Enums"]["coach_trigger"] | null
          ui_component: string | null
          ui_data: Json | null
          user_id: string
        }
        Insert: {
          activity_id?: string | null
          content: string
          created_at?: string
          id?: string
          message_type?: string | null
          role?: Database["public"]["Enums"]["coach_role"]
          timestamp?: string
          triggered_by?: Database["public"]["Enums"]["coach_trigger"] | null
          ui_component?: string | null
          ui_data?: Json | null
          user_id: string
        }
        Update: {
          activity_id?: string | null
          content?: string
          created_at?: string
          id?: string
          message_type?: string | null
          role?: Database["public"]["Enums"]["coach_role"]
          timestamp?: string
          triggered_by?: Database["public"]["Enums"]["coach_trigger"] | null
          ui_component?: string | null
          ui_data?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      coaching_memory: {
        Row: {
          category: string
          content: string
          created_at: string
          expires_at: string | null
          id: string
          importance: number
          source: string | null
          user_id: string
        }
        Insert: {
          category?: string
          content: string
          created_at?: string
          expires_at?: string | null
          id?: string
          importance?: number
          source?: string | null
          user_id: string
        }
        Update: {
          category?: string
          content?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          importance?: number
          source?: string | null
          user_id?: string
        }
        Relationships: []
      }
      competition_season: {
        Row: {
          created_at: string | null
          end_date: string
          end_goal_race_id: string | null
          id: string
          name: string
          notes: string | null
          primary_distance: string | null
          season_type: string
          start_date: string
          status: string | null
          training_plan_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          end_date: string
          end_goal_race_id?: string | null
          id?: string
          name: string
          notes?: string | null
          primary_distance?: string | null
          season_type: string
          start_date: string
          status?: string | null
          training_plan_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          end_date?: string
          end_goal_race_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          primary_distance?: string | null
          season_type?: string
          start_date?: string
          status?: string | null
          training_plan_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      daily_load: {
        Row: {
          breakdown: Json | null
          cns_status: string | null
          created_at: string | null
          date: string
          energy: number | null
          hrv_score: number | null
          id: string
          legs: number | null
          life_note: string | null
          life_stress: number | null
          mood: number | null
          other_training: Json | null
          recovery_score: number | null
          resting_hr: number | null
          running_atl: number | null
          sleep_hours: number | null
          sleep_score: number | null
          total_load_score: number | null
          travel: boolean | null
          travel_note: string | null
          user_id: string
          work_stress: number | null
        }
        Insert: {
          breakdown?: Json | null
          cns_status?: string | null
          created_at?: string | null
          date: string
          energy?: number | null
          hrv_score?: number | null
          id?: string
          legs?: number | null
          life_note?: string | null
          life_stress?: number | null
          mood?: number | null
          other_training?: Json | null
          recovery_score?: number | null
          resting_hr?: number | null
          running_atl?: number | null
          sleep_hours?: number | null
          sleep_score?: number | null
          total_load_score?: number | null
          travel?: boolean | null
          travel_note?: string | null
          user_id: string
          work_stress?: number | null
        }
        Update: {
          breakdown?: Json | null
          cns_status?: string | null
          created_at?: string | null
          date?: string
          energy?: number | null
          hrv_score?: number | null
          id?: string
          legs?: number | null
          life_note?: string | null
          life_stress?: number | null
          mood?: number | null
          other_training?: Json | null
          recovery_score?: number | null
          resting_hr?: number | null
          running_atl?: number | null
          sleep_hours?: number | null
          sleep_score?: number | null
          total_load_score?: number | null
          travel?: boolean | null
          travel_note?: string | null
          user_id?: string
          work_stress?: number | null
        }
        Relationships: []
      }
      daily_readiness: {
        Row: {
          ai_summary: string | null
          atl: number | null
          created_at: string
          ctl: number | null
          date: string
          energy: number | null
          hrv: number | null
          hrv_baseline: number | null
          hrv_rmssd: number | null
          hrv_sdnn: number | null
          icu_atl: number | null
          icu_ctl: number | null
          icu_long_term_power: number | null
          icu_ramp_rate: number | null
          icu_tsb: number | null
          id: string
          kcal: number | null
          mood: number | null
          muscle_soreness: number | null
          readiness: number | null
          respiration_rate: number | null
          resting_hr: number | null
          score: number | null
          sleep_hours: number | null
          sleep_quality: number | null
          sleep_score: number | null
          sleep_secs: number | null
          spo2: number | null
          steps: number | null
          stress_hrv: number | null
          stress_score: number | null
          tsb: number | null
          user_id: string
          vo2max: number | null
          weight: number | null
        }
        Insert: {
          ai_summary?: string | null
          atl?: number | null
          created_at?: string
          ctl?: number | null
          date?: string
          energy?: number | null
          hrv?: number | null
          hrv_baseline?: number | null
          hrv_rmssd?: number | null
          hrv_sdnn?: number | null
          icu_atl?: number | null
          icu_ctl?: number | null
          icu_long_term_power?: number | null
          icu_ramp_rate?: number | null
          icu_tsb?: number | null
          id?: string
          kcal?: number | null
          mood?: number | null
          muscle_soreness?: number | null
          readiness?: number | null
          respiration_rate?: number | null
          resting_hr?: number | null
          score?: number | null
          sleep_hours?: number | null
          sleep_quality?: number | null
          sleep_score?: number | null
          sleep_secs?: number | null
          spo2?: number | null
          steps?: number | null
          stress_hrv?: number | null
          stress_score?: number | null
          tsb?: number | null
          user_id: string
          vo2max?: number | null
          weight?: number | null
        }
        Update: {
          ai_summary?: string | null
          atl?: number | null
          created_at?: string
          ctl?: number | null
          date?: string
          energy?: number | null
          hrv?: number | null
          hrv_baseline?: number | null
          hrv_rmssd?: number | null
          hrv_sdnn?: number | null
          icu_atl?: number | null
          icu_ctl?: number | null
          icu_long_term_power?: number | null
          icu_ramp_rate?: number | null
          icu_tsb?: number | null
          id?: string
          kcal?: number | null
          mood?: number | null
          muscle_soreness?: number | null
          readiness?: number | null
          respiration_rate?: number | null
          resting_hr?: number | null
          score?: number | null
          sleep_hours?: number | null
          sleep_quality?: number | null
          sleep_score?: number | null
          sleep_secs?: number | null
          spo2?: number | null
          steps?: number | null
          stress_hrv?: number | null
          stress_score?: number | null
          tsb?: number | null
          user_id?: string
          vo2max?: number | null
          weight?: number | null
        }
        Relationships: []
      }
      integrations: {
        Row: {
          api_key: string
          athlete_id: string
          created_at: string
          id: string
          provider: string
          updated_at: string
          user_id: string
          vital_last_workout_sync_at: string | null
        }
        Insert: {
          api_key?: string
          athlete_id?: string
          created_at?: string
          id?: string
          provider?: string
          updated_at?: string
          user_id: string
          vital_last_workout_sync_at?: string | null
        }
        Update: {
          api_key?: string
          athlete_id?: string
          created_at?: string
          id?: string
          provider?: string
          updated_at?: string
          user_id?: string
          vital_last_workout_sync_at?: string | null
        }
        Relationships: []
      }
      oauth_tokens: {
        Row: {
          access_token: string
          athlete_id: string | null
          athlete_name: string | null
          created_at: string
          expires_at: string | null
          id: string
          last_sync_at: string | null
          provider: Database["public"]["Enums"]["oauth_provider"]
          refresh_token: string | null
          token_secret: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          athlete_id?: string | null
          athlete_name?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          last_sync_at?: string | null
          provider: Database["public"]["Enums"]["oauth_provider"]
          refresh_token?: string | null
          token_secret?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          athlete_id?: string | null
          athlete_name?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          last_sync_at?: string | null
          provider?: Database["public"]["Enums"]["oauth_provider"]
          refresh_token?: string | null
          token_secret?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      onboarding_progress: {
        Row: {
          api_key_saved: boolean | null
          completed_at: string | null
          first_sync_completed: boolean | null
          garmin_connected: boolean | null
          historical_data_requested: boolean | null
          intervals_connected: boolean | null
          step_completed: number | null
          user_id: string
        }
        Insert: {
          api_key_saved?: boolean | null
          completed_at?: string | null
          first_sync_completed?: boolean | null
          garmin_connected?: boolean | null
          historical_data_requested?: boolean | null
          intervals_connected?: boolean | null
          step_completed?: number | null
          user_id: string
        }
        Update: {
          api_key_saved?: boolean | null
          completed_at?: string | null
          first_sync_completed?: boolean | null
          garmin_connected?: boolean | null
          historical_data_requested?: boolean | null
          intervals_connected?: boolean | null
          step_completed?: number | null
          user_id?: string
        }
        Relationships: []
      }
      personal_records: {
        Row: {
          activity_id: string | null
          best_pace: string | null
          best_time_seconds: number | null
          created_at: string | null
          date_achieved: string | null
          distance: string
          id: string
          source: string | null
          user_id: string
        }
        Insert: {
          activity_id?: string | null
          best_pace?: string | null
          best_time_seconds?: number | null
          created_at?: string | null
          date_achieved?: string | null
          distance: string
          id?: string
          source?: string | null
          user_id: string
        }
        Update: {
          activity_id?: string | null
          best_pace?: string | null
          best_time_seconds?: number | null
          created_at?: string | null
          date_achieved?: string | null
          distance?: string
          id?: string
          source?: string | null
          user_id?: string
        }
        Relationships: []
      }
      race_predictions: {
        Row: {
          created_at: string
          ctl_at_prediction: number | null
          goal_distance: string | null
          id: string
          predicted_at: string
          predicted_pace: string | null
          predicted_time_seconds: number | null
          threshold_pace: string | null
          user_id: string
          vo2max_pace: string | null
          zone2_pace: string | null
        }
        Insert: {
          created_at?: string
          ctl_at_prediction?: number | null
          goal_distance?: string | null
          id?: string
          predicted_at?: string
          predicted_pace?: string | null
          predicted_time_seconds?: number | null
          threshold_pace?: string | null
          user_id: string
          vo2max_pace?: string | null
          zone2_pace?: string | null
        }
        Update: {
          created_at?: string
          ctl_at_prediction?: number | null
          goal_distance?: string | null
          id?: string
          predicted_at?: string
          predicted_pace?: string | null
          predicted_time_seconds?: number | null
          threshold_pace?: string | null
          user_id?: string
          vo2max_pace?: string | null
          zone2_pace?: string | null
        }
        Relationships: []
      }
      season_performance: {
        Row: {
          atl_at_date: number | null
          created_at: string | null
          ctl_at_date: number | null
          date: string
          hrv_at_date: number | null
          id: string
          note: string | null
          season_id: string
          tsb_at_date: number | null
          user_id: string
        }
        Insert: {
          atl_at_date?: number | null
          created_at?: string | null
          ctl_at_date?: number | null
          date: string
          hrv_at_date?: number | null
          id?: string
          note?: string | null
          season_id: string
          tsb_at_date?: number | null
          user_id: string
        }
        Update: {
          atl_at_date?: number | null
          created_at?: string | null
          ctl_at_date?: number | null
          date?: string
          hrv_at_date?: number | null
          id?: string
          note?: string | null
          season_id?: string
          tsb_at_date?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_performance_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "competition_season"
            referencedColumns: ["id"]
          },
        ]
      }
      season_race: {
        Row: {
          activity_id: string | null
          actual_place: number | null
          actual_time: string | null
          created_at: string | null
          date: string
          distance: string
          goal_time: string | null
          id: string
          name: string
          notes: string | null
          priority: string
          season_id: string
          status: string | null
          surface: string | null
          user_id: string
          venue: string | null
        }
        Insert: {
          activity_id?: string | null
          actual_place?: number | null
          actual_time?: string | null
          created_at?: string | null
          date: string
          distance: string
          goal_time?: string | null
          id?: string
          name: string
          notes?: string | null
          priority: string
          season_id: string
          status?: string | null
          surface?: string | null
          user_id: string
          venue?: string | null
        }
        Update: {
          activity_id?: string | null
          actual_place?: number | null
          actual_time?: string | null
          created_at?: string | null
          date?: string
          distance?: string
          goal_time?: string | null
          id?: string
          name?: string
          notes?: string | null
          priority?: string
          season_id?: string
          status?: string | null
          surface?: string | null
          user_id?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "season_race_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "competition_season"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_events: {
        Row: {
          created_at: string | null
          data: Json | null
          event_type: string
          id: string
          stripe_event_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          data?: Json | null
          event_type: string
          id?: string
          stripe_event_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          data?: Json | null
          event_type?: string
          id?: string
          stripe_event_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      sync_progress: {
        Row: {
          activities_total: number | null
          activities_upserted: number | null
          atl: number | null
          ctl: number | null
          detail: string | null
          done: boolean
          error: string | null
          intervals_count: number | null
          pbs_count: number | null
          stage: string
          streams_done: number | null
          streams_total: number | null
          tsb: number | null
          updated_at: string
          user_id: string
          wellness_days: number | null
          years_completed: Json | null
        }
        Insert: {
          activities_total?: number | null
          activities_upserted?: number | null
          atl?: number | null
          ctl?: number | null
          detail?: string | null
          done?: boolean
          error?: string | null
          intervals_count?: number | null
          pbs_count?: number | null
          stage?: string
          streams_done?: number | null
          streams_total?: number | null
          tsb?: number | null
          updated_at?: string
          user_id: string
          wellness_days?: number | null
          years_completed?: Json | null
        }
        Update: {
          activities_total?: number | null
          activities_upserted?: number | null
          atl?: number | null
          ctl?: number | null
          detail?: string | null
          done?: boolean
          error?: string | null
          intervals_count?: number | null
          pbs_count?: number | null
          stage?: string
          streams_done?: number | null
          streams_total?: number | null
          tsb?: number | null
          updated_at?: string
          user_id?: string
          wellness_days?: number | null
          years_completed?: Json | null
        }
        Relationships: []
      }
      friendship: {
        Row: {
          id: string
          user_a: string
          user_b: string
          created_at: string
        }
        Insert: {
          id?: string
          user_a: string
          user_b: string
          created_at?: string
        }
        Update: {
          id?: string
          user_a?: string
          user_b?: string
          created_at?: string
        }
        Relationships: []
      }
      friend_request: {
        Row: {
          id: string
          from_user: string
          to_user: string
          status: string
          created_at: string
          responded_at: string | null
        }
        Insert: {
          id?: string
          from_user: string
          to_user: string
          status?: string
          created_at?: string
          responded_at?: string | null
        }
        Update: {
          id?: string
          from_user?: string
          to_user?: string
          status?: string
          created_at?: string
          responded_at?: string | null
        }
        Relationships: []
      }
      activity_like: {
        Row: {
          id: string
          activity_id: string
          user_id: string
          created_at: string
        }
        Insert: {
          id?: string
          activity_id: string
          user_id: string
          created_at?: string
        }
        Update: {
          id?: string
          activity_id?: string
          user_id?: string
          created_at?: string
        }
        Relationships: []
      }
      activity_comment: {
        Row: {
          id: string
          activity_id: string
          user_id: string
          content: string
          created_at: string
        }
        Insert: {
          id?: string
          activity_id: string
          user_id: string
          content: string
          created_at?: string
        }
        Update: {
          id?: string
          activity_id?: string
          user_id?: string
          content?: string
          created_at?: string
        }
        Relationships: []
      }
      workout_invite: {
        Row: {
          id: string
          from_user: string
          to_user: string
          proposed_date: string
          message: string | null
          status: string
          from_workout_id: string | null
          to_workout_id: string | null
          combined_workout: Json | null
          invite_type: string
          created_at: string
          responded_at: string | null
          session_id: string | null
        }
        Insert: {
          id?: string
          from_user: string
          to_user: string
          proposed_date: string
          message?: string | null
          status?: string
          from_workout_id?: string | null
          to_workout_id?: string | null
          combined_workout?: Json | null
          invite_type?: string
          created_at?: string
          responded_at?: string | null
          session_id?: string | null
        }
        Update: {
          id?: string
          from_user?: string
          to_user?: string
          proposed_date?: string
          message?: string | null
          status?: string
          from_workout_id?: string | null
          to_workout_id?: string | null
          combined_workout?: Json | null
          invite_type?: string
          created_at?: string
          responded_at?: string | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workout_invite_from_workout_id_fkey"
            columns: ["from_workout_id"]
            isOneToOne: false
            referencedRelation: "training_plan_workout"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_invite_to_workout_id_fkey"
            columns: ["to_workout_id"]
            isOneToOne: false
            referencedRelation: "training_plan_workout"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workout_invite_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "workout_session"
            referencedColumns: ["id"]
          },
        ]
      }
      workout_session: {
        Row: {
          id: string
          from_user: string
          proposed_date: string
          message: string | null
          invite_type: string
          combined_workout: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          from_user: string
          proposed_date: string
          message?: string | null
          invite_type?: string
          combined_workout?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          from_user?: string
          proposed_date?: string
          message?: string | null
          invite_type?: string
          combined_workout?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      training_plan: {
        Row: {
          created_at: string
          end_date: string | null
          goal_date: string | null
          goal_race: string | null
          goal_time: string | null
          id: string
          is_active: boolean | null
          peak_weekly_km: number | null
          philosophy: string | null
          plan_name: string | null
          race_date: string | null
          race_type: string | null
          season_id: string | null
          start_date: string | null
          target_time: string | null
          total_weeks: number | null
          updated_at: string
          user_id: string
          weeks_total: number | null
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          goal_date?: string | null
          goal_race?: string | null
          goal_time?: string | null
          id?: string
          is_active?: boolean | null
          peak_weekly_km?: number | null
          philosophy?: string | null
          plan_name?: string | null
          race_date?: string | null
          race_type?: string | null
          season_id?: string | null
          start_date?: string | null
          target_time?: string | null
          total_weeks?: number | null
          updated_at?: string
          user_id: string
          weeks_total?: number | null
        }
        Update: {
          created_at?: string
          end_date?: string | null
          goal_date?: string | null
          goal_race?: string | null
          goal_time?: string | null
          id?: string
          is_active?: boolean | null
          peak_weekly_km?: number | null
          philosophy?: string | null
          plan_name?: string | null
          race_date?: string | null
          race_type?: string | null
          season_id?: string | null
          start_date?: string | null
          target_time?: string | null
          total_weeks?: number | null
          updated_at?: string
          user_id?: string
          weeks_total?: number | null
        }
        Relationships: []
      }
      training_plan_workout: {
        Row: {
          actual_avg_hr: number | null
          actual_distance_km: number | null
          coach_note: string | null
          completed: boolean | null
          completed_activity_id: string | null
          created_at: string | null
          date: string | null
          day_of_week: number | null
          description: string | null
          distance_km: number | null
          duration_minutes: number | null
          id: string
          is_double_run: boolean | null
          key_focus: string | null
          name: string | null
          notes: string | null
          original_workout: Json | null
          phase: string | null
          plan_id: string
          session_library_id: string | null
          session_id: string | null
          session_structure: Json | null
          structure_detail: string | null
          control_tool: string | null
          target_hr_zone: number | null
          target_pace: string | null
          target_pace_per_km: string | null
          tls_adjusted: boolean | null
          tls_adjustment_reason: string | null
          tss_estimate: number | null
          type: string | null
          user_id: string
          week_number: number | null
          workout_steps: Json | null
        }
        Insert: {
          actual_avg_hr?: number | null
          actual_distance_km?: number | null
          coach_note?: string | null
          completed?: boolean | null
          completed_activity_id?: string | null
          created_at?: string | null
          date?: string | null
          day_of_week?: number | null
          description?: string | null
          distance_km?: number | null
          duration_minutes?: number | null
          id?: string
          is_double_run?: boolean | null
          key_focus?: string | null
          name?: string | null
          notes?: string | null
          original_workout?: Json | null
          phase?: string | null
          plan_id: string
          session_library_id?: string | null
          session_id?: string | null
          session_structure?: Json | null
          structure_detail?: string | null
          control_tool?: string | null
          target_hr_zone?: number | null
          target_pace?: string | null
          target_pace_per_km?: string | null
          tls_adjusted?: boolean | null
          tls_adjustment_reason?: string | null
          tss_estimate?: number | null
          type?: string | null
          user_id: string
          week_number?: number | null
          workout_steps?: Json | null
        }
        Update: {
          actual_avg_hr?: number | null
          actual_distance_km?: number | null
          coach_note?: string | null
          completed?: boolean | null
          completed_activity_id?: string | null
          created_at?: string | null
          date?: string | null
          day_of_week?: number | null
          description?: string | null
          distance_km?: number | null
          duration_minutes?: number | null
          id?: string
          is_double_run?: boolean | null
          key_focus?: string | null
          name?: string | null
          notes?: string | null
          original_workout?: Json | null
          phase?: string | null
          plan_id?: string
          session_library_id?: string | null
          session_id?: string | null
          session_structure?: Json | null
          structure_detail?: string | null
          control_tool?: string | null
          target_hr_zone?: number | null
          target_pace?: string | null
          target_pace_per_km?: string | null
          tls_adjusted?: boolean | null
          tls_adjustment_reason?: string | null
          tss_estimate?: number | null
          type?: string | null
          user_id?: string
          week_number?: number | null
          workout_steps?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "training_plan_workout_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "training_plan"
            referencedColumns: ["id"]
          },
        ]
      }
      week_proposals: {
        Row: {
          id: string
          user_id: string
          status: string
          week_start_date: string
          sessions_json: Json
          week_summary_json: Json
          coach_message: string
          generated_at: string
          responded_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          status?: string
          week_start_date: string
          sessions_json: Json
          week_summary_json: Json
          coach_message: string
          generated_at?: string
          responded_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          status?: string
          week_start_date?: string
          sessions_json?: Json
          week_summary_json?: Json
          coach_message?: string
          generated_at?: string
          responded_at?: string | null
        }
        Relationships: []
      }
      training_session: {
        Row: {
          completed_activity_id: string | null
          completed_at: string | null
          created_at: string
          day_of_week: number
          description: string
          distance_km: number | null
          duration_min: number | null
          id: string
          notes: string | null
          order_index: number
          pace_target: string | null
          scheduled_date: string | null
          session_type: string
          target_hr_zone: number | null
          tss_estimate: number | null
          updated_at: string
          week_id: string
          workout_type: string | null
        }
        Insert: {
          completed_activity_id?: string | null
          completed_at?: string | null
          created_at?: string
          day_of_week: number
          description: string
          distance_km?: number | null
          duration_min?: number | null
          id?: string
          notes?: string | null
          order_index?: number
          pace_target?: string | null
          scheduled_date?: string | null
          session_type: string
          target_hr_zone?: number | null
          tss_estimate?: number | null
          updated_at?: string
          week_id: string
          workout_type?: string | null
        }
        Update: {
          completed_activity_id?: string | null
          completed_at?: string | null
          created_at?: string
          day_of_week?: number
          description?: string
          distance_km?: number | null
          duration_min?: number | null
          id?: string
          notes?: string | null
          order_index?: number
          pace_target?: string | null
          scheduled_date?: string | null
          session_type?: string
          target_hr_zone?: number | null
          tss_estimate?: number | null
          updated_at?: string
          week_id?: string
          workout_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "training_session_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "training_week"
            referencedColumns: ["id"]
          },
        ]
      }
      training_week: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          plan_id: string
          start_date: string
          week_number: number
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          plan_id: string
          start_date: string
          week_number: number
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          plan_id?: string
          start_date?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "training_week_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "training_plan"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      oauth_connections: {
        Row: {
          athlete_id: string | null
          athlete_name: string | null
          created_at: string | null
          expires_at: string | null
          id: string | null
          last_sync_at: string | null
          provider: Database["public"]["Enums"]["oauth_provider"] | null
          user_id: string | null
        }
        Insert: {
          athlete_id?: string | null
          athlete_name?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string | null
          last_sync_at?: string | null
          provider?: Database["public"]["Enums"]["oauth_provider"] | null
          user_id?: string | null
        }
        Update: {
          athlete_id?: string | null
          athlete_name?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string | null
          last_sync_at?: string | null
          provider?: Database["public"]["Enums"]["oauth_provider"] | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      increment_ai_usage: {
        Args: { p_date: string; p_user_id: string }
        Returns: undefined
      }
      is_friend: {
        Args: { uid1: string; uid2: string }
        Returns: boolean
      }
    }
    Enums: {
      activity_source: "garmin" | "strava" | "manual" | "intervals_icu"
      coach_role: "user" | "coach"
      coach_trigger: "user" | "proactive" | "activity_sync" | "readiness"
      oauth_provider: "garmin" | "strava"
      training_philosophy: "jack_daniels" | "pfitzinger" | "hansons" | "ai"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_source: ["garmin", "strava", "manual", "intervals_icu"],
      coach_role: ["user", "coach"],
      coach_trigger: ["user", "proactive", "activity_sync", "readiness"],
      oauth_provider: ["garmin", "strava"],
      training_philosophy: ["jack_daniels", "pfitzinger", "hansons", "ai"],
    },
  },
} as const
