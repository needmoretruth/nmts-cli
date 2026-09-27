import { type CryptoGlue } from "./crypto.ts";
import { type ShareKeys } from "./share.ts";
import { type HandoverNetwork, type HandoverPart } from "./shared/lib/share/handover-format.ts";
export declare function isHandoverNetwork(value: string): value is HandoverNetwork;
/** Refuse a name the handover file cannot carry, before any work is done. */
export declare function checkHandoverName(name: string, size: number, network: HandoverNetwork): void;
/** Build a handover file's text. The caller holds the file key and the digest, and wipes them. */
export declare function makeHandoverText(crypt: CryptoGlue, input: {
    keys: ShareKeys;
    recipientIdentity: Uint8Array;
    recipientAddress: Uint8Array;
    dek: Uint8Array;
    itemId: string;
    name: string;
    size: number;
    digest: Uint8Array;
    parts: readonly HandoverPart[];
    network: HandoverNetwork;
}): string;
/** What an opened handover file says. `dek` and `digest` are the caller's to wipe. */
export interface OpenedHandover {
    name: string;
    size: number;
    /** The sender's public code, readable form — set only because the envelope opened. */
    sender: string;
    parts: HandoverPart[];
    /** Earliest end epoch recorded when the file was made (exclusive); 0 when unknown. A hint. */
    expiryEpoch: number;
    dek: Uint8Array;
    digest: Uint8Array;
}
/** Open a handover file's text with this account's keys. */
export declare function openHandoverText(crypt: CryptoGlue, keys: ShareKeys, text: string, network: HandoverNetwork): OpenedHandover;
/** This account's public code file. */
export declare function publicCodeFileText(keys: ShareKeys): string;
/**
 * Read a recipient's public code file. Returns only when the identity inside really fingerprints to
 * the code the file names, so what is sealed to is what the person was told.
 */
export declare function readPublicCodeFileText(crypt: CryptoGlue, text: string): {
    identity: Uint8Array;
    address: Uint8Array;
    display: string;
};
