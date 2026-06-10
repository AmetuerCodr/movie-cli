import ora, { type Ora } from "ora";

/**
 * Thin wrapper over ora so the rest of the app has a single, consistent way to
 * show progress. Spinners write to stderr and disable themselves when not in a
 * TTY so piped output stays clean.
 */
export function spinner(text: string): Ora {
  return ora({ text, stream: process.stderr, isEnabled: process.stderr.isTTY });
}

/**
 * Run an async task while a spinner is shown. Resolves to the task's value;
 * marks the spinner failed and rethrows on error.
 */
export async function withSpinner<T>(
  text: string,
  task: () => Promise<T>,
  opts: { success?: string; fail?: string } = {},
): Promise<T> {
  const s = spinner(text).start();
  try {
    const result = await task();
    if (opts.success) s.succeed(opts.success);
    else s.stop();
    return result;
  } catch (err) {
    s.fail(opts.fail ?? text);
    throw err;
  }
}
