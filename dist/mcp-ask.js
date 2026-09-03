// Asking the PERSON a question from inside a tool call, over the protocol.
//
// ⛔ WHY THIS EXISTS. Every other agreement this tool takes is once per machine, written down, and
//    then never asked about again — which is right for a capability, and wrong for an act that
//    cannot be undone and names somebody else each time. Handing a file to another account is the
//    one thing here where the question is not "may this tool ever do that" but "is THIS the person
//    you meant". A recorded agreement cannot answer that, because the answer is different for
//    every call.
//
// ⛔ THE CHANNEL IS `elicitation/create`, AND IT IS THE ONLY ONE THERE IS. On this server stdout is
//    the protocol wire and stderr may be shown to nobody, so a prompt printed anywhere is a prompt
//    the person never sees. Elicitation is a request the SERVER sends to the CLIENT — the reverse
//    of everything else here — and the client is the half with a screen.
//
// ⛔ A CLIENT THAT CANNOT BE ASKED IS NOT A CLIENT THAT AGREED. Elicitation arrived in protocol
//    version 2025-06-18 and a client declares it or does not. When it does not, this returns
//    `unreachable` and the caller REFUSES. Falling back to the recorded once-per-machine agreement
//    would mean the weakest client silently sets the rule for all of them, which is how a
//    protection becomes decorative.
//
// ⚠ WHAT THIS IS NOT. It is not proof a person answered. The client decides what to put on screen
//   and what to send back, and a client that answers by itself is indistinguishable from one that
//   asked. What this buys is that the decision is put where a person can see it, once per share,
//   in the words below — not that it cannot be automated.
//
// ⛔ NOTHING SENSITIVE GOES IN THE QUESTION. The specification says a server must not use
//    elicitation to request sensitive information, and this asks for nothing at all: the schema is
//    one boolean, and the account code, the file's key and the recipient's key appear nowhere in
//    it. The recipient's public code is in the message because it is the thing being confirmed and
//    the model already has it.
/**
 * The question this server asks, in one place so that every caller asks it the same way.
 *
 * ⛔ ONE BOOLEAN, NOT A FREE-TEXT FIELD. A client renders this schema into whatever it renders it
 *    into, and a checkbox somebody has to tick is the shape that survives every rendering. A text
 *    field would let a client accept "no" as a filled-in answer.
 */
export const CONFIRM_SCHEMA = {
    type: "object",
    properties: {
        confirm: {
            type: "boolean",
            title: "Yes, share it",
            description: "Leave this off to refuse. Refusing stops the share and nothing else.",
            default: false,
        },
    },
    required: ["confirm"],
};
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
export function readAnswer(result) {
    if (typeof result !== "object" || result === null)
        return "no";
    const action = Reflect.get(result, "action");
    if (action !== "accept")
        return "no";
    const content = Reflect.get(result, "content");
    if (typeof content !== "object" || content === null)
        return "no";
    return Reflect.get(content, "confirm") === true ? "yes" : "no";
}
/** Whether the client said, at `initialize`, that it can put a question in front of a person. */
export function declaredElicitation(capabilities) {
    if (typeof capabilities !== "object" || capabilities === null)
        return false;
    const value = Reflect.get(capabilities, "elicitation");
    return typeof value === "object" && value !== null;
}
/**
 * Build the asker for a session.
 *
 * ⛔ THE CAPABILITY IS READ ONCE, FROM `initialize`, AND NEVER GUESSED AFTERWARDS. A client that
 *    did not declare elicitation is not sent one: the specification says a server may only use a
 *    capability the other side declared, and a request it does not understand is at best an error
 *    on the wire and at worst a hung tool call waiting for an answer that is never coming.
 */
export function askerFor(capabilities, send) {
    if (!declaredElicitation(capabilities))
        return null;
    return async (message) => {
        // ⚠ A client that declared the capability and then fails to answer must not hang the tool.
        //   Whatever went wrong, nobody agreed, so it is a no.
        try {
            return readAnswer(await send("elicitation/create", { message, requestedSchema: CONFIRM_SCHEMA }));
        }
        catch {
            return "no";
        }
    };
}
