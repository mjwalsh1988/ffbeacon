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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      article_players: {
        Row: {
          article_id: string
          player_id: string
        }
        Insert: {
          article_id: string
          player_id: string
        }
        Update: {
          article_id?: string
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_players_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          article_type: string
          author_id: string | null
          canonical_url: string | null
          content_md: string | null
          created_at: string
          format_config_id: string | null
          id: string
          last_updated: string
          meta_description: string | null
          published_at: string | null
          schema_jsonld: Json | null
          season: number | null
          slug: string
          status: string
          title: string
          tl_dr: string | null
          view_count: number
          week: number | null
        }
        Insert: {
          article_type: string
          author_id?: string | null
          canonical_url?: string | null
          content_md?: string | null
          created_at?: string
          format_config_id?: string | null
          id?: string
          last_updated?: string
          meta_description?: string | null
          published_at?: string | null
          schema_jsonld?: Json | null
          season?: number | null
          slug: string
          status?: string
          title: string
          tl_dr?: string | null
          view_count?: number
          week?: number | null
        }
        Update: {
          article_type?: string
          author_id?: string | null
          canonical_url?: string | null
          content_md?: string | null
          created_at?: string
          format_config_id?: string | null
          id?: string
          last_updated?: string
          meta_description?: string | null
          published_at?: string | null
          schema_jsonld?: Json | null
          season?: number | null
          slug?: string
          status?: string
          title?: string
          tl_dr?: string | null
          view_count?: number
          week?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "articles_format_config_id_fkey"
            columns: ["format_config_id"]
            isOneToOne: false
            referencedRelation: "format_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_pick_values: {
        Row: {
          captured_at: string
          created_at: string
          format_config_id: string
          id: string
          metadata: Json
          pick_position: string
          round: number
          season: number
          source: string
          value: number
        }
        Insert: {
          captured_at?: string
          created_at?: string
          format_config_id: string
          id?: string
          metadata?: Json
          pick_position: string
          round: number
          season: number
          source: string
          value: number
        }
        Update: {
          captured_at?: string
          created_at?: string
          format_config_id?: string
          id?: string
          metadata?: Json
          pick_position?: string
          round?: number
          season?: number
          source?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "draft_pick_values_format_config_id_fkey"
            columns: ["format_config_id"]
            isOneToOne: false
            referencedRelation: "format_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_pick_values_source_fkey"
            columns: ["source"]
            isOneToOne: false
            referencedRelation: "source_registry"
            referencedColumns: ["slug"]
          },
        ]
      }
      format_configs: {
        Row: {
          created_at: string
          display_name: string
          display_order: number | null
          id: string
          is_active: boolean
          is_default: boolean
          is_superflex: boolean
          league_type: string
          scoring_type: string
          slug: string
          te_premium_bonus: number
        }
        Insert: {
          created_at?: string
          display_name: string
          display_order?: number | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          is_superflex?: boolean
          league_type: string
          scoring_type: string
          slug: string
          te_premium_bonus?: number
        }
        Update: {
          created_at?: string
          display_name?: string
          display_order?: number | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          is_superflex?: boolean
          league_type?: string
          scoring_type?: string
          slug?: string
          te_premium_bonus?: number
        }
        Relationships: []
      }
      league_power_rankings_cache: {
        Row: {
          bench_value: number
          format_config_id: string
          generated_at: string
          id: string
          league_id: string
          overall_rank: number | null
          picks_value: number
          positional_breakdowns: Json
          roster_id: string
          source: string
          starter_rank: number | null
          starter_value: number
          total_value: number
        }
        Insert: {
          bench_value?: number
          format_config_id: string
          generated_at?: string
          id?: string
          league_id: string
          overall_rank?: number | null
          picks_value?: number
          positional_breakdowns?: Json
          roster_id: string
          source: string
          starter_rank?: number | null
          starter_value?: number
          total_value?: number
        }
        Update: {
          bench_value?: number
          format_config_id?: string
          generated_at?: string
          id?: string
          league_id?: string
          overall_rank?: number | null
          picks_value?: number
          positional_breakdowns?: Json
          roster_id?: string
          source?: string
          starter_rank?: number | null
          starter_value?: number
          total_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "league_power_rankings_cache_format_config_id_fkey"
            columns: ["format_config_id"]
            isOneToOne: false
            referencedRelation: "format_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_power_rankings_cache_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_power_rankings_cache_roster_id_fkey"
            columns: ["roster_id"]
            isOneToOne: false
            referencedRelation: "rosters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "league_power_rankings_cache_source_fkey"
            columns: ["source"]
            isOneToOne: false
            referencedRelation: "source_registry"
            referencedColumns: ["slug"]
          },
        ]
      }
      league_transactions: {
        Row: {
          adds: Json
          created_at: string
          created_at_sleeper: string | null
          draft_picks: Json
          drops: Json
          id: string
          league_id: string
          metadata: Json
          roster_ids: Json
          season: number | null
          sleeper_transaction_id: string
          status: string | null
          type: string
          waiver_budget: Json
          week: number | null
        }
        Insert: {
          adds?: Json
          created_at?: string
          created_at_sleeper?: string | null
          draft_picks?: Json
          drops?: Json
          id?: string
          league_id: string
          metadata?: Json
          roster_ids?: Json
          season?: number | null
          sleeper_transaction_id: string
          status?: string | null
          type: string
          waiver_budget?: Json
          week?: number | null
        }
        Update: {
          adds?: Json
          created_at?: string
          created_at_sleeper?: string | null
          draft_picks?: Json
          drops?: Json
          id?: string
          league_id?: string
          metadata?: Json
          roster_ids?: Json
          season?: number | null
          sleeper_transaction_id?: string
          status?: string | null
          type?: string
          waiver_budget?: Json
          week?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "league_transactions_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      league_users: {
        Row: {
          avatar: string | null
          created_at: string
          display_name: string | null
          id: string
          is_commissioner: boolean
          is_owner: boolean
          league_id: string
          metadata: Json
          sleeper_user_id: string
          team_name: string | null
          updated_at: string
        }
        Insert: {
          avatar?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_commissioner?: boolean
          is_owner?: boolean
          league_id: string
          metadata?: Json
          sleeper_user_id: string
          team_name?: string | null
          updated_at?: string
        }
        Update: {
          avatar?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_commissioner?: boolean
          is_owner?: boolean
          league_id?: string
          metadata?: Json
          sleeper_user_id?: string
          team_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_users_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          created_at: string
          format_config_id: string | null
          id: string
          last_synced_at: string | null
          metadata: Json
          name: string
          roster_positions: Json
          scoring_settings: Json
          season: number
          sleeper_league_id: string
          sport: string
          status: string | null
          sync_error: string | null
          sync_status: string
          total_rosters: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          format_config_id?: string | null
          id?: string
          last_synced_at?: string | null
          metadata?: Json
          name: string
          roster_positions?: Json
          scoring_settings?: Json
          season: number
          sleeper_league_id: string
          sport?: string
          status?: string | null
          sync_error?: string | null
          sync_status?: string
          total_rosters?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          format_config_id?: string | null
          id?: string
          last_synced_at?: string | null
          metadata?: Json
          name?: string
          roster_positions?: Json
          scoring_settings?: Json
          season?: number
          sleeper_league_id?: string
          sport?: string
          status?: string | null
          sync_error?: string | null
          sync_status?: string
          total_rosters?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leagues_format_config_id_fkey"
            columns: ["format_config_id"]
            isOneToOne: false
            referencedRelation: "format_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      news_items: {
        Row: {
          ai_summary: string | null
          body: string | null
          headline: string
          id: string
          impact_score: number | null
          ingested_at: string
          metadata: Json | null
          player_id: string | null
          published_at: string | null
          source_name: string | null
          source_url: string | null
        }
        Insert: {
          ai_summary?: string | null
          body?: string | null
          headline: string
          id?: string
          impact_score?: number | null
          ingested_at?: string
          metadata?: Json | null
          player_id?: string | null
          published_at?: string | null
          source_name?: string | null
          source_url?: string | null
        }
        Update: {
          ai_summary?: string | null
          body?: string | null
          headline?: string
          id?: string
          impact_score?: number | null
          ingested_at?: string
          metadata?: Json | null
          player_id?: string | null
          published_at?: string | null
          source_name?: string | null
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "news_items_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_stats: {
        Row: {
          air_yards: number | null
          carries: number | null
          fum_lost: number
          game_id: string | null
          id: string
          ingested_at: string
          metadata: Json | null
          opponent: string | null
          pass_2pt: number
          pass_int: number
          pass_td: number
          pass_yd: number
          player_id: string
          pts_half_ppr: number
          pts_ppr: number
          pts_standard: number
          rec: number
          rec_2pt: number
          rec_td: number
          rec_yd: number
          rush_2pt: number
          rush_td: number
          rush_yd: number
          season: number
          season_type: string
          snap_count: number | null
          snap_pct: number | null
          target_share: number | null
          targets: number | null
          updated_at: string
          week: number
        }
        Insert: {
          air_yards?: number | null
          carries?: number | null
          fum_lost?: number
          game_id?: string | null
          id?: string
          ingested_at?: string
          metadata?: Json | null
          opponent?: string | null
          pass_2pt?: number
          pass_int?: number
          pass_td?: number
          pass_yd?: number
          player_id: string
          pts_half_ppr?: number
          pts_ppr?: number
          pts_standard?: number
          rec?: number
          rec_2pt?: number
          rec_td?: number
          rec_yd?: number
          rush_2pt?: number
          rush_td?: number
          rush_yd?: number
          season: number
          season_type?: string
          snap_count?: number | null
          snap_pct?: number | null
          target_share?: number | null
          targets?: number | null
          updated_at?: string
          week: number
        }
        Update: {
          air_yards?: number | null
          carries?: number | null
          fum_lost?: number
          game_id?: string | null
          id?: string
          ingested_at?: string
          metadata?: Json | null
          opponent?: string | null
          pass_2pt?: number
          pass_int?: number
          pass_td?: number
          pass_yd?: number
          player_id?: string
          pts_half_ppr?: number
          pts_ppr?: number
          pts_standard?: number
          rec?: number
          rec_2pt?: number
          rec_td?: number
          rec_yd?: number
          rush_2pt?: number
          rush_td?: number
          rush_yd?: number
          season?: number
          season_type?: string
          snap_count?: number | null
          snap_pct?: number | null
          target_share?: number | null
          targets?: number | null
          updated_at?: string
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_stats_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_value_history: {
        Row: {
          captured_at: string
          format_config_id: string
          id: string
          metadata: Json | null
          player_id: string
          source: string
          value: number
        }
        Insert: {
          captured_at?: string
          format_config_id: string
          id?: string
          metadata?: Json | null
          player_id: string
          source: string
          value: number
        }
        Update: {
          captured_at?: string
          format_config_id?: string
          id?: string
          metadata?: Json | null
          player_id?: string
          source?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "player_value_history_format_config_id_fkey"
            columns: ["format_config_id"]
            isOneToOne: false
            referencedRelation: "format_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_value_history_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      player_value_trends: {
        Row: {
          change_30d: number | null
          change_30d_pct: number | null
          change_7d: number | null
          change_7d_pct: number | null
          change_90d: number | null
          change_90d_pct: number | null
          current_value: number
          data_points_30d: number
          format_config_id: string
          high_30d: number | null
          id: string
          low_30d: number | null
          player_id: string
          rank_30d_ago: number | null
          rank_7d_ago: number | null
          rank_90d_ago: number | null
          rank_change_30d: number | null
          rank_change_7d: number | null
          rank_change_90d: number | null
          source: string
          trend_30d: string | null
          trend_7d: string | null
          updated_at: string
          value_30d_ago: number | null
          value_7d_ago: number | null
          value_90d_ago: number | null
          volatility_30d: number | null
        }
        Insert: {
          change_30d?: number | null
          change_30d_pct?: number | null
          change_7d?: number | null
          change_7d_pct?: number | null
          change_90d?: number | null
          change_90d_pct?: number | null
          current_value: number
          data_points_30d?: number
          format_config_id: string
          high_30d?: number | null
          id?: string
          low_30d?: number | null
          player_id: string
          rank_30d_ago?: number | null
          rank_7d_ago?: number | null
          rank_90d_ago?: number | null
          rank_change_30d?: number | null
          rank_change_7d?: number | null
          rank_change_90d?: number | null
          source: string
          trend_30d?: string | null
          trend_7d?: string | null
          updated_at?: string
          value_30d_ago?: number | null
          value_7d_ago?: number | null
          value_90d_ago?: number | null
          volatility_30d?: number | null
        }
        Update: {
          change_30d?: number | null
          change_30d_pct?: number | null
          change_7d?: number | null
          change_7d_pct?: number | null
          change_90d?: number | null
          change_90d_pct?: number | null
          current_value?: number
          data_points_30d?: number
          format_config_id?: string
          high_30d?: number | null
          id?: string
          low_30d?: number | null
          player_id?: string
          rank_30d_ago?: number | null
          rank_7d_ago?: number | null
          rank_90d_ago?: number | null
          rank_change_30d?: number | null
          rank_change_7d?: number | null
          rank_change_90d?: number | null
          source?: string
          trend_30d?: string | null
          trend_7d?: string | null
          updated_at?: string
          value_30d_ago?: number | null
          value_7d_ago?: number | null
          value_90d_ago?: number | null
          volatility_30d?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "player_value_trends_format_config_id_fkey"
            columns: ["format_config_id"]
            isOneToOne: false
            referencedRelation: "format_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_value_trends_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          birth_date: string | null
          college: string | null
          created_at: string
          draft_pick: number | null
          draft_round: number | null
          draft_year: number | null
          external_ids: Json
          first_name: string
          full_name: string | null
          height_inches: number | null
          id: string
          internal_attributes: Json
          last_name: string
          metadata: Json
          position: string
          slug: string
          source_synced_at: Json
          status: string
          team: string | null
          updated_at: string
          weight_lbs: number | null
          years_experience: number | null
        }
        Insert: {
          birth_date?: string | null
          college?: string | null
          created_at?: string
          draft_pick?: number | null
          draft_round?: number | null
          draft_year?: number | null
          external_ids?: Json
          first_name: string
          full_name?: string | null
          height_inches?: number | null
          id?: string
          internal_attributes?: Json
          last_name: string
          metadata?: Json
          position: string
          slug: string
          source_synced_at?: Json
          status?: string
          team?: string | null
          updated_at?: string
          weight_lbs?: number | null
          years_experience?: number | null
        }
        Update: {
          birth_date?: string | null
          college?: string | null
          created_at?: string
          draft_pick?: number | null
          draft_round?: number | null
          draft_year?: number | null
          external_ids?: Json
          first_name?: string
          full_name?: string | null
          height_inches?: number | null
          id?: string
          internal_attributes?: Json
          last_name?: string
          metadata?: Json
          position?: string
          slug?: string
          source_synced_at?: Json
          status?: string
          team?: string | null
          updated_at?: string
          weight_lbs?: number | null
          years_experience?: number | null
        }
        Relationships: []
      }
      projections: {
        Row: {
          ceiling_points: number | null
          confidence: string | null
          floor_points: number | null
          format_config_id: string
          generated_at: string
          id: string
          metadata: Json | null
          player_id: string
          projected_points: number
          reasoning: string | null
          season: number
          start_sit_verdict: string | null
          week: number
        }
        Insert: {
          ceiling_points?: number | null
          confidence?: string | null
          floor_points?: number | null
          format_config_id: string
          generated_at?: string
          id?: string
          metadata?: Json | null
          player_id: string
          projected_points: number
          reasoning?: string | null
          season: number
          start_sit_verdict?: string | null
          week: number
        }
        Update: {
          ceiling_points?: number | null
          confidence?: string | null
          floor_points?: number | null
          format_config_id?: string
          generated_at?: string
          id?: string
          metadata?: Json | null
          player_id?: string
          projected_points?: number
          reasoning?: string | null
          season?: number
          start_sit_verdict?: string | null
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "projections_format_config_id_fkey"
            columns: ["format_config_id"]
            isOneToOne: false
            referencedRelation: "format_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projections_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      rankings: {
        Row: {
          confidence: string | null
          format_config_id: string
          generated_at: string
          id: string
          metadata: Json | null
          notes: string | null
          overall_rank: number
          player_id: string
          position_rank: number
          season: number
          source: string
          tier: number | null
          trend: string | null
          week: number | null
        }
        Insert: {
          confidence?: string | null
          format_config_id: string
          generated_at?: string
          id?: string
          metadata?: Json | null
          notes?: string | null
          overall_rank: number
          player_id: string
          position_rank: number
          season: number
          source: string
          tier?: number | null
          trend?: string | null
          week?: number | null
        }
        Update: {
          confidence?: string | null
          format_config_id?: string
          generated_at?: string
          id?: string
          metadata?: Json | null
          notes?: string | null
          overall_rank?: number
          player_id?: string
          position_rank?: number
          season?: number
          source?: string
          tier?: number | null
          trend?: string | null
          week?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rankings_format_config_id_fkey"
            columns: ["format_config_id"]
            isOneToOne: false
            referencedRelation: "format_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rankings_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      rosters: {
        Row: {
          co_owners: Json
          created_at: string
          draft_pick_assets: Json
          id: string
          league_id: string
          losses: number
          metadata: Json
          owner_user_id: string | null
          player_ids: Json
          points_against: number
          points_for: number
          reserve_ids: Json
          sleeper_roster_id: number
          starter_ids: Json
          taxi_ids: Json
          ties: number
          updated_at: string
          waiver_budget: number | null
          waiver_position: number | null
          wins: number
        }
        Insert: {
          co_owners?: Json
          created_at?: string
          draft_pick_assets?: Json
          id?: string
          league_id: string
          losses?: number
          metadata?: Json
          owner_user_id?: string | null
          player_ids?: Json
          points_against?: number
          points_for?: number
          reserve_ids?: Json
          sleeper_roster_id: number
          starter_ids?: Json
          taxi_ids?: Json
          ties?: number
          updated_at?: string
          waiver_budget?: number | null
          waiver_position?: number | null
          wins?: number
        }
        Update: {
          co_owners?: Json
          created_at?: string
          draft_pick_assets?: Json
          id?: string
          league_id?: string
          losses?: number
          metadata?: Json
          owner_user_id?: string | null
          player_ids?: Json
          points_against?: number
          points_for?: number
          reserve_ids?: Json
          sleeper_roster_id?: number
          starter_ids?: Json
          taxi_ids?: Json
          ties?: number
          updated_at?: string
          waiver_budget?: number | null
          waiver_position?: number | null
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "rosters_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      source_registry: {
        Row: {
          created_at: string
          data_type: string[]
          description: string | null
          display_name: string
          is_active: boolean
          priority: number
          slug: string
          supported_format_slugs: string[] | null
        }
        Insert: {
          created_at?: string
          data_type: string[]
          description?: string | null
          display_name: string
          is_active?: boolean
          priority: number
          slug: string
          supported_format_slugs?: string[] | null
        }
        Update: {
          created_at?: string
          data_type?: string[]
          description?: string | null
          display_name?: string
          is_active?: boolean
          priority?: number
          slug?: string
          supported_format_slugs?: string[] | null
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          created_at: string
          default_format_config_id: string | null
          default_source_slug: string | null
          email_digest_enabled: boolean
          favorite_players: Json
          is_admin: boolean
          sleeper_username: string | null
          theme: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_format_config_id?: string | null
          default_source_slug?: string | null
          email_digest_enabled?: boolean
          favorite_players?: Json
          is_admin?: boolean
          sleeper_username?: string | null
          theme?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_format_config_id?: string | null
          default_source_slug?: string | null
          email_digest_enabled?: boolean
          favorite_players?: Json
          is_admin?: boolean
          sleeper_username?: string | null
          theme?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_default_format_config_id_fkey"
            columns: ["default_format_config_id"]
            isOneToOne: false
            referencedRelation: "format_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_preferences_default_source_slug_fkey"
            columns: ["default_source_slug"]
            isOneToOne: false
            referencedRelation: "source_registry"
            referencedColumns: ["slug"]
          },
        ]
      }
      vote_matchups: {
        Row: {
          analysis_generated_at: string | null
          analysis_md: string | null
          created_at: string
          format_config_id: string
          id: string
          is_active: boolean
          player_a_id: string
          player_b_id: string
          season: number
          slug: string
          votes_a: number
          votes_b: number
          week: number | null
        }
        Insert: {
          analysis_generated_at?: string | null
          analysis_md?: string | null
          created_at?: string
          format_config_id: string
          id?: string
          is_active?: boolean
          player_a_id: string
          player_b_id: string
          season: number
          slug: string
          votes_a?: number
          votes_b?: number
          week?: number | null
        }
        Update: {
          analysis_generated_at?: string | null
          analysis_md?: string | null
          created_at?: string
          format_config_id?: string
          id?: string
          is_active?: boolean
          player_a_id?: string
          player_b_id?: string
          season?: number
          slug?: string
          votes_a?: number
          votes_b?: number
          week?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vote_matchups_format_config_id_fkey"
            columns: ["format_config_id"]
            isOneToOne: false
            referencedRelation: "format_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vote_matchups_player_a_id_fkey"
            columns: ["player_a_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vote_matchups_player_b_id_fkey"
            columns: ["player_b_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      votes: {
        Row: {
          chose: string
          id: string
          matchup_id: string
          user_id: string
          voted_at: string
        }
        Insert: {
          chose: string
          id?: string
          matchup_id: string
          user_id: string
          voted_at?: string
        }
        Update: {
          chose?: string
          id?: string
          matchup_id?: string
          user_id?: string
          voted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "votes_matchup_id_fkey"
            columns: ["matchup_id"]
            isOneToOne: false
            referencedRelation: "vote_matchups"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
