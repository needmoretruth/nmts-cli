import { type Network } from "../network.ts";
import { type ChainReader } from "../wallet.ts";
export interface WalletListOptions {
    server?: string | undefined;
    network?: string | undefined;
    json?: boolean;
    write?: (line: string) => void;
    /** ⚠ SEAMS, NOT OPTIONS — no flag reaches either. A live chain cannot be asked to fail on demand. */
    openChain?: (network: Network, address: string) => Promise<ChainReader> | ChainReader;
    /** Has this address any transaction at all? A wallet that has been emptied is still in use. */
    hasHistory?: (network: Network, address: string) => Promise<boolean>;
    /** The account's own numbers, out of the sealed list. */
    readWalletSettings?: () => Promise<{
        active: number;
        count: number;
    }>;
}
export declare function walletList(options?: WalletListOptions): Promise<number>;
