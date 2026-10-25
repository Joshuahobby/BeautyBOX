// Draft policy text from handoff business/Policy-and-Copy-Drafts.md. NOT approved legal
// text: square-bracket fields are unresolved business inputs (B05, B09) and stay
// visible as brackets. Production shows these only after founder/adviser approval.

export type PolicyTopic = "delivery-returns" | "terms" | "privacy";

export const POLICIES: Record<PolicyTopic, { title: string; sections: { heading: string; paragraphs: string[] }[] }> = {
  "delivery-returns": {
    title: "Delivery & returns",
    sections: [
      {
        heading: "Delivery",
        paragraphs: [
          "BeautyBOX dispatches the products offered at launch from its own stock location. We currently deliver within [APPROVED COVERAGE]. Enter and confirm your delivery location and contact number at checkout. We show the delivery charge and order total before you authorize payment.",
          "The charge is based on [APPROVED ROUTE/TARIFF EXPLANATION]; it may change if your destination or basket changes before payment. We do not add an undisclosed delivery fee after payment.",
          "Orders are prepared during [HOURS] with an expected delivery window of [VERIFIED PROMISE]. [CUT-OFF/WEEKEND RULE]. Please provide an accurate pin, landmark and reachable phone number. If an order cannot be delivered, we will contact you using [SUPPORT PROCESS] and explain the available options and any agreed reattempt charge before proceeding. Delivery status updates do not provide live rider tracking.",
        ],
      },
      {
        heading: "Cancellation and returns",
        paragraphs: [
          "Contact [SUPPORT CONTACT] with your order reference if you need help or wish to cancel. We will check whether the order has already been handed to the rider. Requests before handover follow [PRE-DISPATCH CANCELLATION RULE]. Requests after handover follow [RETURNS/FAILED-DELIVERY RULE]. If a payment is still being confirmed, we will continue checking its status and explain any necessary refund.",
          "For damaged, incorrect or defective goods, contact us through [CONTACT] with [REASONABLE EVIDENCE/PROCESS]. Requests should follow [REVIEWED TIME LIMITS]. [REVIEWED TREATMENT OF OPENED COSMETICS/HYGIENE PRODUCTS, EXCEPTIONS AND STATUTORY RIGHTS]. We inspect returned items before deciding whether they can be restocked. No item is substituted without your agreement.",
        ],
      },
      {
        heading: "Payments and refunds",
        paragraphs: [
          "At launch, available payment methods are displayed at checkout. BeautyBOX intends to accept Rwanda MTN Mobile Money and Airtel Money through pawaPay, subject to merchant activation. Authorize any payment in your mobile-money provider's prompt. BeautyBOX will never ask for your wallet PIN.",
          "An order is confirmed only after successful payment verification. If a payment is pending, check its status before trying again. Refunds are reviewed against the original transaction and returned through [CONFIRMED PROVIDER PROCESS]. We show a refund as complete only after it has been verified. Expected processing times are [VERIFIED PROVIDER/POLICY TIMELINE]. Contact [SUPPORT] if a debit or refund does not match the displayed status.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms",
    sections: [
      {
        heading: "Terms of sale (to be drafted and approved)",
        paragraphs: [
          "The terms will confirm [LEGAL SELLER IDENTITY], product information and availability, price, currency and [TAX TREATMENT], how order acceptance works, delivery and refunds, support and dispute handling, applicable rights and approved liability terms.",
          "An order receipt is available for every verified paid order. It is not labelled a tax invoice until the required configuration has been verified with the business's tax adviser.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy",
    sections: [
      {
        heading: "Privacy notice (to be drafted and approved)",
        paragraphs: [
          "The notice will name [CONTROLLER LEGAL IDENTITY/CONTACT], what customer, order, payment and location information is collected, each purpose and lawful basis, recipients and processors, [SELECTED HOSTING/TRANSFER ARRANGEMENTS], [RETENTION SCHEDULE], rights and the contact process, the complaint route and applicable safeguards.",
          "Browser location permission is optional: you can always place the delivery pin manually. The delivery contact and the paying phone are kept separately. BeautyBOX never collects wallet PINs. This site uses only essential session cookies for your cart, checkout and private order access.",
        ],
      },
    ],
  },
};
