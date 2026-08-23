// `nmts whoami` — which account the code on this machine belongs to.
//
// ⚠ IT ANSWERS OFFLINE, AND IT SAYS WHAT IT DID NOT DO. Everything printed is derived from the
//    code on this machine; nothing is asked of a server. So it proves the code is well-formed and
//    which account it is, and it proves nothing about whether that account exists, has credits, or
//    is signed in. Printing an account id without saying that would read as "connected".

import { identityOf } from "../account.ts";
import { CODE_ENV_VAR, resolveAccountCode, readCredentialsFile } from "../credentials.ts";
import { NotLoggedInError } from "../errors.ts";
import { BINARY_NAME } from "../product.ts";
import { resolveNetwork } from "../network.ts";
import { resolveServer } from "../server.ts";

export interface WhoamiOptions {
  server?: string | undefined;
  network?: string | undefined;
  write?: (line: string) => void;
}

export async function whoami(options: WhoamiOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const resolved = resolveAccountCode();
  if (resolved === null) throw new NotLoggedInError(BINARY_NAME, CODE_ENV_VAR);

  const identity = await identityOf(resolved.code);
  const stored = resolved.source === "file" ? readCredentialsFile() : null;
  const server = resolveServer(options.server ?? stored?.server);
  const network = resolveNetwork(server, options.network ?? stored?.network);

  say(`Account id   ${identity.accountId}`);
  say(`Public code  ${identity.publicCode}`);
  say(`Code from    ${resolved.source === "env" ? `${CODE_ENV_VAR} (not stored)` : "this machine"}`);
  say(`Server       ${server}`);
  say(`Network      ${network}`);
  say(``);
  say(`  Derived on this machine. Nothing was asked of the server, so this does not say whether`);
  say(`  the account exists there, has credits, or is signed in.`);
  return 0;
}
