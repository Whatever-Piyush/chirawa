-- Enable PostGIS for geospatial queries (rider location, shop distance)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enable pg_trgm for fuzzy product name search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable pgcrypto for phone number encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enable uuid-ossp for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Confirm extensions loaded
SELECT extname, extversion FROM pg_extension ORDER BY extname;