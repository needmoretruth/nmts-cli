// The only wallet a terminal has: one `suiprivkey1…` line in a file this run is pointed at.
//
// ⛔ THE VALUE IS NEVER AN ARGUMENT AND NEVER PRINTED. A secret on a command line is readable by
//    any process on the machine and is recorded by the shell, which is why every option table in
//    this tool names paths and not values (`args.ts`). What this file takes is a PATH; what it
//    hands back is a function that signs one message, and an address.
//
// ⛔ AND THE KEY DOES NOT COME BACK OUT. `wallet-sign.ts` keeps that rule for the wallets this
//    account's own NMTS key derives; this is the other kind — somebody else's wallet, held for one
//    run — and the rule is the same: the keypair is built inside a closure, asked for signatures
//    over one message, and never returned, logged or copied.
//
// ⛔ IT CATCHES ITS OWN PARSER. `errors.ts` says why: an unknown error's message goes to stderr
//    verbatim, and a decoder that fails on a secret-bearing file has been measured quoting the
//    input back. Every failure below is this tool's own sentence, naming the path and never the
//    contents.
//
// ⚠ NODE ONLY, WHICH IS WHY IT IS NOT IN `openers/`. That folder is bundled into a page by the
//   SDK's browser entry; a page's wallet is an extension, and this one is a file on a disk.

import { readFileSync } from "node:fs";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Secp256r1Keypair } from "@mysten/sui/keypairs/secp256r1";
import { decodeSuiPrivateKey, type Signer } from "@mysten/sui/cryptography";

import { NmtsError } from "./errors.ts";
import type { SignWallet } from "./openers.ts";

/** A wallet this run can ask for signatures: which address it is, and how to ask. */
export interface KeyFileWallet {
  address: string;
  sign: SignWallet;
}

/**
 * The wallet held in `path`, ready to sign the opener message.
 *
 * The file holds one `suiprivkey1…` line — what `sui keytool export` writes and what every Sui
 * tool reads. Surrounding whitespace and a trailing newline are ignored, because writing a secret
 * to a file with `echo` appends one and refusing it would be a puzzle with no clue.
 */
export function walletFromKeyFile(path: string): KeyFileWallet {
  const keypair = keypairFrom(readOneLine(path), path);
  return {
    address: keypair.toSuiAddress(),
    // ⛔ THE CLOSURE HOLDS THE KEYPAIR AND NOTHING HOLDS THE CLOSURE PAST THE RUN. What it answers
    //    is the wallet standard's own pair — the serialized signature, and the bytes it signed, so
    //    that the layer above compares them against the message it built rather than trusting it.
    sign: async (message: Uint8Array) => keypair.signPersonalMessage(message),
  };
}

/** The first line with anything on it, or this tool's own refusal. */
function readOneLine(path: string): string {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    // ⛔ THE CAUSE IS NOT CARRIED. Node's own message for a read failure quotes the path, which is
    //    fine, but a decoding failure inside it would quote the contents, which is not.
    throw new NmtsError(`Could not read ${path}.`, {
      exitCode: 2,
      // Copy facts — the next step. Facts: the file holds one line beginning `suiprivkey1`, it is
      // read and never copied or written to, and nothing was signed.
      nextStep: "Nothing was signed. Point --sui-key-file at a file holding one `suiprivkey1…` line.",
    });
  }
  const line = raw.split("\n").map((l) => l.trim()).find((l) => l !== "");
  if (line === undefined || !line.startsWith("suiprivkey1")) {
    throw new NmtsError(`${path} does not hold a Sui private key.`, {
      exitCode: 2,
      nextStep: "Nothing was signed. The file holds one line beginning `suiprivkey1`.",
    });
  }
  return line;
}

/** The keypair that line names, for the three schemes an opener may use. */
function keypairFrom(line: string, path: string): Signer {
  let decoded: { scheme: string; secretKey: Uint8Array };
  try {
    decoded = decodeSuiPrivateKey(line);
  } catch {
    throw new NmtsError(`${path} does not hold a Sui private key this version can read.`, {
      exitCode: 2,
      nextStep: "Nothing was signed. The line is the one `sui keytool export` writes.",
    });
  }
  const { scheme, secretKey } = decoded;
  try {
    if (scheme === "ED25519") return Ed25519Keypair.fromSecretKey(secretKey);
    if (scheme === "Secp256k1") return Secp256k1Keypair.fromSecretKey(secretKey);
    if (scheme === "Secp256r1") return Secp256r1Keypair.fromSecretKey(secretKey);
  } finally {
    // The keypair copied what it needed; this buffer is the only other one.
    secretKey.fill(0);
  }
  // ⚠ An allow list, exactly as the layer above keeps: a scheme nobody has judged is refused for
  //   being unknown rather than let through for being new.
  throw new NmtsError(`WALLET_UNKNOWN_SCHEME: ${path} holds a ${scheme} key.`, {
    exitCode: 4,
    nextStep: "Nothing was signed. An opener is held by an Ed25519, secp256k1 or secp256r1 wallet.",
  });
}
