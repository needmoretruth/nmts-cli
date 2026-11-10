// One account, written out by `nmts recovery-list` with the clock and the engine's randomness held
// still — so two builds of the command can be compared byte for byte.
//
// ⛔ WHY THE TWO ARE HELD. A recovery list carries the moment it was written and one sealed
//    envelope, whose nonce is drawn from the engine's generator. Left alone, two runs of the SAME
//    code never agree, so "identical file bytes" could not be asked at all. Holding both still is
//    what turns "the command became a shell over the library and nothing changed" into a check.
//
// ⚠ THE RANDOMNESS IS HELD ONLY INSIDE `writeHeld`, and given back on the way out — a key or a
//   nonce drawn from a counter anywhere else would be a defect, not a fixture.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { entry, folder } from "./fake-drive.ts";
import { lines, part, sealUnderDataKey, type FakeRecovery, type SourceItemRow } from "./fake-recovery.ts";

/** The instant every `new Date()` answers while held. */
export const HELD_AT = Date.parse("2026-11-10T09:00:00.000Z");

/** A file the account holds: a real wrapped key and a real sealed content hash. */
async function stored(code: string, id: string, name: string, size: number, parentId: string | null = null): Promise<ManifestEntry> {
  return entry({
    id,
    name,
    parentId,
    size,
    dekWrapped: await sealUnderDataKey(code, "nmts/v3/dek-wrap", new Uint8Array(32).fill(7)),
    contentHashCt: await sealUnderDataKey(code, "nmts/v3/content-hash", new Uint8Array(32).fill(9)),
  });
}

function row(id: string, lens: readonly number[]): SourceItemRow {
  return {
    id,
    size: lens.reduce((n, v) => n + v, 0),
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-02T11:00:00Z",
    parts: lens.map((len, i) => part({ part_index: i, plaintextLen: len })),
  };
}

/** Put the same three files on the fake every time. */
export async function serveThreeFiles(fake: FakeRecovery, code: string): Promise<void> {
  await fake.serve(code, [
    folder({ id: "f1", name: "photos" }),
    await stored(code, "a1", "budget.xlsx", 40),
    await stored(code, "a2", "holiday.jpg", 90, "f1"),
    await stored(code, "a3", "notes.md", 5),
  ]);
  fake.source = [row("a1", [40]), row("a2", [50, 40]), row("a3", [5])];
}

/**
 * Run `body` with `Date.now()`/`new Date()` fixed and the engine's generator counting from zero.
 *
 * ⚠ THE ENGINE IS ALREADY LOADED BEFORE THIS RUNS (the fake seals the files with it), so what is
 *   swapped is the function it calls for bytes, not anything it caches.
 */
export async function writeHeld<T>(body: () => Promise<T>): Promise<T> {
  const RealDate = Date;
  const realFill = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  let counter = 0;
  class HeldDate extends RealDate {
    constructor(...args: [] | [string | number | Date]) {
      if (args.length === 0) super(HELD_AT);
      else super(args[0]);
    }
    static override now(): number {
      return HELD_AT;
    }
  }
  globalThis.Date = HeldDate as DateConstructor;
  const counting = <V extends ArrayBufferView | null>(array: V): V => {
    if (array !== null) {
      const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = (counter += 1) & 0xff;
    }
    return array;
  };
  Object.defineProperty(globalThis.crypto, "getRandomValues", { value: counting, configurable: true });
  try {
    return await body();
  } finally {
    globalThis.Date = RealDate;
    Object.defineProperty(globalThis.crypto, "getRandomValues", { value: realFill, configurable: true });
  }
}

/** Run the command into a fresh directory and hand back the one file it wrote, as bytes. */
export async function writtenBytes(run: (dir: string, write: (line: string) => void) => Promise<number>): Promise<{ name: string; bytes: Uint8Array; out: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), "nmts-recbytes-"));
  try {
    const out = lines();
    const code = await run(dir, out.write);
    if (code !== 0) throw new Error(out.out.join("\n"));
    const [name] = readdirSync(dir);
    if (name === undefined) throw new Error("nothing was written");
    return { name, bytes: new Uint8Array(readFileSync(join(dir, name))), out: out.out };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
