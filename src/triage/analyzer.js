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

const validateLLMOutput = (data) => {
  if (!data || typeof data !== "object") return { ok: false, reason: "not_object" };
  const subject = String(data.subject || "").trim();
  const summary = String(data.summary || "").trim();
  const priority = cleanPriority(data.priority);
  const confidence = parseConfidence(data.confidence);
  if (!subject) return { ok: false, reason: "missing_subject" };
  if (subject.length < 8 || subject.length > 120) return { ok: false, reason: "subject_length" };
  if (confidence < Number(process.env.LLM_MIN_CONFIDENCE || 0.65))
    return { ok: false, reason: "low_confidence" };
  return { ok: true, value: { subject, summary: summary || subject, priority, confidence } };
};

const fromLLM = async (text, senderName) => {
  const url = process.env.LLM_ANALYZER_URL;
  if (!url) return null;
  const timeout = Number(process.env.LLM_ANALYZER_TIMEOUT_MS || 3000);
  const payload = {
    text,
    task: "support_ticket_triage",
    senderName: senderName || null,
    output_schema: {
      subject: "string(8-120)",
      summary: "string",
      priority: "High|Medium|Low",
      confidence: "number_0_to_1",
    },
  };
  const res = await axios.post(url, payload, { timeout });
  const validated = validateLLMOutput(res?.data || {});
  if (!validated.ok) {
    console.warn("LLM output rejected:", validated.reason);
    return null;
  }
  return validated.value;
};

const buildDynamicAck = ({ senderName, priority, summary, ticketId }) => {
  const name = senderName || "there";
  const ref = ticketId ? ` Ticket: ${ticketId}.` : "";
  const pr = cleanPriority(priority);
  if (pr === "High") {
    return `Hello ${name}, thank you for contacting us. We are sorry for the inconvenience. Your request has been marked as urgent and our engineers are actively working on it. We will update you shortly.${ref}`;
  }
  return `Hello ${name}, thank you for contacting us. We are sorry for the inconvenience. Your request has been received and assigned to our support engineers. We will get back to you shortly.${ref}`;
};

const analyzeInboundMessage = async ({ text, senderName }) => {
  try {
    const llm = await fromLLM(text, senderName);
    if (llm) {
      console.log("Triage source=llm confidence=", llm.confidence);
      return { summary: llm.summary, subject: llm.subject, priority: llm.priority };
    }
  } catch (error) {
    console.error("LLM triage failed, using fallback:", error.message);
  }

  const summary = buildSummary(text);
  const subject = fallbackSubject(text);
  const priority = pickPriority(text);
  console.log("Triage source=fallback");
  return { summary, subject, priority };
};

const generateLLMAutoReply = async ({ text, senderName }) => {
  const url = process.env.LLM_ANALYZER_URL;
  if (!url) return null;
  const timeout = Number(process.env.LLM_ANALYZER_TIMEOUT_MS || 3000);
  const payload = {
    text,
    task: "auto_reply",
    senderName,
    output_schema: {
      reply: "string",
    },
  };
  try {
    const res = await axios.post(url, payload, { timeout });
    const reply = String(res?.data?.reply || "").trim();
    return reply || null;
  } catch (error) {
    console.warn("LLM auto-reply failed:", error.message);
    return null;
  }
};

module.exports = { analyzeInboundMessage, buildDynamicAck, generateLLMAutoReply };
