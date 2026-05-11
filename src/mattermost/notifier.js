const axios = require("axios");

const createMattermostNotifier = ({ hookUrl, hookToken, channelId, oncallTag }) => {
  if (!hookUrl || !hookToken || !channelId) {
    console.warn("OpenClaw hook config missing. Escalations disabled.");
  }

  const send = async (text) => {
    if (!hookUrl || !hookToken || !channelId) return;

    const payload = {
      message: text,
      name: "WhatsApp",
      wakeMode: "now",
      deliver: true,
      channel: "mattermost",
      to: `channel:${channelId}`,
    };

    await axios.post(hookUrl, payload, {
      headers: {
        "Content-Type": "application/json",
        "x-openclaw-token": hookToken,
      },
    });
  };

  return { send, oncallTag };
};

module.exports = { createMattermostNotifier };
