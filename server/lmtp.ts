import net from "node:net";

export type RecipientResult = { address: string; code: number; message: string };
export type DeliveryResult = { recipients: RecipientResult[]; accepted: number; rejected: number };

type Reply = { code: number; message: string };

class LmtpConnection {
  private buffer = "";
  private lines: string[] = [];
  private waiter?: { resolve: (line: string) => void; reject: (error: Error) => void };
  private failure?: Error;

  constructor(private socket: net.Socket) {
    socket.setTimeout(15_000, () => socket.destroy(new Error("LMTP server timed out")));
    socket.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      let end: number;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end).replace(/\r$/, "");
        this.buffer = this.buffer.slice(end + 1);
        if (this.waiter) {
          const waiter = this.waiter;
          this.waiter = undefined;
          waiter.resolve(line);
        } else {
          this.lines.push(line);
        }
      }
    });
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("LMTP connection closed")));
  }

  private fail(error: Error) {
    this.failure = error;
    this.waiter?.reject(error);
    this.waiter = undefined;
  }

  private readLine(): Promise<string> {
    if (this.lines.length) return Promise.resolve(this.lines.shift()!);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
  }

  async reply(): Promise<Reply> {
    const messages: string[] = [];
    let code = 0;
    while (true) {
      const line = await this.readLine();
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match) throw new Error(`Invalid LMTP reply: ${line}`);
      if (code && Number(match[1]) !== code) throw new Error(`Inconsistent LMTP reply: ${line}`);
      code = Number(match[1]);
      messages.push(match[3]);
      if (match[2] === " ") return { code, message: messages.join(" ") };
    }
  }

  command(command: string) {
    this.socket.write(`${command}\r\n`);
    return this.reply();
  }

  data(message: Buffer) {
    // latin1 maps each byte to one code point, so 8-bit MIME content survives unchanged.
    const normalized = message.toString("latin1").replace(/\r\n|\r|\n/g, "\n");
    const stuffed = normalized.split("\n").map((line) => line.startsWith(".") ? `.${line}` : line).join("\r\n");
    this.socket.write(Buffer.from(`${stuffed.replace(/\r\n$/, "")}\r\n.\r\n`, "latin1"));
  }

  close() { this.socket.end(); }
  destroy() { this.socket.destroy(); }
}

function requireCode(reply: Reply, expected: number, step: string) {
  if (reply.code !== expected) throw new Error(`${step}: ${reply.code} ${reply.message}`);
}

export async function deliverMail(message: Buffer, sender: string, recipients: string[]): Promise<DeliveryResult> {
  const socket = process.env.LMTP_SOCKET
    ? net.createConnection(process.env.LMTP_SOCKET)
    : net.createConnection({ host: process.env.LMTP_HOST || "127.0.0.1", port: Number(process.env.LMTP_PORT || 8027) });
  const connection = new LmtpConnection(socket);
  try {
    await new Promise<void>((resolve, reject) => {
      if (socket.readyState === "open") return resolve();
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    requireCode(await connection.reply(), 220, "Greeting");
    requireCode(await connection.command("LHLO lmtpit"), 250, "LHLO");
    requireCode(await connection.command(`MAIL FROM:<${sender}>`), 250, "MAIL FROM");

    const results: RecipientResult[] = [];
    const accepted: RecipientResult[] = [];
    for (const address of recipients) {
      const reply = await connection.command(`RCPT TO:<${address}>`);
      const result = { address, code: reply.code, message: reply.message };
      results.push(result);
      if (reply.code >= 200 && reply.code < 300) accepted.push(result);
    }
    if (accepted.length) {
      requireCode(await connection.command("DATA"), 354, "DATA");
      connection.data(message);
      for (const result of accepted) {
        const reply = await connection.reply();
        result.code = reply.code;
        result.message = reply.message;
      }
    }
    const delivered = results.filter((result) => result.code >= 200 && result.code < 300).length;
    return { recipients: results, accepted: delivered, rejected: results.length - delivered };
  } finally {
    connection.close();
    connection.destroy();
  }
}
