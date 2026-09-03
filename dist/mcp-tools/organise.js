// Rearranging what the account holds, without moving a byte or spending anything.
//
// ⛔ EVERYTHING HERE IS AN EDIT TO THE SEALED LIST AND NOTHING HERE IS PERMANENT. Names, folders
//    and marks live only inside the list the account code opens; the server never sees them and no
//    stored bytes move. That is why these are the tools a model may use freely: the worst outcome
//    is a tidy-up somebody has to undo, and every one of them has an undo.
//
// ⛔ WHAT IS DELIBERATELY ABSENT: permanent erase, and sweeping the trash. Putting something in the
//    trash is reversible and is here; taking it out for good is not, and a machine does not get to
//    make that call on somebody's files. The command line still has both for a person.
//
// ⛔ SIX MARK VERBS ARE ONE TOOL, NOT SIX. A model choosing between `nmts_star` and `nmts_unstar`
//    is choosing between two spellings of the same decision, and the pair that gets forgotten is
//    the "un" one. One tool with the mark named and a switch says what is actually being decided.
import { label, labelRename, pin, star, unlabel, unlabelAll, unpin, unstar } from "../commands/marks.js";
import { mkdir, mv, rename } from "../commands/organise.js";
import { padding } from "../commands/padding.js";
import { restore, rm } from "../commands/trash.js";
import { common, needPaths, needString, say } from "./context.js";
export function organiseTools(ctx) {
    return [
        {
            name: "nmts_mkdir",
            description: "Make a folder in the NMTS account, including any parent folders that are missing. " +
                "Folders exist only inside the account's sealed list; making one costs nothing.",
            inputSchema: {
                type: "object",
                properties: { path: { type: "string", description: "The folder path to make." } },
                required: ["path"],
                additionalProperties: false,
            },
            run: (args) => say((write) => mkdir(needString(args, "path"), { ...common(ctx), json: true, write })),
        },
        {
            name: "nmts_move",
            description: "Move one or more entries into a folder in the NMTS account. Nothing is re-uploaded and " +
                "nothing is charged — only the sealed list changes. A name already taken in the " +
                "destination is numbered rather than replacing what is there.",
            inputSchema: {
                type: "object",
                properties: {
                    paths: {
                        type: "array",
                        items: { type: "string" },
                        description: "The entries to move, as nmts_list prints them.",
                    },
                    to: { type: "string", description: "The destination folder." },
                },
                required: ["paths", "to"],
                additionalProperties: false,
            },
            run: (args) => say((write) => mv([...needPaths(args), needString(args, "to")], { ...common(ctx), json: true, write })),
        },
        {
            name: "nmts_rename",
            description: "Rename one entry in the NMTS account. The name lives inside the sealed list, so this " +
                "moves no bytes and costs nothing.",
            inputSchema: {
                type: "object",
                properties: {
                    path: { type: "string", description: "The entry to rename." },
                    name: { type: "string", description: "Its new name. A name, not a path." },
                },
                required: ["path", "name"],
                additionalProperties: false,
            },
            run: (args) => say((write) => rename(needString(args, "path"), needString(args, "name"), { ...common(ctx), json: true, write })),
        },
        {
            name: "nmts_mark",
            description: "Put a mark on files, or take one off. `star` is the account's favourites, `pin` keeps a " +
                "file at the top of its folder, and `label` attaches a word you choose (give it in " +
                "`name`). Marks live inside the sealed list and are refused on folders.",
            inputSchema: {
                type: "object",
                properties: {
                    paths: { type: "array", items: { type: "string" }, description: "The files to mark." },
                    mark: { type: "string", enum: ["star", "pin", "label"], description: "Which mark." },
                    on: { type: "boolean", description: "true puts the mark on, false takes it off. Required." },
                    name: { type: "string", description: "The label's word. Required when mark is label." },
                },
                required: ["paths", "mark", "on"],
                additionalProperties: false,
            },
            run: (args) => {
                const paths = needPaths(args);
                const mark = needString(args, "mark");
                const on = args["on"];
                if (typeof on !== "boolean")
                    throw new Error("`on` is required: true to mark, false to unmark.");
                const options = { ...common(ctx), json: true };
                return say((write) => {
                    const opts = { ...options, write };
                    if (mark === "star")
                        return on ? star(paths, opts) : unstar(paths, opts);
                    if (mark === "pin")
                        return on ? pin(paths, opts) : unpin(paths, opts);
                    const name = needString(args, "name");
                    return on ? label(name, paths, opts) : unlabel(name, paths, opts);
                });
            },
        },
        {
            name: "nmts_label_rename",
            description: "Rename a label on every file that carries it. Changes only the file list; costs nothing.",
            inputSchema: {
                type: "object",
                properties: {
                    old: { type: "string", description: "The label as it is now." },
                    new: { type: "string", description: "What it should be called instead." },
                },
                required: ["old", "new"],
                additionalProperties: false,
            },
            run: (args) => say((write) => labelRename(needString(args, "old"), needString(args, "new"), {
                ...common(ctx),
                json: true,
                write,
            })),
        },
        {
            name: "nmts_unlabel_all",
            description: "Take one label off every file that carries it. Changes only the file list; costs nothing.",
            inputSchema: {
                type: "object",
                properties: { name: { type: "string", description: "The label to take off." } },
                required: ["name"],
                additionalProperties: false,
            },
            run: (args) => say((write) => unlabelAll(needString(args, "name"), { ...common(ctx), json: true, write })),
        },
        {
            name: "nmts_padding",
            description: "Read or set how file sizes are hidden on the storage network: standard (a few fixed " +
                "sizes per doubling) or pow2 (one per doubling, hides more, costs more storage on " +
                "average). Applies to the next uploads from every device.",
            inputSchema: {
                type: "object",
                properties: {
                    mode: {
                        type: "string",
                        enum: ["standard", "pow2"],
                        description: "Leave it out to read the setting rather than change it.",
                    },
                },
                additionalProperties: false,
            },
            run: (args) => say((write) => padding(typeof args["mode"] === "string" ? args["mode"] : undefined, {
                ...common(ctx),
                json: true,
                write,
            })),
        },
        {
            name: "nmts_trash",
            description: "Put files in the NMTS account's trash. Nothing is destroyed and nothing is refunded: the " +
                "storage stays bought and the file can be brought back with nmts_restore. Emptying the " +
                "trash for good is not something this surface can do — that is a person's decision at the " +
                "command line.",
            inputSchema: {
                type: "object",
                properties: { paths: { type: "array", items: { type: "string" }, description: "The files to trash." } },
                required: ["paths"],
                additionalProperties: false,
            },
            run: (args) => say((write) => rm(needPaths(args), { ...common(ctx), json: true, write })),
        },
        {
            name: "nmts_restore",
            description: "Take files back out of the NMTS account's trash, into the folder they came from.",
            inputSchema: {
                type: "object",
                properties: { paths: { type: "array", items: { type: "string" }, description: "The files to restore." } },
                required: ["paths"],
                additionalProperties: false,
            },
            run: (args) => say((write) => restore(needPaths(args), { ...common(ctx), json: true, write })),
        },
    ];
}
