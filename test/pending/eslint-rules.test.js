import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

async function lintText(code) {
  const eslint = new ESLint({ overrideConfigFile: 'eslint.config.js' });
  const [res] = await eslint.lintText(code, { filePath: 'src/probe.js' });
  return res.messages.map((m) => (m.ruleId || '') + ':' + m.message);
}

describe('eslint state-safety rules', () => {
  it('flags reassignment of an imported binding', async () => {
    const msgs = await lintText(`import { running } from './core/state.js';\nrunning = true;\n`);
    expect(msgs.join('|')).toMatch(/no-import-assign/);
  });
  it('flags destructuring of an arithmetic state scalar', async () => {
    const msgs = await lintText(`import { rt } from './core/state.js';\nconst { hazardT } = rt;\nconsole.log(hazardT);\n`);
    expect(msgs.join('|')).toMatch(/no-restricted-syntax|state scalar/);
  });
  it('accepts rt.hazardT++ and setter calls', async () => {
    const msgs = await lintText(`import { rt, setRunning } from './core/state.js';\nrt.hazardT++;\nsetRunning(true);\n`);
    expect(msgs.join('|')).not.toMatch(/no-import-assign|state scalar/);
  });
});
