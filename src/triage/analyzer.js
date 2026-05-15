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

const buildSummary = (rawText) => {
  const lines = String(rawText || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
  if (!lines.length) return "WhatsApp support request";
  const preferred = lines.find((line) =>
    /(cannot|can't|unable|failing|down|error|issue|problem|ssh|rdp|3cx|outbound|network|server)/i.test(line)
  );
  const base = preferred || lines[0];
  return base.length > 140 ? `${base.slice(0, 137)}...` : base;
};

const fallbackSubject = (rawText) => {
  const t = String(rawText || "").replace(/^hello[\s,]*/i, "").replace(/^hi[\s,]*/i, "").trim();
  if (/(rdp|remote desktop)/i.test(t) && /(access|connect|timeout|timed out|issue)/i.test(t))
    return "Issue accessing server via RDP";
  if (/\bssh\b/i.test(t) && /(access|connect|timeout|timed out|issue)/i.test(t))
    return "Issue accessing server via SSH";
  if (/\b3cx\b/i.test(t) && /(outbound|incoming|call|calls|issue|down)/i.test(t))
    return "Issue with 3CX calling service";
  const compact = t.split(/[.!?]/)[0].trim();
  return compact ? compact.split(/\s+/).slice(0, 10).join(" ") : "WhatsApp Support Request";
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
    return `Hello ${name}, thank you for contacting us. We are sorry for the inconvenience. Your request has been marked as urgent and our engineers are actively working on it. We will update you shortly.${ref}`;
  }
  return `Hello ${name}, thank you for contacting us. We are sorry for the inconvenience. Your request has been received and assigned to our support engineers. We will get back to you shortly.${ref}`;
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
