export function scheduleEffectTask(task: () => void): () => void {
  let cancelled = false;
  queueMicrotask(() => {
    if (!cancelled) {
      task();
    }
  });
  return () => {
    cancelled = true;
  };
}
