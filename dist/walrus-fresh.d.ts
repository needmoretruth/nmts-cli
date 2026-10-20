/** The SDK's own cache door — the one method of the Walrus namespace this file needs. */
export interface ResettableWalrus {
    reset(): void;
}
/** The client's Walrus namespace with its caches cleared, so what follows reads the chain. */
export declare function freshWalrus<W extends ResettableWalrus>(client: {
    walrus: W;
}): W;
