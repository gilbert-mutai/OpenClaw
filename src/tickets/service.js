const axios = require("axios");

const hoursBetween = (isoA, isoB) => {
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  return Math.abs(b - a) / (1000 * 60 * 60);
};

const minutesBetween = (isoA, isoB) => {
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  return Math.abs(b - a) / (1000 * 60);
};

const tokenize = (text) =>
  new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );

const FOLLOWUP_PATTERNS = [
  /\b(update|status|eta|progress|any feedback|follow[- ]?up|kindly check|please check)\b/i,
  /\b(still|yet|again|same issue|not resolved|unresolved)\b/i,
  /\b(thanks|thank you)\b/i,
];

const isFollowupIntent = (text = "") => FOLLOWUP_PATTERNS.some((p) => p.test(text));

const sameOrNewHeuristic = ({ previousSummary, newMessage, recentMessages = [] }) => {
  const context = [previousSummary, ...recentMessages.map((x) => x.text || "")].join(" ");
  const a = tokenize(context);
  const b = tokenize(newMessage);

  if (!a.size || !b.size) return { decision: "NEW", score: 0 };

  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size || 1;
  const score = inter / union;

  return {
    decision: score >= 0.42 ? "SAME" : "NEW",
    score,
  };
};

const llmCompareIssue = async ({ previousSummary, recentMessages, newMessage }) => {
  const compareUrl = process.env.ISSUE_COMPARE_URL || "http://127.0.0.1:4001/compare-issue";
  const minConf = Number(process.env.ISSUE_COMPARE_MIN_CONFIDENCE || 0.75);
  const timeout = Number(process.env.ISSUE_COMPARE_TIMEOUT_MS || 2500);

  try {
    const response = await axios.post(
      compareUrl,
      {
        previousSummary: previousSummary || "",
        recentMessages: (recentMessages || []).map((m) => m?.text || ""),
        newMessage: newMessage || "",
      },
      { timeout }
    );

    const decision = String(response?.data?.decision || "").toUpperCase();
    const confidence = Number(response?.data?.confidence || 0);

    if ((decision === "SAME" || decision === "NEW") && confidence >= minConf) {
      return { decision, confidence, source: "llm" };
    }

    return { decision: "UNKNOWN", confidence, source: "llm" };
  } catch (error) {
    return { decision: "UNKNOWN", confidence: 0, source: "llm_error" };
  }
};

const createTicketService = ({ store, erpnext, timeoutHours = 24 }) => {
  const newTicketCooldownMinutes = Number(process.env.NEW_TICKET_COOLDOWN_MINUTES || 15);

  const isExpired = (lastActivityAt, nowIso) => {
    if (!lastActivityAt) return true;
    return hoursBetween(lastActivityAt, nowIso) > timeoutHours;
  };

  const handleInbound = async ({
    messageId,
    phone,
    senderName,
    text,
    receivedAt,
    llmSummary,
    llmSubject,
    llmPriority,
  }) => {
    if (!erpnext?.isEnabled) return { skipped: true, reason: "erpnext_disabled" };
    if (!messageId || !phone || !text) return { skipped: true, reason: "invalid_payload" };

    const claimed = await store.tryClaimMessage({ messageId, phone, receivedAt: receivedAt || new Date().toISOString(), text });
    if (!claimed) return { duplicate: true };

    const nowIso = receivedAt || new Date().toISOString();
    const session = await store.getSession(phone);
    const recentMessages = await store.getRecentMessages({ phone, limit: 3 });

    const summary = String(llmSummary || "").trim() || text.slice(0, 120);
    const ticketSubject = String(llmSubject || "").trim() || summary;
    console.log("Ticket subject:", ticketSubject, "LLM subject:", llmSubject, "Summary:", summary);
    const priority = llmPriority || "Medium";

    let action = "created";
    let ticketId = null;
    let shouldAck = false;

    const createDescription = () =>
      [
        `Source: WhatsApp`,
        `Client: ${senderName || "Unknown"} (${phone})`,
        `Message: ${text}`,
        `Received At: ${nowIso}`,
      ].join("\n");

    const canStartFresh = !session?.open_ticket_id || isExpired(session.last_activity_at, nowIso);

    if (canStartFresh) {
      ticketId = await erpnext.createTicket({
        subject: ticketSubject,
        description: createDescription(),
        priority,
        clientPhone: phone,
        clientName: senderName,
        sourceMessageId: messageId,
      });
      action = "created";
      shouldAck = true;
    } else {
      const followup = isFollowupIntent(text);

      if (followup) {
        ticketId = session.open_ticket_id;
        if (typeof erpnext.reopenTicket === "function") {
          await erpnext.reopenTicket({ ticketId });
        }
        await erpnext.appendComment({
          ticketId,
          content: `WhatsApp follow-up from ${senderName || phone}: ${text}`,
        });
        action = "appended_followup";
      } else {
        const { decision } = sameOrNewHeuristic({
          previousSummary: session.last_issue_summary || "",
          newMessage: text,
          recentMessages,
        });

        if (decision === "SAME") {
          ticketId = session.open_ticket_id;
          if (typeof erpnext.reopenTicket === "function") {
            await erpnext.reopenTicket({ ticketId });
          }
          await erpnext.appendComment({
            ticketId,
            content: `WhatsApp update from ${senderName || phone}: ${text}`,
          });
          action = "appended_same_issue";
        } else {
          const withinCooldown =
            session.last_ticket_created_at &&
            minutesBetween(session.last_ticket_created_at, nowIso) < newTicketCooldownMinutes;

          if (withinCooldown) {
            ticketId = session.open_ticket_id;
            if (typeof erpnext.reopenTicket === "function") {
              await erpnext.reopenTicket({ ticketId });
            }
            await erpnext.appendComment({
              ticketId,
              content: `WhatsApp update (cooldown applied) from ${senderName || phone}: ${text}`,
            });
            action = "appended_cooldown";
          } else {
            ticketId = await erpnext.createTicket({
              subject: ticketSubject,
              description: createDescription(),
              priority,
              clientPhone: phone,
              clientName: senderName,
              sourceMessageId: messageId,
            });
            action = "created_new_issue";
            shouldAck = true;
          }
        }
      }
    }

    await store.appendClientMessage({ phone, text, receivedAt: nowIso });

    await store.upsertSession({
      phone,
      openTicketId: ticketId,
      lastIssueSummary: summary,
      lastActivityAt: nowIso,
      sessionStatus: "active",
      lastTicketCreatedAt: action.startsWith("created") ? nowIso : null,
    });

    return { action, ticketId, shouldAck };
  };

  return { handleInbound };
};

module.exports = { createTicketService };
