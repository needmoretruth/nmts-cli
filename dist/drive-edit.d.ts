export { DriveEditError, requireNewName } from "./drive-edit/errors.ts";
export type { DriveEditCode } from "./drive-edit/errors.ts";
export { ensureFolderPath, makeFolder } from "./drive-edit/folders.ts";
export type { MadeFolder } from "./drive-edit/folders.ts";
export { moveEntries, renameEntry } from "./drive-edit/move.ts";
export type { MoveOutcome, MovedThing, RenameOutcome } from "./drive-edit/move.ts";
export { trashPaths } from "./drive-edit/trash.ts";
export type { TrashEditOptions, TrashOutcome } from "./drive-edit/trash.ts";
export { filesUnder } from "./drive-edit/tree.ts";
