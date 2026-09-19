// Where a downloaded file's plaintext goes WHILE it is still being produced.
//
// ⛔ THE PROMISE THAT WAS KEPT BY BUFFERING IS NOW KEPT HERE. Until now `download.ts` held every
//    decrypted byte, checked the whole-file digest the account had sealed, and only then handed a
//    finished array to a caller that wrote it out. That is why a half-right file never appeared
//    under a real name. It also meant a file that could be uploaded — uploads go part by part and
//    are bounded by one part — could not be brought back on a machine smaller than the file.
//    Streaming moves bytes before the last chunk is checked, so the promise has to be kept by the
//    DESTINATION instead: a file lands under a temporary name and is renamed into place only after
//    the digest matches, and a failure takes the temporary file with it.
//
// ⛔ A SINK MUST NOT KEEP THE ARRAY IT IS HANDED. The caller zeroes each run of plaintext as soon
//    as `write` resolves, so a sink that stored the reference would hold a buffer full of zeroes
//    and write them out. Copy, or finish with the bytes before resolving.
//
// ⛔ ONLY THE SHAPE IS HERE. The two destinations this tool ships — a file on a disk, and whatever
//    is reading its stdout — are both Node's, and they live in `download-sink-node.ts`. What is
//    left is the contract, which is what a caller in a browser implements to hand a download to a
//    `Blob`, an element or a stream of its own.
export {};
