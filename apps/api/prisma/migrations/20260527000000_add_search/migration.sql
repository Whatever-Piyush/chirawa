-- Enable fuzzy-text search extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on product names (fast ILIKE + similarity queries)
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING GIN (name gin_trgm_ops);

-- GIN trigram index on shop names
CREATE INDEX IF NOT EXISTS idx_shops_name_trgm
  ON shops USING GIN (name gin_trgm_ops);
