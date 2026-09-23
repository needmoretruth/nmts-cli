// The recovery phrase at the CLI: the NMTS key written as 15 words (BIP-39, English or Korean).
// `nmts login` takes either spelling and stores the key; `whoami --reveal --phrase` prints it back.
// The words themselves are pinned by the crate's vectors — what is held here is that the tool
// treats a phrase as the key it spells, and refuses a wallet's seed by name.
import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { assertUsableCode, identityOf, phraseOf } from "../src/account.ts";
import { testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { generateCode, grantConsents } from "./helpers.ts";

const run = promisify(execFile);
const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
/** ⚠ Not a secret: it locks a throwaway code the engine made for this run and nothing else. */
const PASS = "correct horse battery staple";

test("a phrase in either list is the same account as its key, and is stored as the key", async () => {
  const code = await generateCode();
  const key = await identityOf(code);
  for (const lang of ["en", "ko"] as const) {
    const phrase = await phraseOf(code, lang);
    assert.equal(phrase.split(" ").length, 15);
    assert.equal((await identityOf(phrase)).accountId, key.accountId);
    assert.equal(await assertUsableCode(phrase), key.displayCode, "login would store something other than the key");
  }
});

test("a 12-word wallet seed is refused as a wallet's, and a word list that does not exist is named", async () => {
  const seed = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  await assert.rejects(assertUsableCode(seed), (e: unknown) => e instanceof NmtsError && /wallet/.test(e.nextStep ?? ""));
  await assert.rejects(phraseOf(await generateCode(), "eo"), (e: unknown) => e instanceof NmtsError && /en or ko/.test(e.nextStep ?? ""));
});

test("nmts login with the Korean phrase signs this machine into the key's account", async () => {
  const dir = testConfigDir("cli-phrase-login");
  rmSync(dir, { recursive: true, force: true });
  grantConsents(dir, "plain-env");
  const code = await generateCode();
  const env = { ...process.env, NMTS_CONFIG_DIR: dir, NMTS_PASSPHRASE: PASS };
  try {
    await run(process.execPath, [MAIN, "login"], { env: { ...env, NMTS_ACCOUNT_CODE: await phraseOf(code, "ko") } });
    const { stdout } = await run(process.execPath, [MAIN, "whoami"], { env });
    assert.match(stdout, new RegExp(`Account id\\s+${(await identityOf(code)).accountId}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
