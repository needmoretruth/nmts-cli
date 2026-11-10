// A fresh `nmts ls` / `get` reads a zstd-packed index before any chunk: the codec must be registered
// for that first read, not only when chunks open (D51, 2026-11-10: every fresh `get` failed with
// "this build has no zstd decoder" since the codec began registering lazily).
import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { readFileList } from "../src/manifest.ts";
import { identityOf } from "../src/account.ts";
import { forgetNodeZstd } from "../src/zstd-node.ts";
import { KEY } from "./fake-drive.ts";
import { startFakeItems, withAccount } from "./fake-items.ts";

const fake = await startFakeItems();
after(() => fake.close());

const item = (id: string, name: string) => ({ id, name, parentId: null, kind: 1, size: 10, createdAt: 1, updatedAt: 1 });

test("a zstd-packed index opens in a process that has not registered the codec yet", async () => {
  await withAccount(fake, "zstd-fresh", async (code) => {
    await fake.serveChunked(code, [[item("a", "apples.txt")], [item("b", "bananas.txt")]]);
    forgetNodeZstd();
    const list = await readFileList(fake.base, KEY, code, (await identityOf(code)).accountId);
    assert.deepEqual(
      list.manifest?.entries.map((e) => e.name),
      ["apples.txt", "bananas.txt"],
    );
  });
});
