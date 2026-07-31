export const appConfig = {
  appName: "KINETIC",
  environment: process.env.NODE_ENV ?? "development",
  logDir: "logs",
  uiMode: "preserve-arayuz",
} as const;
