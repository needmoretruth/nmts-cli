// The drive's own edits without a terminal: making a folder, moving, renaming, and the two halves
// of the trash — decided, written, and handed back rather than printed.
//
// ⛔ ONE IMPLEMENTATION, TWO CALLERS, WHICH IS THE WHOLE REASON THIS FILE EXISTS. The commands in
//    `commands/organise.ts` and `commands/trash.ts` are a terminal's shape: they print sentences
//    and answer an exit code. The SDK is somebody else's program and needs the same five verbs
//    with neither. A second implementation of "what does moving onto a taken name do" would be a
//    second place for the compare-and-swap rules to be got right, and the copy nobody re-reads is
//    the one that quietly disagrees — which is the failure this package has already had once, in
//    the two `mkdir` paths that produced `photos (2)` while printing `Made "photos"`.
//
// ⛔ NOTHING HERE WRITES TO A STREAM OR PICKS AN EXIT CODE. Every refusal is thrown and every
//    outcome is returned; the words a person reads are the caller's.
//
// ⚠ THE VERBS LIVE IN `drive-edit/`, ONE FILE EACH, AND THIS IS THE DOOR TO THEM. What a caller
//   imports is this name — `@needmoretruth/nmts-cli/drive-edit` — so the pieces can be split and
//   joined without a single caller changing. Nothing in the folder reaches for `node:`: the SDK's
//   browser entry bundles what this exports.

export { DriveEditError, requireNewName } from "./drive-edit/errors.ts";
export type { DriveEditCode } from "./drive-edit/errors.ts";

export { ensureFolderPath, makeFolder } from "./drive-edit/folders.ts";
export type { MadeFolder } from "./drive-edit/folders.ts";

export { moveEntries, renameEntry } from "./drive-edit/move.ts";
export type { MoveOutcome, MovedThing, RenameOutcome } from "./drive-edit/move.ts";

export { trashPaths } from "./drive-edit/trash.ts";
export type { TrashEditOptions, TrashOutcome } from "./drive-edit/trash.ts";

export { filesUnder } from "./drive-edit/tree.ts";
