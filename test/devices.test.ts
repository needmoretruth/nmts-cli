// `nmts devices` against a real local server: what it lists, what it refuses to invent, and the
// one thing it must never print.
//
// ⛔ THE SEALED NAME IS THE POINT OF THE LAST TEST. The server holds the device name as ciphertext
//    under a key derived from the account code, and this command runs on an API key that cannot
//    open it. Printing the base64 would be printing noise while implying it meant something, and
//    a reader would take it for an identifier.

import { strict as assert } from "node:assert";
import { after, test } from "node:test";

import { accountProof } from "../src/account-proof.ts";
import { setMode } from "../src/autonomy.ts";
import { devices } from "../src/commands/devices.ts";
import { NmtsError } from "../src/errors.ts";
import { KEY } from "./fake-rows.ts";
import { collect, startFakeDrive, withSandbox } from "./fake-drive.ts";
import { accountState, type FakeSession } from "./fake-account.ts";

const drive = await startFakeDrive();
after(() => drive.close());

function session(over: Partial<FakeSession> & Pick<FakeSession, "id">): FakeSession {
  return {
    label_ct: null,
    created_at: "2026-09-01T10:00:00Z",
    last_used_at: "2026-09-04T18:30:00Z",
    expires_at: "2026-10-01T10:00:00Z",
    current: false,
    ...over,
  };
}

test("every signed-in device is listed, with when it was used and when it runs out", async () => {
  await withSandbox(drive, "devices-list", async () => {
    accountState.sessions = [
      session({ id: "a", label_ct: "c2VhbGVk", current: true }),
      session({ id: "b", last_used_at: "2026-08-20T09:00:00Z" }),
    ];
    const out = collect();
    assert.equal(await devices({ server: drive.base, write: out.write }), 0);
    const screen = out.lines.join("\n");
    assert.match(screen, /named device \(the name is sealed\) {2}← this one/);
    assert.match(screen, /unnamed device/);
    assert.match(screen, /last used {3}2026-09-04T18:30:00Z/);
    assert.match(screen, /runs out {4}2026-10-01T10:00:00Z/);
    assert.match(screen, /2 signed in/);
    // ⛔ THE SEALED BYTES ARE NOT ON THE SCREEN. They are not a name and not an identifier.
    assert.ok(!screen.includes("c2VhbGVk"), "the sealed device name was printed");
  });
});

test("it says what it cannot do rather than leaving a caller to find out by trying", async () => {
  await withSandbox(drive, "devices-refusal", async () => {
    accountState.sessions = [session({ id: "a" })];
    const out = collect();
    await devices({ server: drive.base, write: out.write });
    const screen = out.lines.join("\n");
    assert.match(screen, /--sign-out <id>/);
    assert.match(screen, /a key alone cannot/);
  });
});

/** Answers the one confirmation, and records what was asked. */
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

test("--sign-out <id> asks once, then sends the account code's proof beside the key — never the code", async () => {
  await withSandbox(drive, "devices-sign-out-one", async (code) => {
    accountState.sessions = [session({ id: "a" }), session({ id: "b" })];
    const out = collect();
    const input = answering("y");
    assert.equal(await devices({ server: drive.base, signOut: "b", write: out.write, readLine: input.readLine }), 0);
    assert.equal(input.asked.length, 1);
    assert.match(input.asked[0] ?? "", /Sign device b out\?/);
    assert.equal(accountState.signOuts.length, 1, "the sign-out door was not called once");
    const sent = accountState.signOuts[0];
    assert.equal(sent?.url, "/v1/account/sessions/b");
    assert.equal(sent?.proof, await accountProof(code), "the proof is not the sign-in one");
    assert.ok(!(sent?.proof ?? "").includes(code.replace(/[\s-]/gu, "")), "the account code was sent");
    assert.deepEqual(accountState.sessions.map((s) => s.id), ["a"]);
    assert.deepEqual(out.lines, ["Signed device b out."]);
  });
});

test("--sign-out all ends every session and says how many", async () => {
  await withSandbox(drive, "devices-sign-out-all", async () => {
    accountState.sessions = [session({ id: "a" }), session({ id: "b" })];
    const out = collect();
    assert.equal(await devices({ server: drive.base, signOut: "all", write: out.write, readLine: answering("y").readLine }), 0);
    assert.equal(accountState.signOuts[0]?.url, "/v1/account/sessions");
    assert.deepEqual(out.lines, ["Signed out 2 devices."]);
    assert.deepEqual(accountState.sessions, []);
  });
});

test("anything but y signs nothing out", async () => {
  await withSandbox(drive, "devices-sign-out-no", async () => {
    accountState.sessions = [session({ id: "a" })];
    const out = collect();
    assert.equal(await devices({ server: drive.base, signOut: "a", write: out.write, readLine: answering("").readLine }), 1);
    assert.equal(accountState.signOuts.length, 0, "a declined sign-out reached the server");
    assert.deepEqual(out.lines, ["Nothing was signed out."]);
  });
});

test("with --yes (the tier gate's answer) the device is signed out and nothing is asked", async () => {
  await withSandbox(drive, "devices-sign-out-yes", async () => {
    accountState.sessions = [session({ id: "a" })];
    const input = answering("n");
    assert.equal(await devices({ server: drive.base, signOut: "a", yes: true, write: collect().write, readLine: input.readLine }), 0);
    assert.equal(input.asked.length, 0, "the question was asked twice");
    assert.equal(accountState.signOuts.length, 1);
  });
});
test("--json hands back the rows, saying whether each was named rather than what it is called", async () => {
  await withSandbox(drive, "devices-json", async () => {
    accountState.sessions = [session({ id: "a", label_ct: "c2VhbGVk", current: true })];
    const out = collect();
    assert.equal(await devices({ server: drive.base, json: true, write: out.write }), 0);
    assert.deepEqual(JSON.parse(out.lines.join("")), {
      devices: [
        {
          id: "a",
          named: true,
          created_at: "2026-09-01T10:00:00Z",
          last_used_at: "2026-09-04T18:30:00Z",
          expires_at: "2026-10-01T10:00:00Z",
          current: true,
        },
      ],
    });
  });
});

test("an account with nothing signed in says so, and says why a key is not in the list", async () => {
  await withSandbox(drive, "devices-empty", async () => {
    accountState.sessions = [];
    const out = collect();
    assert.equal(await devices({ server: drive.base, write: out.write }), 0);
    const screen = out.lines.join("\n");
    assert.match(screen, /Nothing is signed in/);
    assert.match(screen, /An API key is not a session/);
  });
});

test("it presents the API key and not the account code", async () => {
  await withSandbox(drive, "devices-bearer", async (code) => {
    accountState.sessions = [session({ id: "a" })];
    await devices({ server: drive.base, write: collect().write });
    assert.deepEqual(accountState.bearers, [`Bearer ${KEY}`], "the wrong credential was sent");
    assert.ok(
      !accountState.bearers.join("").includes(code.replace(/[\s-]/gu, "")),
      "the account code was sent as a bearer token",
    );
  });
});
