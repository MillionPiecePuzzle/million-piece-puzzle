import { describe, it, expect, vi } from "vitest";
import { SerialQueue } from "./queue.js";

describe("SerialQueue", () => {
  it("runs tasks in the order they were enqueued", async () => {
    const queue = new SerialQueue();
    const log: number[] = [];
    for (const n of [1, 2, 3]) {
      queue.enqueue(`t${n}`, async () => {
        await Promise.resolve();
        log.push(n);
      });
    }
    await queue.idle();
    expect(log).toEqual([1, 2, 3]);
  });

  it("does not start a task until the previous one settles", async () => {
    const queue = new SerialQueue();
    const log: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    queue.enqueue("first", async () => {
      await firstGate;
      log.push("first");
    });
    queue.enqueue("second", async () => {
      log.push("second");
    });

    // Flush microtasks: "second" must still be blocked behind "first".
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual([]);

    releaseFirst();
    await queue.idle();
    expect(log).toEqual(["first", "second"]);
  });

  it("isolates a rejected task so later tasks still run", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const queue = new SerialQueue();
    const log: string[] = [];

    queue.enqueue("ok1", async () => {
      log.push("ok1");
    });
    queue.enqueue("boom", async () => {
      throw new Error("boom");
    });
    queue.enqueue("ok2", async () => {
      log.push("ok2");
    });
    await queue.idle();

    expect(log).toEqual(["ok1", "ok2"]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
