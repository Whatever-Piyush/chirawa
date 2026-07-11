// Loaded before every test file (see vitest.config.ts setupFiles). Mirrors what
// src/index.ts does at boot so modules that import the validated `env` config
// (which exits the process on missing vars) can load under the test runner.
import 'dotenv/config';

// The tests validate the CODE's default behavior, not a developer's local .env.
// Building-phase toggles (e.g. OPERATING_HOURS_OPEN/CLOSE=0/24 for 24/7) leak in
// via dotenv above and would silently flip default-hours assertions — strip them
// so the baseline is deterministic. Tests that want an override set it themselves.
delete process.env.OPERATING_HOURS_OPEN;
delete process.env.OPERATING_HOURS_CLOSE;
delete process.env.OPERATING_HOURS_DISABLED;
