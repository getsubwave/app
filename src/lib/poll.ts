export function pollAsync(
  fn: (signal: AbortSignal) => Promise<void>,
  intervalMs: number,
): () => void {
  const controller = new AbortController();
  let inFlight = false;
  const tick = async () => {
    if (inFlight || controller.signal.aborted) return;
    inFlight = true;
    try {
      await fn(controller.signal);
    } catch {
    } finally {
      inFlight = false;
    }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, intervalMs);
  return () => {
    clearInterval(timer);
    controller.abort();
  };
}
