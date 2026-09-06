/** The hosts this version knows by name. Anything else is reported as unrecognised, never guessed. */
export type HostId = "claude-code" | "codex" | "opencode" | "hermes" | "openclaw";
/** What a host calls itself where a person would see it. */
export declare const HOST_NAMES: Readonly<Record<HostId, string>>;
export interface HostSighting {
    id: HostId;
    /**
     * `parent` — this host is on the other end of the pipe. `ancestor` — this host is somewhere above
     * us, possibly several processes up. ⛔ Never collapse the two: the second is what an inherited
     * environment variable can honestly claim, and treating it as the first is how a tool running
     * inside two agents names the wrong one.
     */
    relation: "parent" | "ancestor";
    /** The marker that was found, named so the reader can check it. */
    by: string;
    /** The host's own version where the signal carried a usable one. */
    version: string | null;
}
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
export declare const WASHES_ENVIRONMENT: Readonly<Record<HostId, boolean>>;
/**
 * Every host whose marker is in this environment.
 *
 * ⛔ A LIST, NOT AN ANSWER. Markers accumulate: an agent inside an agent leaves both, and that was
 *    seen while measuring (`OPENCODE=1` and `CLAUDECODE=1` arrived together). Returning the first
 *    match would name whichever host this function happens to test first.
 */
export declare function hostsInEnvironment(env?: NodeJS.ProcessEnv): HostSighting[];
/** What an MCP client sends about itself in `initialize`. Only these two fields are ever read. */
export interface ClientInfo {
    name?: unknown;
    version?: unknown;
}
/**
 * Who is on the other end of this MCP pipe.
 *
 * ⛔ `mcp` IS NOT A HOST. It is the Python MCP SDK's default name, so every client built on that
 *    SDK that does not set its own arrives calling itself that — Hermes among them. Reading it as
 *    a host name would put a confident wrong name on the screen, which is worse than an empty one.
 */
export declare function hostFromClientInfo(info: ClientInfo | undefined): HostSighting | null;
/**
 * Hermes, and only on Linux.
 *
 * ⛔ IT IS THE ONLY HOST WITH NO MARKER OF ITS OWN IN EITHER OTHER PLACE. It washes the environment
 *    and it never sets `clientInfo`, so what is left is the shape of the process that started us:
 *    on POSIX it inserts a watchdog written in Python between itself and the server. Windows gets
 *    no wrapper and therefore no signal — `null` there is "not measurable", not "not Hermes".
 */
export declare function hermesFromParent(readParentCommand?: () => string | null): HostSighting | null;
/** The parent's command line on Linux, or `null` anywhere the question cannot be asked. */
export declare function readLinuxParentCommand(): string | null;
/**
 * The one thing an agent has to know before it plans anything: can a secret reach this process
 * through the environment at all?
 *
 * Returns the hosts that would have washed it away, or an empty list when nothing here washes.
 */
export declare function washingHosts(sightings: readonly HostSighting[]): HostId[];
/** One sighting in the words the `env` command prints. */
export declare function describeSighting(s: HostSighting): string;
