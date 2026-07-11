// PM2 process config — production runs COMPILED output (dist/), not tsx on
// source (Hardening Phase 2, task 5): prod executes exactly the artifact CI
// type-checked, starts faster, and drops the tsx/TypeScript runtime from the
// hot path. `scripts/server-release.sh` builds dist/ before every reload.
//
// ONE-TIME migration from the old tsx-based config (script path changes are
// not applied by `pm2 reload`):
//   pm2 delete api worker && pm2 start apps/api/ecosystem.config.js --env production && pm2 save
module.exports = {
  apps: [
    // ── API Server — 4 workers (one per vCPU on CX32) ──────────────────────
    {
      name:      'api',
      script:    'dist/index.js',
      cwd:       '/opt/chirawa/apps/api',
      instances: 4,
      exec_mode: 'cluster',
      watch:     false,
      max_memory_restart: '500M',
      node_args: '--enable-source-maps',
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: '/var/log/chirawa/api-error.log',
      out_file:   '/var/log/chirawa/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },

    // ── Background Worker — 1 process ─────────────────────────────────────
    {
      name:      'worker',
      script:    'dist/worker/index.js',
      cwd:       '/opt/chirawa/apps/api',
      instances: 1,
      exec_mode: 'fork',
      watch:     false,
      max_memory_restart: '300M',
      node_args: '--enable-source-maps',
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: '/var/log/chirawa/worker-error.log',
      out_file:   '/var/log/chirawa/worker-out.log',
    },
  ],
};
