// A wallet that pays for one upload from a key file (`put --pay wallet --sui-key-file <file>` · L338).
//
// ⛔ THE SAME ROAD AS EVERY OUTSIDE WALLET. The key file becomes an `ExternalPayer`, and the upload is
//    priced, signed and judged by `wallet-sign-external.ts` exactly as an extension's or the SDK's
//    `pay: { signer }` is: the payer's address goes in before anything is priced, so the review, both
//    balances and the measured fee name the wallet that will sign. Nothing here builds a transaction.
//
// ⛔ THE KEY IS READ THROUGH THE ONE READER (`openers-key-file.ts`), which refuses a file other users
//    can read and never quotes its contents.
import { fromBase64 } from "@mysten/sui/utils";

import { NmtsError } from "./errors.ts";
import { signerFromKeyFile } from "./openers-key-file.ts";
import { BINARY_NAME } from "./product.ts";
import type { ExternalPayer } from "./wallet-sign-external.ts";

/**
 * `--sui-key-file` for one put, judged before the account is opened: a file that cannot pay is a
 * command line to fix (`openers-key-file.ts` says which).
 *
 * ⛔ ONE PAYER PER RUN (the SDK's TWO_PAYERS rule, `put-wallet.ts` there): `--wallet` names one of
 *    this key's wallets and the key file names another.
 */
export function keyFilePayer(path: string, wallet: string | undefined): ExternalPayer {
  if (wallet !== undefined) {
    throw new NmtsError("--wallet names one of this key's wallets, and --sui-key-file names another.", {
      exitCode: 2,
      nextStep: "Nothing was sent and nothing was signed. Keep one of the two: one run, one payer.",
    });
  }
  return payerFromKeyFile(path);
}

/** ⛔ REFUSED, NOT IGNORED: ignored, a push would pay from this key's own wallet instead. */
export function refuseKeyFileForPush(): never {
  throw new NmtsError("--sui-key-file pays for one put, not for a push.", {
    exitCode: 2,
    nextStep: `Nothing was sent. Put each file with \`${BINARY_NAME} put <file> --pay wallet --sui-key-file <file>\`.`,
  });
}

/** The wallet in `path` as the payer of an upload. */
export function payerFromKeyFile(path: string): ExternalPayer {
  const signer = signerFromKeyFile(path);
  return {
    address: signer.toSuiAddress(),
    signTransaction: async ({ bytes }) => {
      const signed = await signer.signTransaction(bytes);
      return { bytes: fromBase64(signed.bytes), signature: signed.signature };
    },
  };
}
