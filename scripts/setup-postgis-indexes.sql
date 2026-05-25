-- Run after prisma migrate dev
-- Adds PostGIS spatial columns and GIN fuzzy search indexes

-- Shops: add PostGIS point derived from lat/lng for ST_DWithin queries
ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS location geometry(Point, 4326);

UPDATE shops
  SET location = ST_SetSRID(ST_MakePoint(CAST(lng AS float), CAST(lat AS float)), 4326)
  WHERE location IS NULL;

CREATE INDEX IF NOT EXISTS shops_location_gist
  ON shops USING GIST(location);

-- Addresses: same pattern
ALTER TABLE addresses
  ADD COLUMN IF NOT EXISTS location geometry(Point, 4326);

UPDATE addresses
  SET location = ST_SetSRID(ST_MakePoint(CAST(lng AS float), CAST(lat AS float)), 4326)
  WHERE location IS NULL;

CREATE INDEX IF NOT EXISTS addresses_location_gist
  ON addresses USING GIST(location);

-- Delivery zones: polygon boundary column
ALTER TABLE delivery_zones
  ADD COLUMN IF NOT EXISTS boundary geometry(Polygon, 4326);

CREATE INDEX IF NOT EXISTS delivery_zones_boundary_gist
  ON delivery_zones USING GIST(boundary);

-- Products: GIN index for fuzzy name search (pg_trgm)
CREATE INDEX IF NOT EXISTS products_name_trgm
  ON products USING GIN(name gin_trgm_ops);

SELECT 'PostGIS indexes created successfully' AS result;
