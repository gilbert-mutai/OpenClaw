const axios = require("axios");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isEmail = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

const sanitizeText = (value, fallback = "") => {
  const text = String(value || "").trim();
  return text || fallback;
};

const createERPNextClient = ({
  enabled,
  baseUrl,
  apiKey,
  apiSecret,
  doctype = "HD Ticket",
  clientPhoneField,
}) => {
  const isEnabled = enabled === true || enabled === "true";

  if (!isEnabled) console.warn("ERPNext integration disabled.");
  if (isEnabled && (!baseUrl || !apiKey || !apiSecret)) {
    console.warn("ERPNext config missing. Ticket creation disabled.");
  }

  const canSend = Boolean(isEnabled && baseUrl && apiKey && apiSecret);

  const http = axios.create({
    baseURL: String(baseUrl || "").replace(/\/+$/, ""),
    timeout: 15000,
    headers: {
      "Content-Type": "application/json",
      Authorization: `token ${apiKey}:${apiSecret}`,
    },
  });

  const requestWithRetry = async (fn, retries = 3) => {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const status = error?.response?.status;
        const retryable = !status || status === 429 || status >= 500;

        console.error("ERPNext request failed", {
          attempt,
          retries,
          status: status || "no-status",
          retryable,
          message: error?.message,
          erpnextExcType: error?.response?.data?.exc_type,
          erpnextException:
            typeof error?.response?.data?.exception === "string"
              ? error.response.data.exception.slice(0, 400)
              : undefined,
        });

        if (!retryable || attempt === retries) break;

        const backoffMs = 400 * attempt;
        await sleep(backoffMs);
      }
    }
    throw lastError;
  };

  const mapPriority = (value) => {
    const p = String(value || "").toLowerCase();
    if (p.includes("high") || p.includes("urgent") || p.includes("critical")) return "High";
    if (p.includes("low")) return "Low";
    return "Medium";
  };

  const createTicket = async ({
    subject,
    description,
    priority,
    clientPhone,
    clientName,
    sourceMessageId,
  }) => {
    if (!canSend) return null;

    const payload = {
      subject: sanitizeText(subject, "WhatsApp Support Request"),
      description: sanitizeText(description, "Client reported issue via WhatsApp."),
      priority: mapPriority(priority),
      custom_whatsapp: 1,
      custom_whatsapp_raised_by: clientName ? String(clientName).trim() : "",
    };

    if (clientPhoneField && clientPhone) {
      payload[clientPhoneField] = String(clientPhone).trim();
    }

    const fallbackRaisedByEmail = process.env.ERPNEXT_RAISED_BY_EMAIL;
    const safeClientName = String(clientName || "").trim();

    if (isEmail(safeClientName)) {
      payload.raised_by = safeClientName;
    } else if (isEmail(fallbackRaisedByEmail)) {
      payload.raised_by = String(fallbackRaisedByEmail).trim();
    }

    const sourceMessageField = process.env.ERPNEXT_SOURCE_MESSAGE_FIELD;
    if (sourceMessageField && sourceMessageId) {
      payload[sourceMessageField] = String(sourceMessageId).trim();
    }

    console.log("ERPNext payload:", payload, "Doctype:", doctype);

    try {
      const response = await requestWithRetry(() =>
        http.post(`/api/resource/${encodeURIComponent(doctype)}`, payload)
      );

      const ticketId = response?.data?.data?.name || null;
      console.log("ERPNext ticket created", {
        doctype,
        ticketId,
        subject: payload.subject,
        raised_by: payload.raised_by || null,
      });

      return ticketId;
    } catch (error) {
      console.error("ERPNext ticket create failed", {
        doctype,
        subject: payload.subject,
        raised_by: payload.raised_by || null,
        status: error?.response?.status || null,
        excType: error?.response?.data?.exc_type || null,
        errors: error?.response?.data?.errors || null,
      });
      throw error;
    }
  };

  const reopenTicket = async ({ ticketId }) => {
    if (!canSend || !ticketId) return null;

    const reopenStatus = process.env.ERPNEXT_REOPEN_STATUS || "Open";
    const closedStatuses = String(process.env.ERPNEXT_CLOSED_STATUSES || "Closed,Resolved")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);

    const getStatus = async () => {
      try {
        const res = await requestWithRetry(() =>
          http.get(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(ticketId)}`)
        );
        return String(res?.data?.data?.status || "").trim();
      } catch (error) {
        console.warn("ERPNext get status failed", {
          ticketId,
          status: error?.response?.status || null,
          excType: error?.response?.data?.exc_type || null,
        });
        return "";
      }
    };

    const before = await getStatus();
    if (before && !closedStatuses.includes(before.toLowerCase())) {
      return true;
    }

    // Attempt 1: direct doctype update
    try {
      await requestWithRetry(() =>
        http.put(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(ticketId)}`, {
          status: reopenStatus,
        })
      );
    } catch (error) {
      console.warn("ERPNext reopen via PUT failed", {
        ticketId,
        status: error?.response?.status || null,
        excType: error?.response?.data?.exc_type || null,
      });
    }

    // Attempt 2: frappe client set_value
    try {
      await requestWithRetry(() =>
        http.post("/api/method/frappe.client.set_value", {
          doctype,
          name: ticketId,
          fieldname: "status",
          value: reopenStatus,
        })
      );
    } catch (error) {
      console.warn("ERPNext reopen via set_value failed", {
        ticketId,
        status: error?.response?.status || null,
        excType: error?.response?.data?.exc_type || null,
      });
    }

    const after = await getStatus();
    const reopened = String(after || "").toLowerCase() === String(reopenStatus).toLowerCase();

    console.log("ERPNext reopen result", {
      ticketId,
      beforeStatus: before || null,
      afterStatus: after || null,
      reopened,
    });
    return reopened;
  };

  const appendComment = async ({ ticketId, content }) => {
    if (!canSend || !ticketId) return null;

    const payload = {
      comment_type: "Comment",
      reference_doctype: doctype,
      reference_name: ticketId,
      content: sanitizeText(content),
    };

    await requestWithRetry(() => http.post("/api/resource/Comment", payload));
    return true;
  };

  return { createTicket, appendComment, reopenTicket, isEnabled: canSend, doctype };
};

module.exports = { createERPNextClient };
