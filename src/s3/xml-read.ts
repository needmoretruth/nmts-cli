// The two XML documents a client sends this gateway: the keys to delete, and the parts that make a file.
//
// ⛔ A SMALL READER, WRITTEN HERE, ON PURPOSE. Both documents are a root, a list of elements and
//    the text inside them; an XML library brings entity expansion, external references and a
//    dependency to a tool whose dependency list is auditable in one screen. What this reads is
//    elements, text, the five named escapes, numeric character references, CDATA and comments.
//    What it refuses is anything that declares something — a DOCTYPE above all, which is where
//    "a billion laughs" lives.
//
// ⚠ NAMESPACES ARE TOLERATED, NOT CHECKED. `<Delete xmlns="…">` and `<s3:Key>` both read as the
//   element's local name: clients send the S3 namespace, some send none, and none send another.

import { S3Refusal } from "./answer.ts";

export interface XmlElement {
  /** The local name: whatever followed the prefix, when there was one. */
  readonly name: string;
  readonly children: readonly XmlElement[];
  /** The element's own text, entities decoded, not trimmed. */
  readonly text: string;
}

/** Deeper than this is not an S3 document. */
const MAX_DEPTH = 32;
/** Ten thousand parts of three elements each, with room to spare. */
const MAX_ELEMENTS = 100_000;

const NAME = /^[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?$/;

function malformed(why: string): S3Refusal {
  return new S3Refusal(400, "MalformedXML", `The XML you provided was not well formed: ${why}.`);
}

function localName(name: string): string {
  const at = name.indexOf(":");
  return at < 0 ? name : name.slice(at + 1);
}

/** Text between tags: line ends normalised the way XML says, references decoded. */
function decodeText(raw: string): string {
  const text = raw.replace(/\r\n?/g, "\n");
  let out = "";
  let at = 0;
  for (;;) {
    const amp = text.indexOf("&", at);
    if (amp < 0) return out + text.slice(at);
    const semi = text.indexOf(";", amp);
    if (semi < 0) throw malformed("an unfinished character reference");
    out += text.slice(at, amp) + decodeReference(text.slice(amp + 1, semi));
    at = semi + 1;
  }
}

/**
 * The five named escapes XML defines, and no others.
 *
 * ⛔ A MAP, NOT AN OBJECT LITERAL. Looked up in a plain object, `&constructor;` and `&__proto__;`
 *    found what every object inherits and decoded to a function's source and to `[object Object]`
 *    -- text a well-formed document cannot contain, arriving as a key to delete.
 */
const NAMED: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

function decodeReference(ref: string): string {
  const named = NAMED.get(ref);
  if (named !== undefined) return named;
  const hex = /^#x([0-9a-fA-F]{1,6})$/.exec(ref);
  const dec = /^#([0-9]{1,7})$/.exec(ref);
  const digits = hex?.[1] ?? dec?.[1];
  if (digits === undefined) throw malformed(`an unknown reference &${ref.slice(0, 16)};`);
  const point = Number.parseInt(digits, hex === null ? 10 : 16);
  const legal =
    point === 0x9 ||
    point === 0xa ||
    point === 0xd ||
    (point >= 0x20 && point <= 0xd7ff) ||
    (point >= 0xe000 && point <= 0xfffd) ||
    (point >= 0x10000 && point <= 0x10ffff);
  if (!legal) throw malformed("a character reference to a character XML cannot carry");
  return String.fromCodePoint(point);
}

interface Tag {
  readonly name: string;
  readonly selfClosing: boolean;
  /** Index of the closing `>`. */
  readonly end: number;
}

/** A start tag from just after its `<`: its name, whether it closes itself, and where it ends. */
function readTag(source: string, from: number): Tag {
  let at = from;
  while (at < source.length && !/[\s/>]/.test(source.charAt(at))) at += 1;
  const name = source.slice(from, at);
  if (!NAME.test(name)) throw malformed("an element with no usable name");
  for (;;) {
    while (at < source.length && /\s/.test(source.charAt(at))) at += 1;
    const c = source.charAt(at);
    if (c === ">") return { name, selfClosing: false, end: at };
    if (c === "/" && source.charAt(at + 1) === ">") return { name, selfClosing: true, end: at + 1 };
    // An attribute: a name, `=`, and a quoted value. Only skipped — nothing here reads one.
    const eq = source.indexOf("=", at);
    if (eq < 0 || !NAME.test(source.slice(at, eq).trim())) throw malformed("an attribute with no value");
    at = eq + 1;
    while (at < source.length && /\s/.test(source.charAt(at))) at += 1;
    const quote = source.charAt(at);
    if (quote !== '"' && quote !== "'") throw malformed("an attribute value without quotes");
    const close = source.indexOf(quote, at + 1);
    if (close < 0 || source.slice(at + 1, close).includes("<")) throw malformed("an unfinished attribute value");
    at = close + 1;
  }
}

interface Open {
  readonly name: string;
  readonly children: XmlElement[];
  readonly text: string[];
}

/** Hang a finished element on its parent, or make it the root. Answers the root there is now. */
function attach(stack: readonly Open[], root: XmlElement | null, element: XmlElement): XmlElement | null {
  const parent = stack[stack.length - 1];
  if (parent !== undefined) {
    parent.children.push(element);
    return root;
  }
  if (root !== null) throw malformed("more than one root element");
  return element;
}

/** Parse one document into its root element, or refuse it as `MalformedXML`. */
export function parseXml(source: string): XmlElement {
  const stack: Open[] = [];
  let root: XmlElement | null = null;
  let elements = 0;
  let at = source.charCodeAt(0) === 0xfeff ? 1 : 0;

  while (at < source.length) {
    const lt = source.indexOf("<", at);
    const textEnd = lt < 0 ? source.length : lt;
    if (textEnd > at) {
      const raw = source.slice(at, textEnd);
      const parent = stack[stack.length - 1];
      if (parent !== undefined) parent.text.push(decodeText(raw));
      else if (raw.trim() !== "") throw malformed("text outside the root element");
      at = textEnd;
      continue;
    }
    if (source.startsWith("<?", at)) {
      const end = source.indexOf("?>", at + 2);
      if (end < 0) throw malformed("an unfinished processing instruction");
      at = end + 2;
    } else if (source.startsWith("<!--", at)) {
      const end = source.indexOf("-->", at + 4);
      if (end < 0) throw malformed("an unfinished comment");
      at = end + 3;
    } else if (source.startsWith("<![CDATA[", at)) {
      const end = source.indexOf("]]>", at + 9);
      const parent = stack[stack.length - 1];
      if (end < 0 || parent === undefined) throw malformed("a CDATA section outside an element");
      parent.text.push(source.slice(at + 9, end));
      at = end + 3;
    } else if (source.startsWith("<!", at)) {
      throw malformed("a declaration, which this gateway does not read");
    } else if (source.startsWith("</", at)) {
      const end = source.indexOf(">", at + 2);
      const open = stack.pop();
      if (end < 0 || open === undefined || source.slice(at + 2, end).trim() !== open.name) {
        throw malformed("a closing tag that does not match its opening tag");
      }
      root = attach(stack, root, { name: localName(open.name), children: open.children, text: open.text.join("") });
      at = end + 1;
    } else {
      const tag = readTag(source, at + 1);
      elements += 1;
      if (elements > MAX_ELEMENTS) throw malformed(`more than ${MAX_ELEMENTS} elements`);
      if (stack.length >= MAX_DEPTH) throw malformed(`elements nested deeper than ${MAX_DEPTH}`);
      if (root !== null && stack.length === 0) throw malformed("more than one root element");
      if (tag.selfClosing) root = attach(stack, root, { name: localName(tag.name), children: [], text: "" });
      else stack.push({ name: tag.name, children: [], text: [] });
      at = tag.end + 1;
    }
  }
  if (stack.length > 0 || root === null) throw malformed("the document ended before its root element did");
  return root;
}

/** The first child with this local name. */
export function childOf(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((child) => child.name === name);
}

/** Most keys one `DeleteObjects` may name — S3's own number. */
export const MAX_DELETE_KEYS = 1000;

export interface DeleteAsk {
  readonly quiet: boolean;
  readonly objects: ReadonlyArray<{ readonly key: string; readonly versionId: string | null }>;
}

/** `<Delete><Quiet/><Object><Key/><VersionId/></Object>…</Delete>`. */
export function deleteAskOf(root: XmlElement): DeleteAsk {
  if (root.name !== "Delete") throw malformed("the root element is not Delete");
  let quiet = false;
  const objects: Array<{ key: string; versionId: string | null }> = [];
  for (const child of root.children) {
    if (child.name === "Quiet") quiet = child.text.trim().toLowerCase() === "true";
    if (child.name !== "Object") continue;
    const key = childOf(child, "Key");
    if (key === undefined || key.text === "") throw malformed("an Object with no Key");
    objects.push({ key: key.text, versionId: childOf(child, "VersionId")?.text ?? null });
  }
  if (objects.length === 0) throw malformed("no Object to delete");
  if (objects.length > MAX_DELETE_KEYS) {
    throw malformed(`${objects.length} keys, and one request may name at most ${MAX_DELETE_KEYS}`);
  }
  return { quiet, objects };
}

export interface PartChoice {
  readonly partNumber: number;
  readonly etag: string;
}

/** `<CompleteMultipartUpload><Part><PartNumber/><ETag/></Part>…</CompleteMultipartUpload>`, in the order sent. */
export function completeAskOf(root: XmlElement): readonly PartChoice[] {
  if (root.name !== "CompleteMultipartUpload") throw malformed("the root element is not CompleteMultipartUpload");
  const parts: PartChoice[] = [];
  for (const child of root.children) {
    if (child.name !== "Part") continue;
    const number = childOf(child, "PartNumber")?.text.trim() ?? "";
    const etag = childOf(child, "ETag")?.text.trim() ?? "";
    if (!/^\d{1,5}$/.test(number) || etag === "") throw malformed("a Part without a PartNumber and an ETag");
    parts.push({ partNumber: Number(number), etag });
  }
  if (parts.length === 0) throw malformed("no Part, and a file needs at least one");
  return parts;
}
