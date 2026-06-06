-- AlterTable
ALTER TABLE "seller_profiles" ADD COLUMN     "razorpay_contact_id" VARCHAR(100),
ADD COLUMN     "razorpay_fund_account_id" VARCHAR(100);

-- AlterTable
ALTER TABLE "settlements" ADD COLUMN     "failure_reason" VARCHAR(255),
ADD COLUMN     "needs_attention" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payout_id" VARCHAR(100);
