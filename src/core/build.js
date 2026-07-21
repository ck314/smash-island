// Compile-time build flag. __LITE__ is replaced by Vite's `define` (false in the base build,
// true in Plan C's Lite build). NEVER read a global BUILD and never invent a per-module __LITE__.
export const BUILD = { lite: __LITE__ };
