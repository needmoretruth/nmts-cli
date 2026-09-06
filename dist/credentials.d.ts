import { type LockedCode } from "./code-vault.ts";
/** The environment variable an agent sets instead of running `login`. */
export declare const CODE_ENV_VAR = "NMTS_ACCOUNT_CODE";
/** The API key, same rules: read fresh, never an argument, never printed. */
export declare const API_KEY_ENV_VAR = "NMTS_API_KEY";
/**
 * Opens a passphrase-locked stored code without a terminal.
 *
 * ⚠ A passphrase in an environment variable protects the FILE, not this run: anything that can
 *   read this variable can read the code the moment the tool decodes it. What it still buys is
 *   real — a copied home directory, a backup, an image layer and a stolen disk all yield nothing
 *   — and it is the only shape that works where no person is present to type.
 */
export declare const PASSPHRASE_ENV_VAR = "NMTS_PASSPHRASE";
/**
 * Names a FILE holding the account code, rather than holding it directly.
 *
 * ⛔ THE ONLY SAFE WAY TO GIVE A CONTAINER A SECRET. See `readSecretFile`.
 */
export declare const CODE_FILE_ENV_VAR = "NMTS_ACCOUNT_CODE_FILE";
/** Names a file holding the API key. Same reason. */
export declare const API_KEY_FILE_ENV_VAR = "NMTS_API_KEY_FILE";
/** Where a credential came from. Reported, never guessed. */
export type CredentialSource = "env" | "secret-file" | "file" | "file-locked";
/**
 * An account code that has been FOUND but not necessarily opened.
 *
 * ⛔ THE TWO CASES ARE SEPARATE TYPES so that no caller can read `.code` off a locked one. A
 *    single shape with a nullable field would compile everywhere and be wrong in exactly one
 *    place — the command that forgot to unlock and treated "no code" as "not signed in".
 */
export type ResolvedCode = {
    readonly source: "env" | "secret-file" | "file";
    readonly code: string;
} | {
    readonly source: "file-locked";
    readonly locked: LockedCode;
};
/** Directory holding everything this tool keeps. 0700 where the platform honours it. */
export declare function configDir(): string;
export declare function credentialsPath(): string;
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
export declare function modesAreEnforced(): boolean;
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
export declare function codeStorageIsPrivate(): boolean;
/**
 * Write credentials, replacing any existing file, without ever leaving a readable window.
 *
 * The write goes to a fresh file created with `wx` (fails if the name exists, so nothing already
 * on disk is opened) and is then renamed over the target. A rename within the same directory is
 * atomic, so a reader either sees the old file or the new one and never a half-written one.
 */
export declare function writeCredentials(creds: Credentials): void;
/** Raised when the file exists but this machine is not keeping it private. */
export declare class CredentialsTooOpenError extends Error {
    readonly path: string;
    readonly mode: number;
    constructor(path: string, mode: number);
}
/**
 * Read credentials from disk, refusing a file other users can read.
 *
 * ⛔ The refusal is the point. A credentials file that went world-readable — copied with `cp -r`,
 *    restored from an archive, written by an older version — is a leak that nothing else in the
 *    system would ever mention. Reading it anyway and carrying on is how that stays quiet.
 */
export declare function readCredentialsFile(): Credentials | null;
/**
 * The account code this run should use, and where it came from.
 *
 * The environment variable wins over the file so an agent can be handed a code for one run without
 * writing anything to disk — which is the safer shape when the machine is shared or ephemeral.
 */
export declare function resolveAccountCode(): ResolvedCode | null;
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
export declare function readSecretFile(variable: string): string | null;
/**
 * The API key this run should use, and where it came from.
 *
 * ⚠ SEPARATE FROM THE ACCOUNT CODE ON PURPOSE, and the two can come from different places. The
 *   code is what opens the files; the key is only what makes the server answer without a human
 *   check. Somebody may keep the code in the environment for one run while the key stays on the
 *   machine, or the other way round, and neither combination is unusual enough to refuse.
 */
export declare function resolveApiKey(): {
    key: string;
    source: CredentialSource;
} | null;
/** Scratch location used only by tests that need a directory outside the real home. */
export declare function testConfigDir(name: string): string;
