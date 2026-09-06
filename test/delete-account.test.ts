// `nmts delete-account` against the fake server: what is sent, what is refused, what is said.
//
// ⛔ THE ONE THAT MATTERS MOST IS THE REFUSAL: an erasure nobody typed for is the silent failure.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { accountProof } from "../src/account-proof.ts";
import { setMode } from "../src/autonomy.ts";
import { CONFIRM_SENTENCE, deleteAccount } from "../src/commands/delete-account.ts";
import { NmtsError } from "../src/errors.ts";
import { accountState } from "./fake-account.ts";
import { collect, startFakeDrive, withSandbox } from "./fake-drive.ts";

const drive = await startFakeDrive();
after(() => drive.close());

function answering(answer: string): { readLine: (q: string) => Promise<string>; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    readLine: async (question: string) => {
      asked.push(question);
      return answer;
    },
  };
}

test("the typed sentence sends the proof beside the key — never the code — and says what stays", async () => {
  await withSandbox(drive, "delete-account-sends", async (code) => {
    const out = collect();
    const input = answering(CONFIRM_SENTENCE);
    assert.equal(await deleteAccount({ server: drive.base, write: out.write, readLine: input.readLine }), 0);
    assert.equal(input.asked.length, 1);
    assert.match(input.asked[0] ?? "", /I UNDERSTAND THIS IS PERMANENT/);
    assert.equal(accountState.erasures.length, 1, "the erase door was not called once");
    assert.equal(accountState.erasures[0]?.proof, await accountProof(code), "the proof is not the sign-in one");
    assert.ok(!(accountState.erasures[0]?.proof ?? "").includes(code.replace(/[\s-]/gu, "")));
    const screen = out.lines.join("\n");
    assert.match(screen, /Not erased: {3}the bytes on the storage network/);
    assert.match(screen, /Not refunded: storage already paid for/);
    assert.equal(out.lines.at(-3), "Erased. The server holds nothing about this account now.");
  });
});

test("anything but the exact sentence erases nothing", async () => {
  await withSandbox(drive, "delete-account-wrong", async () => {
    const out = collect();
    assert.equal(
      await deleteAccount({ server: drive.base, write: out.write, readLine: answering("i understand").readLine }),
      1,
    );
    assert.equal(accountState.erasures.length, 0, "a wrong sentence reached the erase door");
    assert.equal(out.lines.at(-1), "Nothing was erased.");
  });
});

test("⛔ --yes alone does not stand for the sentence: outside skip-permissions it is still typed", async () => {
  await withSandbox(drive, "delete-account-yes-default", async () => {
    const input = answering("no");
    assert.equal(await deleteAccount({ server: drive.base, yes: true, write: collect().write, readLine: input.readLine }), 1);
    assert.equal(input.asked.length, 1, "the sentence was not asked for");
    assert.equal(accountState.erasures.length, 0);
  });
});

test("under skip-permissions the gate's --yes stands for the sentence and nothing is asked", async () => {
  await withSandbox(drive, "delete-account-skip", async () => {
    setMode("skip-permissions", "9.9.9", new Date("2026-09-06T00:00:00Z"));
    try {
      const input = answering("no");
      assert.equal(await deleteAccount({ server: drive.base, yes: true, write: collect().write, readLine: input.readLine }), 0);
      assert.equal(input.asked.length, 0, "the sentence was asked for under skip-permissions");
      assert.equal(accountState.erasures.length, 1);
    } finally {
      setMode("default", "9.9.9", new Date("2026-09-06T00:00:00Z"));
    }
  });
});
