import assert from "node:assert/strict";
import net from "node:net";
import { after, test } from "node:test";
import { deliverMail } from "./lmtp.js";
import { composeMail, inspectEml, replaceHeaders } from "./mail.js";

const originalHost = process.env.LMTP_HOST;
const originalPort = process.env.LMTP_PORT;
after(() => {
  if (originalHost === undefined) delete process.env.LMTP_HOST; else process.env.LMTP_HOST = originalHost;
  if (originalPort === undefined) delete process.env.LMTP_PORT; else process.env.LMTP_PORT = originalPort;
});

test("compose and deliver through LMTP with per-recipient replies", async () => {
  let received = "";
  const server = net.createServer((socket) => {
    socket.setEncoding("latin1");
    socket.write("220 test ready\r\n");
    let buffer = "";
    let inData = false;
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write("250 2.1.5 delivered\r\n");
          } else received += `${line}\r\n`;
        } else if (line.startsWith("LHLO")) socket.write("250-test\r\n250 PIPELINING\r\n");
        else if (line.startsWith("MAIL FROM")) socket.write("250 sender accepted\r\n");
        else if (line.includes("reject@example.com")) socket.write("550 5.1.1 no such user\r\n");
        else if (line.startsWith("RCPT TO")) socket.write("250 recipient accepted\r\n");
        else if (line === "DATA") { inData = true; socket.write("354 send content\r\n"); }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    process.env.LMTP_HOST = "127.0.0.1";
    process.env.LMTP_PORT = String((server.address() as net.AddressInfo).port);
    const message = await composeMail({ from: "sender@example.com", to: "ok@example.com, reject@example.com", subject: "Pipeline test", text: ".first line", html: "<b>Hello</b>", attachments: [{ filename: "note.txt", content: Buffer.from("attached") }] });
    const result = await deliverMail(message, "sender@example.com", ["ok@example.com", "reject@example.com"]);
    assert.deepEqual([result.accepted, result.rejected], [1, 1]);
    assert.deepEqual(result.recipients.map((item) => item.code), [250, 550]);
    assert.match(received, /Subject: Pipeline test/);
    assert.match(received, /filename=note.txt/);
    assert.match(received, /\.\.first line/);
  } finally { server.close(); }
});

test(".eml header overrides preserve body bytes and attachments", async () => {
  const body = Buffer.from("Content-Type: application/octet-stream\r\n\r\n\x80\xffraw bytes", "latin1");
  const raw = Buffer.concat([Buffer.from("From: old@example.com\r\nTo: before@example.com\r\nSubject: Old\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\n"), body, Buffer.from("\r\n--x--\r\n")]);
  const updated = replaceHeaders(raw, { from: "new@example.com", to: "after@example.com", subject: "New" });
  assert.ok(updated.includes(body));
  const details = await inspectEml(updated);
  assert.equal(details.from, "new@example.com");
  assert.equal(details.to, "after@example.com");
  assert.equal(details.subject, "New");
});
