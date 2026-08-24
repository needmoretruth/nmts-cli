// Where a decrypted file goes when the reader is an HTTP client rather than a disk.
//
// ⛔ THE INTEGRITY PROMISE IS DIFFERENT HERE, AND THE DIFFERENCE IS SAID OUT LOUD. Every other sink
//    in this tool makes a file visible only after the whole of it has been proved. A response
//    cannot do that: S3 clients want the body to start arriving immediately, and the status line
//    and length go out before the first byte. So bytes reach the client as they are decrypted, and
//    the check at the end can no longer withhold them.
//
// ⛔ WHAT IT DOES INSTEAD: if anything fails after the response began, the connection is DESTROYED
//    rather than ended. A client that was promised `Content-Length` bytes and gets fewer, with no
//    clean end, reports a failed transfer — which is the truth. Ending the response normally would
//    hand over a short file that every client would file away as complete.
/** A sink that writes one file into an HTTP response and never leaves a short body looking whole. */
export function responseSink(res, options) {
    let started = false;
    return {
        expect(size) {
            res.writeHead(200, { ...options.headers, "content-length": String(size) });
            started = true;
        },
        async write(bytes) {
            if (res.writableEnded || res.destroyed)
                return;
            await new Promise((resolve, reject) => {
                res.write(bytes, (error) => (error === null || error === undefined ? resolve() : reject(error)));
            });
        },
        async commit() {
            if (res.destroyed)
                return false;
            await new Promise((resolve) => res.end(resolve));
            return true;
        },
        async abandon() {
            // Nothing was written yet: the caller can still answer with a proper S3 error document.
            if (!started)
                return;
            res.destroy();
        },
    };
}
