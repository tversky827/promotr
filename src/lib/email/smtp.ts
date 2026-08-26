import { createConnection, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

import { integrations } from '@/lib/env';

import type { EmailMessage, SendResult } from '@/lib/email/provider';

/**
 * Minimal ESMTP client: EHLO, STARTTLS, AUTH LOGIN, MAIL FROM, RCPT TO, DATA.
 * Enough to deliver a single message through any standards-compliant relay.
 *
 * TLS is mandatory. Credentials are never sent over an unencrypted connection —
 * if STARTTLS is unavailable on a non-465 port, the send fails rather than
 * falling back to plaintext auth.
 */

export async function sendSmtpMessage(message: EmailMessage): Promise<SendResult> {
  const { host, port, user, password } = integrations.email.smtp;
  if (!host || !user) throw new Error('SMTP host and user must be configured');

  const implicitTls = port === 465;
  let socket: Socket | TLSSocket = implicitTls
    ? tlsConnect({ host, port, servername: host })
    : createConnection({ host, port });

  const session = new SmtpSession(socket);
  try {
    await session.waitFor(220);
    await session.command(`EHLO ${hostname()}`, 250);

    if (!implicitTls) {
      await session.command('STARTTLS', 220);
      socket = await session.upgradeTls(host);
      await session.command(`EHLO ${hostname()}`, 250);
    }

    await session.command('AUTH LOGIN', 334);
    await session.command(Buffer.from(user).toString('base64'), 334);
    await session.command(Buffer.from(password).toString('base64'), 235);

    const from = extractAddress(integrations.email.from);
    await session.command(`MAIL FROM:<${from}>`, 250);
    await session.command(`RCPT TO:<${extractAddress(message.to)}>`, 250);
    await session.command('DATA', 354);
    await session.command(buildMimeMessage(message, from), 250);
    await session.command('QUIT', 221).catch(() => undefined);

    return { id: `smtp-${Date.now()}`, provider: 'smtp' };
  } finally {
    session.close();
  }
}

class SmtpSession {
  private buffer = '';
  private resolvers: Array<{
    expect: number;
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(private socket: Socket | TLSSocket) {
    this.attach();
  }

  private attach(): void {
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    this.socket.on('error', (error) => {
      for (const r of this.resolvers.splice(0)) r.reject(error);
    });
  }

  private drain(): void {
    // A complete reply ends with "NNN " (space, not hyphen) then CRLF.
    const lines = this.buffer.split('\r\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (/^\d{3} /.test(line)) {
        const consumed = lines.slice(0, i + 1).join('\r\n') + '\r\n';
        this.buffer = this.buffer.slice(consumed.length);
        const code = Number(line.slice(0, 3));
        const waiter = this.resolvers.shift();
        if (waiter) {
          if (code === waiter.expect) waiter.resolve(line);
          else waiter.reject(new Error(`SMTP expected ${waiter.expect}, got: ${line}`));
        }
        this.drain();
        return;
      }
    }
  }

  waitFor(expect: number): Promise<string> {
    return new Promise((resolve, reject) => {
      this.resolvers.push({ expect, resolve, reject });
      setTimeout(() => reject(new Error(`SMTP timed out waiting for ${expect}`)), 20_000);
    });
  }

  async command(text: string, expect: number): Promise<string> {
    const promise = this.waitFor(expect);
    this.socket.write(`${text}\r\n`);
    return promise;
  }

  async upgradeTls(host: string): Promise<TLSSocket> {
    const plain = this.socket;
    plain.removeAllListeners('data');
    const secure = tlsConnect({ socket: plain as Socket, servername: host });
    await new Promise<void>((resolve, reject) => {
      secure.once('secureConnect', () => resolve());
      secure.once('error', reject);
    });
    this.socket = secure;
    this.buffer = '';
    this.attach();
    return secure;
  }

  close(): void {
    this.socket.destroy();
  }
}

function buildMimeMessage(message: EmailMessage, from: string): string {
  const boundary = `----=_Part_${Date.now().toString(36)}`;
  const lines = [
    `From: ${integrations.email.from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@${from.split('@')[1]}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    dotStuff(message.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    dotStuff(message.html),
    `--${boundary}--`,
    '.',
  ];
  return lines.join('\r\n');
}

/** A line consisting of a single dot terminates DATA, so escape them. */
function dotStuff(body: string): string {
  return body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`;
}

function extractAddress(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match ? match[1]! : value).trim();
}

function hostname(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost').hostname;
  } catch {
    return 'localhost';
  }
}
