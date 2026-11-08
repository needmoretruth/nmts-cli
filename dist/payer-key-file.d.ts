import type { ExternalPayer } from "./wallet-sign-external.ts";
/**
 * `--sui-key-file` for one put, judged before the account is opened: a file that cannot pay is a
 * command line to fix (`openers-key-file.ts` says which).
 *
 * ⛔ ONE PAYER PER RUN (the SDK's TWO_PAYERS rule, `put-wallet.ts` there): `--wallet` names one of
 *    this key's wallets and the key file names another.
 */
export declare function keyFilePayer(path: string, wallet: string | undefined): ExternalPayer;
/** ⛔ REFUSED, NOT IGNORED: ignored, a push would pay from this key's own wallet instead. */
export declare function refuseKeyFileForPush(): never;
/** The wallet in `path` as the payer of an upload. */
export declare function payerFromKeyFile(path: string): ExternalPayer;
