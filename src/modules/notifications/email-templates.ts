// Order e-mails (DR-059), the launch channel in place of SMS (DR-057). Drafts until the
// message wording is approved (B09). Rules carried over from the handoff's message rules:
// no full address, payer number or sensitive refund reason; the private link is sent only
// to the order's own contact; BeautyBOX never asks for a wallet PIN.
//
// Written as a plain receipt, not a newsletter (DR-061): personal subject, the order's
// own lines and total, an ordinary text link, no coloured card, button or images. Gmail
// filed the first styled version under Promotions; plain transactional mail with real
// order content is what mail providers expect from an order confirmation.

export type EmailOrderLine = { title: string; quantity: number; total: string };

export type EmailTemplateInput = {
  recipientName: string;
  reference: string;
  amount: string;
  /** Private single-use link, or null for messages that carry none. */
  link: string | null;
  supportPhone: string | null;
  supportEmail: string | null;
  supportHours: string | null;
  /** The order's current lines and totals, shown in the confirmation. */
  lines?: EmailOrderLine[];
  products?: string;
  delivery?: string;
};

type Rendered = {
  subject: string;
  paragraphs: string[];
  linkLabel?: string;
  showOrder?: boolean;
};

const LINK_NOTE =
  "This private link opens your order once and works for 7 days. After you open it, this browser keeps access to the order for 7 days. Please do not forward it: anyone with the link can see your order.";

export const EMAIL_TEMPLATES: Record<
  string,
  { needsLink: boolean; render: (v: EmailTemplateInput) => Rendered }
> = {
  ORDER_CONFIRMED: {
    needsLink: true,
    render: (v) => ({
      subject: `Your BeautyBOX order ${v.reference} is confirmed`,
      paragraphs: [
        `Hello ${v.recipientName},`,
        `Thank you for your order. We have received your payment of ${v.amount} for order ${v.reference}, and we are preparing it for delivery to the location you confirmed.`,
      ],
      linkLabel: "View your order",
      showOrder: true,
    }),
  },
  ORDER_ON_HOLD: {
    needsLink: false,
    render: (v) => ({
      subject: `About your BeautyBOX order ${v.reference}`,
      paragraphs: [
        `Hello ${v.recipientName},`,
        `We need to speak with you about order ${v.reference} before we can continue. Your payment is safe. Please contact us using the details below.`,
      ],
    }),
  },
  ORDER_DISPATCHED: {
    needsLink: true,
    render: (v) => ({
      subject: `Your BeautyBOX order ${v.reference} is on its way`,
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
      subject: `Delivery of your BeautyBOX order ${v.reference}`,
      paragraphs: [
        `Hello ${v.recipientName},`,
        `We need to arrange the delivery of order ${v.reference} with you. Please contact us using the details below. We will not charge anything extra without agreeing it with you first.`,
      ],
    }),
  },
  REFUND_CONFIRMED: {
    needsLink: false,
    render: (v) => ({
      subject: `Your refund for BeautyBOX order ${v.reference}`,
      paragraphs: [
        `Hello ${v.recipientName},`,
        `Your refund of ${v.amount} for order ${v.reference} has been confirmed. It goes back to the mobile-money account that paid for the order; your provider may take some time to show it.`,
      ],
    }),
  },
  ACCESS_LINK: {
    needsLink: true,
    render: (v) => ({
      subject: `Your new link for BeautyBOX order ${v.reference}`,
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

function orderLines(v: EmailTemplateInput): string[] {
  if (!v.lines?.length) return [];
  return [
    ...v.lines.map((l) => `${l.quantity} x ${l.title}: ${l.total}`),
    ...(v.products ? [`Products: ${v.products}`] : []),
    ...(v.delivery ? [`Delivery: ${v.delivery}`] : []),
    `Total paid: ${v.amount}`,
  ];
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
  const order = r.showOrder ? orderLines(v) : [];
  const pin = "BeautyBOX never asks for your mobile-money PIN.";

  const text = [
    ...r.paragraphs,
    ...(order.length ? [`Order ${v.reference}`, order.join("\n")] : []),
    ...(r.linkLabel && v.link ? [`${r.linkLabel}: ${v.link}`, LINK_NOTE] : []),
    ...(support.length ? ["Need help?", support.join("\n")] : []),
    pin,
    "BeautyBOX, Kigali",
  ].join("\n\n");

  const p = (s: string) => `<p>${escapeHtml(s)}</p>`;
  const lines = (items: string[]) =>
    `<p>${items.map(escapeHtml).join("<br>")}</p>`;
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"></head>` +
    `<body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222222">` +
    r.paragraphs.map(p).join("") +
    (order.length
      ? `<p><strong>Order ${escapeHtml(v.reference)}</strong></p>` +
        lines(order)
      : "") +
    (r.linkLabel && v.link
      ? `<p><a href="${escapeHtml(v.link)}">${escapeHtml(r.linkLabel)}</a></p>` +
        p(LINK_NOTE)
      : "") +
    (support.length ? `<p>Need help?</p>` + lines(support) : "") +
    p(pin) +
    p("BeautyBOX, Kigali") +
    `</body></html>`;

  return { subject: r.subject, text, html };
}
