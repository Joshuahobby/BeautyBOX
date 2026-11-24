// Customer-facing copy grounded in the Phase 1 brief and the owner's Kigali
// decisions in docs/CONTINUATION-PLAN.md. Operational facts stay in settings.

// Founder-supplied contact (2026-11-24, DR-058), quoted in the policies. The Help
// page reads the same details from the settings' support contact; keep both equal.
export const businessContact = {
  phone: "+250 788 641 811",
  email: "care@beautyboxmarket.com",
  hours: "24 hours a day, 7 days a week",
} as const;
export const beautybox = {
  aboutTitle: "About BeautyBOX",
  headline: "Everyday beauty, closer to home.",
  intro:
    "BeautyBOX is a beauty and personal-care shop in Kigali. We bring skincare, makeup, haircare and everyday essentials together in one place, with a simple way to order for delivery.",
  homepageBody:
    "One shop, one basket and a clear total. Explore products held at BeautyBOX, choose the options that suit you and review delivery before you pay.",
  aboutLink: "Meet BeautyBOX",
  location: "Silverback Mall, Kicukiro, Kigali, Rwanda",
  locationHeading: "Our shop in Kigali",
  locationBody:
    "Your online order is handled by BeautyBOX from our shop. Confirm your delivery location at checkout to check coverage and see your delivery fee.",
  principles: [
    {
      heading: "Products from our shop",
      body: "The launch shop brings BeautyBOX's own stock and products held under supplier arrangements into one shopping experience. BeautyBOX handles your basket and fulfilment, so you do not need to coordinate separate deliveries with suppliers.",
    },
    {
      heading: "A straightforward way to shop",
      body: "Browse by category, search for a product or explore the everyday edit. Choose a shade or size when the product offers options, then check out as a guest with your name and phone number.",
    },
    {
      heading: "Your total before you pay",
      body: "Confirm your delivery pin and review the delivery fee alongside your products. Choose an available mobile-money network and approve the payment request on your phone. BeautyBOX never asks for your wallet PIN.",
    },
    {
      heading: "Help throughout your order",
      body: "Your private order page shows the order's progress after payment is verified. Keep that link private. Our Help page explains payment, delivery, cancellations and returns, and lists the available support channels.",
    },
  ],
} as const;

export const helpTopics = [
  {
    id: "payment-help",
    title: "Payment or refund",
    paragraphs: [
      "Available mobile-money networks are shown at checkout. Your paying number can be different from your delivery number. Approve the payment request on your phone and never share your wallet PIN.",
      "If a payment is pending or your wallet was debited without a confirmed order, keep the payment page open and use its status check. Do not start another payment while the first one is still being checked. An order is confirmed only after the payment is verified.",
      "If a refund is approved, its progress appears on the private order page. A refund being reviewed or processed is not yet a completed refund. For help, keep your order reference and the relevant transaction information ready.",
    ],
    policy: "/help/delivery-returns",
    policyLabel: "Payments and refunds guide",
  },
  {
    id: "delivery-help",
    title: "Delivery or address change",
    paragraphs: [
      "Delivery is available within our Kigali service area. Enter a place or landmark, use your current location if you choose, or place the pin manually. Confirm the pin at your entrance and add useful delivery instructions.",
      "Review and accept the delivery fee before paying. If you change your basket or destination before payment, the fee may need to be recalculated. We do not collect payment using a guessed fee when coverage or routing cannot be confirmed.",
      "For a location change after payment, contact support with your order reference as soon as possible. We will check the delivery status and available options before agreeing a change. Your private order page shows delivery progress; it is not a live rider map.",
    ],
    policy: "/help/delivery-returns",
    policyLabel: "Delivery guide",
  },
  {
    id: "returns-help",
    title: "Cancel, return or damaged item",
    paragraphs: [
      "To request cancellation, open your private order page and choose Ask to cancel this order. A request is reviewed against the order's current status; sending it does not cancel the order automatically.",
      "If an item arrives damaged, incorrect or defective, keep the item and packaging and contact support with your order reference. Explain the issue and include photos where useful. We will review the available resolution and provide return instructions when needed.",
      "Read the delivery and returns policy before requesting a change-of-mind return. Hygiene-sensitive products need particular care. Do not send a return before receiving instructions, and do not share your private order link or wallet PIN with anyone.",
    ],
    policy: "/help/delivery-returns",
    policyLabel: "Cancellation and returns guide",
  },
] as const;
