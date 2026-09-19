// The Node host: the five things `host.ts` names, done the way this tool has always done them.
//
// ⛔ THIS FILE IS WHERE THE `node:` IMPORTS WENT. They used to be spread over a dozen modules, and
//    that is what stopped the package running anywhere else. Nothing moved in behaviour: the
//    engine is found on disk the same way, the state is the same files under the same names, and
//    an installation made by an earlier version is read without noticing the change.
//
// ⛔ THE FILE NAMES ARE A COMPATIBILITY PROMISE, not a mapping somebody is free to tidy. A kept
//    file list, a chunk of one and an unfinished upload all sit in a home directory that this
//    version did not create. `placeOf` is the whole of that promise, and it is a table so a reader
//    can check it against a real `~/.nmts` in one glance.
//
// ⛔ EVERY WRITE IS ASIDE-AND-RENAME, 0600, under a 0700 directory. A rename within one directory
//    is atomic, so a reader meets the old bytes or the new ones and never half of either — which
//    matters most for the one record that says an upload was already paid for.
//
// ⚠ NOTHING HERE THROWS ON A FAILED WRITE. Every caller in the package treats missing state as
//   "do the work again", so a full disk, a read-only home directory or a directory owned by
//   somebody else costs a slower command rather than a failed one.
//
// ⛔ THE ENGINE AND THE ZSTD ENCODER ARE LOADED WHEN THEY ARE ASKED FOR, not when the host is made.
//    `nmts --help` registers a host and uses none of it, and an agent runs this tool in a loop —
//    `check:cli-startup` measures exactly this and refuses a build that widened it.

import { chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";

import { configDir, modesAreEnforced } from "./credentials.ts";
import { registerHost, type Host, type StateHost } from "./host.ts";

/** A file under the config directory: the folder it is in, and its name. */
interface Place {
  /** Relative to the config directory. Empty for a file at the top of it. */
  readonly dir: string;
  readonly file: string;
}

/**
 * The file one state key names — the table an earlier installation's layout is read through.
 *
 * Anything not named here is spelled out as it reads: the slashes become directories and the last
 * segment is the file name, which is what `uploads/…` and the host-contract check already are.
 */
function placeOf(key: string): Place {
  if (key === "runlog") return { dir: "", file: "runs.jsonl" };
  if (key === "collision") return { dir: "", file: "collision.json" };
  if (key === "autonomy") return { dir: "", file: "autonomy.json" };
  if (key === "manifest/state") return { dir: "", file: "file-list-state.json" };
  const manifest = after(key, "manifest/");
  if (manifest !== null) return { dir: "", file: `file-list-${manifest}.json` };
  const chunk = after(key, "chunks/");
  if (chunk !== null) {
    const cut = chunk.lastIndexOf("/");
    return { dir: join("file-list-chunks", chunk.slice(0, cut)), file: `${chunk.slice(cut + 1)}.ct` };
  }
  const cut = key.lastIndexOf("/");
  return cut < 0 ? { dir: "", file: key } : { dir: key.slice(0, cut), file: key.slice(cut + 1) };
}

function after(key: string, prefix: string): string | null {
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

/** The key a file stands for, or null when this tool keeps no key for it. The inverse of `placeOf`. */
function keyOf(place: Place): string | null {
  if (place.dir === "") {
    if (place.file === "runs.jsonl") return "runlog";
    if (place.file === "collision.json") return "collision";
    if (place.file === "autonomy.json") return "autonomy";
    if (place.file === "file-list-state.json") return "manifest/state";
    const listed = place.file.match(/^file-list-(.+)\.json$/);
    return listed?.[1] === undefined ? null : `manifest/${listed[1]}`;
  }
  const parts = place.dir.split(sep);
  if (parts[0] === "file-list-chunks") {
    if (!place.file.endsWith(".ct")) return null;
    return ["chunks", ...parts.slice(1), place.file.slice(0, -".ct".length)].join("/");
  }
  return [...parts, place.file].join("/");
}

/** Every file under the config directory, as `Place`s. A missing directory is no files. */
function walk(root: string, dir: string, out: Place[]): void {
  let names: string[];
  try {
    names = readdirSync(join(root, dir));
  } catch {
    return;
  }
  for (const name of names) {
    const full = join(root, dir, name);
    let isDirectory = false;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) walk(root, join(dir, name), out);
    else out.push({ dir, file: name });
  }
}

function atomically(target: string, bytes: Uint8Array): void {
  const scratch = `${target}.${process.pid}.tmp`;
  writeFileSync(scratch, bytes, { mode: 0o600 });
  if (modesAreEnforced()) chmodSync(scratch, 0o600);
  renameSync(scratch, target);
}

/** Files under the person's own config directory, named by `placeOf`. */
export function nodeState(): StateHost {
  return {
    durable: true,
    async read(key: string): Promise<Uint8Array | undefined> {
      const place = placeOf(key);
      try {
        return new Uint8Array(readFileSync(join(configDir(), place.dir, place.file)));
      } catch {
        return undefined;
      }
    },
    async write(key: string, bytes: Uint8Array): Promise<void> {
      const place = placeOf(key);
      const dir = join(configDir(), place.dir);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (modesAreEnforced()) chmodSync(configDir(), 0o700);
      atomically(join(dir, place.file), bytes);
    },
    async remove(key: string): Promise<void> {
      const place = placeOf(key);
      rmSync(join(configDir(), place.dir, place.file), { force: true });
    },
    async keys(prefix: string): Promise<string[]> {
      const found: Place[] = [];
      walk(configDir(), "", found);
      const keys: string[] = [];
      for (const place of found) {
        const key = keyOf(place);
        if (key !== null && key.startsWith(prefix)) keys.push(key);
      }
      return keys;
    },
  };
}

/** Where a state key lands on this machine. For tests, and for messages that name a file. */
export function statePath(key: string): string {
  const place = placeOf(key);
  return join(configDir(), place.dir, place.file);
}

/**
 * Every `NMTS_*` variable this process is holding.
 *
 * ⛔ THE ONE PLACE THE WHOLE ENVIRONMENT IS READ. `redact.ts` needs the values to label them out of
 *    a report, and a browser has none — so it is a host call rather than a `process.env` walk in a
 *    module that has to run in both.
 */
export function nodeEnvEntries(): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) out.push({ name, value });
  }
  return out;
}

/** This machine, as the package's host. */
export function nodeHost(): Host {
  return {
    name: "node",
    engine: { load: async () => (await import("./engine-node.ts")).loadEngine() },
    state: nodeState(),
    env: (name: string): string | undefined => process.env[name],
    envEntries: nodeEnvEntries,
    // ⛔ STDERR, NOT STDOUT. Progress is not the answer, and a caller redirecting the answer to a
    //    file must not find it interleaved with percentages.
    log: (line: string): void => void process.stderr.write(line),
    zstd: { register: async () => (await import("./zstd-node.ts")).registerNodeZstd() },
  };
}

/**
 * Put this machine in the register: what the two Node doors — `index.ts` and the command's own
 * entry point — call before anything that loads the engine, keeps state or reads the environment.
 *
 * ⛔ THE COMMAND LOADS THIS FILE LATE, not at the top of `main.ts`. The chain below reaches the
 *    credentials module, and a fixed cost at the head of `nmts --help` is one an agent running
 *    this tool in a loop pays thousands of times (`check:cli-startup`).
 */
export function registerNodeHost(): void {
  registerHost(nodeHost());
}
