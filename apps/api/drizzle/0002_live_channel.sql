ALTER TABLE "live_sessions" ADD COLUMN "channel_provider" text;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD COLUMN "channel_id" text;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD COLUMN "channel_url" text;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD COLUMN "interrupted_at" timestamp with time zone;