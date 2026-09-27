// The three piece functions NMTS Heavy uses from `@filoz/synapse-core/piece`, named one by one.
//
// WHY A FILE OF ITS OWN. `piece-cid.ts` loads the library lazily, and a lazy `import()` of the
// library's own entry keeps EVERY export of it alive in the bundle — measured 2026-09-23 with
// esbuild: about 500 KB minified, because the entry also carries the download and URL helpers and
// what they import. Lazily importing THIS file instead lets the bundler keep only these three
// (about 27 KB minified), and the library still loads only when a part is actually hashed.
export { calculate, transformStream, tryFrom } from "@filoz/synapse-core/piece";
