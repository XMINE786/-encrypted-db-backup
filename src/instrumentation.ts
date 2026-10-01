// Runs once when the Next.js server process starts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initScheduler } = await import("./lib/scheduler");
    initScheduler();
  }
}
