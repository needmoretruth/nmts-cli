// The one decision that decides whether a previewed file can run code. Split out of
// FilePreview.tsx during the E-stage audit (2026-07-28) so it can be tested on every commit —
// `node --test` cannot load a `.tsx`, which is the whole reason this rule went untested for as
// long as it did.
//
// WHY IT MATTERS MORE HERE THAN IN AN ORDINARY VIEWER. A file in this drive can come from ANOTHER
// PERSON (private shares). Rendering one as a live document would run it in OUR origin, and this
// origin's IndexedDB is where "remember this device" keeps the account code. Stored XSS on an E2EE
// drive is not defacement — it is key theft, and the account code has no reset (GUIDE invariant
// #10).
//
// The rendering side of the contract, in FilePreview.tsx:
//   · image → `<img src=blob:>`      — an <img> never executes its contents, whatever the bytes are
//   · text  → textContent in `<pre>` — React escapes; NEVER innerHTML
//   · pdf   → `<iframe sandbox="">`  — no scripts, opaque origin, download fallback beside it
//   · video → `<video src=blob:>`    — a media element plays its bytes, it never executes them
//   · audio → `<audio src=blob:>`    — the same, for sound
//   · none  → not previewed at all   — the honest fallback points at the download
//
// ⭐ 2026-09-22 (C30 ①): video and audio joined so the gallery (image ∪ video) and the music place
//   (audio) can gather files by kind. Stage ① gives them no player yet — FilePreview still treats
//   both as "not previewed" until the streaming stages land.
//
// Pure: no DOM, no I/O, no state.

/** How a file may be shown. `none` means "not previewed", which is a valid and often correct answer. */
export type PreviewKind = "image" | "video" | "audio" | "text" | "pdf" | "none";

// ⚠ THE ORDER INSIDE `classify` IS THE SAFETY PROPERTY, not this table's contents.
// `svg` is present here, and only the early return below keeps it out of an
// `<img src=blob:image/svg+xml>`. Reorder those two lines — or delete the early return as
// "dead code, svg is right there in the table" — and an SVG someone else sent becomes a live
// document that can read this origin. `web/test/preview-classify.test.ts` makes that fail.
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

// ⚠ No video/audio format can carry script into a `<video>`/`<audio>` element, and none of these
// extensions is also a document format — which is what lets them sit AFTER the svg early return
// without an early return of their own.
const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
};

// HTML/SVG source files are TEXT here on purpose — shown as source, never rendered as a document.
const TEXT_EXT = new Set([
  "txt", "text", "md", "markdown", "csv", "tsv", "json", "log", "xml",
  "yaml", "yml", "ini", "conf", "toml", "js", "mjs", "ts", "css", "html", "htm", "svg",
]);

/**
 * Decide how a file named `name` may be shown, from its extension alone.
 *
 * Extension-only is deliberate: the alternative is sniffing the decrypted bytes, which means
 * deciding "is this really a PNG?" on content an attacker chose. An extension the person can see
 * in their own file list is a worse signal about the format and a much better one about intent —
 * and every branch below is safe even when the extension lies, because none of them hands the
 * bytes to a renderer that would execute them.
 *
 * Unknown ⇒ `none`. The default must be refusal, never a guess about whether a format can execute.
 */
export function classify(name: string): { kind: PreviewKind; mime: string } {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (ext === "svg") return { kind: "text", mime: "text/plain" }; // source, not a rendered SVG
  // Read through `hasOwn` so `constructor` or `__proto__` is never an extension; the second check is
  // for the command-line build, which reads every index as possibly missing.
  const image = Object.hasOwn(IMAGE_MIME, ext) ? IMAGE_MIME[ext] : undefined;
  if (image !== undefined) return { kind: "image", mime: image };
  const video = Object.hasOwn(VIDEO_MIME, ext) ? VIDEO_MIME[ext] : undefined;
  if (video !== undefined) return { kind: "video", mime: video };
  const audio = Object.hasOwn(AUDIO_MIME, ext) ? AUDIO_MIME[ext] : undefined;
  if (audio !== undefined) return { kind: "audio", mime: audio };
  if (ext === "pdf") return { kind: "pdf", mime: "application/pdf" };
  if (TEXT_EXT.has(ext)) return { kind: "text", mime: "text/plain" };
  return { kind: "none", mime: "application/octet-stream" };
}
