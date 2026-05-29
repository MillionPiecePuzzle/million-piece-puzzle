import { describe, it, expect, vi } from "vitest";
import { GroupQueue } from "./queue.js";

// Drain the microtask queue and one macrotask turn, so every task whose waits
// have already settled has had a chance to run.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("GroupQueue", () => {
  it("runs tasks sharing a group in submission order", async () => {
    const queue = new GroupQueue();
    const log: number[] = [];
    for (const n of [1, 2, 3]) {
      void queue.run(`t${n}`, [7], async () => {
        await Promise.resolve();
        log.push(n);
      });
    }
    await queue.idle();
    expect(log).toEqual([1, 2, 3]);
  });

  it("does not start a same-group task until the previous one settles", async () => {
    const queue = new GroupQueue();
    const log: string[] = [];
    const first = deferred();

    void queue.run("first", [3], async () => {
      await first.promise;
      log.push("first");
    });
    void queue.run("second", [3], async () => {
      log.push("second");
    });

    await flush();
    expect(log).toEqual([]);

    first.resolve();
    await queue.idle();
    expect(log).toEqual(["first", "second"]);
  });

  it("runs tasks for disjoint groups concurrently", async () => {
    const queue = new GroupQueue();
    const log: string[] = [];
    const gate = deferred();

    // A long-running task on group 1, held open by the gate.
    const blocked = queue.run("g1", [1], async () => {
      log.push("g1-start");
      await gate.promise;
      log.push("g1-end");
    });
    // A task on group 2 shares no key, so it must not wait for group 1.
    const free = queue.run("g2", [2], async () => {
      log.push("g2");
    });

    await flush();
    expect(log).toEqual(["g1-start", "g2"]);

    gate.resolve();
    await Promise.allSettled([blocked, free]);
    expect(log).toEqual(["g1-start", "g2", "g1-end"]);
  });

  it("serializes a merge across both its groups while an independent group runs concurrently", async () => {
    const queue = new GroupQueue();
    const log: string[] = [];
    const gate = deferred();

    // The cross-group merge holds both 1 and 4, gated open so we can observe
    // what is allowed to run alongside it.
    const merge = queue.run("merge", [1, 4], async () => {
      log.push("merge-start");
      await gate.promise;
      log.push("merge-end");
    });
    // Later ops on either merged group must wait for the merge to finish.
    const onOne = queue.run("op1", [1], async () => {
      log.push("op1");
    });
    const onFour = queue.run("op4", [4], async () => {
      log.push("op4");
    });
    // An op on an unrelated group runs while the merge is still in flight.
    const onTwo = queue.run("op2", [2], async () => {
      log.push("op2");
    });

    await flush();
    expect(log).toEqual(["merge-start", "op2"]);

    gate.resolve();
    await Promise.allSettled([merge, onOne, onFour, onTwo]);
    expect(log.indexOf("op1")).toBeGreaterThan(log.indexOf("merge-end"));
    expect(log.indexOf("op4")).toBeGreaterThan(log.indexOf("merge-end"));
  });

  it("chains two merges that share one group, but lets a disjoint merge run alongside", async () => {
    const queue = new GroupQueue();
    const log: string[] = [];
    const gate = deferred();

    // Merge A locks {1,2}, held open.
    const mergeA = queue.run("A", [1, 2], async () => {
      log.push("A-start");
      await gate.promise;
      log.push("A-end");
    });
    // Merge B shares group 2 with A, so it queues behind A.
    const mergeB = queue.run("B", [2, 3], async () => {
      log.push("B");
    });
    // Merge C is fully disjoint, so it runs while A is gated.
    const mergeC = queue.run("C", [4, 5], async () => {
      log.push("C");
    });

    await flush();
    expect(log).toEqual(["A-start", "C"]);

    gate.resolve();
    await Promise.allSettled([mergeA, mergeB, mergeC]);
    expect(log.indexOf("B")).toBeGreaterThan(log.indexOf("A-end"));
  });

  it("runs a global task only after in-flight keyed tasks and blocks later ones", async () => {
    const queue = new GroupQueue();
    const log: string[] = [];
    const gate = deferred();

    const keyed = queue.run("keyed", [1], async () => {
      log.push("keyed-start");
      await gate.promise;
      log.push("keyed-end");
    });
    const global = queue.runGlobal("global", async () => {
      log.push("global");
    });
    const after = queue.run("after", [9], async () => {
      log.push("after");
    });

    await flush();
    // The global waits for the in-flight keyed task, and "after" waits for the
    // global, so nothing past the gated task runs yet.
    expect(log).toEqual(["keyed-start"]);

    gate.resolve();
    await Promise.allSettled([keyed, global, after]);
    expect(log).toEqual(["keyed-start", "keyed-end", "global", "after"]);
  });

  it("isolates a rejected task so later same-group tasks still run", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const queue = new GroupQueue();
    const log: string[] = [];

    void queue.run("ok1", [1], async () => {
      log.push("ok1");
    });
    void queue.run("boom", [1], async () => {
      throw new Error("boom");
    });
    void queue.run("ok2", [1], async () => {
      log.push("ok2");
    });
    await queue.idle();

    expect(log).toEqual(["ok1", "ok2"]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
