// Order e-mails (DR-059), the launch channel in place of SMS (DR-057). Drafts until the
// message wording is approved (B09). Rules carried over from the handoff's message rules:
// no full address, payer number or sensitive refund reason; the private link is sent only
// to the order's own contact; BeautyBOX never asks for a wallet PIN.

export type EmailTemplateInput = {
  recipientName: string;
  reference: string;
  amount: string;
  /** Private single-use link, or null for messages that carry none. */
  link: string | null;
  supportPhone: string | null;
  supportEmail: string | null;
  supportHours: string | null;
};

type Rendered = { subject: string; paragraphs: string[]; linkLabel?: string };

const LINK_NOTE =
  "This private link opens your order once and works for 7 days. After you open it, this browser keeps access to the order for 7 days. Do not forward it: anyone with the link can see your order.";

export const EMAIL_TEMPLATES: Record<
  string,
  { needsLink: boolean; render: (v: EmailTemplateInput) => Rendered }
> = {
  ORDER_CONFIRMED: {
    needsLink: true,
    render: (v) => ({
      subject: `Order ${v.reference} confirmed - BeautyBOX`,
      paragraphs: [
        `Hello ${v.recipientName},`,
        `We have received your payment of ${v.amount} for order ${v.reference}. We are preparing it for delivery to the location you confirmed.`,
      ],
      linkLabel: "View your order",
    }),
  },
  ORDER_ON_HOLD: {
    needsLink: false,
    render: (v) => ({
      subject: `We need to contact you about order ${v.reference} - BeautyBOX`,
      paragraphs: [
        `Hello ${v.recipientName},`,
        `We need to speak with you about order ${v.reference} before we can continue. Your payment is safe. Please contact us using the details below.`,
      ],
    }),
  },
  ORDER_DISPATCHED: {
    needsLink: true,
    render: (v) => ({
      subject: `Order ${v.reference} is on its way - BeautyBOX`,
      paragraphs: [
        `Hello ${v.recipientName},`,
        `Order ${v.reference} has been handed to our rider. Please keep your delivery phone reachable.`,
      ],
      linkLabel: "Check delivery status",
    }),
  },
  DELIVERY_PROBLEM: {
    needsLink: false,
    render: (v) => ({
      subject: `About the delivery of order ${v.reference} - BeautyBOX`,
      paragraphs: [
        `Hello ${v.recipientName},`,
        `We need to arrange the delivery of order ${v.reference} with you. Please contact us using the details below. We will not charge anything extra without agreeing it with you first.`,
      ],
    }),
  },
  REFUND_CONFIRMED: {
    needsLink: false,
    render: (v) => ({
      subject: `Refund for order ${v.reference} confirmed - BeautyBOX`,
      paragraphs: [
        `Hello ${v.recipientName},`,
        `Your refund of ${v.amount} for order ${v.reference} has been confirmed. It goes back to the mobile-money account that paid for the order; your provider may take some time to show it.`,
      ],
    }),
  },
  ACCESS_LINK: {
    needsLink: true,
    render: (v) => ({
      subject: `Your new link for order ${v.reference} - BeautyBOX`,
      paragraphs: [
        `Hello ${v.recipientName},`,
        `As requested, here is a new private link for order ${v.reference}. Earlier links no longer work.`,
      ],
      linkLabel: "Open your order",
    }),
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function supportLines(v: EmailTemplateInput): string[] {
  const lines: string[] = [];
  if (v.supportPhone) lines.push(`Phone: ${v.supportPhone}`);
  if (v.supportEmail) lines.push(`E-mail: ${v.supportEmail}`);
  if (lines.length && v.supportHours)
    lines.push(`We are available ${v.supportHours}.`);
  return lines;
}

/** Plain text and a simple, escaped HTML version of the same message. */
export function renderEmail(
  event: string,
  v: EmailTemplateInput,
): { subject: string; text: string; html: string } | null {
  const template = EMAIL_TEMPLATES[event];
  if (!template) return null;
  if (template.needsLink && !v.link) return null;
  const r = template.render(v);
  const support = supportLines(v);
  const pin = "BeautyBOX never asks for your mobile-money PIN.";

  const text = [
    ...r.paragraphs,
    ...(r.linkLabel && v.link ? [`${r.linkLabel}: ${v.link}`, LINK_NOTE] : []),
    ...(support.length ? ["Need help?", ...support] : []),
    pin,
    "BeautyBOX, Kigali",
  ].join("\n\n");

  const p = (s: string) =>
    `<p style="margin:0 0 16px;font:16px/1.5 Arial,sans-serif;color:#2b1a2e">${escapeHtml(s)}</p>`;
  const button =
    r.linkLabel && v.link
      ? `<p style="margin:0 0 16px"><a href="${escapeHtml(v.link)}" style="display:inline-block;padding:12px 20px;background:#4a1f4f;color:#ffffff;text-decoration:none;border-radius:6px;font:600 16px Arial,sans-serif">${escapeHtml(r.linkLabel)}</a></p>` +
        `<p style="margin:0 0 16px;font:13px/1.5 Arial,sans-serif;color:#5c4a5e">${escapeHtml(LINK_NOTE)}</p>`
      : "";
  const help = support.length
    ? `<p style="margin:0 0 4px;font:600 15px Arial,sans-serif;color:#2b1a2e">Need help?</p>` +
      support
        .map(
          (s) =>
            `<p style="margin:0;font:15px/1.5 Arial,sans-serif;color:#2b1a2e">${escapeHtml(s)}</p>`,
        )
        .join("") +
      `<p style="margin:0 0 16px"></p>`
    : "";
  const html =
    `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#faf6f0">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;padding:24px;border-radius:8px">` +
    `<p style="margin:0 0 20px;font:700 20px Arial,sans-serif;color:#4a1f4f">BeautyBOX</p>` +
    r.paragraphs.map(p).join("") +
    button +
    help +
    `<p style="margin:0;font:13px/1.5 Arial,sans-serif;color:#5c4a5e">${escapeHtml(pin)} BeautyBOX, Kigali.</p>` +
    `</div></body></html>`;

  return { subject: r.subject, text, html };
}
