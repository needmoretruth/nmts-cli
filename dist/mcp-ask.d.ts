/** What came back, once the three protocol actions are read for what they mean here. */
export type AskOutcome = 
/** The person said yes. */
"yes"
/** The person said no, or dismissed the question without answering. Both mean: do not proceed. */
 | "no"
/** There was nobody to ask — the client never said it could. */
 | "unreachable";
/** Sends one JSON-RPC request to the client and resolves with whatever comes back as its result. */
export type SendRequest = (method: string, params: Record<string, unknown>) => Promise<unknown>;
/**
 * The question this server asks, in one place so that every caller asks it the same way.
 *
 * ⛔ ONE BOOLEAN, NOT A FREE-TEXT FIELD. A client renders this schema into whatever it renders it
 *    into, and a checkbox somebody has to tick is the shape that survives every rendering. A text
 *    field would let a client accept "no" as a filled-in answer.
 */
export declare const CONFIRM_SCHEMA: Readonly<Record<string, unknown>>;
/**
 * Read an `elicitation/create` result. Pure, so the three actions can be tested without a pipe.
 *
 * ⛔ ONLY `accept` WITH `confirm === true` IS A YES. `decline` and `cancel` are both no — the
 *    specification distinguishes "refused" from "dismissed" so that a server can offer something
 *    else, and here there is nothing else to offer. An `accept` carrying no content, or content
 *    with the box unticked, is a no as well: the person was shown the question and did not agree.
 *
 * ⛔ ANYTHING UNRECOGNISED IS A NO. A malformed answer is not an answer, and the direction to fail
 *    in is the one where a file is not handed to somebody.
 */
export declare function readAnswer(result: unknown): AskOutcome;
/** Whether the client said, at `initialize`, that it can put a question in front of a person. */
export declare function declaredElicitation(capabilities: unknown): boolean;
/** How a session asks, or `null` when this session has no way to ask at all. */
export type Asker = ((message: string) => Promise<AskOutcome>) | null;
/**
 * Build the asker for a session.
 *
 * ⛔ THE CAPABILITY IS READ ONCE, FROM `initialize`, AND NEVER GUESSED AFTERWARDS. A client that
 *    did not declare elicitation is not sent one: the specification says a server may only use a
 *    capability the other side declared, and a request it does not understand is at best an error
 *    on the wire and at worst a hung tool call waiting for an answer that is never coming.
 */
export declare function askerFor(capabilities: unknown, send: SendRequest): Asker;
