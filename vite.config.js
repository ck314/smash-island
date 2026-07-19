import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Cross-plan build flag. Base build is the FULL app (__LITE__=false). Plan C's Lite build
  // config overrides this to JSON.stringify(true); src/core/build.js reads it as BUILD.lite.
  define: { __LITE__: JSON.stringify(false) },
  build: {
    outDir: 'dist',
    minify: 'terser',
    terserOptions: {
      keep_classnames: true,
      keep_fnames: true,
      // properties:false on both compress and mangle means Terser never renames a property
      // key and never rewrites/unquotes a quoted key (e.g. 'switch' -> switch) during the
      // compress pass. format.quote_keys:true then forces every object-literal key to be
      // re-emitted as a quoted string in the final output. Together they guarantee
      // reserved-word string keys ('switch', 'static') survive minification as quoted
      // string literals, byte-for-byte equivalent to source. Verified empirically against
      // terser 5.49.0: { 'switch': fn, 'static': fn } minifies to
      // { "switch": fn, "static": fn } and dispatch['switch']()/dispatch.static still
      // resolve correctly at runtime.
      compress: { keep_fargs: true, properties: false },
      mangle: { properties: false },
      format: { comments: false, quote_keys: true },
    },
  },
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js'],
    globals: false,
  },
});
