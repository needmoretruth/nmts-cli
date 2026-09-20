import type { ParsedArgs } from "../args.ts";
import { type OpenerHints, type WalletOpener } from "../openers.ts";
import { type KeyFileWallet } from "../openers-key-file.ts";
export interface OpenersCommandOptions {
    write?: ((line: string) => void) | undefined;
    /** Injected in tests: a wallet that is not read from a file on a disk. */
    wallet?: KeyFileWallet | undefined;
}
/**
 * The sentences a TERMINAL puts in the library's refusals. A library names no commands, so these
 * are the caller's half of each judgement (`openers/hints.ts`).
 */
export declare const OPENER_HINTS: OpenerHints;
/** `nmts openers [add|remove <locator>]`. */
export declare function openers(verb: string | undefined, args: ParsedArgs, options?: OpenersCommandOptions): Promise<number>;
/**
 * The wallet this command line names, and which account of it to open.
 *
 * ⚠ THE ADDRESS IS THE KEY FILE'S OWN. It is not an option: an address typed beside a key file is
 *   two answers to one question, and the message a person signs carries whichever of them is
 *   right only by luck.
 */
export declare function walletOpenerFrom(args: ParsedArgs, options?: OpenersCommandOptions): WalletOpener;
