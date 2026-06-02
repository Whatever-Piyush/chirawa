// Loaded before every test file (see vitest.config.ts setupFiles). Mirrors what
// src/index.ts does at boot so modules that import the validated `env` config
// (which exits the process on missing vars) can load under the test runner.
import 'dotenv/config';
