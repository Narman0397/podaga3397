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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      cluster_worker: {
        Row: {
          id: string
          last_result: Json
          ran_at: string
          traced: Json
        }
        Insert: {
          id: string
          last_result?: Json
          ran_at?: string
          traced?: Json
        }
        Update: {
          id?: string
          last_result?: Json
          ran_at?: string
          traced?: Json
        }
        Relationships: []
      }
      scan_history: {
        Row: {
          address: string
          id: string
          kind: string
          scanned_at: string
          summary: string
          user_id: string
        }
        Insert: {
          address: string
          id?: string
          kind: string
          scanned_at?: string
          summary?: string
          user_id: string
        }
        Update: {
          address?: string
          id?: string
          kind?: string
          scanned_at?: string
          summary?: string
          user_id?: string
        }
        Relationships: []
      }
      user_state: {
        Row: {
          data: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          data?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          data?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wallet_collect_state: {
        Row: {
          events_count: number
          history_complete: boolean
          last_error: string | null
          last_run_at: string | null
          newest_block_time: string | null
          newest_signature: string | null
          possible_gap: boolean
          updated_at: string
          wallet: string
        }
        Insert: {
          events_count?: number
          history_complete?: boolean
          last_error?: string | null
          last_run_at?: string | null
          newest_block_time?: string | null
          newest_signature?: string | null
          possible_gap?: boolean
          updated_at?: string
          wallet: string
        }
        Update: {
          events_count?: number
          history_complete?: boolean
          last_error?: string | null
          last_run_at?: string | null
          newest_block_time?: string | null
          newest_signature?: string | null
          possible_gap?: boolean
          updated_at?: string
          wallet?: string
        }
        Relationships: []
      }
      wallet_events: {
        Row: {
          activity: string
          block_time: string | null
          completeness: string
          direction: string | null
          event_index: number
          first_seen_at: string
          id: string
          last_seen_at: string
          mint: string | null
          normalizer_version: string
          parse_status: string
          price_sol: number | null
          raw_ref: Json
          signature: string
          slot: number | null
          sol_amount: number | null
          source: string
          token_amount: number | null
          wallet: string
        }
        Insert: {
          activity: string
          block_time?: string | null
          completeness: string
          direction?: string | null
          event_index: number
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          mint?: string | null
          normalizer_version: string
          parse_status: string
          price_sol?: number | null
          raw_ref?: Json
          signature: string
          slot?: number | null
          sol_amount?: number | null
          source: string
          token_amount?: number | null
          wallet: string
        }
        Update: {
          activity?: string
          block_time?: string | null
          completeness?: string
          direction?: string | null
          event_index?: number
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          mint?: string | null
          normalizer_version?: string
          parse_status?: string
          price_sol?: number | null
          raw_ref?: Json
          signature?: string
          slot?: number | null
          sol_amount?: number | null
          source?: string
          token_amount?: number | null
          wallet?: string
        }
        Relationships: []
      }
      wallet_tags: {
        Row: {
          address: string
          created_at: string
          id: string
          note: string
          perf: Json | null
          seen: number
          tag: string
          user_id: string
        }
        Insert: {
          address: string
          created_at?: string
          id?: string
          note?: string
          perf?: Json | null
          seen?: number
          tag: string
          user_id: string
        }
        Update: {
          address?: string
          created_at?: string
          id?: string
          note?: string
          perf?: Json | null
          seen?: number
          tag?: string
          user_id?: string
        }
        Relationships: []
      }
      wie_job_runs: {
        Row: {
          duration_ms: number | null
          error_count: number
          error_summary: string | null
          finished_at: string | null
          id: string
          job_name: string
          meta: Json
          records_inserted: number
          records_seen: number
          records_skipped: number
          records_updated: number
          source: string
          started_at: string
          status: string
        }
        Insert: {
          duration_ms?: number | null
          error_count?: number
          error_summary?: string | null
          finished_at?: string | null
          id?: string
          job_name: string
          meta?: Json
          records_inserted?: number
          records_seen?: number
          records_skipped?: number
          records_updated?: number
          source?: string
          started_at?: string
          status?: string
        }
        Update: {
          duration_ms?: number | null
          error_count?: number
          error_summary?: string | null
          finished_at?: string | null
          id?: string
          job_name?: string
          meta?: Json
          records_inserted?: number
          records_seen?: number
          records_skipped?: number
          records_updated?: number
          source?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      wie_try_lock: {
        Args: { _every_ms: number; _job: string }
        Returns: boolean
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
