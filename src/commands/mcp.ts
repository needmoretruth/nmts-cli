// `nmts mcp` — the same account, offered to an agent as tools instead of as a command line.
//
// ⛔ WHAT IT WILL AND WILL NOT DO. It offers most of what the command line offers: reading the
//    account, fetching files, uploading them, rearranging them, and sharing one with another
//    account. What it does NOT offer is not a gap to fill in later — a tool a model can call on
//    its own is a different thing from a command a person typed, and this is the list of
//    differences and why each one is there:
//      · Making or revoking a key, signing in or out, and granting this tool's agreements. Those
//        are the person's credentials and the person's consent, and a surface that could grant its
//        own permissions has none.
//      · Passing the human check. A machine cannot; that is what the check is.
//      · Destroying anything permanently — emptying the trash, erasing a file for good. Putting
//        something in the trash IS here, because it can be taken back.
//      · Rebuilding a lost file list. It works, but every name it recovers is a placeholder, and
//        somebody should see that happen rather than read about it afterwards.
//      · Writing the account's disaster-recovery files, and downloading the separate recovery
//        program. Those exist for the day this service is not there, and they are a person's to
//        make and to keep.
//    Nothing here can write outside the one directory the person named when they started it.
//
// ⛔ THE OUTPUT DIRECTORY IS CHOSEN BY THE PERSON, NEVER BY THE MODEL. Every tool that writes
//    takes a path INSIDE THE ACCOUNT and lands under that directory. There is nowhere in any tool
//    declaration to put a path on this disk, which is what keeps that true as tools are added: a
//    model that asks for `../../.ssh/authorized_keys` gets a refusal, not a surprise.
//
// ⛔ NOTHING BUT PROTOCOL GOES TO STDOUT — and two things had to change for that to be true.
//    Prompts now write to stderr, and this server refuses to prompt at all (`allowPrompt: false`),
//    because its stdin IS the protocol: a passphrase prompt here consumed the client's first
//    message as a guess and put its own question on the wire. Everything a person reads goes to stderr — a stray line
//    on stdout is a parse error at the client and the tools disappear with no explanation.

import { existsSync, mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { identityOf } from "../account.ts";
import { requireAccountCode } from "../code-access.ts";
import { API_KEY_ENV_VAR, CODE_ENV_VAR, readCredentialsFile, resolveApiKey } from "../credentials.ts";
import { NmtsError } from "../errors.ts";
import { serve, type ToolDefinition } from "../mcp.ts";
import { describeSighting } from "../agent-host.ts";
// ⚠ Re-exported so callers that knew it here keep working; the rule itself lives one level up now.
import { destinationFor } from "../safe-path.ts";
export { destinationFor };
import { BINARY_NAME, PRODUCT_NAME, VERSION } from "../product.ts";
import { resolveNetwork } from "../network.ts";
import { resolveServer } from "../server.ts";
import { fileTools } from "../mcp-tools/files.ts";
import { organiseTools } from "../mcp-tools/organise.ts";
import { readTools } from "../mcp-tools/reads.ts";
import { shareTools } from "../mcp-tools/share.ts";
import { currentMode } from "../autonomy.ts";
import type { Asker } from "../mcp-ask.ts";
import type { ToolContext } from "../mcp-tools/context.ts";

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

/**
 * Which account this server is holding, answered without asking anything.
 *
 * ⛔ It is derived here, offline, from the code this process opened at startup. It says nothing
 *    about whether that account exists on the server, whether it has credits, or whether the key
 *    beside it belongs to the same account — a model that treats "whoami answered" as "I am signed
 *    in and can spend" has been misled by its own tool.
 */
function whoami(ctx: ToolContext): ToolDefinition {
  return {
    name: "nmts_whoami",
    description:
      "Which NMTS account this machine holds the code for. Derived here, offline: it says " +
      "nothing about whether that account exists on the server or has credits.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run() {
      return [
        `account id  ${ctx.accountId}`,
        `server      ${ctx.server}`,
        `network     ${ctx.network}`,
        `files land  ${ctx.outDir}`,
      ].join("\n");
    },
  };
}

/**
 * Every schema this program actually serves, for the gate that checks they can be enforced.
 *
 * ⛔ IT BUILDS THE REAL TABLE rather than restating it. A hand-kept list of tool names in a test is
 *    a list that goes stale the day somebody adds a tool, and the failure is a tool nobody checks.
 *    The context here is a placeholder — no tool reads it while its schema is being looked at.
 */
export function mcpToolSchemas(): { name: string; inputSchema: Record<string, unknown> }[] {
  const ctx: ToolContext = {
    server: "https://example.invalid",
    network: "testnet",
    outDir: "/",
    accountId: "-",
    asker: () => null,
  };
  const all = [whoami(ctx), ...readTools(ctx), ...fileTools(ctx), ...organiseTools(ctx), ...shareTools(ctx)];
  return all.map((t) => ({ name: t.name, inputSchema: t.inputSchema }));
}

export async function mcp(options: McpOptions = {}): Promise<number> {
  const note = options.note ?? ((line: string) => process.stderr.write(`${line}\n`));
  // ⛔ NO PROMPT FROM HERE. stdin is the protocol; see `OpenOptions.allowPrompt`.
  //
  // ⚠ AND THE CODE IS HELD FOR AS LONG AS THIS SERVER RUNS. A passphrase on a sealed store is a
  //   gate at startup, not a gate per request: once this process has the code it keeps it, and
  //   every tool call it serves uses it without asking again. That is the only shape a server can
  //   have — there is nobody to ask mid-session — and it is written down here because somebody
  //   deciding whether to leave this running deserves to know it.
  const resolved = await requireAccountCode({ allowPrompt: false });
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

  /**
   * How this session asks the person a question, filled in when the client says whether it can.
   *
   * ⛔ IT STARTS AS "NO WAY TO ASK" AND THAT IS THE RIGHT STARTING POINT. A tool call cannot
   *    arrive before `initialize`, so this is only ever read after the client has spoken; if a
   *    client somehow skipped that, the tools that need an answer refuse rather than assume one.
   */
  let asker: Asker = null;
  const ctx: ToolContext = {
    server,
    network,
    outDir,
    accountId: identity.accountId,
    asker: () => asker,
  };

  /**
   * The whole surface, in one place.
   *
   * ⛔ THE ORDER IS THE ORDER A CLIENT SHOWS THEM IN, so it goes reads, then fetching, then
   *    rearranging, then the one that hands a file to somebody else. A model scanning the list
   *    meets the harmless ones first and the irreversible one last, which is the order it should
   *    be thinking in.
   */
  const tools: ToolDefinition[] = [
    whoami(ctx),
    ...readTools(ctx),
    ...fileTools(ctx),
    ...organiseTools(ctx),
    ...shareTools(ctx),
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
    // ⛔ WHO CONNECTED, SAID ONCE, TO STDERR. It is the only moment this is knowable: the name
    //    travels in `initialize` rather than in the environment, which is why it survives the
    //    three hosts that clear the environment before starting a server. A person reading the
    //    log of a server they did not start themselves has nowhere else to learn it.
    onClient: (client) => {
      if (client.host !== null) note(`Client: ${describeSighting(client.host)}`);
      else if (client.name !== null) note(`Client: ${client.name} — not an agent this version knows by name`);
    },
    // ⛔ AND WHETHER IT CAN BE ASKED ANYTHING, said once for the same reason. A person watching
    //    this log needs to know before the first share, not when it is refused.
    onAsker: (built) => {
      asker = built;
      // ⚠ A MODE THAT IS ON DECIDES THIS, so it is read here rather than assumed. Saying "every
      //   share will ask you" to somebody who turned a mode on would be telling them the opposite
      //   of what their own setting does.
      if (currentMode() !== "off") return;
      note(
        built === null
          ? "This client cannot show you a question, so sharing is refused here. Share from a terminal."
          : "This client can show you a question; every share will ask you first.",
      );
    },
  });
  return 0;
}
