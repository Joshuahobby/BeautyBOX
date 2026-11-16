# Delivery review visual QA — 16 November 2026

Reference: the selected Signature visual system and the supplied purchase/shade/cart board. The delivery screens are a responsive continuation of the app flow, rather than a pixel copy of a separate supplied checkout image.

Checked mobile delivery and payment review in the real local production build at 390 CSS px/density 1. The simulated 5 km route produces RWF 2,000 delivery on RWF 10,000 merchandise, for RWF 12,000 total. Demo payment instructions are visible and clearly local; no real payment is submitted by the capture script.

A first full-page screenshot captured the sticky header at the page's current scrolled offset. Updated the evidence script to return to the top and allow layout to settle before capture. Separately, checkout focus targets receive a scroll margin below the sticky header; the delivery browser cases check the focused heading is not obscured after a step change. All four delivery browser cases passed with that focused-heading check; the final capture was recaptured from that build.

Product, shade and cart visual QA: ../purchase-rebuild/design-qa.md. The browser suite covers responsive axe at 360/768/1440 and 320 checkout reflow. This is demo/fake-provider visual evidence. Real Google places, motorcycle coverage and an Embed map are not claimed verified.
