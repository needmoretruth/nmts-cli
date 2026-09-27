// The bench for uploads exactly as real S3 clients sent them, replayed over a real socket into the
// signature check and the body decoder. The captures are in `s3-body-clients-plain.test.ts` and
// `s3-body-clients-chunked.test.ts`.
//
// ⛔ WHY CAPTURES. The forms a body can take are only worth supporting as the clients actually send
//    them, and the specification leaves room a client can use differently: whether the last `\r\n`
//    is there, whether `transfer-encoding: chunked` is signed, which checksum goes in a header and
//    which in a trailer. Each captured request came off the wire from the client named, signed with
//    the throwaway pair named here, recorded by a server that answered every request and kept
//    nothing else. If the decoder stops accepting one of them, a real client stopped working.
//
// ⚠ How they were made: the AWS SDK for JavaScript v3 and rclone sent to a recording server on
//   loopback; botocore (the library under the AWS CLI v1) built each request and handed it to a
//   hook in place of the network, which is also how the "https" ones were made without a TLS
//   server -- botocore puts the checksum in a trailer only when the endpoint is https.

import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Readable } from "node:stream";

import { BodyRefusal, decodeBody } from "../src/s3/body.ts";
import { amzDateToMs, verifyAgainst } from "../src/s3/sigv4.ts";

/** Not a secret: it never opened anything, and the recording server refused nothing and kept nothing. */
export const CREDENTIAL = {
  accessKeyId: "NMTSEXAMPLEKEYID0001",
  secretAccessKey: "wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY01",
};

/** Inside the clock-skew window of every capture, all made within two minutes of each other. */
export const NOW = amzDateToMs("20260924T013400Z") ?? 0;

export const FOX = "The quick brown fox jumps over the lazy dog.\n";

export interface Capture {
  readonly name: string;
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** As sent after the HTTP layer: for `transfer-encoding: chunked`, what the chunks carried. */
  readonly body: string;
}

function collect(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => parts.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(parts)));
    stream.on("error", reject);
  });
}

/** Answers 200 with the decoded bytes, or the refusal's status with its code as the body. */
function handle(req: IncomingMessage, answer: (status: number, body: string) => void): void {
  const verdict = verifyAgainst(
    { method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers },
    [CREDENTIAL],
    NOW,
  );
  if (!verdict.ok) {
    req.resume();
    answer(403, verdict.code);
    return;
  }
  const decoded = decodeBody(req, verdict);
  if (decoded instanceof BodyRefusal) {
    req.resume();
    answer(decoded.status, decoded.code);
    return;
  }
  Promise.all([collect(decoded.stream), decoded.verified]).then(
    ([bytes]) => answer(200, bytes.toString("latin1")),
    (error: unknown) =>
      error instanceof BodyRefusal ? answer(error.status, error.code) : answer(500, String(error)),
  );
}

/** A server that answers 200 with the decoded bytes, or the refusal's status with its code. */
export interface Replayer {
  send(capture: Capture, body?: string): Promise<{ status: number; body: string }>;
  close(): Promise<void>;
}

export async function replayer(): Promise<Replayer> {
  const server: Server = createServer((req, res) => {
    handle(req, (status, body) => {
      res.writeHead(status, { "content-type": "text/plain", "content-length": String(Buffer.byteLength(body, "latin1")) });
      res.end(body, "latin1");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address: AddressInfo | string | null = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  const send = (capture: Capture, body: string = capture.body): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        { host: "127.0.0.1", port, method: capture.method, path: capture.url, headers: capture.headers },
        (res) => {
          collect(res).then((bytes) => resolve({ status: res.statusCode ?? 0, body: bytes.toString("latin1") }), reject);
        },
      );
      outgoing.on("error", reject);
      outgoing.end(Buffer.from(body, "latin1"));
    });
  const close = (): Promise<void> => new Promise<void>((resolve) => server.close(() => resolve()));
  return { send, close };
}
