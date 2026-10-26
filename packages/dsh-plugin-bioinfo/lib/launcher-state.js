export function createLauncherState() {
  const abort = new AbortController();
  let child;
  return {
    get stopping() { return abort.signal.aborted; },
    check() { abort.signal.throwIfAborted(); },
    attach(process) {
      abort.signal.throwIfAborted();
      child = process;
    },
    detach(process) { if (child === process) child = undefined; },
    stop() {
      if (abort.signal.aborted) return;
      abort.abort();
      child?.kill('SIGTERM');
    },
  };
}
