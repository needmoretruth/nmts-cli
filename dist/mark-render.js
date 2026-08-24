// How the three marks a person puts on their own files are SHOWN, in one place — so `ls` and the
// commands that set them cannot end up disagreeing about what "starred" looks like.
//
// ⛔ THE MARKS LIVE ONLY IN THE SEALED FILE LIST. The server is never told that a file is starred,
//    what a label is called, or how many there are: it holds the blob and cannot open it. So
//    nothing here asks a server anything — it reads the list this account has already opened.
//
// ⛔ A SUFFIX, NOT A COLUMN. `ls` pads one width for the path and puts `[trash, …]` after the
//    size; a marks column would need a second computed width and would print an empty one on
//    every account that uses no marks, which is most of them. The table is for a person glancing
//    down it, and the field an agent parses is in `--json`, where it is always present.
/**
 * The marks on one entry — always all three.
 *
 * ⚠ ABSENT IS `false` HERE AND ABSENCE IN THE LIST, and the difference is deliberate. The format
 *   writes a mark only when it is on, because the whole list is re-sealed on every change and
 *   re-downloaded on every cold start. A reader parsing this needs the opposite: a field that is
 *   always there, so "this file is not starred" cannot be mistaken for "this output does not say".
 */
export function marksOf(entry) {
    return {
        favorite: entry.favorite === true,
        pinned: entry.pinned === true,
        labels: entry.labels ?? [],
    };
}
/**
 * What `ls` puts after a row, or an empty string when the entry wears no mark.
 *
 * ⚠ It carries its own leading spaces, exactly like the trash suffix beside it, so a row with no
 *   marks is byte-for-byte the row that was printed before marks existed.
 */
export function markSuffix(marks) {
    const parts = [];
    if (marks.favorite)
        parts.push("starred");
    if (marks.pinned)
        parts.push("pinned");
    // ⚠ QUOTED, because a label is free text somebody typed. One label called `work, home` and two
    //   labels called `work` and `home` would otherwise print as the same line.
    if (marks.labels.length > 0) {
        parts.push(`labels: ${marks.labels.map((l) => `"${l}"`).join(", ")}`);
    }
    return parts.length === 0 ? "" : `  [${parts.join(", ")}]`;
}
