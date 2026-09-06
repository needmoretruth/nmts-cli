// The zstd encoder this program hands to the file-list codec (NCF-3 §6.3.4, compression flag 0x02).
//
// ⛔ NOTHING IS IMPLEMENTED HERE. The shared codec declares the SHAPE of an encoder and a register
//    to put one in; the browser fills that register with a WebAssembly build it fetches, and this
//    file fills it with Node's own `zlib`. Writing a compressor by hand would be a second answer
//    to a solved problem, and the two halves of the product have to produce the same bytes.
//
// ⛔ THE FRAME IS BOUNDED BEFORE ANYTHING IS ALLOCATED FOR IT, twice. A zstd frame says up front
//    how many bytes it expands to; that number is read out of the header (14 bytes, no allocation)
//    and compared against the caller's bound, and the bound is then ALSO handed to `zlib` as
//    `maxOutputLength`, which refuses rather than truncating. A file list is authenticated, so a
//    frame this big cannot arrive from a stranger — but a build that met a corrupt one must not be
//    asked for a gigabyte of memory first, and a decompressor that quietly returned a SHORTER list
//    would be the one failure this format may never have.
//
// ⛔ `node:zlib` IS IMPORTED ONLY WHEN A LIST IS ACTUALLY READ OR WRITTEN. An agent runs this tool
//    in a loop, so everything loaded before the command is known is paid for thousands of times.
//    The module body below holds two closures and nothing else.
//
// ⚠ NODE 22.15.0 IS THE FLOOR. zstd landed in Node's `zlib` there (and in 23.8.0 on the odd-numbered
//   line); `package.json` states it, and a build without it simply registers nothing — the writer
//   falls back to gzip, which every reader of both format versions understands.
import { setZstdCodec, zstdContentSize } from "./shared/lib/drive/zstd.js";
let loaded = null;
async function zlib() {
    if (loaded === null)
        loaded = await import("node:zlib");
    return loaded;
}
const codec = {
    async compress(bytes, level) {
        const z = await zlib();
        return z.zstdCompressSync(bytes, {
            params: { [z.constants.ZSTD_c_compressionLevel]: level },
        });
    },
    async decompress(bytes, maxOut) {
        // Read the frame's own claim first. The codec above this one checks it too; this is the last
        // place before a buffer is sized from a number the frame supplied about itself.
        const declared = zstdContentSize(bytes);
        if (declared === null) {
            throw new Error("This part of the file list does not say how large it expands to.");
        }
        if (declared > maxOut) {
            throw new Error(`This part of the file list claims ${declared} bytes, over the ${maxOut} allowed.`);
        }
        const z = await zlib();
        return z.zstdDecompressSync(bytes, { maxOutputLength: maxOut });
    },
};
/** True once this process has handed the codec over, so the register is written once. */
let registered = false;
/**
 * Make this program able to write and read compression flag 0x02. Safe to call more than once.
 *
 * ⛔ CALLED FROM THE FILE-LIST FLOW RATHER THAN FROM THE ENTRY POINT, and that is deliberate: the
 *    package is a library and an MCP server as well as a command, and a list opened through any of
 *    those doors has to be able to expand a zstd frame the browser wrote. Putting it here also
 *    means `nmts --help` never loads it.
 */
export function registerNodeZstd() {
    if (registered)
        return;
    registered = true;
    setZstdCodec(codec);
}
/** For tests that need this process to look like a build with no encoder. */
export function forgetNodeZstd() {
    registered = false;
    setZstdCodec(null);
}
