const fs = require("fs");
const path = require("path");

function loadDotEnv(filename) {
  const filePath = path.join(__dirname, filename);
  if (!fs.existsSync(filePath)) return {};

  const env = {};
  const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    const existing = env[key];
    if (existing !== undefined && existing !== "") continue;

    env[key] = value;
  }

  return env;
}

const fileEnv = loadDotEnv(".env");
const sharedEnv = {
  NODE_ENV: "production",
  ...fileEnv,
};

module.exports = {
  apps: [
    {
      name: "kinetic-web",
      cwd: __dirname,
      script: ".next/standalone/server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: "600M",
      node_args: "--max-old-space-size=512",
      env: {
        ...sharedEnv,
        APP_ROLE: "web",
      },
      out_file: "./logs/pm2-web.out.log",
      error_file: "./logs/pm2-web.err.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "kinetic-worker",
      cwd: __dirname,
      script: "npm",
      args: "run worker:start",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      max_memory_restart: "700M",
      node_args: "--max-old-space-size=512",
      env: {
        ...sharedEnv,
        APP_ROLE: "worker",
        ENABLE_SEPARATE_WORKER: fileEnv.ENABLE_SEPARATE_WORKER ?? "true",
      },
      error_file: "./logs/pm2-worker.err.log",
      merge_logs: true,
      time: true,
    },
  ],
};
