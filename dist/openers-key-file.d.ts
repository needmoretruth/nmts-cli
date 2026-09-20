import type { SignWallet } from "./openers.ts";
/** A wallet this run can ask for signatures: which address it is, and how to ask. */
export interface KeyFileWallet {
    address: string;
    sign: SignWallet;
}
/**
 * The wallet held in `path`, ready to sign the opener message.
 *
 * The file holds one `suiprivkey1…` line — what `sui keytool export` writes and what every Sui
 * tool reads. Surrounding whitespace and a trailing newline are ignored, because writing a secret
 * to a file with `echo` appends one and refusing it would be a puzzle with no clue.
 */
export declare function walletFromKeyFile(path: string): KeyFileWallet;
