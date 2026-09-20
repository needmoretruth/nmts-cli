// Making a folder, and every folder above it that is missing.
import { KIND_FOLDER, normaliseName, normalisePath } from "../drive-paths.js";
import { NmtsError } from "../errors.js";
import { applyToList } from "../manifest-write.js";
import { DriveEditError } from "./errors.js";
/**
 * Make a folder path, and every folder above it that is missing, for an account already opened.
 *
 * ⛔ THE RULES BELOW ARE THE ONES A SECOND COPY WOULD GET SUBTLY WRONG: a folder that is already
 *    there IS the folder asked for (never a numbered one), the decision is taken inside each
 *    attempt so a lost race cannot make two, and what was made before a failure is named rather
 *    than silently kept.
 *
 * ⚠ MISSING PARENTS ARE CREATED, and that is a decision rather than a convenience. A folder costs
 *   nothing, holds nothing and can be moved to the trash, so the failure mode of creating one too
 *   many is a tidy-up; the failure mode of refusing is a caller that has to discover the tree one
 *   call at a time. Every folder made is named in the result, so it is never a surprise.
 */
export async function ensureFolderPath(input, wanted) {
    const made = [];
    let parentId = null;
    let walked = "";
    for (const name of wanted.split("/")) {
        // ⚠ A name that is only spaces is refused too. `mkdir` used to accept it, and then `rm` and
        //   `restore` rejected the very path `ls` printed for it as "no path given" — a code-2 message
        //   blaming the caller for an argument they had supplied (2026-08-23).
        if (name.trim() === "" || name === "." || name === "..") {
            throw new DriveEditError("BAD_NAME", `"${wanted}" is not a folder path this tool will make.`, {
                exitCode: 2,
                nextStep: `Empty names, "." and ".." are not folder names in a drive. Nothing was made.`,
            });
        }
        walked = walked === "" ? name : `${walked}/${name}`;
        const under = parentId;
        const here = walked;
        // The global one, not `node:crypto`: the SDK's browser entry bundles this file.
        const fresh = globalThis.crypto.randomUUID();
        let landedOn = fresh;
        // ⛔ ONE WRITE PER FOLDER, and the check that decides whether to write happens INSIDE the
        //    attempt. Two things went wrong when it sat outside (2026-08-23):
        //      · running `mkdir` twice at the same moment made `shared` AND `shared (2)`, because the
        //        loser of the compare-and-swap re-applied a decision taken against the older list;
        //      · a trashed folder of the same name made the second `mkdir` produce `photos (2)` while
        //        printing `Made "photos"`, because it went through the upload helper — and picking a
        //        free name is the right rule for BYTES and the wrong rule for a folder. A folder with
        //        that name in that parent IS the folder that was asked for.
        //    Building the whole chain in memory and writing once would be fewer round trips and would
        //    also mean a lost compare-and-swap threw away folders the ones below already point at.
        const result = await applyToList(input, (entries) => {
            const there = entries.find((e) => e.parentId === under &&
                normaliseName(e.name) === normaliseName(name) &&
                e.deletedAt === undefined);
            if (there !== undefined) {
                if (there.kind !== KIND_FOLDER) {
                    throw new DriveEditError("NAME_TAKEN", `"${here}" is a file, so nothing can be made inside it.`, {
                        exitCode: 4,
                        nextStep: made.length > 0 ? `The folders made so far are kept: ${made.join(", ")}.` : "Nothing was made.",
                    });
                }
                landedOn = there.id;
                return null;
            }
            landedOn = fresh;
            const at = Date.now();
            return {
                op: "add",
                entry: { id: fresh, parentId: under, kind: KIND_FOLDER, name, size: 0, createdAt: at, updatedAt: at },
            };
        }).catch((error) => {
            // ⛔ WHAT SURVIVED IS NAMED. A run that stops half way leaves real folders behind, and the
            //    message that says so was attached only to the "that is a file" refusal.
            if (error instanceof NmtsError || made.length === 0)
                throw error;
            const because = error instanceof Error ? error.message : "the server refused";
            throw new NmtsError(because, {
                exitCode: 1,
                nextStep: `The folders made so far are kept: ${made.join(", ")}. Running the same command again ` +
                    `makes the rest — nothing is lost.`,
            });
        });
        if (result.changed)
            made.push(here);
        parentId = landedOn;
    }
    return { parentId, made };
}
/** Make one folder path. A path that is already there is a success with nothing made. */
export async function makeFolder(input, path) {
    const wanted = normalisePath(path);
    if (wanted === "") {
        throw new DriveEditError("BAD_NAME", `"${path}" names the whole drive, not a folder in it.`, {
            exitCode: 2,
            nextStep: "Nothing was made.",
        });
    }
    const { parentId, made } = await ensureFolderPath(input, wanted);
    return { path: wanted, parentId, made };
}
