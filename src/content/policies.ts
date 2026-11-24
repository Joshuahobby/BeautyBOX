// Complete staging drafts, created with the owner's authorization from the Phase 1
// brief/FSD and current implementation. Publication still depends on the existing
// policiesApproved setting. See docs/CONTENT-REVIEW.md for facts and proposals.
// Reviewed and completed 2026-11-24 against Rwanda's Law No 058/2021 on personal
// data protection (DR-058); that review is not legal advice.
import { beautybox, businessContact } from "./beautybox";

const CONTACT = `call ${businessContact.phone} or e-mail ${businessContact.email}, ${businessContact.hours}`;

export type PolicyTopic = "delivery-returns" | "terms" | "privacy";

type Policy = {
  title: string;
  sections: { heading: string; paragraphs: string[] }[];
};

export const POLICIES: Record<PolicyTopic, Policy> = {
  "delivery-returns": {
    title: "Delivery & returns",
    sections: [
      {
        heading: "Delivery in Kigali",
        paragraphs: [
          "BeautyBOX fulfils orders from its own shop in Kigali. Delivery is available within the service area supported at checkout. Confirm your location and a reachable delivery phone number before requesting a delivery fee.",
          "Delivery is priced by distance from our shop to your confirmed destination. The delivery fee and full order total are shown before payment. A changed destination or basket may require a new quote, which you can review before paying. We do not add an undisclosed delivery charge after payment.",
          "Add an accurate entrance pin, a useful landmark and any access instructions. Orders are prepared according to the operating arrangements and delivery window shown for the order. If a fee or delivery window cannot be confirmed, we will not replace it with an invented promise. Check your private order page for progress; it does not provide live rider tracking.",
        ],
      },
      {
        heading: "Changes and unsuccessful delivery",
        paragraphs: [
          "If you need to change an address after payment, contact support with your order reference promptly. We will check whether the order has been handed to a rider and explain the available options before agreeing a change.",
          "If delivery cannot be completed, keep your delivery phone reachable and check your order page. Any new delivery arrangement or additional charge must be explained and agreed before proceeding; it is not an automatic second debit.",
        ],
      },
      {
        heading: "Requesting a cancellation",
        paragraphs: [
          "Open your private order page and choose Ask to cancel this order, or use the support details on our Help page. We review the request against the order's fulfilment status. Sending a request does not cancel the order by itself.",
          "Where cancellation is accepted after a verified payment, any refund is reviewed against that payment. If payment is still pending, we continue checking the existing transaction rather than asking you to pay again.",
        ],
      },
      {
        heading: "Damaged, incorrect or defective products",
        paragraphs: [
          `Contact support as soon as you notice a problem: ${CONTACT}. Give your order reference and a description of what happened. Keep the item and its packaging, and provide photos where useful. We will review the issue and explain the appropriate next step, which may include a replacement, return or refund.`,
          "Do not send products back before receiving return instructions. We inspect returned goods before deciding whether they can be restocked. No substitute product is sent without your agreement.",
        ],
      },
      {
        heading: "Change-of-mind returns",
        paragraphs: [
          "For a change-of-mind return, contact us within seven calendar days of delivery. The item must be unused, unopened and in its original packaging with seals and labels intact. We will explain the return arrangement and any return-delivery cost before you decide whether to proceed.",
          "Opened cosmetics and other hygiene-sensitive products are not eligible for a change-of-mind return. This does not remove any rights that apply to damaged, incorrect or defective goods. These return arrangements remain subject to applicable consumer rights.",
        ],
      },
      {
        heading: "Payments and refunds",
        paragraphs: [
          "Available payment methods are shown at checkout. Mobile-money payments are processed through pawaPay. Approve the request in your provider's prompt on your phone; BeautyBOX never asks for your wallet PIN.",
          "An accepted payment request is not yet a confirmed payment. If a payment remains pending or your wallet was debited without confirmation, use the existing payment page to check its status before attempting another payment.",
          "Approved refunds follow the original transaction and the payment provider's supported process. The private order page shows refund progress. A refund is marked complete only after confirmation; provider processing time can vary. Use the Help page if the displayed status and your wallet activity do not match.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms",
    sections: [
      {
        heading: "Shopping with BeautyBOX",
        paragraphs: [
          `The seller is ${beautybox.registeredName}, ${beautybox.location}. To reach us, ${CONTACT}.`,
          "These terms describe purchases from the BeautyBOX shop in Kigali, Rwanda. BeautyBOX handles the products, basket and fulfilment offered through this storefront. Supplier arrangements are managed by BeautyBOX and do not create separate customer deliveries.",
          "You can check out as a guest. Provide accurate recipient details, a reachable delivery number and a confirmed destination. Keep your private order page confidential because it provides access to your order information.",
        ],
      },
      {
        heading: "Products, options and prices",
        paragraphs: [
          "Read the product description and choose the required shade, size or other option before adding it to your cart. Prices are shown in Rwandan francs (RWF). The cart and checkout recheck current prices and availability before payment.",
          "Products in a cart are not a promise of unlimited stock. If availability or price changes, review the updated basket before proceeding. We do not substitute a different product or option without your agreement. Images identified as illustrative are examples, not verified photographs of BeautyBOX stock.",
        ],
      },
      {
        heading: "Ordering and payment",
        paragraphs: [
          "Review the products, delivery destination, delivery fee and full total before authorizing payment. Only the payment methods currently offered at checkout can be used. Your paying phone may differ from the delivery phone.",
          "A payment request being accepted by a provider does not mean collection succeeded. Order confirmation follows verified payment. If an availability issue needs resolution after payment, BeautyBOX will show the relevant order status and review the appropriate next step with you.",
          "An order receipt is available for a verified paid order. It should not be treated as a tax invoice unless it is expressly identified as one. Never share a mobile-money PIN with BeautyBOX or anyone claiming to act for the shop.",
        ],
      },
      {
        heading: "Delivery, cancellation and returns",
        paragraphs: [
          "Coverage and delivery charges depend on the confirmed destination and supported parcel. Review the delivery and returns policy for address changes, cancellation requests, unsuccessful delivery and return arrangements. No undisclosed delivery fee is added after payment.",
          "Contact support using the details on our Help page and provide your order reference. Keep useful payment or delivery information, but do not send your wallet PIN or publicly share the private order link.",
        ],
      },
      {
        heading: "Questions and your rights",
        paragraphs: [
          "If something goes wrong, explain the issue through the available support channel so BeautyBOX can investigate the order and proposed resolution. Payment, fulfilment and refund records are checked before a financial status is marked complete.",
          "These terms are intended for BeautyBOX purchases in Rwanda and are governed by the laws of Rwanda. They do not exclude rights that apply under relevant law, including consumer protection law. Updates to the shop's published terms do not silently change the recorded contents or total of an existing order.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy",
    sections: [
      {
        heading: "Who we are",
        paragraphs: [
          `${beautybox.registeredName}, ${beautybox.location}, decides how the personal information used by this shop is handled (the data controller). For any privacy question or request, ${CONTACT}.`,
          "This notice explains what we collect when you shop, why, who receives it, where it is stored, how long we keep it and the rights you have under Rwanda's Law No 058/2021 on the protection of personal data and privacy.",
        ],
      },
      {
        heading: "Information used to handle your order",
        paragraphs: [
          "BeautyBOX uses the information you provide to operate the shop and handle your purchases: recipient name, delivery phone and e-mail address, delivery pin and instructions, products and options, order and payment references, paying phone where needed, and support or return information you choose to provide.",
          "A guest session connects your browser with its cart, checkout and private order access. The site uses essential session cookies for these functions only; it does not use advertising or tracking cookies. This checkout does not require a customer account. BeautyBOX never collects your mobile-money PIN.",
        ],
      },
      {
        heading: "Why we may use it",
        paragraphs: [
          "We use order information because it is needed to perform the purchase you ask for: checking availability, quoting and agreeing delivery, verifying payment, preparing and delivering the order, providing private status updates and handling cancellations, returns and refunds.",
          "We keep payment, refund and order records because the law requires business and tax records. We use limited technical information, such as rate limits and security logs, in our legitimate interest in keeping the shop and customers' payments safe. Browser location is used only if you allow it, and you can withdraw that permission at any time in your browser.",
          "We do not sell your information, use it for advertising or make decisions about you by automated means alone.",
        ],
      },
      {
        heading: "Location and optional maps",
        paragraphs: [
          "Browser location permission is optional. You can search for a place or enter the destination manually instead. A confirmed location is used to check coverage, calculate delivery and fulfil the order.",
          "When Google place search, routing or an optional street-map preview is enabled, the relevant location request is sent to Google to provide that feature. A street-map preview loads only when requested. Denying browser location permission does not prevent manual destination entry.",
        ],
      },
      {
        heading: "Who receives it",
        paragraphs: [
          "Necessary information is handled by authorized BeautyBOX staff and by providers acting for us under their data-processing terms: pawaPay and your mobile-money network (MTN or Airtel) for payment, Vercel for website hosting, Supabase for the database and photo storage, Resend for order e-mails, Google for place search and routing when enabled, and our delivery rider for fulfilment. The rider receives only what is needed to deliver, not your payment or support history.",
          "We e-mail your order confirmation, delivery and refund updates and private order links to the address you give at checkout, through Resend. We do not use your e-mail address for marketing. Order updates are also shown on your private order page. We do not send SMS yet; this notice will name the SMS provider before any SMS is sent.",
          "We disclose information to public authorities only where the law requires it.",
        ],
      },
      {
        heading: "Where it is stored",
        paragraphs: [
          "Our database is hosted by Supabase in the European Union (Ireland), our website runs on Vercel servers in Ireland, and Resend sends our e-mail from its European Union (Ireland) region. Google may process location requests outside Rwanda. BeautyBOX stores and transfers personal information outside Rwanda only as Law No 058/2021 permits, including the authorization it requires, and only with providers bound to protect it.",
        ],
      },
      {
        heading: "How long we keep it",
        paragraphs: [
          "Order, payment and refund records are kept for as long as Rwandan tax and accounting law requires. Delivery details, support messages and return information are kept only as long as needed to complete the order and deal with any claim about it, then deleted or anonymised. A deletion request may require some records to be retained; BeautyBOX will explain the reason when responding.",
        ],
      },
      {
        heading: "Keeping information safe",
        paragraphs: [
          "Connections to the shop are encrypted, payer phone numbers are stored encrypted, and staff access is limited by role and protected by an authenticator app. Keep your private order link confidential and use the site's access-link process when opening an order on another device.",
          "If a breach of personal data is likely to affect you, we will tell you and the National Cyber Security Authority as the law requires. If you believe an order link or personal information has been exposed, contact us straight away, without sending a wallet PIN.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          "You can ask to see the personal information we hold about you, to correct it, to delete it, to restrict or object to its use, and to receive it in a form you can pass to someone else. You can also object to decisions made by automated means alone. Include your order reference where relevant; we may need to verify your connection to an order before disclosing or changing information.",
          `To use these rights, ${CONTACT}. We answer without charge. If you are not satisfied with our answer, you can complain to the National Cyber Security Authority (NCSA), Rwanda's data protection supervisory authority.`,
          "This notice covers the shop's ordering experience. The opening-day notification list has its own privacy notice and consent flow. Joining that list is separate from buying products and is not a condition of checkout. We will update this notice when our processing changes and show the date of the latest version. Last updated: 24 November 2026.",
        ],
      },
    ],
  },
};
