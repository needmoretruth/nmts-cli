import type { SignExtension } from "./extend-plan.ts";
import { type KeepTryingOptions } from "./net-retry.ts";
import type { SignBlobCertify, SignBlobRegister, SignStorageOp } from "./wallet-sign-seams.ts";
/** What a wallet answers once it has signed: the bytes it signed, and the signature over them. */
export interface SignedTransaction {
    /** Base64 — what a browser wallet answers — or the raw bytes. */
    bytes: Uint8Array | string;
    signature: string;
}
/**
 * The wallet that pays, from outside this tool.
 *
 * ⚠ THE SHAPE IS THE WALLET STANDARD'S, so a page hands over what `useSignTransaction()` gives it
 *   and a server hands over whatever signs for the person whose storage this is.
 */
export interface ExternalPayer {
    /**
     * The address that pays: the sender of every transaction below, and the address whose balances
     * the price was measured against.
     */
    address: string;
    /** Asked once per transaction. `chain` is `sui:mainnet` or `sui:testnet`. */
    signTransaction(input: {
        bytes: Uint8Array;
        chain: string;
    }): Promise<SignedTransaction>;
}
/** What the chain says about one submitted transaction. */
export interface SubmittedTransaction {
    digest: string;
    effects?: unknown;
    objectChanges?: unknown;
}
/**
 * Just the three calls a submitted transaction needs.
 *
 * ⚠ NARROW ON PURPOSE: a test hands in a client that answers from a table, and every real client
 *   fits it. Asking the node the plain question is also why the wallet is only ever asked to SIGN —
 *   a wallet's own "sign and execute" would answer a digest and leave the judging to nobody.
 */
export interface SubmitClient {
    executeTransactionBlock(input: {
        transactionBlock: Uint8Array;
        signature: string | string[];
        options: {
            showEffects: true;
            showObjectChanges: true;
        };
    }): Promise<SubmittedTransaction>;
    getTransactionBlock(input: {
        digest: string;
        options: {
            showEffects: true;
            showObjectChanges: true;
        };
    }): Promise<SubmittedTransaction>;
    waitForTransaction(input: {
        digest: string;
    }): Promise<unknown>;
}
/** What a caller is told when one of these transactions does not go through. */
export interface ExternalRefusals {
    /** What is true when the WALLET said no. Nothing was signed, by definition. */
    unsigned: string;
    /** What the chain refused, named as a sentence, and what is true once it has. */
    refused: {
        what: string;
        nextStep: string;
    };
}
/**
 * One transaction, from bytes to a judged result: ask the wallet, submit it once, read the effects.
 *
 * ⛔ THE ONLY THING THAT CAN THROW BEFORE A SIGNATURE EXISTS IS THE WALLET SAYING NO, and it is
 *    named `WALLET_REFUSED` rather than passed on as whatever the wallet threw: a person who
 *    declined is not a broken wallet, and a caller that cannot tell them apart shows the wrong
 *    sentence to somebody who did exactly what they meant to.
 */
export declare function signAndSubmit(client: SubmitClient, payer: ExternalPayer, input: {
    network: string;
    bytes: Uint8Array;
    refusals: ExternalRefusals;
    /**
     * How long a dropped line is waited out, and how the waiting is done.
     *
     * ⚠ A SEAM, NOT AN OPTION, and `retryable` is not part of it: what may be repeated is decided
     *   here. `sleep`, `now` and `random` are injected so a test runs a flapping link in
     *   milliseconds rather than in minutes, and `onWait` is how a caller says it is waiting.
     */
    retry?: Omit<KeepTryingOptions, "retryable"> | undefined;
}): Promise<SubmittedTransaction>;
/**
 * The two halves of a wallet-paid upload, signed by a wallet outside this tool: registering one
 * part's blob (which buys the storage or binds a held resource, and pays the relay's tip) and
 * certifying it (gas only).
 *
 * ⛔ THE BUILDERS ARE `upload-wallet-chain.ts`'s OWN — the same ones the measured fee came from and
 *    the same ones the keypair signers use. What is registered, bought and tipped is therefore the
 *    same transaction whichever wallet signs it.
 */
export declare function externalBlobSigners(payer: ExternalPayer): {
    register: SignBlobRegister;
    certify: SignBlobCertify;
};
/**
 * Extending every blob under one file by `epochs`, in ONE transaction signed by a wallet outside
 * this tool. The ids are de-duplicated: naming a blob twice pays for the same epochs twice.
 *
 * ⚠ The transaction is the shape `extend-chain.ts` measured the fee of — sender, de-duplicated ids,
 *   one fragment per blob — so what is approved is what was priced.
 */
export declare function externalExtendSigner(payer: ExternalPayer): SignExtension;
/**
 * Cutting, joining or handing over a storage resource, signed by a wallet outside this tool.
 *
 * ⛔ THE RESOURCE MUST BE THAT WALLET'S. The review reads the resources at the address it was given
 *    and this signs as the same address, so a resource held somewhere else is refused by the chain
 *    rather than half-done here.
 */
export declare function externalStorageOpSigner(payer: ExternalPayer): SignStorageOp;
