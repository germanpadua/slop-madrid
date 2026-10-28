// tests/js-syntax.test.cjs — every shipped ES module must PARSE. Node's resolver cannot see the browser
// importmap ('three/webgpu' etc.), so resolution-only failures are fine, but a syntax error in any js/*.js
// breaks the whole live game (regression: f6abbf4 shipped an unbalanced brace to Pages).
const { test } = require('node:test');
const assert = require('node:assert');
const { readdirSync, copyFileSync, rmSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

test('all js/*.js parse as ES modules', () => {
  const dir = join(__dirname, '..', 'js');
  const bad = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const tmp = join(dir, f.replace(/\.js$/, '.syntaxcheck.mjs'));
    copyFileSync(join(dir, f), tmp);
    try {
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    } catch (e) {
      bad.push(`${f}: ${String(e.stderr).split('\n')[0]}`);
    } finally {
      rmSync(tmp, { force: true });
    }
  }
  assert.deepEqual(bad, [], `syntax errors:\n${bad.join('\n')}`);
});
