import { simpleParser } from "mailparser";
import MailComposer from "nodemailer/lib/mail-composer/index.js";

export type MailDetails = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; size: number }[];
};

export function validateAddressList(value: string, label: string): string[] {
  if (/[\r\n]/.test(value)) throw new Error(`${label} contains a line break`);
  const addresses = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (!addresses.length || addresses.some((item) => !/^[^\s<>@,]+@[^\s<>@,]+$/.test(item))) {
    throw new Error(`Enter valid ${label.toLowerCase()} addresses separated by commas`);
  }
  return [...new Set(addresses)];
}

export function encodeHeader(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("Header contains a line break");
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const words: string[] = [];
  let chunk = "";
  for (const character of value) {
    if (Buffer.byteLength(chunk + character) > 45) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk).toString("base64")}?=`);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk).toString("base64")}?=`);
  return words.join(" ");
}

export function replaceHeaders(raw: Buffer, overrides: { from?: string; to?: string; subject?: string }): Buffer {
  const separator = raw.indexOf("\r\n\r\n") >= 0 ? "\r\n" : "\n";
  const boundary = raw.indexOf(separator + separator);
  if (boundary < 0) throw new Error("The .eml file has no header/body separator");
  const header = raw.subarray(0, boundary).toString("latin1");
  const lines = header.split(separator);
  const wanted = Object.entries(overrides).filter(([, value]) => value !== undefined && value !== "");
  if (!wanted.length) return raw;
  const keys = new Set(wanted.map(([key]) => key.toLowerCase()));
  const kept: string[] = [];
  let skip = false;
  for (const line of lines) {
    if (/^[ \t]/.test(line)) {
      if (!skip) kept.push(line);
      continue;
    }
    const name = /^([^:]+):/.exec(line)?.[1].toLowerCase();
    skip = name ? keys.has(name) : false;
    if (!skip) kept.push(line);
  }
  for (const [key, value] of wanted) kept.push(`${key[0].toUpperCase()}${key.slice(1)}: ${encodeHeader(value!)}`);
  return Buffer.concat([
    Buffer.from(kept.join(separator) + separator + separator, "latin1"),
    raw.subarray(boundary + separator.length * 2),
  ]);
}

export async function inspectEml(raw: Buffer): Promise<MailDetails> {
  const parsed = await simpleParser(raw);
  return {
    from: parsed.from?.value.map((item) => item.address).filter(Boolean).join(", ") || "",
    to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]).flatMap((group) => group.value.map((item) => item.address)).filter(Boolean).join(", ") : "",
    subject: parsed.subject || "",
    text: parsed.text || "",
    html: typeof parsed.html === "string" ? parsed.html : "",
    attachments: parsed.attachments.map((item) => ({ filename: item.filename || "attachment", size: item.size })),
  };
}

export async function envelopeFromEml(raw: Buffer, overrides: { from?: string; to?: string }) {
  const parsed = await simpleParser(raw);
  const from = overrides.from
    ? validateAddressList(overrides.from, "From")[0]
    : parsed.from?.value.find((item) => item.address)?.address;
  const recipientGroups = [parsed.to, parsed.cc, parsed.bcc].flat().filter(Boolean);
  const to = overrides.to
    ? validateAddressList(overrides.to, "To")
    : recipientGroups.flatMap((group) => group!.value.map((item) => item.address).filter((item): item is string => !!item));
  if (!from) throw new Error("The .eml file needs a From address or override");
  if (!to.length) throw new Error("The .eml file needs a To address or override");
  return { from, to: [...new Set(to)] };
}

export async function composeMail(input: {
  from: string; to: string; subject: string; text: string; html: string;
  attachments: { filename: string; content: Buffer; contentType?: string }[];
}): Promise<Buffer> {
  const composer = new MailComposer({
    from: input.from,
    to: input.to,
    subject: input.subject,
    text: input.text || undefined,
    html: input.html || undefined,
    attachments: input.attachments,
  });
  return composer.compile().build();
}
