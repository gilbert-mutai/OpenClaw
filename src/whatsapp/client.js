const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const { analyzeAll, buildDynamicAck, injectTicketId } = require("../triage/analyzer");

const getMessageText = (message) => {
  if (!message) return "";
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  return "";
};

const extractPhone = (jid = "") => {
  if (!jid || jid === "status@broadcast" || jid.endsWith("@g.us")) return null;
  return jid.split("@")[0].replace(/\D/g, "") || null;
};

const selectBestSenderJid = (message) => {
  const candidates = [
    message?.key?.participantAlt,
    message?.key?.remoteJidAlt,
    message?.participant,
    message?.key?.participant,
    message?.key?.remoteJid,
  ].filter(Boolean);

  return (
    candidates.find((jid) => jid.endsWith("@s.whatsapp.net")) ||
    candidates.find((jid) => jid.endsWith("@hosted")) ||
    candidates[0] ||
    null
  );
};

const startWhatsAppClient = async ({
  sessionDir,
  ackFallbackName,
  autoReplyEnabled,
  escalationEnabled,
  notifier,
  ticketService,
  buildEscalationMessage,
  buildAckMessage,
}) => {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const socket = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: "silent" }),
  });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) qrcode.generate(qr, { small: true });

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        startWhatsAppClient({
          sessionDir,
          ackFallbackName,
          autoReplyEnabled,
          escalationEnabled,
          notifier,
          ticketService,
          buildEscalationMessage,
          buildAckMessage,
        });
      }
    }
  });

  const processingIds = new Set();

  socket.ev.on("messages.upsert", async (payload) => {
    if (payload.type !== "notify") return;

    for (const message of payload.messages) {
      if (!message.message || message.key.fromMe) continue;
      if (message.key.remoteJid === "status@broadcast") continue;

      const text = getMessageText(message.message).trim();
      if (!text) continue;

      const senderName = message.pushName || message.verifiedBizName || ackFallbackName;
      const remoteJid = message.key.remoteJid;
      const senderJid = selectBestSenderJid(message);
      const phone = extractPhone(senderJid) || extractPhone(remoteJid);
      const messageId = message.key.id || `${remoteJid}-${Date.now()}`;
      const receivedAt = message.messageTimestamp
        ? new Date(Number(message.messageTimestamp) * 1000).toISOString()
        : new Date().toISOString();

      if (processingIds.has(messageId)) continue;
      processingIds.add(messageId);
      setTimeout(() => processingIds.delete(messageId), 60000);

      const companyNames = (process.env.COMPANY_WHATSAPP_NAMES || "")
        .split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
      const isCompanyReply = companyNames.length > 0 &&
        companyNames.some((n) => (senderName || "").toLowerCase().includes(n));

      if (isCompanyReply) {
        if (escalationEnabled && notifier) {
          const label = remoteJid.endsWith("@g.us") ? "Message from" : "Reply by";
          await notifier.send(`${label} ${senderName}: "${text}"`);
        }
        continue;
      }

      // Single LLM call: returns triage + reply + narrative (or heuristic fallback)
      const analysis = await analyzeAll({ text, senderName });
      const triage = { summary: analysis.summary, subject: analysis.subject, priority: analysis.priority };

      let ticketResult = null;
      if (ticketService) {
        try {
          ticketResult = await ticketService.handleInbound({
            messageId,
            phone,
            senderName,
            text,
            receivedAt,
            llmSummary: triage.summary,
            llmSubject: triage.subject || null,
            llmPriority: triage.priority,
          });
        } catch (error) {
          console.error("Ticket handling failed", error?.response?.data || error.message);
        }
      }

      const shouldAck = ticketService ? ticketResult?.shouldAck === true : true;
      const ticketId = ticketResult?.ticketId || null;

      if (autoReplyEnabled && shouldAck) {
        let ackText = analysis.reply
          ? injectTicketId(analysis.reply, ticketId)
          : null;
        if (!ackText) {
          ackText = buildDynamicAck({ senderName, priority: triage.priority, ticketId }) ||
            buildAckMessage({ senderName, triage, ticketResult, text });
        }
        await socket.sendMessage(remoteJid, { text: ackText });
      }

      if (escalationEnabled && notifier && ticketResult?.duplicate !== true) {
        let escalationText = analysis.narrative
          ? injectTicketId(analysis.narrative, ticketId)
          : null;
        if (!escalationText) {
          escalationText = buildEscalationMessage({ senderName, text, remoteJid, ticketResult, triage });
        }
        await notifier.send(escalationText);
      }
    }
  });

  return socket;
};

module.exports = { startWhatsAppClient };
