// Per-group dispatch queues. Each task is scoped to a set of group ids: tasks
// whose key sets are disjoint run concurrently, tasks sharing any group id run
// in submission order. This keeps a handler's Redis read-modify-write sequence
// from interleaving with another task touching the same group, while letting
// independent groups process in parallel (see DECISIONS: per-group dispatch
// queues). A rejected task is logged and isolated, never stalling the groups it
// touched.
//
// Keys are acquired atomically at submission (synchronously, before any await),
// so the dependency graph follows submission order and cannot cycle: there is no
// deadlock even when a task spans several groups.
export class GroupQueue {
  // Tail promise per group id: the last task touching that group. A new task on
  // the same id chains after it. Entries are pruned when their task settles.
  private readonly tails = new Map<number, Promise<void>>();
  // Tail of the global barrier (welcome, reset, complete). Keyed tasks queue
  // behind it; it queues behind every in-flight keyed task, so it runs alone.
  private globalTail: Promise<void> = Promise.resolve();

  // Run a task holding the given group ids. Resolves when the task settles.
  run(label: string, groupIds: number[], task: () => Promise<void>): Promise<void> {
    const keys = [...new Set(groupIds)];
    const waitFor: Promise<void>[] = [this.globalTail];
    for (const k of keys) {
      const t = this.tails.get(k);
      if (t) waitFor.push(t);
    }
    const result = settleAll(waitFor)
      .then(task)
      .catch((error: unknown) => {
        console.error(`[queue:${label}]`, error);
      });
    for (const k of keys) this.tails.set(k, result);
    void result.finally(() => {
      for (const k of keys) {
        if (this.tails.get(k) === result) this.tails.delete(k);
      }
    });
    return result;
  }

  // Run a task with exclusive access to every group. Waits for all in-flight
  // keyed tasks and any prior global task, and blocks keyed tasks submitted
  // after it. For operations that touch the whole board (initial state read,
  // reset, force-complete) where a per-group key set does not apply.
  runGlobal(label: string, task: () => Promise<void>): Promise<void> {
    const waitFor: Promise<void>[] = [this.globalTail, ...this.tails.values()];
    const result = settleAll(waitFor)
      .then(task)
      .catch((error: unknown) => {
        console.error(`[queue:${label}]`, error);
      });
    this.globalTail = result;
    void result.finally(() => {
      if (this.globalTail === result) this.globalTail = Promise.resolve();
    });
    return result;
  }

  // Resolves when every task in flight at the time of the call has settled.
  // Tasks submitted afterwards are not awaited.
  idle(): Promise<void> {
    return settleAll([this.globalTail, ...this.tails.values()]);
  }
}

function settleAll(promises: Promise<void>[]): Promise<void> {
  return Promise.allSettled(promises).then(() => {});
}
