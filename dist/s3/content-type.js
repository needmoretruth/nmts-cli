// The `Content-Type` a GET answers, guessed from the key.
//
// ⚠ GUESSED BECAUSE IT IS NOT KEPT. The file list holds a name, a size and two times, and nothing a
//   client sent beside the bytes. A type from the extension is what a browser loading an image
//   through a presigned link, or a framework serving a stylesheet, needs to see; a file whose
//   extension is not below is `application/octet-stream`, which every client treats as bytes.
/**
 * ⛔ A MAP, NOT AN OBJECT LITERAL. Looked up in a plain object, `a.constructor` found the function
 *    every object inherits and answered it as the file's type.
 */
const BY_EXTENSION = new Map([
    ["html", "text/html; charset=utf-8"],
    ["css", "text/css; charset=utf-8"],
    ["js", "text/javascript; charset=utf-8"],
    ["mjs", "text/javascript; charset=utf-8"],
    ["json", "application/json"],
    ["txt", "text/plain; charset=utf-8"],
    ["csv", "text/csv; charset=utf-8"],
    ["xml", "application/xml"],
    ["svg", "image/svg+xml"],
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
    ["jpeg", "image/jpeg"],
    ["gif", "image/gif"],
    ["webp", "image/webp"],
    ["avif", "image/avif"],
    ["ico", "image/x-icon"],
    ["pdf", "application/pdf"],
    ["zip", "application/zip"],
    ["gz", "application/gzip"],
    ["tar", "application/x-tar"],
    ["mp4", "video/mp4"],
    ["webm", "video/webm"],
    ["mp3", "audio/mpeg"],
    ["wav", "audio/wav"],
    ["ogg", "audio/ogg"],
    ["wasm", "application/wasm"],
    ["woff", "font/woff"],
    ["woff2", "font/woff2"],
]);
export const UNKNOWN_TYPE = "application/octet-stream";
/** `photos/a.JPG` → `image/jpeg`. The extension is what follows the last dot of the last segment. */
export function contentTypeOf(key) {
    const name = key.slice(key.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    if (dot <= 0)
        return UNKNOWN_TYPE;
    return BY_EXTENSION.get(name.slice(dot + 1).toLowerCase()) ?? UNKNOWN_TYPE;
}
