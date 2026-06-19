import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: process.env.CI
      ? "vite preview --port 4173"
      : "vite dev --port 5173",
    url: process.env.CI ? "http://localhost:4173" : "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: process.env.CI ? "http://localhost:4173" : "http://localhost:5173",
  },
});
