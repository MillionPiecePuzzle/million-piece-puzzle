// Runs tasks one at a time in FIFO order, each to completion before the next
// starts, so handlers' Redis read-modify-write sequences cannot interleave. A
// rejected task is logged and isolated, never stalling the queue. The total
// order is per process (see DECISIONS: global serial dispatch queue).
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue(label: string, task: () => Promise<void>): void {
    this.tail = this.tail.then(task).catch((error: unknown) => {
      console.error(`[queue:${label}]`, error);
    });
  }

  idle(): Promise<void> {
    return this.tail;
  }
}
