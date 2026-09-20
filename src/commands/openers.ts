// `nmts openers` — the wallets that open this account: what they are, adding one, taking one off.
//
// ⛔ THE LIST IS AN INVENTORY OF WAYS INTO THE ACCOUNT, which is why all three verbs present the
//    NMTS key's own proof beside the API key. Adding one makes a standing road in that outlives
//    whatever made it; removing one takes a road away; and seeing the list is seeing every road
//    somebody's files can be reached by. All three are acts of whoever holds the key.
//
// ⛔ WHAT IS DECIDED HERE IS ONLY WHAT A TERMINAL DECIDES: which file the wallet is read from, what
//    is printed, and the exit code. The acts themselves are `openers.ts`, which the SDK calls with
//    none of those — so "which bytes are signed and when the key bytes are wiped" is written once.
//
// ⛔ THE WALLET'S SECRET IS NEVER AN ARGUMENT. `--sui-key-file` names a FILE; the key is read from
//    it, used to sign one message, and never printed — see `openers-key-file.ts`.
//
// ⚠ Copy facts — every sentence below that a person reads. The facts each one has to carry are in
//   the comment above it, and the machine codes in the refusals are not copy — they are the
//   contract a program branches on.

import { accountProofFor } from "../account-proof.ts";
import type { ParsedArgs } from "../args.ts";
import { requireAccountCode } from "../code-access.ts";
import { readCredentialsFile } from "../credentials.ts";
import { NmtsError } from "../errors.ts";
import { addWallet, listOpeners, removeWallet, type OpenerAccess, type OpenerHints, type WalletOpener } from "../openers.ts";
import { walletFromKeyFile, type KeyFileWallet } from "../openers-key-file.ts";
import { BINARY_NAME } from "../product.ts";
import { resolveServer } from "../server.ts";
import { requireApiKey } from "../session.ts";

export interface OpenersCommandOptions {
  write?: ((line: string) => void) | undefined;
  /** Injected in tests: a wallet that is not read from a file on a disk. */
  wallet?: KeyFileWallet | undefined;
}

/**
 * The sentences a TERMINAL puts in the library's refusals. A library names no commands, so these
 * are the caller's half of each judgement (`openers/hints.ts`).
 */
export const OPENER_HINTS: OpenerHints = {
  // Copy facts — Facts: the wallet signed, and this server has no slot under the name that
  // signature makes; the account number is inside the signed bytes, so another number means
  // another signature; `--account n` is how to ask for one.
  noOpener: `Nothing was opened. \`${BINARY_NAME} login --wallet --sui-key-file <file> --account 2\` asks a different number.`,
  // Copy facts — Facts: the wallet was asked for the same signature twice and answered differently,
  // so it could not open what it was about to seal; nothing was stored.
  notRepeatable: `Nothing was stored. This wallet cannot be used for wallet login; \`${BINARY_NAME} login\` takes the NMTS key itself.`,
  // Copy facts — Facts: multisig, zkLogin and passkey wallets sign differently every time; an
  // opener needs a wallet whose signature over one message never changes.
  wrongKind: `Nothing was stored. \`${BINARY_NAME} openers\` lists the wallets this account already has.`,
  // ⛔ FINAL COPY, both of these. They are the two answers to a locator that is already taken, and
  //    the second one has to say the rule as well as the way out: the number used to attach is the
  //    number that must be given at every later sign-in.
  alreadyAttached: `Nothing was stored. \`${BINARY_NAME} openers\` lists it.`,
  opensAnother: `Nothing was stored. One wallet and one number open one account: pass another number with --account, and use the same number with \`${BINARY_NAME} login --wallet\`.`,
};

/** `nmts openers [add|remove <locator>]`. */
export async function openers(
  verb: string | undefined,
  args: ParsedArgs,
  options: OpenersCommandOptions = {},
): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const asked = (verb ?? "").trim();
  if (asked === "" || asked === "list") return await list(args, say);
  if (asked === "add") return await add(args, say, options);
  if (asked === "remove") return await remove(args, say);
  throw new NmtsError(`\`${BINARY_NAME} openers\` has no verb "${asked}".`, {
    exitCode: 2,
    nextStep: `The verbs are: (none) to list, \`add\`, and \`remove <locator>\`.`,
  });
}

/** What this account holds, and how many it may. */
async function list(args: ParsedArgs, say: (line: string) => void): Promise<number> {
  const { access } = await reach(args);
  const listing = await listOpeners(access);
  if (args.json) {
    say(JSON.stringify({ openers: listing.openers, cap: listing.cap }));
    return 0;
  }
  // Copy facts — Facts: each row is a way into this account; `kind` says what holds it; the date is
  // when it was added; the count against the cap is what the account may hold.
  say(`${listing.openers.length} of ${listing.cap} openers on this account. An opener is a wallet that opens it without the NMTS key typed.`);
  for (const one of listing.openers) say(`  ${one.locator}  ${one.kind}  ${one.createdAt}`);
  if (listing.openers.length === 0) {
    // Copy facts — Facts: nothing but the NMTS key opens this account today; adding a wallet is one
    // command; whoever holds an added wallet can open every file in the account.
    say(``);
    say(`  Only the NMTS key opens this account. \`${BINARY_NAME} openers add --sui-key-file <file>\` adds a wallet.`);
  }
  return 0;
}

/**
 * A locator as it must be TYPED, which is not always as it reads.
 *
 * ⛔ ABOUT ONE LOCATOR IN 64 BEGINS WITH `-`: it is 16 bytes written in base64url and that alphabet
 *    has a dash in it. Pasted onto a command line as it stands, such a name is an option to the
 *    shell and to this tool, so a line printed here for a person to copy carries the `--` that ends
 *    the options — the same way this tool already takes a file named `-h`.
 */
function asTyped(locator: string): string {
  return locator.startsWith("-") ? `-- ${locator}` : locator;
}

/** Attach one wallet to this account. */
async function add(
  args: ParsedArgs,
  say: (line: string) => void,
  options: OpenersCommandOptions,
): Promise<number> {
  const { access, code } = await reach(args);
  const attached = await addWallet(access, code, walletOpenerFrom(args, options), OPENER_HINTS);
  if (args.json) {
    say(JSON.stringify({ locator: attached.locator, kind: attached.kind }));
    return 0;
  }
  // Copy facts — Facts: this wallet now opens this account from any machine; the server holds a
  // locked slot it cannot open and a name it cannot trace to a wallet; removing it later stops it
  // opening the account from then on and cannot unknow what it has already opened.
  say(`This wallet now opens this account.`);
  say(``);
  say(`  ${attached.locator}`);
  say(``);
  say(`  Whoever holds this wallet can open every file in the account until it is removed.`);
  say(`  \`${BINARY_NAME} openers remove ${asTyped(attached.locator)}\` takes it off.`);
  return 0;
}

/** Take one wallet off this account. */
async function remove(args: ParsedArgs, say: (line: string) => void): Promise<number> {
  const locator = (args.operands[1] ?? "").trim();
  if (locator === "") {
    throw new NmtsError(`\`${BINARY_NAME} openers remove\` needs the locator of the opener to take off.`, {
      exitCode: 2,
      nextStep: `\`${BINARY_NAME} openers\` prints the locators this account holds.`,
    });
  }
  const { access } = await reach(args);
  await removeWallet(access, locator);
  if (args.json) {
    say(JSON.stringify({ removed: locator }));
    return 0;
  }
  // Copy facts — Facts: from now on that wallet cannot open this account; it is not "as if it never
  // knew" — a wallet that opened the account once has held the NMTS key, and the only answer to
  // that is a new account.
  say(`Removed ${locator}. That wallet cannot open this account from now on.`);
  say(`  Removing does not undo the past: a wallet that opened this account once has held the NMTS key.`);
  return 0;
}

/**
 * The account this run acts on, and the proof the three doors ask for.
 *
 * ⚠ NO NETWORK IS RESOLVED, and that is deliberate — the same reason `key new` does not resolve
 *   one. Nothing here touches a chain or the storage network, so demanding to be told which
 *   network a development server uses would refuse a run that was never going to use the answer.
 */
async function reach(args: ParsedArgs): Promise<{ access: OpenerAccess; code: string }> {
  const held = await requireAccountCode();
  const apiKey = requireApiKey();
  const stored = readCredentialsFile();
  // ⛔ THE PROOF IS BUILT FOR THIS ONE RUN AND NOTHING KEEPS IT — `account-proof.ts`.
  const accountProof = await accountProofFor(held);
  return {
    access: { server: resolveServer(args.server ?? stored?.server), apiKey, accountProof },
    code: held.code,
  };
}

/**
 * The wallet this command line names, and which account of it to open.
 *
 * ⚠ THE ADDRESS IS THE KEY FILE'S OWN. It is not an option: an address typed beside a key file is
 *   two answers to one question, and the message a person signs carries whichever of them is
 *   right only by luck.
 */
export function walletOpenerFrom(args: ParsedArgs, options: OpenersCommandOptions = {}): WalletOpener {
  const path = (args.suiKeyFile ?? "").trim();
  if (options.wallet === undefined && path === "") {
    throw new NmtsError(`--sui-key-file names the file holding the wallet's \`suiprivkey1…\` line.`, {
      exitCode: 2,
      // Copy facts — Facts: the secret is never an option value because a command line is readable
      // by other processes and recorded by the shell; the file is read and never copied.
      nextStep: `Nothing was signed. Write the wallet's key to a file and name it with --sui-key-file.`,
    });
  }
  const wallet = options.wallet ?? walletFromKeyFile(path);
  const app = (args.app ?? "").trim();
  return {
    address: wallet.address,
    sign: wallet.sign,
    account: accountNumber(args.account),
    ...(app === "" ? {} : { app }),
  };
}

/**
 * Which of this wallet's accounts. ⛔ Whole and from 1: the engine refuses 0, and the number is
 * inside what the person signs, so it is never tidied up here.
 */
function accountNumber(given: string | undefined): number {
  const text = (given ?? "").trim();
  if (text === "") return 1;
  if (!/^[1-9][0-9]{0,9}$/u.test(text)) {
    throw new NmtsError(`--account takes a whole number from 1, not "${text}".`, {
      exitCode: 2,
      nextStep: `Nothing was signed. One wallet opens a different account per number, and 1 is the default.`,
    });
  }
  return Number(text);
}
