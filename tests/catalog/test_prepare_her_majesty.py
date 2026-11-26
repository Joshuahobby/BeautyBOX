import csv
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/catalog/prepare-her-majesty.py"
spec = importlib.util.spec_from_file_location("her_majesty_prep", SCRIPT)
prep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prep)


class PrepareHerMajestyTest(unittest.TestCase):
    def test_rights_attestation_must_be_explicit_in_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            review = root / "review.csv"
            allocation = root / "allocation.csv"
            record = {
                "review_id_not_sku": "HM-022", "source_name": "Ice Roller",
                "proposed_beautybox_category_not_approved": "skincare",
                "review_flags": "SOURCE_SKU_MISSING",
                "source_image_url_not_cleared": "https://hermajestycosmetics.com/photo.jpg",
            }
            option = {
                "review_id_not_sku": "HM-022", "candidate_option_from_live_page_unverified": "",
                "founder_authorized_staged_units_not_scraped": "20",
                "proposed_price_rwf_site_plus_3pct": "17510",
                "eligibility": "PROPOSAL_REQUIRES_EXACT_SKU_PHOTO_COPY_REVIEW",
            }
            for path, row in [(review, record), (allocation, option)]:
                with path.open("w", newline="", encoding="utf-8") as file:
                    writer = csv.DictWriter(file, fieldnames=row.keys())
                    writer.writeheader(); writer.writerow(row)
            images = root / "out/photos"
            images.mkdir(parents=True)
            (images / "HM-022.jpg").write_bytes(b"\xff\xd8\xffimage")
            prep.prepare(review, allocation, root / "out", False, rights_attested=True)
            product = json.loads((root / "out/manifest.json").read_text())["products"][0]
            self.assertTrue(product["imageRightsConfirmed"])
            self.assertFalse(product["contentReviewed"])
            self.assertNotIn("https://", json.dumps(product))
            prep.prepare(review, allocation, root / "out", False, rights_attested=True,
                         existing_slugs={"her-majesty-ice-roller"})
            existing = json.loads((root / "out/manifest.json").read_text())["products"][0]
            self.assertTrue(existing["hold"])
            self.assertIn("already exists", existing["holdReason"])

    def test_rejects_unsafe_review_id_before_file_lookup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "evil.jpg").write_bytes(b"\xff\xd8\xffimage")
            photos = root / "photos"
            photos.mkdir()
            with self.assertRaisesRegex(ValueError, "Invalid review ID"):
                prep.download({"review_id_not_sku": "../evil", "source_image_url_not_cleared": "https://hermajestycosmetics.com/photo.jpg"}, photos)

    def test_variant_skus_do_not_change_when_allocation_rows_reorder(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            review = root / "review.csv"
            allocation = root / "allocation.csv"
            record = {
                "review_id_not_sku": "HM-001", "source_name": "Palette",
                "proposed_beautybox_category_not_approved": "makeup", "review_flags": "",
                "source_image_url_not_cleared": "https://hermajestycosmetics.com/photo.jpg",
            }
            with review.open("w", newline="", encoding="utf-8") as file:
                writer = csv.DictWriter(file, fieldnames=record.keys())
                writer.writeheader(); writer.writerow(record)
            options = [dict(review_id_not_sku="HM-001", candidate_option_from_live_page_unverified=shade,
                            founder_authorized_staged_units_not_scraped="3", proposed_price_rwf_site_plus_3pct="1000",
                            eligibility="PROPOSAL_REQUIRES_EXACT_SKU_PHOTO_COPY_REVIEW") for shade in ("Sculpt", "Sublime")]
            photos = root / "out/photos"
            photos.mkdir(parents=True)
            (photos / "HM-001.jpg").write_bytes(b"\xff\xd8\xffimage")
            mappings = []
            for order in (options[:1], options, list(reversed(options)), options + [{**options[0], "candidate_option_from_live_page_unverified": "A new shade"}]):
                with allocation.open("w", newline="", encoding="utf-8") as file:
                    writer = csv.DictWriter(file, fieldnames=options[0].keys())
                    writer.writeheader(); writer.writerows(order)
                prep.prepare(review, allocation, root / "out", False)
                product = json.loads((root / "out/manifest.json").read_text())["products"][0]
                mappings.append({v["attributes"]["shade"]: v["sku"] for v in product["variants"]})
            self.assertEqual(mappings[0]["Sculpt"], mappings[1]["Sculpt"])
            self.assertEqual(mappings[1], mappings[2])
            self.assertEqual(mappings[1], {shade: mappings[3][shade] for shade in mappings[1]})

    def test_redirects_are_blocked_before_following(self):
        handler = prep.NoRedirectHandler()
        self.assertIsNone(handler.redirect_request(None, None, 302, "redirect", {}, "http://127.0.0.1/"))


if __name__ == "__main__":
    unittest.main()
