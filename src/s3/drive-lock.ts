// One write at a time per key, inside one gateway process.
//
// ⛔ WHY. Two PUTs to one key used to decide from the same list, cached for seconds: under
//    `refuse` the loser was stored as `name (2)` and told 200 with the winner's tag, and under
//    `replace` the older request could land last and the newer client held a tag that no longer
//    existed. A client that gave up waiting and sent the same PUT again started a second store of
//    the same file. Held one at a time, each write reads the list fresh after the one before it has
//    finished, so the second of two identical uploads finds its bytes already there.
//
// ⚠ ONE PROCESS. Two processes, or another device, can still write the same key at the same
//   moment; the file list's own compare-and-swap is what keeps both of those, and the write that
//   finds its file under another name says so rather than answering a tag that is not its own.

/** A lock per name. */
export interface KeyLocks {
  /**
   * Run `work` holding every name in `names`, and release them whatever it does.
   *
   * ⚠ Several names are taken in one order, sorted, so two runs that share names cannot each hold
   *   one the other is waiting for.
   */
  run<T>(names: readonly string[], work: () => Promise<T>): Promise<T>;
}

export function createKeyLocks(): KeyLocks {
  /** The promise the next holder of a name waits for: the last holder letting go. */
  const tails = new Map<string, Promise<void>>();

  const take = async (name: string): Promise<() => void> => {
    const before = tails.get(name) ?? Promise.resolve();
    let letGo: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    const tail = before.then(() => held);
    tails.set(name, tail);
    await before;
    return () => {
      letGo();
      // Nobody queued behind this one: the name is forgotten, so the map holds only names in use.
      if (tails.get(name) === tail) tails.delete(name);
    };
  };

  return {
    async run<T>(names: readonly string[], work: () => Promise<T>): Promise<T> {
      const ordered = [...new Set(names)].sort();
      const releases: Array<() => void> = [];
      try {
        for (const name of ordered) releases.push(await take(name));
        return await work();
      } finally {
        for (const release of releases.reverse()) release();
      }
    },
  };
}
