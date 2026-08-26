import { brand } from '@/lib/brand';
import { formatMicros } from '@/lib/money';

/**
 * Transactional email templates.
 *
 * Rendered server-side into inline-styled HTML plus a plain-text alternative.
 * No external template engine and no remote assets: mail clients strip most
 * modern CSS, and a template that depends on a CDN breaks in half of them.
 *
 * Every template takes its colours and names from the brand config, so
 * re-skinning the product re-skins the email too.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const ACCENT = `hsl(${brand.primaryHsl})`;

function layout(params: {
  heading: string;
  body: string;
  cta?: { label: string; url: string };
  footNote?: string;
}): string {
  return `
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(params.heading)}</title></head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1d23;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
        <tr><td style="padding:28px 32px 0;">
          <div style="font-size:17px;font-weight:700;letter-spacing:-0.3px;color:${ACCENT};">${escapeHtml(brand.name)}</div>
        </td></tr>
        <tr><td style="padding:20px 32px 0;">
          <h1 style="margin:0 0 12px;font-size:21px;line-height:1.3;font-weight:650;letter-spacing:-0.3px;">${escapeHtml(params.heading)}</h1>
          <div style="font-size:15px;line-height:1.6;color:#42474f;">${params.body}</div>
        </td></tr>
        ${
          params.cta
            ? `<tr><td style="padding:24px 32px 0;">
          <a href="${escapeAttr(params.cta.url)}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px;">${escapeHtml(params.cta.label)}</a>
        </td></tr>
        <tr><td style="padding:14px 32px 0;">
          <div style="font-size:12.5px;line-height:1.5;color:#8b9099;">If the button does not work, copy this link into your browser:<br><span style="color:#5c626b;word-break:break-all;">${escapeHtml(params.cta.url)}</span></div>
        </td></tr>`
            : ''
        }
        <tr><td style="padding:28px 32px 28px;">
          ${params.footNote ? `<div style="font-size:12.5px;line-height:1.6;color:#8b9099;border-top:1px solid #eef0f3;padding-top:16px;">${params.footNote}</div>` : ''}
        </td></tr>
      </table>
      <div style="max-width:560px;margin:16px auto 0;font-size:12px;line-height:1.6;color:#9aa0a8;text-align:center;">
        ${escapeHtml(brand.legalName)} · <a href="${escapeAttr(brand.appUrl)}" style="color:#9aa0a8;">${escapeHtml(stripScheme(brand.appUrl))}</a><br>
        Questions? <a href="mailto:${escapeAttr(brand.supportEmail)}" style="color:#9aa0a8;">${escapeHtml(brand.supportEmail)}</a>
      </div>
    </td></tr>
  </table>
</body></html>`.trim();
}

function textLayout(heading: string, lines: string[], cta?: { label: string; url: string }): string {
  const parts = [brand.name, '', heading, '', ...lines];
  if (cta) parts.push('', `${cta.label}: ${cta.url}`);
  parts.push('', '—', `${brand.legalName} · ${stripScheme(brand.appUrl)}`, `Support: ${brand.supportEmail}`);
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export function verifyEmailTemplate(params: { name: string; url: string }): RenderedEmail {
  const heading = `Confirm your email address`;
  return {
    subject: `Confirm your email address`,
    html: layout({
      heading,
      body: `<p style="margin:0 0 12px;">Hi ${escapeHtml(params.name)}, welcome to ${escapeHtml(brand.name)}.</p>
             <p style="margin:0;">Confirm this address to activate your account.</p>`,
      cta: { label: 'Confirm email address', url: params.url },
      footNote: 'This link expires in 24 hours. If you did not create an account, you can ignore this email.',
    }),
    text: textLayout(
      heading,
      [`Hi ${params.name}, welcome to ${brand.name}.`, '', 'Confirm this address to activate your account.', '', 'This link expires in 24 hours.'],
      { label: 'Confirm', url: params.url },
    ),
  };
}

export function passwordResetTemplate(params: { name: string; url: string }): RenderedEmail {
  const heading = 'Reset your password';
  return {
    subject: 'Reset your password',
    html: layout({
      heading,
      body: `<p style="margin:0;">Hi ${escapeHtml(params.name)}, we received a request to reset your password.</p>`,
      cta: { label: 'Choose a new password', url: params.url },
      footNote:
        'This link expires in one hour and can be used once. If you did not request this, no action is needed — your password has not changed.',
    }),
    text: textLayout(
      heading,
      [`Hi ${params.name}, we received a request to reset your password.`, '', 'This link expires in one hour and can be used once.', 'If you did not request this, your password has not changed.'],
      { label: 'Reset password', url: params.url },
    ),
  };
}

export function magicLinkTemplate(params: { url: string }): RenderedEmail {
  const heading = `Sign in to ${brand.name}`;
  return {
    subject: `Your sign-in link`,
    html: layout({
      heading,
      body: `<p style="margin:0;">Use the button below to sign in. The link expires in 15 minutes.</p>`,
      cta: { label: 'Sign in', url: params.url },
      footNote: 'If you did not request this link, you can ignore this email.',
    }),
    text: textLayout(heading, ['Use the link below to sign in. It expires in 15 minutes.'], {
      label: 'Sign in',
      url: params.url,
    }),
  };
}

// ---------------------------------------------------------------------------
// Publisher
// ---------------------------------------------------------------------------

export function earningTemplate(params: {
  name: string;
  amountMicros: bigint;
  campaignName: string;
  url: string;
}): RenderedEmail {
  const amount = formatMicros(params.amountMicros);
  const heading = `You earned ${amount}`;
  return {
    subject: `You earned ${amount} from ${params.campaignName}`,
    html: layout({
      heading,
      body: `<p style="margin:0 0 12px;">Nice work, ${escapeHtml(params.name)}.</p>
             <p style="margin:0;">You earned <strong>${escapeHtml(amount)}</strong> from <strong>${escapeHtml(params.campaignName)}</strong>.</p>`,
      cta: { label: 'View your earnings', url: params.url },
      footNote:
        'Earnings are held briefly for verification before becoming available to withdraw. Your dashboard shows the current status of every earning.',
    }),
    text: textLayout(
      heading,
      [`Nice work, ${params.name}.`, '', `You earned ${amount} from ${params.campaignName}.`],
      { label: 'View earnings', url: params.url },
    ),
  };
}

export function payoutSentTemplate(params: {
  name: string;
  amountMicros: bigint;
  url: string;
}): RenderedEmail {
  const amount = formatMicros(params.amountMicros);
  const heading = `${amount} is on its way`;
  return {
    subject: `Your ${amount} payout has been sent`,
    html: layout({
      heading,
      body: `<p style="margin:0 0 12px;">Hi ${escapeHtml(params.name)},</p>
             <p style="margin:0;">Your payout of <strong>${escapeHtml(amount)}</strong> has been sent to your connected payout account.</p>`,
      cta: { label: 'View payout history', url: params.url },
      footNote:
        'Funds typically arrive within 1–3 business days, depending on your bank.',
    }),
    text: textLayout(
      heading,
      [`Hi ${params.name},`, '', `Your payout of ${amount} has been sent.`, '', 'Funds typically arrive within 1–3 business days.'],
      { label: 'View payouts', url: params.url },
    ),
  };
}

export function payoutFailedTemplate(params: {
  name: string;
  amountMicros: bigint;
  reason: string;
  url: string;
}): RenderedEmail {
  const amount = formatMicros(params.amountMicros);
  const heading = 'Your payout could not be completed';
  return {
    subject: 'Action needed: your payout could not be completed',
    html: layout({
      heading,
      body: `<p style="margin:0 0 12px;">Hi ${escapeHtml(params.name)},</p>
             <p style="margin:0 0 12px;">We were unable to send your payout of <strong>${escapeHtml(amount)}</strong>.</p>
             <p style="margin:0;"><strong>Reason:</strong> ${escapeHtml(params.reason)}</p>`,
      cta: { label: 'Check your payout settings', url: params.url },
      footNote:
        'Your balance has been returned in full and is available to withdraw again once the issue is resolved. Nothing has been lost.',
    }),
    text: textLayout(
      heading,
      [
        `Hi ${params.name},`,
        '',
        `We were unable to send your payout of ${amount}.`,
        `Reason: ${params.reason}`,
        '',
        'Your balance has been returned in full and is available to withdraw again.',
      ],
      { label: 'Payout settings', url: params.url },
    ),
  };
}

export function trafficWarningTemplate(params: {
  name: string;
  campaignName: string;
  reason: string;
  url: string;
}): RenderedEmail {
  const heading = 'Some of your traffic is under review';
  return {
    subject: 'Some of your recent traffic is under review',
    html: layout({
      heading,
      body: `<p style="margin:0 0 12px;">Hi ${escapeHtml(params.name)},</p>
             <p style="margin:0 0 12px;">Some traffic you sent to <strong>${escapeHtml(params.campaignName)}</strong> has been flagged for manual review.</p>
             <p style="margin:0;"><strong>What was flagged:</strong> ${escapeHtml(params.reason)}</p>`,
      cta: { label: 'Review the details', url: params.url },
      footNote:
        'Your earnings from this traffic are being held, not removed. If the review clears them they become available as normal, and you can open a dispute from your dashboard if you believe this is a mistake.',
    }),
    text: textLayout(
      heading,
      [
        `Hi ${params.name},`,
        '',
        `Some traffic you sent to ${params.campaignName} has been flagged for review.`,
        `What was flagged: ${params.reason}`,
        '',
        'Your earnings are being held, not removed. You can dispute this from your dashboard.',
      ],
      { label: 'Review details', url: params.url },
    ),
  };
}

export function campaignEndingTemplate(params: {
  name: string;
  campaignName: string;
  endsAt: Date;
  url: string;
}): RenderedEmail {
  const heading = `${params.campaignName} is ending soon`;
  return {
    subject: `${params.campaignName} is ending soon`,
    html: layout({
      heading,
      body: `<p style="margin:0 0 12px;">Hi ${escapeHtml(params.name)},</p>
             <p style="margin:0;">A campaign you are promoting ends on <strong>${escapeHtml(params.endsAt.toUTCString())}</strong>. Clicks after that point will not earn.</p>`,
      cta: { label: 'View campaign', url: params.url },
    }),
    text: textLayout(
      heading,
      [`Hi ${params.name},`, '', `${params.campaignName} ends on ${params.endsAt.toUTCString()}.`],
      { label: 'View campaign', url: params.url },
    ),
  };
}

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

export function campaignApprovedTemplate(params: {
  campaignName: string;
  url: string;
}): RenderedEmail {
  const heading = `${params.campaignName} is approved`;
  return {
    subject: `${params.campaignName} has been approved`,
    html: layout({
      heading,
      body: `<p style="margin:0;">Your campaign has been reviewed and approved. Fund it to make it visible to publishers.</p>`,
      cta: { label: 'Fund and launch', url: params.url },
    }),
    text: textLayout(heading, ['Your campaign has been approved. Fund it to make it visible to publishers.'], {
      label: 'Fund and launch',
      url: params.url,
    }),
  };
}

export function campaignRejectedTemplate(params: {
  campaignName: string;
  reason: string;
  url: string;
}): RenderedEmail {
  const heading = `${params.campaignName} needs changes`;
  return {
    subject: `${params.campaignName} was not approved`,
    html: layout({
      heading,
      body: `<p style="margin:0 0 12px;">Your campaign was reviewed and could not be approved as submitted.</p>
             <p style="margin:0;"><strong>Reason:</strong> ${escapeHtml(params.reason)}</p>`,
      cta: { label: 'Edit and resubmit', url: params.url },
      footNote: 'You can edit the campaign and submit it for review again at any time.',
    }),
    text: textLayout(
      heading,
      ['Your campaign could not be approved as submitted.', `Reason: ${params.reason}`],
      { label: 'Edit and resubmit', url: params.url },
    ),
  };
}

export function budgetLowTemplate(params: {
  campaignName: string;
  remainingMicros: bigint;
  percentRemaining: number;
  url: string;
}): RenderedEmail {
  const remaining = formatMicros(params.remainingMicros);
  const heading = `${params.campaignName} is running low on budget`;
  return {
    subject: `Budget alert: ${params.campaignName} has ${remaining} left`,
    html: layout({
      heading,
      body: `<p style="margin:0 0 12px;"><strong>${escapeHtml(remaining)}</strong> remains — about ${params.percentRemaining.toFixed(0)}% of the campaign budget.</p>
             <p style="margin:0;">When the budget runs out the campaign stops accruing billable activity. Publishers keep sending traffic, but you are not charged for it.</p>`,
      cta: { label: 'Add funds', url: params.url },
    }),
    text: textLayout(
      heading,
      [
        `${remaining} remains — about ${params.percentRemaining.toFixed(0)}% of the campaign budget.`,
        '',
        'When the budget runs out the campaign stops accruing billable activity.',
      ],
      { label: 'Add funds', url: params.url },
    ),
  };
}

export function paymentFailedTemplate(params: { reason: string; url: string }): RenderedEmail {
  const heading = 'A payment could not be completed';
  return {
    subject: 'Action needed: a payment could not be completed',
    html: layout({
      heading,
      body: `<p style="margin:0 0 12px;">We were unable to process a payment on your account.</p>
             <p style="margin:0;"><strong>Reason:</strong> ${escapeHtml(params.reason)}</p>`,
      cta: { label: 'Update payment method', url: params.url },
    }),
    text: textLayout(heading, ['We were unable to process a payment.', `Reason: ${params.reason}`], {
      label: 'Update payment method',
      url: params.url,
    }),
  };
}

export function disputeOpenedTemplate(params: {
  reference: string;
  subject: string;
  url: string;
}): RenderedEmail {
  const heading = `Dispute ${params.reference} opened`;
  return {
    subject: `Dispute ${params.reference}: ${params.subject}`,
    html: layout({
      heading,
      body: `<p style="margin:0;">A dispute has been opened: <strong>${escapeHtml(params.subject)}</strong></p>`,
      cta: { label: 'View dispute', url: params.url },
    }),
    text: textLayout(heading, [`A dispute has been opened: ${params.subject}`], {
      label: 'View dispute',
      url: params.url,
    }),
  };
}

export function genericTemplate(params: {
  heading: string;
  body: string;
  cta?: { label: string; url: string };
}): RenderedEmail {
  return {
    subject: params.heading,
    html: layout({ heading: params.heading, body: `<p style="margin:0;">${escapeHtml(params.body)}</p>`, cta: params.cta }),
    text: textLayout(params.heading, [params.body], params.cta),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, '');
}
