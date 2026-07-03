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
      event_form_fields: {
        Row: {
          created_at: string
          event_id: string
          field_type: Database["public"]["Enums"]["field_type"]
          id: string
          is_required: boolean
          label: string
          options: Json | null
          sort_order: number
        }
        Insert: {
          created_at?: string
          event_id: string
          field_type: Database["public"]["Enums"]["field_type"]
          id?: string
          is_required?: boolean
          label: string
          options?: Json | null
          sort_order?: number
        }
        Update: {
          created_at?: string
          event_id?: string
          field_type?: Database["public"]["Enums"]["field_type"]
          id?: string
          is_required?: boolean
          label?: string
          options?: Json | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_form_fields_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_series: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          discord_webhook_url: string | null
          id: string
          logo_url: string | null
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          discord_webhook_url?: string | null
          id?: string
          logo_url?: string | null
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          discord_webhook_url?: string | null
          id?: string
          logo_url?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_series_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      event_tags: {
        Row: {
          event_id: string
          tag_id: string
        }
        Insert: {
          event_id: string
          tag_id: string
        }
        Update: {
          event_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_tags_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          allow_matching_choice: boolean
          auto_announce: boolean
          bonus_champion: number
          bonus_gm: number
          bonus_master: number
          capacity: number | null
          created_at: string
          current_count: number
          declared_seasons: number
          description: string | null
          discord_webhook_url: string | null
          ends_at: string | null
          entry_type: Database["public"]["Enums"]["entry_type"]
          format: Database["public"]["Enums"]["event_format"]
          game_id: string
          group_best_of: number
          id: string
          organizer_display_name: string | null
          organizer_id: string
          points_draw: number
          points_loss: number
          points_win: number
          ranking_enabled: boolean
          recruit_deadline: string | null
          require_battle_tag: boolean
          require_role: boolean
          require_score: boolean
          reserve_slots: number
          role_swap_allowed: boolean
          series_id: string | null
          slug: string | null
          starts_at: string | null
          status: Database["public"]["Enums"]["event_status"]
          team_formation: Database["public"]["Enums"]["team_formation"]
          team_score_cap: number | null
          tiebreakers: string[]
          title: string
          tournament_advance_count: number
          tournament_third_place: boolean
          uncertified_handling: Database["public"]["Enums"]["uncertified_handling"]
          updated_at: string
          version: number
        }
        Insert: {
          allow_matching_choice?: boolean
          auto_announce?: boolean
          bonus_champion?: number
          bonus_gm?: number
          bonus_master?: number
          capacity?: number | null
          created_at?: string
          current_count?: number
          declared_seasons?: number
          description?: string | null
          discord_webhook_url?: string | null
          ends_at?: string | null
          entry_type?: Database["public"]["Enums"]["entry_type"]
          format?: Database["public"]["Enums"]["event_format"]
          game_id: string
          group_best_of?: number
          id?: string
          organizer_display_name?: string | null
          organizer_id: string
          points_draw?: number
          points_loss?: number
          points_win?: number
          ranking_enabled?: boolean
          recruit_deadline?: string | null
          require_battle_tag?: boolean
          require_role?: boolean
          require_score?: boolean
          reserve_slots?: number
          role_swap_allowed?: boolean
          series_id?: string | null
          slug?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          team_formation?: Database["public"]["Enums"]["team_formation"]
          team_score_cap?: number | null
          tiebreakers?: string[]
          title: string
          tournament_advance_count?: number
          tournament_third_place?: boolean
          uncertified_handling?: Database["public"]["Enums"]["uncertified_handling"]
          updated_at?: string
          version?: number
        }
        Update: {
          allow_matching_choice?: boolean
          auto_announce?: boolean
          bonus_champion?: number
          bonus_gm?: number
          bonus_master?: number
          capacity?: number | null
          created_at?: string
          current_count?: number
          declared_seasons?: number
          description?: string | null
          discord_webhook_url?: string | null
          ends_at?: string | null
          entry_type?: Database["public"]["Enums"]["entry_type"]
          format?: Database["public"]["Enums"]["event_format"]
          game_id?: string
          group_best_of?: number
          id?: string
          organizer_display_name?: string | null
          organizer_id?: string
          points_draw?: number
          points_loss?: number
          points_win?: number
          ranking_enabled?: boolean
          recruit_deadline?: string | null
          require_battle_tag?: boolean
          require_role?: boolean
          require_score?: boolean
          reserve_slots?: number
          role_swap_allowed?: boolean
          series_id?: string | null
          slug?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          team_formation?: Database["public"]["Enums"]["team_formation"]
          team_score_cap?: number | null
          tiebreakers?: string[]
          title?: string
          tournament_advance_count?: number
          tournament_third_place?: boolean
          uncertified_handling?: Database["public"]["Enums"]["uncertified_handling"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "events_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "event_series"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          created_at: string
          follower_id: string
          id: string
          target_id: string
          target_type: Database["public"]["Enums"]["follow_target"]
        }
        Insert: {
          created_at?: string
          follower_id: string
          id?: string
          target_id: string
          target_type: Database["public"]["Enums"]["follow_target"]
        }
        Update: {
          created_at?: string
          follower_id?: string
          id?: string
          target_id?: string
          target_type?: Database["public"]["Enums"]["follow_target"]
        }
        Relationships: [
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          created_at: string
          id: string
          name: string
          roles: Database["public"]["Enums"]["role"][]
          team_size: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          roles: Database["public"]["Enums"]["role"][]
          team_size: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          roles?: Database["public"]["Enums"]["role"][]
          team_size?: number
        }
        Relationships: []
      }
      group_teams: {
        Row: {
          group_id: string
          team_id: string
        }
        Insert: {
          group_id: string
          team_id: string
        }
        Update: {
          group_id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_teams_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          event_id: string
          id: string
          name: string
        }
        Insert: {
          event_id: string
          id?: string
          name: string
        }
        Update: {
          event_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      match_lineups: {
        Row: {
          created_at: string
          id: string
          match_id: string
          team_id: string
          team_member_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_id: string
          team_id: string
          team_member_id: string
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string
          team_id?: string
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_lineups_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_lineups_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_lineups_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      match_results: {
        Row: {
          created_at: string
          match_id: string
          potg_a: number
          potg_b: number
          replay_codes: string[]
          reported_by: string | null
          team_a_score: number
          team_b_score: number
          updated_at: string
          winner_team_id: string | null
        }
        Insert: {
          created_at?: string
          match_id: string
          potg_a?: number
          potg_b?: number
          replay_codes?: string[]
          reported_by?: string | null
          team_a_score: number
          team_b_score: number
          updated_at?: string
          winner_team_id?: string | null
        }
        Update: {
          created_at?: string
          match_id?: string
          potg_a?: number
          potg_b?: number
          replay_codes?: string[]
          reported_by?: string | null
          team_a_score?: number
          team_b_score?: number
          updated_at?: string
          winner_team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_results_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: true
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_results_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_results_winner_team_id_fkey"
            columns: ["winner_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          best_of: number
          bracket_position: number | null
          created_at: string
          event_id: string
          group_id: string | null
          id: string
          notified_at: string | null
          phase: Database["public"]["Enums"]["match_phase"]
          replay_code: string | null
          round: number | null
          scheduled_at: string | null
          stream_url: string | null
          streamer_name: string | null
          team_a_id: string | null
          team_b_id: string | null
        }
        Insert: {
          best_of?: number
          bracket_position?: number | null
          created_at?: string
          event_id: string
          group_id?: string | null
          id?: string
          notified_at?: string | null
          phase: Database["public"]["Enums"]["match_phase"]
          replay_code?: string | null
          round?: number | null
          scheduled_at?: string | null
          stream_url?: string | null
          streamer_name?: string | null
          team_a_id?: string | null
          team_b_id?: string | null
        }
        Update: {
          best_of?: number
          bracket_position?: number | null
          created_at?: string
          event_id?: string
          group_id?: string | null
          id?: string
          notified_at?: string | null
          phase?: Database["public"]["Enums"]["match_phase"]
          replay_code?: string | null
          round?: number | null
          scheduled_at?: string | null
          stream_url?: string | null
          streamer_name?: string | null
          team_a_id?: string | null
          team_b_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "matches_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_team_a_id_fkey"
            columns: ["team_a_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_team_b_id_fkey"
            columns: ["team_b_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          channel: Database["public"]["Enums"]["delivery_channel"]
          created_at: string
          error: string | null
          id: string
          notification_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["delivery_status"]
          target_ref: string | null
        }
        Insert: {
          channel: Database["public"]["Enums"]["delivery_channel"]
          created_at?: string
          error?: string | null
          id?: string
          notification_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
          target_ref?: string | null
        }
        Update: {
          channel?: Database["public"]["Enums"]["delivery_channel"]
          created_at?: string
          error?: string | null
          id?: string
          notification_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
          target_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_events: {
        Row: {
          created_at: string
          dedup_key: string | null
          id: string
          payload: Json | null
          source_id: string
          source_type: Database["public"]["Enums"]["follow_target"]
          type: string
        }
        Insert: {
          created_at?: string
          dedup_key?: string | null
          id?: string
          payload?: Json | null
          source_id: string
          source_type: Database["public"]["Enums"]["follow_target"]
          type: string
        }
        Update: {
          created_at?: string
          dedup_key?: string | null
          id?: string
          payload?: Json | null
          source_id?: string
          source_type?: Database["public"]["Enums"]["follow_target"]
          type?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          link_url: string | null
          source_event_id: string
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link_url?: string | null
          source_event_id: string
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link_url?: string | null
          source_event_id?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "notification_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      rank_definitions: {
        Row: {
          division: number | null
          game_id: string
          id: string
          label: string
          score: number
          sort_order: number
          tier: string
        }
        Insert: {
          division?: number | null
          game_id: string
          id?: string
          label: string
          score: number
          sort_order: number
          tier: string
        }
        Update: {
          division?: number | null
          game_id?: string
          id?: string
          label?: string
          score?: number
          sort_order?: number
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "rank_definitions_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      registration_answers: {
        Row: {
          field_id: string
          id: string
          registration_id: string
          value: string | null
        }
        Insert: {
          field_id: string
          id?: string
          registration_id: string
          value?: string | null
        }
        Update: {
          field_id?: string
          id?: string
          registration_id?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registration_answers_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "event_form_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registration_answers_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      registrations: {
        Row: {
          assigned_role: Database["public"]["Enums"]["role"] | null
          created_at: string
          display_name: string | null
          event_id: string
          final_score: number | null
          id: string
          individual_score: number | null
          organizer_override_score: number | null
          preferred_role: Database["public"]["Enums"]["role"] | null
          preferred_role_1: Database["public"]["Enums"]["role"] | null
          preferred_role_2: Database["public"]["Enums"]["role"] | null
          preferred_role_3: Database["public"]["Enums"]["role"] | null
          score_breakdown: Json | null
          status: Database["public"]["Enums"]["reg_status"]
          updated_at: string
          user_id: string
          wants_matching: boolean | null
        }
        Insert: {
          assigned_role?: Database["public"]["Enums"]["role"] | null
          created_at?: string
          display_name?: string | null
          event_id: string
          final_score?: number | null
          id?: string
          individual_score?: number | null
          organizer_override_score?: number | null
          preferred_role?: Database["public"]["Enums"]["role"] | null
          preferred_role_1?: Database["public"]["Enums"]["role"] | null
          preferred_role_2?: Database["public"]["Enums"]["role"] | null
          preferred_role_3?: Database["public"]["Enums"]["role"] | null
          score_breakdown?: Json | null
          status?: Database["public"]["Enums"]["reg_status"]
          updated_at?: string
          user_id: string
          wants_matching?: boolean | null
        }
        Update: {
          assigned_role?: Database["public"]["Enums"]["role"] | null
          created_at?: string
          display_name?: string | null
          event_id?: string
          final_score?: number | null
          id?: string
          individual_score?: number | null
          organizer_override_score?: number | null
          preferred_role?: Database["public"]["Enums"]["role"] | null
          preferred_role_1?: Database["public"]["Enums"]["role"] | null
          preferred_role_2?: Database["public"]["Enums"]["role"] | null
          preferred_role_3?: Database["public"]["Enums"]["role"] | null
          score_breakdown?: Json | null
          status?: Database["public"]["Enums"]["reg_status"]
          updated_at?: string
          user_id?: string
          wants_matching?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      scrims: {
        Row: {
          created_at: string
          created_by: string
          id: string
          memo: string | null
          opponent_name: string | null
          opponent_team_id: string | null
          scheduled_at: string
          stream_url: string | null
          team_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          memo?: string | null
          opponent_name?: string | null
          opponent_team_id?: string | null
          scheduled_at: string
          stream_url?: string | null
          team_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          memo?: string | null
          opponent_name?: string | null
          opponent_team_id?: string | null
          scheduled_at?: string
          stream_url?: string | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scrims_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrims_opponent_team_id_fkey"
            columns: ["opponent_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrims_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      series_invites: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          max_uses: number | null
          role: Database["public"]["Enums"]["series_role"]
          series_id: string
          token: string
          used_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          role?: Database["public"]["Enums"]["series_role"]
          series_id: string
          token: string
          used_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          role?: Database["public"]["Enums"]["series_role"]
          series_id?: string
          token?: string
          used_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "series_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "series_invites_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "event_series"
            referencedColumns: ["id"]
          },
        ]
      }
      series_members: {
        Row: {
          id: string
          invited_at: string
          invited_by: string | null
          joined_at: string | null
          role: Database["public"]["Enums"]["series_role"]
          series_id: string
          status: Database["public"]["Enums"]["member_state"]
          user_id: string
        }
        Insert: {
          id?: string
          invited_at?: string
          invited_by?: string | null
          joined_at?: string | null
          role?: Database["public"]["Enums"]["series_role"]
          series_id: string
          status?: Database["public"]["Enums"]["member_state"]
          user_id: string
        }
        Update: {
          id?: string
          invited_at?: string
          invited_by?: string | null
          joined_at?: string | null
          role?: Database["public"]["Enums"]["series_role"]
          series_id?: string
          status?: Database["public"]["Enums"]["member_state"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "series_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "series_members_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "event_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "series_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      standings: {
        Row: {
          draws: number | null
          event_id: string
          group_id: string | null
          id: string
          losses: number | null
          points: number | null
          rank: number | null
          team_id: string
          updated_at: string
          wins: number | null
        }
        Insert: {
          draws?: number | null
          event_id: string
          group_id?: string | null
          id?: string
          losses?: number | null
          points?: number | null
          rank?: number | null
          team_id: string
          updated_at?: string
          wins?: number | null
        }
        Update: {
          draws?: number | null
          event_id?: string
          group_id?: string | null
          id?: string
          losses?: number | null
          points?: number | null
          rank?: number | null
          team_id?: string
          updated_at?: string
          wins?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "standings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standings_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standings_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          category: string | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      team_members: {
        Row: {
          created_at: string
          id: string
          is_representative: boolean
          position: Database["public"]["Enums"]["member_position"]
          registration_id: string
          role: Database["public"]["Enums"]["role"]
          team_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_representative?: boolean
          position?: Database["public"]["Enums"]["member_position"]
          registration_id: string
          role: Database["public"]["Enums"]["role"]
          team_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_representative?: boolean
          position?: Database["public"]["Enums"]["member_position"]
          registration_id?: string
          role?: Database["public"]["Enums"]["role"]
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: true
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          captain_registration_id: string | null
          created_at: string
          event_id: string
          id: string
          name: string
          status: Database["public"]["Enums"]["team_status"]
          version: number
        }
        Insert: {
          captain_registration_id?: string | null
          created_at?: string
          event_id: string
          id?: string
          name: string
          status?: Database["public"]["Enums"]["team_status"]
          version?: number
        }
        Update: {
          captain_registration_id?: string | null
          created_at?: string
          event_id?: string
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["team_status"]
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "teams_captain_registration_id_fkey"
            columns: ["captain_registration_id"]
            isOneToOne: false
            referencedRelation: "registrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      user_peak_achievement: {
        Row: {
          game_id: string
          peak_tier: Database["public"]["Enums"]["peak_tier"]
          updated_at: string
          user_id: string
        }
        Insert: {
          game_id: string
          peak_tier?: Database["public"]["Enums"]["peak_tier"]
          updated_at?: string
          user_id: string
        }
        Update: {
          game_id?: string
          peak_tier?: Database["public"]["Enums"]["peak_tier"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_peak_achievement_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_peak_achievement_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_season_ranks: {
        Row: {
          created_at: string
          game_id: string
          id: string
          rank_definition_id: string
          role: Database["public"]["Enums"]["role"]
          season_label: string
          season_order: number
          user_id: string
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          rank_definition_id: string
          role: Database["public"]["Enums"]["role"]
          season_label: string
          season_order: number
          user_id: string
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          rank_definition_id?: string
          role?: Database["public"]["Enums"]["role"]
          season_label?: string
          season_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_season_ranks_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_season_ranks_rank_definition_id_fkey"
            columns: ["rank_definition_id"]
            isOneToOne: false
            referencedRelation: "rank_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_season_ranks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          battle_tag: string | null
          created_at: string
          discord_avatar_url: string | null
          discord_dm_opt_in: boolean
          discord_id: string
          discord_name: string
          id: string
          is_admin: boolean
          updated_at: string
        }
        Insert: {
          battle_tag?: string | null
          created_at?: string
          discord_avatar_url?: string | null
          discord_dm_opt_in?: boolean
          discord_id: string
          discord_name: string
          id: string
          is_admin?: boolean
          updated_at?: string
        }
        Update: {
          battle_tag?: string | null
          created_at?: string
          discord_avatar_url?: string | null
          discord_dm_opt_in?: boolean
          discord_id?: string
          discord_name?: string
          id?: string
          is_admin?: boolean
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      list_follower_ids: {
        Args: {
          p_target_type: Database["public"]["Enums"]["follow_target"]
          p_target_id: string
        }
        Returns: string[]
      }
      upsert_notification_event: {
        Args: {
          p_type: string
          p_source_type: Database["public"]["Enums"]["follow_target"]
          p_source_id: string
          p_dedup_key: string
          p_payload?: Json
        }
        Returns: string
      }
      create_series_with_owner: {
        Args: {
          p_name: string
          p_description: string | null
          p_created_by: string
        }
        Returns: string
      }
      search_users_for_invite: {
        Args: {
          p_series_id: string
          p_query: string
        }
        Returns: {
          id: string
          discord_name: string
          battle_tag: string | null
          discord_avatar_url: string | null
        }[]
      }
      invite_series_member: {
        Args: {
          p_series_id: string
          p_user_id: string
        }
        Returns: string
      }
      respond_to_series_invite: {
        Args: {
          p_series_id: string
          p_accept: boolean
        }
        Returns: number
      }
      remove_series_member: {
        Args: {
          p_series_id: string
          p_user_id: string
        }
        Returns: number
      }
    }
    Enums: {
      delivery_channel: "discord_dm" | "discord_webhook"
      delivery_status: "pending" | "sent" | "failed" | "skipped"
      entry_type: "individual" | "team" | "mixed"
      event_format:
        | "round_robin"
        | "tournament"
        | "round_robin_then_tournament"
      event_status:
        | "draft"
        | "published"
        | "recruiting"
        | "closed"
        | "ongoing"
        | "finished"
      field_type: "text" | "textarea" | "select" | "url" | "number"
      follow_target: "series" | "event" | "user"
      match_phase: "group" | "tournament"
      member_position: "regular" | "reserve"
      member_state: "invited" | "active"
      peak_tier: "none" | "master" | "gm" | "champion"
      reg_status: "pending" | "approved" | "rejected" | "withdrawn"
      role: "tank" | "dps" | "support"
      series_role: "owner" | "admin"
      team_formation: "self" | "organizer" | "none"
      team_status: "pending" | "approved" | "rejected"
      uncertified_handling: "fill_by_role" | "fill_by_season" | "exclude"
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
      delivery_channel: ["discord_dm", "discord_webhook"],
      delivery_status: ["pending", "sent", "failed", "skipped"],
      entry_type: ["individual", "team", "mixed"],
      event_format: [
        "round_robin",
        "tournament",
        "round_robin_then_tournament",
      ],
      event_status: [
        "draft",
        "published",
        "recruiting",
        "closed",
        "ongoing",
        "finished",
      ],
      field_type: ["text", "textarea", "select", "url", "number"],
      follow_target: ["series", "event", "user"],
      match_phase: ["group", "tournament"],
      member_position: ["regular", "reserve"],
      member_state: ["invited", "active"],
      peak_tier: ["none", "master", "gm", "champion"],
      reg_status: ["pending", "approved", "rejected", "withdrawn"],
      role: ["tank", "dps", "support"],
      series_role: ["owner", "admin"],
      team_formation: ["self", "organizer", "none"],
      team_status: ["pending", "approved", "rejected"],
      uncertified_handling: ["fill_by_role", "fill_by_season", "exclude"],
    },
  },
} as const
