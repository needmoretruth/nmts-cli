// `nmts wallet storage` — the resources are the browser's reading and ordering, "none" and "could
// not read" are different sentences, and a clock that could not be read removes the judgement,
// not the list.

import { strict as assert } from "node:assert";
import { rmSync } from "node:fs";
import { test } from "node:test";

import { formatBytes, walletStorage, type StorageRead } from "../src/commands/wallet-storage.ts";
import { CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { generateCode, grantConsents } from "./helpers.ts";

function collect(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

async function withAccount(name: string, body: () => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = { dir: process.env["NMTS_CONFIG_DIR"], code: process.env[CODE_ENV_VAR] };
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  grantConsents(dir, "plain-env");
  process.env[CODE_ENV_VAR] = await generateCode();
  try {
    await body();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [name_, value] of [
      ["NMTS_CONFIG_DIR", before.dir],
      [CODE_ENV_VAR, before.code],
    ] as const) {
      if (value === undefined) delete process.env[name_];
      else process.env[name_] = value;
    }
  }
}

const THREE: StorageRead = {
  currentEpoch: 1200,
  items: [
    { objectId: "0xended", startEpoch: 1100, endEpoch: 1150, sizeBytes: 5 * 1024 ** 3 },
    { objectId: "0xsmall", startEpoch: 1190, endEpoch: 1260, sizeBytes: 64 * 1024 ** 2 },
    { objectId: "0xbig", startEpoch: 1195, endEpoch: 1230, sizeBytes: 1024 ** 3 },
  ],
};

test("usable first and largest first, with the usable total on top", async () => {
  await withAccount("wallet-storage-rows", async () => {
    const out = collect();
    assert.equal(await walletStorage({ network: "testnet", write: out.write, readStorage: async () => THREE }), 0);
    const text = out.lines.join("\n");
    assert.match(text, /1\.06 GiB usable now, in 3 resources/);
    const order = ["0xbig", "0xsmall", "0xended"].map((id) => text.indexOf(id));
    assert.ok(order[0] < order[1] && order[1] < order[2], "not usable-first, largest-first");
    assert.match(text, /1\.00 GiB · epoch 1195 to 1230 {2}usable now/);
    assert.match(text, /5\.00 GiB · epoch 1100 to 1150 {2}ended/);
  });
});

test("none is said as none, and --json carries each status", async () => {
  await withAccount("wallet-storage-none", async () => {
    const out = collect();
    assert.equal(
      await walletStorage({ network: "testnet", write: out.write, readStorage: async () => ({ items: [], currentEpoch: 1200 }) }),
      0,
    );
    assert.match(out.lines.join("\n"), /holds no free storage resource/);

    const json = collect();
    assert.equal(await walletStorage({ network: "testnet", json: true, write: json.write, readStorage: async () => THREE }), 0);
    const parsed: unknown = JSON.parse(json.lines.join(""));
    assert.ok(typeof parsed === "object" && parsed !== null);
    assert.equal(Reflect.get(parsed, "usableBytes"), 1024 ** 3 + 64 * 1024 ** 2);
    const resources: unknown = Reflect.get(parsed, "resources");
    assert.ok(Array.isArray(resources));
    assert.deepEqual(
      resources.map((r: unknown) => (typeof r === "object" && r !== null ? Reflect.get(r, "status") : null)),
      ["usable", "usable", "lapsed"],
    );
  });
});

test("⛔ a chain that did not answer is a refusal, and an unread clock drops the judgement but not the list", async () => {
  await withAccount("wallet-storage-down", async () => {
    const failure = await walletStorage({
      network: "testnet",
      write: () => undefined,
      readStorage: async () => {
        throw new Error("node down");
      },
    }).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(failure instanceof NmtsError);
    assert.equal(failure.exitCode, 1);
    assert.match(String(failure.nextStep), /not the same as holding none/);

    const out = collect();
    assert.equal(
      await walletStorage({ network: "testnet", write: out.write, readStorage: async () => ({ ...THREE, currentEpoch: null }) }),
      0,
    );
    const text = out.lines.join("\n");
    assert.match(text, /current epoch could not be read/);
    assert.doesNotMatch(text, /usable now/);
    assert.match(text, /0xbig/);
  });
});

test("bytes read as a person reads them", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1.00 KiB");
  assert.equal(formatBytes(1536 * 1024), "1.50 MiB");
  assert.equal(formatBytes(1024 ** 3), "1.00 GiB");
});
