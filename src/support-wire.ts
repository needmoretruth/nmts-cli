// Talking to the support routes, and reading what they answer.
//
// ⛔ SPLIT OUT OF THE COMMAND, AND THE LENGTH GATE IS THE HONEST REASON — but the line it was cut
//    on means something: everything here is about the SERVER (its addresses, its limits, its
//    refusals and the shapes it sends back), and everything left in `commands/support.ts` is
//    about the person (what they are shown, what they are asked, what is printed).
//
// ⛔ THE SERVER'S LIMITS ARE MIRRORED, NOT GUESSED. A message too long is refused here rather than
//    after a round trip, so the words somebody typed are still in their terminal when they are
//    told. ⚠ A mirror goes stale: the server is the authority, and its 400 is passed through with
//    the categories named beside it.
//
// ⛔ NOTHING HERE OPENS THE NMTS KEY. The API key is the whole credential these four routes
//    need, so this resolves that and the server address and nothing else.

import { request, ServerError } from "./api.ts";
import { readCredentialsFile } from "./credentials.ts";
import { NmtsError } from "./errors.ts";
import { isRecord } from "./guards.ts";
import { SHORTEST_OMIT } from "./redact.ts";
import { resolveServer } from "./server.ts";
import { requireApiKey } from "./session.ts";
import { categoryCodes, SUPPORT_CATEGORIES } from "./support-copy.ts";

/** The server's own ceilings on what one message may carry. */
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_REPLY_CHARS = 8000;

export interface Wire {
  server: string;
  apiKey: string;
}

export function open(options: { server?: string | undefined }): Wire {
  const apiKey = requireApiKey();
  const stored = readCredentialsFile();
  return { server: resolveServer(options.server ?? stored?.server), apiKey };
}

export async function call(
  wire: Wire,
  path: string,
  init: { method?: "POST"; body?: unknown },
): Promise<unknown> {
  try {
    return await request(wire.server, path, { token: wire.apiKey, ...init });
  } catch (error) {
    throw translate(error);
  }
}

/**
 * The refusals this command has something to add to.
 *
 * ⛔ 409 KEEPS THE SERVER'S OWN SENTENCE. It means this exact message was already sent, and the
 *    server is the half that knows why; a second wording here would be a guess at its reason.
 *
 * ⛔ A VALIDATION REFUSAL IS 400 AND NAMES ITS FIELD ("category: unknown", "message: too long").
 *    It is a command-line mistake, so it gets the command-line exit code rather than the generic
 *    one — and the category list is added only to the refusal that is about a category, because a
 *    list of categories under "message: too long" would be an answer to a question nobody asked.
 */
function translate(error: unknown): unknown {
  if (!(error instanceof ServerError)) return error;
  if (error.status === 429) {
    const wait = error.retryAfter;
    return new NmtsError(
      wait === null
        ? error.message
        : `NMTS is asking you to wait ${wait} seconds before another message.`,
      {
        exitCode: 1,
        nextStep: `Nothing was sent. This is a limit on how often, not a refusal of what was written.`,
      },
    );
  }
  if (error.status === 400 && error.code === "VALIDATION") {
    return new NmtsError(error.message, {
      exitCode: 2,
      ...(error.message.startsWith("category")
        ? { nextStep: `The categories are ${categoryCodes().join(" · ")}.` }
        : {}),
    });
  }
  // ⚠ The reports this rail lists are the ones FILED FROM IT. A ticket written in the browser, and
  //   any other account's, are both 404 here — so the refusal points at the list rather than
  //   suggesting the code was mistyped.
  if (error.status === 404) {
    return new NmtsError(error.message, {
      exitCode: 4,
      nextStep: `\`nmts support list\` prints the reports filed from the command line.`,
    });
  }
  return error;
}

// ── Reading the answers, and the arguments ─────────────────────────────────────────────────────

export interface Message {
  fromOperator: boolean;
  body: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface Ticket {
  id: string;
  code: string;
  category: string;
  subcategory: string | null;
  message: string;
  status: string;
  createdAt: string;
  lastReadAt: string | null;
  messages: Message[] | null;
}

function unreadable(): NmtsError {
  return new NmtsError("The server answered with a report this version cannot read.", {
    nextStep: "A newer version of this tool may understand it.",
  });
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optional(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asTicket(value: unknown): Ticket {
  if (!isRecord(value)) throw unreadable();
  const id = value["id"];
  const code = value["code"];
  if (typeof id !== "string" || typeof code !== "string") throw unreadable();
  const rows = value["messages"];
  return {
    id,
    code,
    category: text(value["category"], "other"),
    subcategory: optional(value["subcategory"]),
    message: text(value["message"]),
    status: text(value["status"], "open"),
    createdAt: text(value["created_at"]),
    lastReadAt: optional(value["last_read_at"]),
    messages: Array.isArray(rows) ? rows.filter(isRecord).map(asMessage) : null,
  };
}

function asMessage(row: Record<string, unknown>): Message {
  return {
    fromOperator: row["from_operator"] === true,
    body: text(row["body"]),
    createdAt: text(row["created_at"]),
    deletedAt: optional(row["deleted_at"]),
  };
}

export function asList(value: unknown): { tickets: Ticket[]; unread: number } {
  if (!isRecord(value)) throw unreadable();
  const rows = value["tickets"];
  if (!Array.isArray(rows)) throw unreadable();
  const unread = value["unread"];
  return {
    tickets: rows.map(asTicket),
    unread: typeof unread === "number" ? unread : 0,
  };
}

/** The date part of an instant. The time of day is noise in a list of reports. */
export function day(at: string): string {
  return at.slice(0, 10).padEnd(10);
}

export function requireCategory(given: string | undefined): string {
  const codes = categoryCodes();
  if (given === undefined) {
    throw new NmtsError("`support send` needs --category.", {
      exitCode: 2,
      nextStep: `The categories are ${codes.join(" · ")}.`,
    });
  }
  if (!codes.includes(given)) {
    throw new NmtsError(`There is no support category called ${given}.`, {
      exitCode: 2,
      nextStep: `The categories are ${codes.join(" · ")}.`,
    });
  }
  return given;
}

/**
 * The narrowing, checked against the category it was given with.
 *
 * ⚠ It is optional everywhere, and stays optional here: somebody who does not know which one
 *   applies must be able to send anyway.
 */
export function checkSub(category: string, given: string | undefined): string | null {
  if (given === undefined) return null;
  const subs = SUPPORT_CATEGORIES.find((c) => c.code === category)?.subs ?? [];
  if (!subs.includes(given)) {
    throw new NmtsError(`${category} has no part called ${given}.`, {
      exitCode: 2,
      nextStep: `Its parts are ${subs.join(" · ")}.`,
    });
  }
  return given;
}

/** Values too short to name one thing would blank half the report, so they are refused. */
export function checkOmit(values: readonly string[]): string[] {
  for (const value of values) {
    if (value.length < SHORTEST_OMIT) {
      throw new NmtsError(`--omit needs at least ${SHORTEST_OMIT} characters: "${value}" is shorter.`, {
        exitCode: 2,
      });
    }
  }
  return [...values];
}

export function requireLength(message: string, most: number, what: string): void {
  if (message === "") {
    throw new NmtsError(`There is no ${what} to send.`, {
      exitCode: 2,
      nextStep: `Pass --message <text>, --message-file <path>, or pipe it in.`,
    });
  }
  const characters = Array.from(message).length;
  if (characters > most) {
    throw new NmtsError(`A ${what} is at most ${most} characters, and this one is ${characters}.`, {
      exitCode: 2,
    });
  }
}
