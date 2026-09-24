// `nmts put <video> --thumbnail` — the picture is a second, ordinary `put` linked to the video.
// The upload itself is injected: what is tested is which puts run,
// with what, and what the one output line says.

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { putWithThumbnail } from "../src/commands/put-thumbnail.ts";
import type { PutOptions } from "../src/commands/put.ts";

interface Call {
  target: string | undefined;
  options: PutOptions;
}

/** A `put` that stores everything as `stored-<n>` and prints what the real one prints with `--json`. */
function fakePut(): { calls: Call[]; putOne: (target: string | undefined, options: PutOptions) => Promise<number> } {
  const calls: Call[] = [];
  return {
    calls,
    putOne: async (target, options) => {
      calls.push({ target, options });
      const id = `stored-${calls.length}`;
      const name = options.name ?? "clip.mp4";
      options.onStored?.(id, name);
      if (options.json === true) options.write?.(JSON.stringify({ itemId: id, name }));
      return 0;
    },
  };
}

test("a file that is not a video goes alone, and the output says why", async () => {
  const { calls, putOne } = fakePut();
  const said: string[] = [];
  assert.equal(await putWithThumbnail("notes.txt", { thumbnail: true, write: (l) => said.push(l) }, putOne), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.options.thumbnail, undefined, "the flag was passed on to the plain put");
  assert.match(said.join("\n"), /not a video/);
});

test("--thumbnail-file sends that picture as `<video>.thumb.jpg`, linked to the stored video", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nmts-thumb-test-"));
  try {
    const picture = join(dir, "cover.jpg");
    writeFileSync(picture, new Uint8Array([0xff, 0xd8, 0xff]));
    const { calls, putOne } = fakePut();
    const said: string[] = [];
    const code = await putWithThumbnail(
      "trip.mp4",
      { name: "trip (2).mp4", thumbnailFile: picture, json: true, write: (l) => said.push(l) },
      putOne,
    );
    assert.equal(code, 0);
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.target, resolve(picture));
    assert.equal(calls[1]?.options.name, "trip (2).mp4.thumb.jpg", "named after the name the video was SAVED as");
    assert.equal(calls[1]?.options.thumbOf, "stored-1");
    // One JSON line for the command: the video's, with the picture's under `thumbnail`.
    assert.equal(said.length, 1);
    const view = JSON.parse(said[0] ?? "") as { itemId: string; thumbnail: { itemId: string } };
    assert.equal(view.itemId, "stored-1");
    assert.equal(view.thumbnail.itemId, "stored-2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("without ffmpeg the video is still stored, and the output names the flag that gives the picture", async () => {
  const path = process.env["PATH"];
  const empty = mkdtempSync(join(tmpdir(), "nmts-no-ffmpeg-"));
  process.env["PATH"] = empty;
  try {
    const { calls, putOne } = fakePut();
    const said: string[] = [];
    assert.equal(await putWithThumbnail("trip.mp4", { thumbnail: true, json: true, write: (l) => said.push(l) }, putOne), 0);
    assert.equal(calls.length, 1);
    const view = JSON.parse(said[0] ?? "") as { thumbnail: { skipped: string } };
    assert.match(view.thumbnail.skipped, /--thumbnail-file/);
  } finally {
    process.env["PATH"] = path;
    rmSync(empty, { recursive: true, force: true });
  }
});
