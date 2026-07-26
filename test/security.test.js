import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHttpsUrl, readBoundedText } from '../dist/security.js';

test('allows only HTTPS URLs on an explicit host allowlist', () => {
  assert.equal(validateHttpsUrl('https://example.org/path', ['example.org']).hostname, 'example.org');
  for (const url of ['http://example.org/path', 'https://evil.test/path', 'https://user:pass@example.org/path']) assert.throws(() => validateHttpsUrl(url, ['example.org']));
});

test('caps streamed response bodies without trusting content-length', async () => {
  const response = new Response(new Blob(['12345']));
  await assert.rejects(readBoundedText(response, 4), /exceeds 4 bytes/);
});
