# Storefront rebuild design QA

**Scope:** homepage, shared shop header/footer, catalogue and product cards only. Purchase-flow and delivery restoration remain separate slices.

**Source visual truth:** `docs/design-explorations/images/11-BeautyBOX-Signature.png`, 1003 × 1568 pixels. The owner's subsequent requests add slideshow controls, mega menus and richer discovery sections. The existing app supplies actual categories, brands, prices, stock and filters.

**Implementation evidence:** `docs/evidence/storefront-rebuild/home-desktop.png` (1003 CSS px), `home-mobile.png` (360 CSS px), `catalog-desktop.png` (1440 CSS px), `catalog-mobile.png` (360 CSS px), and `mega-menu.png`. All captures use deviceScaleFactor 1 and a 900 px viewport; full-page image heights reflect expanded real content. Captured from the local production build on port 3100 with the TEST database and fake providers. Images were decoded before screenshots so lazy loading does not leave blank capture regions.

**Comparison:** source and desktop implementation are together in `reference-comparison.png` at 1× density and equal 1003 px width. The implementation crop starts 30 px below its demo notice to align the shop header with the mock. Source and first product region are together in `product-region-comparison.png`; the app's brand, illustration labels and accessible button heights intentionally add card height. Mobile is a responsive interpretation, since this selected desktop reference has no corresponding phone frame.

## Findings and comparison history

- [P1, resolved] Initial screenshot had missing campaign/product media. Generated and inspected 17 optimized assets: three editorial campaign images and fourteen clearly labelled demo packshots. Final captures and the dedicated image-loading browser test show no broken images. Real SKUs never receive generated demo fallback images.
- [P2, resolved] Initial portrait/jar composition was too small and low, and the second headline line crossed the main jar. Repositioned the artwork, restored portrait height and differentiated the second line's size/weight. Compared the revised composition in `reference-comparison.png`; the editorial hierarchy and product/portrait proportions now follow the source.
- [P2, resolved] Brand names split into isolated letters on narrow screens. Changed mobile brand discovery to full-width cards; final `home-mobile.png` keeps whole words readable.
- [P2, resolved] Mobile botanical-banner copy crossed bright petals. Constrained the photograph to the left half on phones, preserving a solid aubergine text area. Final mobile capture has clear text/background separation.
- [P2, resolved] Catalogue introduction inherited the small eyebrow paragraph rule. Increased selector specificity; final `catalog-desktop.png` shows the intended editorial heading.
- [P2, resolved] Header search could resist shrinking beside the full lockup and cart. Set its flex minimum to zero and kept cart actions non-shrinking. Captures at 360/1003/1440 px show no horizontal overflow.

## Required fidelity surfaces

- **Fonts / typography:** supplied outlined Inter brand lockup, self-hosted Manrope UI, and freely licensed Bodoni Moda display headings. The open-license display face is an intentional approximation of the generated mock's unspecified serif. Header, hero, card labels/prices and mobile wrapping were inspected; buttons retain 44 px targets.
- **Spacing / layout:** split editorial hero, overlapping jar/portrait images, four-column desktop edit, two-column phone cards, visual category discovery and full-width botanical section. Added controls, discovery blocks, product brand labels, demo captions and actual catalogue text account for documented height differences. Mobile brand cards and header overflow were corrected.
- **Colors / tokens:** warm ivory canvas, aubergine text/actions, coral highlights and readable darker coral prices. Existing semantic warning/error styles remain. Automated WCAG AA scans passed at 360/768/1440 px across home, catalogue, product variants/unavailable state and help.
- **Image quality:** Image Gen assets were inspected, decoded and optimized as WebP. Campaign illustrations are separate from SKU imagery. Demo assets are restricted to explicitly listed demo slugs; reviewed product images take precedence. Products without approved photography or a matching demo illustration remain honestly pending. No custom SVG/CSS product drawings or substituted retailer images were added.
- **Copy / content:** the initial hero and edit follow the selected reference. Navigation and catalogue sections use available database content. Budget discovery uses actual listed prices at RWF 10,000 or less; no invented discounts, countdowns, customer counts, reviews or shops are shown. Brand discovery fits the current single-shop model. Genuine promotion/shop-favourite functionality needs supporting product data and scope before it is presented as live.

## Interaction and browser evidence

A fresh production build and ten targeted Playwright checks passed: responsive shop accessibility at three widths, mobile filter apply/discard/focus return, carousel controls and CTAs, mega-menu Escape/focus/navigation, mobile disclosure close on query-only navigation, preserved brand filtering, budget navigation and featured image loading. Additional captures checked all three mobile slides for overflow. Final capture reports no page or console errors and no broken images/overflow.

## Implementation checklist

- [x] Compare source and rendered implementation together, including focused product region.
- [x] Fix all identified P0/P1/P2 issues and recapture.
- [x] Verify desktop and mobile interactions, image loading, console and accessibility.
- [x] Preserve generated-demo versus reviewed-real media separation.
- [x] Record reproducible local capture command: `node scripts/evidence/capture-storefront.mjs`.

## Follow-up polish

- [P3] Exact display-font matching and finer hero crop/letterspacing can be revisited with licensed brand typography and approved campaign photography.
- [P3] Replace remaining pending catalogue imagery when the owner supplies approved SKU photos. Generated demonstrations remain visibly labelled.

final result: passed
