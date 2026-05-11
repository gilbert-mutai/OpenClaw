const axios = require("axios");

const createMattermostNotifier = ({ baseUrl, botToken, channelId, oncallTag }) => {
  if (!baseUrl || !botToken || !channelId) {
    console.warn("Mattermost direct API config missing (MATTERMOST_BASE_URL, MATTERMOST_BOT_TOKEN, MATTERMOST_CHANNEL_ID). Escalations disabled.");
  }

  const send = async (text) => {
    if (!baseUrl || !botToken || !channelId) return;

    await axios.post(
      `${baseUrl}/api/v4/posts`,
      { channel_id: channelId, message: text },
      { headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" } }
    );
  };

  return { send, oncallTag };
};

module.exports = { createMattermostNotifier };
