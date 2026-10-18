ALTER TYPE "public"."provider" ADD VALUE 'WHATSAPP';--> statement-breakpoint
ALTER TYPE "public"."provider" ADD VALUE 'SLACK';--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "slack_user_id" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "slack_email" text;