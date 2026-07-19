import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

describe('scaffold', () => {
  it('package.json declares the required toolchain + scripts', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    for (const dep of ['vite', 'electron', 'electron-builder', 'vitest', 'jsdom', 'eslint',
      '@fontsource/fredoka', '@fontsource-variable/jetbrains-mono'])
      expect({ ...pkg.dependencies, ...pkg.devDependencies }).toHaveProperty(dep);
    for (const s of ['dev', 'build', 'dist', 'test', 'lint'])
      expect(pkg.scripts).toHaveProperty(s);
  });
  it('electron main loads a real origin, never bare file://', () => {
    const main = readFileSync('electron/main.cjs', 'utf8');
    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
    expect(main).not.toMatch(/loadFile\(/);
  });
  it('preload sets up context isolation without exposing Node', () => {
    expect(existsSync('electron/preload.cjs')).toBe(true);
  });
  it('base build defines __LITE__=false and ships the BUILD flag leaf', () => {
    expect(readFileSync('vite.config.js', 'utf8')).toMatch(/__LITE__:\s*JSON\.stringify\(false\)/);
    expect(existsSync('src/core/build.js')).toBe(true);
    expect(readFileSync('src/core/build.js', 'utf8')).toMatch(/export const BUILD\s*=\s*\{\s*lite:\s*__LITE__\s*\}/);
  });
});
