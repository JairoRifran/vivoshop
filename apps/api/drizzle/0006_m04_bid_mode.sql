CREATE TABLE "bid_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"live_session_id" text NOT NULL,
	"store_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"product_id" text NOT NULL,
	"variant_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"currency" text NOT NULL,
	"reference_price_minor" integer NOT NULL,
	"minimum_bid_minor" integer,
	"minimum_increment_minor" integer,
	"accepted_bid_id" text,
	"reserved_until" timestamp with time zone,
	"order_id" text,
	"closed_reason" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" text PRIMARY KEY NOT NULL,
	"bid_session_id" text NOT NULL,
	"buyer_id" text NOT NULL,
	"buyer_name" text NOT NULL,
	"buyer_avatar_url" text,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "bid_id" text;--> statement-breakpoint
ALTER TABLE "bid_sessions" ADD CONSTRAINT "bid_sessions_live_session_id_live_sessions_id_fk" FOREIGN KEY ("live_session_id") REFERENCES "public"."live_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_sessions" ADD CONSTRAINT "bid_sessions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_sessions" ADD CONSTRAINT "bid_sessions_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_sessions" ADD CONSTRAINT "bid_sessions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_sessions" ADD CONSTRAINT "bid_sessions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_bid_session_id_bid_sessions_id_fk" FOREIGN KEY ("bid_session_id") REFERENCES "public"."bid_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bid_sessions_live_idx" ON "bid_sessions" USING btree ("live_session_id","status");--> statement-breakpoint
CREATE INDEX "bid_sessions_store_idx" ON "bid_sessions" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "bid_sessions_reserved_idx" ON "bid_sessions" USING btree ("status","reserved_until");--> statement-breakpoint
CREATE UNIQUE INDEX "bid_sessions_one_open_per_product_idx" ON "bid_sessions" USING btree ("live_session_id","product_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "bids_session_amount_idx" ON "bids" USING btree ("bid_session_id","amount_minor","created_at");--> statement-breakpoint
CREATE INDEX "bids_buyer_idx" ON "bids" USING btree ("buyer_id");