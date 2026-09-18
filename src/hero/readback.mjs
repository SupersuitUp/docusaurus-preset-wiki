// The read-back step of `wiki hero`: look at the rendered PNG and judge it against the gate,
// one verdict per assertion, plus one per declared string checked character by character.
//
// A prompt is an instruction to the model and it loses some fraction of the time; the gate is
// what refuses when it lost. Without this step a hero with a misspelled label, a closed eye or a
// third panel ships and passes every build check, because nothing else ever looks at pixels.
//
// The looking is done by a vision model through the OpenAI Responses API, in ONE request that
// carries the image once and every numbered assertion, and answers in a fixed JSON shape
// (structured output, strict). Parsing is strict too: every assertion must come back exactly
// once with PASS or DEFECT, or the whole read-back is refused rather than guessed at. Tests
// inject a fake `vision`; nothing here touches the network unless the default is used.
//
// The key comes from OPENAI_API_KEY and is never printed, not even in an error.
import { existsSync, readFileSync } from 'node:fs';

/** The reader. Override with WIKI_HERO_VISION_MODEL; any vision-capable Responses model works. */
export const DEFAULT_VISION_MODEL = 'gpt-5.5';

const PLACEMENT = (placement) => {
  const m = /^panel-(\d+)-label$/.exec(placement);
  if (m) return `the label band on panel ${m[1]}`;
  if (placement === 'title-bar') return 'the title bar across the top';
  return placement;
};

/** Every gate line as given, then one spelling assertion per declared string. */
export function buildAssertions(gate, strings) {
  return [
    ...gate,
    ...strings.map((s) => `${PLACEMENT(s.placement)} reads exactly "${s.text}", character for character, with no letter missing, doubled, swapped or invented`),
  ];
}

const INSTRUCTIONS = 'You are checking a rendered illustration against a numbered list of assertions. '
  + 'Look at the image carefully, zooming in on lettering and on every face. For EACH assertion answer PASS when the image satisfies it '
  + 'and DEFECT when it does not, with a one-line note saying what you actually see. Read every piece of lettering character by character: '
  + 'a misspelling, a missing or doubled letter, an extra word, or any word not in the assertions is a DEFECT. '
  + 'Answer every assertion exactly once, by its number.';

const SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          verdict: { type: 'string', enum: ['PASS', 'DEFECT'] },
          note: { type: 'string' },
        },
        required: ['index', 'verdict', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
};

/**
 * The default `vision`: one Responses API call carrying the PNG and the numbered questions,
 * answering in the JSON shape above. Returns the raw text; `parseVerdicts` is the judge of it.
 */
export async function defaultVision({ png, questions, env = process.env, fetchImpl = globalThis.fetch }) {
  const key = env.OPENAI_API_KEY;
  if (!key) throw new Error('read-back needs OPENAI_API_KEY in the environment (or pass --no-readback to skip the check)');
  const model = env.WIKI_HERO_VISION_MODEL || DEFAULT_VISION_MODEL;
  const image = readFileSync(png).toString('base64');
  const body = {
    model,
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: `${INSTRUCTIONS}\n\nAssertions:\n${questions.join('\n')}` },
        { type: 'input_image', image_url: `data:image/png;base64,${image}`, detail: 'high' },
      ],
    }],
    text: { format: { type: 'json_schema', name: 'hero_readback', strict: true, schema: SCHEMA } },
  };
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message ?? res.statusText;
    throw new Error(`read-back call failed (${res.status}, model ${model}): ${String(msg).replace(key, '<key>')}`);
  }
  const text = (json.output ?? [])
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text)
    .join('');
  if (!text) throw new Error(`read-back returned no text (model ${model}, status ${json.status ?? 'unknown'})`);
  return text;
}

/**
 * The vision call's text to `[{ assertion, verdict, note }]` in assertion order. Strict: not
 * JSON, an index outside 1..N, a missing one, a repeated one, or a verdict that is not PASS or
 * DEFECT all throw, because a read-back that guesses is a gate that is open.
 */
export function parseVerdicts(text, assertions) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`readback: the vision call did not answer in JSON: ${String(text).slice(0, 200)}`);
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.verdicts;
  if (!Array.isArray(list)) throw new Error('readback: the answer has no `verdicts` list');
  const out = new Array(assertions.length).fill(null);
  for (const v of list) {
    const i = Number(v?.index);
    if (!Number.isInteger(i) || i < 1 || i > assertions.length) throw new Error(`readback: verdict index ${JSON.stringify(v?.index)} is outside 1..${assertions.length}`);
    if (out[i - 1]) throw new Error(`readback: assertion ${i} was answered twice`);
    if (v.verdict !== 'PASS' && v.verdict !== 'DEFECT') throw new Error(`readback: assertion ${i} got verdict ${JSON.stringify(v.verdict)}, expected PASS or DEFECT`);
    out[i - 1] = { assertion: assertions[i - 1], verdict: v.verdict, note: typeof v.note === 'string' ? v.note.trim() : '' };
  }
  const missing = out.map((v, i) => (v ? null : i + 1)).filter(Boolean);
  if (missing.length) throw new Error(`readback: no verdict for assertion ${missing.join(', ')}`);
  return out;
}

/**
 * Read one PNG back. `gate` is the compiled gate (plus any adapter guard gate); `strings` are
 * the declared strings. Returns the verdict list; the caller decides what a DEFECT costs.
 */
export async function readBack(png, gate, strings, { vision = defaultVision, env = process.env } = {}) {
  if (!existsSync(png)) throw new Error(`readback: no image at ${png}`);
  const assertions = buildAssertions(gate, strings);
  const questions = assertions.map((a, i) => `${i + 1}. ${a}`);
  const text = await vision({ png, questions, env });
  return parseVerdicts(text, assertions);
}

/**
 * The DEFECT notes as one correction block for the next round's prompt. Empty string when
 * nothing failed. Each line names the assertion and what the last render did instead, so
 * the model is told what to fix rather than asked again in the same words.
 */
export function counterClauses(verdicts) {
  const defects = verdicts.filter((v) => v.verdict === 'DEFECT');
  if (!defects.length) return '';
  const lines = defects.map((d, i) => `${i + 1}. ${d.assertion}${d.note ? ` (the previous attempt failed this: ${d.note})` : ''}`);
  return `CORRECTIONS. The previous render of this exact scene was rejected for the defects below. Each one must be fixed in this render, with everything else kept as specified:\n${lines.join('\n')}`;
}
