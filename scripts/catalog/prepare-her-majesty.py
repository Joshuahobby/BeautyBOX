#!/usr/bin/env python3
"""Prepare a Her Majesty batch without writing to BeautyBOX or exposing source URLs.

Usage: python scripts/catalog/prepare-her-majesty.py --review PATH --allocation PATH
       --output DIR [--download]

The source review CSV remains a private provenance record. Only local photo names and
BeautyBOX-owned identifiers appear in manifest.json. Hold rows remain visible.
"""
import argparse
import csv
import hashlib
import json
import re
import unicodedata
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def slugify(value):
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", value))


def photo_type(data):
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "webp"
    raise ValueError("unsupported image bytes")


def review_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"HM-[0-9]{3}", value):
        raise ValueError("Invalid review ID (expected HM-000 through HM-999)")
    return value


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        # urllib normally opens the redirect target before response.url is checked.
        return None


def download(row, directory):
    key = review_id(row["review_id_not_sku"])
    url = row["source_image_url_not_cleared"]
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "hermajestycosmetics.com" or parsed.username or parsed.password:
        raise ValueError("image host not allowed")
    existing = [directory / f"{key}.{ext}" for ext in ("jpg", "png", "webp")]
    for item in existing:
        if item.is_file():
            return item.name
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; BeautyBOX catalogue intake)"})
    opener = urllib.request.build_opener(NoRedirectHandler())
    with opener.open(request, timeout=45) as response:
        if urllib.parse.urlparse(response.url).hostname != parsed.hostname:
            raise ValueError("image redirected to another host")
        data = response.read(10_000_001)
    if not 0 < len(data) <= 10_000_000:
        raise ValueError("image empty or exceeds 10 MB upload limit")
    extension = photo_type(data)
    target = directory / f"{key}.{extension}"
    target.write_bytes(data)
    return target.name


def prepare(review, allocation, output, download_images, rights_attested=False, existing_slugs=None):
    reviews = rows(review)
    allocations = rows(allocation)
    review_keys = [review_id(row["review_id_not_sku"]) for row in reviews]
    allocation_keys = [review_id(row["review_id_not_sku"]) for row in allocations]
    if len(set(review_keys)) != len(reviews) or set(allocation_keys) != set(review_keys):
        raise ValueError("Duplicate review ID or allocation/review ID mismatch")
    existing_slugs = set(existing_slugs or ())
    by_id = {}
    for allocation_row in allocations:
        by_id.setdefault(allocation_row["review_id_not_sku"], []).append(allocation_row)
    images = output / "photos"
    images.mkdir(parents=True, exist_ok=True)
    downloaded = {}
    failures = {}
    if download_images:
        with ThreadPoolExecutor(max_workers=5) as executor:
            jobs = {executor.submit(download, row, images): row["review_id_not_sku"] for row in reviews}
            for job in as_completed(jobs):
                key = jobs[job]
                try:
                    downloaded[key] = job.result()
                except Exception as exc:
                    failures[key] = str(exc)
    products = []
    stock = []
    for row in reviews:
        key = row["review_id_not_sku"]
        options = by_id.get(key, [])
        if len(options) > 1:
            # Never assign a new SKU to a different shade merely because CSV rows moved.
            labels = [item["candidate_option_from_live_page_unverified"].strip() for item in options]
            if any(not label for label in labels) or len({label.casefold() for label in labels}) != len(labels):
                raise ValueError(f"{key}: multiple variants need distinct nonblank shade labels")
            options = sorted(options, key=lambda item: item["candidate_option_from_live_page_unverified"].strip().casefold())
        product_number = 1 if key == "HM-022" else int(key.split("-")[1]) + 1
        base_sku = f"BB-HMC-{product_number:04d}"
        name = row["source_name"].strip()
        slug = "her-majesty-" + slugify(name)
        category = row["proposed_beautybox_category_not_approved"] or ("tools-accessories" if key == "HM-037" else "makeup")
        flags = row["review_flags"].split("|")
        hold_reasons = []
        if slug in existing_slugs:
            hold_reasons.append("Product already exists on staging; reconcile existing draft and photo separately")
        if not options:
            hold_reasons.append("No option worksheet row")
        if any(item["eligibility"].startswith("HOLD_") for item in options):
            hold_reasons.append("Source/live selector or source review hold")
        for risky in ("MISSING_CATEGORY", "IMAGE_FILENAME_NOIR_VERIFY_PRODUCT_MATCH", "TITLE_SAYS_10_DESCRIPTION_SAYS_8_AND_URL_8", "SOURCE_REVIEW_EXCLUDED", "INSTRUCTIONS_SAY_UNDER_GLUE_DO_NOT_COPY"):
            if risky in flags:
                hold_reasons.append(risky)
        photo = downloaded.get(key)
        if not photo:
            existing = [images / f"{key}.{ext}" for ext in ("jpg", "png", "webp")]
            available = next((item for item in existing if item.is_file()), None)
            if available:
                photo = available.name
            else:
                hold_reasons.append("Photo unavailable" + (": " + failures[key] if key in failures else ""))
        variants = []
        for item in options:
            shade = item["candidate_option_from_live_page_unverified"].strip()
            # A proposed internal SKU is bound to its review ID and shade label, not
            # a worksheet position; adding a shade cannot silently remap stock.
            suffix = hashlib.sha256(f"{key}\0{shade.casefold()}".encode()).hexdigest()[:12].upper()
            sku = base_sku if not shade else f"{base_sku}-{suffix}"
            units = int(item["founder_authorized_staged_units_not_scraped"])
            price = int(item["proposed_price_rwf_site_plus_3pct"])
            variants.append({"sku": sku, "attributes": {"shade": shade} if shade else {}, "priceRwf": price})
            stock.append({"reviewId": key, "sku": sku, "quantityOnHand": units, "eligible": item["eligibility"]})
        products.append({
            "slug": slug, "title": name, "brand": "Her Majesty Cosmetics",
            "categorySlug": category,
            "description": f"Her Majesty Cosmetics {name}.",
            "photoFile": photo or f"{key}.jpg",
            "variants": variants,
            "contentReviewed": False, "imageRightsConfirmed": rights_attested,
            "hold": bool(hold_reasons), "holdReason": "; ".join(hold_reasons) if hold_reasons else "",
        })
    if len(products) != len(reviews) or sum(len(p["variants"]) for p in products) != len(allocations):
        raise ValueError("Product or variant count disagrees with source worksheets")
    if existing_slugs - {p["slug"] for p in products}:
        raise ValueError("Requested existing slug was not found in source review")
    if len({p["slug"] for p in products}) != len(products) or len({v["sku"] for p in products for v in p["variants"]}) != len(allocations):
        raise ValueError("Duplicate slugs or internal SKU mapping")
    manifest = {"version": 1, "products": products}
    text = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    if "https://" in text or "http://" in text:
        raise ValueError("Source URL leaked into import manifest")
    (output / "manifest.json").write_text(text, encoding="utf-8")
    (output / "stock-plan.json").write_text(json.dumps(stock, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"products": len(products), "variants": len(allocations), "draftEligible": sum(not p["hold"] for p in products), "held": [p["slug"] for p in products if p["hold"]], "photosDownloaded": len(downloaded), "photoFailures": failures}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--review", type=Path, required=True)
    parser.add_argument("--allocation", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--rights-attested", action="store_true", help="Founder confirms permission to copy/host supplier website photos")
    parser.add_argument("--hold-existing-slug", action="append", default=[], help="Hold a verified existing staging slug rather than overwrite it")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    prepare(args.review, args.allocation, args.output, args.download, rights_attested=args.rights_attested, existing_slugs=args.hold_existing_slug)
