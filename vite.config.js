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
      compress: { keep_fargs: true },
      mangle: { properties: false },
      format: { comments: false },
      // reserved-word string keys ('switch','static') must survive
    },
  },
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js'],
    globals: false,
  },
});
