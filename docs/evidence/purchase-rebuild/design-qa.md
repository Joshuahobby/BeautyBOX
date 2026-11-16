# Product and cart visual review — 16 November 2026

Final result: passed for the rebuilt purchase presentation after responsive adjustments.

Reference: the owner-supplied product/shade/mobile-cart board in chat and the saved Signature homepage visual system. The original three-screen board is not available as a local file; this is a structural and visual-system review, not a pixel-difference claim against that board.

Checked: large product image and title/price hierarchy; explicit shade draft and confirmation; named unavailable options; shared/illustrative captions; cart option editing and quantity controls; merchandise subtotal distinct from delivery; sticky mobile checkout action; 360/768/1440 responsive behavior, 320 checkout reflow, keyboard focus and axe checks.

Fixed during capture review: two-column product layout now begins at 768 CSS px (the initial 1003px capture stacked the image and information); shade confirmation text and icon now stay on one line. Captures use CSS pixels at density 1. Mobile dialog/cart captures show the viewport to represent fixed controls correctly.

Accepted differences: the app retains its demo notice, full navigation/search, shared-image captions and real catalogue strings. Only existing approved/gallery images are shown; no fictional extra product angles, reviews or shade-specific colours are invented. The gallery therefore shows one image for the current demonstration product. Cart is a full page with a sticky mobile summary, matching the provided content hierarchy without introducing a second cart state in a drawer.

Verification: fresh production build, 90 unit tests and 165 integration tests passed; 6 optional external-service cases skipped. The final additional targeted run passed all 7 checks. Targeted browser runs cover purchase, stock/option failures, keyboard flow, axe, mobile cart and checkout. Screenshot capture rejects broken images, overflow, page errors and console errors.
