const buildEscalationMessage = ({
  senderName,
  text,
  remoteJid,
  ticketResult,
  triage,
}) => {
  const name = senderName || "there";
  const ticketId = ticketResult?.ticketId ? `Ticket: ${ticketResult.ticketId}` : "";
  const priority = triage?.priority || "Medium";
  return [
    `WhatsApp escalation`,
    `From: ${name}`,
    ticketId,
    `Priority: ${priority}`,
    `Message: ${text}`,
  ]
    .filter(Boolean)
    .join("\n");
};

const buildAckMessage = ({ senderName, triage, ticketResult, text }) => {
  const name = senderName || "there";
  const ticketId = ticketResult?.ticketId ? ` Ticket: ${ticketResult.ticketId}.` : "";
  return `Hello ${name}, thank you for reaching out. Your message has been received and our team will respond shortly.${ticketId}`;
};

module.exports = { buildEscalationMessage, buildAckMessage };
