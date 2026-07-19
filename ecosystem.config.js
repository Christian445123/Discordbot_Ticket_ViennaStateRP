'use strict';

module.exports = {
  apps: [
    {
      name:            'ticket-bot',
      script:          'index.js',
      cwd:             __dirname,
      instances:       1,
      exec_mode:       'fork',
      autorestart:     true,
      max_restarts:    10,
      min_uptime:      '30s',
      watch:           false,
      env: {
        NODE_ENV: 'production',
      },
      // Separate stdout/stderr files instead of PM2's default ~/.pm2/logs/*.
      // Our own logger already timestamps every line, so PM2's --time prefix
      // is left off to avoid double timestamps.
      out_file:        './logs/out.log',
      error_file:      './logs/error.log',
      merge_logs:      true,
      time:            false,
    },
  ],
};
