CREATE TABLE "push_deliveries" (
	"live_session_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_deliveries_live_session_id_endpoint_type_pk" PRIMARY KEY("live_session_id","endpoint","type")
);
--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_live_session_id_live_sessions_id_fk" FOREIGN KEY ("live_session_id") REFERENCES "public"."live_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_endpoint_push_subscriptions_endpoint_fk" FOREIGN KEY ("endpoint") REFERENCES "public"."push_subscriptions"("endpoint") ON DELETE cascade ON UPDATE no action;