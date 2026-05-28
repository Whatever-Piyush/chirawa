-- Adds post-delivery customer rating on Order.
-- - rating: 1-5 stars (NULL = not yet rated)
-- - ratingComment: optional free-text feedback (max 500 chars)
-- - ratedAt: timestamp the rating was submitted; doubles as "already rated" guard
ALTER TABLE "orders" ADD COLUMN "rating" INTEGER;
ALTER TABLE "orders" ADD COLUMN "rating_comment" VARCHAR(500);
ALTER TABLE "orders" ADD COLUMN "rated_at" TIMESTAMP(3);
