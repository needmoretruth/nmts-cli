// `nmts mcp` — the same account, offered to an agent as tools instead of as a command line.
//
// ⛔ WHAT IT WILL AND WILL NOT DO. It lists the account's files and fetches one. It cannot make or
//    revoke a key, cannot delete anything, and cannot write outside the one directory the person
//    named when they started it. Those are not omissions to fill in later: a tool a model can call
//    on its own is a different thing from a command a person typed, and the difference is what it
//    is allowed to reach.
//
// ⛔ THE OUTPUT DIRECTORY IS CHOSEN BY THE PERSON, NEVER BY THE MODEL. `nmts_get` takes a path
//    INSIDE THE ACCOUNT and writes under that directory with the file's own name. A model that
//    asks for `../../.ssh/authorized_keys` gets a refusal, not a surprise.
//
// ⛔ NOTHING BUT PROTOCOL GOES TO STDOUT. Everything a person reads goes to stderr — a stray line
//    on stdout is a parse error at the client and the tools disappear with no explanation.

import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, resolve, sep } from "node:path";

import { identityOf } from "../account.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, readCredentialsFile, resolveApiKey, resolveAccountCode } from "../credentials.ts";
import { NmtsError, NotLoggedInError } from "../errors.ts";
import { serve, type ToolDefinition } from "../mcp.ts";
import { readFileList } from "../manifest.ts";
import { BINARY_NAME, PRODUCT_NAME, VERSION } from "../product.ts";
import { resolveNetwork } from "../network.ts";
import { resolveServer } from "../server.ts";
import { get } from "./get.ts";
import { ls } from "./ls.ts";

export interface McpOptions {
  server?: string | undefined;
  network?: string | undefined;
  /** Where fetched files land. Defaults to the working directory the person started this in. */
  out?: string | undefined;
  /** Overridable so a test can drive both ends without pipes. */
  input?: NodeJS.ReadableStream;
  output?: (line: string) => void;
  note?: (line: string) => void;
}

/** Collect what a command would have printed, so it can be handed to a model instead. */
function collector(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line) => lines.push(line) };
}

/**
 * Resolve where one fetched file goes, refusing anything that leaves the chosen directory.
 *
 * ⛔ It takes only the LAST segment of the account path. A file called `../../etc/passwd` in
 *    somebody's drive is a legal name for a file; it must not become a path on this disk. The
 *    containment check that follows is belt as well as braces — `basename` already strips the
 *    separators, and the check catches the day some platform disagrees about what a separator is.
 */
export function destinationFor(outDir: string, accountPath: string): string {
  const name = basename(accountPath);
  if (name === "" || name === "." || name === "..") {
    throw new NmtsError(`"${accountPath}" does not name a file that can be written here.`);
  }
  const root = resolve(outDir);
  const full = resolve(root, name);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new NmtsError(`"${accountPath}" would be written outside ${root}.`);
  }
  return full;
}

export async function mcp(options: McpOptions = {}): Promise<number> {
  const note = options.note ?? ((line: string) => process.stderr.write(`${line}\n`));
  const resolved = resolveAccountCode();
  if (resolved === null) throw new NotLoggedInError(BINARY_NAME, CODE_ENV_VAR);
  const key = resolveApiKey();
  if (key === null) {
    throw new NmtsError("This account has no API key on this machine, and the server needs one.", {
      exitCode: 3,
      nextStep:
        `Make a key on the account screen at nmts.me and put it in ${API_KEY_ENV_VAR}, or store ` +
        `it with \`${BINARY_NAME} login\`.`,
    });
  }

  const stored = readCredentialsFile();
  const server = resolveServer(options.server ?? stored?.server);
  const network = resolveNetwork(server, options.network ?? stored?.network);
  const identity = await identityOf(resolved.code);

  const outDir = resolve(options.out ?? process.cwd());
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  if (!statSync(outDir).isDirectory()) {
    throw new NmtsError(`${outDir} is not a directory.`, { exitCode: 2 });
  }

  const common = { server, network } as const;

  const tools: ToolDefinition[] = [
    {
      name: "nmts_whoami",
      description:
        "Which NMTS account this machine holds the code for. Derived here, offline: it says " +
        "nothing about whether that account exists on the server or has credits.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async run() {
        return [
          `account id  ${identity.accountId}`,
          `public code ${identity.publicCode}`,
          `server      ${server}`,
          `network     ${network}`,
        ].join("\n");
      },
    },
    {
      name: "nmts_list",
      description:
        "List the files stored in the NMTS account, as JSON. Paths are what nmts_get takes. " +
        "Entries in the trash are left out unless include_trashed is true, and the reply says " +
        "how many were left out.",
      inputSchema: {
        type: "object",
        properties: { include_trashed: { type: "boolean", description: "Include what is in the trash." } },
        additionalProperties: false,
      },
      async run(args) {
        const out = collector();
        await ls({ ...common, json: true, all: args["include_trashed"] === true, write: out.write });
        return out.lines.join("");
      },
    },
    {
      name: "nmts_get",
      description:
        `Fetch one file from the NMTS account, decrypt it, and write it into ${outDir}. Takes a ` +
        `path exactly as nmts_list prints it. It refuses rather than writing a wrong or partial ` +
        `file, and it will not replace a file that is already there. The reply says where it went.`,
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "The file's path inside the account." } },
        required: ["path"],
        additionalProperties: false,
      },
      async run(args) {
        const wanted = args["path"];
        if (typeof wanted !== "string" || wanted === "") throw new NmtsError("`path` is required.");
        const out = collector();
        await get(wanted, { ...common, out: destinationFor(outDir, wanted), json: true, write: out.write });
        return out.lines.join("");
      },
    },
  ];

  // ⛔ To stderr, deliberately. A person starting this by hand should see what it is; a client
  //    reading stdout must see nothing but protocol.
  note(`${PRODUCT_NAME} · ${identity.accountId} · ${network} · files land in ${outDir}`);
  note(`Tools: ${tools.map((t) => t.name).join(" · ")}`);

  await serve({
    input: options.input ?? process.stdin,
    output: options.output ?? ((line: string) => process.stdout.write(`${line}\n`)),
    tools,
    info: { name: BINARY_NAME, version: VERSION },
  });
  return 0;
}
