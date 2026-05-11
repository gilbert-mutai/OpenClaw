require("dotenv").config({ path: "../.env" });
const express = require("express");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

const client = new OpenAI({
  baseURL: "https://models.inference.ai.azure.com",
  apiKey: process.env.GITHUB_TOKEN,
});
const MODEL = process.env.LLM_MODEL || "gpt-4o-mini";
const PORT = process.env.LLM_PORT || 4001;

const TRIAGE_SYSTEM = `You are an expert IT support ticket classifier. Given a WhatsApp message from a client, extract:
- subject: A concise ticket title (8-120 characters). If the client's name is provided, use it in the subject instead of the word "client" (e.g. "Server access issue reported by Gilbert" not "Server access issue reported by client")
- summary: A one-sentence description of the issue
- priority: High (outages, cannot access systems, all users affected), Medium (degraded service, single user), or Low (questions, general requests)
- confidence: Your confidence in this classification as a decimal 0.0-1.0

Respond ONLY with valid JSON matching this exact schema:
{"subject":"string","summary":"string","priority":"High|Medium|Low","confidence":0.0}

Rules:
- subject must be 8-120 characters
- confidence >= 0.7 means you are certain; < 0.65 means fall back to heuristics
- Do not add any text outside the JSON`;

const AUTO_REPLY_SYSTEM = `You are a professional IT support agent responding to clients via WhatsApp. Write a brief, empathetic acknowledgement that:
- Addresses the client by name if provided
- Briefly references the specific issue they reported (e.g. "your backup check request", "your server access issue")
- Confirms a ticket has been raised and engineers will follow up
- If a ticket ID is provided, end with "Ticket: <ID>."
- Is 1-3 sentences, warm but professional

Respond ONLY with valid JSON:
{"reply":"string"}`;

const COMPARE_SYSTEM = `You are an expert at determining whether a new support message is about the same technical issue as a previous ticket or is a new, distinct problem.

Return ONLY valid JSON:
{"decision":"SAME|NEW","confidence":0.0}

- SAME: the new message is a follow-up, update, or recurrence of the same root cause
- NEW: the new message describes a clearly different problem
- confidence: decimal 0.0-1.0 (>= 0.75 to trust the decision)`;

const callModel = async ({ systemText, userContent, maxTokens = 256 }) => {
  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemText },
      { role: "user", content: userContent },
    ],
  });
  const text = response.choices[0]?.message?.content || "{}";
  return JSON.parse(text);
};

app.post("/analyze", async (req, res) => {
  const { text, task, senderName } = req.body || {};
  if (!text || !task) return res.status(400).json({ error: "text and task are required" });

  try {
    if (task === "support_ticket_triage") {
      const userContent = senderName
        ? `Client name: ${senderName}\nClient message:\n${text}`
        : `Client message:\n${text}`;
      const data = await callModel({ systemText: TRIAGE_SYSTEM, userContent });
      return res.json(data);
    }

    if (task === "auto_reply") {
      const parts = [];
      if (senderName) parts.push(`Client name: ${senderName}`);
      if (req.body.ticketId) parts.push(`Ticket ID: ${req.body.ticketId}`);
      parts.push(`Client message:\n${text}`);
      const data = await callModel({
        systemText: AUTO_REPLY_SYSTEM,
        userContent: parts.join("\n"),
      });
      return res.json(data);
    }

    return res.status(400).json({ error: `Unknown task: ${task}` });
  } catch (err) {
    console.error("[/analyze] error:", err.message);
    return res.status(500).json({ error: "LLM call failed", detail: err.message });
  }
});

app.post("/compare-issue", async (req, res) => {
  const { previousSummary, recentMessages, newMessage } = req.body || {};
  if (!newMessage) return res.status(400).json({ error: "newMessage is required" });

  const context = [
    previousSummary ? `Previous issue summary: ${previousSummary}` : null,
    recentMessages?.length
      ? `Recent messages:\n${recentMessages.map((m, i) => `${i + 1}. ${m}`).join("\n")}`
      : null,
    `New message: ${newMessage}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const data = await callModel({
      systemText: COMPARE_SYSTEM,
      userContent: context,
    });
    return res.json(data);
  } catch (err) {
    console.error("[/compare-issue] error:", err.message);
    return res.status(500).json({ error: "LLM call failed", detail: err.message });
  }
});

app.get("/health", (_req, res) => res.json({ status: "ok", model: MODEL }));

app.listen(PORT, () => console.log(`llm-analyzer listening on port ${PORT} (model: ${MODEL})`));
