/**
 * Vision-path tests for evidenceExtraction.ts.
 *
 * Uses the `_testHooks.createAnthropicClient` seam to inject a mock Anthropic
 * client without relying on module-level mocking (mock.module requires an
 * experimental flag in Node 22 LTS).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractEvidence, _testHooks } from '../src/services/evidenceExtraction.js';

const dir = mkdtempSync(join(tmpdir(), 'vrp-ev-vis-'));

function tmp(name: string, data: Buffer): string {
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
}

// 1×1 PNG fixture
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

after(() => {
  // Restore test seam after the suite
  _testHooks.createAnthropicClient = null;
  delete process.env.ANTHROPIC_API_KEY;
});

test('describeImageWithVision returns extracted text on success', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key-abc';
  _testHooks.createAnthropicClient = (_apiKey) => ({
    messages: {
      create: async (_opts: unknown) => ({
        content: [{ type: 'text', text: 'SOC 2 Type II certificate. Audit period Jan–Dec 2025.' }],
      }),
    },
  });

  const p = tmp('cert.png', PNG_1X1);
  const r = await extractEvidence(p, 'cert.png', 'image/png');

  assert.equal(r.kind, 'image');
  assert.equal(r.status, 'extracted');
  assert.ok(r.text.includes('SOC 2 Type II'), 'expected vision text in result');
  assert.ok(r.chars > 0);
  assert.ok(r.note && r.note.includes('Vision description'));

  _testHooks.createAnthropicClient = null;
  delete process.env.ANTHROPIC_API_KEY;
});

test('vision API error falls back to no_text', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key-abc';
  _testHooks.createAnthropicClient = (_apiKey) => ({
    messages: {
      create: async (_opts: unknown) => {
        throw new Error('Rate limit exceeded');
      },
    },
  });

  const p = tmp('cert2.png', PNG_1X1);
  const r = await extractEvidence(p, 'cert2.png', 'image/png');

  assert.equal(r.kind, 'image');
  assert.equal(r.status, 'no_text');

  _testHooks.createAnthropicClient = null;
  delete process.env.ANTHROPIC_API_KEY;
});
