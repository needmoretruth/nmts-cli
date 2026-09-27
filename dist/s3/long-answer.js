// An answer that can take longer than a client waits for its first byte: `CompleteMultipartUpload`
// and `CopyObject`, which seal a whole file and send it to the storage network before they can say
// how that went.
//
// ⛔ A STORE THAT OUTLASTS ONE KEEP-ALIVE INTERVAL IS ANSWERED 200 AT ONCE, AND WHAT IT COMES TO GOES
//    IN THE BODY. That is what S3 does for these two operations, and S3 clients read it: botocore
//    gives up on a connection that sends nothing for 60 seconds and sends the request again, and a
//    large file takes longer than that to store. A space every `KEEP_ALIVE_MS` keeps the connection
//    from going quiet; XML allows white space between the declaration and the root element.
//
// ⛔ ONE THAT ENDS INSIDE THE INTERVAL KEEPS ITS OWN STATUS. The caller does all of its checking
//    first and calls `accepted()` when what is left is the store itself -- but a store can still be
//    refused in its first moments: the key holds another file, the account cannot pay, the account
//    refuses the credential. An `Error` inside a 200 is what the AWS SDK for JavaScript v3 turns
//    into a 503 and botocore into a 500, and both then send the request again, for a refusal no
//    retry changes. So `accepted()` only arms a timer: the 200 begins when the timer fires, and a
//    store that has settled by then is answered as any other operation is, with its own status.
//
// ⚠ NOTHING FOLLOWS `</Error>`. The AWS SDK for JavaScript v3 decides that a 200 failed by whether
//   the last bytes of the body end in `</Error>`; one newline after it and that SDK reports the
//   failure as a success.
import { randomBytes } from "node:crypto";
import { answerFor, noteFailure, sendXml } from "./answer.js";
import { errorXml, HEAD } from "./xml.js";
/** How often a space is written while the store runs: well inside the 60 seconds botocore waits. */
export const KEEP_ALIVE_MS = 10_000;
/** A document without its XML declaration, which went out when the answer began. */
function rootOf(xml) {
    return xml.startsWith(HEAD) ? xml.slice(HEAD.length) : xml;
}
/**
 * The request id this answer names, in its header and in an `Error` document's `RequestId`.
 *
 * ⚠ ONE ALREADY ON THE RESPONSE IS KEPT. A server in front of the gateway that names every request
 *   in its own log sets it before the gateway runs; a second id here would be one that log has
 *   never heard of.
 */
function requestIdOf(call) {
    const already = call.res.getHeader("x-amz-request-id");
    return typeof already === "string" && already.length > 0 ? already : randomBytes(8).toString("hex").toUpperCase();
}
/**
 * Run `work` and answer with the XML it resolves to -- or, when `work` has called `accepted` and is
 * still running one keep-alive interval later, begin the 200 then and keep the client hearing
 * something while the rest runs.
 *
 * A `work` that settles before that is answered as though it had never called `accepted`: its
 * result with 200, its throw with its own status.
 */
export async function answerAfter(call, work) {
    const { res } = call;
    const requestId = requestIdOf(call);
    const every = call.options.keepAliveMs ?? KEEP_ALIVE_MS;
    let asked = false;
    let began = false;
    let armed = null;
    let beat = null;
    const stop = () => {
        if (armed !== null)
            clearTimeout(armed);
        if (beat !== null)
            clearInterval(beat);
        armed = null;
        beat = null;
    };
    const begin = () => {
        armed = null;
        if (res.headersSent || res.destroyed || res.writableEnded)
            return;
        began = true;
        res.writeHead(200, { "content-type": "application/xml", "x-amz-request-id": requestId });
        res.write(HEAD);
        beat = setInterval(() => {
            if (!res.destroyed && !res.writableEnded)
                res.write(" ");
        }, every);
    };
    const accepted = () => {
        if (asked)
            return;
        asked = true;
        armed = setTimeout(begin, every);
        // A client that hung up hears nothing more; the store goes on, and its retry finds the result.
        res.once("close", stop);
    };
    let xml;
    try {
        xml = await work(accepted);
    }
    catch (error) {
        stop();
        if (!began)
            throw error;
        const answer = answerFor(error);
        noteFailure(res, answer, call.resource);
        res.end(rootOf(errorXml(answer.code, answer.message, call.resource, requestId)));
        return;
    }
    stop();
    if (began)
        res.end(rootOf(xml));
    else
        sendXml(res, 200, xml, { "x-amz-request-id": requestId });
}
