import type { PrivateKeyAccount } from "viem/accounts";
/** An EVM wallet number as a person typed it. Refused, never rounded. */
export declare function evmIndexOf(raw: string | undefined): number;
/** The EIP-55 address of a 32-byte secp256k1 private key. */
export declare function evmAddressOf(privateKey: Uint8Array): `0x${string}`;
/**
 * EVM wallet `index`'s private key, from an NMTS key.
 *
 * ⛔ THE CALLER WIPES WHAT COMES BACK — it moves money on Filecoin.
 */
export declare function evmKeyOf(code: string, index: number): Promise<Uint8Array>;
/** EVM wallet `index`'s address, from an NMTS key. Nothing is signed; the key is wiped here. */
export declare function evmAddressFor(code: string, index: number): Promise<`0x${string}`>;
/**
 * EVM wallet `index` as a viem account that signs. The key bytes are wiped once the account holds
 * them; the account itself keeps the key for as long as the caller keeps the account.
 */
export declare function evmAccountFor(code: string, index: number): Promise<PrivateKeyAccount>;
/** `0x…` for viem, from key bytes. ⚠ The string cannot be wiped; keep it only as long as the call. */
export declare function hexKey(key: Uint8Array): `0x${string}`;
