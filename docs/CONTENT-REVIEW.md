# BeautyBOX storefront content review

16 November 2026. Prepared under the owner's instruction to use the supplied documentation and create suitable BeautyBOX content where needed. This is a staging content release; it does not open public ordering or mark policies approved.

## Completed content

- Homepage introduction and About BeautyBOX page: current shop, guest shopping, transparent totals, Kigali delivery and order help.
- Help page: working topic links and complete payment/refund, delivery/address-change and cancellation/returns guidance. Contact details continue to come from the existing operational settings.
- Delivery/returns, terms and privacy: complete readable staging drafts, replacing bracket placeholders. Existing draft labels and production publication gates remain in place.
- Footer: About link, customer-facing shop description and Kigali-calendar copyright year.

## Sources and decisions

| Content                                                                                                                                        | Grounding / status                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single BeautyBOX shop, physically held stock and supplier arrangements, guest checkout, RWF, mobile-money payment                              | Supplied Phase 1 Product Brief and FSD; current implementation                                                                                       |
| Kigali-first delivery and Silverback Mall, Kicukiro location                                                                                   | Owner decisions recorded in CONTINUATION-PLAN.md and src/config/delivery/kigali.ts                                                                   |
| Delivery fee/total before payment, confirmed pin, status verification, no duplicate payment while unresolved                                   | Supplied FSD and implemented checkout/payment flow                                                                                                   |
| Current product/shade/cart behavior and private order/cancellation links                                                                       | Implemented application; no customer account or live rider tracking promised                                                                         |
| Change-of-mind return within seven calendar days, unused/unopened/original packaging, hygiene exceptions with defective-goods rights preserved | New BeautyBOX draft policy choice made under the owner's content-creation authorization. Operations/founder/legal review required before publication |
| Privacy data purposes, optional GPS/maps, pawaPay, Vercel and Supabase, essential cookies                                                      | Current source and deployment documentation. No claim of completed transfer/retention/regulatory approval                                            |
| Broader business plan's booking, CRM, independent vendors and AI features                                                                      | Future vision, deliberately not represented as current shop functionality                                                                            |

The older Product Brief's proposed additional-distance tariff is superseded by the owner's later starting tariff recorded in the current Kigali configuration. Public draft policy explains the quote process rather than hardcoding a fee that could conflict with versioned settings.

## Facts not supplied

The provided preparation checklist explicitly leaves support contacts/hours, physical inventory/photos and business/legal inputs open. The business-plan PDF does not supply a support phone, email, operating hours or a legal registration identity. These cannot be created as factual working contact channels or verified stock.

Before public launch, the business must supply/confirm:

1. A monitored support phone and/or email, response/operating hours and escalation process in staff settings.
2. Real counted SKU/variant stock, current prices and reviewed photographs. Reference/demo products and illustrative packshots are not evidence of real stock.
3. Legal seller/controller identity and contact; reviewed terms, privacy purposes, processor/hosting arrangements, lawful bases, retention schedule, rights/complaint process and applicable consumer obligations.
4. The proposed seven-day change-of-mind policy and hygiene/return-delivery rules, plus actual refund handling and provider timing.
5. Delivery operating hours, rider arrangements, final service promises and the production release prerequisites already listed in RELEASE-CHECKLIST.md.

No policiesApproved, checkout/payment, live-routing, SMS, launch-list or access-wall setting is changed by this release. Direct contacts display only if configured. No guessed telephone number, email address, opening hours, tax identifier or merchant readiness claim is introduced.

## Update — 24 November 2026 (DR-058)

The founder supplied the support contact: **+250 788 641 811**, **care@beautyboxmarket.com**, open **24 hours a day, 7 days a week**. The policies now quote it (`businessContact` in `src/content/beautybox.ts`). The Help page still shows the support contact from the settings, so an administrator enters the same three values in Staff → Settings. Points 1 and 3 above are therefore mostly closed.

The founder asked for the legal and privacy drafts to be reviewed, completed and approved. They were checked against Rwanda's Law No 058/2021, and the gaps were filled:

- **Privacy notice:** the data controller and contact; the reason for each use (contract, legal obligation, security, consent for location); the named processors (pawaPay with MTN and Airtel, Vercel, Supabase, Google, the delivery rider); storage in Ireland, with the commitment to store abroad only as the law permits; retention tied to tax and accounting law; security and breach notice to customers and NCSA; the full list of rights, free of charge; the right to complain to NCSA; no sale, advertising use or solely automated decisions; and a "last updated" date.
- **Terms and delivery/returns:** the seller and its contact, and the laws of Rwanda as governing law.

This review is not legal advice. Before an administrator sets `policiesApproved`, the founder must:

1. Confirm the registered business name. The notices say "BeautyBOX"; if the registered name differs, the notices must use it.
2. Register BeautyBOX with NCSA as a data controller.
3. Hold NCSA's authorization to store personal data outside Rwanda. The privacy notice already commits to this.
4. Accept the seven-day change-of-mind return policy as written.
5. Make sure `care@beautyboxmarket.com` actually receives and is monitored.

Also supplied on 24 November: the **delivery promise** "Delivered within 3 hours in Kigali", and **riders deliver 24/7**, so the dispatch hours are 24/7 too. Both go into Staff → Settings with the support contact. The policies keep pointing to "the delivery window shown for the order", so they stay true if the promise changes. Before launch, operations should be sure 3 hours holds at night and in rain. When order e-mail is built (DR-057), the privacy notice must name the e-mail provider before the first message is sent.
