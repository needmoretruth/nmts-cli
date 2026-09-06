import { type HostSighting } from "./agent-host.ts";
/** How this process is contained, as far as it can tell. */
export type Containment = "docker" | "podman" | "container" | "none" | "unknown";
export interface Environment {
    /** `linux`, `darwin`, `win32`, … — what Node reports, not a guess. */
    os: NodeJS.Platform;
    osRelease: string;
    /** Node's own version. An agent choosing between behaviours may care. */
    node: string;
    containment: Containment;
    /**
     * Is root here somebody else on the host?
     *
     * ⚠ NOT THE SAME QUESTION AS `uid`. A rootless container is uid 0 inside and an ordinary user
     *   outside; a rootful one is root in both places. `null` where it cannot be measured.
     */
    rootMapped: boolean | null;
    /** The effective user id INSIDE this process's namespace, where the platform has one. */
    uid: number | null;
    /** Can a file here be kept private? MEASURED — see `codeStorageIsPrivate`. */
    privateStorage: boolean;
    /** Where anything this tool keeps would go. */
    configDir: string;
    /** Is there a person at a keyboard? A prompt is impossible without one. */
    interactive: boolean;
    /** Could a browser be opened here — needed for anything behind a human check. */
    browserReachable: boolean;
    /**
     * Which agent hosts left a marker in this environment.
     *
     * ⚠ EVERY ONE OF THESE IS AN ANCESTOR, NOT NECESSARILY THE PARENT — markers are inherited, so a
     *   tool started by an agent that was itself started by another agent sees both. The direct
     *   parent is only knowable over the protocol, and that lives in the MCP server, not here.
     *   Empty means no marker was found, which includes every host that clears the environment.
     */
    agentHosts: HostSighting[];
}
/**
 * Is this a container, and which kind?
 *
 * The three signals, in order of how much they actually prove:
 *   · `/run/.containerenv` — Podman writes it, and it names its own settings inside.
 *   · `/.dockerenv` — Docker writes it and has for a decade.
 *   · the process's own cgroup line naming a runtime.
 * On a platform where none of those files can exist the answer is `unknown`, not `none`.
 */
export declare function detectContainment(): Containment;
export declare function readEnvironment(): Environment;
/** One fact worth acting on, and what to do about it. */
export interface Advice {
    /** `warn` is something to tell the person about. `note` is context. */
    level: "warn" | "note";
    text: string;
}
/**
 * What this environment means, in the terms somebody has to decide in.
 *
 * ⛔ WRITTEN FOR AN AGENT TO REPEAT TO A PERSON. Each line is a complete sentence about a fact
 *    that was measured here, so passing it along loses nothing. None of it is an instruction
 *    aimed past the reader.
 */
export declare function adviseFor(env: Environment, hasStoredCode: boolean): Advice[];
