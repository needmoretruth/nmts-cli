// `nmts support` against a local server: what is shown, what is asked, and what actually travels.
//
// ⛔ THE PREVIEW IS ASSERTED WHOLE. It is the only thing standing between a person and a message
//    they cannot recall, and a test that looked for one word in it would pass over a preview that
//    had lost the line naming what is stripped, or the byte count, or the attachment.
//
// ⛔ AND THE ATTACHMENT IS TESTED WITH REAL SECRETS PLANTED IN THE FILE. The log is redacted when
//    it is written, so a test that only wrote through `recordRun` would prove the second
//    redaction does nothing. These runs are written by hand, in the clear, exactly as a file left
//    by an older version of this tool would be — and what leaves has to be labels.

import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { after, test } from "node:test";

import { setMode } from "../src/autonomy.ts";
import { configDir } from "../src/credentials.ts";
import { NmtsError } from "../src/errors.ts";
import { VERSION } from "../src/product.ts";
import { support } from "../src/commands/support.ts";
import { runLogPath } from "../src/run-log.ts";
import { SUPPORT_SHORT } from "../src/support-copy.ts";
import { collect, startFakeDrive, withSandbox } from "./fake-drive.ts";
import { startFakeSupport } from "./fake-support.ts";

// ⚠ TWO SERVERS, AND ONLY ONE OF THEM IS TALKED TO. The drive is here for its sandbox — a config
//   directory, an account code and a key in the environment, all put back afterwards — and the
//   desk is what `nmts support` actually calls.
const drive = await startFakeDrive();
const desk = await startFakeSupport();
after(() => {
  drive.close();
  desk.close();
});

const opts = (out: { write: (line: string) => void }) => ({
  server: desk.base,
  network: "testnet",
  write: out.write,
});

/** One test's own config directory, with the desk emptied between tests. */
function inSandbox(name: string, body: () => Promise<void>): Promise<void> {
  return withSandbox(drive, name, async () => {
    desk.reset();
    await body();
  });
}

/** A refusal to say "nobody was asked" with: calling it fails the test. */
const NOBODY: (question: string) => Promise<string> = () => {
  assert.fail("the person was asked in a mode that had already answered");
};

test("a report is previewed whole, then sent", async () => {
  await inSandbox("support-send", async () => {
    const out = collect();
    assert.equal(
      await support("send", [], {
        ...opts(out),
        category: "bug",
        sub: "upload",
        message: "put failed at 90%",
        yes: true,
      }),
      0,
    );
    assert.deepEqual(out.lines, [
      ...SUPPORT_SHORT,
      "",
      "Category: bug / upload",
      "Message (17 bytes):",
      "  put failed at 90%",
      "Log: none",
      "Total: 17 bytes.",
      "",
      "Sent. NM1 — replies arrive in `nmts support show NM1`.",
    ]);
    assert.deepEqual(desk.posted[0]?.body, {
      message: "put failed at 90%",
      category: "bug",
      subcategory: "upload",
    });
  });
});

test("⛔ without --yes the person is asked, and a no sends nothing", async () => {
  await inSandbox("support-asked", async () => {
    const out = collect();
    const asked: string[] = [];
    assert.equal(
      await support("send", [], {
        ...opts(out),
        category: "idea",
        message: "a folder colour would help",
        askPerson: (question) => {
          asked.push(question);
          return Promise.resolve("n");
        },
      }),
      5,
    );
    assert.deepEqual(asked, ["Send this? [y/N] "]);
    assert.equal(out.lines.at(-1), "Nothing was sent. To go ahead:  nmts support send … --yes");
    assert.deepEqual(desk.posted, []);
  });
});

test("a yes at the question sends it", async () => {
  await inSandbox("support-yes", async () => {
    const out = collect();
    assert.equal(
      await support("send", [], {
        ...opts(out),
        category: "idea",
        message: "a folder colour would help",
        askPerson: () => Promise.resolve("y"),
      }),
      0,
    );
    assert.equal(desk.posted.length, 1);
  });
});

test("⛔ with the tier gate's --yes it proceeds after printing what it sends, without asking", async () => {
  await inSandbox("support-auto", async () => {
    setMode("auto-low", VERSION, new Date());
    try {
      const out = collect();
      assert.equal(
        await support("send", [], {
          ...opts(out),
          yes: true,
          category: "bug",
          message: "ls refused with a fork warning",
          askPerson: NOBODY,
        }),
        0,
      );
      // The preview is still in the transcript — that is what replaces the question.
      assert.deepEqual(out.lines.slice(0, 2), [...SUPPORT_SHORT]);
      assert.equal(desk.posted.length, 1);
    } finally {
      setMode("default", VERSION, new Date());
    }
  });
});

test("⛔ the attached log carries labels, whatever the file on disk holds", async () => {
  await inSandbox("support-log", async () => {
    // ⛔ NEITHER OF THESE IS THIS SANDBOX'S OWN CREDENTIAL. A planted value that matched the
    //    environment would be caught by the rule that reads `NMTS_*`, and the shape rules — the
    //    ones that have to work on a machine whose variables are unset — would go untested.
    const plantedCode = "0123456789ABCDEFGHJKMNPQRSTVWXYZ0";
    const plantedKey = `nmts_ak1_Zyxwvutsrqpo_${"q".repeat(43)}`;
    plant([
      run("ls", ["--all"], 0, [{ kind: "http", method: "GET", path: "/v1/manifest", status: 200 }]),
      run("login", [], 1, [{ kind: "error", message: `the code ${plantedCode} was refused` }]),
      run("put", ["a.txt"], 1, [
        { kind: "http", method: "POST", path: `/v1/items?key=${plantedKey}`, status: 401, error: `key ${plantedKey}` },
      ]),
    ]);

    const out = collect();
    assert.equal(
      await support("send", [], { ...opts(out), category: "bug", attachLog: "", message: "it broke", yes: true }),
      0,
    );
    const sent = desk.posted[0]?.body;
    const log = typeof sent === "object" && sent !== null ? Reflect.get(sent, "log") : undefined;
    assert.equal(typeof log, "string");
    const text = String(log);
    assert.ok(!text.includes(plantedCode), "an account code left the machine");
    assert.ok(!text.includes(plantedKey), "an API key left the machine");
    assert.ok(text.includes("[account-code]"), `the code was not labelled: ${text}`);
    assert.ok(text.includes("[api-key]"), `the key was not labelled: ${text}`);
    // The transcript shape: the newest run last, and the addresses and statuses kept.
    assert.ok(text.includes("$ nmts ls --all"));
    assert.ok(text.includes("POST /v1/items?key=[api-key] → 401"));
  });
});

test("--attach-log takes a count, and refuses one past the ceiling", async () => {
  await inSandbox("support-log-count", async () => {
    plant([run("ls", ["one"], 0, []), run("ls", ["two"], 0, []), run("ls", ["three"], 0, [])]);
    const out = collect();
    await support("send", [], { ...opts(out), category: "bug", attachLog: "1", message: "x", yes: true });
    const log = String(Reflect.get(Object(desk.posted[0]?.body), "log"));
    assert.ok(log.includes("$ nmts ls three"), log);
    assert.ok(!log.includes("$ nmts ls one"), log);

    await assert.rejects(
      support("send", [], { ...opts(collect()), category: "bug", attachLog: "21", message: "x", yes: true }),
      (error: unknown) => error instanceof NmtsError && error.exitCode === 2,
    );
  });
});

test("--omit replaces what the caller named, in the message and in the log", async () => {
  await inSandbox("support-omit", async () => {
    plant([run("put", ["clients/acme/invoice.pdf"], 1, [])]);
    const out = collect();
    await support("send", [], {
      ...opts(out),
      category: "bug",
      message: "clients/acme/invoice.pdf would not upload",
      attachLog: "",
      omit: ["acme"],
      yes: true,
    });
    const body = Object(desk.posted[0]?.body);
    assert.equal(String(Reflect.get(body, "message")), "clients/[omitted]/invoice.pdf would not upload");
    assert.ok(String(Reflect.get(body, "log")).includes("clients/[omitted]/invoice.pdf"));
  });
});

test("--omit refuses a value too short to name one thing", async () => {
  await inSandbox("support-omit-short", async () => {
    await assert.rejects(
      support("send", [], { ...opts(collect()), category: "bug", message: "x", omit: ["ac"], yes: true }),
      (error: unknown) => error instanceof NmtsError && error.exitCode === 2,
    );
  });
});

test("⛔ a category this version does not know is refused here, with the list", async () => {
  await inSandbox("support-category", async () => {
    await assert.rejects(
      support("send", [], { ...opts(collect()), category: "board", message: "x", yes: true }),
      (error: unknown) =>
        error instanceof NmtsError &&
        error.message === "There is no support category called board." &&
        error.nextStep === "The categories are bug · idea · account · storage · payment · privacy.",
    );
    assert.deepEqual(desk.posted, [], "a bad category still reached the server");
  });
});

test("a subcategory that does not belong to its category is refused, and none is always allowed", async () => {
  await inSandbox("support-sub", async () => {
    await assert.rejects(
      support("send", [], { ...opts(collect()), category: "bug", sub: "mydata", message: "x", yes: true }),
      (error: unknown) => error instanceof NmtsError && error.exitCode === 2,
    );
    assert.equal(
      await support("send", [], { ...opts(collect()), category: "bug", message: "x", yes: true }),
      0,
    );
  });
});

test("⛔ a 429 says how long to wait, taken from the header the server puts it in", async () => {
  await inSandbox("support-429", async () => {
    desk.refuse = { status: 429, code: "RATE_LIMITED", message: "too many", retryAfter: 42 };
    await assert.rejects(
      support("send", [], { ...opts(collect()), category: "bug", message: "x", yes: true }),
      (error: unknown) =>
        error instanceof NmtsError &&
        error.message === "NMTS is asking you to wait 42 seconds before another message.",
    );
  });
});

test("a 409 keeps the server's own sentence", async () => {
  await inSandbox("support-409", async () => {
    desk.refuse = {
      status: 409,
      code: "SUPPORT_DUPLICATE",
      message: "The same message was sent in the last 24 hours.",
    };
    await assert.rejects(
      support("send", [], { ...opts(collect()), category: "bug", message: "x", yes: true }),
      (error: unknown) =>
        error instanceof NmtsError && error.message === "The same message was sent in the last 24 hours.",
    );
  });
});

test("a validation refusal is a command-line error, and only a category one lists the categories", async () => {
  await inSandbox("support-400", async () => {
    desk.refuse = { status: 400, code: "VALIDATION", message: "category: unknown" };
    await assert.rejects(
      support("send", [], { ...opts(collect()), category: "bug", message: "x", yes: true }),
      (error: unknown) =>
        error instanceof NmtsError &&
        error.exitCode === 2 &&
        error.message === "category: unknown" &&
        error.nextStep === "The categories are bug · idea · account · storage · payment · privacy.",
    );

    desk.refuse = { status: 400, code: "VALIDATION", message: "message: too long" };
    await assert.rejects(
      support("send", [], { ...opts(collect()), category: "bug", message: "x", yes: true }),
      (error: unknown) =>
        error instanceof NmtsError && error.exitCode === 2 && error.nextStep === null,
    );
  });
});

test("a report this rail did not file is a 404 pointing back at the list", async () => {
  await inSandbox("support-404", async () => {
    await assert.rejects(
      support("show", ["00000000-0000-4000-8000-000000000009"], opts(collect())),
      (error: unknown) =>
        error instanceof NmtsError &&
        error.exitCode === 4 &&
        error.nextStep === "`nmts support list` prints the reports filed from the command line.",
    );
  });
});

test("the list prints a row each, and the thread reads oldest first", async () => {
  await inSandbox("support-list", async () => {
    await support("send", [], { ...opts(collect()), category: "bug", message: "one", yes: true });
    const filed = desk.tickets[0];
    assert.ok(filed !== undefined);
    filed.status = "answered";
    filed.messages.push({
      id: "m1",
      from_operator: true,
      kind: 0,
      body: "Fixed in the next release.",
      created_at: "2026-09-04T11:30:00Z",
    });
    desk.unread = 1;

    const list = collect();
    assert.equal(await support("list", [], opts(list)), 0);
    assert.deepEqual(list.lines, [
      "NM1          bug                answered   2026-09-04   new",
      "",
      "1 unread.",
    ]);

    const shown = collect();
    assert.equal(await support("show", ["NM1"], opts(shown)), 0);
    assert.deepEqual(shown.lines, [
      "NM1  bug  answered  2026-09-04T11:00:00Z",
      "",
      "you  2026-09-04T11:00:00Z",
      "  one",
      "",
      "NMTS  2026-09-04T11:30:00Z",
      "  Fixed in the next release.",
      "",
    ]);
  });
});

test("a reply goes into the thread, and an unknown code is refused before it is written", async () => {
  await inSandbox("support-reply", async () => {
    await support("send", [], { ...opts(collect()), category: "bug", message: "one", yes: true });
    const out = collect();
    assert.equal(
      await support("reply", ["NM1"], { ...opts(out), message: "it happens on 0.20.0 too", yes: true }),
      0,
    );
    assert.equal(out.lines.at(-1), "Sent.");
    assert.deepEqual(desk.tickets[0]?.messages.map((m) => m.body), ["it happens on 0.20.0 too"]);
    // ⛔ The field on the wire is `body`. A reply posted as `message` would be stored empty.
    assert.deepEqual(desk.posted.at(-1)?.body, { body: "it happens on 0.20.0 too" });

    await assert.rejects(
      support("reply", ["NOPE"], { ...opts(collect()), message: "hello", yes: true }),
      (error: unknown) => error instanceof NmtsError && error.exitCode === 4,
    );
  });
});

test("an action this command does not have is a command-line error, not a request", async () => {
  await inSandbox("support-action", async () => {
    await assert.rejects(
      support("delete", [], opts(collect())),
      (error: unknown) => error instanceof NmtsError && error.exitCode === 2,
    );
  });
});

// ── Planting a log ─────────────────────────────────────────────────────────────────────────────

interface PlantedEvent {
  kind: "http" | "error";
  method?: string;
  path?: string;
  status?: number;
  error?: string;
  message?: string;
}

function run(cmd: string, args: string[], exit: number, events: PlantedEvent[]): unknown {
  return { t: "2026-09-04T10:00:00.000Z", v: VERSION, cmd, args, exit, ms: 10, events };
}

/** Write the log by hand, in the clear. See the header for why it is not written through the tool. */
function plant(runs: unknown[]): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(runLogPath(), `${runs.map((r) => JSON.stringify(r)).join("\n")}\n`);
}
