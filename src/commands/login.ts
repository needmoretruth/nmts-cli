// `nmts login` — keep an account code on this machine.
//
// ⚠ IT DOES NOT CHECK THE CODE WITH THE SERVER, AND IT SAYS SO. Signing in goes through a human
//    check (a captcha) that a command-line tool cannot pass; the credential that waives it is not
//    built yet. Storing a code and printing "signed in" would be claiming something that has not
//    happened — the first command that talks to the server is where a wrong code will surface, and
//    this says that out loud instead of implying otherwise.

import { assertUsableCode } from "../account.ts";
import { CODE_ENV_VAR, credentialsPath, modesAreEnforced, readCredentialsFile, writeCredentials } from "../credentials.ts";
import { NmtsError } from "../errors.ts";
import { firstRunNotice } from "../notice.ts";
import { promptSecret, stdinIsATerminal } from "../prompt.ts";
import { BINARY_NAME } from "../product.ts";
import { resolveNetwork } from "../network.ts";
import { resolveServer } from "../server.ts";

export interface LoginOptions {
  server?: string | undefined;
  network?: string | undefined;
  /** Injected in tests so the terminal is not involved. */
  readCode?: (() => Promise<string>) | undefined;
  write?: (line: string) => void;
}

export async function login(options: LoginOptions = {}): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const server = resolveServer(options.server);
  // ⛔ Settled BEFORE the notice and before anything is written: if the network cannot be decided,
  //    nothing about this account should be stored at all.
  const network = resolveNetwork(server, options.network);
  const existing = readCredentialsFile();

  if (existing === null) say(firstRunNotice());

  const fromEnv = process.env[CODE_ENV_VAR];
  const code =
    options.readCode !== undefined
      ? await options.readCode()
      : fromEnv !== undefined && fromEnv.length > 0
        ? fromEnv
        : await promptSecret(`Account code (not shown as you type): `, CODE_ENV_VAR);

  if (code.length === 0) {
    throw new NmtsError("No account code was given.", {
      exitCode: 2,
      nextStep: stdinIsATerminal()
        ? `Run \`${BINARY_NAME} login\` again and paste the code.`
        : `Set ${CODE_ENV_VAR} in the environment.`,
    });
  }

  // ⛔ CHECKED BEFORE IT IS WRITTEN. The engine verifies the code's own check symbol offline, so a
  //    mistyped code fails here as "that is not a code" instead of being stored and coming back
  //    later as a sign-in failure indistinguishable from a wrong password or a suspended account.
  await assertUsableCode(code);

  writeCredentials({ accountCode: code, server, network, ...(existing?.apiKey ? { apiKey: existing.apiKey } : {}) });

  say(`Stored for ${server} (${network}) in ${credentialsPath()}`);
  if (modesAreEnforced()) {
    say(`  The file is readable only by you (mode 600). It is not encrypted: anything running as`);
    say(`  you can read it, which includes every agent you run on this machine.`);
  } else {
    say(`  Windows does not apply a file mode here, so the file inherits the folder's permissions.`);
  }
  say(``);
  say(`  The code is well-formed — its own check symbol matches. That was verified here, offline.`);
  say(`  Whether the account EXISTS has not been checked: signing in goes through a human check`);
  say(`  this tool cannot pass yet, so that will first show up on a command that needs the server.`);
  return 0;
}
