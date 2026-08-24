// The four things every command that talks to the server needs, resolved once.
//
// ⛔ IT IS ONE FUNCTION SO THE REFUSALS ARE ONE TEXT. Each command used to resolve the code, the
//    key, the server and the network for itself, which is four chances for one of them to word
//    the "you have no API key" refusal differently — and that refusal is the single most likely
//    thing a new user of this tool will see.

import { requireAccountCode } from "./code-access.ts";
import { identityOf } from "./account.ts";
import {
  API_KEY_ENV_VAR,
  readCredentialsFile,
  resolveApiKey,
  type CredentialSource,
} from "./credentials.ts";
import { NmtsError } from "./errors.ts";
import { resolveNetwork } from "./network.ts";
import { BINARY_NAME } from "./product.ts";
import { resolveServer } from "./server.ts";

export interface Session {
  /** The account code. ⛔ Held for the command's own work and never written anywhere. */
  code: string;
  /**
   * Where this machine got that code from.
   *
   * ⛔ CARRIED BECAUSE ONE THING A COMMAND DOES WITH THE CODE STILL NEEDS AN AGREEMENT. Sending
   *    the account proof (`account-proof.ts`) is that thing, and the agreement it asks for —
   *    `plain-env` — is about WHERE the code came from, not what is being done with it. A session
   *    that dropped this would leave the deciding module unable to tell a sealed stored code from
   *    an environment variable, and its only options would be to ask always or to ask never.
   */
  source: CredentialSource;
  apiKey: string;
  server: string;
  network: string;
  accountId: string;
}

/**
 * The API key, or the one refusal for not having one.
 *
 * ⛔ IT IS ITS OWN FUNCTION BECAUSE ONE COMMAND NEEDS THE KEY AND NOT THE CODE. `verify` asks the
 *    server about the account and opens no file, so making it resolve an account code would refuse
 *    a run over a credential it never uses — and wording that refusal a second time is exactly how
 *    two texts for one problem start.
 */
export function requireApiKey(): string {
  const key = resolveApiKey();
  if (key === null) {
    throw new NmtsError("This account has no API key on this machine, and the server needs one.", {
      exitCode: 3,
      nextStep:
        `Make a key on the account screen at nmts.me and put it in ${API_KEY_ENV_VAR}, or store ` +
        `it with \`${BINARY_NAME} login\`. The key is what lets a program act without passing the ` +
        `human check that a browser sign-in does.`,
    });
  }
  return key.key;
}

export async function openSession(options: {
  server?: string | undefined;
  network?: string | undefined;
}): Promise<Session> {
  const resolved = await requireAccountCode();
  const apiKey = requireApiKey();
  const stored = readCredentialsFile();
  const server = resolveServer(options.server ?? stored?.server);
  const network = resolveNetwork(server, options.network ?? stored?.network);
  const identity = await identityOf(resolved.code);
  return {
    code: resolved.code,
    source: resolved.source,
    apiKey,
    server,
    network,
    accountId: identity.accountId,
  };
}
