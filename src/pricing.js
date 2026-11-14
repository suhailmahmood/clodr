// Claude API list prices in USD per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing.
// PRICED_AS_OF is the date of the latest price change in this table; update both together.
export const PRICED_AS_OF = new Date(2026, 10, 9);

// [input, 5m cache write, 1h cache write, cache read, output]
const P = (input, write5m, write1h, read, output) => ({ input, write5m, write1h, read, output });

const FABLE_5_2 = P(8, 10, 16, 0.2, 40);
const FABLE_5_1 = P(10, 12.5, 20, 0.25, 50);
const FABLE_5 = P(10, 12.5, 20, 1, 50);
const OPUS_4_5 = P(5, 6.25, 10, 0.5, 25);
const OPUS_4 = P(15, 18.75, 30, 1.5, 75);
const SONNET_4 = P(3, 3.75, 6, 0.3, 15);

// Keyed by "<family>-<major>[-<minor>]" as it appears in the model id.
const PRICES = {
  'fable-5-2': FABLE_5_2, 'mythos-5-2': FABLE_5_2,
  'fable-5-1': FABLE_5_1, 'mythos-5-1': FABLE_5_1,
  'fable-5': FABLE_5, 'mythos-5': FABLE_5,
  'opus-5-5': P(4, 5, 8, 0.2, 20),
  'opus-5': OPUS_4_5, 'opus-4-8': OPUS_4_5, 'opus-4-7': OPUS_4_5, 'opus-4-6': OPUS_4_5, 'opus-4-5': OPUS_4_5,
  'opus-4-1': OPUS_4, 'opus-4': OPUS_4,
  'sonnet-5-5': P(2, 2.5, 4, 0.1, 10),
  'sonnet-5': P(2, 2.5, 4, 0.2, 10),
  'sonnet-4-6': SONNET_4, 'sonnet-4-5': SONNET_4, 'sonnet-4': SONNET_4,
  'haiku-5-5': P(0.1, 0.125, 0.2, 0.01, 0.5),
  'haiku-4-5': P(1, 1.25, 2, 0.1, 5),
};

// Haiku 5.5 bills a whole request at a higher tier when its prompt (input + cache reads + cache writes) is over 100K tokens.
const LONG_PROMPT = { 'haiku-5-5': { over: 100_000, price: P(0.5, 0.625, 1, 0.05, 2.5) } };

const FAST = 2;              // fast mode doubles every token price
const US_ONLY = 1.1;         // inference_geo "us"
const WEB_SEARCH = 0.01;     // per search request

// "claude-opus-4-5-20251101", "anthropic.claude-sonnet-4-20250514-v1:0" -> "opus-4-5", "sonnet-4"
export function modelKey(model) {
  const m = /claude-(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(model || '');
  return m ? [m[1], m[2], m[3]].filter(Boolean).join('-') : null;
}

/**
 * USD cost of one API response from its model id and `usage` block, or null when the model has no known price.
 */
export function messageCost(model, u) {
  const key = modelKey(model);
  if (!key || !PRICES[key] || !u) return null;
  const write5m = u.cache_creation ? u.cache_creation.ephemeral_5m_input_tokens || 0 : u.cache_creation_input_tokens || 0;
  const write1h = u.cache_creation ? u.cache_creation.ephemeral_1h_input_tokens || 0 : 0;
  const input = u.input_tokens || 0;
  const read = u.cache_read_input_tokens || 0;
  const long = LONG_PROMPT[key];
  const p = long && input + read + write5m + write1h > long.over ? long.price : PRICES[key];
  let usd = (input * p.input + write5m * p.write5m + write1h * p.write1h + read * p.read + (u.output_tokens || 0) * p.output) / 1e6;
  if (u.speed === 'fast') usd *= FAST;
  if (u.inference_geo === 'us') usd *= US_ONLY;
  return usd + (u.server_tool_use?.web_search_requests || 0) * WEB_SEARCH;
}

// "$0.42", "$12.30", "$1,204.00"
export const formatCost = (usd) => `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
