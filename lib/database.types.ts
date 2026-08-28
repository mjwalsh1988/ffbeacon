export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      article_players: {
        Row: {
          article_id: string;
          player_id: string;
        };
        Insert: {
          article_id: string;
          player_id: string;
        };
        Update: {
          article_id?: string;
          player_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "article_players_article_id_fkey";
            columns: ["article_id"];
            isOneToOne: false;
            referencedRelation: "articles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "article_players_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      article_revisions: {
        Row: {
          article_id: string;
          category_id: string | null;
          change_summary: string | null;
          content_md: string | null;
          created_at: string;
          id: string;
          revision_number: number;
          source_ingestion_id: string | null;
          tags: string[] | null;
          title: string | null;
        };
        Insert: {
          article_id: string;
          category_id?: string | null;
          change_summary?: string | null;
          content_md?: string | null;
          created_at?: string;
          id?: string;
          revision_number: number;
          source_ingestion_id?: string | null;
          tags?: string[] | null;
          title?: string | null;
        };
        Update: {
          article_id?: string;
          category_id?: string | null;
          change_summary?: string | null;
          content_md?: string | null;
          created_at?: string;
          id?: string;
          revision_number?: number;
          source_ingestion_id?: string | null;
          tags?: string[] | null;
          title?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "article_revisions_article_id_fkey";
            columns: ["article_id"];
            isOneToOne: false;
            referencedRelation: "articles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "article_revisions_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "news_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "article_revisions_source_ingestion_id_fkey";
            columns: ["source_ingestion_id"];
            isOneToOne: false;
            referencedRelation: "news_ingestions";
            referencedColumns: ["id"];
          },
        ];
      };
      article_teams: {
        Row: {
          article_id: string;
          team_id: string;
        };
        Insert: {
          article_id: string;
          team_id: string;
        };
        Update: {
          article_id?: string;
          team_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "article_teams_article_id_fkey";
            columns: ["article_id"];
            isOneToOne: false;
            referencedRelation: "articles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "article_teams_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "nfl_teams";
            referencedColumns: ["id"];
          },
        ];
      };
      articles: {
        Row: {
          article_type: string;
          author_id: string | null;
          canonical_url: string | null;
          category_id: string | null;
          content_md: string | null;
          created_at: string;
          event_key: string | null;
          format_config_id: string | null;
          id: string;
          last_updated: string;
          meta_description: string | null;
          metadata: Json;
          origin: string;
          published_at: string | null;
          schema_jsonld: Json | null;
          season: number | null;
          slug: string;
          status: string;
          tags: string[];
          title: string;
          tl_dr: string | null;
          view_count: number;
          week: number | null;
        };
        Insert: {
          article_type: string;
          author_id?: string | null;
          canonical_url?: string | null;
          category_id?: string | null;
          content_md?: string | null;
          created_at?: string;
          event_key?: string | null;
          format_config_id?: string | null;
          id?: string;
          last_updated?: string;
          meta_description?: string | null;
          metadata?: Json;
          origin?: string;
          published_at?: string | null;
          schema_jsonld?: Json | null;
          season?: number | null;
          slug: string;
          status?: string;
          tags?: string[];
          title: string;
          tl_dr?: string | null;
          view_count?: number;
          week?: number | null;
        };
        Update: {
          article_type?: string;
          author_id?: string | null;
          canonical_url?: string | null;
          category_id?: string | null;
          content_md?: string | null;
          created_at?: string;
          event_key?: string | null;
          format_config_id?: string | null;
          id?: string;
          last_updated?: string;
          meta_description?: string | null;
          metadata?: Json;
          origin?: string;
          published_at?: string | null;
          schema_jsonld?: Json | null;
          season?: number | null;
          slug?: string;
          status?: string;
          tags?: string[];
          title?: string;
          tl_dr?: string | null;
          view_count?: number;
          week?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "articles_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "news_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "articles_format_config_id_fkey";
            columns: ["format_config_id"];
            isOneToOne: false;
            referencedRelation: "format_configs";
            referencedColumns: ["id"];
          },
        ];
      };
      beacon_ai_cache: {
        Row: {
          adjustment_pct: number;
          confidence: number;
          created_at: string;
          input_hash: string;
          model: string;
          player_id: string | null;
          rationale: string | null;
        };
        Insert: {
          adjustment_pct: number;
          confidence: number;
          created_at?: string;
          input_hash: string;
          model: string;
          player_id?: string | null;
          rationale?: string | null;
        };
        Update: {
          adjustment_pct?: number;
          confidence?: number;
          created_at?: string;
          input_hash?: string;
          model?: string;
          player_id?: string | null;
          rationale?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "beacon_ai_cache_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      beacon_brief_health: {
        Row: {
          component: string;
          consecutive_failures: number;
          error_detail: string | null;
          error_kind: string | null;
          failing_since: string | null;
          http_status: number | null;
          last_alert_at: string | null;
          last_probe_at: string | null;
          last_success_at: string | null;
          status: string;
          suppressed_alerts: number;
          updated_at: string;
        };
        Insert: {
          component: string;
          consecutive_failures?: number;
          error_detail?: string | null;
          error_kind?: string | null;
          failing_since?: string | null;
          http_status?: number | null;
          last_alert_at?: string | null;
          last_probe_at?: string | null;
          last_success_at?: string | null;
          status?: string;
          suppressed_alerts?: number;
          updated_at?: string;
        };
        Update: {
          component?: string;
          consecutive_failures?: number;
          error_detail?: string | null;
          error_kind?: string | null;
          failing_since?: string | null;
          http_status?: number | null;
          last_alert_at?: string | null;
          last_probe_at?: string | null;
          last_success_at?: string | null;
          status?: string;
          suppressed_alerts?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      beacon_brief_logs: {
        Row: {
          created_at: string;
          duration_ms: number | null;
          id: string;
          ingestion_id: string | null;
          level: string;
          message: string | null;
          model: string | null;
          request_payload: Json | null;
          response_payload: Json | null;
          source_id: string | null;
          stage: string;
          token_usage: Json | null;
        };
        Insert: {
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          ingestion_id?: string | null;
          level?: string;
          message?: string | null;
          model?: string | null;
          request_payload?: Json | null;
          response_payload?: Json | null;
          source_id?: string | null;
          stage: string;
          token_usage?: Json | null;
        };
        Update: {
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          ingestion_id?: string | null;
          level?: string;
          message?: string | null;
          model?: string | null;
          request_payload?: Json | null;
          response_payload?: Json | null;
          source_id?: string | null;
          stage?: string;
          token_usage?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "beacon_brief_logs_ingestion_id_fkey";
            columns: ["ingestion_id"];
            isOneToOne: false;
            referencedRelation: "news_ingestions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "beacon_brief_logs_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "news_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      beacon_brief_moderation: {
        Row: {
          article_id: string | null;
          candidates: Json;
          created_at: string;
          detail: Json;
          id: string;
          ingestion_id: string | null;
          queue_job_id: string | null;
          raw_name: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          status: string;
          type: string;
        };
        Insert: {
          article_id?: string | null;
          candidates?: Json;
          created_at?: string;
          detail?: Json;
          id?: string;
          ingestion_id?: string | null;
          queue_job_id?: string | null;
          raw_name?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
          type?: string;
        };
        Update: {
          article_id?: string | null;
          candidates?: Json;
          created_at?: string;
          detail?: Json;
          id?: string;
          ingestion_id?: string | null;
          queue_job_id?: string | null;
          raw_name?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "beacon_brief_moderation_article_id_fkey";
            columns: ["article_id"];
            isOneToOne: false;
            referencedRelation: "articles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "beacon_brief_moderation_ingestion_id_fkey";
            columns: ["ingestion_id"];
            isOneToOne: false;
            referencedRelation: "news_ingestions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "beacon_brief_moderation_queue_job_id_fkey";
            columns: ["queue_job_id"];
            isOneToOne: false;
            referencedRelation: "beacon_brief_queue";
            referencedColumns: ["id"];
          },
        ];
      };
      beacon_brief_queue: {
        Row: {
          attempts: number;
          created_at: string;
          id: string;
          job_type: string;
          last_error: string | null;
          payload: Json;
          run_after: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          id?: string;
          job_type: string;
          last_error?: string | null;
          payload?: Json;
          run_after?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          id?: string;
          job_type?: string;
          last_error?: string | null;
          payload?: Json;
          run_after?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      beacon_custom_formats: {
        Row: {
          created_at: string;
          created_by: string;
          descriptor: Json;
          descriptor_hash: string;
          id: string;
          label: string | null;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          descriptor: Json;
          descriptor_hash: string;
          id?: string;
          label?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          descriptor?: Json;
          descriptor_hash?: string;
          id?: string;
          label?: string | null;
        };
        Relationships: [];
      };
      beacon_custom_value_cache: {
        Row: {
          computed_at: string;
          descriptor_hash: string;
          payload: Json;
          run_id: string;
          source_slug: string;
        };
        Insert: {
          computed_at?: string;
          descriptor_hash: string;
          payload: Json;
          run_id: string;
          source_slug: string;
        };
        Update: {
          computed_at?: string;
          descriptor_hash?: string;
          payload?: Json;
          run_id?: string;
          source_slug?: string;
        };
        Relationships: [];
      };
      beacon_format_status: {
        Row: {
          baseline_format_config_id: string | null;
          format_config_id: string;
          is_placeholder: boolean;
          note: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          baseline_format_config_id?: string | null;
          format_config_id: string;
          is_placeholder?: boolean;
          note?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          baseline_format_config_id?: string | null;
          format_config_id?: string;
          is_placeholder?: boolean;
          note?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "beacon_format_status_baseline_format_config_id_fkey";
            columns: ["baseline_format_config_id"];
            isOneToOne: false;
            referencedRelation: "format_configs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "beacon_format_status_format_config_id_fkey";
            columns: ["format_config_id"];
            isOneToOne: true;
            referencedRelation: "format_configs";
            referencedColumns: ["id"];
          },
        ];
      };
      beacon_manual_signals: {
        Row: {
          adjustment_type: string;
          created_at: string;
          created_by: string | null;
          decay_days: number | null;
          expires_at: string | null;
          format_config_id: string | null;
          id: string;
          is_active: boolean;
          magnitude: number;
          pick_position: string | null;
          pick_round: number | null;
          pick_season: number | null;
          player_id: string | null;
          reason: string | null;
          silent: boolean;
          target: string;
        };
        Insert: {
          adjustment_type: string;
          created_at?: string;
          created_by?: string | null;
          decay_days?: number | null;
          expires_at?: string | null;
          format_config_id?: string | null;
          id?: string;
          is_active?: boolean;
          magnitude: number;
          pick_position?: string | null;
          pick_round?: number | null;
          pick_season?: number | null;
          player_id?: string | null;
          reason?: string | null;
          silent?: boolean;
          target: string;
        };
        Update: {
          adjustment_type?: string;
          created_at?: string;
          created_by?: string | null;
          decay_days?: number | null;
          expires_at?: string | null;
          format_config_id?: string | null;
          id?: string;
          is_active?: boolean;
          magnitude?: number;
          pick_position?: string | null;
          pick_round?: number | null;
          pick_season?: number | null;
          player_id?: string | null;
          reason?: string | null;
          silent?: boolean;
          target?: string;
        };
        Relationships: [
          {
            foreignKeyName: "beacon_manual_signals_format_config_id_fkey";
            columns: ["format_config_id"];
            isOneToOne: false;
            referencedRelation: "format_configs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "beacon_manual_signals_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      beacon_reference_versions: {
        Row: {
          activated_at: string | null;
          created_by: string | null;
          diagnostics: Json;
          expected_sources: string[];
          format_config_id: string;
          generated_at: string;
          id: string;
          notes: string | null;
          shared_player_count: number;
          status: string;
          superseded_at: string | null;
          version: number;
        };
        Insert: {
          activated_at?: string | null;
          created_by?: string | null;
          diagnostics?: Json;
          expected_sources?: string[];
          format_config_id: string;
          generated_at?: string;
          id?: string;
          notes?: string | null;
          shared_player_count: number;
          status?: string;
          superseded_at?: string | null;
          version: number;
        };
        Update: {
          activated_at?: string | null;
          created_by?: string | null;
          diagnostics?: Json;
          expected_sources?: string[];
          format_config_id?: string;
          generated_at?: string;
          id?: string;
          notes?: string | null;
          shared_player_count?: number;
          status?: string;
          superseded_at?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "beacon_reference_versions_format_config_id_fkey";
            columns: ["format_config_id"];
            isOneToOne: false;
            referencedRelation: "format_configs";
            referencedColumns: ["id"];
          },
        ];
      };
      beacon_settings: {
        Row: {
          category: string;
          description: string | null;
          key: string;
          label: string;
          updated_at: string;
          updated_by: string | null;
          value: Json;
          value_type: string;
        };
        Insert: {
          category: string;
          description?: string | null;
          key: string;
          label: string;
          updated_at?: string;
          updated_by?: string | null;
          value: Json;
          value_type: string;
        };
        Update: {
          category?: string;
          description?: string | null;
          key?: string;
          label?: string;
          updated_at?: string;
          updated_by?: string | null;
          value?: Json;
          value_type?: string;
        };
        Relationships: [];
      };
      beacon_signal_weights: {
        Row: {
          confidence_cap: number;
          id: string;
          is_enabled: boolean;
          params: Json;
          signal_type: string;
          source_slug: string | null;
          updated_at: string;
          updated_by: string | null;
          weight: number;
        };
        Insert: {
          confidence_cap?: number;
          id?: string;
          is_enabled?: boolean;
          params?: Json;
          signal_type: string;
          source_slug?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          weight?: number;
        };
        Update: {
          confidence_cap?: number;
          id?: string;
          is_enabled?: boolean;
          params?: Json;
          signal_type?: string;
          source_slug?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          weight?: number;
        };
        Relationships: [];
      };
      beacon_stat_profiles: {
        Row: {
          components: Json;
          games: number | null;
          player_id: string;
          recency: Json | null;
          updated_at: string;
        };
        Insert: {
          components?: Json;
          games?: number | null;
          player_id: string;
          recency?: Json | null;
          updated_at?: string;
        };
        Update: {
          components?: Json;
          games?: number | null;
          player_id?: string;
          recency?: Json | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "beacon_stat_profiles_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: true;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      beacon_value_bands: {
        Row: {
          ceiling: number;
          floor: number;
          format_config_id: string | null;
          id: string;
          position: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          ceiling: number;
          floor: number;
          format_config_id?: string | null;
          id?: string;
          position: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          ceiling?: number;
          floor?: number;
          format_config_id?: string | null;
          id?: string;
          position?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "beacon_value_bands_format_config_id_fkey";
            columns: ["format_config_id"];
            isOneToOne: false;
            referencedRelation: "format_configs";
            referencedColumns: ["id"];
          },
        ];
      };
      beacon_value_references: {
        Row: {
          player_id: string;
          reference_scaled: number;
          version_id: string;
        };
        Insert: {
          player_id: string;
          reference_scaled: number;
          version_id: string;
        };
        Update: {
          player_id?: string;
          reference_scaled?: number;
          version_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "beacon_value_references_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "beacon_value_references_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "beacon_reference_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      beacon_value_runs: {
        Row: {
          ai_calls: number | null;
          error: string | null;
          factor_saturated: number | null;
          finished_at: string | null;
          id: string;
          notes: string | null;
          players_processed: number | null;
          rows_written: number | null;
          skipped_no_signal: number | null;
          source_freshness: Json | null;
          started_at: string;
          status: string;
          weights_snapshot: Json | null;
        };
        Insert: {
          ai_calls?: number | null;
          error?: string | null;
          factor_saturated?: number | null;
          finished_at?: string | null;
          id?: string;
          notes?: string | null;
          players_processed?: number | null;
          rows_written?: number | null;
          skipped_no_signal?: number | null;
          source_freshness?: Json | null;
          started_at?: string;
          status?: string;
          weights_snapshot?: Json | null;
        };
        Update: {
          ai_calls?: number | null;
          error?: string | null;
          factor_saturated?: number | null;
          finished_at?: string | null;
          id?: string;
          notes?: string | null;
          players_processed?: number | null;
          rows_written?: number | null;
          skipped_no_signal?: number | null;
          source_freshness?: Json | null;
          started_at?: string;
          status?: string;
          weights_snapshot?: Json | null;
        };
        Relationships: [];
      };
      beam_learning_requests: {
        Row: {
          admin_note: string | null;
          created_at: string;
          email: string | null;
          id: string;
          ip_hash: string | null;
          message: string | null;
          name: string;
          query_id: string | null;
          question: string;
          resolved_at: string | null;
          status: string;
          submitted_user_id: string | null;
          updated_at: string;
        };
        Insert: {
          admin_note?: string | null;
          created_at?: string;
          email?: string | null;
          id?: string;
          ip_hash?: string | null;
          message?: string | null;
          name: string;
          query_id?: string | null;
          question: string;
          resolved_at?: string | null;
          status?: string;
          submitted_user_id?: string | null;
          updated_at?: string;
        };
        Update: {
          admin_note?: string | null;
          created_at?: string;
          email?: string | null;
          id?: string;
          ip_hash?: string | null;
          message?: string | null;
          name?: string;
          query_id?: string | null;
          question?: string;
          resolved_at?: string | null;
          status?: string;
          submitted_user_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "beam_learning_requests_query_id_fkey";
            columns: ["query_id"];
            isOneToOne: false;
            referencedRelation: "beam_queries";
            referencedColumns: ["id"];
          },
        ];
      };
      beam_player_aliases: {
        Row: {
          alias: string;
          alias_kind: string;
          created_at: string;
          id: string;
          is_active: boolean;
          note: string | null;
          player_id: string;
          source: string;
          updated_at: string;
        };
        Insert: {
          alias: string;
          alias_kind?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          note?: string | null;
          player_id: string;
          source?: string;
          updated_at?: string;
        };
        Update: {
          alias?: string;
          alias_kind?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          note?: string | null;
          player_id?: string;
          source?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "beam_player_aliases_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      beam_queries: {
        Row: {
          actor_hash: string | null;
          capability_id: string | null;
          confidence: number | null;
          created_at: string;
          failure_reason: string | null;
          format_slug: string | null;
          id: string;
          latency_ms: number | null;
          outcome: string;
          player_ids: string[] | null;
          question: string;
          question_normalized: string;
          source_slug: string | null;
          user_id: string | null;
        };
        Insert: {
          actor_hash?: string | null;
          capability_id?: string | null;
          confidence?: number | null;
          created_at?: string;
          failure_reason?: string | null;
          format_slug?: string | null;
          id?: string;
          latency_ms?: number | null;
          outcome: string;
          player_ids?: string[] | null;
          question: string;
          question_normalized: string;
          source_slug?: string | null;
          user_id?: string | null;
        };
        Update: {
          actor_hash?: string | null;
          capability_id?: string | null;
          confidence?: number | null;
          created_at?: string;
          failure_reason?: string | null;
          format_slug?: string | null;
          id?: string;
          latency_ms?: number | null;
          outcome?: string;
          player_ids?: string[] | null;
          question?: string;
          question_normalized?: string;
          source_slug?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      beam_settings: {
        Row: {
          id: string;
          settings: Json;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id: string;
          settings?: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          id?: string;
          settings?: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      cron_runs: {
        Row: {
          created_at: string;
          duration_ms: number | null;
          error: string | null;
          finished_at: string | null;
          id: string;
          job_name: string;
          result: Json | null;
          started_at: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          duration_ms?: number | null;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          job_name: string;
          result?: Json | null;
          started_at?: string;
          status: string;
        };
        Update: {
          created_at?: string;
          duration_ms?: number | null;
          error?: string | null;
          finished_at?: string | null;
          id?: string;
          job_name?: string;
          result?: Json | null;
          started_at?: string;
          status?: string;
        };
        Relationships: [];
      };
      discord_webhooks: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          is_active: boolean;
          label: string;
          updated_at: string;
          url: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_active?: boolean;
          label: string;
          updated_at?: string;
          url: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_active?: boolean;
          label?: string;
          updated_at?: string;
          url?: string;
        };
        Relationships: [];
      };
      draft_market_adp: {
        Row: {
          adp: number;
          adp_median: number;
          computed_at: string;
          draft_rate: number;
          drafts_sampled: number;
          earliest_pick: number;
          format_slug: string;
          latest_pick: number;
          pick_stdev: number | null;
          picks_sampled: number;
          player_id: string;
          player_pool: string;
          season: number;
        };
        Insert: {
          adp: number;
          adp_median: number;
          computed_at?: string;
          draft_rate: number;
          drafts_sampled: number;
          earliest_pick: number;
          format_slug: string;
          latest_pick: number;
          pick_stdev?: number | null;
          picks_sampled: number;
          player_id: string;
          player_pool: string;
          season: number;
        };
        Update: {
          adp?: number;
          adp_median?: number;
          computed_at?: string;
          draft_rate?: number;
          drafts_sampled?: number;
          earliest_pick?: number;
          format_slug?: string;
          latest_pick?: number;
          pick_stdev?: number | null;
          picks_sampled?: number;
          player_id?: string;
          player_pool?: string;
          season?: number;
        };
        Relationships: [
          {
            foreignKeyName: "draft_market_adp_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      draft_pick_values: {
        Row: {
          captured_at: string;
          created_at: string;
          format_config_id: string;
          id: string;
          metadata: Json;
          pick_position: string;
          round: number;
          season: number;
          source: string;
          value: number;
        };
        Insert: {
          captured_at?: string;
          created_at?: string;
          format_config_id: string;
          id?: string;
          metadata?: Json;
          pick_position: string;
          round: number;
          season: number;
          source: string;
          value: number;
        };
        Update: {
          captured_at?: string;
          created_at?: string;
          format_config_id?: string;
          id?: string;
          metadata?: Json;
          pick_position?: string;
          round?: number;
          season?: number;
          source?: string;
          value?: number;
        };
        Relationships: [
          {
            foreignKeyName: "draft_pick_values_format_config_id_fkey";
            columns: ["format_config_id"];
            isOneToOne: false;
            referencedRelation: "format_configs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "draft_pick_values_source_fkey";
            columns: ["source"];
            isOneToOne: false;
            referencedRelation: "source_registry";
            referencedColumns: ["slug"];
          },
        ];
      };
      draft_selections: {
        Row: {
          created_at: string;
          draft_slot: number | null;
          draft_status: string | null;
          draft_type: string | null;
          drafted_at: string | null;
          format_slug: string | null;
          id: string;
          ingest_source: string;
          is_keeper: boolean;
          metadata: Json;
          pick_no: number;
          picked_by: string | null;
          player_id: string | null;
          player_pool: string | null;
          roster_id: number | null;
          round: number | null;
          rounds: number | null;
          season: number;
          sleeper_draft_id: string;
          sleeper_league_id: string | null;
          sleeper_player_id: string | null;
          teams: number | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          draft_slot?: number | null;
          draft_status?: string | null;
          draft_type?: string | null;
          drafted_at?: string | null;
          format_slug?: string | null;
          id?: string;
          ingest_source: string;
          is_keeper?: boolean;
          metadata?: Json;
          pick_no: number;
          picked_by?: string | null;
          player_id?: string | null;
          player_pool?: string | null;
          roster_id?: number | null;
          round?: number | null;
          rounds?: number | null;
          season: number;
          sleeper_draft_id: string;
          sleeper_league_id?: string | null;
          sleeper_player_id?: string | null;
          teams?: number | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          draft_slot?: number | null;
          draft_status?: string | null;
          draft_type?: string | null;
          drafted_at?: string | null;
          format_slug?: string | null;
          id?: string;
          ingest_source?: string;
          is_keeper?: boolean;
          metadata?: Json;
          pick_no?: number;
          picked_by?: string | null;
          player_id?: string | null;
          player_pool?: string | null;
          roster_id?: number | null;
          round?: number | null;
          rounds?: number | null;
          season?: number;
          sleeper_draft_id?: string;
          sleeper_league_id?: string | null;
          sleeper_player_id?: string | null;
          teams?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "draft_selections_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      draft_value_settings: {
        Row: {
          id: string;
          settings: Json;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id: string;
          settings?: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          id?: string;
          settings?: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      draft_value_targets: {
        Row: {
          availability: number | null;
          beacon_pick: number | null;
          beacon_rank: number | null;
          beacon_value: number | null;
          beat_rate: number | null;
          category: string;
          computed_at: string;
          confidence: number | null;
          format_slug: string;
          market_adp: number | null;
          market_adp_key: string | null;
          market_source: string | null;
          model_version: string;
          player_id: string;
          points_above_replacement: number | null;
          position: string | null;
          position_adjusted_gap: number | null;
          position_rank: number | null;
          projected_points: number | null;
          room_adp: number | null;
          room_drafts_sampled: number | null;
          season: number;
          steal_score: number | null;
          value_gap: number | null;
          verdict: string;
        };
        Insert: {
          availability?: number | null;
          beacon_pick?: number | null;
          beacon_rank?: number | null;
          beacon_value?: number | null;
          beat_rate?: number | null;
          category: string;
          computed_at?: string;
          confidence?: number | null;
          format_slug: string;
          market_adp?: number | null;
          market_adp_key?: string | null;
          market_source?: string | null;
          model_version: string;
          player_id: string;
          points_above_replacement?: number | null;
          position?: string | null;
          position_adjusted_gap?: number | null;
          position_rank?: number | null;
          projected_points?: number | null;
          room_adp?: number | null;
          room_drafts_sampled?: number | null;
          season: number;
          steal_score?: number | null;
          value_gap?: number | null;
          verdict: string;
        };
        Update: {
          availability?: number | null;
          beacon_pick?: number | null;
          beacon_rank?: number | null;
          beacon_value?: number | null;
          beat_rate?: number | null;
          category?: string;
          computed_at?: string;
          confidence?: number | null;
          format_slug?: string;
          market_adp?: number | null;
          market_adp_key?: string | null;
          market_source?: string | null;
          model_version?: string;
          player_id?: string;
          points_above_replacement?: number | null;
          position?: string | null;
          position_adjusted_gap?: number | null;
          position_rank?: number | null;
          projected_points?: number | null;
          room_adp?: number | null;
          room_drafts_sampled?: number | null;
          season?: number;
          steal_score?: number | null;
          value_gap?: number | null;
          verdict?: string;
        };
        Relationships: [
          {
            foreignKeyName: "draft_value_targets_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      faab_calculator_settings: {
        Row: {
          created_at: string;
          id: string;
          settings: Json;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          settings: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          settings?: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      format_configs: {
        Row: {
          created_at: string;
          display_name: string;
          display_order: number | null;
          id: string;
          is_active: boolean;
          is_bestball: boolean;
          is_default: boolean;
          is_superflex: boolean;
          league_type: string;
          scoring_type: string;
          slug: string;
          te_premium_bonus: number;
        };
        Insert: {
          created_at?: string;
          display_name: string;
          display_order?: number | null;
          id?: string;
          is_active?: boolean;
          is_bestball?: boolean;
          is_default?: boolean;
          is_superflex?: boolean;
          league_type: string;
          scoring_type: string;
          slug: string;
          te_premium_bonus?: number;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          display_order?: number | null;
          id?: string;
          is_active?: boolean;
          is_bestball?: boolean;
          is_default?: boolean;
          is_superflex?: boolean;
          league_type?: string;
          scoring_type?: string;
          slug?: string;
          te_premium_bonus?: number;
        };
        Relationships: [];
      };
      guide_entries: {
        Row: {
          body: string;
          created_at: string;
          display_order: number;
          heading: string;
          id: string;
          is_global: boolean;
          is_published: boolean;
          kind: string;
          page_id: string;
          updated_at: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          display_order?: number;
          heading: string;
          id?: string;
          is_global?: boolean;
          is_published?: boolean;
          kind: string;
          page_id: string;
          updated_at?: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          display_order?: number;
          heading?: string;
          id?: string;
          is_global?: boolean;
          is_published?: boolean;
          kind?: string;
          page_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "guide_entries_page_id_fkey";
            columns: ["page_id"];
            isOneToOne: false;
            referencedRelation: "guide_pages";
            referencedColumns: ["id"];
          },
        ];
      };
      guide_pages: {
        Row: {
          created_at: string;
          description: string | null;
          display_order: number;
          id: string;
          page_key: string;
          route_example: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          display_order?: number;
          id?: string;
          page_key: string;
          route_example?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          display_order?: number;
          id?: string;
          page_key?: string;
          route_example?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      guide_question_submissions: {
        Row: {
          created_at: string;
          email: string | null;
          id: string;
          ip_hash: string | null;
          name: string;
          page_key: string;
          question: string;
          resolved_at: string | null;
          resolved_entry_id: string | null;
          status: string;
          submitted_user_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          id?: string;
          ip_hash?: string | null;
          name: string;
          page_key: string;
          question: string;
          resolved_at?: string | null;
          resolved_entry_id?: string | null;
          status?: string;
          submitted_user_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          id?: string;
          ip_hash?: string | null;
          name?: string;
          page_key?: string;
          question?: string;
          resolved_at?: string | null;
          resolved_entry_id?: string | null;
          status?: string;
          submitted_user_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "guide_question_submissions_resolved_entry_id_fkey";
            columns: ["resolved_entry_id"];
            isOneToOne: false;
            referencedRelation: "guide_entries";
            referencedColumns: ["id"];
          },
        ];
      };
      league_bulk_sync_requests: {
        Row: {
          completed_at: string | null;
          id: string;
          league_count: number;
          requested_at: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          id?: string;
          league_count?: number;
          requested_at?: string;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          id?: string;
          league_count?: number;
          requested_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      league_drafts: {
        Row: {
          created_at: string;
          draft_order: Json | null;
          id: string;
          league_id: string;
          metadata: Json;
          pick_capture_attempts: number;
          picks_captured_at: string | null;
          season: number;
          settings: Json | null;
          sleeper_draft_id: string;
          slot_to_roster_id: Json;
          start_time: string | null;
          status: string | null;
          type: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          draft_order?: Json | null;
          id?: string;
          league_id: string;
          metadata?: Json;
          pick_capture_attempts?: number;
          picks_captured_at?: string | null;
          season: number;
          settings?: Json | null;
          sleeper_draft_id: string;
          slot_to_roster_id?: Json;
          start_time?: string | null;
          status?: string | null;
          type?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          draft_order?: Json | null;
          id?: string;
          league_id?: string;
          metadata?: Json;
          pick_capture_attempts?: number;
          picks_captured_at?: string | null;
          season?: number;
          settings?: Json | null;
          sleeper_draft_id?: string;
          slot_to_roster_id?: Json;
          start_time?: string | null;
          status?: string | null;
          type?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "league_drafts_league_id_fkey";
            columns: ["league_id"];
            isOneToOne: false;
            referencedRelation: "leagues";
            referencedColumns: ["id"];
          },
        ];
      };
      league_matchups: {
        Row: {
          id: string;
          is_final: boolean;
          league_id: string;
          matchup_id: number | null;
          metadata: Json | null;
          player_ids: Json;
          player_points: Json;
          points: number;
          season: number;
          sleeper_roster_id: number;
          starter_ids: Json;
          starter_points: Json;
          synced_at: string;
          week: number;
        };
        Insert: {
          id?: string;
          is_final?: boolean;
          league_id: string;
          matchup_id?: number | null;
          metadata?: Json | null;
          player_ids?: Json;
          player_points?: Json;
          points?: number;
          season: number;
          sleeper_roster_id: number;
          starter_ids?: Json;
          starter_points?: Json;
          synced_at?: string;
          week: number;
        };
        Update: {
          id?: string;
          is_final?: boolean;
          league_id?: string;
          matchup_id?: number | null;
          metadata?: Json | null;
          player_ids?: Json;
          player_points?: Json;
          points?: number;
          season?: number;
          sleeper_roster_id?: number;
          starter_ids?: Json;
          starter_points?: Json;
          synced_at?: string;
          week?: number;
        };
        Relationships: [
          {
            foreignKeyName: "league_matchups_league_id_fkey";
            columns: ["league_id"];
            isOneToOne: false;
            referencedRelation: "leagues";
            referencedColumns: ["id"];
          },
        ];
      };
      league_positional_war_cache: {
        Row: {
          avg_seated_points: number | null;
          cliff_rank: number | null;
          curve: Json;
          deficit: number | null;
          fingerprint: string;
          from_week: number;
          generated_at: string;
          id: string;
          league_id: string;
          model_version: string;
          position: string;
          replacement_points: number | null;
          season: number;
          shallow_pool: boolean;
          structural_demand: number;
          through_week: number;
          war_at_demand: number | null;
          war_rank_1: number | null;
          weekly_diagnostics: Json;
        };
        Insert: {
          avg_seated_points?: number | null;
          cliff_rank?: number | null;
          curve?: Json;
          deficit?: number | null;
          fingerprint: string;
          from_week: number;
          generated_at?: string;
          id?: string;
          league_id: string;
          model_version?: string;
          position: string;
          replacement_points?: number | null;
          season: number;
          shallow_pool?: boolean;
          structural_demand: number;
          through_week: number;
          war_at_demand?: number | null;
          war_rank_1?: number | null;
          weekly_diagnostics?: Json;
        };
        Update: {
          avg_seated_points?: number | null;
          cliff_rank?: number | null;
          curve?: Json;
          deficit?: number | null;
          fingerprint?: string;
          from_week?: number;
          generated_at?: string;
          id?: string;
          league_id?: string;
          model_version?: string;
          position?: string;
          replacement_points?: number | null;
          season?: number;
          shallow_pool?: boolean;
          structural_demand?: number;
          through_week?: number;
          war_at_demand?: number | null;
          war_rank_1?: number | null;
          weekly_diagnostics?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "league_positional_war_cache_league_id_fkey";
            columns: ["league_id"];
            isOneToOne: false;
            referencedRelation: "leagues";
            referencedColumns: ["id"];
          },
        ];
      };
      league_power_pulse_cache: {
        Row: {
          bye_odds: number | null;
          components: Json;
          drivers: Json;
          expected_points_per_week: number | null;
          expected_points_stdev: number | null;
          expected_wins: number | null;
          generated_at: string;
          id: string;
          last_place_odds: number | null;
          league_id: string;
          lineup_efficiency: number | null;
          lineup_efficiency_rank: number | null;
          lineup_points_lost: number | null;
          model_version: string;
          playoff_odds: number | null;
          power_pulse: number;
          projected_losses: number | null;
          projected_ties: number | null;
          projected_wins: number | null;
          pulse_rank: number | null;
          reliability_rank: number | null;
          reliability_score: number | null;
          roster_id: string;
          score_depth: number | null;
          score_depth_rank: number | null;
          score_form: number | null;
          score_form_rank: number | null;
          score_points: number | null;
          score_points_rank: number | null;
          score_schedule: number | null;
          score_schedule_rank: number | null;
          season: number;
          sos_points: number | null;
          sos_rank: number | null;
          through_week: number;
          title_odds: number | null;
          weekly: Json;
        };
        Insert: {
          bye_odds?: number | null;
          components?: Json;
          drivers?: Json;
          expected_points_per_week?: number | null;
          expected_points_stdev?: number | null;
          expected_wins?: number | null;
          generated_at?: string;
          id?: string;
          last_place_odds?: number | null;
          league_id: string;
          lineup_efficiency?: number | null;
          lineup_efficiency_rank?: number | null;
          lineup_points_lost?: number | null;
          model_version?: string;
          playoff_odds?: number | null;
          power_pulse: number;
          projected_losses?: number | null;
          projected_ties?: number | null;
          projected_wins?: number | null;
          pulse_rank?: number | null;
          reliability_rank?: number | null;
          reliability_score?: number | null;
          roster_id: string;
          score_depth?: number | null;
          score_depth_rank?: number | null;
          score_form?: number | null;
          score_form_rank?: number | null;
          score_points?: number | null;
          score_points_rank?: number | null;
          score_schedule?: number | null;
          score_schedule_rank?: number | null;
          season: number;
          sos_points?: number | null;
          sos_rank?: number | null;
          through_week?: number;
          title_odds?: number | null;
          weekly?: Json;
        };
        Update: {
          bye_odds?: number | null;
          components?: Json;
          drivers?: Json;
          expected_points_per_week?: number | null;
          expected_points_stdev?: number | null;
          expected_wins?: number | null;
          generated_at?: string;
          id?: string;
          last_place_odds?: number | null;
          league_id?: string;
          lineup_efficiency?: number | null;
          lineup_efficiency_rank?: number | null;
          lineup_points_lost?: number | null;
          model_version?: string;
          playoff_odds?: number | null;
          power_pulse?: number;
          projected_losses?: number | null;
          projected_ties?: number | null;
          projected_wins?: number | null;
          pulse_rank?: number | null;
          reliability_rank?: number | null;
          reliability_score?: number | null;
          roster_id?: string;
          score_depth?: number | null;
          score_depth_rank?: number | null;
          score_form?: number | null;
          score_form_rank?: number | null;
          score_points?: number | null;
          score_points_rank?: number | null;
          score_schedule?: number | null;
          score_schedule_rank?: number | null;
          season?: number;
          sos_points?: number | null;
          sos_rank?: number | null;
          through_week?: number;
          title_odds?: number | null;
          weekly?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "league_power_pulse_cache_league_id_fkey";
            columns: ["league_id"];
            isOneToOne: false;
            referencedRelation: "leagues";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "league_power_pulse_cache_roster_id_fkey";
            columns: ["roster_id"];
            isOneToOne: false;
            referencedRelation: "rosters";
            referencedColumns: ["id"];
          },
        ];
      };
      league_power_pulse_settings: {
        Row: {
          created_at: string;
          id: string;
          settings: Json;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          settings: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          settings?: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      league_power_rankings_cache: {
        Row: {
          bench_value: number;
          format_config_id: string;
          generated_at: string;
          id: string;
          league_id: string;
          overall_rank: number | null;
          picks_value: number;
          positional_breakdowns: Json;
          roster_id: string;
          source: string;
          starter_rank: number | null;
          starter_value: number;
          total_value: number;
        };
        Insert: {
          bench_value?: number;
          format_config_id: string;
          generated_at?: string;
          id?: string;
          league_id: string;
          overall_rank?: number | null;
          picks_value?: number;
          positional_breakdowns?: Json;
          roster_id: string;
          source: string;
          starter_rank?: number | null;
          starter_value?: number;
          total_value?: number;
        };
        Update: {
          bench_value?: number;
          format_config_id?: string;
          generated_at?: string;
          id?: string;
          league_id?: string;
          overall_rank?: number | null;
          picks_value?: number;
          positional_breakdowns?: Json;
          roster_id?: string;
          source?: string;
          starter_rank?: number | null;
          starter_value?: number;
          total_value?: number;
        };
        Relationships: [
          {
            foreignKeyName: "league_power_rankings_cache_format_config_id_fkey";
            columns: ["format_config_id"];
            isOneToOne: false;
            referencedRelation: "format_configs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "league_power_rankings_cache_league_id_fkey";
            columns: ["league_id"];
            isOneToOne: false;
            referencedRelation: "leagues";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "league_power_rankings_cache_roster_id_fkey";
            columns: ["roster_id"];
            isOneToOne: false;
            referencedRelation: "rosters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "league_power_rankings_cache_source_fkey";
            columns: ["source"];
            isOneToOne: false;
            referencedRelation: "source_registry";
            referencedColumns: ["slug"];
          },
        ];
      };
      league_refresh_attempts: {
        Row: {
          last_attempt_at: string;
          league_id: string;
          triggered_by_user_id: string | null;
          triggered_via: string | null;
        };
        Insert: {
          last_attempt_at?: string;
          league_id: string;
          triggered_by_user_id?: string | null;
          triggered_via?: string | null;
        };
        Update: {
          last_attempt_at?: string;
          league_id?: string;
          triggered_by_user_id?: string | null;
          triggered_via?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "league_refresh_attempts_league_id_fkey";
            columns: ["league_id"];
            isOneToOne: true;
            referencedRelation: "leagues";
            referencedColumns: ["id"];
          },
        ];
      };
      league_sync_attempts: {
        Row: {
          actor_key: string;
          claimed_at: string;
          released_at: string | null;
          sleeper_league_id: string | null;
        };
        Insert: {
          actor_key: string;
          claimed_at?: string;
          released_at?: string | null;
          sleeper_league_id?: string | null;
        };
        Update: {
          actor_key?: string;
          claimed_at?: string;
          released_at?: string | null;
          sleeper_league_id?: string | null;
        };
        Relationships: [];
      };
      league_sync_jobs: {
        Row: {
          attempts: number;
          created_at: string;
          finished_at: string | null;
          id: string;
          last_error: string | null;
          league_name: string | null;
          request_id: string;
          run_after: string;
          sleeper_league_id: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          finished_at?: string | null;
          id?: string;
          last_error?: string | null;
          league_name?: string | null;
          request_id: string;
          run_after?: string;
          sleeper_league_id: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          finished_at?: string | null;
          id?: string;
          last_error?: string | null;
          league_name?: string | null;
          request_id?: string;
          run_after?: string;
          sleeper_league_id?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "league_sync_jobs_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "league_bulk_sync_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      league_transactions: {
        Row: {
          adds: Json;
          created_at: string;
          created_at_sleeper: string | null;
          draft_picks: Json;
          drops: Json;
          id: string;
          league_id: string;
          metadata: Json;
          roster_ids: Json;
          season: number | null;
          sleeper_transaction_id: string;
          status: string | null;
          type: string;
          waiver_budget: Json;
          week: number | null;
        };
        Insert: {
          adds?: Json;
          created_at?: string;
          created_at_sleeper?: string | null;
          draft_picks?: Json;
          drops?: Json;
          id?: string;
          league_id: string;
          metadata?: Json;
          roster_ids?: Json;
          season?: number | null;
          sleeper_transaction_id: string;
          status?: string | null;
          type: string;
          waiver_budget?: Json;
          week?: number | null;
        };
        Update: {
          adds?: Json;
          created_at?: string;
          created_at_sleeper?: string | null;
          draft_picks?: Json;
          drops?: Json;
          id?: string;
          league_id?: string;
          metadata?: Json;
          roster_ids?: Json;
          season?: number | null;
          sleeper_transaction_id?: string;
          status?: string | null;
          type?: string;
          waiver_budget?: Json;
          week?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "league_transactions_league_id_fkey";
            columns: ["league_id"];
            isOneToOne: false;
            referencedRelation: "leagues";
            referencedColumns: ["id"];
          },
        ];
      };
      league_users: {
        Row: {
          avatar: string | null;
          created_at: string;
          display_name: string | null;
          id: string;
          is_commissioner: boolean;
          is_owner: boolean;
          league_id: string;
          metadata: Json;
          sleeper_user_id: string;
          team_name: string | null;
          updated_at: string;
        };
        Insert: {
          avatar?: string | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          is_commissioner?: boolean;
          is_owner?: boolean;
          league_id: string;
          metadata?: Json;
          sleeper_user_id: string;
          team_name?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar?: string | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          is_commissioner?: boolean;
          is_owner?: boolean;
          league_id?: string;
          metadata?: Json;
          sleeper_user_id?: string;
          team_name?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "league_users_league_id_fkey";
            columns: ["league_id"];
            isOneToOne: false;
            referencedRelation: "leagues";
            referencedColumns: ["id"];
          },
        ];
      };
      leagues: {
        Row: {
          created_at: string;
          format_config_id: string | null;
          id: string;
          last_pulsed_at: string | null;
          metadata: Json;
          name: string;
          positional_war_attempted_at: string | null;
          positional_war_detail: string | null;
          positional_war_status: string | null;
          positional_war_succeeded_at: string | null;
          power_pulse_attempted_at: string | null;
          power_pulse_detail: string | null;
          power_pulse_status: string | null;
          power_pulse_succeeded_at: string | null;
          pulse_error: string | null;
          pulse_status: string;
          roster_positions: Json;
          scoring_settings: Json;
          season: number;
          sleeper_league_id: string;
          sport: string;
          status: string | null;
          total_rosters: number | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          format_config_id?: string | null;
          id?: string;
          last_pulsed_at?: string | null;
          metadata?: Json;
          name: string;
          positional_war_attempted_at?: string | null;
          positional_war_detail?: string | null;
          positional_war_status?: string | null;
          positional_war_succeeded_at?: string | null;
          power_pulse_attempted_at?: string | null;
          power_pulse_detail?: string | null;
          power_pulse_status?: string | null;
          power_pulse_succeeded_at?: string | null;
          pulse_error?: string | null;
          pulse_status?: string;
          roster_positions?: Json;
          scoring_settings?: Json;
          season: number;
          sleeper_league_id: string;
          sport?: string;
          status?: string | null;
          total_rosters?: number | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          format_config_id?: string | null;
          id?: string;
          last_pulsed_at?: string | null;
          metadata?: Json;
          name?: string;
          positional_war_attempted_at?: string | null;
          positional_war_detail?: string | null;
          positional_war_status?: string | null;
          positional_war_succeeded_at?: string | null;
          power_pulse_attempted_at?: string | null;
          power_pulse_detail?: string | null;
          power_pulse_status?: string | null;
          power_pulse_succeeded_at?: string | null;
          pulse_error?: string | null;
          pulse_status?: string;
          roster_positions?: Json;
          scoring_settings?: Json;
          season?: number;
          sleeper_league_id?: string;
          sport?: string;
          status?: string | null;
          total_rosters?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leagues_format_config_id_fkey";
            columns: ["format_config_id"];
            isOneToOne: false;
            referencedRelation: "format_configs";
            referencedColumns: ["id"];
          },
        ];
      };
      news_categories: {
        Row: {
          created_at: string;
          description: string | null;
          discord_role_ids: string[];
          display_order: number;
          id: string;
          is_active: boolean;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          discord_role_ids?: string[];
          display_order?: number;
          id?: string;
          is_active?: boolean;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          discord_role_ids?: string[];
          display_order?: number;
          id?: string;
          is_active?: boolean;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      news_ingestions: {
        Row: {
          ai_result: Json | null;
          article_id: string | null;
          author_handle: string | null;
          context_score: number | null;
          created_at: string;
          deletion_checked_at: string | null;
          discord_message_id: string | null;
          discord_webhook_id: string | null;
          event_key: string | null;
          external_url: string | null;
          filter_detail: Json | null;
          filter_reason: string | null;
          id: string;
          is_revision: boolean;
          media: Json | null;
          metadata: Json;
          processed_at: string | null;
          quoted: Json | null;
          retweeted: Json | null;
          revision_of_ingestion_id: string | null;
          source_external_id: string;
          source_id: string;
          source_type: string;
          status: string;
          text: string | null;
        };
        Insert: {
          ai_result?: Json | null;
          article_id?: string | null;
          author_handle?: string | null;
          context_score?: number | null;
          created_at?: string;
          deletion_checked_at?: string | null;
          discord_message_id?: string | null;
          discord_webhook_id?: string | null;
          event_key?: string | null;
          external_url?: string | null;
          filter_detail?: Json | null;
          filter_reason?: string | null;
          id?: string;
          is_revision?: boolean;
          media?: Json | null;
          metadata?: Json;
          processed_at?: string | null;
          quoted?: Json | null;
          retweeted?: Json | null;
          revision_of_ingestion_id?: string | null;
          source_external_id: string;
          source_id: string;
          source_type?: string;
          status?: string;
          text?: string | null;
        };
        Update: {
          ai_result?: Json | null;
          article_id?: string | null;
          author_handle?: string | null;
          context_score?: number | null;
          created_at?: string;
          deletion_checked_at?: string | null;
          discord_message_id?: string | null;
          discord_webhook_id?: string | null;
          event_key?: string | null;
          external_url?: string | null;
          filter_detail?: Json | null;
          filter_reason?: string | null;
          id?: string;
          is_revision?: boolean;
          media?: Json | null;
          metadata?: Json;
          processed_at?: string | null;
          quoted?: Json | null;
          retweeted?: Json | null;
          revision_of_ingestion_id?: string | null;
          source_external_id?: string;
          source_id?: string;
          source_type?: string;
          status?: string;
          text?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "news_ingestions_article_id_fkey";
            columns: ["article_id"];
            isOneToOne: false;
            referencedRelation: "articles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "news_ingestions_discord_webhook_id_fkey";
            columns: ["discord_webhook_id"];
            isOneToOne: false;
            referencedRelation: "discord_webhooks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "news_ingestions_revision_of_ingestion_id_fkey";
            columns: ["revision_of_ingestion_id"];
            isOneToOne: false;
            referencedRelation: "news_ingestions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "news_ingestions_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "news_sources";
            referencedColumns: ["id"];
          },
        ];
      };
      news_items: {
        Row: {
          ai_summary: string | null;
          body: string | null;
          headline: string;
          id: string;
          impact_score: number | null;
          ingested_at: string;
          metadata: Json | null;
          player_id: string | null;
          published_at: string | null;
          source_name: string | null;
          source_url: string | null;
        };
        Insert: {
          ai_summary?: string | null;
          body?: string | null;
          headline: string;
          id?: string;
          impact_score?: number | null;
          ingested_at?: string;
          metadata?: Json | null;
          player_id?: string | null;
          published_at?: string | null;
          source_name?: string | null;
          source_url?: string | null;
        };
        Update: {
          ai_summary?: string | null;
          body?: string | null;
          headline?: string;
          id?: string;
          impact_score?: number | null;
          ingested_at?: string;
          metadata?: Json | null;
          player_id?: string | null;
          published_at?: string | null;
          source_name?: string | null;
          source_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "news_items_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      news_sources: {
        Row: {
          admin_label: string;
          created_at: string;
          external_account_id: string | null;
          handle: string;
          id: string;
          is_active: boolean;
          last_cursor: string | null;
          last_poll_error: string | null;
          last_poll_status: string | null;
          last_polled_at: string | null;
          metadata: Json;
          source_type: string;
          updated_at: string;
        };
        Insert: {
          admin_label: string;
          created_at?: string;
          external_account_id?: string | null;
          handle: string;
          id?: string;
          is_active?: boolean;
          last_cursor?: string | null;
          last_poll_error?: string | null;
          last_poll_status?: string | null;
          last_polled_at?: string | null;
          metadata?: Json;
          source_type?: string;
          updated_at?: string;
        };
        Update: {
          admin_label?: string;
          created_at?: string;
          external_account_id?: string | null;
          handle?: string;
          id?: string;
          is_active?: boolean;
          last_cursor?: string | null;
          last_poll_error?: string | null;
          last_poll_status?: string | null;
          last_polled_at?: string | null;
          metadata?: Json;
          source_type?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      nfl_defense_vs_position: {
        Row: {
          computed_at: string;
          games_sampled: number;
          generosity_rank: number | null;
          league_average: number;
          multiplier: number;
          points_allowed_per_game: number;
          position: string;
          scoring: string;
          season: number;
          team: string;
        };
        Insert: {
          computed_at?: string;
          games_sampled: number;
          generosity_rank?: number | null;
          league_average: number;
          multiplier: number;
          points_allowed_per_game: number;
          position: string;
          scoring: string;
          season: number;
          team: string;
        };
        Update: {
          computed_at?: string;
          games_sampled?: number;
          generosity_rank?: number | null;
          league_average?: number;
          multiplier?: number;
          points_allowed_per_game?: number;
          position?: string;
          scoring?: string;
          season?: number;
          team?: string;
        };
        Relationships: [];
      };
      nfl_teams: {
        Row: {
          abbreviation: string;
          chant: string;
          conference: string;
          created_at: string;
          discord_role_ids: string[];
          division: string;
          id: string;
          name: string;
          primary_color: string;
          secondary_color: string;
          tertiary_color: string;
        };
        Insert: {
          abbreviation: string;
          chant: string;
          conference: string;
          created_at?: string;
          discord_role_ids?: string[];
          division: string;
          id?: string;
          name: string;
          primary_color: string;
          secondary_color: string;
          tertiary_color: string;
        };
        Update: {
          abbreviation?: string;
          chant?: string;
          conference?: string;
          created_at?: string;
          discord_role_ids?: string[];
          division?: string;
          id?: string;
          name?: string;
          primary_color?: string;
          secondary_color?: string;
          tertiary_color?: string;
        };
        Relationships: [];
      };
      on_the_clock_draft_cache: {
        Row: {
          created_at: string;
          draft_status: string | null;
          draft_type: string | null;
          last_synced_at: string | null;
          league_metadata: Json;
          league_users: Json | null;
          metadata: Json;
          pick_count: number;
          rosters: Json | null;
          season: string;
          sleeper_draft_id: string;
          sleeper_league_id: string;
          sync_locked_until: string | null;
          traded_picks: Json;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          draft_status?: string | null;
          draft_type?: string | null;
          last_synced_at?: string | null;
          league_metadata?: Json;
          league_users?: Json | null;
          metadata?: Json;
          pick_count?: number;
          rosters?: Json | null;
          season: string;
          sleeper_draft_id: string;
          sleeper_league_id: string;
          sync_locked_until?: string | null;
          traded_picks?: Json;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          draft_status?: string | null;
          draft_type?: string | null;
          last_synced_at?: string | null;
          league_metadata?: Json;
          league_users?: Json | null;
          metadata?: Json;
          pick_count?: number;
          rosters?: Json | null;
          season?: string;
          sleeper_draft_id?: string;
          sleeper_league_id?: string;
          sync_locked_until?: string | null;
          traded_picks?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      on_the_clock_draft_snapshots: {
        Row: {
          adp_format_key: string | null;
          adp_snapshot_date: string | null;
          adp_snapshot_source: string | null;
          awards: Json;
          board: Json;
          created_at: string;
          draft: Json;
          draft_completed_at: string | null;
          draft_status: string;
          draft_type: string | null;
          finalized_at: string;
          format_label: string | null;
          format_slug: string | null;
          grades: Json;
          league_name: string | null;
          metadata: Json;
          player_pool: string;
          pulse: Json;
          rounds: number | null;
          season: string;
          sleeper_draft_id: string;
          sleeper_league_id: string;
          snapshot_confidence: string;
          snapshot_version: number;
          teams: number | null;
          transactions: Json;
          updated_at: string;
          value_snapshot_date: string | null;
          value_snapshot_source: string | null;
        };
        Insert: {
          adp_format_key?: string | null;
          adp_snapshot_date?: string | null;
          adp_snapshot_source?: string | null;
          awards?: Json;
          board?: Json;
          created_at?: string;
          draft?: Json;
          draft_completed_at?: string | null;
          draft_status?: string;
          draft_type?: string | null;
          finalized_at?: string;
          format_label?: string | null;
          format_slug?: string | null;
          grades?: Json;
          league_name?: string | null;
          metadata?: Json;
          player_pool?: string;
          pulse?: Json;
          rounds?: number | null;
          season: string;
          sleeper_draft_id: string;
          sleeper_league_id: string;
          snapshot_confidence?: string;
          snapshot_version?: number;
          teams?: number | null;
          transactions?: Json;
          updated_at?: string;
          value_snapshot_date?: string | null;
          value_snapshot_source?: string | null;
        };
        Update: {
          adp_format_key?: string | null;
          adp_snapshot_date?: string | null;
          adp_snapshot_source?: string | null;
          awards?: Json;
          board?: Json;
          created_at?: string;
          draft?: Json;
          draft_completed_at?: string | null;
          draft_status?: string;
          draft_type?: string | null;
          finalized_at?: string;
          format_label?: string | null;
          format_slug?: string | null;
          grades?: Json;
          league_name?: string | null;
          metadata?: Json;
          player_pool?: string;
          pulse?: Json;
          rounds?: number | null;
          season?: string;
          sleeper_draft_id?: string;
          sleeper_league_id?: string;
          snapshot_confidence?: string;
          snapshot_version?: number;
          teams?: number | null;
          transactions?: Json;
          updated_at?: string;
          value_snapshot_date?: string | null;
          value_snapshot_source?: string | null;
        };
        Relationships: [];
      };
      on_the_clock_ip_budget: {
        Row: {
          ip_key: string;
          request_count: number;
          updated_at: string;
          window_started_at: string;
        };
        Insert: {
          ip_key: string;
          request_count?: number;
          updated_at?: string;
          window_started_at?: string;
        };
        Update: {
          ip_key?: string;
          request_count?: number;
          updated_at?: string;
          window_started_at?: string;
        };
        Relationships: [];
      };
      on_the_clock_lookup_attempts: {
        Row: {
          key: string;
          last_attempt_at: string;
        };
        Insert: {
          key: string;
          last_attempt_at?: string;
        };
        Update: {
          key?: string;
          last_attempt_at?: string;
        };
        Relationships: [];
      };
      on_the_clock_pick_cache: {
        Row: {
          created_at: string;
          draft_slot: number | null;
          is_keeper: boolean;
          metadata: Json | null;
          pick_no: number;
          picked_by: string | null;
          player_id: string | null;
          roster_id: number | null;
          round: number | null;
          sleeper_draft_id: string;
          sleeper_player_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          draft_slot?: number | null;
          is_keeper?: boolean;
          metadata?: Json | null;
          pick_no: number;
          picked_by?: string | null;
          player_id?: string | null;
          roster_id?: number | null;
          round?: number | null;
          sleeper_draft_id: string;
          sleeper_player_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          draft_slot?: number | null;
          is_keeper?: boolean;
          metadata?: Json | null;
          pick_no?: number;
          picked_by?: string | null;
          player_id?: string | null;
          roster_id?: number | null;
          round?: number | null;
          sleeper_draft_id?: string;
          sleeper_player_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "on_the_clock_pick_cache_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "on_the_clock_pick_cache_sleeper_draft_id_fkey";
            columns: ["sleeper_draft_id"];
            isOneToOne: false;
            referencedRelation: "on_the_clock_draft_cache";
            referencedColumns: ["sleeper_draft_id"];
          },
        ];
      };
      on_the_clock_pick_snapshots: {
        Row: {
          beacon_rank: number | null;
          beacon_value: number | null;
          created_at: string;
          draft_slot: number | null;
          is_keeper: boolean;
          metadata: Json;
          pick_no: number;
          pick_value_delta: number | null;
          picked_by: string | null;
          player_id: string | null;
          player_name: string | null;
          position: string | null;
          roster_id: number | null;
          round: number | null;
          sleeper_adp: number | null;
          sleeper_draft_id: string;
          sleeper_player_id: string | null;
          team: string | null;
          updated_at: string;
          value_verdict: string | null;
        };
        Insert: {
          beacon_rank?: number | null;
          beacon_value?: number | null;
          created_at?: string;
          draft_slot?: number | null;
          is_keeper?: boolean;
          metadata?: Json;
          pick_no: number;
          pick_value_delta?: number | null;
          picked_by?: string | null;
          player_id?: string | null;
          player_name?: string | null;
          position?: string | null;
          roster_id?: number | null;
          round?: number | null;
          sleeper_adp?: number | null;
          sleeper_draft_id: string;
          sleeper_player_id?: string | null;
          team?: string | null;
          updated_at?: string;
          value_verdict?: string | null;
        };
        Update: {
          beacon_rank?: number | null;
          beacon_value?: number | null;
          created_at?: string;
          draft_slot?: number | null;
          is_keeper?: boolean;
          metadata?: Json;
          pick_no?: number;
          pick_value_delta?: number | null;
          picked_by?: string | null;
          player_id?: string | null;
          player_name?: string | null;
          position?: string | null;
          roster_id?: number | null;
          round?: number | null;
          sleeper_adp?: number | null;
          sleeper_draft_id?: string;
          sleeper_player_id?: string | null;
          team?: string | null;
          updated_at?: string;
          value_verdict?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "on_the_clock_pick_snapshots_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "on_the_clock_pick_snapshots_sleeper_draft_id_fkey";
            columns: ["sleeper_draft_id"];
            isOneToOne: false;
            referencedRelation: "on_the_clock_draft_snapshots";
            referencedColumns: ["sleeper_draft_id"];
          },
        ];
      };
      on_the_clock_projection_cache: {
        Row: {
          computed_at: string;
          from_week: number;
          payload: Json;
          player_count: number;
          scoring_signature: string;
          season: number;
        };
        Insert: {
          computed_at?: string;
          from_week: number;
          payload?: Json;
          player_count?: number;
          scoring_signature: string;
          season: number;
        };
        Update: {
          computed_at?: string;
          from_week?: number;
          payload?: Json;
          player_count?: number;
          scoring_signature?: string;
          season?: number;
        };
        Relationships: [];
      };
      on_the_clock_pulse_cache: {
        Row: {
          computed_at: string;
          model_version: string;
          payload: Json;
          sleeper_draft_id: string;
          through_pick_no: number;
        };
        Insert: {
          computed_at?: string;
          model_version: string;
          payload?: Json;
          sleeper_draft_id: string;
          through_pick_no?: number;
        };
        Update: {
          computed_at?: string;
          model_version?: string;
          payload?: Json;
          sleeper_draft_id?: string;
          through_pick_no?: number;
        };
        Relationships: [];
      };
      on_the_clock_settings: {
        Row: {
          created_at: string;
          id: string;
          settings: Json;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          settings: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          settings?: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      player_market_snapshots: {
        Row: {
          adp: Json;
          created_at: string;
          id: string;
          metadata: Json;
          player_id: string | null;
          projected_pts_half_ppr: number | null;
          projected_pts_ppr: number | null;
          projected_pts_std: number | null;
          season: number;
          season_type: string;
          sleeper_player_id: string;
          snapshot_date: string;
          source: string;
          updated_at: string;
        };
        Insert: {
          adp?: Json;
          created_at?: string;
          id?: string;
          metadata?: Json;
          player_id?: string | null;
          projected_pts_half_ppr?: number | null;
          projected_pts_ppr?: number | null;
          projected_pts_std?: number | null;
          season: number;
          season_type?: string;
          sleeper_player_id: string;
          snapshot_date: string;
          source?: string;
          updated_at?: string;
        };
        Update: {
          adp?: Json;
          created_at?: string;
          id?: string;
          metadata?: Json;
          player_id?: string | null;
          projected_pts_half_ppr?: number | null;
          projected_pts_ppr?: number | null;
          projected_pts_std?: number | null;
          season?: number;
          season_type?: string;
          sleeper_player_id?: string;
          snapshot_date?: string;
          source?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "player_market_snapshots_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      player_positional_finishes: {
        Row: {
          computed_at: string;
          finish: number;
          player_id: string;
          players_ranked: number;
          position: string;
          scoring: string;
          season: number;
          total_points: number;
        };
        Insert: {
          computed_at?: string;
          finish: number;
          player_id: string;
          players_ranked: number;
          position: string;
          scoring: string;
          season: number;
          total_points: number;
        };
        Update: {
          computed_at?: string;
          finish?: number;
          player_id?: string;
          players_ranked?: number;
          position?: string;
          scoring?: string;
          season?: number;
          total_points?: number;
        };
        Relationships: [
          {
            foreignKeyName: "player_positional_finishes_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      player_projection_accuracy: {
        Row: {
          availability_rate: number | null;
          beat_rate: number | null;
          computed_at: string;
          id: string;
          mean_diff: number | null;
          mean_ratio: number | null;
          player_id: string;
          position: string | null;
          ratio_stdev: number | null;
          sample_weight: number | null;
          scoring: string;
          season: number | null;
          shrunk_multiplier: number | null;
          weeks_beat: number;
          weeks_played: number;
          weeks_projected: number;
        };
        Insert: {
          availability_rate?: number | null;
          beat_rate?: number | null;
          computed_at?: string;
          id?: string;
          mean_diff?: number | null;
          mean_ratio?: number | null;
          player_id: string;
          position?: string | null;
          ratio_stdev?: number | null;
          sample_weight?: number | null;
          scoring: string;
          season?: number | null;
          shrunk_multiplier?: number | null;
          weeks_beat?: number;
          weeks_played?: number;
          weeks_projected?: number;
        };
        Update: {
          availability_rate?: number | null;
          beat_rate?: number | null;
          computed_at?: string;
          id?: string;
          mean_diff?: number | null;
          mean_ratio?: number | null;
          player_id?: string;
          position?: string | null;
          ratio_stdev?: number | null;
          sample_weight?: number | null;
          scoring?: string;
          season?: number | null;
          shrunk_multiplier?: number | null;
          weeks_beat?: number;
          weeks_played?: number;
          weeks_projected?: number;
        };
        Relationships: [
          {
            foreignKeyName: "player_projection_accuracy_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      player_stats: {
        Row: {
          blk_kick: number;
          bonus_pass_cmp_25: number;
          bonus_pass_yd_300: number;
          bonus_pass_yd_400: number;
          bonus_rec_te: number;
          bonus_rec_wr: number;
          bonus_rec_yd_100: number;
          bonus_rec_yd_200: number;
          bonus_rush_yd_100: number;
          bonus_rush_yd_200: number;
          def_td: number;
          ff: number;
          fga: number;
          fgm: number;
          fgm_0_19: number;
          fgm_20_29: number;
          fgm_30_39: number;
          fgm_40_49: number;
          fgm_50p: number;
          fgmiss: number;
          fum: number;
          fum_lost: number;
          fum_rec: number;
          fum_rec_td: number;
          game_id: string | null;
          gp: number;
          gs: number;
          id: string;
          ingested_at: string;
          interceptions: number;
          metadata: Json | null;
          off_snp: number | null;
          opponent: string | null;
          pass_2pt: number;
          pass_air_yd: number;
          pass_att: number;
          pass_cmp: number;
          pass_cmp_40p: number;
          pass_fd: number;
          pass_inc: number;
          pass_int: number;
          pass_int_td: number;
          pass_lng: number;
          pass_rz_att: number;
          pass_sack: number;
          pass_td: number;
          pass_td_40p: number;
          pass_td_lng: number;
          pass_yd: number;
          player_id: string;
          pts_allow: number | null;
          pts_allow_0: number;
          pts_allow_1_6: number;
          pts_allow_14_20: number;
          pts_allow_21_27: number;
          pts_allow_28_34: number;
          pts_allow_35p: number;
          pts_allow_7_13: number;
          pts_half_ppr: number | null;
          pts_ppr: number | null;
          pts_std: number | null;
          rec: number;
          rec_0_4: number;
          rec_10_19: number;
          rec_20_29: number;
          rec_2pt: number;
          rec_30_39: number;
          rec_40p: number;
          rec_5_9: number;
          rec_air_yd: number | null;
          rec_drop: number;
          rec_fd: number;
          rec_lng: number;
          rec_td: number;
          rec_td_40p: number;
          rec_td_lng: number;
          rec_tgt: number | null;
          rec_yar: number;
          rec_yd: number;
          rush_2pt: number;
          rush_att: number;
          rush_btkl: number;
          rush_fd: number;
          rush_lng: number;
          rush_rz_att: number;
          rush_td: number;
          rush_td_lng: number;
          rush_yac: number;
          rush_yd: number;
          sack: number;
          safety: number;
          season: number;
          season_type: string;
          snap_pct: number | null;
          target_share: number | null;
          tm_off_snp: number | null;
          updated_at: string;
          week: number;
          xpa: number;
          xpm: number;
          xpmiss: number;
          yds_allow: number | null;
        };
        Insert: {
          blk_kick?: number;
          bonus_pass_cmp_25?: number;
          bonus_pass_yd_300?: number;
          bonus_pass_yd_400?: number;
          bonus_rec_te?: number;
          bonus_rec_wr?: number;
          bonus_rec_yd_100?: number;
          bonus_rec_yd_200?: number;
          bonus_rush_yd_100?: number;
          bonus_rush_yd_200?: number;
          def_td?: number;
          ff?: number;
          fga?: number;
          fgm?: number;
          fgm_0_19?: number;
          fgm_20_29?: number;
          fgm_30_39?: number;
          fgm_40_49?: number;
          fgm_50p?: number;
          fgmiss?: number;
          fum?: number;
          fum_lost?: number;
          fum_rec?: number;
          fum_rec_td?: number;
          game_id?: string | null;
          gp?: number;
          gs?: number;
          id?: string;
          ingested_at?: string;
          interceptions?: number;
          metadata?: Json | null;
          off_snp?: number | null;
          opponent?: string | null;
          pass_2pt?: number;
          pass_air_yd?: number;
          pass_att?: number;
          pass_cmp?: number;
          pass_cmp_40p?: number;
          pass_fd?: number;
          pass_inc?: number;
          pass_int?: number;
          pass_int_td?: number;
          pass_lng?: number;
          pass_rz_att?: number;
          pass_sack?: number;
          pass_td?: number;
          pass_td_40p?: number;
          pass_td_lng?: number;
          pass_yd?: number;
          player_id: string;
          pts_allow?: number | null;
          pts_allow_0?: number;
          pts_allow_1_6?: number;
          pts_allow_14_20?: number;
          pts_allow_21_27?: number;
          pts_allow_28_34?: number;
          pts_allow_35p?: number;
          pts_allow_7_13?: number;
          pts_half_ppr?: number | null;
          pts_ppr?: number | null;
          pts_std?: number | null;
          rec?: number;
          rec_0_4?: number;
          rec_10_19?: number;
          rec_20_29?: number;
          rec_2pt?: number;
          rec_30_39?: number;
          rec_40p?: number;
          rec_5_9?: number;
          rec_air_yd?: number | null;
          rec_drop?: number;
          rec_fd?: number;
          rec_lng?: number;
          rec_td?: number;
          rec_td_40p?: number;
          rec_td_lng?: number;
          rec_tgt?: number | null;
          rec_yar?: number;
          rec_yd?: number;
          rush_2pt?: number;
          rush_att?: number;
          rush_btkl?: number;
          rush_fd?: number;
          rush_lng?: number;
          rush_rz_att?: number;
          rush_td?: number;
          rush_td_lng?: number;
          rush_yac?: number;
          rush_yd?: number;
          sack?: number;
          safety?: number;
          season: number;
          season_type?: string;
          snap_pct?: number | null;
          target_share?: number | null;
          tm_off_snp?: number | null;
          updated_at?: string;
          week: number;
          xpa?: number;
          xpm?: number;
          xpmiss?: number;
          yds_allow?: number | null;
        };
        Update: {
          blk_kick?: number;
          bonus_pass_cmp_25?: number;
          bonus_pass_yd_300?: number;
          bonus_pass_yd_400?: number;
          bonus_rec_te?: number;
          bonus_rec_wr?: number;
          bonus_rec_yd_100?: number;
          bonus_rec_yd_200?: number;
          bonus_rush_yd_100?: number;
          bonus_rush_yd_200?: number;
          def_td?: number;
          ff?: number;
          fga?: number;
          fgm?: number;
          fgm_0_19?: number;
          fgm_20_29?: number;
          fgm_30_39?: number;
          fgm_40_49?: number;
          fgm_50p?: number;
          fgmiss?: number;
          fum?: number;
          fum_lost?: number;
          fum_rec?: number;
          fum_rec_td?: number;
          game_id?: string | null;
          gp?: number;
          gs?: number;
          id?: string;
          ingested_at?: string;
          interceptions?: number;
          metadata?: Json | null;
          off_snp?: number | null;
          opponent?: string | null;
          pass_2pt?: number;
          pass_air_yd?: number;
          pass_att?: number;
          pass_cmp?: number;
          pass_cmp_40p?: number;
          pass_fd?: number;
          pass_inc?: number;
          pass_int?: number;
          pass_int_td?: number;
          pass_lng?: number;
          pass_rz_att?: number;
          pass_sack?: number;
          pass_td?: number;
          pass_td_40p?: number;
          pass_td_lng?: number;
          pass_yd?: number;
          player_id?: string;
          pts_allow?: number | null;
          pts_allow_0?: number;
          pts_allow_1_6?: number;
          pts_allow_14_20?: number;
          pts_allow_21_27?: number;
          pts_allow_28_34?: number;
          pts_allow_35p?: number;
          pts_allow_7_13?: number;
          pts_half_ppr?: number | null;
          pts_ppr?: number | null;
          pts_std?: number | null;
          rec?: number;
          rec_0_4?: number;
          rec_10_19?: number;
          rec_20_29?: number;
          rec_2pt?: number;
          rec_30_39?: number;
          rec_40p?: number;
          rec_5_9?: number;
          rec_air_yd?: number | null;
          rec_drop?: number;
          rec_fd?: number;
          rec_lng?: number;
          rec_td?: number;
          rec_td_40p?: number;
          rec_td_lng?: number;
          rec_tgt?: number | null;
          rec_yar?: number;
          rec_yd?: number;
          rush_2pt?: number;
          rush_att?: number;
          rush_btkl?: number;
          rush_fd?: number;
          rush_lng?: number;
          rush_rz_att?: number;
          rush_td?: number;
          rush_td_lng?: number;
          rush_yac?: number;
          rush_yd?: number;
          sack?: number;
          safety?: number;
          season?: number;
          season_type?: string;
          snap_pct?: number | null;
          target_share?: number | null;
          tm_off_snp?: number | null;
          updated_at?: string;
          week?: number;
          xpa?: number;
          xpm?: number;
          xpmiss?: number;
          yds_allow?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "player_stats_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      player_value_history: {
        Row: {
          captured_at: string;
          format_config_id: string;
          formula_offset: number;
          id: string;
          metadata: Json | null;
          player_id: string;
          source: string;
          value: number;
        };
        Insert: {
          captured_at?: string;
          format_config_id: string;
          formula_offset?: number;
          id?: string;
          metadata?: Json | null;
          player_id: string;
          source: string;
          value: number;
        };
        Update: {
          captured_at?: string;
          format_config_id?: string;
          formula_offset?: number;
          id?: string;
          metadata?: Json | null;
          player_id?: string;
          source?: string;
          value?: number;
        };
        Relationships: [
          {
            foreignKeyName: "player_value_history_format_config_id_fkey";
            columns: ["format_config_id"];
            isOneToOne: false;
            referencedRelation: "format_configs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "player_value_history_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      player_value_trends: {
        Row: {
          change_30d: number | null;
          change_30d_pct: number | null;
          change_7d: number | null;
          change_7d_pct: number | null;
          change_90d: number | null;
          change_90d_pct: number | null;
          current_value: number;
          data_points_30d: number;
          format_config_id: string;
          high_30d: number | null;
          id: string;
          low_30d: number | null;
          player_id: string;
          rank_30d_ago: number | null;
          rank_7d_ago: number | null;
          rank_90d_ago: number | null;
          rank_change_30d: number | null;
          rank_change_7d: number | null;
          rank_change_90d: number | null;
          show_trend_30d: boolean;
          show_trend_7d: boolean;
          show_trend_90d: boolean;
          source: string;
          trend_30d: string | null;
          trend_7d: string | null;
          updated_at: string;
          value_30d_ago: number | null;
          value_7d_ago: number | null;
          value_90d_ago: number | null;
          volatility_30d: number | null;
        };
        Insert: {
          change_30d?: number | null;
          change_30d_pct?: number | null;
          change_7d?: number | null;
          change_7d_pct?: number | null;
          change_90d?: number | null;
          change_90d_pct?: number | null;
          current_value: number;
          data_points_30d?: number;
          format_config_id: string;
          high_30d?: number | null;
          id?: string;
          low_30d?: number | null;
          player_id: string;
          rank_30d_ago?: number | null;
          rank_7d_ago?: number | null;
          rank_90d_ago?: number | null;
          rank_change_30d?: number | null;
          rank_change_7d?: number | null;
          rank_change_90d?: number | null;
          show_trend_30d?: boolean;
          show_trend_7d?: boolean;
          show_trend_90d?: boolean;
          source: string;
          trend_30d?: string | null;
          trend_7d?: string | null;
          updated_at?: string;
          value_30d_ago?: number | null;
          value_7d_ago?: number | null;
          value_90d_ago?: number | null;
          volatility_30d?: number | null;
        };
        Update: {
          change_30d?: number | null;
          change_30d_pct?: number | null;
          change_7d?: number | null;
          change_7d_pct?: number | null;
          change_90d?: number | null;
          change_90d_pct?: number | null;
          current_value?: number;
          data_points_30d?: number;
          format_config_id?: string;
          high_30d?: number | null;
          id?: string;
          low_30d?: number | null;
          player_id?: string;
          rank_30d_ago?: number | null;
          rank_7d_ago?: number | null;
          rank_90d_ago?: number | null;
          rank_change_30d?: number | null;
          rank_change_7d?: number | null;
          rank_change_90d?: number | null;
          show_trend_30d?: boolean;
          show_trend_7d?: boolean;
          show_trend_90d?: boolean;
          source?: string;
          trend_30d?: string | null;
          trend_7d?: string | null;
          updated_at?: string;
          value_30d_ago?: number | null;
          value_7d_ago?: number | null;
          value_90d_ago?: number | null;
          volatility_30d?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "player_value_trends_format_config_id_fkey";
            columns: ["format_config_id"];
            isOneToOne: false;
            referencedRelation: "format_configs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "player_value_trends_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      player_weekly_projections: {
        Row: {
          availability: string;
          game_id: string | null;
          generated_at: string;
          id: string;
          injury_status: string | null;
          metadata: Json | null;
          opponent: string | null;
          player_id: string | null;
          projected_pts_half_ppr: number | null;
          projected_pts_ppr: number | null;
          projected_pts_std: number | null;
          season: number;
          season_type: string;
          sleeper_player_id: string;
          source: string;
          stat_line: Json | null;
          team: string | null;
          updated_at: string;
          week: number;
        };
        Insert: {
          availability?: string;
          game_id?: string | null;
          generated_at?: string;
          id?: string;
          injury_status?: string | null;
          metadata?: Json | null;
          opponent?: string | null;
          player_id?: string | null;
          projected_pts_half_ppr?: number | null;
          projected_pts_ppr?: number | null;
          projected_pts_std?: number | null;
          season: number;
          season_type?: string;
          sleeper_player_id: string;
          source?: string;
          stat_line?: Json | null;
          team?: string | null;
          updated_at?: string;
          week: number;
        };
        Update: {
          availability?: string;
          game_id?: string | null;
          generated_at?: string;
          id?: string;
          injury_status?: string | null;
          metadata?: Json | null;
          opponent?: string | null;
          player_id?: string | null;
          projected_pts_half_ppr?: number | null;
          projected_pts_ppr?: number | null;
          projected_pts_std?: number | null;
          season?: number;
          season_type?: string;
          sleeper_player_id?: string;
          source?: string;
          stat_line?: Json | null;
          team?: string | null;
          updated_at?: string;
          week?: number;
        };
        Relationships: [
          {
            foreignKeyName: "player_weekly_projections_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      players: {
        Row: {
          birth_date: string | null;
          college: string | null;
          created_at: string;
          draft_pick: number | null;
          draft_round: number | null;
          draft_year: number | null;
          external_ids: Json;
          first_name: string;
          full_name: string | null;
          height_inches: number | null;
          id: string;
          internal_attributes: Json;
          last_name: string;
          metadata: Json;
          position: string;
          search_last_name: string | null;
          search_name: string | null;
          slug: string;
          source_synced_at: Json;
          status: string;
          team: string | null;
          updated_at: string;
          weight_lbs: number | null;
          years_experience: number | null;
        };
        Insert: {
          birth_date?: string | null;
          college?: string | null;
          created_at?: string;
          draft_pick?: number | null;
          draft_round?: number | null;
          draft_year?: number | null;
          external_ids?: Json;
          first_name: string;
          full_name?: string | null;
          height_inches?: number | null;
          id?: string;
          internal_attributes?: Json;
          last_name: string;
          metadata?: Json;
          position: string;
          search_last_name?: string | null;
          search_name?: string | null;
          slug: string;
          source_synced_at?: Json;
          status?: string;
          team?: string | null;
          updated_at?: string;
          weight_lbs?: number | null;
          years_experience?: number | null;
        };
        Update: {
          birth_date?: string | null;
          college?: string | null;
          created_at?: string;
          draft_pick?: number | null;
          draft_round?: number | null;
          draft_year?: number | null;
          external_ids?: Json;
          first_name?: string;
          full_name?: string | null;
          height_inches?: number | null;
          id?: string;
          internal_attributes?: Json;
          last_name?: string;
          metadata?: Json;
          position?: string;
          search_last_name?: string | null;
          search_name?: string | null;
          slug?: string;
          source_synced_at?: Json;
          status?: string;
          team?: string | null;
          updated_at?: string;
          weight_lbs?: number | null;
          years_experience?: number | null;
        };
        Relationships: [];
      };
      positional_war_curves: {
        Row: {
          avg_seated_points: number | null;
          cliff_rank: number | null;
          computed_at: string;
          curve: Json;
          deficit: number | null;
          fingerprint: string;
          first_league_id: string | null;
          from_week: number;
          inputs_digest: Json;
          model_version: string;
          position: string;
          replacement_points: number | null;
          shallow_pool: boolean;
          structural_demand: number;
          through_week: number;
          war_at_demand: number | null;
          war_rank_1: number | null;
          weekly_diagnostics: Json;
        };
        Insert: {
          avg_seated_points?: number | null;
          cliff_rank?: number | null;
          computed_at?: string;
          curve?: Json;
          deficit?: number | null;
          fingerprint: string;
          first_league_id?: string | null;
          from_week: number;
          inputs_digest: Json;
          model_version: string;
          position: string;
          replacement_points?: number | null;
          shallow_pool?: boolean;
          structural_demand: number;
          through_week: number;
          war_at_demand?: number | null;
          war_rank_1?: number | null;
          weekly_diagnostics?: Json;
        };
        Update: {
          avg_seated_points?: number | null;
          cliff_rank?: number | null;
          computed_at?: string;
          curve?: Json;
          deficit?: number | null;
          fingerprint?: string;
          first_league_id?: string | null;
          from_week?: number;
          inputs_digest?: Json;
          model_version?: string;
          position?: string;
          replacement_points?: number | null;
          shallow_pool?: boolean;
          structural_demand?: number;
          through_week?: number;
          war_at_demand?: number | null;
          war_rank_1?: number | null;
          weekly_diagnostics?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "positional_war_curves_first_league_id_fkey";
            columns: ["first_league_id"];
            isOneToOne: false;
            referencedRelation: "leagues";
            referencedColumns: ["id"];
          },
        ];
      };
      rankings: {
        Row: {
          confidence: string | null;
          format_config_id: string;
          generated_at: string;
          id: string;
          metadata: Json | null;
          notes: string | null;
          overall_rank: number;
          player_id: string;
          position_rank: number;
          season: number;
          source: string;
          tier: number | null;
          trend: string | null;
          week: number | null;
        };
        Insert: {
          confidence?: string | null;
          format_config_id: string;
          generated_at?: string;
          id?: string;
          metadata?: Json | null;
          notes?: string | null;
          overall_rank: number;
          player_id: string;
          position_rank: number;
          season: number;
          source: string;
          tier?: number | null;
          trend?: string | null;
          week?: number | null;
        };
        Update: {
          confidence?: string | null;
          format_config_id?: string;
          generated_at?: string;
          id?: string;
          metadata?: Json | null;
          notes?: string | null;
          overall_rank?: number;
          player_id?: string;
          position_rank?: number;
          season?: number;
          source?: string;
          tier?: number | null;
          trend?: string | null;
          week?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "rankings_format_config_id_fkey";
            columns: ["format_config_id"];
            isOneToOne: false;
            referencedRelation: "format_configs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rankings_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limit_hits: {
        Row: {
          bucket: string;
          key: string;
          request_count: number;
          updated_at: string;
          window_started_at: string;
        };
        Insert: {
          bucket: string;
          key: string;
          request_count?: number;
          updated_at?: string;
          window_started_at?: string;
        };
        Update: {
          bucket?: string;
          key?: string;
          request_count?: number;
          updated_at?: string;
          window_started_at?: string;
        };
        Relationships: [];
      };
      rosters: {
        Row: {
          co_owners: Json;
          created_at: string;
          draft_pick_assets: Json;
          id: string;
          league_id: string;
          losses: number;
          metadata: Json;
          owner_user_id: string | null;
          player_ids: Json;
          points_against: number;
          points_for: number;
          reserve_ids: Json;
          sleeper_roster_id: number;
          starter_ids: Json;
          taxi_ids: Json;
          ties: number;
          updated_at: string;
          waiver_budget: number | null;
          waiver_position: number | null;
          wins: number;
        };
        Insert: {
          co_owners?: Json;
          created_at?: string;
          draft_pick_assets?: Json;
          id?: string;
          league_id: string;
          losses?: number;
          metadata?: Json;
          owner_user_id?: string | null;
          player_ids?: Json;
          points_against?: number;
          points_for?: number;
          reserve_ids?: Json;
          sleeper_roster_id: number;
          starter_ids?: Json;
          taxi_ids?: Json;
          ties?: number;
          updated_at?: string;
          waiver_budget?: number | null;
          waiver_position?: number | null;
          wins?: number;
        };
        Update: {
          co_owners?: Json;
          created_at?: string;
          draft_pick_assets?: Json;
          id?: string;
          league_id?: string;
          losses?: number;
          metadata?: Json;
          owner_user_id?: string | null;
          player_ids?: Json;
          points_against?: number;
          points_for?: number;
          reserve_ids?: Json;
          sleeper_roster_id?: number;
          starter_ids?: Json;
          taxi_ids?: Json;
          ties?: number;
          updated_at?: string;
          waiver_budget?: number | null;
          waiver_position?: number | null;
          wins?: number;
        };
        Relationships: [
          {
            foreignKeyName: "rosters_league_id_fkey";
            columns: ["league_id"];
            isOneToOne: false;
            referencedRelation: "leagues";
            referencedColumns: ["id"];
          },
        ];
      };
      signal_check_analyses: {
        Row: {
          adjusted_values: Json;
          confidence: string | null;
          created_at: string;
          format_config_id: string | null;
          format_detection_evidence: Json | null;
          format_slug: string;
          id: string;
          input_assets: Json;
          is_public: boolean;
          margin: number | null;
          public_payload: Json | null;
          public_share_id: string;
          raw_values: Json;
          rule_interpreter_version: string;
          rule_trace: Json;
          ruleset_version: number | null;
          side_totals_post: Json;
          side_totals_pre: Json;
          sleeper_context: Json | null;
          trade_shape: string | null;
          user_id: string | null;
          value_captured_at: string | null;
          value_engine_version: string;
          value_source_slug: string;
          verdict_label: string;
          winner_side: string | null;
        };
        Insert: {
          adjusted_values?: Json;
          confidence?: string | null;
          created_at?: string;
          format_config_id?: string | null;
          format_detection_evidence?: Json | null;
          format_slug: string;
          id?: string;
          input_assets?: Json;
          is_public?: boolean;
          margin?: number | null;
          public_payload?: Json | null;
          public_share_id: string;
          raw_values?: Json;
          rule_interpreter_version: string;
          rule_trace?: Json;
          ruleset_version?: number | null;
          side_totals_post?: Json;
          side_totals_pre?: Json;
          sleeper_context?: Json | null;
          trade_shape?: string | null;
          user_id?: string | null;
          value_captured_at?: string | null;
          value_engine_version: string;
          value_source_slug: string;
          verdict_label: string;
          winner_side?: string | null;
        };
        Update: {
          adjusted_values?: Json;
          confidence?: string | null;
          created_at?: string;
          format_config_id?: string | null;
          format_detection_evidence?: Json | null;
          format_slug?: string;
          id?: string;
          input_assets?: Json;
          is_public?: boolean;
          margin?: number | null;
          public_payload?: Json | null;
          public_share_id?: string;
          raw_values?: Json;
          rule_interpreter_version?: string;
          rule_trace?: Json;
          ruleset_version?: number | null;
          side_totals_post?: Json;
          side_totals_pre?: Json;
          sleeper_context?: Json | null;
          trade_shape?: string | null;
          user_id?: string | null;
          value_captured_at?: string | null;
          value_engine_version?: string;
          value_source_slug?: string;
          verdict_label?: string;
          winner_side?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "signal_check_analyses_format_config_id_fkey";
            columns: ["format_config_id"];
            isOneToOne: false;
            referencedRelation: "format_configs";
            referencedColumns: ["id"];
          },
        ];
      };
      signal_check_audit_log: {
        Row: {
          action: string;
          actor_user_id: string | null;
          after: Json | null;
          before: Json | null;
          created_at: string;
          id: string;
          target: string | null;
        };
        Insert: {
          action: string;
          actor_user_id?: string | null;
          after?: Json | null;
          before?: Json | null;
          created_at?: string;
          id?: string;
          target?: string | null;
        };
        Update: {
          action?: string;
          actor_user_id?: string | null;
          after?: Json | null;
          before?: Json | null;
          created_at?: string;
          id?: string;
          target?: string | null;
        };
        Relationships: [];
      };
      signal_check_regression_cases: {
        Row: {
          admin_notes: string | null;
          created_at: string;
          created_by: string | null;
          expected_confidence: string | null;
          expected_margin_max: number | null;
          expected_margin_min: number | null;
          expected_trade_shape: string | null;
          expected_verdict: string | null;
          format_slug: string;
          id: string;
          input_assets: Json;
          label: string;
          tolerance: Json;
          updated_at: string;
        };
        Insert: {
          admin_notes?: string | null;
          created_at?: string;
          created_by?: string | null;
          expected_confidence?: string | null;
          expected_margin_max?: number | null;
          expected_margin_min?: number | null;
          expected_trade_shape?: string | null;
          expected_verdict?: string | null;
          format_slug: string;
          id?: string;
          input_assets?: Json;
          label: string;
          tolerance?: Json;
          updated_at?: string;
        };
        Update: {
          admin_notes?: string | null;
          created_at?: string;
          created_by?: string | null;
          expected_confidence?: string | null;
          expected_margin_max?: number | null;
          expected_margin_min?: number | null;
          expected_trade_shape?: string | null;
          expected_verdict?: string | null;
          format_slug?: string;
          id?: string;
          input_assets?: Json;
          label?: string;
          tolerance?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      signal_check_rules: {
        Row: {
          action: Json;
          admin_label: string;
          condition: Json;
          created_at: string;
          enabled: boolean;
          id: string;
          internal_description: string | null;
          max_adjustment: Json | null;
          phase: string;
          public_explanation_template: string;
          ruleset_id: string;
          scope: string;
          sort_order: number;
          stack_group: string | null;
          stackable: boolean;
          updated_at: string;
        };
        Insert: {
          action?: Json;
          admin_label: string;
          condition?: Json;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          internal_description?: string | null;
          max_adjustment?: Json | null;
          phase: string;
          public_explanation_template?: string;
          ruleset_id: string;
          scope: string;
          sort_order?: number;
          stack_group?: string | null;
          stackable?: boolean;
          updated_at?: string;
        };
        Update: {
          action?: Json;
          admin_label?: string;
          condition?: Json;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          internal_description?: string | null;
          max_adjustment?: Json | null;
          phase?: string;
          public_explanation_template?: string;
          ruleset_id?: string;
          scope?: string;
          sort_order?: number;
          stack_group?: string | null;
          stackable?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "signal_check_rules_ruleset_id_fkey";
            columns: ["ruleset_id"];
            isOneToOne: false;
            referencedRelation: "signal_check_rulesets";
            referencedColumns: ["id"];
          },
        ];
      };
      signal_check_rulesets: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          is_active: boolean;
          label: string | null;
          notes: string | null;
          published_at: string | null;
          status: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_active?: boolean;
          label?: string | null;
          notes?: string | null;
          published_at?: string | null;
          status?: string;
          version: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_active?: boolean;
          label?: string | null;
          notes?: string | null;
          published_at?: string | null;
          status?: string;
          version?: number;
        };
        Relationships: [];
      };
      signal_comments: {
        Row: {
          author_user_id: string;
          body: string;
          created_at: string;
          edited_at: string | null;
          gif: Json | null;
          hidden: boolean;
          hidden_at: string | null;
          hidden_by: string | null;
          hidden_reason: string | null;
          id: string;
          post_id: string;
          updated_at: string;
        };
        Insert: {
          author_user_id: string;
          body: string;
          created_at?: string;
          edited_at?: string | null;
          gif?: Json | null;
          hidden?: boolean;
          hidden_at?: string | null;
          hidden_by?: string | null;
          hidden_reason?: string | null;
          id?: string;
          post_id: string;
          updated_at?: string;
        };
        Update: {
          author_user_id?: string;
          body?: string;
          created_at?: string;
          edited_at?: string | null;
          gif?: Json | null;
          hidden?: boolean;
          hidden_at?: string | null;
          hidden_by?: string | null;
          hidden_reason?: string | null;
          id?: string;
          post_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "signal_comments_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "signal_posts";
            referencedColumns: ["id"];
          },
        ];
      };
      signal_follows: {
        Row: {
          created_at: string;
          followee_user_id: string;
          follower_user_id: string;
        };
        Insert: {
          created_at?: string;
          followee_user_id: string;
          follower_user_id: string;
        };
        Update: {
          created_at?: string;
          followee_user_id?: string;
          follower_user_id?: string;
        };
        Relationships: [];
      };
      signal_handle_history: {
        Row: {
          changed_at: string;
          old_handle: string;
          signal_id: string;
        };
        Insert: {
          changed_at?: string;
          old_handle: string;
          signal_id: string;
        };
        Update: {
          changed_at?: string;
          old_handle?: string;
          signal_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "signal_handle_history_signal_id_fkey";
            columns: ["signal_id"];
            isOneToOne: false;
            referencedRelation: "signals";
            referencedColumns: ["id"];
          },
        ];
      };
      signal_post_images: {
        Row: {
          alt_text: string;
          created_at: string;
          height: number;
          id: string;
          ordinal: number;
          post_id: string;
          storage_path: string;
          width: number;
        };
        Insert: {
          alt_text: string;
          created_at?: string;
          height: number;
          id?: string;
          ordinal: number;
          post_id: string;
          storage_path: string;
          width: number;
        };
        Update: {
          alt_text?: string;
          created_at?: string;
          height?: number;
          id?: string;
          ordinal?: number;
          post_id?: string;
          storage_path?: string;
          width?: number;
        };
        Relationships: [
          {
            foreignKeyName: "signal_post_images_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "signal_posts";
            referencedColumns: ["id"];
          },
        ];
      };
      signal_posts: {
        Row: {
          body: string;
          created_at: string;
          edited_at: string | null;
          gif: Json | null;
          hidden: boolean;
          hidden_at: string | null;
          hidden_by: string | null;
          hidden_reason: string | null;
          id: string;
          pinned: boolean;
          signal_id: string;
          updated_at: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          edited_at?: string | null;
          gif?: Json | null;
          hidden?: boolean;
          hidden_at?: string | null;
          hidden_by?: string | null;
          hidden_reason?: string | null;
          id?: string;
          pinned?: boolean;
          signal_id: string;
          updated_at?: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          edited_at?: string | null;
          gif?: Json | null;
          hidden?: boolean;
          hidden_at?: string | null;
          hidden_by?: string | null;
          hidden_reason?: string | null;
          id?: string;
          pinned?: boolean;
          signal_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "signal_posts_signal_id_fkey";
            columns: ["signal_id"];
            isOneToOne: false;
            referencedRelation: "signals";
            referencedColumns: ["id"];
          },
        ];
      };
      signal_reaction_counts: {
        Row: {
          count: number;
          reaction_type_id: string;
          target_id: string;
          target_type: string;
        };
        Insert: {
          count?: number;
          reaction_type_id: string;
          target_id: string;
          target_type: string;
        };
        Update: {
          count?: number;
          reaction_type_id?: string;
          target_id?: string;
          target_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "signal_reaction_counts_reaction_type_id_fkey";
            columns: ["reaction_type_id"];
            isOneToOne: false;
            referencedRelation: "signal_reaction_types";
            referencedColumns: ["id"];
          },
        ];
      };
      signal_reaction_types: {
        Row: {
          char: string | null;
          created_at: string;
          display_order: number;
          id: string;
          image_path: string | null;
          is_active: boolean;
          kind: string;
          label: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          char?: string | null;
          created_at?: string;
          display_order?: number;
          id?: string;
          image_path?: string | null;
          is_active?: boolean;
          kind: string;
          label: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          char?: string | null;
          created_at?: string;
          display_order?: number;
          id?: string;
          image_path?: string | null;
          is_active?: boolean;
          kind?: string;
          label?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      signal_reactions: {
        Row: {
          created_at: string;
          id: string;
          reaction_type_id: string;
          target_id: string;
          target_type: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          reaction_type_id: string;
          target_id: string;
          target_type: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          reaction_type_id?: string;
          target_id?: string;
          target_type?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "signal_reactions_reaction_type_id_fkey";
            columns: ["reaction_type_id"];
            isOneToOne: false;
            referencedRelation: "signal_reaction_types";
            referencedColumns: ["id"];
          },
        ];
      };
      signal_reports: {
        Row: {
          created_at: string;
          details: string | null;
          id: string;
          reason: string;
          reporter_user_id: string;
          status: string;
          target_id: string;
          target_type: string;
        };
        Insert: {
          created_at?: string;
          details?: string | null;
          id?: string;
          reason: string;
          reporter_user_id: string;
          status?: string;
          target_id: string;
          target_type: string;
        };
        Update: {
          created_at?: string;
          details?: string | null;
          id?: string;
          reason?: string;
          reporter_user_id?: string;
          status?: string;
          target_id?: string;
          target_type?: string;
        };
        Relationships: [];
      };
      signal_reserved_handles: {
        Row: {
          handle: string;
        };
        Insert: {
          handle: string;
        };
        Update: {
          handle?: string;
        };
        Relationships: [];
      };
      signal_scout_activity_counters: {
        Row: {
          action: string;
          count: number;
          game_date: string;
          identity_key: string;
          last_at: string;
        };
        Insert: {
          action: string;
          count?: number;
          game_date: string;
          identity_key: string;
          last_at?: string;
        };
        Update: {
          action?: string;
          count?: number;
          game_date?: string;
          identity_key?: string;
          last_at?: string;
        };
        Relationships: [];
      };
      signal_scout_daily_scores: {
        Row: {
          first_play_at: string;
          game_date: string;
          points: number;
          rounds: number;
          user_id: string;
          wins: number;
        };
        Insert: {
          first_play_at?: string;
          game_date: string;
          points?: number;
          rounds?: number;
          user_id: string;
          wins?: number;
        };
        Update: {
          first_play_at?: string;
          game_date?: string;
          points?: number;
          rounds?: number;
          user_id?: string;
          wins?: number;
        };
        Relationships: [];
      };
      signal_scout_guesses: {
        Row: {
          created_at: string;
          guess_number: number;
          guessed_player_id: string;
          is_correct: boolean;
          round_id: string;
        };
        Insert: {
          created_at?: string;
          guess_number: number;
          guessed_player_id: string;
          is_correct: boolean;
          round_id: string;
        };
        Update: {
          created_at?: string;
          guess_number?: number;
          guessed_player_id?: string;
          is_correct?: boolean;
          round_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "signal_scout_guesses_guessed_player_id_fkey";
            columns: ["guessed_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "signal_scout_guesses_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "signal_scout_rounds";
            referencedColumns: ["id"];
          },
        ];
      };
      signal_scout_player_overrides: {
        Row: {
          admin_note: string | null;
          is_hidden: boolean;
          player_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          admin_note?: string | null;
          is_hidden?: boolean;
          player_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          admin_note?: string | null;
          is_hidden?: boolean;
          player_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "signal_scout_player_overrides_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: true;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      signal_scout_round_clues: {
        Row: {
          clue_key: string;
          cost: number;
          display_value: string;
          is_revealed: boolean;
          label: string;
          reveal_order: number | null;
          revealed_at: string | null;
          round_id: string;
          specificity: number;
          tier: string;
        };
        Insert: {
          clue_key: string;
          cost: number;
          display_value: string;
          is_revealed?: boolean;
          label: string;
          reveal_order?: number | null;
          revealed_at?: string | null;
          round_id: string;
          specificity: number;
          tier: string;
        };
        Update: {
          clue_key?: string;
          cost?: number;
          display_value?: string;
          is_revealed?: boolean;
          label?: string;
          reveal_order?: number | null;
          revealed_at?: string | null;
          round_id?: string;
          specificity?: number;
          tier?: string;
        };
        Relationships: [
          {
            foreignKeyName: "signal_scout_round_clues_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "signal_scout_rounds";
            referencedColumns: ["id"];
          },
        ];
      };
      signal_scout_rounds: {
        Row: {
          burned_out_at: string | null;
          completed_at: string | null;
          game_date: string;
          guest_id: string | null;
          hints_used: number;
          id: string;
          ip_hash: string | null;
          score_available: number;
          score_awarded: number;
          settings_snapshot: Json;
          started_at: string;
          status: string;
          target_player_id: string;
          tier_purchases: Json;
          user_id: string | null;
          wrong_guess_count: number;
        };
        Insert: {
          burned_out_at?: string | null;
          completed_at?: string | null;
          game_date?: string;
          guest_id?: string | null;
          hints_used?: number;
          id?: string;
          ip_hash?: string | null;
          score_available: number;
          score_awarded?: number;
          settings_snapshot: Json;
          started_at?: string;
          status?: string;
          target_player_id: string;
          tier_purchases?: Json;
          user_id?: string | null;
          wrong_guess_count?: number;
        };
        Update: {
          burned_out_at?: string | null;
          completed_at?: string | null;
          game_date?: string;
          guest_id?: string | null;
          hints_used?: number;
          id?: string;
          ip_hash?: string | null;
          score_available?: number;
          score_awarded?: number;
          settings_snapshot?: Json;
          started_at?: string;
          status?: string;
          target_player_id?: string;
          tier_purchases?: Json;
          user_id?: string | null;
          wrong_guess_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "signal_scout_rounds_target_player_id_fkey";
            columns: ["target_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      signal_scout_settings: {
        Row: {
          created_at: string;
          id: string;
          settings: Json;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          settings: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          settings?: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      signal_scout_user_stats: {
        Row: {
          best_daily_streak: number;
          best_signal_streak: number;
          current_daily_streak: number;
          current_signal_streak: number;
          first_played_at: string;
          hidden_at: string | null;
          hidden_by: string | null;
          hidden_from_leaderboards: boolean;
          hidden_reason: string | null;
          last_played_date: string | null;
          rounds_burned: number;
          rounds_failed: number;
          rounds_played: number;
          rounds_skipped: number;
          rounds_solved_late: number;
          rounds_won: number;
          total_hints: number;
          total_points: number;
          total_wrong_guesses: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          best_daily_streak?: number;
          best_signal_streak?: number;
          current_daily_streak?: number;
          current_signal_streak?: number;
          first_played_at?: string;
          hidden_at?: string | null;
          hidden_by?: string | null;
          hidden_from_leaderboards?: boolean;
          hidden_reason?: string | null;
          last_played_date?: string | null;
          rounds_burned?: number;
          rounds_failed?: number;
          rounds_played?: number;
          rounds_skipped?: number;
          rounds_solved_late?: number;
          rounds_won?: number;
          total_hints?: number;
          total_points?: number;
          total_wrong_guesses?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          best_daily_streak?: number;
          best_signal_streak?: number;
          current_daily_streak?: number;
          current_signal_streak?: number;
          first_played_at?: string;
          hidden_at?: string | null;
          hidden_by?: string | null;
          hidden_from_leaderboards?: boolean;
          hidden_reason?: string | null;
          last_played_date?: string | null;
          rounds_burned?: number;
          rounds_failed?: number;
          rounds_played?: number;
          rounds_skipped?: number;
          rounds_solved_late?: number;
          rounds_won?: number;
          total_hints?: number;
          total_points?: number;
          total_wrong_guesses?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      signals: {
        Row: {
          accent: string;
          avatar_path: string | null;
          banner_path: string | null;
          bio: string | null;
          created_at: string;
          display_name: string;
          favorite_player_id: string | null;
          favorite_team: string | null;
          follower_count: number;
          handle: string;
          headline: string | null;
          hidden: boolean;
          hidden_at: string | null;
          hidden_reason: string | null;
          id: string;
          layout: string;
          layout_config: Json;
          links: Json;
          published_at: string | null;
          status: string;
          updated_at: string;
          user_id: string;
          visibility: string;
        };
        Insert: {
          accent?: string;
          avatar_path?: string | null;
          banner_path?: string | null;
          bio?: string | null;
          created_at?: string;
          display_name: string;
          favorite_player_id?: string | null;
          favorite_team?: string | null;
          follower_count?: number;
          handle: string;
          headline?: string | null;
          hidden?: boolean;
          hidden_at?: string | null;
          hidden_reason?: string | null;
          id?: string;
          layout?: string;
          layout_config?: Json;
          links?: Json;
          published_at?: string | null;
          status?: string;
          updated_at?: string;
          user_id: string;
          visibility?: string;
        };
        Update: {
          accent?: string;
          avatar_path?: string | null;
          banner_path?: string | null;
          bio?: string | null;
          created_at?: string;
          display_name?: string;
          favorite_player_id?: string | null;
          favorite_team?: string | null;
          follower_count?: number;
          handle?: string;
          headline?: string | null;
          hidden?: boolean;
          hidden_at?: string | null;
          hidden_reason?: string | null;
          id?: string;
          layout?: string;
          layout_config?: Json;
          links?: Json;
          published_at?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: "signals_favorite_player_id_fkey";
            columns: ["favorite_player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      source_registry: {
        Row: {
          created_at: string;
          data_type: string[];
          description: string | null;
          display_name: string;
          is_active: boolean;
          is_default: boolean;
          priority: number;
          slug: string;
          supported_format_slugs: string[] | null;
          update_cadence: string;
        };
        Insert: {
          created_at?: string;
          data_type: string[];
          description?: string | null;
          display_name: string;
          is_active?: boolean;
          is_default?: boolean;
          priority: number;
          slug: string;
          supported_format_slugs?: string[] | null;
          update_cadence?: string;
        };
        Update: {
          created_at?: string;
          data_type?: string[];
          description?: string | null;
          display_name?: string;
          is_active?: boolean;
          is_default?: boolean;
          priority?: number;
          slug?: string;
          supported_format_slugs?: string[] | null;
          update_cadence?: string;
        };
        Relationships: [];
      };
      trade_suggestion_declines: {
        Row: {
          declined_at: string;
          expires_at: string;
          id: string;
          sleeper_league_id: string;
          suggestion_key: string;
          user_id: string;
        };
        Insert: {
          declined_at?: string;
          expires_at?: string;
          id?: string;
          sleeper_league_id: string;
          suggestion_key: string;
          user_id: string;
        };
        Update: {
          declined_at?: string;
          expires_at?: string;
          id?: string;
          sleeper_league_id?: string;
          suggestion_key?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      trade_suggestion_saves: {
        Row: {
          grade: Json | null;
          id: string;
          league_name: string | null;
          saved_at: string;
          sleeper_league_id: string;
          snapshot: Json;
          suggestion_key: string;
          user_id: string;
        };
        Insert: {
          grade?: Json | null;
          id?: string;
          league_name?: string | null;
          saved_at?: string;
          sleeper_league_id: string;
          snapshot: Json;
          suggestion_key: string;
          user_id: string;
        };
        Update: {
          grade?: Json | null;
          id?: string;
          league_name?: string | null;
          saved_at?: string;
          sleeper_league_id?: string;
          snapshot?: Json;
          suggestion_key?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_draft_tracker_picks: {
        Row: {
          created_at: string;
          id: string;
          player_id: string;
          team_slot: number | null;
          tracker_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          player_id: string;
          team_slot?: number | null;
          tracker_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          player_id?: string;
          team_slot?: number | null;
          tracker_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_draft_tracker_picks_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_draft_tracker_picks_tracker_id_fkey";
            columns: ["tracker_id"];
            isOneToOne: false;
            referencedRelation: "user_draft_tracker_pick_counts";
            referencedColumns: ["tracker_id"];
          },
          {
            foreignKeyName: "user_draft_tracker_picks_tracker_id_fkey";
            columns: ["tracker_id"];
            isOneToOne: false;
            referencedRelation: "user_draft_trackers";
            referencedColumns: ["id"];
          },
        ];
      };
      user_draft_trackers: {
        Row: {
          created_at: string;
          format_config_id: string;
          id: string;
          my_team_slot: number;
          name: string;
          order_by: string;
          status: string;
          team_count: number;
          team_names: Json;
          tracking_mode: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          format_config_id: string;
          id?: string;
          my_team_slot?: number;
          name: string;
          order_by?: string;
          status?: string;
          team_count?: number;
          team_names?: Json;
          tracking_mode?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          format_config_id?: string;
          id?: string;
          my_team_slot?: number;
          name?: string;
          order_by?: string;
          status?: string;
          team_count?: number;
          team_names?: Json;
          tracking_mode?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_draft_trackers_format_config_id_fkey";
            columns: ["format_config_id"];
            isOneToOne: false;
            referencedRelation: "format_configs";
            referencedColumns: ["id"];
          },
        ];
      };
      user_preferences: {
        Row: {
          avatar_path: string | null;
          bio: string | null;
          created_at: string;
          default_format_config_id: string | null;
          default_source_slug: string | null;
          first_name: string | null;
          is_admin: boolean;
          last_name: string | null;
          sleeper_league_settings: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          avatar_path?: string | null;
          bio?: string | null;
          created_at?: string;
          default_format_config_id?: string | null;
          default_source_slug?: string | null;
          first_name?: string | null;
          is_admin?: boolean;
          last_name?: string | null;
          sleeper_league_settings?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          avatar_path?: string | null;
          bio?: string | null;
          created_at?: string;
          default_format_config_id?: string | null;
          default_source_slug?: string | null;
          first_name?: string | null;
          is_admin?: boolean;
          last_name?: string | null;
          sleeper_league_settings?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_preferences_default_format_config_id_fkey";
            columns: ["default_format_config_id"];
            isOneToOne: false;
            referencedRelation: "format_configs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_preferences_default_source_slug_fkey";
            columns: ["default_source_slug"];
            isOneToOne: false;
            referencedRelation: "source_registry";
            referencedColumns: ["slug"];
          },
        ];
      };
      user_ranking_board_players: {
        Row: {
          board_id: string;
          created_at: string;
          id: string;
          player_id: string;
          rank_position: number;
          tier: number | null;
          updated_at: string;
        };
        Insert: {
          board_id: string;
          created_at?: string;
          id?: string;
          player_id: string;
          rank_position: number;
          tier?: number | null;
          updated_at?: string;
        };
        Update: {
          board_id?: string;
          created_at?: string;
          id?: string;
          player_id?: string;
          rank_position?: number;
          tier?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_ranking_board_players_board_id_fkey";
            columns: ["board_id"];
            isOneToOne: false;
            referencedRelation: "user_ranking_boards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_ranking_board_players_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      user_ranking_boards: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          profile_is_primary: boolean;
          profile_sort: number;
          profile_top_n: number | null;
          profile_visible: boolean;
          scope: string;
          tier_count: number;
          tier_labels: Json;
          tiers_enabled: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          profile_is_primary?: boolean;
          profile_sort?: number;
          profile_top_n?: number | null;
          profile_visible?: boolean;
          scope?: string;
          tier_count?: number;
          tier_labels?: Json;
          tiers_enabled?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          profile_is_primary?: boolean;
          profile_sort?: number;
          profile_top_n?: number | null;
          profile_visible?: boolean;
          scope?: string;
          tier_count?: number;
          tier_labels?: Json;
          tiers_enabled?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      vote_matchups: {
        Row: {
          analysis_generated_at: string | null;
          analysis_md: string | null;
          created_at: string;
          format_config_id: string;
          id: string;
          is_active: boolean;
          player_a_id: string;
          player_b_id: string;
          season: number;
          slug: string;
          votes_a: number;
          votes_b: number;
          week: number | null;
        };
        Insert: {
          analysis_generated_at?: string | null;
          analysis_md?: string | null;
          created_at?: string;
          format_config_id: string;
          id?: string;
          is_active?: boolean;
          player_a_id: string;
          player_b_id: string;
          season: number;
          slug: string;
          votes_a?: number;
          votes_b?: number;
          week?: number | null;
        };
        Update: {
          analysis_generated_at?: string | null;
          analysis_md?: string | null;
          created_at?: string;
          format_config_id?: string;
          id?: string;
          is_active?: boolean;
          player_a_id?: string;
          player_b_id?: string;
          season?: number;
          slug?: string;
          votes_a?: number;
          votes_b?: number;
          week?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "vote_matchups_format_config_id_fkey";
            columns: ["format_config_id"];
            isOneToOne: false;
            referencedRelation: "format_configs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vote_matchups_player_a_id_fkey";
            columns: ["player_a_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vote_matchups_player_b_id_fkey";
            columns: ["player_b_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      votes: {
        Row: {
          chose: string;
          id: string;
          matchup_id: string;
          user_id: string;
          voted_at: string;
        };
        Insert: {
          chose: string;
          id?: string;
          matchup_id: string;
          user_id: string;
          voted_at?: string;
        };
        Update: {
          chose?: string;
          id?: string;
          matchup_id?: string;
          user_id?: string;
          voted_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "votes_matchup_id_fkey";
            columns: ["matchup_id"];
            isOneToOne: false;
            referencedRelation: "vote_matchups";
            referencedColumns: ["id"];
          },
        ];
      };
      would_you_rather_discord_polls: {
        Row: {
          closes_at: string;
          discord_message_id: string | null;
          error: string | null;
          id: string;
          ingested_votes_a: number | null;
          ingested_votes_b: number | null;
          metadata: Json | null;
          posted_at: string;
          results_ingested_at: string | null;
          slot_key: string;
          status: string;
          trade_id: string;
          webhook_id: string | null;
        };
        Insert: {
          closes_at: string;
          discord_message_id?: string | null;
          error?: string | null;
          id?: string;
          ingested_votes_a?: number | null;
          ingested_votes_b?: number | null;
          metadata?: Json | null;
          posted_at?: string;
          results_ingested_at?: string | null;
          slot_key: string;
          status?: string;
          trade_id: string;
          webhook_id?: string | null;
        };
        Update: {
          closes_at?: string;
          discord_message_id?: string | null;
          error?: string | null;
          id?: string;
          ingested_votes_a?: number | null;
          ingested_votes_b?: number | null;
          metadata?: Json | null;
          posted_at?: string;
          results_ingested_at?: string | null;
          slot_key?: string;
          status?: string;
          trade_id?: string;
          webhook_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "would_you_rather_discord_polls_trade_id_fkey";
            columns: ["trade_id"];
            isOneToOne: false;
            referencedRelation: "would_you_rather_trades";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "would_you_rather_discord_polls_webhook_id_fkey";
            columns: ["webhook_id"];
            isOneToOne: false;
            referencedRelation: "discord_webhooks";
            referencedColumns: ["id"];
          },
        ];
      };
      would_you_rather_settings: {
        Row: {
          created_at: string;
          id: string;
          settings: Json;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          settings: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          settings?: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      would_you_rather_trades: {
        Row: {
          added_at: string;
          discord_posted_at: string | null;
          discord_votes_a: number;
          discord_votes_b: number;
          graded: Json | null;
          graded_at: string | null;
          id: string;
          is_startup: boolean;
          last_served_at: string | null;
          league_id: string;
          season: number | null;
          served_count: number;
          side_a_asset_count: number;
          side_a_roster_id: number;
          side_b_asset_count: number;
          side_b_roster_id: number;
          sleeper_transaction_id: string;
          status: string;
          transaction_id: string;
          votes_a: number;
          votes_b: number;
          week: number | null;
        };
        Insert: {
          added_at?: string;
          discord_posted_at?: string | null;
          discord_votes_a?: number;
          discord_votes_b?: number;
          graded?: Json | null;
          graded_at?: string | null;
          id?: string;
          is_startup?: boolean;
          last_served_at?: string | null;
          league_id: string;
          season?: number | null;
          served_count?: number;
          side_a_asset_count?: number;
          side_a_roster_id: number;
          side_b_asset_count?: number;
          side_b_roster_id: number;
          sleeper_transaction_id: string;
          status?: string;
          transaction_id: string;
          votes_a?: number;
          votes_b?: number;
          week?: number | null;
        };
        Update: {
          added_at?: string;
          discord_posted_at?: string | null;
          discord_votes_a?: number;
          discord_votes_b?: number;
          graded?: Json | null;
          graded_at?: string | null;
          id?: string;
          is_startup?: boolean;
          last_served_at?: string | null;
          league_id?: string;
          season?: number | null;
          served_count?: number;
          side_a_asset_count?: number;
          side_a_roster_id?: number;
          side_b_asset_count?: number;
          side_b_roster_id?: number;
          sleeper_transaction_id?: string;
          status?: string;
          transaction_id?: string;
          votes_a?: number;
          votes_b?: number;
          week?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "would_you_rather_trades_league_id_fkey";
            columns: ["league_id"];
            isOneToOne: false;
            referencedRelation: "leagues";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "would_you_rather_trades_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: true;
            referencedRelation: "league_transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      would_you_rather_votes: {
        Row: {
          actor_key: string | null;
          created_at: string;
          guest_id: string | null;
          id: string;
          side: string;
          trade_id: string;
          user_id: string | null;
        };
        Insert: {
          actor_key?: string | null;
          created_at?: string;
          guest_id?: string | null;
          id?: string;
          side: string;
          trade_id: string;
          user_id?: string | null;
        };
        Update: {
          actor_key?: string | null;
          created_at?: string;
          guest_id?: string | null;
          id?: string;
          side?: string;
          trade_id?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "would_you_rather_votes_trade_id_fkey";
            columns: ["trade_id"];
            isOneToOne: false;
            referencedRelation: "would_you_rather_trades";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      draft_value_board_formats: {
        Row: {
          format_slug: string | null;
          season: number | null;
        };
        Relationships: [];
      };
      player_market_latest: {
        Row: {
          adp: Json | null;
          created_at: string | null;
          id: string | null;
          metadata: Json | null;
          player_id: string | null;
          projected_pts_half_ppr: number | null;
          projected_pts_ppr: number | null;
          projected_pts_std: number | null;
          season: number | null;
          season_type: string | null;
          sleeper_player_id: string | null;
          snapshot_date: string | null;
          source: string | null;
          updated_at: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "player_market_snapshots_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id"];
          },
        ];
      };
      user_draft_tracker_pick_counts: {
        Row: {
          my_pick_count: number | null;
          pick_count: number | null;
          tracker_id: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      account_has_password: { Args: never; Returns: boolean };
      activate_beacon_reference: {
        Args: { p_min_shared?: number; p_version_id: string };
        Returns: undefined;
      };
      bb_claim_jobs: {
        Args: { p_job_types?: string[]; p_limit: number };
        Returns: {
          attempts: number;
          created_at: string;
          id: string;
          job_type: string;
          last_error: string | null;
          payload: Json;
          run_after: string;
          status: string;
          updated_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "beacon_brief_queue";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      bb_player_match_candidates: {
        Args: { p_limit?: number; p_name: string; p_threshold?: number };
        Returns: {
          full_name: string;
          id: string;
          pos: string;
          sim: number;
          status: string;
          team: string;
        }[];
      };
      beam_search_players: {
        Args: { p_limit?: number; p_min_similarity?: number; p_query: string };
        Returns: {
          first_name: string;
          full_name: string;
          id: string;
          last_name: string;
          match_similarity: number;
          position: string;
          search_last_name: string;
          search_name: string;
          slug: string;
          status: string;
          team: string;
        }[];
      };
      claim_league_sync_jobs: {
        Args: { p_limit: number };
        Returns: {
          attempts: number;
          created_at: string;
          finished_at: string | null;
          id: string;
          last_error: string | null;
          league_name: string | null;
          request_id: string;
          run_after: string;
          sleeper_league_id: string;
          status: string;
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "league_sync_jobs";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_on_the_clock_sync: {
        Args: {
          p_cooldown_seconds?: number;
          p_draft_id: string;
          p_league_id: string;
          p_lock_seconds?: number;
          p_season: string;
        };
        Returns: {
          claimed: boolean;
          cooldown_remaining_seconds: number;
          last_synced_at: string;
          locked_by_other: boolean;
        }[];
      };
      cleanup_beam_queries: {
        Args: { p_max_age_days?: number };
        Returns: number;
      };
      cleanup_on_the_clock_cache: {
        Args: { p_projection_retention_hours?: number };
        Returns: Json;
      };
      cleanup_on_the_clock_rate_limits: {
        Args: { p_max_age_hours?: number };
        Returns: number;
      };
      cleanup_rate_limit_hits: {
        Args: { p_max_age_hours?: number };
        Returns: number;
      };
      complete_on_the_clock_sync: {
        Args: { p_draft_id: string; p_pick_count: number; p_status?: string };
        Returns: undefined;
      };
      enqueue_bulk_league_sync: {
        Args: {
          p_cooldown_seconds?: number;
          p_leagues: Json;
          p_user_id: string;
        };
        Returns: Json;
      };
      find_player_trade_transactions: {
        Args: { p_limit?: number; p_sleeper_id: string };
        Returns: {
          adds: Json;
          created_at: string;
          created_at_sleeper: string | null;
          draft_picks: Json;
          drops: Json;
          id: string;
          league_id: string;
          metadata: Json;
          roster_ids: Json;
          season: number | null;
          sleeper_transaction_id: string;
          status: string | null;
          type: string;
          waiver_budget: Json;
          week: number | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "league_transactions";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      get_my_active_sessions: {
        Args: never;
        Returns: {
          created_at: string;
          id: string;
          ip: unknown;
          not_after: string;
          refreshed_at: string;
          updated_at: string;
          user_agent: string;
        }[];
      };
      get_player_positional_finishes: {
        Args: { p_player_id: string; p_seasons?: number[] };
        Returns: {
          finish: number;
          players_ranked: number;
          scoring: string;
          season: number;
          total_points: number;
        }[];
      };
      rebuild_positional_finishes: { Args: never; Returns: number };
      release_league_sync: {
        Args: { p_actor_key: string };
        Returns: undefined;
      };
      release_on_the_clock_sync: {
        Args: { p_draft_id: string };
        Returns: undefined;
      };
      set_default_source: { Args: { target_slug: string }; Returns: undefined };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { "": string }; Returns: string[] };
      signal_gif_valid: { Args: { gif: Json }; Returns: boolean };
      signal_links_valid: { Args: { links: Json }; Returns: boolean };
      signal_target_publicly_viewable: {
        Args: { t_id: string; t_type: string };
        Returns: boolean;
      };
      try_claim_league_refresh: {
        Args: {
          p_league_id: string;
          p_triggered_via: string;
          p_user_id: string;
          p_window_seconds?: number;
        };
        Returns: boolean;
      };
      try_claim_league_sync: {
        Args: {
          p_actor_key: string;
          p_cooldown_seconds?: number;
          p_lease_seconds?: number;
          p_sleeper_league_id: string;
        };
        Returns: Json;
      };
      try_claim_on_the_clock_ip_budget: {
        Args: {
          p_ip_key: string;
          p_max_requests: number;
          p_window_seconds: number;
        };
        Returns: boolean;
      };
      try_claim_on_the_clock_lookup: {
        Args: { p_ip: string; p_username: string; p_window_seconds?: number };
        Returns: boolean;
      };
      try_claim_rate_limit: {
        Args: {
          p_bucket: string;
          p_key: string;
          p_max_requests: number;
          p_window_seconds: number;
        };
        Returns: boolean;
      };
      try_claim_signal_scout_action: {
        Args: {
          p_action: string;
          p_game_date: string;
          p_identity_key: string;
          p_window_seconds?: number;
        };
        Returns: boolean;
      };
      try_start_signal_scout_guest_round: {
        Args: {
          p_game_date: string;
          p_guest_id: string;
          p_ip_hash: string;
          p_limit: number;
        };
        Returns: boolean;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
