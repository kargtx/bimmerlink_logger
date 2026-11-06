// Запуск через pm2: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'bimmerlink_logger',
      script: 'server.js',
      env: { NODE_ENV: 'production', PORT: 3000 },
      max_memory_restart: '500M'
    },
    {
      // ежедневная резервная копия в 04:00
      name: 'bimmerlink_logger_backup',
      script: 'scripts/backup.js',
      cron_restart: '0 4 * * *',
      autorestart: false
    }
  ]
};
