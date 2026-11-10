// `nmts wallet storage extend` — a business extending a user's files from its own wallet: the review
// lists every file and what happens to it, nothing is signed without `--yes` and the wallet unlock,
// a blob the business's wallet does not hold is left with its holder named, and each file bought is
// recorded on the user's account through the user's token.

import { strict as assert } from "node:assert";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { walletStorageExtend } from "../src/commands/wallet-storage-extend.ts";
import { CODE_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { generateBusinessKeys, mintDelegation, type ScopeName } from "../src/platform-sign.ts";
import { toBase64Url } from "../src/bytes.ts";
import { walletAddress } from "../src/wallet.ts";
import { parseWalletGrant, writeWalletGrant } from "../src/wallet-grant.ts";
import { startFakeDrive } from "./fake-drive.ts";
import { fakeChain, NOW, recordingSigner, refuseToSign } from "./fake-extend.ts";
import { generateCode, grantConsents } from "./helpers.ts";

const drive = await startFakeDrive();
after(() => drive.close());

const ELSEWHERE = `0x${"ab".repeat(32)}`;

/** The business's account in a sandbox, and the user's token in a file beside it. */
async function withBusiness(name: string, scope: ScopeName[], body: (tokenFile: string, operator: string) => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = { dir: process.env["NMTS_CONFIG_DIR"], code: process.env[CODE_ENV_VAR] };
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  grantConsents(dir, "plain-env");
  const code = await generateCode();
  process.env[CODE_ENV_VAR] = code;
  const tokenFile = join(dir, "user.token");
  const token = mintDelegation({
    business: toBase64Url(new Uint8Array(16).fill(1)),
    user: toBase64Url(new Uint8Array(16).fill(9)),
    privateKey: generateBusinessKeys().privateKey,
    scope,
    ttlSecs: 3_600,
  });
  writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
  await drive.serve(code, []);
  try {
    await body(tokenFile, await walletAddress(code, 0));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [k, v] of [["NMTS_CONFIG_DIR", before.dir], [CODE_ENV_VAR, before.code]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** The user's files: one due on the business's blob, one due on somebody else's. */
function serveUser(operator: string): ReturnType<typeof fakeChain> {
  const preview = (objectId: string): unknown => ({
    item_id: "x",
    targets: [{ sui_object_id: objectId, storage_kind: 0, expiry_epoch: 1202, shared_items: 1 }],
    treasury_parts: 0,
    untracked_parts: 0,
  });
  drive.objects = ["ours", "theirs"];
  drive.extendPreviews.set("ours", preview("0xours"));
  drive.extendPreviews.set("theirs", preview("0xtheirs"));
  return fakeChain({
    leases: [
      { objectId: "0xours", size: 1_000_000, endEpoch: 1202, holder: { kind: "address", address: operator } },
      { objectId: "0xtheirs", size: 1_000_000, endEpoch: 1202, holder: { kind: "address", address: ELSEWHERE } },
    ],
  });
}

function lines(): { out: string[]; write: (line: string) => void } {
  const out: string[] = [];
  return { out, write: (line) => out.push(line) };
}

async function refusal(run: Promise<unknown>): Promise<NmtsError> {
  const failure = await run.then(() => null, (e: unknown) => e);
  assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
  return failure;
}

test("the review names every file; nothing is signed without --yes and the unlock; then each is bought and recorded", async () => {
  await withBusiness("storage-extend-for", ["files_read", "storage_spend"], async (tokenFile, operator) => {
    const chain = serveUser(operator);
    const base = { server: drive.base, network: "testnet", now: NOW, delegationFile: tokenFile, readChain: () => chain, readActiveWallet: async () => 0 };

    const said = lines();
    const no = refuseToSign("it signed without --yes");
    const stopped = await refusal(walletStorageExtend([], { ...base, write: said.write, sign: no }));
    assert.equal(stopped.exitCode, 4);
    const text = said.out.join("\n");
    assert.match(text, /Would extend 1 of 2 files from 0x[0-9a-f]{64} \(wallet 0\)/);
    assert.match(text, /ours {2}epoch 1202 to 1204/);
    assert.match(text, new RegExp(`theirs {2}left as it is: EXTEND_NOT_OWNED: .*${ELSEWHERE}`));
    assert.equal(no.calls, 0);

    const locked = await refusal(walletStorageExtend([], { ...base, write: lines().write, sign: no, yes: true }));
    assert.match(locked.message + String(locked.nextStep), /unlock/i);
    assert.equal(no.calls, 0, "it signed without the unlock");

    writeWalletGrant(parseWalletGrant({ days: "7", scope: "storage" }, new Date(NOW), "t"));
    const sign = recordingSigner();
    const json = lines();
    assert.equal(await walletStorageExtend([], { ...base, write: json.write, sign, yes: true, json: true }), 0);
    assert.deepEqual(sign.asked, [{ objectIds: ["0xours"], epochs: 2 }]);
    assert.deepEqual(drive.extendRecordedFor, ["ours"], "the new date went somewhere other than the user's file");
    const done: unknown = JSON.parse(json.out.at(-1) ?? "{}");
    assert.ok(typeof done === "object" && done !== null);
    assert.equal(Reflect.get(done, "signed"), true);
  });
});

test("⛔ a token file that is missing, or a token without storage_spend, is refused before anything is signed", async () => {
  await withBusiness("storage-extend-for-scope", ["files_read"], async (tokenFile, operator) => {
    const chain = serveUser(operator);
    const sign = refuseToSign("it signed for a token that cannot record");
    const base = { server: drive.base, network: "testnet", now: NOW, readChain: () => chain, readActiveWallet: async () => 0, sign, yes: true };
    const none = await refusal(walletStorageExtend([], { ...base, write: lines().write }));
    assert.equal(none.exitCode, 2);
    const scoped = await refusal(walletStorageExtend([], { ...base, write: lines().write, delegationFile: tokenFile }));
    assert.match(scoped.message, /^DELEGATION_SCOPE:.*storage_spend/);
    assert.equal(sign.calls, 0);
  });
});
