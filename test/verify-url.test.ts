// The address `nmts verify` tells a person to open — and what it refuses to tell them.
//
// ⛔ THIS IS THE ONE PLACE THE TOOL SENDS A HUMAN BEING SOMEWHERE. Everything else it prints is
//    about files on this machine. The address arrives over the wire, from whatever server
//    `--server` names, so a stale config or an agent pointed at the wrong host would otherwise
//    have somebody typing a single-use code into a stranger's page — and the person reading the
//    line has no way to tell that page apart from ours.
//
// ⛔ ITS OWN FILE, ITS OWN SERVER. The rest of the `verify` tests drive a fake that answers the
//    real shapes and share one mutable plan between them; this pair needs the fake to answer a
//    WRONG shape, which is the one thing that harness must never do by accident.
import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { rmSync } from "node:fs";
import { after, test } from "node:test";

import { verify } from "../src/commands/verify.ts";
import { API_KEY_ENV_VAR, testConfigDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";

const KEY = ["nmts", "ak1", "Abcdefghijkl"].join("_") + "_" + "x".repeat(43);
const CODE = ["NMTS", "AB3CD", "EF4GH", "JK5MN"].join("-");

/** The address this server hands back, and how long the code it mints stays good. */
let verifyUrl = "https://nmts.me/verify";
let ttlMs = 600_000;

const server: Server = createServer((req, res) => {
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if ((req.url ?? "") !== "/v1/agent/verify") {
    send(404, { error: { code: "NOT_FOUND", message: "no such route" } });
    return;
  }
  if (req.method === "POST") {
    send(201, {
      code: CODE,
      verify_url: verifyUrl,
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
      poll_after_secs: 1,
    });
    return;
  }
  send(200, { verified: false, round_key: null, verified_until: null });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
const base = `http://127.0.0.1:${address.port}`;
after(() => server.close());

async function withSandbox(name: string, body: () => Promise<void>): Promise<void> {
  const dir = testConfigDir(name);
  const before = { dir: process.env["NMTS_CONFIG_DIR"], key: process.env[API_KEY_ENV_VAR] };
  rmSync(dir, { recursive: true, force: true });
  process.env["NMTS_CONFIG_DIR"] = dir;
  process.env[API_KEY_ENV_VAR] = KEY;
  try {
    await body();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of [
      ["NMTS_CONFIG_DIR", before.dir],
      [API_KEY_ENV_VAR, before.key],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("an address a browser cannot trust is refused, and no code is printed", async () => {
  await withSandbox("verify-hostile-url", async () => {
    verifyUrl = "http://evil.example/verify";
    // ⚠ A SHORT WINDOW ON PURPOSE. With the check removed this command WAITS until the code dies,
    //   so leaving the ten-minute default would make the red look like a hang — and a red nobody
    //   waits for is a red nobody reads.
    ttlMs = 300;
    try {
      const lines: string[] = [];
      await assert.rejects(
        () => verify({ server: base, write: (l) => lines.push(l), sleep: async () => {} }),
        (error: unknown) => error instanceof NmtsError,
      );
      // The code must not reach the screen: printed, somebody takes it to that address.
      assert.ok(
        !lines.join("\n").includes(CODE),
        "printed the code for an address it cannot trust",
      );
    } finally {
      verifyUrl = "https://nmts.me/verify";
      ttlMs = 600_000;
    }
  });
});

test("a loopback address over plain http is allowed, because that is the development stack", async () => {
  await withSandbox("verify-loopback-url", async () => {
    verifyUrl = `${base}/verify`;
    try {
      const lines: string[] = [];
      await verify({
        server: base,
        write: (l) => lines.push(l),
        sleep: async () => {},
        signal: AbortSignal.abort(),
      }).catch(() => 0);
      assert.ok(lines.join("\n").includes(`${base}/verify`), "refused the development stack");
    } finally {
      verifyUrl = "https://nmts.me/verify";
    }
  });
});

test("an https address is passed through unchanged", async () => {
  // ⚠ THE OTHER DIRECTION. A check that also refuses the real address kills the whole feature.
  await withSandbox("verify-https-url", async () => {
    const lines: string[] = [];
    await verify({
      server: base,
      write: (l) => lines.push(l),
      sleep: async () => {},
      signal: AbortSignal.abort(),
    }).catch(() => 0);
    assert.ok(lines.join("\n").includes("https://nmts.me/verify"), "did not print the real address");
  });
});
