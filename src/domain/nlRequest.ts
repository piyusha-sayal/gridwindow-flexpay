/**
 * Deterministic natural-language request parser: the labeled fallback when the model is
 * unavailable. It extracts ONLY request fields (energy, plug-in/departure time, spend cap,
 * port, preference). It cannot set prices, approve payments, or change any rule; every value
 * is re-validated by the request schema afterwards.
 */

export type ChargePreference = "lowest_cost" | "early_finish" | "gentle";

export interface LocalTime {
  hour: number;
  minute: number;
}

export interface ParsedRequest {
  targetBatteryKWh?: number;
  plugInLocal?: LocalTime;
  departLocal?: LocalTime;
  spendCapCents?: number;
  /** Smallest validated driver discount the driver will accept, in cents. */
  minSavingsCents?: number;
  /** "in two hours": resolved server-side against the station clock, never here. */
  departWithinMinutes?: number;
  /** Night the resolved window belongs to (set server-side only when a relative deadline was resolved). */
  nightOf?: string;
  portLabel?: string;
  preference?: ChargePreference;
  notes: string[];
  /** Goals the driver must restate in the form; the affected field is left unset, never guessed. */
  clarifications?: string[];
}

/** Fixed server text per ambiguity; shared by the model path and this parser. */
export const CLARIFY = {
  SAVINGS_GOAL: "Your saving goal is unclear (\"up to\" is not a minimum). Enter a minimum saving in the form if you want one.",
  CONFLICTING_SAVINGS: "You gave more than one minimum saving. Enter the one you want in the form.",
  CONFLICTING_BUDGET: "You gave more than one budget. Enter the one you want in the form.",
  CONFLICTING_FINANCIAL_GOALS: "Your saving and budget goals conflict. Enter the minimum saving and budget you want in the form.",
  DEPARTURE: "Your departure deadline is unclear. Set it in the form.",
} as const;
export type ClarifyCode = keyof typeof CLARIFY;
export const AMBIGUITY_CODES = Object.keys(CLARIFY) as [ClarifyCode, ...ClarifyCode[]];

const MAX_INPUT = 300;
const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`;
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};
const WORD = Object.keys(NUMBER_WORDS).join("|");
/** "$4", "$6.50", "4 dollars", "four dollars", "ten bucks". Groups: dollars, cents, word. */
const MONEY = String.raw`(?:\$\s?(\d{1,4})(?:\.(\d{1,2}))?|(?:(\d{1,4})|(${WORD}))\s*(?:dollars?|bucks?|usd))`;
const SAVINGS = new RegExp(String.raw`sav(?:e|ing)\s*(?:me\s*)?(?:at least|a minimum of|minimum|more than|over)?\s*${MONEY}`, "g");
/** "save up to $5" states a ceiling on savings, which is neither a minimum nor a budget. */
const SAVE_UP_TO = new RegExp(String.raw`sav(?:e|ing)\s*(?:me\s*)?up to\s*${MONEY}`, "g");
const BUDGET = new RegExp(String.raw`(?:don'?t spend more than|no more than|not more than|max(?:imum)?(?:\s+is)?|at most|up to|under|budget(?:\s+(?:of|is))?|cap(?:\s+(?:of|is))?|spend(?:ing)?\s+limit)\s*(?:of\s*)?${MONEY}`, "g");
const INJECTION = /\b(ignore|approve|authori[sz]e|capture|auto(?:matically)?[- ]?(?:approve|pay)|free|set (?:the |my )?price|\$0\.\d+ price|override)\b/;

/** Distinct positive amounts in cents for every match of a global money pattern. */
function amounts(re: RegExp, input: string): number[] {
  const found = [...input.matchAll(re)].map((m) => moneyCents(m, 1)).filter((c): c is number => c !== null && c > 0);
  return [...new Set(found)];
}

function toLocalTime(h: string, m: string | undefined, meridiem: string | undefined): LocalTime | null {
  let hour = Number(h);
  const minute = Number(m ?? "0");
  const mer = meridiem?.replace(/\./g, "");
  if (mer === "pm" && hour < 12) hour += 12;
  if (mer === "am" && hour === 12) hour = 0;
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

function moneyCents(m: RegExpMatchArray, offset: number): number | null {
  const [dollars, cents, plain, word] = [m[offset], m[offset + 1], m[offset + 2], m[offset + 3]];
  if (dollars !== undefined) return Number(dollars) * 100 + Number((cents ?? "").padEnd(2, "0"));
  if (plain !== undefined) return Number(plain) * 100;
  if (word !== undefined) return (NUMBER_WORDS[word] ?? 0) * 100;
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Departure deadline; an hour without am/pm is a morning departure (1-11) or ambiguous (12+ is left unset). */
function parseDeparture(input: string, notes: string[]): LocalTime | undefined {
  const depart = new RegExp(String.raw`(?:ready by|by|before|until|leave at|leaving at|depart(?:ing)? at)\s*${TIME}(?![\d:]|\s*(?:kwh|hours?|minutes?|dollars?|bucks?))`).exec(input);
  if (!depart) return undefined;
  const t = toLocalTime(depart[1]!, depart[2], depart[3]);
  if (!t) {
    notes.push("Departure time was not understood.");
    return undefined;
  }
  if (depart[3]) return t;
  if (t.hour >= 1 && t.hour <= 11) {
    notes.push(`Departure read as ${t.hour}:${pad(t.minute)} AM (morning). Edit it if you meant evening.`);
    return t;
  }
  notes.push(`Departure "${depart[0].trim()}" is ambiguous (AM or PM?); please set it in the form.`);
  return undefined;
}

function parseRelativeDeadline(input: string): number | undefined {
  const rel = new RegExp(String.raw`(?:in|within)\s*(?:the next\s*)?(\d{1,3}|${WORD}|an?|half an)\s*(hours?|minutes?|mins?)`).exec(input);
  if (!rel) return undefined;
  const raw = rel[1]!;
  const qty = raw === "a" || raw === "an" ? 1 : raw === "half an" ? 0.5 : (NUMBER_WORDS[raw] ?? Number(raw));
  const minutes = Math.round(rel[2]!.startsWith("h") ? qty * 60 : qty);
  return minutes > 0 && minutes <= 24 * 60 ? minutes : undefined;
}

export function parseChargeRequestText(text: string): ParsedRequest {
  const notes: string[] = [];
  const input = text.slice(0, MAX_INPUT).toLowerCase();
  if (text.length > MAX_INPUT) notes.push(`Only the first ${MAX_INPUT} characters were read.`);
  const out: ParsedRequest = { notes };

  const kwh = /(\d{1,3}(?:\.\d{1,2})?)\s*kwh/.exec(input);
  if (kwh) out.targetBatteryKWh = Number(kwh[1]);

  const clarify = new Set<ClarifyCode>();
  const upTo = amounts(SAVE_UP_TO, input).length > 0;
  if (upTo) clarify.add("SAVINGS_GOAL");
  const savings = amounts(SAVINGS, input);
  if (savings.length === 1) out.minSavingsCents = savings[0];
  else if (savings.length > 1) clarify.add("CONFLICTING_SAVINGS");

  // Only an explicit spending limit becomes a cap; a bare "$X price" or any "save ..." phrase is never one.
  const cap = amounts(BUDGET, input.replace(SAVE_UP_TO, " "));
  if (cap.length === 1) out.spendCapCents = cap[0];
  else if (cap.length > 1) clarify.add("CONFLICTING_BUDGET");
  if (clarify.size > 0) out.clarifications = [...clarify].map((c) => CLARIFY[c]);

  const departLocal = parseDeparture(input, notes);
  if (departLocal) out.departLocal = departLocal;
  const within = departLocal ? undefined : parseRelativeDeadline(input);
  if (within !== undefined) out.departWithinMinutes = within;

  const plugIn = new RegExp(String.raw`(?:arrive|arriving|plug(?:ging)? in|park(?:ing)?|from)\s*(?:at\s*)?${TIME}`).exec(input);
  if (plugIn) {
    const t = toLocalTime(plugIn[1]!, plugIn[2], plugIn[3]);
    if (t) out.plugInLocal = t;
    else notes.push("Plug-in time was not understood.");
  }

  const port = /port\s*([a-h])\b/.exec(input);
  if (port) out.portLabel = port[1]!.toUpperCase();

  if (/\b(gentle|slow|battery health|half[- ]power)\b/.test(input)) out.preference = "gentle";
  else if (/\b(early|earlier|ahead of time|buffer)\b/.test(input)) out.preference = "early_finish";
  else if (savings.length > 0 || /\b(cheap|cheapest|lowest|save|saving)\b/.test(input)) out.preference = "lowest_cost";

  if (INJECTION.test(input)) notes.push("Not something the assistant can do: price changes and payment approvals. Prices and payments are set only by the backend, and only you can approve.");
  const recognized = kwh || savings.length > 0 || upTo || cap.length > 0 || out.departLocal || within !== undefined || plugIn || port;
  if (!recognized) notes.push("No request fields recognized; please use the form.");
  return out;
}
