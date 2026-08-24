// `nmts login` taking an API key: the ways in, what is checked before anything is written, and
// what never comes out.
//
// ⛔ THE SERVER IS REAL AND IT IS STRICT ABOUT THE ADDRESS. It answers one route and one method
//    and 404s everything else, so a tool that asked somewhere else would fail here rather than
//    pass against a fake that answers anything — the mistake `check:cli-routes` exists because of.
//
// ⛔ AND THE REQUESTS ARE COUNTED, NOT JUST THEIR ANSWERS. Half of what this change had to get
//    right is what does NOT go on the wire: an account code pasted where a key goes, a truncated
//    key, a second key offered to a machine that already has one. "It refused" is not the
//    assertion — "it refused having sent nothing" is, and only the call log can say that.

import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, test } from "node:test";

import { login, type LoginOptions } from "../src/commands/login.ts";
import {
  API_KEY_ENV_VAR,
  API_KEY_FILE_ENV_VAR,
  CODE_ENV_VAR,
  CODE_FILE_ENV_VAR,
  PASSPHRASE_ENV_VAR,
  modesAreEnforced,
  testConfigDir,
} from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { generateCode } from "./helpers.ts";

/**
 * ⛔ ASSEMBLED RATHER THAN WRITTEN OUT, so nothing in this file reads as a credential to a scanner
 *    or to a person who finds it. Neither of these was ever issued by anything.
 */
const HANDLE_A = "Abcdefghijkl";
const HANDLE_B = "Zyxwvutsrqpo";
const SECRET_A = "a".repeat(43);
const SECRET_B = "b".repeat(43);
const KEY_A = ["nmts", "ak1", HANDLE_A].join("_") + "_" + SECRET_A;
const KEY_B = ["nmts", "ak1", HANDLE_B].join("_") + "_" + SECRET_B;

/** ⚠ Not a secret: it seals a throwaway code the engine made for this run and nothing else. */
const PASS = "correct horse battery staple";

/** What the fake server answers next, and everything it was asked. */
let answer: { status: number; body: unknown } = { status: 200, body: { verified: true } };
let calls: { method: string; path: string; auth: string | undefined }[] = [];

const server: Server = createServer((req, res) => {
  const method = req.method ?? "";
  const path = req.url ?? "";
  calls.push({ method, path, auth: req.headers.authorization });
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (path !== "/v1/agent/verify") {
    send(404, { error: { code: "NOT_FOUND", message: "no such route" } });
    return;
  }
  if (method !== "GET") {
    send(405, { error: { code: "METHOD_NOT_ALLOWED", message: "not here" } });
    return;
  }
  send(answer.status, answer.body);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
const BASE = `http://127.0.0.1:${address.port}`;
after(() => server.close());

/** Answers of the shape the real route gives. */
function standing(verified: boolean): { status: number; body: unknown } {
  return { status: 200, body: { verified, round_key: verified ? "2026-W34" : null, verified_until: null } };
}

function refusal(status: number, code: string, message: string): { status: number; body: unknown } {
  return { status, body: { error: { code, message } } };
}

/**
 * Every variable this command reads, cleared.
 *
 * ⛔ CLEARED RATHER THAN ASSUMED ABSENT. One of these left over from the machine running the
 *    tests — a developer with a real key exported — would make a test that proves "nothing was
 *    sent" pass or fail for a reason that has nothing to do with the code.
 */
const VARS = [
  "NMTS_CONFIG_DIR",
  CODE_ENV_VAR,
  CODE_FILE_ENV_VAR,
  PASSPHRASE_ENV_VAR,
  API_KEY_ENV_VAR,
  API_KEY_FILE_ENV_VAR,
] as const;

interface Sandbox {
  dir: string;
  /** Where the credentials file would be. Asserted absent as often as present. */
  path: string;
  /** A throwaway account code. Not an account: nothing was ever created for it. */
  code: string;
}

async function withSandbox(name: string, body: (s: Sandbox) => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = VARS.map((v) => [v, process.env[v]] as const);
  rmSync(dir, { recursive: true, force: true });
  for (const v of VARS) delete process.env[v];
  process.env["NMTS_CONFIG_DIR"] = dir;
  calls = [];
  answer = standing(true);
  const code = await generateCode();
  try {
    await body({ dir, path: join(dir, "credentials.json"), code });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [v, value] of before) {
      if (value === undefined) delete process.env[v];
      else process.env[v] = value;
    }
  }
}

type Injected = Pick<LoginOptions, "readApiKey" | "confirmKeyReplace" | "readPassphrase" | "plain">;

/** One `login`, with the terminal replaced by injection and the output collected. */
async function runLogin(code: string, extra: Injected = {}): Promise<{ lines: string[]; exit: number }> {
  const lines: string[] = [];
  const exit = await login({
    server: BASE,
    network: "testnet",
    readCode: () => Promise.resolve(code),
    readPassphrase: () => Promise.resolve(PASS),
    write: (line) => lines.push(line),
    ...extra,
  });
  return { lines, exit };
}

/** The same, for the runs that must not finish. */
async function loginFails(code: string, extra: Injected = {}): Promise<NmtsError> {
  try {
    await runLogin(code, extra);
  } catch (error) {
    assert.ok(error instanceof NmtsError, `not an NmtsError: ${String(error)}`);
    return error;
  }
  throw new Error("login finished where it had to refuse");
}

/**
 * The stored file, read as what the parser actually proved it is.
 *
 * ⛔ COPIED FIELD BY FIELD RATHER THAN ASSERTED INTO A SHAPE. `JSON.parse` returns whatever was in
 *    the file, and a test that told the compiler otherwise would be testing its own claim.
 */
function stored(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(typeof parsed === "object" && parsed !== null, "the credentials file is not an object");
  const out: Record<string, unknown> = {};
  for (const [field, held] of Object.entries(parsed)) out[field] = held;
  return out;
}

function asked(): string[] {
  return calls.map((c) => `${c.method} ${c.path}`);
}

test("⛔ a key in the environment is checked with the server, then written down at mode 600", async () => {
  await withSandbox("login-key-env", async (s) => {
    process.env[API_KEY_ENV_VAR] = KEY_A;
    const r = await runLogin(s.code);
    assert.equal(r.exit, 0);
    // ⛔ THE WIRE, NOT THE MESSAGE. One request, to the one route a key reaches without holding
    //    any permission, carrying the key where a bearer token goes and nowhere else.
    assert.deepEqual(asked(), ["GET /v1/agent/verify"]);
    assert.equal(calls[0]?.auth, `Bearer ${KEY_A}`);
    assert.equal(stored(s.path)["apiKey"], KEY_A);
    if (modesAreEnforced()) {
      assert.equal(statSync(s.path).mode & 0o077, 0, "the stored key is readable by other users");
    }
  });
});

test("⛔ nothing it prints carries the secret half of the key", async () => {
  await withSandbox("login-key-quiet", async (s) => {
    process.env[API_KEY_ENV_VAR] = KEY_A;
    const r = await runLogin(s.code);
    const out = r.lines.join("\n");
    // The handle is public and IS printed: without it nobody can tell which key was stored.
    assert.ok(out.includes(HANDLE_A), "it did not name the key's public handle");
    assert.ok(!out.includes(SECRET_A), "it printed the secret half of the key");
    assert.ok(!out.includes(KEY_A), "it printed the whole key");
    assert.ok(!out.includes(s.code), "it printed the account code");
  });
});

test("⛔ a key the server refuses is not stored, and the passphrase was never asked for", async () => {
  await withSandbox("login-key-refused", async (s) => {
    process.env[API_KEY_ENV_VAR] = KEY_A;
    answer = refusal(401, "API_KEY_REVOKED", "that key was revoked");
    let passphrasesAsked = 0;
    const failure = await loginFails(s.code, {
      readPassphrase: () => {
        passphrasesAsked += 1;
        return Promise.resolve(PASS);
      },
    });
    assert.equal(failure.exitCode, 3, failure.message);
    assert.match(failure.message, /did not accept that key/);
    assert.ok(!existsSync(s.path), "a key the server refused was written down anyway");
    // ⛔ THE ORDER IS THE POINT. A check that ran after the passphrase would make somebody type
    //    one twice for a run that was always going to be refused.
    assert.equal(passphrasesAsked, 0, "it asked for a passphrase before checking the key");
    assert.ok(!`${failure.message} ${failure.nextStep ?? ""}`.includes(SECRET_A), "the refusal quoted the key");
  });
});

test("⛔ an account code pasted where the key goes never reaches the server", async () => {
  await withSandbox("login-key-is-code", async (s) => {
    // The likeliest wrong paste there is, and the one that must not travel: sending it would put
    // the account code on the wire, which is the thing this product says never happens.
    const failure = await loginFails(s.code, { readApiKey: () => Promise.resolve(s.code) });
    assert.equal(failure.exitCode, 2, failure.message);
    assert.match(failure.message, /account code, not an API key/);
    assert.deepEqual(asked(), [], "the account code was sent to the server");
    assert.ok(!existsSync(s.path), "it wrote a credentials file for a run it refused");
    assert.ok(
      !`${failure.message} ${failure.nextStep ?? ""}`.includes(s.code),
      "the refusal repeated the account code back",
    );
  });
});

test("⛔ a truncated key is refused before anything is sent, and says what arrived", async () => {
  await withSandbox("login-key-truncated", async (s) => {
    const failure = await loginFails(s.code, { readApiKey: () => Promise.resolve(KEY_A.slice(0, 60)) });
    assert.equal(failure.exitCode, 2, failure.message);
    assert.match(failure.message, /not a whole NMTS API key/);
    // The length is named — that is what finds a paste that lost its last characters — and the
    // value is not.
    assert.match(failure.nextStep ?? "", /60 arrived/);
    assert.ok(!(failure.nextStep ?? "").includes(SECRET_A.slice(0, 30)), "the refusal quoted the key");
    assert.deepEqual(asked(), [], "it sent something that was not a key");
  });
});

test("⛔ a key already stored is not replaced by a run that did not say so", async () => {
  await withSandbox("login-key-no-swap", async (s) => {
    process.env[API_KEY_ENV_VAR] = KEY_A;
    await runLogin(s.code);
    assert.equal(stored(s.path)["apiKey"], KEY_A);

    // A different key turns up in the environment — a leftover in a shell profile, or a key made
    // for something else. `login` is a command about the account code; it does not swap this one.
    process.env[API_KEY_ENV_VAR] = KEY_B;
    calls = [];
    const r = await runLogin(s.code);
    assert.equal(r.exit, 0, "it refused the whole run over a key nobody asked it to store");
    assert.equal(stored(s.path)["apiKey"], KEY_A, "the stored key was silently replaced");
    assert.deepEqual(asked(), [], "it checked a key it was never going to store");
    const out = r.lines.join("\n");
    assert.ok(out.includes(API_KEY_ENV_VAR), "it did not say where the key it ignored came from");
    assert.match(out, /NOT stored/);
  });
});

test("⛔ …and it IS replaced when the question is answered with the word", async () => {
  await withSandbox("login-key-swap", async (s) => {
    process.env[API_KEY_ENV_VAR] = KEY_A;
    await runLogin(s.code);

    process.env[API_KEY_ENV_VAR] = KEY_B;
    // ⛔ DISCRIMINATING: anything that is not the word leaves the stored key alone. A confirmation
    //    that accepted "yes", "y" or a stray newline would be one somebody passes without reading.
    calls = [];
    await runLogin(s.code, { confirmKeyReplace: () => Promise.resolve("yes") });
    assert.equal(stored(s.path)["apiKey"], KEY_A, "any answer at all replaced the key");
    assert.deepEqual(asked(), []);

    calls = [];
    const r = await runLogin(s.code, { confirmKeyReplace: () => Promise.resolve("replace") });
    assert.equal(r.exit, 0);
    assert.equal(stored(s.path)["apiKey"], KEY_B, "the answer did not replace the key");
    assert.deepEqual(asked(), ["GET /v1/agent/verify"], "the new key went in unchecked");
    assert.equal(calls[0]?.auth, `Bearer ${KEY_B}`);
    assert.ok(r.lines.join("\n").includes(HANDLE_B));
  });
});

test("the same key offered again is not sent to the server a second time", async () => {
  await withSandbox("login-key-same", async (s) => {
    process.env[API_KEY_ENV_VAR] = KEY_A;
    await runLogin(s.code);
    calls = [];
    // Re-sealing the code with a new passphrase is an ordinary reason to run this again, and it
    // should not cost a round trip about a key that has not moved.
    const r = await runLogin(s.code);
    assert.equal(r.exit, 0);
    assert.deepEqual(asked(), []);
    assert.equal(stored(s.path)["apiKey"], KEY_A);
  });
});

test("a file named by NMTS_API_KEY_FILE is a way in, and a trailing newline does not spoil it", async () => {
  await withSandbox("login-key-file", async (s) => {
    mkdirSync(s.dir, { recursive: true, mode: 0o700 });
    const keyFile = join(s.dir, "key");
    // ⚠ Written the way `echo > file` writes it. Refusing a key over the newline that puts there
    //   would be a puzzle with no clue in it.
    writeFileSync(keyFile, `${KEY_A}\n`, { mode: 0o600 });
    process.env[API_KEY_FILE_ENV_VAR] = keyFile;
    const r = await runLogin(s.code);
    assert.equal(r.exit, 0);
    assert.deepEqual(asked(), ["GET /v1/agent/verify"]);
    assert.equal(calls[0]?.auth, `Bearer ${KEY_A}`, "the newline went to the server with the key");
    assert.equal(stored(s.path)["apiKey"], KEY_A);
  });
});

test("it says when nobody has passed the account's human check lately, and stays quiet when they have", async () => {
  await withSandbox("login-key-unverified", async (s) => {
    process.env[API_KEY_ENV_VAR] = KEY_A;
    answer = standing(false);
    const cold = await runLogin(s.code);
    assert.match(cold.lines.join("\n"), /Nothing has checked lately/);
    assert.match(cold.lines.join("\n"), /verify/);
  });
  await withSandbox("login-key-verified", async (s) => {
    process.env[API_KEY_ENV_VAR] = KEY_A;
    answer = standing(true);
    const warm = await runLogin(s.code);
    // ⛔ The other half of the same claim: a tool that printed the warning either way would be
    //    telling everybody to fetch a person for nothing.
    assert.ok(
      !warm.lines.join("\n").includes("Nothing has checked lately"),
      "it warned about the human check on an account that has one",
    );
  });
});

test("⛔ with no key anywhere it stays offline, stores the code, and says how to get one", async () => {
  await withSandbox("login-key-none", async (s) => {
    // An empty answer is somebody pressing Enter at the prompt: not now, and not an error.
    const r = await runLogin(s.code, { readApiKey: () => Promise.resolve("") });
    assert.equal(r.exit, 0);
    assert.deepEqual(asked(), [], "it talked to the server about a key it does not have");
    const file = stored(s.path);
    assert.ok(file["lockedCode"] !== undefined, "the account code was not stored");
    assert.equal(file["apiKey"], undefined, "it wrote an apiKey field for a key it never had");
    const out = r.lines.join("\n");
    assert.match(out, /No API key is stored/);
    assert.ok(out.includes(API_KEY_ENV_VAR), "it did not say how to hand one over");
  });
});

test("⛔ a 200 that does not answer the question is not proof that a key works", async () => {
  await withSandbox("login-key-strange-answer", async (s) => {
    process.env[API_KEY_ENV_VAR] = KEY_A;
    // Something in front of a server — a proxy, a portal, a stub — answering 200 with JSON to
    // anything. Storing a key on that evidence would call a wrong address a working key.
    answer = { status: 200, body: { hello: "there" } };
    const failure = await loginFails(s.code);
    assert.equal(failure.exitCode, 1, failure.message);
    assert.ok(!existsSync(s.path), "it stored a key on an answer it did not understand");
  });
});
