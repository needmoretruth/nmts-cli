// Attaching a wallet to an account THIS RUN JUST CREATED — the one case where the account has no
// credential on this machine yet.
//
// ⛔ WHY THIS FILE EXISTS AT ALL. The three opener doors take a credential AND the NMTS key's own
//    proof: the proof says whoever is asking holds the key, and the credential says which account
//    the server is talking to. A brand-new account has the first and not the second — `nmts create`
//    deliberately stores nothing and switches nothing over (`create.ts`) — so there is nothing to
//    speak with. `POST /v1/account/api-keys/by-code` is the door built for exactly that shape: a
//    program set up from one secret rather than from a browser session plus that secret.
//
// ⛔ SO THE KEY IS MINTED, USED ONCE, AND CUT. It lasts a day, carries `write` and nothing else,
//    and is revoked as soon as the slot is stored — through `revoke-by-code`, which needs the same
//    one secret. What is left behind is an account with the wallet attached and no credential,
//    which is what `nmts create` leaves behind today.
//
// ⛔ AND A REVOKE THAT FAILED IS REPORTED, NEVER SWALLOWED. A live key on somebody's new account
//    that they were not told about is worse than one they were: the caller is handed the key's id
//    so it can say so, and the attach itself still counts as done, because it is.
//
// The sentences the caller prints around this: The facts are in `create.ts` and in
//   the comment above each return.

import { request } from "../api.ts";
import {
  addWallet,
  refuseIfWalletOpensAnAccount,
  type AttachedWallet,
  type WalletOpener,
} from "../openers.ts";
import { BINARY_NAME } from "../product.ts";
import { registrationProofOf } from "../registration.ts";
import { OPENER_HINTS } from "./openers.ts";

/** What attaching to a fresh account takes. */
export interface AttachInput {
  server: string;
  /** The account's NMTS key — made in this run and held by nobody else. */
  code: string;
  wallet: WalletOpener;
}

/** What it did, and the one thing that can be left behind by a failure. */
export interface AttachOutcome extends AttachedWallet {
  /**
   * The id of the borrowed key this run could NOT revoke, or null when nothing was left.
   *
   * ⚠ NOT A FAILURE OF THE ATTACH. The wallet does open the account; what did not happen is the
   *   tidying, and a person can cut the key from a browser or with `nmts key revoke`.
   */
  keyLeft: string | null;
}

/** Permission to write this account's own openers, and nothing else. `api/src/domain/api_key.rs`. */
const WRITE_ONLY = 2;

/** How long the borrowed key may live. It is cut seconds later; this is what covers a failure. */
const ONE_DAY = 1;

/** Attach `wallet` to the account `code` opens, borrowing a credential for the length of one PUT. */
export async function attachWalletToNewAccount(input: AttachInput): Promise<AttachOutcome> {
  const { accountId, authSecret } = await registrationProofOf(input.code);
  const proven = { account_id: accountId, auth_secret: authSecret };
  const issued = await request(input.server, "/v1/account/api-keys/by-code", {
    method: "POST",
    body: { ...proven, scopes: WRITE_ONLY, lifetime_days: ONE_DAY },
    // ⛔ NOT REPEATED ON A TIMEOUT. A request that reached the server and died on the way back has
    //    already spent one of the two live keys this account may hold, and a retry would spend the
    //    other — leaving a new account at its cap over a key nobody received.
    retryBudgetMs: 0,
  });
  const apiKey = field(issued, "key");
  const keyId = field(issued, "key_id");
  if (apiKey === null || keyId === null) {
    throw new Error("OPENER_ATTACH_NO_KEY: the server's answer held no usable key.");
  }
  const attached = await addWallet(
    { server: input.server, apiKey, accountProof: authSecret },
    input.code,
    input.wallet,
    OPENER_HINTS,
  );
  return { ...attached, keyLeft: (await revoked(input.server, proven, keyId)) ? null : keyId };
}

/**
 * Ask, before an account is made, whether this wallet already opens one.
 *
 * ⛔ THE ONE STEP THAT HAS TO HAPPEN EARLY. Everywhere else a taken locator is a refusal and
 *    nothing else; on `nmts create --wallet` it would be an account that exists, holds a key the
 *    person has been handed, and cannot have the wallet they asked for. One signature spent here
 *    is cheaper than an account nobody wanted.
 */
export async function refuseIfWalletIsTaken(server: string, wallet: WalletOpener): Promise<void> {
  await refuseIfWalletOpensAnAccount(server, wallet, OPENER_HINTS);
}

/**
 * What a wallet attached to a new account means, said after the code has been handed over.
 *
 * ⚠ Copy facts — both sentences. Facts for the first: this wallet now opens this account from any
 *   machine, so whoever holds it can read every file in it, and `nmts openers remove <locator>`
 *   takes it off. For the second: a write-scoped key borrowed for this one step is still live on
 *   the brand-new account, and its id is how to cut it.
 */
export function sayWalletAttached(say: (line: string) => void, attached: AttachOutcome): void {
  say(``);
  say(`This wallet also opens the new account:  ${attached.locator}`);
  if (attached.keyLeft !== null) {
    say(`⚠ The key borrowed to store it — ${attached.keyLeft} — is still live. Cut it with \`${BINARY_NAME} key revoke ${attached.keyLeft}\`.`);
  }
}

/** Cut the borrowed key. Its failure is an answer, not a throw: the wallet is attached either way. */
async function revoked(server: string, proven: object, keyId: string): Promise<boolean> {
  try {
    await request(server, "/v1/account/api-keys/revoke-by-code", {
      method: "POST",
      body: { ...proven, key_id: keyId },
      retryBudgetMs: 0,
    });
    return true;
  } catch {
    // ⚠ The cause is not carried up. What the caller can act on is that a key is still live and
    //   which one; why the revoke failed is already in the run log.
    return false;
  }
}

/** One string field of the server's answer, or null. ⛔ Nothing here prints what it read. */
function field(answer: unknown, name: string): string | null {
  const value: unknown = typeof answer === "object" && answer !== null ? Reflect.get(answer, name) : undefined;
  return typeof value === "string" && value.length > 0 ? value : null;
}
