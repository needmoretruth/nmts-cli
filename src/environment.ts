// Working out where this tool is running, and what that means for the account code.
//
// ⛔ IT IS FOR THE AGENT, AND THE AGENT IS FOR THE PERSON. A program driving this tool cannot see
//    what a person can — whether it is inside a container, whether the home directory survives the
//    next run, whether the code it was handed can be kept private here. Those are the facts that
//    decide whether an upload is safe to start, and they are exactly the facts nobody thinks to
//    mention. So they are measured and printed.
//
// ⛔ EVERY ANSWER IS MEASURED OR "UNKNOWN". There is no guessing here: not knowing is a fact worth
//    reporting, and an invented one is worse than a missing one. The failure this avoids is the
//    tool cheerfully saying "not a container" on a runtime it has never heard of.
//
// ⚠ NOTHING HERE IS A SECURITY BOUNDARY. Everything below is discoverable by anything running in
//   the same place; none of it protects anything. It exists so that what happens next is a
//   decision rather than a surprise.

import { existsSync, readFileSync } from "node:fs";
import { platform, release, tmpdir, userInfo } from "node:os";
import { configDir, codeStorageIsPrivate, modesAreEnforced } from "./credentials.ts";
import { HOST_NAMES, hostsInEnvironment, washingHosts, type HostSighting } from "./agent-host.ts";
import { BINARY_NAME } from "./product.ts";

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
export function detectContainment(): Containment {
  if (platform() !== "linux") return "unknown";
  if (existsSync("/run/.containerenv")) return "podman";
  if (existsSync("/.dockerenv")) return "docker";
  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf8");
    if (/\b(docker|podman|containerd|kubepods|lxc)\b/.test(cgroup)) return "container";
    // PID 1 in a plain cgroup-v2 root line is what an ordinary host looks like.
    return "none";
  } catch {
    return "unknown";
  }
}

/**
 * Is this process inside a USER NAMESPACE that maps root to somebody else?
 *
 * ⛔ THIS IS WHAT "ROOTLESS" ACTUALLY MEANS, and measuring the uid instead gets it backwards.
 *    A rootless Podman container runs as uid 0 INSIDE — so "am I root?" answers yes — while that
 *    0 maps to an ordinary user on the host, which is the whole point. `/run/.containerenv` was
 *    the obvious place to ask and it is EMPTY on the Podman measured here (2026-08-23), so the
 *    answer has to come from the mapping itself.
 *
 * `/proc/self/uid_map` is `<inside> <outside> <count>` per line. Root mapped to root over the
 * whole range is the ordinary, un-namespaced case:
 *   host / rootful Docker: `0 0 4294967295`
 *   rootless Podman:       `0 1000 1` then `1 100000 65536`
 *
 * `null` on any platform or kernel that does not publish it — not knowing is a fact, not a no.
 */
function inUserNamespace(): boolean | null {
  try {
    const first = readFileSync("/proc/self/uid_map", "utf8").trim().split("\n")[0];
    const parts = first?.trim().split(/\s+/) ?? [];
    if (parts.length < 3) return null;
    const inside = Number(parts[0]);
    const outside = Number(parts[1]);
    if (!Number.isFinite(inside) || !Number.isFinite(outside)) return null;
    return !(inside === 0 && outside === 0);
  } catch {
    return null;
  }
}

/** Could this process open a browser for a person to look at? */
function canOpenBrowser(): boolean {
  if (platform() === "darwin" || platform() === "win32") return true;
  // On Linux a graphical session is what makes a browser possible. Neither variable being set is
  // the ordinary case for a container, a build step, or a machine reached over ssh.
  return Boolean(process.env["DISPLAY"] || process.env["WAYLAND_DISPLAY"]);
}

export function readEnvironment(): Environment {
  const containment = detectContainment();
  const inContainer = containment === "docker" || containment === "podman" || containment === "container";
  let uid: number | null = null;
  try {
    uid = modesAreEnforced() ? userInfo().uid : null;
  } catch {
    uid = null;
  }
  return {
    os: platform(),
    osRelease: release(),
    node: process.versions.node,
    containment,
    rootMapped: inContainer ? inUserNamespace() : null,
    uid,
    privateStorage: codeStorageIsPrivate(),
    configDir: configDir(),
    interactive: process.stdin.isTTY === true,
    browserReachable: canOpenBrowser(),
    agentHosts: hostsInEnvironment(),
  };
}

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
export function adviseFor(env: Environment, hasStoredCode: boolean): Advice[] {
  const out: Advice[] = [];

  if (!env.privateStorage) {
    out.push({
      level: "warn",
      text:
        `This filesystem does not keep the mode a file is written with, so a stored account code ` +
        `could be read by anything else that can reach ${env.configDir}. Supplying the code for ` +
        `each run instead of storing it avoids that.`,
    });
  }

  if (env.containment !== "none" && env.containment !== "unknown") {
    out.push({
      level: "note",
      text:
        `This is a ${env.containment} container. Anything written to ${env.configDir} is lost when ` +
        `it is removed unless that path is a volume, so a stored account code will not be there ` +
        `next time.`,
    });
    out.push({
      level: "warn",
      text:
        `Do not pass the account code as an environment variable in a container: the whole ` +
        `environment is visible to anybody who can inspect it. Put the code in a file and name ` +
        `that file in NMTS_ACCOUNT_CODE_FILE, or pipe it in.`,
    });
    // ⛔ TWO DIFFERENT FACTS, and conflating them is how "rootless" gets reported backwards. What
    //    matters for the host is whether root HERE is root THERE; the uid inside is separate.
    if (env.rootMapped === true) {
      out.push({
        level: "note",
        text:
          `This container is rootless: root inside it is an ordinary user on the host, so a ` +
          `mistake in any program here — this one included — is bounded by that user's reach.`,
      });
    } else if (env.rootMapped === false) {
      out.push({
        level: "warn",
        text:
          `Root inside this container is root on the host. Running it rootless — \`podman run\` as ` +
          `an ordinary user, or Docker's rootless mode — bounds what a mistake here can reach.`,
      });
    }
    if (env.uid === 0 && env.rootMapped !== true) {
      out.push({
        level: "warn",
        text: `This process is running as root. Nothing this tool does needs that.`,
      });
    }
  }

  if (!env.interactive && !hasStoredCode) {
    out.push({
      level: "warn",
      text:
        `There is no terminal here, so this tool cannot ask for the account code. It has to ` +
        `arrive in the environment or in a file named by NMTS_ACCOUNT_CODE_FILE.`,
    });
  }

  if (!env.browserReachable) {
    out.push({
      level: "note",
      text:
        `No browser can be opened here. Anything that needs a human check — making an account, ` +
        `applying for the free trial — has to be done on a machine that has one.`,
    });
  }

  if (env.os === "win32") {
    out.push({
      level: "note",
      text:
        `Windows applies no POSIX file mode, so a stored account code inherits the folder's ` +
        `permissions rather than being restricted to one user.`,
    });
  }

  if (env.configDir.startsWith(tmpdir())) {
    out.push({
      level: "warn",
      text: `The configuration directory is inside the temporary directory and may be cleared at any time.`,
    });
  }

  // ⛔ THE ONE THING THAT SURPRISES PEOPLE. Three of the five agents this tool knows clear the
  //    environment before starting an MCP server and put back a fixed list of names — none of
  //    which is ours. So a person who exported the account code, attached the tool, and watched
  //    it say "not found" did everything right; the value was dropped between the two. Saying so
  //    while the marker is still visible (in the shell, where nothing has been cleared yet) is the
  //    only moment it can be said before the failure rather than after it.
  const washing = washingHosts(env.agentHosts);
  if (washing.length > 0) {
    const names = washing.map((id) => HOST_NAMES[id]).join(" and ");
    out.push({
      level: "warn",
      text:
        `${names} clears the environment before starting an MCP server and restores only a fixed ` +
        `list of names, which does not include NMTS_ACCOUNT_CODE or NMTS_ACCOUNT_CODE_FILE. Those ` +
        `work in a terminal here and will not reach the tool once it is attached. Sign in once ` +
        `with \`${BINARY_NAME} login\` so the code is in this tool's own file instead.`,
    });
  }

  return out;
}
