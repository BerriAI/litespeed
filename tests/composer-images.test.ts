import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('keeps inline image attachments in sync with the native terminal editor', async () => {
  const { stderr } = await promisify(execFile)(resolve('node_modules/.bin/bun'), ['test', 'tests/fixtures/composer-images.test.mjs'], { timeout: 10000 });
  expect(stderr).toContain('0 fail');
});
