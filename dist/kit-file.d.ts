import { type ArtifactAbout } from "./artifact-about.ts";
/** Start of the machine block. ⛔ Fixed bytes, never translated. */
export declare const KIT_DATA_BEGIN = "--- BEGIN NMTS RECOVERY KIT DATA ---";
/** End of the machine block. */
export declare const KIT_DATA_END = "--- END NMTS RECOVERY KIT DATA ---";
/** The marker a reader matches on before anything else is attempted. */
export declare const KIT_FORMAT = "nmts-recovery-kit";
/**
 * Kit version. 2 is the one that carries the recovery list; v1 carried only the code.
 *
 * ⛔ NOT RAISED FOR ANYTHING THIS TOOL ADDS. `MAX_KIT_VERSION` in the standalone program refuses a
 *    higher number outright, so a bump breaks every published build in exchange for fields those
 *    builds are happy to ignore.
 */
export declare const KIT_VERSION = 2;
/**
 * A short, human-checkable fingerprint of the PUBLIC account id.
 *
 * ⚠ RESTATED FROM `web/src/lib/auth/account-code.ts::accountIdFingerprint`, which this package
 *   cannot import. It has to produce the same string: a person comparing a kit written here with
 *   one written in a browser is checking two spellings of the same account.
 *
 * ⛔ IT FINGERPRINTS THE ACCOUNT ID, WHICH IS PUBLIC — never the NMTS key and never a key. It
 *    lets somebody confirm two files refer to one account without either of them exposing a secret.
 */
export declare function accountIdFingerprint(accountId: string): string;
/** The machine-readable payload, read by the standalone recovery program. */
export interface RecoveryKitData {
    format: typeof KIT_FORMAT;
    version: typeof KIT_VERSION;
    generated_at: string;
    account_id: string;
    account_fingerprint: string;
    /** ⛔ The NMTS key, in the clear. This is the field that makes the file dangerous to hold. */
    account_code: string;
    /** Storage-network address of the list, when there is one. Always null from this tool. */
    recovery_manifest_blob: string | null;
    /** The whole `.nmtsmap` document, or null when there was nothing to list. */
    recovery_list: Record<string, unknown> | null;
    about: ArtifactAbout;
}
export interface BuildKitInput {
    /** Display-form NMTS key, grouped as a person reads it. */
    code: string;
    accountId: string;
    generatedAt: string;
    /** The parsed `.nmtsmap` document to embed, or null when the account has no files. */
    recoveryList: Record<string, unknown> | null;
    /** How many files that list covers. Null when there is no list. */
    listFileCount: number | null;
}
/** Build the kit's text: a part for a person, then a part for a program. */
export declare function buildRecoveryKit(input: BuildKitInput): {
    filename: string;
    content: string;
};
