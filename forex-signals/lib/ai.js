// Claude reads the market snapshot through the course rulebook and the
// user's tutorials and returns one signal as schema-constrained JSON.
//
// Caching: the instructions + rulebook (system) and the tutorials (start of
// the user turn) are identical from one request to the next, so both end in a
// cache breakpoint; only the market snapshot after them changes.

import Anthropic from '@anthropic-ai/sdk';

export const SIGNAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'action',
    'order_type',
    'entry',
    'stop_loss',
    'take_profits',
    'confidence',
    'setup',
    'summary',
    'reasoning',
    'checklist',
    'invalidation',
    'key_levels',
  ],
  properties: {
    action: { type: 'string', enum: ['BUY', 'SELL', 'WAIT'] },
    order_type: { type: 'string', enum: ['market', 'limit', 'none'] },
    entry: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    stop_loss: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    take_profits: { type: 'array', items: { type: 'number' } },
    confidence: { type: 'integer', description: '0-100: how cleanly the setup meets the checklist' },
    setup: {
      type: 'string',
      enum: ['rtp', 'pivot', 'breakout', 'flip', 'nature', 'magnet', 'stop-hunt', 'none'],
    },
    summary: { type: 'string', description: 'One line, Persian' },
    reasoning: { type: 'string', description: 'Persian, at most ~150 words' },
    checklist: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'ok', 'note'],
        properties: {
          rule: { type: 'string' },
          ok: { type: 'boolean' },
          note: { type: 'string' },
        },
      },
    },
    invalidation: { type: 'string', description: 'Persian: what would cancel this view' },
    key_levels: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['price', 'kind', 'timeframe', 'note'],
        properties: {
          price: { type: 'number' },
          kind: { type: 'string', enum: ['support', 'resistance', 'entry-zone', 'target'] },
          timeframe: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
  },
};

const INSTRUCTIONS = `You are a price-action analyst who trades strictly by Saeed Khakestar's course, summarised in the Persian rulebook below. For one instrument you receive a market snapshot and return one trading signal as JSON.

How to read the input:
- The snapshot is computed by the app from TradingView candles. Its prices, ATRs, zones and scores are authoritative; do not invent levels or prices that cannot be derived from it. Candle arrays are [time, open, high, low, close], oldest first, closed bars only; "forming" is the bar still open.
- Fractal roles: structure = 1D, pattern = 4H (its ATR is the movement step), trigger = 1H, tolerance = the 15m ATR (about 20% of the step), context = 1W. ATR periods follow the course (1H 24, 4H 30, 1D 22, 1W 52).
- Levels carry the app's level value: timeframe, touches, fresh, flipped, pullback-pivot type, confluence and a score. "acts" is the role the zone plays now relative to price.
- The rule-engine candidate is a mechanical first pass. Judge it on the merits; agree or overrule it.
- If the user uploaded tutorials, they take precedence over the rulebook where the two differ.

How to decide:
- Work through the rulebook's decision checklist (section 14). If price is not on a zone, the trigger candle has not closed, or the stop would have to be wider than the trigger-timeframe ATR, the answer is WAIT; say exactly what to wait for (which zone, which side, which trigger) in the summary.
- A limit order is right when the plan is a return to a specific zone (for example the breakout accept zone, one trigger ATR from the zone edge). Market orders enter at the current price.
- Stop behind the zone plus tolerance, never wider than the trigger ATR. Targets by the rulebook's step rules, placed before any strong opposite zone. Put targets in the order they would be hit.
- confidence (0-100) is how cleanly the setup meets the checklist, not a win probability; keep it at or below 85, and near 0 for WAIT with nothing forming.
- For WAIT: order_type "none", entry and stop_loss null, take_profits empty.
- If the data source is "demo", the prices are simulated: analyse them anyway, but begin the summary with "(داده‌ی نمایشی)".

Output: summary, reasoning, checklist rule/note and invalidation in Persian, concise, prices with the instrument's decimal digits. key_levels: the few zones that matter for this decision.`;

export class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function createClient(env = process.env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

export function buildRequest({ config, rulebook, tutorialBlocks = [], desc, candidate, previous, dataSource }) {
  const system = [
    { type: 'text', text: INSTRUCTIONS },
    { type: 'text', text: `<rulebook>\n${rulebook}\n</rulebook>`, cache_control: { type: 'ephemeral' } },
  ];

  const content = [];
  if (tutorialBlocks.length) {
    content.push({ type: 'text', text: 'Tutorials uploaded by the user (they take precedence over the rulebook where they differ):' });
    content.push(...tutorialBlocks);
    const last = content.length - 1;
    content[last] = { ...content[last], cache_control: { type: 'ephemeral' } };
  }

  const firstPass = candidate && {
    action: candidate.action,
    orderType: candidate.orderType,
    entry: candidate.entry,
    stopLoss: candidate.stopLoss,
    takeProfits: candidate.takeProfits,
    setup: candidate.setup,
    summary: candidate.summary,
    checklist: candidate.checklist,
    warnings: candidate.warnings,
  };
  const prev = previous && {
    at: previous.createdAt,
    action: previous.action,
    entry: previous.entry,
    stopLoss: previous.stopLoss,
    takeProfits: previous.takeProfits,
    summary: previous.summary,
  };
  content.push({
    type: 'text',
    text: [
      `Instrument: ${desc.instrument} (${desc.name}). Data source: ${dataSource}. Now: ${new Date().toISOString()}.`,
      '',
      'Market snapshot:',
      '```json',
      JSON.stringify(desc),
      '```',
      '',
      'Rule-engine first pass:',
      '```json',
      JSON.stringify(firstPass || null),
      '```',
      '',
      prev ? `Previous signal for this instrument (context only):\n\`\`\`json\n${JSON.stringify(prev)}\n\`\`\`` : 'No previous signal for this instrument.',
      '',
      'Return the signal.',
    ].join('\n'),
  });

  const params = {
    model: config.model,
    max_tokens: 32000,
    thinking: { type: 'adaptive' },
    output_config: { effort: config.effort, format: { type: 'json_schema', schema: SIGNAL_SCHEMA } },
    system,
    messages: [{ role: 'user', content }],
  };
  if (config.fallbacks) {
    // A policy decline is re-run on Anthropic's recommended fallback model
    // inside the same call instead of coming back empty.
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  return params;
}

// Maps the model's JSON onto the app's signal fields.
export function fromModel(out) {
  return {
    action: out.action,
    orderType: out.order_type,
    entry: out.entry,
    stopLoss: out.stop_loss,
    takeProfits: out.take_profits,
    confidence: out.confidence,
    setup: out.setup,
    summary: out.summary,
    reasoning: out.reasoning,
    checklist: out.checklist,
    invalidation: out.invalidation,
    keyLevels: (out.key_levels || []).map((k) => ({ price: k.price, kind: k.kind, timeframe: k.timeframe, note: k.note })),
  };
}

export async function aiSignal(client, request) {
  let message;
  try {
    message = await client.beta.messages.stream(request).finalMessage();
  } catch (err) {
    throw new AiError('api', err.message || String(err));
  }
  if (message.stop_reason === 'refusal') {
    const why = message.stop_details && message.stop_details.explanation;
    throw new AiError('refusal', `the model declined this request${why ? `: ${why}` : ''}`);
  }
  if (message.stop_reason === 'max_tokens') throw new AiError('max_tokens', 'the response was cut off at max_tokens');
  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    throw new AiError('bad_output', 'the model did not return valid JSON');
  }
  const usage = message.usage || {};
  return {
    raw: fromModel(out),
    meta: {
      model: message.model,
      fallbackUsed: (usage.iterations || []).some((e) => e.type === 'fallback_message'),
      usage: {
        input: usage.input_tokens ?? null,
        cacheRead: usage.cache_read_input_tokens ?? null,
        cacheWrite: usage.cache_creation_input_tokens ?? null,
        output: usage.output_tokens ?? null,
      },
    },
  };
}
