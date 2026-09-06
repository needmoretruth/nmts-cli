// The three document routes the site serves, as the site serves them — split out of
// `fake-drive.ts`, which `check:size` measures.
//
// ⛔ IT ANSWERS ONLY THE ADDRESSES THAT EXIST, and it sends the headers that carry the answer's
//    meaning: `Content-Disposition` is where the file name comes from, and a fake that omitted it
//    could not fail for a tool that invented one. The 404 for an unknown notice has an EMPTY body,
//    exactly as `web/src/app/api/notices/[id]/route.ts` does — a fake that answered a JSON refusal
//    there would let a tool pass that only reads refusals it can parse.

import type { ServerResponse } from "node:http";

/** What `GET /api/notices` answers with, in the feed's own shape. */
export const NOTICE_ROWS = [
  {
    id: "terms-v12",
    date: "2026-09-03",
    kind: "terms",
    bannerUntil: "2026-09-10",
    title: { en: "New Terms of Service take effect on 10 September", ko: "KO: new terms" },
  },
  {
    id: "maintenance-0901",
    date: "2026-09-01",
    kind: "interruption",
    bannerUntil: null,
    title: { en: "Uploads paused for one hour", ko: "KO: uploads paused" },
  },
] as const;

/** The body of one notice, keyed by id, and the name the server gives that body. */
export const NOTICE_TEXT: Record<string, { text: string; filename: string }> = {
  "terms-v12": {
    text: "NMTS notice 2026-09-03\n\nNew Terms of Service take effect on 10 September.\n",
    filename: "nmts-notice-2026-09-03-terms-v12.txt",
  },
  "maintenance-0901": {
    text: "NMTS notice 2026-09-01\n\nUploads paused for one hour.\n",
    filename: "nmts-notice-2026-09-01-maintenance-0901.txt",
  },
};

/** The three legal documents, in both languages, with the versioned names the route gives them. */
export const LEGAL_TEXT: Record<string, Record<string, { text: string; filename: string }>> = {
  terms: {
    en: { text: "# NMTS Terms of Service\n\nVersion 12. Effective 2026-09-10.\n", filename: "nmts-terms-12.en.md" },
    ko: { text: "# NMTS Terms of Service (Korean edition)\n\nVersion 12.\n", filename: "nmts-terms-12.ko.md" },
  },
  privacy: {
    en: { text: "# NMTS Privacy Policy\n\nVersion 11. Effective 2026-09-10.\n", filename: "nmts-privacy-11.en.md" },
    ko: { text: "# NMTS Privacy Policy (Korean edition)\n\nVersion 11.\n", filename: "nmts-privacy-11.ko.md" },
  },
  "board-terms": {
    en: { text: "# NMTS Board Terms\n\nVersion 4.\n", filename: "nmts-board-terms-4.en.md" },
    ko: { text: "# NMTS Board Terms (Korean edition)\n\nVersion 4.\n", filename: "nmts-board-terms-4.ko.md" },
  },
};

/**
 * Answer one of the document addresses, or say this was not one of them.
 *
 * Returns true when it answered, so the caller can go on to its own routes.
 */
export function serveDocuments(method: string, url: string, res: ServerResponse): boolean {
  if (method !== "GET" || !url.startsWith("/api/")) return false;
  const { pathname, searchParams } = new URL(url, "http://x");

  if (pathname === "/api/notices") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ notices: NOTICE_ROWS }));
    return true;
  }
  if (pathname.startsWith("/api/notices/")) {
    const id = decodeURIComponent(pathname.slice("/api/notices/".length));
    const found = NOTICE_TEXT[id];
    if (found === undefined) {
      // ⛔ EMPTY, exactly as the route answers it. There is no code to read here, which is why the
      //    tool reads the status.
      res.writeHead(404);
      res.end();
      return true;
    }
    sendText(res, "text/plain; charset=utf-8", found.filename, found.text);
    return true;
  }
  if (pathname.startsWith("/api/legal/")) {
    const id = decodeURIComponent(pathname.slice("/api/legal/".length));
    const document = LEGAL_TEXT[id];
    if (document === undefined) {
      res.writeHead(404);
      res.end();
      return true;
    }
    // The route reads anything that is not `ko` as English, and so does this.
    const found = document[searchParams.get("lang") === "ko" ? "ko" : "en"];
    if (found === undefined) throw new Error("the fixture is missing a language");
    sendText(res, "text/markdown; charset=utf-8", found.filename, found.text);
    return true;
  }
  return false;
}

function sendText(res: ServerResponse, type: string, filename: string, text: string): void {
  res.writeHead(200, {
    "content-type": type,
    "content-disposition": `inline; filename="${filename}"`,
    "cache-control": "no-store",
  });
  res.end(text);
}
