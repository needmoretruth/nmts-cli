// Which agent is running this tool — the markers, and the traps in reading them.
//
// ⛔ WHAT THIS FILE IS REALLY FOR. Every value below was measured on 2026-08-31 from the host's own
//    source or documentation, and a detector is exactly the kind of code that goes green while
//    knowing nothing: it answers `null` for everything and every "does it refuse?" test passes.
//    So each host has a POSITIVE case with its real marker AND a negative case for the marker that
//    looks like it should work and must not.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  HOST_NAMES,
  WASHES_ENVIRONMENT,
  describeSighting,
  hermesFromParent,
  hostFromClientInfo,
  hostsInEnvironment,
  washingHosts,
} from "../src/agent-host.ts";
import { adviseFor } from "../src/environment.ts";
import { clientOf } from "../src/mcp.ts";

const NOTHING: NodeJS.ProcessEnv = {};

test("each host is recognised by the marker it actually sets", () => {
  const cases: Array<[NodeJS.ProcessEnv, string]> = [
    [{ CLAUDECODE: "1" }, "claude-code"],
    [{ CODEX_THREAD_ID: "thr_abc" }, "codex"],
    [{ CODEX_SESSION_ID: "sess_abc" }, "codex"],
    [{ OPENCODE: "1" }, "opencode"],
    [{ HERMES_AGENT: "true" }, "hermes"],
    [{ HERMES_SESSION_ID: "abc" }, "hermes"],
    [{ OPENCLAW_CLI: "1" }, "openclaw"],
    [{ OPENCLAW_SHELL: "exec" }, "openclaw"],
  ];
  for (const [env, id] of cases) {
    const seen = hostsInEnvironment(env);
    assert.deepEqual(seen.map((s) => s.id), [id], `${JSON.stringify(env)} should be ${id}`);
    assert.equal(seen[0]?.relation, "ancestor", "an inherited variable can only claim an ancestor");
  }
  assert.deepEqual(hostsInEnvironment(NOTHING), [], "an empty environment names nobody");
});

// ⛔ THE TRAP THAT WOULD MAKE THIS DETECTOR WRONG EVERYWHERE. Claude Code and Hermes both write
//    `AI_AGENT` with `${AI_AGENT:-…}`, so it holds the OUTERMOST host's name — an agent running
//    inside another agent leaves the outer one's value standing. Reading it as "who am I under"
//    names the wrong host in exactly the nested case where the answer matters.
test("⛔ AI_AGENT alone never names a host", () => {
  assert.deepEqual(hostsInEnvironment({ AI_AGENT: "claude-code_2-1-251_agent" }), []);
  assert.deepEqual(hostsInEnvironment({ AI_AGENT: "hermes-agent" }), []);
});

test("Claude Code's version is read from AI_AGENT only when AI_AGENT is Claude Code's own", () => {
  const own = hostsInEnvironment({ CLAUDECODE: "1", AI_AGENT: "claude-code_2-1-251_harness" });
  assert.equal(own[0]?.version, "2.1.251");
  // Claude Code running inside another host leaves that host's AI_AGENT alone, so its middle
  // field is not a version and must not be printed as one.
  const nested = hostsInEnvironment({ CLAUDECODE: "1", AI_AGENT: "some-other-harness_v9_agent" });
  assert.equal(nested[0]?.id, "claude-code");
  assert.equal(nested[0]?.version, null, "another host's AI_AGENT was read as a Claude Code version");
  assert.equal(hostsInEnvironment({ CLAUDECODE: "1" })[0]?.version, null);
});

// ⛔ MEASURED, NOT IMAGINED: `OPENCODE=1` and `CLAUDECODE=1` arrived together while this was being
//    measured, because opencode passes the whole parent environment down. A detector that returned
//    the first match would name whichever host it happened to test first.
test("markers accumulate, and all of them are reported", () => {
  const both = hostsInEnvironment({ OPENCODE: "1", CLAUDECODE: "1" });
  assert.deepEqual(new Set(both.map((s) => s.id)), new Set(["claude-code", "opencode"]));
});

test("a marker set to something else is not a marker", () => {
  assert.deepEqual(hostsInEnvironment({ CLAUDECODE: "0" }), []);
  assert.deepEqual(hostsInEnvironment({ OPENCODE: "" }), []);
  assert.deepEqual(hostsInEnvironment({ HERMES_AGENT: "false" }), []);
  assert.deepEqual(hostsInEnvironment({ CODEX_THREAD_ID: "" }), []);
});

// ⛔ Codex sets this ONLY under a sandbox, so its absence proves nothing — and reading it as a
//    marker would report "not Codex" for every Codex run that is not sandboxed.
test("⛔ CODEX_SANDBOX is not used as a marker", () => {
  assert.deepEqual(hostsInEnvironment({ CODEX_SANDBOX: "seatbelt" }), []);
});

test("clientInfo names the host on the other end of the pipe", () => {
  const seen = hostFromClientInfo({ name: "claude-code", version: "2.1.251" });
  assert.equal(seen?.id, "claude-code");
  assert.equal(seen?.relation, "parent", "clientInfo comes from the process that started us");
  assert.equal(seen?.version, "2.1.251");
  assert.equal(hostFromClientInfo({ name: "codex-mcp-client", version: "0.4.0" })?.id, "codex");
  assert.equal(hostFromClientInfo({ name: "opencode", version: "1.18.25" })?.version, "1.18.25");
  assert.equal(hostFromClientInfo({ name: "openclaw-bundle-mcp", version: "0.0.0" })?.id, "openclaw");
  assert.equal(hostFromClientInfo({ name: "openclaw-node-host", version: "0.0.0" })?.id, "openclaw");
  assert.equal(hostFromClientInfo(undefined), null);
  assert.equal(hostFromClientInfo({ name: 7 }), null, "a name that is not a string is not a name");
});

// ⛔ THE VERSIONS THAT ARE PRESENT AND MEANINGLESS. OpenClaw pins "0.0.0" in its main path, and the
//    crate Codex speaks MCP with is versioned separately from the Codex a person installed. Showing
//    either as "the version you are running" is a confident wrong answer.
test("⛔ a version that does not mean what it looks like is not reported", () => {
  assert.equal(hostFromClientInfo({ name: "openclaw-bundle-mcp", version: "0.0.0" })?.version, null);
  assert.equal(hostFromClientInfo({ name: "codex-mcp-client", version: "0.4.0" })?.version, null);
});

// ⛔ THE ONE THAT WOULD PUT A WRONG NAME ON THE SCREEN. `mcp` is the Python MCP SDK's default
//    client name, so every client built on that SDK which does not set its own arrives calling
//    itself that. Hermes is one of them — and so is anything else somebody wrote in an afternoon.
test("⛔ the Python SDK's default name is not a host", () => {
  assert.equal(hostFromClientInfo({ name: "mcp", version: "0.1.0" }), null);
});

test("Hermes is found in the shape of the parent process, and only there", () => {
  const found = hermesFromParent(() => "/usr/bin/python3 /x/tools/mcp_stdio_watchdog.py --ppid 42 -- nmts mcp");
  assert.equal(found?.id, "hermes");
  assert.equal(found?.relation, "parent");
  assert.equal(hermesFromParent(() => "/usr/bin/node /x/other.js"), null);
  // Windows gets no wrapper, so the reader returns null there: not measurable, not "not Hermes".
  assert.equal(hermesFromParent(() => null), null);
});

test("initialize is where the client is read, and nothing else is", () => {
  const init = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", clientInfo: { name: "opencode", version: "1.18.25" } },
  };
  const seen = clientOf(init, () => null);
  assert.equal(seen?.name, "opencode");
  assert.equal(seen?.host?.id, "opencode");
  assert.equal(clientOf({ jsonrpc: "2.0", id: 2, method: "ping" }, () => null), null);
  assert.equal(clientOf("not a request", () => null), null);
});

// ⛔ A NAME WE DO NOT KNOW IS STILL EVIDENCE. Dropping it leaves a person with no way to find out
//    what is talking to their account.
test("an unknown client keeps its name and claims no host", () => {
  const seen = clientOf(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "some-new-agent" } } },
    () => null,
  );
  assert.equal(seen?.name, "some-new-agent");
  assert.equal(seen?.host, null);
});

// Hermes sends the SDK default name, so the parent-process reader is what has to answer.
test("Hermes is recognised on initialize even though its name says nothing", () => {
  const seen = clientOf(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "mcp", version: "0.1.0" } } },
    () => ({ id: "hermes", relation: "parent", by: "the parent process runs mcp_stdio_watchdog.py", version: null }),
  );
  assert.equal(seen?.name, "mcp");
  assert.equal(seen?.host?.id, "hermes");
});

test("the three hosts that clear the environment are the three that clear it", () => {
  assert.deepEqual(
    Object.entries(WASHES_ENVIRONMENT).filter(([, w]) => w).map(([id]) => id).sort(),
    ["codex", "hermes", "openclaw"],
  );
  assert.deepEqual(washingHosts(hostsInEnvironment({ CODEX_THREAD_ID: "t", CLAUDECODE: "1" })), ["codex"]);
  assert.deepEqual(washingHosts(hostsInEnvironment({ CLAUDECODE: "1" })), []);
});

// ⛔ THE POINT OF THE WHOLE MODULE. A person who exported the account code and then attached the
//    tool did everything right and still gets "not found", because the host dropped the variable
//    on the way. This is the sentence that says so while it can still be acted on.
test("running under a host that clears the environment is warned about, by name", () => {
  const base = {
    os: "linux" as NodeJS.Platform,
    osRelease: "6.8.0",
    node: "24.0.0",
    containment: "none" as const,
    rootMapped: null,
    uid: 1000,
    privateStorage: true,
    configDir: "/tmp/nmts-config",
    interactive: true,
    browserReachable: false,
  };
  const under = adviseFor({ ...base, agentHosts: hostsInEnvironment({ CODEX_THREAD_ID: "t" }) }, true);
  const warning = under.find((a) => a.text.includes("clears the environment"));
  assert.ok(warning !== undefined, "nothing said that the variable will not arrive");
  assert.equal(warning?.level, "warn");
  assert.match(warning.text, /Codex/);
  assert.match(warning.text, /NMTS_ACCOUNT_CODE/);
  const clear = adviseFor({ ...base, agentHosts: hostsInEnvironment({ CLAUDECODE: "1" }) }, true);
  assert.equal(
    clear.some((a) => a.text.includes("clears the environment")),
    false,
    "a host that passes the environment through must not be warned about",
  );
});

test("every host this version knows has a name to print", () => {
  for (const id of Object.keys(WASHES_ENVIRONMENT)) {
    assert.equal(typeof HOST_NAMES[id as keyof typeof HOST_NAMES], "string");
  }
  assert.match(
    describeSighting({ id: "claude-code", relation: "ancestor", by: "CLAUDECODE=1", version: "2.1.251" }),
    /Claude Code 2\.1\.251 is running somewhere above this process \(CLAUDECODE=1\)/,
  );
  assert.match(
    describeSighting({ id: "codex", relation: "parent", by: "clientInfo.name=codex-mcp-client", version: null }),
    /^Codex started this server/,
  );
});
