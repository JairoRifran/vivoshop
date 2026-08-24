CREATE TABLE "business_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"status" text DEFAULT 'unverified' NOT NULL,
	"legal_name" text,
	"tax_id" text,
	"responsible_name" text,
	"responsible_document" text,
	"commercial_address" text,
	"contact_phone" text,
	"contact_email" text,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewer" text,
	"reviewed_by" text,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"order_id" text PRIMARY KEY NOT NULL,
	"opened_by" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'unverified' NOT NULL,
	"full_name" text,
	"document_number" text,
	"document_type" text,
	"phone" text,
	"email" text,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewer" text,
	"reviewed_by_user_id" text,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"store_id" text NOT NULL,
	"provider" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"payment_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_webhook_events_provider_event_id_pk" PRIMARY KEY("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"purpose" text DEFAULT 'order' NOT NULL,
	"order_id" text,
	"store_id" text NOT NULL,
	"payer_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"currency" text NOT NULL,
	"gross_minor" integer NOT NULL,
	"commission_minor" integer NOT NULL,
	"commission_rate_bps" integer NOT NULL,
	"commission_policy" text NOT NULL,
	"net_minor" integer NOT NULL,
	"installments" integer DEFAULT 1 NOT NULL,
	"provider" text NOT NULL,
	"provider_intent_id" text,
	"provider_payment_id" text,
	"checkout_url" text,
	"failure_reason" text,
	"settlement_status" text DEFAULT 'not_supported' NOT NULL,
	"settled_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_payment_accounts" (
	"store_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"external_account_id" text,
	"external_account_label" text,
	"access_token" text,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_payment_accounts_store_id_provider_pk" PRIMARY KEY("store_id","provider")
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "price_source" text DEFAULT 'catalog' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_verifications" ADD CONSTRAINT "business_verifications_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_verifications" ADD CONSTRAINT "business_verifications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payer_id_users_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_payment_accounts" ADD CONSTRAINT "seller_payment_accounts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_verification_store_idx" ON "business_verifications" USING btree ("store_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_verification_user_idx" ON "identity_verifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_store_idx" ON "payments" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "payments_provider_payment_idx" ON "payments" USING btree ("provider","provider_payment_id");