// What `nmts` prints when asked what it can do.
//
// ⛔ COMMANDS THAT ARE NOT BUILT ARE MARKED, NOT HIDDEN. An agent that discovers a command by
//    running it and getting "unknown command" learns the wrong thing — it will try synonyms. Being
//    told the command exists and is unfinished is a fact it can act on: stop, and do not retry.

import { BINARY_NAME, HOME_URL, PRODUCT_NAME } from "./product.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR } from "./credentials.ts";
import { NETWORK_ENV_VAR } from "./network.ts";
import { SERVER_ENV_VAR } from "./server.ts";
import { AGGREGATOR_ENV_VAR } from "./walrus.ts";

export function helpText(version: string): string {
  return [
    `${PRODUCT_NAME} ${version} — command-line access to end-to-end encrypted NMTS storage.`,
    ``,
    `USAGE`,
    `  ${BINARY_NAME} <command> [options]`,
    ``,
    `COMMANDS`,
    `  login                 Keep an account code on this machine`,
    `  logout                Remove the stored account code`,
    `  whoami                Show which account the stored code belongs to (offline)`,
    `  ls                    List files in the account`,
    `  put <file>...         Encrypt and upload                               [not built yet]`,
    `  get <path>            Download one file and decrypt it`,
    `  mcp                   Serve ls and get as tools, for an agent that speaks MCP`,
    ``,
    `OPTIONS`,
    `  --server <url>        NMTS server (default ${SERVER_ENV_VAR} or the live one)`,
    `  --network <name>      mainnet or testnet. Required for any server but the live one`,
    `  --json                Machine-readable output (ls)`,
    `  --all                 Include what is in the trash (ls)`,
    `  --out <path>          Where to write files (get, mcp). Default: this directory`,
    `  --force               Replace a file that is already there (get)`,
  `  --version             Print the version and exit`,
    `  --help                Print this and exit`,
    ``,
    `ENVIRONMENT`,
    `  ${CODE_ENV_VAR.padEnd(20)}The account code. Read fresh each run and never written to disk.`,
    `                      Takes precedence over anything stored by \`${BINARY_NAME} login\`.`,
    `  ${API_KEY_ENV_VAR.padEnd(20)}Key made on the account screen. It waives the human check a`,
    `                      browser sign-in does, and nothing else — it opens no file.`,
    `  ${SERVER_ENV_VAR.padEnd(20)}Server to talk to. For development stacks.`,
    `  ${AGGREGATOR_ENV_VAR.padEnd(20)}Storage-network read hosts, comma-separated. Replaces`,
    `                      the built-in list rather than adding to it.`,
    `  ${NETWORK_ENV_VAR.padEnd(20)}mainnet or testnet. Never guessed: a wrong one looks in a place`,
    `                      your files were never stored.`,
    ``,
    `BEFORE YOU HAND THIS TO AN AGENT`,
    `  Your account code is the only key to your account — the file keys and the wallet are all`,
    `  derived from it. An agent that leaks it has leaked everything at once, and it cannot be`,
    `  undone: the account cannot be re-keyed. Use an account you would be willing to lose.`,
    ``,
    `  ${HOME_URL}`,
    ``,
  ].join("\n");
}
