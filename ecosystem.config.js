// PM2 process config — used on EC2 to keep the server alive
// Usage: pm2 start ecosystem.config.js
module.exports = {
  apps: [{
    name: 'neon-syndicate',
    script: 'src/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
  }],
};
