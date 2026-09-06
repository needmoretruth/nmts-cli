// `nmts support` — writing to the person who builds NMTS, from the command line.
//
// ⛔ WHY IT IS IN THE TOOL AND NOT ONLY AN ADDRESS IN THE README. The moment somebody wants to
//    report something is the moment something went wrong, and that is exactly when nobody goes
//    looking for a web page. It is also the one thing an agent can do about a defect: it cannot
//    fix the tool, and it can describe what it ran and what came back better than the person it is
//    working for can.
//
// ⛔ NOTHING LEAVES WITHOUT BEING SHOWN FIRST. The preview is not a flag and cannot be turned off:
//    the exact text, the exact attachment and the byte count are printed before anything is sent,
//    in every mode. What a mode changes is only whether somebody is ASKED after seeing it —
//    filing a report is an act the owner wants agents to perform, and the preview is in the
//    transcript either way.
//
// ⛔ EVERYTHING IS REDACTED HERE, ON THIS MACHINE, BEFORE IT IS SHOWN. The message, the attached
//    log and anything named with `--omit` all go through `redact.ts` first, so the preview shows
//    what will actually travel rather than what was typed. A preview that showed the original and
//    sent something else would be the wrong way round.
//
// ⛔ THE NMTS KEY IS NOT NEEDED AND IS NOT OPENED. This command talks to the server with the
//    API key alone, like `verify` and `trial`. A report is not worth asking somebody for a
//    passphrase, and a command that never holds the code cannot leak it.

import { NmtsError } from "../errors.ts";
import { BINARY_NAME } from "../product.ts";
import { promptLine } from "../prompt.ts";
import { omitLiterals, redact } from "../redact.ts";
import { MAX_ATTACHED_RUNS, readRuns } from "../run-log.ts";
import { buildLogAttachment, MAX_ATTACHMENT_BYTES, type LogAttachment } from "../support-attach.ts";
import { SUPPORT_SHORT } from "../support-copy.ts";
import {
  asList,
  asTicket,
  call,
  checkOmit,
  checkSub,
  day,
  MAX_MESSAGE_CHARS,
  MAX_REPLY_CHARS,
  open,
  requireCategory,
  requireLength,
  type Message,
  type Wire,
} from "../support-wire.ts";

/** How many runs `--attach-log` takes when it is given with no number. */
const DEFAULT_ATTACHED_RUNS = 3;

export interface SupportOptions {
  server?: string | undefined;
  network?: string | undefined;
  json?: boolean;
  write?: (line: string) => void;
  /** What a report is about, and optionally which part of it. */
  category?: string | undefined;
  sub?: string | undefined;
  /** The message itself, or the file holding it. Neither means: read the standard input. */
  message?: string | undefined;
  messageFile?: string | undefined;
  /** `--attach-log`: absent means none, empty means the default count, otherwise a number. */
  attachLog?: string | undefined;
  /** Values the caller says must not travel, whatever the rules make of them. */
  omit?: readonly string[] | undefined;
  /** Send without being asked. */
  yes?: boolean;
  /** Where a message with no `--message` comes from. Injected so a test needs no pipe. */
  readInput?: () => Promise<string>;
  /** How the person is asked. Injected for the same reason. */
  askPerson?: (question: string) => Promise<string>;
}

/** `nmts support <action> [operands]`. */
export async function support(
  action: string | undefined,
  operands: readonly string[],
  options: SupportOptions = {},
): Promise<number> {
  switch (action) {
    case "send":
      return await sendReport(options);
    case "list":
      return await listReports(options);
    case "show":
      return await showReport(operands[0], options);
    case "reply":
      return await replyToReport(operands[0], options);
    default:
      throw new NmtsError(
        action === undefined ? "`support` needs an action." : `Unknown support action: ${action}`,
        {
          exitCode: 2,
          nextStep: `The actions are send, list, show and reply. Run \`${BINARY_NAME} support --help\`.`,
        },
      );
  }
}

// ── Sending ────────────────────────────────────────────────────────────────────────────────────

async function sendReport(options: SupportOptions): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const category = requireCategory(options.category);
  const subcategory = checkSub(category, options.sub);
  const omit = checkOmit(options.omit ?? []);
  const clean = (text: string): string => omitLiterals(redact(text), omit);

  const message = clean(await readMessage(options)).trim();
  requireLength(message, MAX_MESSAGE_CHARS, "message");

  const attachment = packLog(options.attachLog, clean);
  const total = Buffer.byteLength(message, "utf8") + (attachment?.bytes ?? 0);

  // ⛔ THE MACHINE-READABLE PREVIEW IS THE ONLY THING PRINTED ON THAT PATH, and it is printed
  //    INSTEAD of sending rather than before it. Two JSON objects on one stream would let a caller
  //    read `sent: false` off a run that then went on to send.
  if (options.json === true) {
    if (!answeredAlready(options)) {
      say(
        JSON.stringify({
          sent: false,
          category,
          ...(subcategory === null ? {} : { subcategory }),
          message,
          ...(attachment === null ? {} : { log: attachment.text, log_runs: attachment.runs }),
          bytes: total,
        }),
      );
      return 5;
    }
  } else {
    for (const line of SUPPORT_SHORT) say(line);
    say(``);
    say(`Category: ${subcategory === null ? category : `${category} / ${subcategory}`}`);
    say(`Message (${Buffer.byteLength(message, "utf8")} bytes):`);
    for (const line of message.split("\n")) say(`  ${line}`);
    if (attachment === null) {
      say(`Log: none`);
    } else {
      say(`Log (${attachment.bytes} bytes, ${attachment.runs} runs, ${attachment.dropped} dropped):`);
      for (const line of attachment.text.split("\n")) say(`  ${line}`);
    }
    say(`Total: ${total} bytes.`);
    if (!(await agreed(options, say))) {
      say(``);
      say(`Nothing was sent. To go ahead:  ${BINARY_NAME} support send … --yes`);
      return 5;
    }
  }

  const wire = open(options);
  const answer = await call(wire, "/v1/support/cli", {
    method: "POST",
    body: {
      message,
      category,
      ...(subcategory === null ? {} : { subcategory }),
      ...(attachment === null ? {} : { log: attachment.text }),
    },
  });
  const ticket = asTicket(answer);
  if (options.json === true) {
    say(JSON.stringify(answer));
    return 0;
  }
  say(``);
  say(`Sent. ${ticket.code} — replies arrive in \`${BINARY_NAME} support show ${ticket.code}\`.`);
  return 0;
}

/**
 * Has the answer already been given, before anybody is asked anything?
 *
 * ⛔ THE TIER GATE HANDS THE ANSWER: a low act runs unasked in the agent modes, and the gate
 *    passes that as `--yes`. Filing a report is an act the owner wants an agent to perform, and
 *    the preview above it is in the transcript either way.
 */
function answeredAlready(options: SupportOptions): boolean {
  return options.yes === true;
}

/**
 * Put the question, having printed the preview.
 *
 * ⚠ No terminal and no `--yes` is a no, not a hang: `promptLine` answers "" where there is nobody.
 */
async function agreed(options: SupportOptions, say: (line: string) => void): Promise<boolean> {
  if (answeredAlready(options)) return true;
  const ask = options.askPerson ?? promptLine;
  say(``);
  const answer = (await ask(`Send this? [y/N] `)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

/** The message: the option, then the named file, then the standard input. */
async function readMessage(options: SupportOptions): Promise<string> {
  if (options.message !== undefined) return options.message;
  if (options.messageFile !== undefined) {
    const { readFileSync } = await import("node:fs");
    try {
      return readFileSync(options.messageFile, "utf8");
    } catch {
      // ⛔ The reason is not repeated: a filesystem error's own text quotes the path back, and
      //    that is the one thing a caller already knows.
      throw new NmtsError(`Could not read ${options.messageFile}.`, { exitCode: 2 });
    }
  }
  const read = options.readInput ?? standardInput;
  return await read();
}

function standardInput(): Promise<string> {
  if (process.stdin.isTTY === true) return Promise.resolve("");
  const chunks: Buffer[] = [];
  return new Promise<string>((resolve, reject) => {
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

/** Read the newest runs and pack them, or `null` when the option was not given. */
function packLog(asked: string | undefined, clean: (text: string) => string): LogAttachment | null {
  if (asked === undefined) return null;
  const count = asked === "" ? DEFAULT_ATTACHED_RUNS : Number(asked);
  if (!Number.isInteger(count) || count < 0 || count > MAX_ATTACHED_RUNS) {
    throw new NmtsError(`--attach-log takes a whole number of runs, 0 to ${MAX_ATTACHED_RUNS}.`, {
      exitCode: 2,
    });
  }
  if (count === 0) return null;
  const runs = readRuns(count);
  if (runs.length === 0) return null;
  return buildLogAttachment(runs, clean, MAX_ATTACHMENT_BYTES);
}

// ── Reading, and answering ─────────────────────────────────────────────────────────────────────

async function listReports(options: SupportOptions): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const answer = await call(open(options), "/v1/support/cli", {});
  if (options.json === true) {
    say(JSON.stringify(answer));
    return 0;
  }
  const { tickets, unread } = asList(answer);
  if (tickets.length === 0) {
    say(`No reports have been filed from this account with \`${BINARY_NAME} support send\`.`);
    return 0;
  }
  for (const t of tickets) {
    const about = t.subcategory === null ? t.category : `${t.category}/${t.subcategory}`;
    say(
      [
        t.code.padEnd(12),
        about.padEnd(18),
        t.status.padEnd(10),
        day(t.createdAt),
        // ⚠ THE MARK IS DERIVED, because the list carries no per-thread unread flag: the server
        //   sends one number for the whole mailbox. What a row does carry is whether it has been
        //   answered and whether this account has ever stamped it read, and that pair is the
        //   honest half of the question.
        t.status === "answered" && t.lastReadAt === null ? "  new" : "",
      ]
        .join(" ")
        .trimEnd(),
    );
  }
  say(``);
  say(`${unread} unread.`);
  return 0;
}

async function showReport(which: string | undefined, options: SupportOptions): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const wire = open(options);
  const id = await resolveTicket(wire, which);
  const answer = await call(wire, `/v1/support/cli/${encodeURIComponent(id)}`, {});
  if (options.json === true) {
    say(JSON.stringify(answer));
    return 0;
  }
  const ticket = asTicket(answer);
  const about = ticket.subcategory === null ? ticket.category : `${ticket.category}/${ticket.subcategory}`;
  say(`${ticket.code}  ${about}  ${ticket.status}  ${ticket.createdAt}`);
  say(``);
  said(say, "you", ticket.createdAt, ticket.message);
  for (const m of ticket.messages ?? []) {
    said(say, m.fromOperator ? "NMTS" : "you", m.createdAt, bodyOf(m));
  }
  return 0;
}

async function replyToReport(which: string | undefined, options: SupportOptions): Promise<number> {
  const say = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const omit = checkOmit(options.omit ?? []);
  const message = omitLiterals(redact(await readMessage(options)), omit).trim();
  requireLength(message, MAX_REPLY_CHARS, "reply");
  const wire = open(options);
  const id = await resolveTicket(wire, which);

  if (options.json === true) {
    if (!answeredAlready(options)) {
      say(JSON.stringify({ sent: false, code: which, message, bytes: Buffer.byteLength(message, "utf8") }));
      return 5;
    }
  } else {
    for (const line of SUPPORT_SHORT) say(line);
    say(``);
    say(`Reply (${Buffer.byteLength(message, "utf8")} bytes):`);
    for (const line of message.split("\n")) say(`  ${line}`);
    if (!(await agreed(options, say))) {
      say(``);
      say(`Nothing was sent. To go ahead:  ${BINARY_NAME} support reply … --yes`);
      return 5;
    }
  }
  // ⚠ THE FIELD IS `body`, NOT `message`. A follow-up is the same shape the browser's rail takes,
  //   and only the FIRST message of a thread is called a message.
  const answer = await call(wire, `/v1/support/cli/${encodeURIComponent(id)}/reply`, {
    method: "POST",
    body: { body: message },
  });
  if (options.json === true) say(JSON.stringify(answer));
  else say(`Sent.`);
  return 0;
}

/** One turn of a thread, printed with the words indented under who said them. */
function said(say: (line: string) => void, who: string, at: string, body: string): void {
  say(`${who}  ${at}`);
  for (const line of body.split("\n")) say(`  ${line}`);
  say(``);
}

/**
 * What a row holds, when it holds no words.
 *
 * The server sends an empty body for a withdrawn message and for every row that is a notice rather
 * than a sentence, and it composes a notice's words on the screen that shows it. There is no such
 * screen here, so the row is named for what it is.
 */
function bodyOf(m: Message): string {
  if (m.body !== "") return m.body;
  return m.deletedAt !== null ? `[withdrawn]` : `[a notice from NMTS]`;
}

/**
 * A code or an id, turned into the id the route takes.
 *
 * ⛔ A CODE IS WHAT A PERSON HAS. It is the reference the ticket prints and the one they would
 *    quote in an email, and it is not the id in the address — so this looks it up rather than
 *    refusing a value that is obviously theirs.
 */
async function resolveTicket(wire: Wire, which: string | undefined): Promise<string> {
  if (which === undefined || which === "") {
    throw new NmtsError(`Which report? Give the code \`${BINARY_NAME} support list\` prints.`, {
      exitCode: 2,
    });
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(which)) return which;
  const { tickets } = asList(await call(wire, "/v1/support/cli", {}));
  const found = tickets.find((t) => t.code.toLowerCase() === which.toLowerCase());
  if (found === undefined) {
    throw new NmtsError(`No report of this account's is called ${which}.`, {
      exitCode: 4,
      nextStep: `\`${BINARY_NAME} support list\` prints the codes.`,
    });
  }
  return found.id;
}
