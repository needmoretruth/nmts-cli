// A release page the download command can really talk to: SHA256SUMS, the redirect to the release
// it belongs to, and one file per platform.
//
// ⛔ IT REDIRECTS THE WAY THE REAL ONE DOES. `…/releases/latest/download/<name>` answers 302 to
//    `…/releases/download/<tag>/<name>`, because "which release did this come from" is read out of
//    that hop. A fake that served the sums straight from the "latest" address could not fail for a
//    command that never resolves a tag at all.
//
// ⛔ AND IT HOLDS MORE THAN ONE RELEASE AT ONCE, which is the whole point. The defect worth
//    catching is a command that asks for "latest" twice: harmless while nothing changes in
//    between, and a file that does not match its sums the moment something does. A fake with one
//    release could not put anything in between.
//
// ⛔ IT ANSWERS ONLY THE TWO SHAPES THE RELEASE HAS. A fake that answered anything would only
//    prove the command agrees with the test — a tag it never resolved, or an asset name it made
//    up, would both be served, and both are defects.

import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";

export interface FakeRelease {
  readonly base: string;
  /** The tag `latest` resolves to. Setting it to an unknown tag publishes an empty release. */
  tag: string;
  /** The assets of the release `latest` currently points at. */
  readonly assets: Map<string, Uint8Array>;
  /** Serve this as SHA256SUMS instead of the one generated from the release's own bytes. */
  sums: string | null;
  /** Run after SHA256SUMS has been served — where a test publishes a release "in between". */
  afterSums: (() => void) | null;
  /** Every request the command made, in order. */
  calls: string[];
  /** Add a release under a tag of its own, leaving the others where they are. */
  publish(tag: string, assets: Map<string, Uint8Array>): void;
  reset(): void;
  close(): void;
}

/** Bytes that look like one platform's executable without being one. */
export function fakeExecutable(name: string): Uint8Array {
  return new TextEncoder().encode(`#!/bin/false\n# ${name}\n`);
}

export async function startFakeRelease(): Promise<FakeRelease> {
  const state = {
    latest: "v9.9.9",
    releases: new Map<string, Map<string, Uint8Array>>([["v9.9.9", new Map()]]),
    sums: null as string | null,
    afterSums: null as (() => void) | null,
    calls: [] as string[],
  };

  const releaseFor = (tag: string): Map<string, Uint8Array> => {
    const held = state.releases.get(tag);
    if (held !== undefined) return held;
    const made = new Map<string, Uint8Array>();
    state.releases.set(tag, made);
    return made;
  };

  const generatedSums = (assets: Map<string, Uint8Array>): string =>
    [...assets]
      .map(([name, bytes]) => `${createHash("sha256").update(bytes).digest("hex")}  ${name}`)
      .join("\n") + "\n";

  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    state.calls.push(`${req.method ?? "GET"} ${url}`);
    const notFound = (): void => {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("no such asset\n");
    };

    const latest = /^\/releases\/latest\/download\/(.+)$/.exec(url);
    if (latest !== null) {
      res.writeHead(302, { location: `/releases/download/${state.latest}/${latest[1] ?? ""}` });
      res.end();
      return;
    }
    const match = /^\/releases\/download\/([^/]+)\/(.+)$/.exec(url);
    if (match === null) return notFound();
    const [, tag, name] = match;
    if (tag === undefined || name === undefined) return notFound();
    const assets = state.releases.get(tag);
    if (assets === undefined) return notFound();
    if (name === "SHA256SUMS") {
      const body = state.sums === null ? generatedSums(assets) : state.sums;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(body);
      if (state.afterSums !== null) state.afterSums();
      return;
    }
    const bytes = assets.get(name);
    if (bytes === undefined) return notFound();
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(Buffer.from(bytes));
  });

  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");

  return {
    base: `http://127.0.0.1:${address.port}`,
    get tag() {
      return state.latest;
    },
    set tag(v: string) {
      state.latest = v;
      releaseFor(v);
    },
    get assets() {
      return releaseFor(state.latest);
    },
    get sums() {
      return state.sums;
    },
    set sums(v: string | null) {
      state.sums = v;
    },
    get afterSums() {
      return state.afterSums;
    },
    set afterSums(v: (() => void) | null) {
      state.afterSums = v;
    },
    get calls() {
      return state.calls;
    },
    publish(tag: string, assets: Map<string, Uint8Array>): void {
      state.releases.set(tag, assets);
    },
    reset(): void {
      state.latest = "v9.9.9";
      state.releases = new Map([["v9.9.9", new Map()]]);
      state.sums = null;
      state.afterSums = null;
      state.calls = [];
    },
    close(): void {
      server.close();
    },
  };
}
