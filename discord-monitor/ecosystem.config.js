module.exports = {
  apps: [{
    name: 'discord-monitor',
    script: './monitor.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    restart_delay: 4000,
    kill_timeout: 5000,
    wait_ready: true,
    max_restarts: 10,
    min_uptime: '10s',
    cron_restart: '0 3 * * *' // Restart daily at 3 AM for health
  }, {
    name: 'ticker-extractor',
    script: './ticker-extractor-service.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/ticker-extractor-error.log',
    out_file: './logs/ticker-extractor-out.log',
    log_file: './logs/ticker-extractor-combined.log',
    time: true,
    restart_delay: 2000,
    kill_timeout: 5000,
    wait_ready: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
