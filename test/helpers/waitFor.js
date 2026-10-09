/**
 * Poll `predicate` until it returns a truthy value (returned), or fail.
 *
 * @template T
 * @param {() => T | Promise<T>} predicate
 * @param {{ timeoutMs?: number, intervalMs?: number, what?: string }} [options]
 * @returns {Promise<T>}
 */
export async function waitFor(
  predicate,
  { timeoutMs = 3000, intervalMs = 10, what = 'condition' } = {},
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
