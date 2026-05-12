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
      activities: {
        Row: {
          active: boolean | null
          color: string | null
          created_at: string | null
          default_capacity: number
          default_level: string | null
          description: string | null
          duration_min: number
          gym_id: string
          icon: string | null
          id: string
          image_url: string | null
          name: string
          requires_medical_check: boolean | null
          slug: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          color?: string | null
          created_at?: string | null
          default_capacity?: number
          default_level?: string | null
          description?: string | null
          duration_min?: number
          gym_id: string
          icon?: string | null
          id?: string
          image_url?: string | null
          name: string
          requires_medical_check?: boolean | null
          slug: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          color?: string | null
          created_at?: string | null
          default_capacity?: number
          default_level?: string | null
          description?: string | null
          duration_min?: number
          gym_id?: string
          icon?: string | null
          id?: string
          image_url?: string | null
          name?: string
          requires_medical_check?: boolean | null
          slug?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_translations: {
        Row: {
          activity_id: string
          created_at: string | null
          description: string | null
          id: string
          language: string
          name: string
          updated_at: string | null
        }
        Insert: {
          activity_id: string
          created_at?: string | null
          description?: string | null
          id?: string
          language: string
          name: string
          updated_at?: string | null
        }
        Update: {
          activity_id?: string
          created_at?: string | null
          description?: string | null
          id?: string
          language?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_translations_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string | null
          gym_id: string | null
          id: string
          ip_address: unknown
          new_data: Json | null
          old_data: Json | null
          resource: string
          resource_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string | null
          gym_id?: string | null
          id?: string
          ip_address?: unknown
          new_data?: Json | null
          old_data?: Json | null
          resource: string
          resource_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string | null
          gym_id?: string | null
          id?: string
          ip_address?: unknown
          new_data?: Json | null
          old_data?: Json | null
          resource?: string
          resource_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          booked_at: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          checked_in_at: string | null
          checked_in_method: string | null
          gym_id: string
          id: string
          idempotency_key: string | null
          is_late_cancel: boolean | null
          member_id: string
          promoted_from_waitlist_at: string | null
          slot_id: string
          status: string | null
          subscription_id: string | null
          updated_at: string | null
          waitlist_position: number | null
        }
        Insert: {
          booked_at?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          checked_in_at?: string | null
          checked_in_method?: string | null
          gym_id: string
          id?: string
          idempotency_key?: string | null
          is_late_cancel?: boolean | null
          member_id: string
          promoted_from_waitlist_at?: string | null
          slot_id: string
          status?: string | null
          subscription_id?: string | null
          updated_at?: string | null
          waitlist_position?: number | null
        }
        Update: {
          booked_at?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          checked_in_at?: string | null
          checked_in_method?: string | null
          gym_id?: string
          id?: string
          idempotency_key?: string | null
          is_late_cancel?: boolean | null
          member_id?: string
          promoted_from_waitlist_at?: string | null
          slot_id?: string
          status?: string | null
          subscription_id?: string | null
          updated_at?: string | null
          waitlist_position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "time_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "member_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_sites: {
        Row: {
          coach_id: string
          site_id: string
        }
        Insert: {
          coach_id: string
          site_id: string
        }
        Update: {
          coach_id?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_sites_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_sites_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "gym_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      coaches: {
        Row: {
          active: boolean | null
          bio: string | null
          created_at: string | null
          gym_id: string
          id: string
          name: string
          photo_url: string | null
          profile_id: string | null
          sort_order: number | null
          specialties: string[] | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          bio?: string | null
          created_at?: string | null
          gym_id: string
          id?: string
          name: string
          photo_url?: string | null
          profile_id?: string | null
          sort_order?: number | null
          specialties?: string[] | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          bio?: string | null
          created_at?: string | null
          gym_id?: string
          id?: string
          name?: string
          photo_url?: string | null
          profile_id?: string | null
          sort_order?: number | null
          specialties?: string[] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coaches_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coaches_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_history: {
        Row: {
          consent_type: string
          created_at: string | null
          granted: boolean
          id: string
          ip_address: unknown
          user_agent: string | null
          user_id: string
          version: string
        }
        Insert: {
          consent_type: string
          created_at?: string | null
          granted: boolean
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id: string
          version: string
        }
        Update: {
          consent_type?: string
          created_at?: string | null
          granted?: boolean
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          added_at: string | null
          gym_id: string
          id: string
          member_id: string
          slot_id: string
        }
        Insert: {
          added_at?: string | null
          gym_id: string
          id?: string
          member_id: string
          slot_id: string
        }
        Update: {
          added_at?: string | null
          gym_id?: string
          id?: string
          member_id?: string
          slot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "time_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      gdpr_requests: {
        Row: {
          completed_at: string | null
          created_at: string | null
          export_expires_at: string | null
          export_url: string | null
          gym_id: string | null
          id: string
          must_complete_by: string | null
          reason: string | null
          rejection_reason: string | null
          request_type: string
          status: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          export_expires_at?: string | null
          export_url?: string | null
          gym_id?: string | null
          id?: string
          must_complete_by?: string | null
          reason?: string | null
          rejection_reason?: string | null
          request_type: string
          status?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          export_expires_at?: string | null
          export_url?: string | null
          gym_id?: string | null
          id?: string
          must_complete_by?: string | null
          reason?: string | null
          rejection_reason?: string | null
          request_type?: string
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gdpr_requests_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gdpr_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gym_admin_actions: {
        Row: {
          action_type: string
          admin_id: string
          created_at: string | null
          gym_id: string
          id: string
          metadata: Json | null
          reason: string | null
          target_id: string
        }
        Insert: {
          action_type: string
          admin_id: string
          created_at?: string | null
          gym_id: string
          id?: string
          metadata?: Json | null
          reason?: string | null
          target_id: string
        }
        Update: {
          action_type?: string
          admin_id?: string
          created_at?: string | null
          gym_id?: string
          id?: string
          metadata?: Json | null
          reason?: string | null
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gym_admin_actions_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gym_admin_actions_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gym_admin_actions_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gym_mollie_connections: {
        Row: {
          access_token_vault_id: string | null
          connected_at: string | null
          expires_at: string | null
          gym_id: string
          id: string
          last_refreshed_at: string | null
          mollie_account_id: string | null
          mollie_account_name: string | null
          mollie_profile_id: string | null
          refresh_token_vault_id: string | null
          scope: string[] | null
          status: string | null
        }
        Insert: {
          access_token_vault_id?: string | null
          connected_at?: string | null
          expires_at?: string | null
          gym_id: string
          id?: string
          last_refreshed_at?: string | null
          mollie_account_id?: string | null
          mollie_account_name?: string | null
          mollie_profile_id?: string | null
          refresh_token_vault_id?: string | null
          scope?: string[] | null
          status?: string | null
        }
        Update: {
          access_token_vault_id?: string | null
          connected_at?: string | null
          expires_at?: string | null
          gym_id?: string
          id?: string
          last_refreshed_at?: string | null
          mollie_account_id?: string | null
          mollie_account_name?: string | null
          mollie_profile_id?: string | null
          refresh_token_vault_id?: string | null
          scope?: string[] | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gym_mollie_connections_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: true
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      gym_plan_translations: {
        Row: {
          created_at: string | null
          description: string | null
          features: string[] | null
          id: string
          language: string
          name: string
          plan_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          features?: string[] | null
          id?: string
          language: string
          name: string
          plan_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          features?: string[] | null
          id?: string
          language?: string
          name?: string
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gym_plan_translations_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "gym_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      gym_plans: {
        Row: {
          active: boolean | null
          billing_type: string | null
          created_at: string | null
          credit_count: number | null
          currency: string | null
          description: string | null
          duration_months: number | null
          features: string[] | null
          gym_id: string
          id: string
          is_popular: boolean | null
          name: string
          price_cents: number
          site_access: string | null
          sort_order: number | null
          type: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          billing_type?: string | null
          created_at?: string | null
          credit_count?: number | null
          currency?: string | null
          description?: string | null
          duration_months?: number | null
          features?: string[] | null
          gym_id: string
          id?: string
          is_popular?: boolean | null
          name: string
          price_cents: number
          site_access?: string | null
          sort_order?: number | null
          type: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          billing_type?: string | null
          created_at?: string | null
          credit_count?: number | null
          currency?: string | null
          description?: string | null
          duration_months?: number | null
          features?: string[] | null
          gym_id?: string
          id?: string
          is_popular?: boolean | null
          name?: string
          price_cents?: number
          site_access?: string | null
          sort_order?: number | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gym_plans_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      gym_sites: {
        Row: {
          active: boolean | null
          address: string
          city: string
          country: string | null
          created_at: string | null
          email: string | null
          gym_id: string
          id: string
          is_main_site: boolean | null
          latitude: number | null
          longitude: number | null
          name: string
          phone: string | null
          postal_code: string | null
          slug: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          address: string
          city: string
          country?: string | null
          created_at?: string | null
          email?: string | null
          gym_id: string
          id?: string
          is_main_site?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name: string
          phone?: string | null
          postal_code?: string | null
          slug: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          address?: string
          city?: string
          country?: string | null
          created_at?: string | null
          email?: string | null
          gym_id?: string
          id?: string
          is_main_site?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          phone?: string | null
          postal_code?: string | null
          slug?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gym_sites_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      gym_transactions: {
        Row: {
          amount_cents: number
          created_at: string | null
          currency: string | null
          description: string | null
          gym_id: string
          id: string
          idempotency_key: string | null
          invoice_number: string | null
          member_id: string | null
          mollie_order_id: string | null
          mollie_payment_id: string | null
          paid_at: string | null
          payment_method: string | null
          refunded_at: string | null
          status: string | null
          subscription_id: string | null
          total_cents: number
          vat_cents: number | null
        }
        Insert: {
          amount_cents: number
          created_at?: string | null
          currency?: string | null
          description?: string | null
          gym_id: string
          id?: string
          idempotency_key?: string | null
          invoice_number?: string | null
          member_id?: string | null
          mollie_order_id?: string | null
          mollie_payment_id?: string | null
          paid_at?: string | null
          payment_method?: string | null
          refunded_at?: string | null
          status?: string | null
          subscription_id?: string | null
          total_cents: number
          vat_cents?: number | null
        }
        Update: {
          amount_cents?: number
          created_at?: string | null
          currency?: string | null
          description?: string | null
          gym_id?: string
          id?: string
          idempotency_key?: string | null
          invoice_number?: string | null
          member_id?: string | null
          mollie_order_id?: string | null
          mollie_payment_id?: string | null
          paid_at?: string | null
          payment_method?: string | null
          refunded_at?: string | null
          status?: string | null
          subscription_id?: string | null
          total_cents?: number
          vat_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gym_transactions_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gym_transactions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gym_transactions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "member_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      impersonation_logs: {
        Row: {
          ended_at: string | null
          id: string
          ip_address: unknown
          reason: string
          started_at: string | null
          super_admin_id: string
          target_gym_id: string | null
          target_user_id: string
        }
        Insert: {
          ended_at?: string | null
          id?: string
          ip_address?: unknown
          reason: string
          started_at?: string | null
          super_admin_id: string
          target_gym_id?: string | null
          target_user_id: string
        }
        Update: {
          ended_at?: string | null
          id?: string
          ip_address?: unknown
          reason?: string
          started_at?: string | null
          super_admin_id?: string
          target_gym_id?: string | null
          target_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "impersonation_logs_super_admin_id_fkey"
            columns: ["super_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impersonation_logs_target_gym_id_fkey"
            columns: ["target_gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impersonation_logs_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      login_attempts: {
        Row: {
          created_at: string | null
          email: string | null
          failure_reason: string | null
          id: string
          ip_address: unknown
          success: boolean | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          failure_reason?: string | null
          id?: string
          ip_address?: unknown
          success?: boolean | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          failure_reason?: string | null
          id?: string
          ip_address?: unknown
          success?: boolean | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "login_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      medical_notes: {
        Row: {
          certificate_expires_at: string | null
          certificate_url: string | null
          conditions_encrypted: string | null
          created_at: string | null
          encrypted_at: string | null
          encrypted_by: string | null
          gym_id: string
          has_medical_certificate: boolean | null
          id: string
          member_id: string
          notes_encrypted: string | null
          restricted_activities: string[] | null
          reviewed_at: string | null
          reviewed_by: string | null
          updated_at: string | null
        }
        Insert: {
          certificate_expires_at?: string | null
          certificate_url?: string | null
          conditions_encrypted?: string | null
          created_at?: string | null
          encrypted_at?: string | null
          encrypted_by?: string | null
          gym_id: string
          has_medical_certificate?: boolean | null
          id?: string
          member_id: string
          notes_encrypted?: string | null
          restricted_activities?: string[] | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string | null
        }
        Update: {
          certificate_expires_at?: string | null
          certificate_url?: string | null
          conditions_encrypted?: string | null
          created_at?: string | null
          encrypted_at?: string | null
          encrypted_by?: string | null
          gym_id?: string
          has_medical_certificate?: boolean | null
          id?: string
          member_id?: string
          notes_encrypted?: string | null
          restricted_activities?: string[] | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medical_notes_encrypted_by_fkey"
            columns: ["encrypted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_notes_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_notes_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_notes_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      member_subscriptions: {
        Row: {
          auto_renew: boolean | null
          cancellation_reason: string | null
          cancelled_at: string | null
          created_at: string | null
          credits_remaining: number | null
          credits_total: number | null
          ends_at: string | null
          gym_id: string
          id: string
          member_id: string
          mollie_customer_id: string | null
          mollie_subscription_id: string | null
          pause_resumes_at: string | null
          paused_at: string | null
          plan_id: string
          site_id: string | null
          starts_at: string
          status: string | null
          suspended_until: string | null
          updated_at: string | null
        }
        Insert: {
          auto_renew?: boolean | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string | null
          credits_remaining?: number | null
          credits_total?: number | null
          ends_at?: string | null
          gym_id: string
          id?: string
          member_id: string
          mollie_customer_id?: string | null
          mollie_subscription_id?: string | null
          pause_resumes_at?: string | null
          paused_at?: string | null
          plan_id: string
          site_id?: string | null
          starts_at: string
          status?: string | null
          suspended_until?: string | null
          updated_at?: string | null
        }
        Update: {
          auto_renew?: boolean | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string | null
          credits_remaining?: number | null
          credits_total?: number | null
          ends_at?: string | null
          gym_id?: string
          id?: string
          member_id?: string
          mollie_customer_id?: string | null
          mollie_subscription_id?: string | null
          pause_resumes_at?: string | null
          paused_at?: string | null
          plan_id?: string
          site_id?: string | null
          starts_at?: string
          status?: string | null
          suspended_until?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_subscriptions_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_subscriptions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "gym_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_subscriptions_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "gym_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      nexxia_features: {
        Row: {
          config: Json | null
          enabled: boolean | null
          feature: string
          gym_id: string
          id: string
          updated_at: string | null
        }
        Insert: {
          config?: Json | null
          enabled?: boolean | null
          feature: string
          gym_id: string
          id?: string
          updated_at?: string | null
        }
        Update: {
          config?: Json | null
          enabled?: boolean | null
          feature?: string
          gym_id?: string
          id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nexxia_features_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      nexxia_gyms: {
        Row: {
          address: string | null
          city: string | null
          company_name: string | null
          country: string | null
          created_at: string | null
          currency: string | null
          default_language: string | null
          deleted_at: string | null
          dpo_email: string | null
          dpo_name: string | null
          email: string | null
          id: string
          logo_url: string | null
          mollie_profile_id: string | null
          mollie_vault_secret_id: string | null
          name: string
          onboarding_completed: boolean | null
          onboarding_step: number | null
          phone: string | null
          plan: string | null
          postal_code: string | null
          primary_color: string | null
          secondary_color: string | null
          slug: string
          status: string | null
          subdomain: string | null
          supported_languages: string[] | null
          timezone: string | null
          trial_ends_at: string | null
          trial_started_at: string | null
          updated_at: string | null
          vat_number: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          default_language?: string | null
          deleted_at?: string | null
          dpo_email?: string | null
          dpo_name?: string | null
          email?: string | null
          id?: string
          logo_url?: string | null
          mollie_profile_id?: string | null
          mollie_vault_secret_id?: string | null
          name: string
          onboarding_completed?: boolean | null
          onboarding_step?: number | null
          phone?: string | null
          plan?: string | null
          postal_code?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          slug: string
          status?: string | null
          subdomain?: string | null
          supported_languages?: string[] | null
          timezone?: string | null
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string | null
          vat_number?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          default_language?: string | null
          deleted_at?: string | null
          dpo_email?: string | null
          dpo_name?: string | null
          email?: string | null
          id?: string
          logo_url?: string | null
          mollie_profile_id?: string | null
          mollie_vault_secret_id?: string | null
          name?: string
          onboarding_completed?: boolean | null
          onboarding_step?: number | null
          phone?: string | null
          plan?: string | null
          postal_code?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          slug?: string
          status?: string | null
          subdomain?: string | null
          supported_languages?: string[] | null
          timezone?: string | null
          trial_ends_at?: string | null
          trial_started_at?: string | null
          updated_at?: string | null
          vat_number?: string | null
        }
        Relationships: []
      }
      nexxia_invoices: {
        Row: {
          amount_cents: number
          created_at: string | null
          currency: string | null
          due_at: string | null
          gym_id: string
          id: string
          invoice_number: string
          mollie_payment_id: string | null
          paid_at: string | null
          pdf_url: string | null
          status: string | null
          subscription_id: string | null
          total_cents: number
          vat_cents: number | null
        }
        Insert: {
          amount_cents: number
          created_at?: string | null
          currency?: string | null
          due_at?: string | null
          gym_id: string
          id?: string
          invoice_number: string
          mollie_payment_id?: string | null
          paid_at?: string | null
          pdf_url?: string | null
          status?: string | null
          subscription_id?: string | null
          total_cents: number
          vat_cents?: number | null
        }
        Update: {
          amount_cents?: number
          created_at?: string | null
          currency?: string | null
          due_at?: string | null
          gym_id?: string
          id?: string
          invoice_number?: string
          mollie_payment_id?: string | null
          paid_at?: string | null
          pdf_url?: string | null
          status?: string | null
          subscription_id?: string | null
          total_cents?: number
          vat_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nexxia_invoices_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nexxia_invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "nexxia_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      nexxia_plan_limits: {
        Row: {
          analytics_enabled: boolean | null
          android_app_enabled: boolean | null
          api_access_enabled: boolean | null
          created_at: string | null
          custom_domain: boolean | null
          export_enabled: boolean | null
          id: string
          ios_app_enabled: boolean | null
          max_admins: number | null
          max_members: number | null
          max_sites: number | null
          max_slots_per_month: number | null
          multi_site_enabled: boolean | null
          notifications_enabled: boolean | null
          payments_enabled: boolean | null
          plan: string
          price_cents: number | null
          qr_checkin_enabled: boolean | null
          trial_days: number | null
        }
        Insert: {
          analytics_enabled?: boolean | null
          android_app_enabled?: boolean | null
          api_access_enabled?: boolean | null
          created_at?: string | null
          custom_domain?: boolean | null
          export_enabled?: boolean | null
          id?: string
          ios_app_enabled?: boolean | null
          max_admins?: number | null
          max_members?: number | null
          max_sites?: number | null
          max_slots_per_month?: number | null
          multi_site_enabled?: boolean | null
          notifications_enabled?: boolean | null
          payments_enabled?: boolean | null
          plan: string
          price_cents?: number | null
          qr_checkin_enabled?: boolean | null
          trial_days?: number | null
        }
        Update: {
          analytics_enabled?: boolean | null
          android_app_enabled?: boolean | null
          api_access_enabled?: boolean | null
          created_at?: string | null
          custom_domain?: boolean | null
          export_enabled?: boolean | null
          id?: string
          ios_app_enabled?: boolean | null
          max_admins?: number | null
          max_members?: number | null
          max_sites?: number | null
          max_slots_per_month?: number | null
          multi_site_enabled?: boolean | null
          notifications_enabled?: boolean | null
          payments_enabled?: boolean | null
          plan?: string
          price_cents?: number | null
          qr_checkin_enabled?: boolean | null
          trial_days?: number | null
        }
        Relationships: []
      }
      nexxia_subscriptions: {
        Row: {
          amount_cents: number
          billing_cycle: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          commitment_ends_at: string | null
          commitment_months: number | null
          created_at: string | null
          currency: string | null
          current_period_end: string | null
          current_period_start: string | null
          gym_id: string
          id: string
          mollie_customer_id: string | null
          mollie_subscription_id: string | null
          plan: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          amount_cents: number
          billing_cycle?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          commitment_ends_at?: string | null
          commitment_months?: number | null
          created_at?: string | null
          currency?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          gym_id: string
          id?: string
          mollie_customer_id?: string | null
          mollie_subscription_id?: string | null
          plan: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          amount_cents?: number
          billing_cycle?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          commitment_ends_at?: string | null
          commitment_months?: number | null
          created_at?: string | null
          currency?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          gym_id?: string
          id?: string
          mollie_customer_id?: string | null
          mollie_subscription_id?: string | null
          plan?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nexxia_subscriptions_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      noshow_rules: {
        Row: {
          active: boolean | null
          created_at: string | null
          gym_id: string
          id: string
          late_cancel_hours: number | null
          max_active_bookings: number | null
          reset_after_days: number | null
          suspension_at: number | null
          suspension_hours: number | null
          updated_at: string | null
          warning_1_at: number | null
          warning_2_at: number | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          gym_id: string
          id?: string
          late_cancel_hours?: number | null
          max_active_bookings?: number | null
          reset_after_days?: number | null
          suspension_at?: number | null
          suspension_hours?: number | null
          updated_at?: string | null
          warning_1_at?: number | null
          warning_2_at?: number | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          gym_id?: string
          id?: string
          late_cancel_hours?: number | null
          max_active_bookings?: number | null
          reset_after_days?: number | null
          suspension_at?: number | null
          suspension_hours?: number | null
          updated_at?: string | null
          warning_1_at?: number | null
          warning_2_at?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "noshow_rules_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: true
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string | null
          data: Json | null
          email_sent: boolean | null
          gym_id: string
          id: string
          member_id: string
          push_sent: boolean | null
          read: boolean | null
          read_at: string | null
          sent_at: string | null
          title: string
          type: string
        }
        Insert: {
          body: string
          created_at?: string | null
          data?: Json | null
          email_sent?: boolean | null
          gym_id: string
          id?: string
          member_id: string
          push_sent?: boolean | null
          read?: boolean | null
          read_at?: string | null
          sent_at?: string | null
          title: string
          type: string
        }
        Update: {
          body?: string
          created_at?: string | null
          data?: Json | null
          email_sent?: boolean | null
          gym_id?: string
          id?: string
          member_id?: string
          push_sent?: boolean | null
          read?: boolean | null
          read_at?: string | null
          sent_at?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_states: {
        Row: {
          created_at: string | null
          expires_at: string
          gym_id: string
          id: string
          state: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          gym_id: string
          id?: string
          state: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          gym_id?: string
          id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_states_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      penalties: {
        Row: {
          applied_at: string | null
          booking_id: string | null
          expires_at: string | null
          gym_id: string
          id: string
          member_id: string
          notes: string | null
          type: string
        }
        Insert: {
          applied_at?: string | null
          booking_id?: string | null
          expires_at?: string | null
          gym_id: string
          id?: string
          member_id: string
          notes?: string | null
          type: string
        }
        Update: {
          applied_at?: string | null
          booking_id?: string | null
          expires_at?: string | null
          gym_id?: string
          id?: string
          member_id?: string
          notes?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "penalties_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penalties_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "penalties_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address_line: string | null
          avatar_url: string | null
          city: string | null
          country: string | null
          created_at: string | null
          data_processing_consent: boolean | null
          data_processing_consent_at: string | null
          date_of_birth: string | null
          deleted_at: string | null
          deletion_requested_at: string | null
          email: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          first_name: string | null
          gender: string | null
          gym_id: string | null
          id: string
          last_name: string | null
          last_seen_at: string | null
          marketing_consent: boolean | null
          marketing_consent_at: string | null
          member_since: string | null
          noshow_count: number | null
          phone: string | null
          postal_code: string | null
          preferred_language: string | null
          privacy_policy_accepted_at: string | null
          privacy_policy_version: string | null
          profile_completion: number | null
          reward_unlocked: boolean | null
          role: string
          suspended_until: string | null
          terms_accepted_at: string | null
          terms_version: string | null
          two_factor_enabled: boolean | null
          two_factor_required: boolean | null
          updated_at: string | null
        }
        Insert: {
          address_line?: string | null
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          data_processing_consent?: boolean | null
          data_processing_consent_at?: string | null
          date_of_birth?: string | null
          deleted_at?: string | null
          deletion_requested_at?: string | null
          email: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          first_name?: string | null
          gender?: string | null
          gym_id?: string | null
          id: string
          last_name?: string | null
          last_seen_at?: string | null
          marketing_consent?: boolean | null
          marketing_consent_at?: string | null
          member_since?: string | null
          noshow_count?: number | null
          phone?: string | null
          postal_code?: string | null
          preferred_language?: string | null
          privacy_policy_accepted_at?: string | null
          privacy_policy_version?: string | null
          profile_completion?: number | null
          reward_unlocked?: boolean | null
          role: string
          suspended_until?: string | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          two_factor_enabled?: boolean | null
          two_factor_required?: boolean | null
          updated_at?: string | null
        }
        Update: {
          address_line?: string | null
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          data_processing_consent?: boolean | null
          data_processing_consent_at?: string | null
          date_of_birth?: string | null
          deleted_at?: string | null
          deletion_requested_at?: string | null
          email?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          first_name?: string | null
          gender?: string | null
          gym_id?: string | null
          id?: string
          last_name?: string | null
          last_seen_at?: string | null
          marketing_consent?: boolean | null
          marketing_consent_at?: string | null
          member_since?: string | null
          noshow_count?: number | null
          phone?: string | null
          postal_code?: string | null
          preferred_language?: string | null
          privacy_policy_accepted_at?: string | null
          privacy_policy_version?: string | null
          profile_completion?: number | null
          reward_unlocked?: boolean | null
          role?: string
          suspended_until?: string | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          two_factor_enabled?: boolean | null
          two_factor_required?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          action: string
          attempts: number | null
          blocked_until: string | null
          created_at: string | null
          id: string
          identifier: string
          window_start: string | null
        }
        Insert: {
          action: string
          attempts?: number | null
          blocked_until?: string | null
          created_at?: string | null
          id?: string
          identifier: string
          window_start?: string | null
        }
        Update: {
          action?: string
          attempts?: number | null
          blocked_until?: string | null
          created_at?: string | null
          id?: string
          identifier?: string
          window_start?: string | null
        }
        Relationships: []
      }
      super_admin_proxy_actions: {
        Row: {
          action_type: string
          created_at: string | null
          id: string
          metadata: Json | null
          reason: string
          super_admin_id: string
          target_admin_id: string | null
          target_gym_id: string
        }
        Insert: {
          action_type: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          reason: string
          super_admin_id: string
          target_admin_id?: string | null
          target_gym_id: string
        }
        Update: {
          action_type?: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          reason?: string
          super_admin_id?: string
          target_admin_id?: string | null
          target_gym_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "super_admin_proxy_actions_super_admin_id_fkey"
            columns: ["super_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "super_admin_proxy_actions_target_admin_id_fkey"
            columns: ["target_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "super_admin_proxy_actions_target_gym_id_fkey"
            columns: ["target_gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
        ]
      }
      time_slots: {
        Row: {
          activity_id: string
          bookings_count: number | null
          cancellation_reason: string | null
          capacity: number
          coach_id: string | null
          created_at: string | null
          ends_at: string
          gym_id: string
          id: string
          level: string | null
          notes: string | null
          site_id: string | null
          starts_at: string
          status: string | null
          updated_at: string | null
          waitlist_count: number | null
        }
        Insert: {
          activity_id: string
          bookings_count?: number | null
          cancellation_reason?: string | null
          capacity: number
          coach_id?: string | null
          created_at?: string | null
          ends_at: string
          gym_id: string
          id?: string
          level?: string | null
          notes?: string | null
          site_id?: string | null
          starts_at: string
          status?: string | null
          updated_at?: string | null
          waitlist_count?: number | null
        }
        Update: {
          activity_id?: string
          bookings_count?: number | null
          cancellation_reason?: string | null
          capacity?: number
          coach_id?: string | null
          created_at?: string | null
          ends_at?: string
          gym_id?: string
          id?: string
          level?: string | null
          notes?: string | null
          site_id?: string | null
          starts_at?: string
          status?: string | null
          updated_at?: string | null
          waitlist_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "time_slots_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_slots_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coaches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_slots_gym_id_fkey"
            columns: ["gym_id"]
            isOneToOne: false
            referencedRelation: "nexxia_gyms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_slots_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "gym_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      user_devices: {
        Row: {
          active: boolean | null
          app_version: string | null
          created_at: string | null
          device_name: string | null
          device_type: string | null
          id: string
          last_used_at: string | null
          os_version: string | null
          push_provider: string | null
          push_token: string
          user_id: string
        }
        Insert: {
          active?: boolean | null
          app_version?: string | null
          created_at?: string | null
          device_name?: string | null
          device_type?: string | null
          id?: string
          last_used_at?: string | null
          os_version?: string | null
          push_provider?: string | null
          push_token: string
          user_id: string
        }
        Update: {
          active?: boolean | null
          app_version?: string | null
          created_at?: string | null
          device_name?: string | null
          device_type?: string | null
          id?: string
          last_used_at?: string | null
          os_version?: string | null
          push_provider?: string | null
          push_token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_devices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_rate_limit: {
        Args: {
          p_action: string
          p_identifier: string
          p_max_attempts?: number
          p_window_minutes?: number
        }
        Returns: boolean
      }
      cleanup_expired_favorites: { Args: never; Returns: undefined }
      cleanup_oauth_states: { Args: never; Returns: undefined }
      decrypt_medical: {
        Args: { ciphertext: string; secret_id: string }
        Returns: string
      }
      encrypt_medical: {
        Args: { plaintext: string; secret_id: string }
        Returns: string
      }
      get_my_gym_id: { Args: never; Returns: string }
      get_my_role: { Args: never; Returns: string }
      gym_has_feature: {
        Args: { p_feature: string; p_gym_id: string }
        Returns: boolean
      }
      is_gym_admin: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      request_account_deletion: { Args: { p_user_id: string }; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
