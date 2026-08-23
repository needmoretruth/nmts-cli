// Where an account code lives on this machine, and every rule about how it gets there.
//
// ⛔ NEVER FROM THE COMMAND LINE. On Linux any process can read /proc/<pid>/cmdline, so a secret
//    passed as an argument is readable by anything running as the same user for as long as the
//    process lives — and it lands in the shell history besides. NMTS's standalone recovery tool
//    learned this the same way, in an adversarial review, and stopped passing its own token as an
//    argument. So there is no --code flag here, and there never should be: the ways in are an
//    environment variable and the terminal.
//
// ⛔ NEVER IN AN ERROR MESSAGE. Every failure below names the FILE, never the value. An error
//    string is the one place a secret escapes without anybody choosing to print it.
//
// ⚠ WHAT THE FILE MODE DOES AND DOES NOT DO. On Linux and macOS the file is created 0600, so
//    other users on the machine cannot read it. That is the whole of the protection: it is not
//    encrypted, and it does not stop anything running as YOU — which includes every agent you run.
//    On Windows Node ignores the mode argument entirely and the file inherits directory
//    permissions; saying otherwise would be claiming a guarantee the platform does not give.

import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** The environment variable an agent sets instead of running `login`. */
export const CODE_ENV_VAR = "NMTS_ACCOUNT_CODE";
/** The API key, same rules: read fresh, never an argument, never printed. */
export const API_KEY_ENV_VAR = "NMTS_API_KEY";

/** Directory holding everything this tool keeps. 0700 where the platform honours it. */
export function configDir(): string {
  const override = process.env["NMTS_CONFIG_DIR"];
  return override && override.length > 0 ? override : join(homedir(), ".nmts");
}

export function credentialsPath(): string {
  return join(configDir(), "credentials.json");
}

/** What is kept on disk. `apiKey` is absent until API keys exist and one has been supplied. */
export interface Credentials {
  /** The account code, exactly as the person typed it. */
  accountCode: string;
  /** Server credential that waives the human check. Optional: not every account has one. */
  apiKey?: string;
  /** Base URL of the NMTS server this code belongs to. */
  server: string;
  /**
   * Which storage network that server uses.
   *
   * ⛔ Stored rather than inferred each run: the network decides WHERE the files are, and a later
   *    run that guessed differently from the run that uploaded would look in the wrong place and
   *    report an empty account.
   */
  network?: string;
}

/** True on platforms where Node applies a POSIX file mode. */
export function modesAreEnforced(): boolean {
  return process.platform !== "win32";
}

/**
 * Write credentials, replacing any existing file, without ever leaving a readable window.
 *
 * The write goes to a fresh file created with `wx` (fails if the name exists, so nothing already
 * on disk is opened) and is then renamed over the target. A rename within the same directory is
 * atomic, so a reader either sees the old file or the new one and never a half-written one.
 */
export function writeCredentials(creds: Credentials): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (modesAreEnforced()) chmodSync(dir, 0o700);

  const target = credentialsPath();
  const scratch = join(dir, `.credentials.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(scratch, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  if (modesAreEnforced()) chmodSync(scratch, 0o600);
  renameSync(scratch, target);
}

/** Raised when the file exists but this machine is not keeping it private. */
export class CredentialsTooOpenError extends Error {
  // ⛔ Explicit fields, not constructor parameter properties: Node runs these files by ERASING the
  //    types, and a parameter property is not erasable — it has to emit an assignment. `tsc`
  //    refuses it here too (`erasableSyntaxOnly`), so the rule is machine-held, not remembered.
  readonly path: string;
  readonly mode: number;

  constructor(path: string, mode: number) {
    super(
      `${path} can be read by other users on this machine (mode ${mode.toString(8)}). ` +
        `Run: chmod 600 ${path}`,
    );
    this.name = "CredentialsTooOpenError";
    this.path = path;
    this.mode = mode;
  }
}

/**
 * Read credentials from disk, refusing a file other users can read.
 *
 * ⛔ The refusal is the point. A credentials file that went world-readable — copied with `cp -r`,
 *    restored from an archive, written by an older version — is a leak that nothing else in the
 *    system would ever mention. Reading it anyway and carrying on is how that stays quiet.
 */
export function readCredentialsFile(): Credentials | null {
  const path = credentialsPath();
  let raw: string;
  try {
    if (modesAreEnforced()) {
      const mode = statSync(path).mode & 0o777;
      if ((mode & 0o077) !== 0) throw new CredentialsTooOpenError(path, mode);
    }
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof CredentialsTooOpenError) throw error;
    if (isNotFound(error)) return null;
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isCredentials(parsed)) {
    throw new Error(`${path} is not a credentials file this version understands.`);
  }
  return parsed;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function isCredentials(value: unknown): value is Credentials {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v["accountCode"] !== "string" || v["accountCode"].length === 0) return false;
  if (typeof v["server"] !== "string" || v["server"].length === 0) return false;
  if ("apiKey" in v && typeof v["apiKey"] !== "string") return false;
  if ("network" in v && typeof v["network"] !== "string") return false;
  return true;
}

/**
 * The account code this run should use, and where it came from.
 *
 * The environment variable wins over the file so an agent can be handed a code for one run without
 * writing anything to disk — which is the safer shape when the machine is shared or ephemeral.
 */
export function resolveAccountCode(): { code: string; source: "env" | "file" } | null {
  const fromEnv = process.env[CODE_ENV_VAR];
  if (fromEnv !== undefined && fromEnv.length > 0) return { code: fromEnv, source: "env" };
  const file = readCredentialsFile();
  if (file) return { code: file.accountCode, source: "file" };
  return null;
}

/**
 * The API key this run should use, and where it came from.
 *
 * ⚠ SEPARATE FROM THE ACCOUNT CODE ON PURPOSE, and the two can come from different places. The
 *   code is what opens the files; the key is only what makes the server answer without a human
 *   check. Somebody may keep the code in the environment for one run while the key stays on the
 *   machine, or the other way round, and neither combination is unusual enough to refuse.
 */
export function resolveApiKey(): { key: string; source: "env" | "file" } | null {
  const fromEnv = process.env[API_KEY_ENV_VAR];
  if (fromEnv !== undefined && fromEnv.length > 0) return { key: fromEnv, source: "env" };
  const file = readCredentialsFile();
  if (file?.apiKey !== undefined && file.apiKey.length > 0) return { key: file.apiKey, source: "file" };
  return null;
}

/** Scratch location used only by tests that need a directory outside the real home. */
export function testConfigDir(name: string): string {
  return join(tmpdir(), `nmts-agents-test-${name}-${process.pid}`);
}
