-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "contact_type" VARCHAR(20) DEFAULT 'myself',
ADD COLUMN     "maps_link" TEXT,
ADD COLUMN     "receiver_name" VARCHAR(100),
ADD COLUMN     "receiver_phone" VARCHAR(20);
