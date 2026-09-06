import { type Network } from "../network.ts";
import { type ChainReader } from "../wallet.ts";
export interface WalletOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
    /** `wallet address --qr`: the address as a code a phone can scan, drawn in the terminal. */
    qr?: boolean;
    /** `wallet send`: the operands after "send", and its flags (`wallet-send.ts`). */
    rest?: readonly string[];
    yes?: boolean;
    dryRun?: boolean;
    feeCap?: string | undefined;
    /** `wallet swap`: the coin to receive, the venue, the slippage, and the person's say past the gate. */
    to?: string | undefined;
    venue?: string | undefined;
    slippageBps?: string | undefined;
    acceptExtremes?: boolean;
    /** `wallet storage split`: what the resource keeps, by size or by epochs (`wallet-storage-ops.ts`). */
    size?: string | undefined;
    epochs?: string | undefined;
    /**
     * Where the balances come from.
     *
     * ⚠ A SEAM, NOT AN OPTION: no flag reaches it and nothing on a command line can supply one. It
     *   is here because the alternative is a test that talks to a live chain — which cannot run
     *   offline, answers differently every day, and can never be asked to fail on purpose, which is
     *   most of what this command has to get right.
     */
    openChain?: (network: Network, address: string) => Promise<ChainReader> | ChainReader;
}
export declare function wallet(what: string | undefined, options?: WalletOptions): Promise<number>;
