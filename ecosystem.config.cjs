/**
 * PM2 进程配置
 *   pm2 start ecosystem.config.cjs
 *   pm2 logs daiyan
 *   pm2 save && pm2 startup
 */
module.exports = {
  apps: [
    {
      name: 'daiyan',
      script: 'server/index.js',
      cwd: __dirname,
      instances: 1, // 必须为 1：回合循环与 Socket.IO 状态在单进程内
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 8787,
        HOST: '0.0.0.0',
        DB_PATH: './data/empire.db',
        TICK_MS: 180000,
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      time: true,
    },
  ],
};
