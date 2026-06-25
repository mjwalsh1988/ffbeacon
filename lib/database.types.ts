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
            referencedRelation: "teams";
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
      league_drafts: {
        Row: {
          created_at: string;
          draft_order: Json | null;
          id: string;
          league_id: string;
          metadata: Json;
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
          discord_message_id: string | null;
          discord_webhook_id: string | null;
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
          discord_message_id?: string | null;
          discord_webhook_id?: string | null;
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
          discord_message_id?: string | null;
          discord_webhook_id?: string | null;
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
      projections: {
        Row: {
          ceiling_points: number | null;
          confidence: string | null;
          floor_points: number | null;
          format_config_id: string;
          generated_at: string;
          id: string;
          metadata: Json | null;
          player_id: string;
          projected_points: number;
          reasoning: string | null;
          season: number;
          start_sit_verdict: string | null;
          week: number;
        };
        Insert: {
          ceiling_points?: number | null;
          confidence?: string | null;
          floor_points?: number | null;
          format_config_id: string;
          generated_at?: string;
          id?: string;
          metadata?: Json | null;
          player_id: string;
          projected_points: number;
          reasoning?: string | null;
          season: number;
          start_sit_verdict?: string | null;
          week: number;
        };
        Update: {
          ceiling_points?: number | null;
          confidence?: string | null;
          floor_points?: number | null;
          format_config_id?: string;
          generated_at?: string;
          id?: string;
          metadata?: Json | null;
          player_id?: string;
          projected_points?: number;
          reasoning?: string | null;
          season?: number;
          start_sit_verdict?: string | null;
          week?: number;
        };
        Relationships: [
          {
            foreignKeyName: "projections_format_config_id_fkey";
            columns: ["format_config_id"];
            isOneToOne: false;
            referencedRelation: "format_configs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projections_player_id_fkey";
            columns: ["player_id"];
            isOneToOne: false;
            referencedRelation: "players";
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
      teams: {
        Row: {
          abbreviation: string;
          conference: string;
          created_at: string;
          discord_role_ids: string[];
          division: string;
          id: string;
          name: string;
        };
        Insert: {
          abbreviation: string;
          conference: string;
          created_at?: string;
          discord_role_ids?: string[];
          division: string;
          id?: string;
          name: string;
        };
        Update: {
          abbreviation?: string;
          conference?: string;
          created_at?: string;
          discord_role_ids?: string[];
          division?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      account_has_password: { Args: never; Returns: boolean };
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
