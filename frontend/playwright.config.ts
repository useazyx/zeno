import { defineConfig, devices } from "@playwright/test"

/**
 * End-to-end tests against the running stack: Vite, the Fastify API, the AI
 * service and Postgres with the demo data. They read and navigate; the only
 * writes are a note on the timeline, which is what a dispatcher would leave.
 *
 *   npm run dev            (frontend, backend and `uvicorn api.main:app`)
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Opt in locally when measuring Windows GPU performance; CI stays software-rendered.
    launchOptions: { args: process.env.E2E_HARDWARE_GPU === "1" && process.platform === "win32"
      ? ["--use-angle=d3d11", "--enable-gpu"]
      : ["--use-gl=angle", "--enable-unsafe-swiftshader"] },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // The narrowest phone the console has to work on.
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 780 }, hasTouch: true } },
  ],
})
