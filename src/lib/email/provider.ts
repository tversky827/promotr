import { integrations } from '@/lib/env';
import { logger } from '@/lib/observability/logger';

/**
 * Email delivery.
 *
 * One interface, four real providers, plus a `console` provider for
 * development that prints the rendered message instead of sending it. There is
 * no silent no-op: if the configured provider rejects a message, `send` throws
 * and the job queue retries with backoff, so a transient outage does not lose
 * a password reset.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  tags?: Record<string, string>;
}

export interface SendResult {
  id: string;
  provider: string;
}

export class EmailNotConfiguredError extends Error {
  readonly code = 'EMAIL_NOT_CONFIGURED';
  constructor() {
    super(
      'Email is not configured. Set EMAIL_PROVIDER and EMAIL_API_KEY to enable outbound email.',
    );
    this.name = 'EmailNotConfiguredError';
  }
}

export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const provider = integrations.email.provider;

  if (!integrations.email.configured) {
    throw new EmailNotConfiguredError();
  }

  switch (provider) {
    case 'resend':
      return sendViaResend(message);
    case 'postmark':
      return sendViaPostmark(message);
    case 'sendgrid':
      return sendViaSendgrid(message);
    case 'smtp':
      return sendViaSmtp(message);
    case 'console':
    default:
      return sendToConsole(message);
  }
}

async function sendViaResend(message: EmailMessage): Promise<SendResult> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${integrations.email.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: integrations.email.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      reply_to: message.replyTo ?? (integrations.email.replyTo || undefined),
      tags: message.tags
        ? Object.entries(message.tags).map(([name, value]) => ({ name, value }))
        : undefined,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Resend rejected the message (HTTP ${response.status}): ${await safeBody(response)}`);
  }
  const data = (await response.json()) as { id: string };
  return { id: data.id, provider: 'resend' };
}

async function sendViaPostmark(message: EmailMessage): Promise<SendResult> {
  const response = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'X-Postmark-Server-Token': integrations.email.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      From: integrations.email.from,
      To: message.to,
      Subject: message.subject,
      HtmlBody: message.html,
      TextBody: message.text,
      ReplyTo: message.replyTo ?? (integrations.email.replyTo || undefined),
      MessageStream: 'outbound',
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Postmark rejected the message (HTTP ${response.status}): ${await safeBody(response)}`);
  }
  const data = (await response.json()) as { MessageID: string };
  return { id: data.MessageID, provider: 'postmark' };
}

async function sendViaSendgrid(message: EmailMessage): Promise<SendResult> {
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${integrations.email.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: message.to }] }],
      from: parseFromHeader(integrations.email.from),
      subject: message.subject,
      content: [
        { type: 'text/plain', value: message.text },
        { type: 'text/html', value: message.html },
      ],
      ...(message.replyTo || integrations.email.replyTo
        ? { reply_to: { email: message.replyTo ?? integrations.email.replyTo } }
        : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`SendGrid rejected the message (HTTP ${response.status}): ${await safeBody(response)}`);
  }
  // SendGrid returns the id in a header rather than a body.
  return { id: response.headers.get('x-message-id') ?? 'accepted', provider: 'sendgrid' };
}

/**
 * SMTP. Implemented over a raw TLS socket rather than adding nodemailer:
 * the protocol subset needed to send one message is small, and it keeps the
 * dependency surface of a security-sensitive service minimal.
 */
async function sendViaSmtp(message: EmailMessage): Promise<SendResult> {
  const { sendSmtpMessage } = await import('@/lib/email/smtp');
  return sendSmtpMessage(message);
}

async function sendToConsole(message: EmailMessage): Promise<SendResult> {
  logger.info('email.console', {
    to: message.to,
    subject: message.subject,
    // The text body is logged in full so development flows (verification
    // links, reset tokens) are usable without a mail provider.
    text: message.text,
  });
  return { id: `console-${Date.now()}`, provider: 'console' };
}

function parseFromHeader(from: string): { email: string; name?: string } {
  const match = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(from);
  if (match) return { email: match[2]!.trim(), name: match[1]?.trim() || undefined };
  return { email: from.trim() };
}

async function safeBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return '<no body>';
  }
}
