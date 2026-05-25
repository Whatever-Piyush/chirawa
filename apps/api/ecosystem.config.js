module.exports = {
  apps: [
    // ── API Server — 4 workers (one per vCPU on CX32) ──────────────────────
    {
      name:      'api',
      script:    '../../node_modules/.bin/tsx',
      args:      'src/index.ts',
      cwd:       '/opt/chirawa/apps/api',
      instances: 4,
      exec_mode: 'cluster',
      watch:     false,
      max_memory_restart: '500M',
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
      script:    '../../node_modules/.bin/tsx',
      args:      'src/worker/index.ts',
      cwd:       '/opt/chirawa/apps/api',
      instances: 1,
      exec_mode: 'fork',
      watch:     false,
      max_memory_restart: '300M',
      env_production: {
        NODE_ENV: 'production',
      },
      error_file: '/var/log/chirawa/worker-error.log',
      out_file:   '/var/log/chirawa/worker-out.log',
    },
  ],
};
