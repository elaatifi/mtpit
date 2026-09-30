import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeMail, envelopeFromEml, inspectEml, replaceHeaders, validateAddressList } from "./mail.js";
import { deliverMail, type DeliveryResult } from "./lmtp.js";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 20, fields: 12 },
});

type HistoryItem = {
  id: string;
  time: string;
  source: "compose" | "eml";
  from: string;
  to: string[];
  subject: string;
  result: DeliveryResult;
};
const history: HistoryItem[] = [];

function required(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function record(item: Omit<HistoryItem, "id" | "time">) {
  const entry = { ...item, id: crypto.randomUUID(), time: new Date().toISOString() };
  history.unshift(entry);
  history.length = Math.min(history.length, 50);
  return entry;
}

app.get("/api/config", (_request, response) => {
  response.json({
    endpoint: process.env.LMTP_SOCKET || `${process.env.LMTP_HOST || "127.0.0.1"}:${process.env.LMTP_PORT || "8027"}`,
  });
});

app.get("/api/messages", (_request, response) => response.json(history));

app.post("/api/inspect-eml", upload.single("eml"), async (request, response, next) => {
  try {
    if (!request.file) throw new Error("Choose an .eml file");
    response.json(await inspectEml(request.file.buffer));
  } catch (error) { next(error); }
});

app.post("/api/send", upload.array("attachments", 20), async (request, response, next) => {
  try {
    const from = required(request.body.from, "From");
    const to = required(request.body.to, "To");
    const subject = required(request.body.subject, "Subject");
    if (validateAddressList(from, "From").length !== 1) throw new Error("From must contain one address");
    const recipients = validateAddressList(to, "To");
    const text = optional(request.body.text) || "";
    const html = optional(request.body.html) || "";
    if (!text && !html) throw new Error("Add a text or HTML body");
    const files = request.files as Express.Multer.File[];
    const message = await composeMail({
      from, to, subject, text, html,
      attachments: files.map((file) => ({ filename: file.originalname, content: file.buffer, contentType: file.mimetype })),
    });
    const result = await deliverMail(message, from, recipients);
    response.json(record({ source: "compose", from, to: recipients, subject, result }));
  } catch (error) { next(error); }
});

app.post("/api/send-eml", upload.single("eml"), async (request, response, next) => {
  try {
    if (!request.file) throw new Error("Choose an .eml file");
    const overrides = {
      from: optional(request.body.from),
      to: optional(request.body.to),
      subject: optional(request.body.subject),
    };
    if (overrides.subject && /[\r\n]/.test(overrides.subject)) throw new Error("Subject contains a line break");
    const message = replaceHeaders(request.file.buffer, overrides);
    const envelope = await envelopeFromEml(message, overrides);
    const details = await inspectEml(message);
    const result = await deliverMail(message, envelope.from, envelope.to);
    response.json(record({
      source: "eml", from: envelope.from, to: envelope.to,
      subject: details.subject, result,
    }));
  } catch (error) { next(error); }
});

app.use("/api", (_request, response) => response.status(404).json({ error: "API route not found" }));
app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const isLimit = error instanceof multer.MulterError;
  const isConnection = /^(connect|ECONN|EHOST|ENET|LMTP|Greeting|LHLO|MAIL FROM|DATA)/i.test(error.message);
  response.status(isLimit ? 413 : isConnection ? 502 : 400).json({ error: error.message });
});

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "../dist");
app.use(express.static(dist));
app.get("/{*path}", (_request, response) => response.sendFile(path.join(dist, "index.html")));

const port = Number(process.env.PORT || 3001);
app.listen(port, "0.0.0.0", () => console.log(`LMTPit listening on http://0.0.0.0:${port}`));
