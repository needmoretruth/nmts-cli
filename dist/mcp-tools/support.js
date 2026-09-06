// Writing to the person who builds NMTS, offered to an agent as tools.
//
// ⛔ WHY THIS IS ON THIS SURFACE AT ALL, when credentials, consent and the human check are not.
//    Those are the person's to give. A report is the opposite: it is the one thing an agent that
//    met a defect can do about it, and it is better placed than the person it works for to say
//    what was run and what came back. The owner asked for it to be here (2026-09-03).
//
// ⛔ AND IT IS THE ONE TOOL HERE THAT SENDS WORDS SOMEWHERE. So the description says, in the
//    words the command prints, what is stripped before anything leaves and what must not be
//    typed. A model reads the description before it composes the message, which is the only
//    moment where saying it changes what gets written.
//
// ⛔ IT DOES NOT ASK OVER ELICITATION, AND `nmts_share` DOES. The difference is what is at stake:
//    a share hands somebody else the key to a file and cannot be recalled, and a report is words
//    in an inbox. What replaces the question is that the tool answers with EXACTLY what it sent —
//    the category, the message and the attachment, after redaction — so the preview is in the
//    transcript whether or not anybody was watching.
import { support } from "../commands/support.js";
import { ATTACH_LOG_TEXT, categoryCodes, SUPPORT_SHORT } from "../support-copy.js";
import { MAX_ATTACHED_RUNS } from "../run-log.js";
import { common, needString, say } from "./context.js";
const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };
/** The two sentences every message is written under, as one line for a description. */
const CARE = SUPPORT_SHORT.join(" ");
/** What `--attach-log` does, as one line for a description. */
const LOG = ATTACH_LOG_TEXT.join(" ");
/** Values a caller wants replaced on top of the rules. Declared the same way on both writers. */
const OMIT_ARG = {
    type: "array",
    items: { type: "string" },
    description: "Values that must not travel — a file name, a folder path. Every occurrence in the message " +
        "and in the attached log becomes [omitted]. At least 3 characters each.",
};
export function supportTools(ctx) {
    return [
        {
            name: "nmts_support_send",
            description: "File a report with the developer of NMTS: a bug, a confusing message, an idea, a " +
                `question. ${CARE} The account code, API key, passphrase, tokens and key material are ` +
                "replaced by labels on this machine before anything is sent, and file contents are never " +
                `read at all; file names and the account's public code may go. ${LOG} The answer to this ` +
                "call is exactly what was sent, so it can be checked afterwards. One report per problem.",
            inputSchema: {
                type: "object",
                properties: {
                    category: {
                        type: "string",
                        enum: categoryCodes(),
                        description: "What the report is about.",
                    },
                    subcategory: {
                        type: "string",
                        description: "Which part of that category, when one fits. Optional everywhere.",
                    },
                    message: {
                        type: "string",
                        description: "The report. A good one has four parts: the command that was run, what was " +
                            "expected, what happened, and anything that narrows it down. 1 to 4000 characters.",
                    },
                    attach_log_runs: {
                        type: "integer",
                        description: `How many of the CLI's last runs to attach. 0 to ${MAX_ATTACHED_RUNS}; 0 attaches none.`,
                    },
                    omit: OMIT_ARG,
                },
                required: ["category", "message"],
                additionalProperties: false,
            },
            // ⚠ NOT `json: true`, unlike every read on this surface. The machine-readable answer is the
            //   ticket alone; what this tool has to hand back is what it SENT.
            run: (args) => say((write) => support("send", [], {
                ...common(ctx),
                write,
                yes: true,
                category: needString(args, "category"),
                ...(typeof args["subcategory"] === "string" ? { sub: args["subcategory"] } : {}),
                message: needString(args, "message"),
                ...(runsAsked(args["attach_log_runs"])),
                omit: stringsOf(args["omit"]),
            })),
        },
        {
            name: "nmts_support_list",
            description: "The reports this account has filed from the command line, with their codes, what each " +
                "is about, whether it has been answered, and how many threads hold something unread. " +
                "Read-only; costs nothing.",
            inputSchema: NO_ARGS,
            run: () => say((write) => support("list", [], { ...common(ctx), json: true, write })),
        },
        {
            name: "nmts_support_show",
            description: "One report and everything said in it, oldest first, using a code from nmts_support_list. " +
                "Reading it marks the thread as seen.",
            inputSchema: {
                type: "object",
                properties: { code: { type: "string", description: "The report's code, from nmts_support_list." } },
                required: ["code"],
                additionalProperties: false,
            },
            run: (args) => say((write) => support("show", [needString(args, "code")], { ...common(ctx), json: true, write })),
        },
        {
            name: "nmts_support_reply",
            description: `Answer in a report's own thread, using a code from nmts_support_list. ${CARE} The same ` +
                "redaction runs over a reply as over the first message. At most 8000 characters.",
            inputSchema: {
                type: "object",
                properties: {
                    code: { type: "string", description: "The report's code, from nmts_support_list." },
                    message: { type: "string", description: "What to add to the thread." },
                    omit: OMIT_ARG,
                },
                required: ["code", "message"],
                additionalProperties: false,
            },
            run: (args) => say((write) => support("reply", [needString(args, "code")], {
                ...common(ctx),
                write,
                yes: true,
                message: needString(args, "message"),
                omit: stringsOf(args["omit"]),
            })),
        },
    ];
}
/**
 * How many runs to attach, in the shape the command takes.
 *
 * ⛔ THE DEFAULT IS NONE. On the command line `--attach-log` is typed on purpose; here it is a
 *    field a model fills in, and attaching a machine's recent history to every report because
 *    nobody said not to is the wrong default for the side that cannot see what is in it.
 */
function runsAsked(value) {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0)
        return {};
    return { attachLog: String(value) };
}
function stringsOf(value) {
    return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}
