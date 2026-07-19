// The single harness import path Plans B and C consume. Task 2 populates the pieces that exist
// today; Task 32 COMPLETES this barrel by adding `makeApi({lite})` and
// `runScriptedMatch({lite,seed,script})` (from boot-api.js) once the modules + src/main.js exist.
// Do not rename these exports — later tasks and plans import them from here.
export { mulberry32, seedRandom } from '../helpers/prng.js';
export { goldenParity, infinityRenderTest } from '../helpers/harness.js';

// Added in Task 32 (they depend on the extracted modules that do not exist yet):
//   export { makeApi, runScriptedMatch } from './boot-api.js';
