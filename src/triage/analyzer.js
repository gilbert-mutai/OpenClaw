const axios = require("axios");

const HIGH_KEYWORDS = [
  "urgent", "critical", "down", "outage", "impact high", "all users",
  "cannot", "can't", "failing", "failure", "server down", "3cx", "ssh", "rdp",
];

const tokenize = (text) => String(text || "").toLowerCase().replace(/\s+/g, " ").trim();

const pickPriority = (rawText) => {
  const t = tokenize(rawText);
  if (HIGH_KEYWORDS.some((k) => t.includes(k))) return "High";
  return "Medium";
};

// Greeting/pleasantry/self-introduction filler that clients often lead with
// before actually describing their issue (e.g. "Hi, I hope you're doing well,
// this is Jane from Acme Corp, we've been having trouble with..."). Stripped
// out so the generated subject reflects the real problem, not the preamble.
const GREETING_PATTERNS = [
  /^(hello|hi|hey|good\s(morning|afternoon|evening|day))\b[\s,!.]*/i,
  /\bi\s?hope\s(you'?re|you\sare|this\s(message|email)\sfinds\syou)\s(doing\s)?well\b[.,!]*/i,
  /\b(dear|good\sday)\s(team|support|sir|madam)\b[.,!]*/i,
  /\bmy\sname\sis\s[a-z ]+\b[.,!]*/i,
  /\bi('?m|\sam)\s[a-z ]+\s(from|at|with)\s[a-z0-9 ]+\b[.,!]*/i,
  /^(quick\s(one|question|note)[\s,]*(though)?[\s,.-]*)/i,
  /^(just\s(wanted\sto\s(say|mention|ask)|a\s(quick|heads[\s-]?up))[\s,]*)/i,
  /^(by\sthe\sway[\s,]*)/i,
  /^(so\sbasically[\s,]*)/i,
  /^(one\smore\sthing[\s,]*)/i,
];

// Words that signal a sentence is actually describing a technical problem,
// as opposed to small talk/backstory.
const ISSUE_KEYWORDS =
  /(cannot|can'?t|unable|not\sworking|doesn'?t\swork|failing|fail(ed|ure)?|down|error|issue|problem|broken|stuck|trouble|outage|timeout|timed\sout|access|connect|login|log\sin|password|reset|crash(ed|ing)?|slow|lost|missing|delete[d]?|help|ftp|ssh|rdp|3cx|outbound|network|server|email|e-?mail)/i;

const splitSentences = (text) =>
  String(text || "")
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

const stripGreetings = (sentence) => {
  let s = sentence;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of GREETING_PATTERNS) {
      const next = s.replace(pattern, "").trim();
      if (next !== s) {
        s = next;
        changed = true;
      }
    }
  }
  return s;
};

// Finds the sentence that actually names the issue, skipping greeting/backstory
// sentences. Falls back to the last remaining sentence, since clients who ramble
// tend to land on the real ask at the end rather than the start.
const extractCoreIssue = (rawText) => {
  const sentences = splitSentences(rawText).map(stripGreetings).filter(Boolean);
  if (!sentences.length) return "";
  return sentences.find((s) => ISSUE_KEYWORDS.test(s)) || sentences[sentences.length - 1];
};

const buildSummary = (rawText) => {
  const core = extractCoreIssue(rawText);
  if (!core) return "WhatsApp support request";
  return core.length > 140 ? `${core.slice(0, 137)}...` : core;
};

const fallbackSubject = (rawText) => {
  const core = extractCoreIssue(rawText);
  if (!core) return "WhatsApp Support Request";

  if (/(rdp|remote desktop)/i.test(core) && /(access|connect|timeout|timed out|issue)/i.test(core))
    return "Issue accessing server via RDP";
  if (/\bssh\b/i.test(core) && /(access|connect|timeout|timed out|issue)/i.test(core))
    return "Issue accessing server via SSH";
  if (/\b3cx\b/i.test(core) && /(outbound|incoming|call|calls|issue|down)/i.test(core))
    return "Issue with 3CX calling service";

  const compact = core.replace(/[.!?]+$/, "").trim();
  if (!compact) return "WhatsApp Support Request";
  if (compact.length <= 120) return compact;
  const truncated = compact.slice(0, 117);
  const cut = truncated.lastIndexOf(" ");
  return `${cut > 0 ? truncated.slice(0, cut) : truncated}...`;
};

const cleanPriority = (p) => {
  const v = String(p || "").toLowerCase();
  if (v.includes("high") || v.includes("urgent") || v.includes("critical")) return "High";
  if (v.includes("low")) return "Low";
  return "Medium";
};

const parseConfidence = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const stripEmojis = (text) =>
  String(text || "").replace(/[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27FF}]|[\u{2B00}-\u{2BFF}]/gu, "").trim();

const injectTicketId = (text, ticketId) => {
  if (!text) return text;
  if (ticketId) {
    let result = text.replace(/TICKET_ID/g, ticketId);
    // Also replace any hallucinated ticket numbers in narratives
    result = result.replace(/\b(ANG|ISS)-\d{4,}/gi, ticketId);
    return result.trim();
  }
  // No ticket ID: strip the placeholder reference cleanly
  return text.replace(/\s*Ticket:\s*TICKET_ID\.?/gi, "").trim();
};

const buildDynamicAck = ({ senderName, priority, ticketId }) => {
  const name = senderName || "there";
  const ref = ticketId ? ` Ticket: ${ticketId}.` : "";
  const pr = cleanPriority(priority);
  if (pr === "High") {
    return `Hello ${name}, I understand you have an urgent issue. A ticket has been raised and one of our Engineers will get back to you shortly.${ref}`;
  }
  return `Hello ${name}, I understand you are facing an issue. A ticket has been raised and one of our Engineers will get back to you shortly.${ref}`;
};

// Single combined LLM call: returns triage + reply + narrative in one request.
// Falls back to heuristics (reply/narrative will be null) if LLM unavailable or fails.
const analyzeAll = async ({ text, senderName }) => {
  const url = process.env.LLM_ANALYZER_URL;
  if (url) {
    const timeout = Number(process.env.LLM_ANALYZER_TIMEOUT_MS || 7000);
    try {
      const res = await axios.post(
        url,
        { text, task: "full_analysis", senderName: senderName || null },
        { timeout }
      );
      const data = res?.data || {};
      const subject = String(data.subject || "").trim();
      const summary = String(data.summary || "").trim();
      const priority = cleanPriority(data.priority);
      const confidence = parseConfidence(data.confidence);
      const reply = String(data.reply || "").trim();
      const narrative = stripEmojis(data.narrative);

      if (subject && subject.length >= 8 && confidence >= Number(process.env.LLM_MIN_CONFIDENCE || 0.65)) {
        console.log("Analysis source=llm confidence=", confidence);
        return { subject, summary: summary || subject, priority, confidence, reply, narrative };
      }
      console.warn("LLM full_analysis rejected:", !subject ? "no_subject" : "low_confidence");
    } catch (error) {
      console.warn("LLM full_analysis failed:", error.message);
    }
  }

  const summary = buildSummary(text);
  const subject = fallbackSubject(text);
  const priority = pickPriority(text);
  console.log("Analysis source=fallback");
  return { summary, subject, priority, reply: null, narrative: null };
};

module.exports = { analyzeAll, buildDynamicAck, injectTicketId };
