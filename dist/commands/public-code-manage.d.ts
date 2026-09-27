import { type CryptoGlue } from "../crypto.ts";
import { type PublicCodeRow } from "../public-codes.ts";
export interface PublicCodeManageOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    /** The person's yes to a revoke, or the one the tier gate already took. */
    yes?: boolean;
    /** `list`: each code's shares as well as its counts. */
    activity?: boolean;
    /** `new`: the number of the live code the new one replaces. */
    replace?: string | undefined;
    write?: (line: string) => void;
    /** Injected in tests: answers the revoke question. */
    readLine?: ((question: string) => Promise<string>) | undefined;
}
/** The code this key derives at `row`'s number, as a person reads it — or `differentCode` when the server's differs. */
export declare function checkedDisplay(crypt: CryptoGlue, code: string, row: PublicCodeRow): string;
/** `nmts public-code list [--activity]` — every code, live ones first, and the two ceilings. */
export declare function listCodes(options?: PublicCodeManageOptions): Promise<number>;
/** `nmts public-code new [--replace <n>]` — the next number, published; with --replace, that code revoked in the same request. */
export declare function newCode(options?: PublicCodeManageOptions): Promise<number>;
/** `nmts public-code revoke <n>` — one way, and never the last live code. */
export declare function revokeCodeCommand(operand: string | undefined, options?: PublicCodeManageOptions): Promise<number>;
