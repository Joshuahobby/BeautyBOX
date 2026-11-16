// English message catalog (ADR-06: English-first, copy externalised for reviewed
// translation). Wording comes from business/Policy-and-Copy-Drafts.md and the UX
// specification drafts. It is draft copy until the founder approves it (B09/B12).
// Placeholders in {braces} are filled from verified server values only.

export const en = {
  brand: {
    name: "BeautyBOX",
    homeLabel: "BeautyBOX home",
    tagline: "Your everyday beauty essentials.",
  },
  demo: {
    banner:
      "Demo environment: synthetic products and simulated payments. Nothing here is a real offer.",
    productNotice:
      "Demo product. Not confirmed BeautyBOX stock, price or photography.",
    draftPolicy:
      "Draft for review. This policy is not approved for publication.",
    photoPending: "Product photo pending review",
  },
  nav: {
    shopAll: "Shop all",
    search: "Search",
    searchPlaceholder: "Search beauty products",
    searchLabel: "Search products",
    clearSearch: "Clear search",
    cart: "Cart",
    cartWithCount: "Cart ({count})",
    cartCountLabel: "Cart, {count} items",
    menu: "Shop categories",
    closeMenu: "Close categories",
    skipToContent: "Skip to content",
    back: "Back",
    help: "Help",
  },
  footer: {
    help: "Help",
    deliveryReturns: "Delivery & returns",
    terms: "Terms",
    privacy: "Privacy",
    note: "BeautyBOX sells products held at its own shop and delivers from one dispatch point.",
  },
  home: {
    heroTitle: "Your everyday beauty essentials.",
    heroBody:
      "Explore skincare, makeup and beauty accessories. See the full order total before you pay.",
    shopProducts: "Shop products",
    categoriesHeading: "Shop by category",
    featuredHeading: "Featured products",
    browseAll: "Browse all products",
    noProducts: "Products are being prepared. Please check back soon.",
  },
  catalog: {
    resultsHeading: "Products",
    resultCount: "{count} products",
    resultCountOne: "1 product",
    filters: "Filters",
    filtersApplied: "Filters ({count})",
    sort: "Sort",
    sortRelevance: "Relevance",
    sortPriceAsc: "Price: low to high",
    sortPriceDesc: "Price: high to low",
    sortNewest: "Newest",
    category: "Category",
    allCategories: "All categories",
    priceRange: "Price (RWF)",
    minPrice: "Minimum price",
    maxPrice: "Maximum price",
    availableOnly: "Show available items only",
    apply: "Apply filters",
    clear: "Clear filters",
    close: "Close filters",
    loadMore: "Load more",
    loadingMore: "Loading more products",
    loading: "Loading products",
    noResultsTitle: "No products found",
    noResultsBody: "Try a different word or remove a filter.",
    browseAll: "Browse all products",
    fetchFailed: "We couldn't load products right now.",
    retry: "Try again",
    showingFor: "Results for “{query}”",
  },
  product: {
    addToCart: "Add to cart",
    chooseShade: "Choose shade",
    chooseOptions: "Choose options",
    chooseShadeHeading: "Choose a shade",
    chooseOptionHeading: "Choose an option",
    noShadeSelected: "No shade selected",
    noOptionSelected: "No option selected",
    selectedOption: "Selected option: {option}",
    selectedShade: "Selected shade: {shade}",
    variantMissing: "Choose a shade before adding this item.",
    optionMissing: "Choose an option before adding this item.",
    unavailableOption: "{label}, unavailable",
    inStock: "In stock",
    outOfStock: "Out of stock",
    unavailableBody: "This item cannot be added to your cart right now.",
    browseCategory: "Browse {category}",
    quantity: "Quantity",
    decrease: "Decrease quantity",
    increase: "Increase quantity",
    deliveryNote: "Delivery fee shown at checkout.",
    details: "Product details",
    packSize: "Pack size",
    added: "Added to cart",
    viewCart: "View cart",
    continueShopping: "Continue shopping",
    addFailed:
      "We couldn't add this item. Your choice is saved; please try again.",
    adding: "Adding to cart",
    stockChanged:
      "The available quantity changed. Only {available} can be added right now.",
    breadcrumb: "Breadcrumb",
  },
  cart: {
    heading: "Your cart",
    attentionHeading: "Review your cart",
    empty: "Your cart is empty.",
    shopProducts: "Shop products",
    subtotal: "Subtotal",
    deliveryNote: "Delivery calculated after you confirm your location.",
    recheckNote: "Items are checked again before payment.",
    continueToCheckout: "Continue to checkout",
    resolveToContinue: "Resolve cart to continue",
    remove: "Remove",
    removeLabel: "Remove {title}",
    updating: "Updating",
    unavailableLine: "{title} is no longer available.",
    insufficientLine:
      "Only {available} available. Change the quantity to continue.",
    useAvailable: "Change to {available}",
    priceChanged: "Price updated to {price}.",
    paymentPending:
      "A payment for this cart is still being checked. Your cart can't be changed until it is resolved.",
    shade: "Shade: {shade}",
    lineTotal: "Line total",
  },
  checkout: {
    steps: {
      contact: "Contact",
      delivery: "Delivery",
      payment: "Payment",
      label: "Checkout progress",
      current: "current step",
      done: "completed",
    },
    errorSummary: "Check the highlighted details",
    contactHeading: "Who is receiving?",
    recipientName: "Recipient name",
    recipientPhone: "Delivery phone",
    recipientPhoneHelp: "Used to coordinate your delivery.",
    noAccount:
      "No account needed. Your paying number can be different from your delivery number.",
    continueToDelivery: "Continue to delivery",
    nameRequired: "Enter the recipient's name.",
    phoneInvalid: "Enter a phone number we can use for delivery.",
    locationHeading: "Where should we deliver?",
    searchPlace: "Search for a place",
    searchPlacePlaceholder: "Search address or landmark",
    placeResults: "Place results",
    noPlaceResults: "No matching places. Adjust the pin manually instead.",
    placesUnavailable:
      "Place search is unavailable. You can still place the pin manually.",
    useMyLocation: "Use my current location",
    locationExplain:
      "Your browser will ask to share your location once, to place the pin. You can adjust it afterwards.",
    locationDeclined: "You can place the delivery pin manually.",
    locationUnavailable:
      "We couldn't get your location. You can place the delivery pin manually.",
    locating: "Finding your location",
    pinHeading: "Delivery pin",
    pinHelp: "Adjust the pin to your entrance.",
    pinNudge: "Move pin {direction}",
    pinNorth: "north",
    pinSouth: "south",
    pinEast: "east",
    pinWest: "west",
    pinCoordinates: "Pin position {lat}, {lng}",
    pinNotSet: "Choose a place or use your location to set the pin.",
    mapPreviewNote:
      "Coordinate preview only. Use search, coordinates or the arrow controls to set your delivery pin.",
    landmark: "Landmark",
    landmarkPlaceholder: "Gate, building or nearby place",
    instructions: "Delivery instructions",
    confirmPin: "Confirm pin and get fee",
    pinRequired: "Set and confirm the delivery pin.",
    deliveryReviewHeading: "Review delivery",
    confirmedDestination: "Confirmed destination",
    changeLocation: "Change location",
    deliveryFee: "Delivery fee",
    calculating: "Calculating delivery",
    quoteValidUntil: "This delivery fee is held until {time}.",
    quoteExpired: "Delivery fee needs updating.",
    recalculate: "Recalculate",
    quoteChanged:
      "Your delivery charge changed. Review the new total before paying.",
    previousAmount: "Previous: {amount}",
    deliveryWindowPending:
      "The delivery window appears here once operations confirms it.",
    routeFailed:
      "We couldn't calculate delivery right now. Your basket is saved. Please try again.",
    retry: "Try again",
    contactSupport: "Contact support",
    outsideCoverageTitle: "Outside our delivery area",
    outsideCoverage:
      "Delivery is not available to this location yet. Choose another location or contact us.",
    parcelUnsupported:
      "Some items in your cart need special delivery that isn't available yet. Remove them to continue.",
    acceptFee: "Accept fee and continue",
    products: "Products",
    delivery: "Delivery",
    total: "Total",
    reviewHeading: "Review and pay",
    networkLabel: "Mobile money network",
    methodUnavailable:
      "Mobile money payment is temporarily unavailable. Your basket is saved.",
    methodRequired: "Choose a mobile money network.",
    payingPhone: "Paying phone",
    payingPhoneHelp: "The mobile money number that will approve the payment.",
    payingPhoneInvalid:
      "Enter the mobile money number that will approve this payment.",
    beforePayment:
      "Authorize the request on your phone. Never share your mobile-money PIN.",
    acceptTerms:
      "By placing this order you accept the {terms}. Read the {privacy}.",
    termsLink: "Terms",
    privacyLink: "Privacy notice",
    payButton: "Pay {amount}",
    starting: "Starting payment",
    checkoutPaused:
      "Checkout is paused right now. Your basket is saved. Please try again later.",
    staleRevision:
      "Your checkout changed in another window. We've reloaded the latest details.",
    totalChanged: "Your total changed. Review the new total before paying.",
    stockChanged:
      "The available quantity changed. Review your basket to continue.",
    summaryHeading: "Order summary",
    editContact: "Edit contact",
  },
  methods: {
    MTN_MOMO_RWA: "MTN MoMo",
    AIRTEL_RWA: "Airtel Money",
  },
  payment: {
    pendingTitle: "Approve on your phone",
    pendingBody:
      "Complete the mobile money request on your phone. We will update this page after your payment is verified.",
    pendingNotice:
      "We're checking your payment. Please don't pay again while this request is pending.",
    delayedTitle: "Still checking payment",
    delayedBody:
      "Confirmation is taking longer than expected. We are still checking this payment.",
    unresolvedTitle: "Payment is not yet confirmed",
    unresolvedBody:
      "If your wallet was debited, do not pay again. We are checking the existing transaction.",
    notDispatched: "Your order has not been sent for delivery.",
    failedTitle: "Payment not completed",
    failedBody:
      "This payment was not completed. You can try again or choose another available method.",
    failedRecheck:
      "We will recheck stock, delivery fee and the final total before a new attempt.",
    reviewAndRetry: "Review and try again",
    returnToCart: "Return to cart",
    confirmedTitle: "Payment received. Your order is confirmed.",
    holdTitle: "Payment received",
    holdBody: "We are resolving an availability issue and will contact you.",
    checkStatus: "Check payment status",
    checking: "Checking",
    getHelp: "Get help with this payment",
    orderReference: "Order: {reference}",
    viewOrder: "View your order",
    doNotPayAgain:
      "Do not start another payment while this one is being checked.",
    statusUpdated: "Payment status updated: {status}",
    amountWithMethod: "{method} / {phone}",
  },
  order: {
    confirmedHeading: "Your order is confirmed",
    orderHeading: "Order {reference}",
    paymentConfirmed: "Payment confirmed",
    paymentReceivedAmount:
      "{amount} received. We will prepare your order for delivery.",
    deliverTo: "Deliver to",
    deliveryWindow: "Delivery window",
    deliveryWindowPending: "The agreed window appears here.",
    keepPrivate: "This page is private to you. Don't share its address.",
    viewStatus: "View order status",
    continueShopping: "Continue shopping",
    progress: "Order progress",
    stepPaid: "Paid",
    stepPreparing: "Preparing",
    stepDispatched: "Dispatched",
    stepDelivered: "Delivered",
    stepComplete: "complete",
    stepCurrent: "current",
    stepNext: "next",
    items: "Items",
    itemsCount: "{count} products",
    total: "Total",
    states: {
      AWAITING_PAYMENT: "Awaiting payment confirmation",
      PAID: "Your order is confirmed. We will prepare it for delivery.",
      PREPARING: "We are preparing your order.",
      ON_HOLD:
        "Payment received. There is a problem with item availability, and your order is on hold. Support will help resolve it.",
      DISPATCHED: "Your order is on its way.",
      DELIVERED: "Delivered.",
      CANCELLED: "Your order is cancelled.",
    },
    cancelledUnresolved:
      "Your order is cancelled. We are still checking the payment and will help with any refund needed.",
    refundPending: "Your refund of {amount} is being processed.",
    refundConfirmed: "Your refund of {amount} has been confirmed.",
    refundInvestigating:
      "Your refund needs further checking. Support is following up.",
    help: "Get help with this order",
    deliveryPolicy: "Delivery and returns policy",
    accessUnavailableTitle: "This order link is unavailable",
    accessUnavailableBody:
      "Contact support to verify your details and request access.",
    accessExpiredTitle: "This order link has expired",
    accessExpiredBody:
      "Contact support to verify your details and request a new private link.",
    orderUnchanged:
      "An expired link does not cancel an order or change its payment status.",
    manualHold:
      "We need to check something before preparing your order. Support will contact you if we need anything.",
    paymentReviewHold:
      "We are checking this payment with our payment provider. Support will contact you.",
    refundedHold:
      "Your payment has been refunded. Support will contact you if anything else is needed.",
    deliveryFailedTitle: "Delivery was not completed",
    deliveryFailedBody:
      "We could not deliver your order. We will contact you to arrange another delivery.",
    deliveredOn: "Delivered on {time}.",
    refundUnderReview:
      "Your refund is being checked with our payment provider. Support is following up.",
    cancelChanged:
      "Your order was updated while this was open. Check its current status, then send your request again.",
    accessOpening: "Opening your order…",
    accessInvalidTitle: "This order link can't be used",
    accessInvalidBody:
      "It may already have been used, or it may be incomplete. Contact support to verify your details and request a new private link.",
    cancelButton: "Ask to cancel this order",
    cancelTitle: "Ask to cancel this order",
    cancelBody:
      "We will check whether your order has already been handed to our delivery partner. Sending this request does not cancel the order by itself; we will update this page once it is reviewed.",
    cancelReason: "Why do you want to cancel?",
    cancelSubmit: "Send request",
    cancelKeep: "Keep my order",
    cancelPending:
      "Cancellation requested. We will update this page once it is reviewed.",
    cancelDeclined: "Your cancellation request could not be applied.",
    linkButton: "Open this order on another device",
    linkTitle: "Private link to this order",
    linkBody:
      "This link opens this order once, on any device, within 7 days. Anyone who has it can open the order, so don't share it.",
    linkCopy: "Copy link",
    linkCopied: "Link copied.",
    linkCreate: "Create private link",
    close: "Close",
  },
  support: {
    heading: "Help",
    orderHeading: "Help with your order",
    topics: "What do you need help with?",
    topicPayment: "Payment or refund",
    topicDelivery: "Delivery or address change",
    topicCancel: "Cancel, return or damaged item",
    contact: "Contact BeautyBOX support",
    contactPending:
      "Support contact details are not yet confirmed. They will appear here before launch.",
    safety:
      "Share your order reference with support. Never share your wallet PIN.",
  },
  launch: {
    metaTitle: "Launching soon",
    eyebrow: "Launching soon in Kigali",
    heading: "Everyday beauty essentials, coming soon.",
    lede: "Skincare, makeup, bath and body, fragrance and more, from BeautyBOX's own shop in Kigali. We're getting everything ready for opening day.",
    pointsLabel: "What to expect",
    points: [
      {
        id: "delivery",
        title: "Delivered in Kigali",
        text: "From our shop to your door, with delivery priced by distance.",
      },
      {
        id: "guest",
        title: "No account needed",
        text: "Check out as a guest with your name and phone number.",
      },
      {
        id: "momo",
        title: "Pay with Mobile Money",
        text: "MTN MoMo or Airtel Money, confirmed on your phone.",
      },
      {
        id: "total",
        title: "The full total first",
        text: "Products and delivery are added up before you pay.",
      },
    ],
    // The opening film (silent, 23 seconds). filmWords is what it shows, for screen readers.
    filmWords:
      "A short silent film. The BeautyBOX logo opens like a box: Your beauty essentials, delivered in Kigali. No account needed. Pay with Mobile Money. Opening soon.",
    filmPlay: "Play the film",
    filmPause: "Pause the film",
    listHeading: "Be the first to know",
    listIntro:
      "Leave your e-mail address, your phone number or both, and we'll send you one message when BeautyBOX opens. Nothing else.",
    listClosedHeading: "Almost ready",
    copyright: "BeautyBOX · Kigali, Rwanda",
    emailLabel: "E-mail address",
    phoneLabel: "Mobile number",
    phoneHelp: "Rwanda mobile number, for one SMS.",
    contactRequired: "Enter an e-mail address or a phone number.",
    consentBefore:
      "Send me one message when BeautyBOX opens, by e-mail or SMS to the details above. I have read the ",
    consentLink: "privacy notice",
    consentAfter: ".",
    submit: "Notify me",
    submitting: "Adding you",
    joined: "Thank you. We'll let you know when BeautyBOX opens.",
    joinedRemoval:
      "Changed your mind? Write to {email} and we'll remove your details.",
    listClosed:
      "We're putting the finishing touches on the shop. Check back soon: the sign-up for our opening-day message will appear right here.",
    accessPrompt: "Have an access code?",
    accessLink: "Enter it here",
    privacyLink: "Privacy notice",
  },
  access: {
    metaTitle: "Preview access",
    heading: "Preview access",
    eyebrow: "Invited preview",
    intro:
      "BeautyBOX isn't open to the public yet. If you were given an access code, enter it to look around the shop before opening day.",
    codeLabel: "Access code",
    submit: "Continue",
    submitting: "Checking",
    wrong: "That access code is not right.",
    back: "Back to the launch page",
  },
  errors: {
    generic: "Something went wrong. Please try again.",
    network:
      "We couldn't reach BeautyBOX. Check your connection and try again.",
    rateLimited: "Too many attempts. Please wait a moment and try again.",
    notFoundTitle: "Page not found",
    notFoundBody: "The page you're looking for isn't available.",
    tryAgain: "Try again",
  },
  a11y: {
    loading: "Loading",
    required: "required",
    optional: "optional",
    externalNotice: "opens the support channel",
  },
} as const;

export type Messages = typeof en;
