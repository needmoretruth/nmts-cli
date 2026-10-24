import type { ClientWithCoreApi } from "@mysten/sui/client";
import type { Signer } from "@mysten/sui/cryptography";
import type { Transaction } from "@mysten/sui/transactions";
/** What every execution asks the node to include: the effects (status, objects) and the objects' types. */
export declare const EXECUTE_INCLUDE: {
    readonly effects: true;
    readonly objectTypes: true;
};
/** The parts of one transaction in the node's answer this tool reads. The SDK's shape fits it. */
export interface AnsweredTransaction {
    digest: string;
    status: {
        success: boolean;
        error?: {
            message: string;
        } | null;
    };
    effects?: {
        changedObjects: readonly {
            objectId: string;
            idOperation: string;
        }[];
    } | null;
    objectTypes?: Readonly<Record<string, string>> | null;
}
/** The node's answer: the transaction under the name that says how it ended. */
export interface ChainAnswer {
    Transaction?: AnsweredTransaction;
    FailedTransaction?: AnsweredTransaction;
}
export interface Executed {
    digest: string;
    /** The chain's reason when the transaction executed and FAILED; `null` when it went through. */
    refused: string | null;
    /** Every object it created, with its Move type when the node named one. */
    created: readonly {
        objectId: string;
        type: string | null;
    }[];
}
/** Read one answer. Throws when it carries no transaction at all — that is not an answer to judge. */
export declare function readAnswer(answer: ChainAnswer): Executed;
/**
 * Sign `transaction` with `signer`, execute it once, and read the answer.
 *
 * ⛔ THE WAIT AFTER A SUCCESS is for what happens NEXT — the server told the digest, `nmts wallet`
 *    run, the browser's activity list opened — because a node that has not indexed the transaction
 *    yet answers those as if nothing happened. A wait that times out changes nothing about what was
 *    signed, so it is not an error of the transaction.
 *
 * ⚠ A THROW HERE IS NOT PROOF THAT NOTHING HAPPENED: a timeout or a dropped connection after the
 *   bytes went out says nothing about whether the transaction executed.
 */
export declare function signAndRun(client: ClientWithCoreApi, transaction: Transaction, signer: Signer): Promise<Executed>;
