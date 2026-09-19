// The five things this package cannot do by itself, in one register — so that everything else in
// it is code that runs anywhere a `fetch` does.
//
// ⛔ A REGISTER, NOT A BRANCH. Nothing below asks which runtime it is in. The entry point that a
//    program imports puts a host in here — `index.ts` registers the Node one, the SDK's `/browser`
//    entry registers a browser one — and every portable module afterwards asks for the one that is
//    there. A `typeof window === "undefined"` test in each of the modules instead would be the
//    same decision made twenty times, and the twenty-first is the one that gets it wrong on a
//    runtime nobody was thinking about.
//
// ⛔ FIVE, AND THEY ARE THE WHOLE LIST. Loading the engine, keeping state, reading the
//    environment, saying how far along something is, and having a zstd encoder: those are what a
//    browser cannot do the way Node does. Anything a sixth entry would be asked to carry is a sign
//    that a module is doing something it should be handed instead.
//
// ⛔ STATE IS ASYNCHRONOUS. A browser's store is a database with transactions and there is no
//    honest way to read one without waiting. Node's is a file and could have stayed synchronous;
//    making it look synchronous in a browser would take a worker and a shared buffer to fake, and
//    a fake that blocks the page is worse than the `await` it saves.
//
// ⛔ NO `node:` IMPORT MAY EVER APPEAR IN THIS FILE, or in anything it reaches. `portable.ts` is
//    the entry that promises it and `test/portable-closure.test.ts` is what holds the promise.

import { NmtsError } from "./errors.ts";
import type { CryptoGlue } from "./crypto-surface.ts";

/** Which runtime put the host in the register. Reported; nothing branches on it. */
export type HostName = "node" | "browser";

/** Loading the WebAssembly engine that derives this account's keys. */
export interface EngineHost {
  /**
   * The engine, made once and kept.
   *
   * ⛔ THE SHAPE CHECK IS NOT THE HOST'S. `crypto.ts` runs `isCryptoGlue` over whatever comes
   *    back, so both hosts pass the same gate and a build that renamed an export is named at load
   *    time whichever runtime met it.
   */
  load(): Promise<CryptoGlue>;
}

/**
 * What this installation keeps between runs, as bytes under a key.
 *
 * ⛔ KEYS ARE `<area>/<name>`, and the area is what a reader of the key can see at a glance:
 *    `manifest/…` is a kept file list, `chunks/…` a copy of one of its chunks, `uploads/…` a
 *    reservation a half-finished upload can be resumed from, `runlog` this machine's record of
 *    what it did, `collision` and `autonomy` the two answers a person gave at setup.
 *
 * ⛔ NOTHING HERE IS A CACHE THE ACCOUNT DEPENDS ON. Every reader treats "no bytes" as "fetch it
 *    again", so a host whose store is empty, full or unavailable is a slower program and never a
 *    broken one.
 */
export interface StateHost {
  /**
   * False when what is written will not survive the page or the process — a browser with no
   * IndexedDB, or one that would not open it. Reported so a caller can say so rather than
   * promising a resumable upload it cannot resume.
   */
  readonly durable: boolean;
  read(key: string): Promise<Uint8Array | undefined>;
  write(key: string, bytes: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
  /** Every key that starts with `prefix`, in no particular order. */
  keys(prefix: string): Promise<string[]>;
}

/**
 * Filling the file-list codec's zstd register (NCF-3 §6.3.4). Safe to call more than once.
 *
 * ⛔ IT IS AWAITED. Both hosts fetch their encoder rather than carrying it — Node's `zlib` and a
 *    WebAssembly build respectively — and a list read that did not wait for it would fall back to
 *    gzip for a frame the browser wrote in zstd.
 */
export interface ZstdHost {
  register(): Promise<void>;
}

/** Everything this package needs from the runtime it was loaded into. */
export interface Host {
  readonly name: HostName;
  readonly engine: EngineHost;
  readonly state: StateHost;
  /**
   * A named value from the environment, or undefined.
   *
   * ⚠ A PAGE HAS NO ENVIRONMENT, so the addresses a variable would have carried — the relay, the
   *   Sui endpoint, the aggregators — arrive as options on the client, and the browser host
   *   answers those three under the same variable names and undefined to everything else. Asking
   *   through here rather than `process.env` is what lets one module do both without knowing which
   *   runtime it is in.
   */
  env(name: string): string | undefined;
  /**
   * Every variable this process is holding, for the one caller that needs the VALUES rather than
   * one of them: `redact.ts` labels them out of a report before it is written down.
   *
   * ⚠ A BROWSER ANSWERS AN EMPTY LIST, which is the truth rather than a stub: a page holds no
   *   environment, so there is nothing of that kind to take out of a report.
   */
  envEntries(): { name: string; value: string }[];
  /** One line about how far along something is. Where it goes is the host's business. */
  log(line: string): void;
  readonly zstd: ZstdHost;
}

let registered: Host | null = null;

/**
 * Put the host for this runtime in the register.
 *
 * Called once, from the entry point a program imported, before anything else runs. Calling it
 * again replaces what is there, which is what a test that swaps a host needs and what nothing else
 * should do.
 */
export function registerHost(next: Host): void {
  registered = next;
}

/** Empty the register. For tests that need to see what an unhosted module does. */
export function forgetHost(): void {
  registered = null;
}

/** True when something has registered one. Lets a caller ask instead of catching. */
export function hostIsRegistered(): boolean {
  return registered !== null;
}

/**
 * The host for this runtime.
 *
 * ⛔ IT REFUSES RATHER THAN GUESSING. A program that imported `@needmoretruth/nmts-cli/portable`
 *    and registered nothing has one thing wrong with it, and naming that is worth more than a
 *    default host that half-works and fails somewhere further in.
 */
export function host(): Host {
  if (registered === null) {
    throw new NmtsError("HOST_MISSING: no runtime host has been registered.", {
      exitCode: 1,
      nextStep:
        "Import `@needmoretruth/nmts-cli` (which registers the Node host) or the SDK's `/browser` " +
        "entry (which registers a browser one) before calling anything that keeps state.",
    });
  }
  return registered;
}
