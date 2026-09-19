/** The fixed prefix of a business signature. `1` is the format version, so a later shape is `bs2_`. */
export declare const BUSINESS_PREFIX = "nmts_bs1_";
/** …and of a delegation token. */
export declare const DELEGATION_PREFIX = "nmts_dt1_";
/** What a business signature covers, before the moment, the nonce, the method, the path and the digest. */
export declare const BUSINESS_CONTEXT = "nmts/p1/business/v1";
/** What a business signs over a delegation payload. */
export declare const DELEGATION_CONTEXT = "nmts/p1/delegation/v1";
/** What the NEW key signs over the old one when a business replaces its key. */
export declare const ROTATE_CONTEXT = "nmts/p1/rotate/v1";
/** Ed25519 key and signature lengths, named because a parser and a refusal both state them. */
export declare const PUBKEY_LEN = 32;
export declare const PRIVATE_KEY_LEN = 32;
export declare const SIGNATURE_LEN = 64;
/**
 * The random half of a delegation payload, and of a business signature: 16 bytes each, so two
 * credentials made in the same second for the same thing are still different strings.
 */
export declare const NONCE_LEN = 16;
/** The longest life a delegation token may be minted with — thirty days. */
export declare const DELEGATION_MAX_TTL_SECS = 2592000;
/**
 * What a delegation token may open, by name.
 *
 * ⛔ THE FIRST THREE ARE AN API KEY'S OWN SCOPES, value for value. One vocabulary, so that a
 *    business asking for "read and write" asks for the number a person's key already means by it.
 *    `register` is the fourth and opens exactly one door: making the account the token names.
 */
export declare const SCOPE_BITS: {
    readonly files_read: 1;
    readonly files_write: 2;
    readonly storage_spend: 4;
    readonly register: 8;
};
/** One of the four names above. */
export type ScopeName = keyof typeof SCOPE_BITS;
/** Every bit a token may carry. */
export declare const SCOPE_ALL: number;
/** A business's key pair, both halves base64url. The private half never travels. */
export interface BusinessKeyPair {
    /** 32 bytes, base64url. This is what is registered, and it is not a secret. */
    publicKey: string;
    /** 32 bytes, base64url. ⛔ The only copy: nothing can derive it back from the public half. */
    privateKey: string;
}
/**
 * A new key pair, from the runtime's own random source.
 *
 * ⚠ The randomness is the curve library's, which is the platform's `crypto.getRandomValues`. There
 *   is no second source here: a key drawn from anything weaker is a business somebody else can
 *   speak for.
 */
export declare function generateBusinessKeys(): BusinessKeyPair;
/** The public half of a private key, so a caller never has to keep the two in step by hand. */
export declare function businessPublicKey(privateKey: string): string;
/**
 * The bytes a business signature covers.
 *
 * `path` is the request path as it is sent, with no query string: no Platform door takes one, and
 * a signature that did not cover a parameter the server then read would be a signature over half
 * the request.
 *
 * ⚠ THE NONCE IS SIGNED AS THE TEXT THAT TRAVELS, base64url, on its own line after the moment —
 *   so the sender and the receiver agree about the field without either re-encoding it.
 */
export declare function businessSigningInput(ts: number, nonce: string, method: string, path: string, body: Uint8Array): Uint8Array;
/** The bytes a delegation signature covers: the context, then the payload exactly as it travels. */
export declare function delegationSigningInput(payload: Uint8Array): Uint8Array;
/** The bytes the new key signs during a rotation: the context, then the key being replaced. */
export declare function rotationSigningInput(oldPublicKey: string): Uint8Array;
/** What one signed request is about. */
export interface BusinessRequest {
    /** The business account's public id, base64url — what the server knows it by. */
    accountId: string;
    privateKey: string;
    method: string;
    /** The path as it will be sent, `/p1/business`. */
    path: string;
    /** The request body exactly as it will be sent. Empty for a GET. */
    body?: Uint8Array | undefined;
    /** Unix seconds. Absent = now. The server accepts a window either side of its own clock. */
    at?: number | undefined;
    /**
     * The 16 random bytes this one request carries, base64url.
     *
     * ⚠ FOR A TEST THAT NEEDS THE SAME CREDENTIAL TWICE, and for nothing else. Left out, it is drawn
     *   from the runtime's random source, which is what makes two identical requests two requests.
     */
    nonce?: string | undefined;
}
/**
 * The whole `Authorization: Bearer` value for one request to a Platform door.
 *
 * ⛔ ONE SIGNATURE, ONE REQUEST. The server remembers each accepted signature for the length of its
 *    clock window and refuses a second presentation of the same one, so a value from here is not a
 *    credential to keep — it is made for the request it is about and spent on it.
 *
 * ⛔ AND THAT IS WHY THE NONCE IS HERE. Ed25519 is deterministic and the moment is whole seconds,
 *    so two identical requests inside one second would otherwise be the same bytes — and the
 *    second of them would be refused as a replay of the first.
 */
export declare function signBusinessRequest(request: BusinessRequest): string;
/** What one delegation token says. */
export interface DelegationRequest {
    /** The business's own account id, base64url. */
    business: string;
    /** The account id of the user this token speaks for, base64url. */
    user: string;
    privateKey: string;
    /** What the token may do. At least one; an empty set opens nothing. */
    scope: readonly ScopeName[];
    /** How long it lasts, in seconds. At most [`DELEGATION_MAX_TTL_SECS`]. */
    ttlSecs: number;
    /** Unix seconds this life is counted from. Absent = now. */
    at?: number | undefined;
    /**
     * The 16 random bytes in the payload, base64url.
     *
     * ⚠ FOR A TEST THAT NEEDS THE SAME TOKEN TWICE, and for nothing else. Left out, it is drawn from
     *   the runtime's random source, which is what makes two tokens with identical fields differ.
     */
    nonce?: string | undefined;
}
/**
 * Mint one delegation token.
 *
 * ⛔ THE LIFE IS REFUSED HERE AS WELL AS THERE. A token longer than the ceiling is refused by the
 *    server as malformed, which reaches the business as an authentication failure on somebody
 *    else's request; refusing it where it is made names the mistake to the program that made it.
 */
export declare function mintDelegation(request: DelegationRequest): string;
/**
 * The proof the new key makes of itself when a business replaces its key.
 *
 * ⛔ THE OLD KEY IS IN THE MESSAGE, so this proof is about THIS replacement and cannot be lifted
 *    onto another. The request carrying it is signed by the old key, so a rotation needs both
 *    halves in one hand.
 */
export declare function rotationProof(oldPublicKey: string, newPrivateKey: string): string;
/** The bitmask these scope names make. */
export declare function scopeMask(scopes: readonly ScopeName[]): number;
/** Does this signature hold over these bytes? Here so a caller can check its own work offline. */
export declare function signatureHolds(publicKey: string, message: Uint8Array, signature: string): boolean;
