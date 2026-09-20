// The stub drive the gateway tests are driven against: one pair, one file list, one way to read it.
//
// ⚠ The file bytes are stubbed. What the account really holds and how it is decrypted is tested
//   where that code lives; in those files the question is whether the protocol in front of it is
//   right.

import { newCredential } from "../src/s3/server.ts";
import type { DriveObject } from "../src/s3/listing.ts";
import type { PlaintextSink } from "../src/download-sink.ts";
import type { ManifestEntry } from "../src/shared/lib/drive/manifest-codec.ts";

export const CREDENTIAL = newCredential();
export const CONTENT = Buffer.from("the bytes of a file that lives in the drive");

export function file(id: string, name: string, parentId: string | null, size: number): ManifestEntry {
  return {
    id,
    parentId,
    kind: 1,
    name,
    size,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_500_000,
    dekWrapped: "not-opened-in-this-test",
  };
}

export function folder(id: string, name: string, parentId: string | null): ManifestEntry {
  return { id, parentId, kind: 0, name, size: 0, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 };
}

export const ENTRIES: readonly ManifestEntry[] = [
  folder("f1", "photos", null),
  folder("f2", "2026", "f1"),
  folder("f3", "empty", null),
  file("i1", "readme.txt", null, CONTENT.length),
  file("i2", "a.jpg", "f1", 11),
  file("i3", "b.jpg", "f2", 22),
  { ...file("i4", "gone.txt", null, 5), deletedAt: 1_700_000_400_000 },
  { ...file("i5", "inside-trashed-folder.txt", "f4", 5) },
  { ...folder("f4", "thrown-away", null), deletedAt: 1_700_000_400_000 },
];

/** What `nmts s3` hands the gateway: one pair, one name, one drive. */
export const readOnly = {
  entries: async () => ENTRIES,
  fetch: async (object: DriveObject, sink: PlaintextSink) => {
    sink.expect(object.size);
    await sink.write(CONTENT.subarray(0, object.size));
    await sink.commit();
  },
};
