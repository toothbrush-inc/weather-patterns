// Runs once when the Next.js server boots (`next start` and `next dev`). We use it
// to start the in-process collection scheduler so a deployed instance gathers
// history on a schedule without any external cron — see lib/scheduler.mjs.
//
// Node runtime only: the scheduler uses fs and timers and must not run on the
// edge. Note this hook is unreliable under `output: 'standalone'`, which is why
// the Docker image runs plain `next start` instead.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // @ts-ignore - plain ESM lib module
  const { startScheduler } = await import("./lib/scheduler.mjs");
  startScheduler();
}
