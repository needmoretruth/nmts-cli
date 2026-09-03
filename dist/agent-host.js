// Which agent is running this tool, measured rather than assumed.
//
// ⛔ WHY IT MATTERS AND IS NOT COSMETIC. Three of the five hosts below CLEAR THE ENVIRONMENT before
//    they start an MCP server and put back only a fixed allow-list. `NMTS_ACCOUNT_CODE`,
//    `NMTS_ACCOUNT_CODE_FILE` and the passphrase variable are not on any of those lists, so under
//    Codex, Hermes and OpenClaw they DO NOT ARRIVE — however carefully the person exported them.
//    That is a fact worth saying before the first upload rather than after it.
//
// ⛔ TWO DIFFERENT QUESTIONS, AND THEY HAVE DIFFERENT ANSWERS.
//      · An environment marker says "one of my ancestors is this host". It is inherited by every
//        descendant, so an agent that starts a shell that starts another agent leaves both markers
//        standing. It never proves who started US.
//      · MCP `initialize` carries `clientInfo`, which comes from the process on the other end of
//        this pipe. That one IS the direct parent, and it survives the washing above because it
//        travels over the protocol rather than in the environment.
//    So the two are reported separately and never merged into one confident answer.
//
// ⛔ NOTHING HERE IS A SECURITY BOUNDARY. Every marker below can be set by anything, and one of
//    them (Codex's `CODEX_PERMISSION_PROFILE`) says so in its own source comment. This tells an
//    agent what to expect; it never decides what is allowed.
//
// ⚠ MEASURED 2026-08-31 against Claude Code 2.1.251, Codex 0.151.0, opencode 1.18.25,
//   Hermes 0.20.6 and OpenClaw 2026.8.1 — each from that project's own source or documentation.
//   A host that changes its markers will simply stop being recognised, which is the safe direction:
//   an unrecognised host reports nothing rather than reporting the wrong name.
import { readFileSync } from "node:fs";
import { platform } from "node:os";
/** What a host calls itself where a person would see it. */
export const HOST_NAMES = {
    "claude-code": "Claude Code",
    codex: "Codex",
    opencode: "opencode",
    hermes: "Hermes",
    openclaw: "OpenClaw",
};
/**
 * Does this host wash the environment when it starts an MCP server?
 *
 * ⛔ MEASURED FROM EACH PROJECT'S SOURCE, not from behaviour we hope for:
 *      · Codex `env_clear()` then an eleven-name allow-list (`rmcp-client/src/utils.rs`).
 *      · Hermes an eight-name `_SAFE_ENV_KEYS` (`tools/mcp_tool.py`), documented as deliberate.
 *      · OpenClaw the MCP SDK's own six-name default (`agents/mcp-stdio-transport.ts`).
 *      · Claude Code and opencode pass the parent environment through.
 *    ⚠ The two that pass it through do so BY CHOICE — the SDK default they build on is the same
 *      six names. This says what they do today, and nothing about what they promise.
 */
export const WASHES_ENVIRONMENT = {
    "claude-code": false,
    codex: true,
    opencode: false,
    hermes: true,
    openclaw: true,
};
/**
 * Claude Code writes its version into `AI_AGENT` with the dots turned into hyphens
 * (`claude-code_2-1-251_harness`). Reading it back is worth doing only when the value still starts
 * with that host's own prefix — Claude Code leaves an outer host's `AI_AGENT` alone, so any other
 * shape belongs to somebody else and its middle field is not a Claude Code version.
 */
function claudeVersionFrom(aiAgent) {
    if (aiAgent === undefined || !aiAgent.startsWith("claude-code_"))
        return null;
    const middle = aiAgent.split("_")[1];
    if (middle === undefined || !/^[0-9]+(-[0-9]+)*$/.test(middle))
        return null;
    return middle.replaceAll("-", ".");
}
/**
 * Every host whose marker is in this environment.
 *
 * ⛔ A LIST, NOT AN ANSWER. Markers accumulate: an agent inside an agent leaves both, and that was
 *    seen while measuring (`OPENCODE=1` and `CLAUDECODE=1` arrived together). Returning the first
 *    match would name whichever host this function happens to test first.
 */
export function hostsInEnvironment(env = process.env) {
    const out = [];
    const seen = (id, by, version = null) => out.push({ id, relation: "ancestor", by, version });
    if (env["CLAUDECODE"] === "1")
        seen("claude-code", "CLAUDECODE=1", claudeVersionFrom(env["AI_AGENT"]));
    // ⛔ `CODEX_SANDBOX` is NOT here: Codex sets it only when a sandbox is in use, so its absence
    //    means nothing at all. These two are set for every child of the shell tool.
    if ((env["CODEX_THREAD_ID"] ?? "") !== "")
        seen("codex", "CODEX_THREAD_ID");
    else if ((env["CODEX_SESSION_ID"] ?? "") !== "")
        seen("codex", "CODEX_SESSION_ID");
    if (env["OPENCODE"] === "1")
        seen("opencode", "OPENCODE=1");
    if (env["HERMES_AGENT"] === "true")
        seen("hermes", "HERMES_AGENT=true");
    else if ((env["HERMES_SESSION_ID"] ?? "") !== "")
        seen("hermes", "HERMES_SESSION_ID");
    if (env["OPENCLAW_CLI"] === "1")
        seen("openclaw", "OPENCLAW_CLI=1");
    else if ((env["OPENCLAW_SHELL"] ?? "") !== "")
        seen("openclaw", "OPENCLAW_SHELL");
    // ⛔ `AI_AGENT` on its own is deliberately not read. Claude Code and Hermes both write it with
    //    `${AI_AGENT:-…}`, so it holds the OUTERMOST host's name and answers a question nobody asked.
    return out;
}
/**
 * Who is on the other end of this MCP pipe.
 *
 * ⛔ `mcp` IS NOT A HOST. It is the Python MCP SDK's default name, so every client built on that
 *    SDK that does not set its own arrives calling itself that — Hermes among them. Reading it as
 *    a host name would put a confident wrong name on the screen, which is worse than an empty one.
 */
export function hostFromClientInfo(info) {
    const name = typeof info?.name === "string" ? info.name : "";
    if (name === "")
        return null;
    const version = typeof info?.version === "string" && info.version !== "" ? info.version : null;
    const at = (id, useVersion) => ({ id, relation: "parent", by: `clientInfo.name=${name}`, version: useVersion ? version : null });
    if (name === "claude-code")
        return at("claude-code", true);
    // The crate that speaks MCP is versioned separately from the Codex release, so its number is not
    // the version a person would recognise and is left out rather than shown as one.
    if (name === "codex-mcp-client")
        return at("codex", false);
    if (name === "opencode")
        return at("opencode", true);
    // ⛔ Pinned to "0.0.0" in OpenClaw's main path, so the field is present and meaningless.
    if (name.startsWith("openclaw-"))
        return at("openclaw", false);
    return null;
}
/**
 * Hermes, and only on Linux.
 *
 * ⛔ IT IS THE ONLY HOST WITH NO MARKER OF ITS OWN IN EITHER OTHER PLACE. It washes the environment
 *    and it never sets `clientInfo`, so what is left is the shape of the process that started us:
 *    on POSIX it inserts a watchdog written in Python between itself and the server. Windows gets
 *    no wrapper and therefore no signal — `null` there is "not measurable", not "not Hermes".
 */
export function hermesFromParent(readParentCommand = readLinuxParentCommand) {
    const command = readParentCommand();
    if (command === null || !command.includes("mcp_stdio_watchdog.py"))
        return null;
    return { id: "hermes", relation: "parent", by: "the parent process runs mcp_stdio_watchdog.py", version: null };
}
/** The parent's command line on Linux, or `null` anywhere the question cannot be asked. */
export function readLinuxParentCommand() {
    if (platform() !== "linux")
        return null;
    try {
        return readFileSync(`/proc/${process.ppid}/cmdline`, "utf8").replaceAll("\0", " ").trim();
    }
    catch {
        return null;
    }
}
/**
 * The one thing an agent has to know before it plans anything: can a secret reach this process
 * through the environment at all?
 *
 * Returns the hosts that would have washed it away, or an empty list when nothing here washes.
 */
export function washingHosts(sightings) {
    const ids = new Set();
    for (const s of sightings)
        if (WASHES_ENVIRONMENT[s.id])
            ids.add(s.id);
    return [...ids];
}
/** One sighting in the words the `env` command prints. */
export function describeSighting(s) {
    const version = s.version === null ? "" : ` ${s.version}`;
    const relation = s.relation === "parent" ? "started this server" : "is running somewhere above this process";
    return `${HOST_NAMES[s.id]}${version} ${relation} (${s.by})`;
}
