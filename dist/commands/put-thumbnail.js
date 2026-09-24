// `nmts put <video> --thumbnail` — the video, then its preview picture as an ordinary file linked to
// it.
//
// THE PICTURE IS A SECOND `put`, not a new kind of upload: it is priced, sealed, paid for and listed
//   exactly like any small file, and its list entry carries the video's id (`thumbOf`) so every app
//   hides it while the video is there. `--dry-run` prices both and sends neither.
//
// WHERE THE PICTURE COMES FROM: `--thumbnail-file <picture>`, or one frame taken by `ffmpeg` if it is
//   on this machine's PATH (one second in, 512 px on the long side). Without either the video is
//   still stored, and the output says why it went alone.
//
// ⚠ ONE JSON LINE PER COMMAND, as everywhere in this tool: with `--json` both runs are captured and
//   printed as the video's object with the picture's under `thumbnail`.
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { classify } from "../shared/lib/drive/preview-classify.js";
import { BINARY_NAME } from "../product.js";
const run = promisify(execFile);
/** Long edge of the frame, px — the same picture the browser makes (spec §4). */
const FRAME_PX = 512;
export async function putWithThumbnail(target, options, putOne) {
    const say = options.write ?? ((line) => process.stdout.write(`${line}\n`));
    const name = options.name ?? basename(target ?? "");
    if (classify(name).kind !== "video") {
        say(`  ${name} is not a video, so no preview picture goes with it.`);
        return putOne(target, withoutThumbnail(options));
    }
    const captured = [];
    // A holder rather than a `let`: the callback fills it, and a narrowed `let` would read as never set.
    const got = { video: null };
    const code = await putOne(target, {
        ...withoutThumbnail(options),
        onStored: (id, savedAs) => {
            got.video = { id, name: savedAs };
        },
        ...(options.json === true ? { write: (line) => captured.push(line) } : {}),
    });
    const video = got.video;
    if (code !== 0 || (video === null && options.dryRun !== true))
        return finish(code, captured, null, options, say);
    const picture = await pictureFor(target ?? "", options);
    if ("reason" in picture)
        return finish(code, captured, { skipped: picture.reason }, options, say);
    try {
        const pictureLines = [];
        if (options.json !== true)
            say(`  with its preview picture:`);
        const pictureCode = await putOne(picture.path, {
            ...withoutThumbnail(options),
            name: `${video?.name ?? name}.thumb.jpg`,
            ...(video !== null ? { thumbOf: video.id } : {}),
            write: options.json === true ? (line) => pictureLines.push(line) : (line) => say(`  ${line}`),
        });
        const parsed = pictureLines.length > 0 ? parseLast(pictureLines) : null;
        return finish(pictureCode === 0 ? code : pictureCode, captured, parsed ?? {}, options, say);
    }
    finally {
        await picture.cleanup();
    }
}
function withoutThumbnail(options) {
    const { thumbnail: _asked, thumbnailFile: _file, ...rest } = options;
    return rest;
}
/** The video's JSON line with the picture's result folded in, or nothing more in human mode. */
function finish(code, captured, thumbnail, options, say) {
    if (options.json === true) {
        const video = parseLast(captured) ?? {};
        say(JSON.stringify({ ...video, thumbnail }));
    }
    else if (thumbnail !== null && typeof thumbnail.skipped === "string") {
        say(`  No preview picture went with it: ${thumbnail.skipped}`);
    }
    return code;
}
function parseLast(lines) {
    const last = lines.at(-1);
    if (last === undefined)
        return null;
    try {
        const value = JSON.parse(last);
        return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : null;
    }
    catch {
        return null;
    }
}
/** The picture to send, and how to tidy up after it — or why there is none. */
async function pictureFor(videoPath, options) {
    if (options.thumbnailFile !== undefined)
        return { path: resolve(options.thumbnailFile), cleanup: async () => undefined };
    const dir = await mkdtemp(join(tmpdir(), "nmts-thumb-"));
    const out = join(dir, "frame.jpg");
    const cleanup = () => rm(dir, { recursive: true, force: true });
    const scale = `scale='if(gt(iw,ih),${FRAME_PX},-2)':'if(gt(iw,ih),-2,${FRAME_PX})'`;
    // One second in first; a clip shorter than that has its first frame instead.
    for (const at of ["1", "0"]) {
        try {
            await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", at, "-i", resolve(videoPath), "-frames:v", "1", "-vf", scale, "-q:v", "5", out]);
            // ⚠ Past the end, ffmpeg exits 0 having written nothing — only a file with bytes is a frame.
            if ((await stat(out).catch(() => null))?.size)
                return { path: out, cleanup };
        }
        catch (error) {
            if (isMissing(error)) {
                await cleanup();
                return { reason: `ffmpeg is not on this machine's PATH. Give the picture yourself: ${BINARY_NAME} put <video> --thumbnail-file <picture>` };
            }
        }
    }
    await cleanup();
    return { reason: "ffmpeg could not take a frame from this file." };
}
function isMissing(error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
