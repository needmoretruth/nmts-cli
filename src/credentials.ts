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

import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { isLockedCode, type LockedCode } from "./code-vault.ts";
import { NmtsError } from "./errors.ts";

/** The environment variable an agent sets instead of running `login`. */
export const CODE_ENV_VAR = "NMTS_ACCOUNT_CODE";
/** The API key, same rules: read fresh, never an argument, never printed. */
export const API_KEY_ENV_VAR = "NMTS_API_KEY";

/**
 * Opens a passphrase-locked stored code without a terminal.
 *
 * ⚠ A passphrase in an environment variable protects the FILE, not this run: anything that can
 *   read this variable can read the code the moment the tool decodes it. What it still buys is
 *   real — a copied home directory, a backup, an image layer and a stolen disk all yield nothing
 *   — and it is the only shape that works where no person is present to type.
 */
export const PASSPHRASE_ENV_VAR = "NMTS_PASSPHRASE";

/**
 * Names a FILE holding the account code, rather than holding it directly.
 *
 * ⛔ THE ONLY SAFE WAY TO GIVE A CONTAINER A SECRET. See `readSecretFile`.
 */
export const CODE_FILE_ENV_VAR = "NMTS_ACCOUNT_CODE_FILE";

/** Names a file holding the API key. Same reason. */
export const API_KEY_FILE_ENV_VAR = "NMTS_API_KEY_FILE";

/** Where a credential came from. Reported, never guessed. */
export type CredentialSource = "env" | "secret-file" | "file" | "file-locked";

/**
 * An account code that has been FOUND but not necessarily opened.
 *
 * ⛔ THE TWO CASES ARE SEPARATE TYPES so that no caller can read `.code` off a locked one. A
 *    single shape with a nullable field would compile everywhere and be wrong in exactly one
 *    place — the command that forgot to unlock and treated "no code" as "not signed in".
 */
export type ResolvedCode =
  | { readonly source: "env" | "secret-file" | "file"; readonly code: string }
  | { readonly source: "file-locked"; readonly locked: LockedCode };

/** Directory holding everything this tool keeps. 0700 where the platform honours it. */
export function configDir(): string {
  const override = process.env["NMTS_CONFIG_DIR"];
  return override && override.length > 0 ? override : join(homedir(), ".nmts");
}

export function credentialsPath(): string {
  return join(configDir(), "credentials.json");
}

/**
 * What is kept on disk. `apiKey` is absent until API keys exist and one has been supplied.
 *
 * ⛔ EXACTLY ONE OF `accountCode` AND `lockedCode`, and `isCredentials` enforces it. A file with
 *    both would leave a reader to choose, and the wrong choice is the plain copy of a code
 *    somebody asked to have locked.
 */
export interface Credentials {
  /**
   * The account code in the clear.
   *
   * ⛔ ONLY WHEN THE PERSON CHOSE IT (`login --plain`, behind the `unsafe-code-storage` consent).
   *    The default writes `lockedCode` instead.
   */
  accountCode?: string;
  /** The account code sealed under a passphrase. The default form. */
  lockedCode?: LockedCode;
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
 * Can this machine actually keep a file private, where the account code would go?
 *
 * ⛔ IT MEASURES RATHER THAN ASSUMES. "Not Windows" is not the same question: a container with a
 *    bind mount from a Windows host, a network drive, an exFAT stick and several FUSE filesystems
 *    all accept `chmod` and then ignore it. The mode comes back as whatever the filesystem felt
 *    like, and the tool would have written the account code into a file anybody can read while
 *    believing it had locked it.
 *
 * So: write a file, ask for 0600, read the mode back, and delete it. The probe is empty, its name
 * is not the credentials name, and it is removed whatever happens.
 *
 * Returns false on Windows without probing — the platform has no POSIX mode to check, and
 * answering "yes" from a successful no-op would be the worst of the three possible answers.
 */
export function codeStorageIsPrivate(): boolean {
  if (!modesAreEnforced()) return false;
  const dir = configDir();
  const probe = join(dir, `.mode-probe.${process.pid}.tmp`);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(probe, "", { mode: 0o600, flag: "wx" });
    chmodSync(probe, 0o600);
    return (statSync(probe).mode & 0o077) === 0;
  } catch {
    // ⛔ Could not tell counts as NOT private. The fail-safe direction for "I do not know" is to
    //    warn: a wrong warning costs one command, a wrong silence costs the account.
    return false;
  } finally {
    try {
      rmSync(probe, { force: true });
    } catch {
      // An undeleted empty probe file is harmless; failing the login over it would not be.
    }
  }
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
  // ⛔ THE SCRATCH FILE NEVER OUTLIVES A FAILURE. It holds exactly what the target would — the
  //    account code, in the clear when that is the shape being written — and `logout` removes
  //    only `credentials.json`, so one left behind by a full disk or a failed rename would sit
  //    there unreferenced and unnoticed. The rename is the last thing that happens; anything that
  //    stops before it leaves nothing.
  let renamed = false;
  try {
    writeFileSync(scratch, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    if (modesAreEnforced()) chmodSync(scratch, 0o600);
    renameSync(scratch, target);
    renamed = true;
  } finally {
    if (!renamed) {
      try {
        rmSync(scratch, { force: true });
      } catch {
        // Nothing more can be done about it here, and throwing from a `finally` would replace the
        // real failure with this one.
      }
    }
  }
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
  // ⛔ THE PARSER'S OWN MESSAGE NEVER ESCAPES. V8 quotes about thirty characters of the input in
  //    `Unexpected token …`, and the input here is the file the account code is in — an
  //    adversarial review printed nine symbols of a real code to stderr from a single lost quote.
  //    `errors.ts` prints an unknown error's message verbatim, so the only place to stop it is
  //    here, before it becomes an error at all.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw unusable(path, "is not readable as JSON");
  }
  if (!isCredentials(parsed)) throw unusable(path, "is not a credentials file this version understands");
  return parsed;
}

/**
 * The one refusal for a file this version cannot use, in the one wording.
 *
 * ⛔ IT NAMES THE PATH AND NOTHING ELSE. Not the contents, not the parser's complaint, not which
 *    field was wrong — the file is the account code's file, and every one of those quotes it.
 *
 * ⚠ AND IT IS AN `NmtsError` WITH A WAY OUT. It used to be a bare `Error`, which meant the
 *    generic exit code and no next step: `whoami`, `ls`, `get` and `put` all died at 1 saying
 *    only that the file was not understood, and the only command that could fix it — `logout` —
 *    was the one nobody was told to run.
 */
function unusable(path: string, what: string): NmtsError {
  return new NmtsError(`${path} ${what}.`, {
    exitCode: 3,
    nextStep:
      `Nothing was read from it. \`nmts logout\` removes it, and \`nmts login\` writes a fresh ` +
      `one. If that file is the only copy of the account code, take the code out of it by hand ` +
      `first — this tool will not open it.`,
  });
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
  const plain = typeof v["accountCode"] === "string" && v["accountCode"].length > 0;
  const locked = isLockedCode(v["lockedCode"]);
  // ⛔ Exactly one. Neither means there is no code to use; both means somebody merged two files.
  if (plain === locked) return false;
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
export function resolveAccountCode(): ResolvedCode | null {
  const fromEnv = process.env[CODE_ENV_VAR];
  if (fromEnv !== undefined && fromEnv.length > 0) return { code: fromEnv, source: "env" };
  const fromSecret = readSecretFile(CODE_FILE_ENV_VAR);
  if (fromSecret !== null) return { code: fromSecret, source: "secret-file" };
  const file = readCredentialsFile();
  if (file?.accountCode !== undefined) return { code: file.accountCode, source: "file" };
  if (file?.lockedCode !== undefined) return { locked: file.lockedCode, source: "file-locked" };
  return null;
}

/**
 * Read a secret out of the file an environment variable NAMES.
 *
 * ⛔ THIS IS HOW A SECRET GETS INTO A CONTAINER. An environment variable holding the value itself
 *    is readable by anybody who can inspect the container — `docker inspect` prints the whole
 *    environment, and so does the API behind it. A variable holding a PATH gives that reader a
 *    filename and nothing else, while the value rides in on a `--secret` mount, a tmpfs, or a
 *    bind-mounted file whose permissions the host controls. It is the convention the official
 *    database images use, for the same reason.
 *
 * Trailing whitespace and a trailing newline are removed: writing a secret to a file with `echo`
 * appends one, and refusing a code because of it would be a puzzle with no clue.
 */
export function readSecretFile(variable: string): string | null {
  const path = process.env[variable];
  if (path === undefined || path.length === 0) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    // ⛔ Named, not swallowed. A variable that points at nothing is a mistake somebody made on
    //    purpose — falling through to "not signed in" would send them looking at the wrong thing.
    throw new NmtsError(`${variable} names ${path}, which could not be read.`, {
      exitCode: 3,
      nextStep: `Check the path and its permissions. Cause: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const value = raw.trim();
  if (value.length === 0) {
    throw new NmtsError(`${variable} names ${path}, which is empty.`, { exitCode: 3 });
  }
  return value;
}

/**
 * The API key this run should use, and where it came from.
 *
 * ⚠ SEPARATE FROM THE ACCOUNT CODE ON PURPOSE, and the two can come from different places. The
 *   code is what opens the files; the key is only what makes the server answer without a human
 *   check. Somebody may keep the code in the environment for one run while the key stays on the
 *   machine, or the other way round, and neither combination is unusual enough to refuse.
 */
export function resolveApiKey(): { key: string; source: CredentialSource } | null {
  const fromEnv = process.env[API_KEY_ENV_VAR];
  if (fromEnv !== undefined && fromEnv.length > 0) return { key: fromEnv, source: "env" };
  const fromSecret = readSecretFile(API_KEY_FILE_ENV_VAR);
  if (fromSecret !== null) return { key: fromSecret, source: "secret-file" };
  const file = readCredentialsFile();
  if (file?.apiKey !== undefined && file.apiKey.length > 0) return { key: file.apiKey, source: "file" };
  return null;
}

/** Scratch location used only by tests that need a directory outside the real home. */
export function testConfigDir(name: string): string {
  return join(tmpdir(), `nmts-agents-test-${name}-${process.pid}`);
}
