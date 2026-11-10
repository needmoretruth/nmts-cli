import { type Session } from "../session.ts";
import { type ShareAccount } from "../sharing.ts";
export interface ShareOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    /** `--yes`: the per-attempt answer `share` needs in normal mode (see `share`). */
    yes?: boolean;
    /** `--as <n>`: which live public code sends. Absent = the lowest-numbered live one. */
    as?: string | undefined;
    write?: (line: string) => void;
}
export declare function out(options: ShareOptions): (line: string) => void;
/**
 * The session as the share doors take it. ⛔ No account proof: an API key is asked for a live
 * human check on the sending doors, and the commands send exactly what they sent before.
 */
export declare function shareAccountOf(session: Session, network?: string): ShareAccount;
/** `nmts share <path> <address>` — hand one file to one account. */
export declare function share(target: string | undefined, typedAddress: string | undefined, options?: ShareOptions): Promise<number>;
/** `nmts shares` — what was shared with this account, and what it shared. */
export declare function shares(options?: ShareOptions): Promise<number>;
export declare function unshare(id: string | undefined, options?: ShareOptions): Promise<number>;
