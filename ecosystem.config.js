module.exports = {
  apps: [
    {
      name: "llm-analyzer",
      script: "index.js",
      cwd: "/opt/openclaw/app/llm-analyzer",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "openclaw-wa",
      script: "src/index.js",
      cwd: "/opt/openclaw/app",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "openclaw-wa-marque",
      script: "src/index.js",
      cwd: "/opt/openclaw/app",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
        ENV_FILE: "/opt/openclaw/app/.env.marque",
      },
    },
  ],
};
