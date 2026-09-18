/**
 * Runs once when the server starts. A production server without a usable
 * setup token cannot create its admin account, so it says so in one line
 * instead of silently answering 503 on /setup.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { SETUP_TOKEN_MIN_LENGTH, setupGate } = await import("@/lib/security");
  if (setupGate(process.env.SETUP_TOKEN) === "unconfigured") {
    console.error(
      `[darkpools] SETUP_TOKEN is missing or shorter than ${SETUP_TOKEN_MIN_LENGTH} characters: /setup answers 503 until it is set and the server restarted (needed only before the admin account exists).`,
    );
  }
}
