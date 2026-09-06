// The sandbox and the list-building helpers — moved out of `fake-drive.ts`, which `check:size` measures.

import { rmSync } from "node:fs";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { encodeManifest, type ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";
import { generateCode, grantConsents, sealFileList } from "./helpers.ts";
import type { FakeDrive } from "./fake-drive.ts";
import { KEY } from "./fake-rows.ts";

/**
 * A config directory of this test's own, with the one agreement reading the code from the
 * environment needs. Everything is put back afterwards, including variables that were unset.
 */
export async function withSandbox(
  drive: FakeDrive,
  name: string,
  body: (code: string) => Promise<void>,
): Promise<void> {
  const dir = testConfigDir(name);
  const before = {
    dir: process.env["NMTS_CONFIG_DIR"],
    code: process.env[CODE_ENV_VAR],
    key: process.env[API_KEY_ENV_VAR],
  };
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  grantConsents(dir, "plain-env");
  const code = await generateCode();
  process.env[CODE_ENV_VAR] = code;
  process.env[API_KEY_ENV_VAR] = KEY;
  drive.reset();
  try {
    await body(code);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [n, v] of [
      ["NMTS_CONFIG_DIR", before.dir],
      [CODE_ENV_VAR, before.code],
      [API_KEY_ENV_VAR, before.key],
    ] as const) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
}

/**
 * Seal a list at a version, naming something as the version it was built on when it needs to.
 *
 * ⚠ THE NAMED PREDECESSOR IS A PLACEHOLDER, and it is allowed to be: the codec requires any
 *   version above the first to name one, and nothing on the read path compares it against a blob
 *   this harness ever served. A test that needs the fork check itself uses `otherDeviceWrites`,
 *   which names the real one.
 */
export async function sealed(code: string, entries: ManifestEntry[], seq: number): Promise<string> {
  const body = seq > 1 ? await encodeManifest(entries, seq, "cHJldmlvdXM") : await encodeManifest(entries, seq);
  return sealFileList(code, body);
}

/** One file entry, with the fields a test does not care about filled in. */
export function entry(over: Partial<ManifestEntry> & Pick<ManifestEntry, "id" | "name">): ManifestEntry {
  return { parentId: null, kind: 1, size: 10, createdAt: 1, updatedAt: 1, ...over };
}

/** One folder entry. Folders hold no bytes and the server keeps no row for them. */
export function folder(over: Partial<ManifestEntry> & Pick<ManifestEntry, "id" | "name">): ManifestEntry {
  return entry({ kind: 0, size: 0, ...over });
}

/** Collect what a command printed, line by line. */
export function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}
