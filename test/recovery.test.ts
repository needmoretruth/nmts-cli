// `nmts recovery` — the standalone recovery program, fetched and checked.
//
// ⛔ WHAT THESE HOLD, AND WHY EACH ONE MATTERS. This command is the only one in the tool that puts
//    an executable on somebody's disk, and it is reached at the worst moment somebody has: they
//    have lost access to their files. Every property below is one a defect could take away
//    silently — a near-match binary that cannot start, an unchecked file left behind after a bad
//    download, a file quietly replaced.
//
// ⛔ NOTHING HERE REACHES THE INTERNET. The release page is a server on this machine, so a run
//    with no network still fails for a real reason rather than for the absence of one.

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { recovery } from "../src/commands/recovery.ts";
import { NmtsError } from "../src/errors.ts";
import { executableFor, hashFromSums, PUBLISHED, tagFromChain } from "../src/recovery-release.ts";
import { fakeExecutable, startFakeRelease } from "./fake-release.ts";

const release = await startFakeRelease();
after(() => release.close());

/** A directory of this test's own to write into. */
function scratch(): string {
  return mkdtempSync(join(tmpdir(), "nmts-recovery-"));
}

function collect(): { out: string[]; write: (line: string) => void } {
  const out: string[] = [];
  return { out, write: (line) => out.push(line) };
}

/** Put every published executable on the fake release, with sums generated from the bytes. */
function serveEverything(): void {
  release.reset();
  for (const published of PUBLISHED) release.assets.set(published.asset, fakeExecutable(published.asset));
}

const refusal = async (run: Promise<unknown>): Promise<NmtsError> => {
  const failure = await run.then(() => null, (e: unknown) => e);
  assert.ok(failure instanceof NmtsError, `it did not refuse — ${String(failure)}`);
  return failure;
};

// ── which file this machine gets ──────────────────────────────────────────────────────────────

test("every platform the release publishes gets its own executable, and no other", async () => {
  // ⛔ The table is asserted as a SET, not looked up twice. A mapping test that asks the same
  //    function the command asks would agree with it however wrong both are.
  assert.deepEqual(
    PUBLISHED.map((e) => e.asset).sort(),
    [
      "nmts-recovery-linux-aarch64",
      "nmts-recovery-linux-x86_64",
      "nmts-recovery-macos-aarch64",
      "nmts-recovery-macos-x86_64",
      "nmts-recovery-windows-x86_64.exe",
    ],
    "the names the release workflow attaches are the contract this command is coded against",
  );

  for (const published of PUBLISHED) {
    serveEverything();
    const dir = scratch();
    try {
      const said = collect();
      const code = await recovery({
        source: release.base,
        platform: published.platform,
        arch: published.arch,
        out: dir,
        write: said.write,
      });
      assert.equal(code, 0, said.out.join("\n"));
      assert.deepEqual(
        readdirSync(dir),
        [published.asset],
        `${published.platform} ${published.arch} was given the wrong file`,
      );
      assert.ok(
        release.calls.includes(`GET /releases/download/${release.tag}/${published.asset}`),
        `it asked for something other than ${published.asset}: ${release.calls.join(" · ")}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("⛔ a machine with no published executable is told which have one, and how to build", async () => {
  serveEverything();
  const dir = scratch();
  try {
    // ⛔ NO `source` OVERRIDE HERE. The address a person is sent to build from has to be the real
    //    one, and the only way to see the real one is to let the command use it. Nothing reaches
    //    the network: the platform is refused before anything is asked for, which the last
    //    assertion in this test is what proves.
    const error = await refusal(
      recovery({ platform: "win32", arch: "arm64", out: dir, write: collect().write }),
    );
    assert.equal(error.exitCode, 4);
    assert.match(error.message, /win32 arm64/, "it did not say what this machine is");
    const next = String(error.nextStep);
    for (const published of PUBLISHED) {
      assert.ok(next.includes(published.label), `the list left out ${published.label}`);
    }
    assert.match(next, /cargo build --release/, "it did not give the commands that build it");
    assert.match(next, /github\.com\/needmoretruth\/nmts-recovery/, "it did not say where the source is");
    assert.deepEqual(readdirSync(dir), [], "it wrote something while refusing");
    assert.deepEqual(release.calls, [], "it went to the network for a file that does not exist");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the bytes, and what is said about them ────────────────────────────────────────────────────

test("a good download lands, is runnable, and says what the check does and does not show", async () => {
  serveEverything();
  const dir = scratch();
  try {
    const said = collect();
    const code = await recovery({
      source: release.base,
      platform: "linux",
      arch: "x64",
      out: dir,
      write: said.write,
    });
    assert.equal(code, 0, said.out.join("\n"));

    const written = join(dir, "nmts-recovery-linux-x86_64");
    assert.deepEqual(
      new Uint8Array(readFileSync(written)),
      fakeExecutable("nmts-recovery-linux-x86_64"),
      "the bytes on the disk are not the bytes the release served",
    );
    if (process.platform !== "win32") {
      assert.equal(
        statSync(written).mode & 0o777,
        0o700,
        "the file is not runnable by the person who asked for it",
      );
    }

    const words = said.out.join("\n");
    assert.ok(words.includes(written), "it did not print the full path it wrote");
    assert.ok(words.includes(release.tag), "it did not say which release the file came from");
    assert.ok(
      words.includes(`${release.base}/releases/download/${release.tag}/nmts-recovery-linux-x86_64`),
      "it did not print the address the file came from",
    );
    const flat = words.replace(/\s+/g, " ");
    assert.ok(
      flat.includes("these bytes are the bytes that release published"),
      "it did not say what the check shows",
    );
    assert.ok(
      flat.includes("does not show who published that release"),
      "it did not say what the check does not show",
    );
    // ⛔ NOT ONE WORD MORE THAN THAT. A checksum published beside the file it describes carries no
    //    claim about who produced either, and a reader who takes "verified" out of this output has
    //    been told something nobody established.
    for (const overclaim of [/\bverified\b/i, /\btrusted\b/i, /\bsafe\b/i, /\bauthentic/i]) {
      assert.ok(!overclaim.test(words), `the output promises more than it can: ${String(overclaim)}`);
    }
    assert.match(words, /PATH/, "it did not say that nothing was installed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ the executable comes from the release the sums came from, not from whatever is newest now", async () => {
  // ⛔ THE DISCRIMINATING CASE: a release is published BETWEEN the two requests. A command that
  //    asks for "latest" twice gets a file the sums in its hand do not describe, and the two are
  //    then compared to no purpose — the mismatch would read as a corrupt download. Resolving the
  //    tag once and reusing it is what makes the comparison mean anything at all.
  release.reset();
  release.tag = "v1.2.3";
  const wanted = fakeExecutable("the build the sums describe");
  release.assets.set("nmts-recovery-linux-x86_64", wanted);
  release.afterSums = () => {
    release.publish(
      "v2.0.0",
      new Map([["nmts-recovery-linux-x86_64", fakeExecutable("a build published a moment later")]]),
    );
    release.tag = "v2.0.0";
  };

  const dir = scratch();
  try {
    const said = collect();
    assert.equal(
      await recovery({ source: release.base, platform: "linux", arch: "x64", out: dir, write: said.write }),
      0,
      said.out.join("\n"),
    );
    assert.deepEqual(
      new Uint8Array(readFileSync(join(dir, "nmts-recovery-linux-x86_64"))),
      wanted,
      "it handed over a file from a release other than the one it checked against",
    );
    assert.deepEqual(
      release.calls,
      [
        "GET /releases/latest/download/SHA256SUMS",
        "GET /releases/download/v1.2.3/SHA256SUMS",
        "GET /releases/download/v1.2.3/nmts-recovery-linux-x86_64",
      ],
      "`latest` was asked more than once, so the two answers can disagree",
    );
    assert.ok(said.out.join("\n").includes("v1.2.3"), "it named a release other than the one it used");
  } finally {
    release.afterSums = null;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ a download whose hash does not match leaves NO file behind", async () => {
  serveEverything();
  // The sums describe a different file, so what arrives cannot match what was promised.
  release.sums = `${createHash("sha256").update("something else").digest("hex")}  nmts-recovery-linux-x86_64\n`;
  const dir = scratch();
  try {
    const error = await refusal(
      recovery({ source: release.base, platform: "linux", arch: "x64", out: dir, write: collect().write }),
    );
    assert.equal(error.exitCode, 4);
    assert.match(error.message, /is not the file release v9\.9\.9 published/);
    assert.match(String(error.nextStep), /deleted/, "it did not say the file was removed");
    assert.deepEqual(
      readdirSync(dir),
      [],
      "⛔ an unchecked executable was left on the disk under the name of a program somebody is about to run",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("⛔ SHA256SUMS with no line for this file is a refusal, and nothing is downloaded", async () => {
  serveEverything();
  release.sums = `${"0".repeat(64)}  nmts-recovery-macos-aarch64\n`;
  const dir = scratch();
  try {
    const error = await refusal(
      recovery({ source: release.base, platform: "linux", arch: "x64", out: dir, write: collect().write }),
    );
    assert.equal(error.exitCode, 4);
    assert.match(error.message, /has no line for nmts-recovery-linux-x86_64/);
    assert.deepEqual(readdirSync(dir), [], "it wrote something while refusing");
    assert.ok(
      !release.calls.some((call) => call.includes("nmts-recovery-linux-x86_64")),
      "it downloaded an executable it had nothing to check against",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── what is already on the disk ───────────────────────────────────────────────────────────────

test("⛔ it will not replace a file that is already there, and --force is what does", async () => {
  serveEverything();
  const dir = scratch();
  const target = join(dir, "nmts-recovery-linux-x86_64");
  try {
    writeFileSync(target, "something the person already had\n");
    const error = await refusal(
      recovery({ source: release.base, platform: "linux", arch: "x64", out: dir, write: collect().write }),
    );
    assert.equal(error.exitCode, 4);
    assert.equal(
      readFileSync(target, "utf8"),
      "something the person already had\n",
      "it replaced a file nobody told it to replace",
    );
    assert.match(String(error.nextStep), /--force/, "it did not say how to replace it on purpose");
    assert.deepEqual(release.calls, [], "it downloaded megabytes before noticing the name was taken");

    assert.equal(
      await recovery({
        source: release.base,
        platform: "linux",
        arch: "x64",
        out: dir,
        force: true,
        write: collect().write,
      }),
      0,
    );
    assert.deepEqual(
      new Uint8Array(readFileSync(target)),
      fakeExecutable("nmts-recovery-linux-x86_64"),
      "--force did not replace it",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the reading of what the release published ─────────────────────────────────────────────────

test("SHA256SUMS is read the way sha256sum writes it, and an ambiguous line is refused", () => {
  const hash = "a".repeat(64);
  assert.deepEqual(hashFromSums(`${hash}  thing\n`, "thing"), { found: true, hash });
  assert.deepEqual(hashFromSums(`${hash} *thing\n`, "thing"), { found: true, hash }, "binary mode");
  assert.deepEqual(hashFromSums(`${hash}  other\n`, "thing"), { found: false, why: "missing" });
  assert.deepEqual(
    hashFromSums(`${hash}  thing\n${"b".repeat(64)}  thing\n`, "thing"),
    { found: false, why: "repeated" },
    "two claims about one file have no answer, and picking one would be this command deciding",
  );
  assert.deepEqual(hashFromSums(`abc  thing\n`, "thing"), { found: false, why: "malformed" });
});

test("the release tag is read out of the middle of the redirect chain, not off the end", () => {
  const chain = [
    "https://example.invalid/o/r/releases/latest/download/SHA256SUMS",
    "https://example.invalid/o/r/releases/download/v0.5.1/SHA256SUMS",
    "https://cdn.example.invalid/blob/1234?token=xyz",
  ];
  assert.equal(tagFromChain(chain, "SHA256SUMS"), "v0.5.1");
  assert.equal(tagFromChain([chain[0] ?? ""], "SHA256SUMS"), null, "an unresolved `latest` names no release");
  assert.equal(
    tagFromChain(["https://example.invalid/o/r/releases/download/..%2F..%2Fx/SHA256SUMS"], "SHA256SUMS"),
    null,
    "a tag off the wire goes back into a URL, so its shape is checked rather than trusted",
  );
});

test("an unpublished platform maps to nothing at all", () => {
  assert.equal(executableFor("linux", "x64")?.asset, "nmts-recovery-linux-x86_64");
  assert.equal(executableFor("win32", "arm64"), null);
  assert.equal(executableFor("freebsd", "x64"), null);
  assert.equal(executableFor("linux", "arm"), null, "32-bit arm is not aarch64 and must not be given it");
});

// ── the agent surface ─────────────────────────────────────────────────────────────────────────

test("⛔ it is not offered to a model as an MCP tool", async () => {
  // ⛔ THE REAL TABLE, NOT THE SOURCE TEXT. This used to read `commands/mcp.ts` and look for the
  //    word — which stopped meaning anything the moment that file gained a paragraph SAYING this
  //    download is deliberately absent, and would have stopped meaning anything anyway once the
  //    tools moved into their own modules. A grep over prose cannot tell a declaration from an
  //    explanation. Downloading an executable and making it runnable is not a step a model takes
  //    on somebody's behalf: the person who runs it has to be the person who decided to have it.
  const { mcpToolSchemas } = await import("../src/commands/mcp.ts");
  const names = mcpToolSchemas().map((t) => t.name);
  assert.ok(names.length >= 10, `only ${names.length} tools were found — the walk is blind`);
  assert.ok(
    !names.some((n) => /recovery/i.test(n)),
    `the recovery download reached the tools a model can call: ${names.join(" ")}`,
  );
});
