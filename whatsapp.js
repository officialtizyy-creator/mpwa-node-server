const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { Boom } = require("@hapi/boom");
const Pino = require("pino");
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(cors());

// Node server check
app.get("/", (req, res) => {
  res.send("MPWA Node Server Running 🎉");
});

const startSock = async () => {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    printQRInTerminal: false,
    browser: ["MPWA", "Chrome", "1.0.0"],
    auth: state,
    version,
    logger: Pino({ level: "silent" })
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        startSock();
      }
    } else if (connection === "open") {
      console.log("Connected to WhatsApp ✔");
    }
  });

  // Send message API
  app.post("/send", async (req, res) => {
    try {
      const { number, message } = req.body;
      await sock.sendMessage(number + "@s.whatsapp.net", { text: message });
      res.json({ status: true, msg: "Message sent successfully 🎉" });
    } catch (e) {
      res.json({ status: false, error: e.message });
    }
  });
};

startSock();

// Node server listening
const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log("Node server running on port", PORT);
});
