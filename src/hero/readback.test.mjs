import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildAssertions, parseVerdicts, readBack, counterClauses, defaultVision } from './readback.mjs';

const GATE = ["every person's eyes are open", 'exactly 2 panels'];
const STRINGS = [{ text: 'TWO BEATS', placement: 'title-bar' }, { text: 'open', placement: 'panel-1-label' }, { text: 'fill', placement: 'panel-2-label' }];

test('buildAssertions lists every gate line, then one spelling assertion per declared string, quoting it verbatim', () => {
  const a = buildAssertions(GATE, STRINGS);
  assert.equal(a.length, 5);
  assert.deepEqual(a.slice(0, 2), GATE);
  assert.match(a[2], /title bar[\s\S]*"TWO BEATS"/);
  assert.match(a[3], /panel 1[\s\S]*"open"/);
  assert.match(a[4], /panel 2[\s\S]*"fill"/);
});

test('parseVerdicts takes the JSON the vision call returns and maps every index back to its assertion, in order', () => {
  const assertions = ['a', 'b', 'c'];
  const text = JSON.stringify({ verdicts: [
    { index: 2, verdict: 'DEFECT', note: 'the label reads "opne"' },
    { index: 1, verdict: 'PASS', note: 'eyes open' },
    { index: 3, verdict: 'PASS', note: '' },
  ] });
  assert.deepEqual(parseVerdicts(text, assertions), [
    { assertion: 'a', verdict: 'PASS', note: 'eyes open' },
    { assertion: 'b', verdict: 'DEFECT', note: 'the label reads "opne"' },
    { assertion: 'c', verdict: 'PASS', note: '' },
  ]);
});

test('parseVerdicts is strict: not JSON, a missing index, a duplicate, an unknown verdict, or an extra index all throw', () => {
  const assertions = ['a', 'b'];
  const wrap = (v) => JSON.stringify({ verdicts: v });
  assert.throws(() => parseVerdicts('PASS PASS', assertions), /readback/i);
  assert.throws(() => parseVerdicts(wrap([{ index: 1, verdict: 'PASS', note: '' }]), assertions), /2/);
  assert.throws(() => parseVerdicts(wrap([{ index: 1, verdict: 'PASS', note: '' }, { index: 1, verdict: 'PASS', note: '' }]), assertions), /twice|duplicate/i);
  assert.throws(() => parseVerdicts(wrap([{ index: 1, verdict: 'MAYBE', note: '' }, { index: 2, verdict: 'PASS', note: '' }]), assertions), /MAYBE/);
  assert.throws(() => parseVerdicts(wrap([{ index: 1, verdict: 'PASS', note: '' }, { index: 2, verdict: 'PASS', note: '' }, { index: 3, verdict: 'PASS', note: '' }]), assertions), /3/);
});

test('readBack hands the png and the numbered assertions to the injected vision function and returns the parsed verdicts', async () => {
  const png = join(mkdtempSync(join(tmpdir(), 'rb-')), 'r.png');
  writeFileSync(png, 'png');
  let seen;
  const vision = async ({ png: p, questions }) => {
    seen = { p, questions };
    return JSON.stringify({ verdicts: questions.map((_, i) => ({ index: i + 1, verdict: i === 3 ? 'DEFECT' : 'PASS', note: i === 3 ? 'reads "opne"' : 'ok' })) });
  };
  const verdicts = await readBack(png, GATE, STRINGS, { vision });
  assert.equal(seen.p, png);
  assert.equal(seen.questions.length, 5);
  assert.match(seen.questions[0], /^1\. every person/);
  assert.deepEqual(verdicts.map((v) => v.verdict), ['PASS', 'PASS', 'PASS', 'DEFECT', 'PASS']);
  assert.equal(verdicts[3].note, 'reads "opne"');
  assert.match(verdicts[3].assertion, /"open"/);
});

test('readBack refuses a png that is not on disk before spending a call', async () => {
  let called = false;
  await assert.rejects(readBack('/nowhere/r.png', GATE, STRINGS, { vision: async () => { called = true; return ''; } }), /nowhere/);
  assert.equal(called, false);
});

test('counterClauses turns the DEFECT notes into one correction block the next prompt appends, and is empty with no defects', () => {
  const verdicts = [
    { assertion: 'eyes open', verdict: 'PASS', note: '' },
    { assertion: 'the label on panel 1 reads exactly "open"', verdict: 'DEFECT', note: 'it reads "opne"' },
    { assertion: 'exactly 2 panels', verdict: 'DEFECT', note: 'three panels drawn' },
  ];
  const block = counterClauses(verdicts);
  assert.match(block, /^CORRECTIONS/);
  assert.match(block, /reads exactly "open"[\s\S]*it reads "opne"/);
  assert.match(block, /exactly 2 panels[\s\S]*three panels drawn/);
  assert.doesNotMatch(block, /eyes open/);
  assert.equal(counterClauses(verdicts.filter((v) => v.verdict === 'PASS')), '');
});

test('defaultVision posts the png as a data URL with the numbered questions under a strict json_schema format, and returns the output_text', async () => {
  const png = join(mkdtempSync(join(tmpdir(), 'rb-')), 'r.png');
  writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => ({ status: 'completed', output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: '{"verdicts":[{"index":1,"verdict":"PASS","note":"ok"}]}' }] },
    ] }) };
  };
  const text = await defaultVision({ png, questions: ['1. eyes open'], env: { OPENAI_API_KEY: 'sk-test-key', WIKI_HERO_VISION_MODEL: 'vision-x' }, fetchImpl });
  assert.equal(text, '{"verdicts":[{"index":1,"verdict":"PASS","note":"ok"}]}');
  assert.equal(seen.url, 'https://api.openai.com/v1/responses');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.authorization, 'Bearer sk-test-key');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, 'vision-x');
  const content = body.input[0].content;
  assert.equal(body.input[0].role, 'user');
  assert.match(content[0].text, /1\. eyes open/);
  assert.equal(content[1].type, 'input_image');
  assert.equal(content[1].image_url, `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}`);
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema.properties.verdicts.items.properties.verdict.enum, ['PASS', 'DEFECT']);
  assert.deepEqual(body.text.format.schema.required, ['verdicts']);
});

test('defaultVision refuses without a key, and an API error never carries the key', async () => {
  const png = join(mkdtempSync(join(tmpdir(), 'rb-')), 'r.png');
  writeFileSync(png, 'png');
  await assert.rejects(defaultVision({ png, questions: ['1. x'], env: {}, fetchImpl: async () => { throw new Error('must not be called'); } }), /OPENAI_API_KEY/);
  const key = 'sk-secret-value';
  const fetchImpl = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ error: { message: `Incorrect API key provided: ${key}` } }) });
  await assert.rejects(defaultVision({ png, questions: ['1. x'], env: { OPENAI_API_KEY: key }, fetchImpl }), (e) => {
    assert.match(e.message, /401/);
    assert.doesNotMatch(e.message, /sk-secret-value/);
    return true;
  });
});
