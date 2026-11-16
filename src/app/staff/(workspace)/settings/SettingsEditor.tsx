"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { TextAreaField, TextField } from "@/components/ui/TextField";
import { api, ApiError, newIdempotencyKey } from "@/lib/api-client";
import type { SettingsView } from "@/modules/settings/admin";
import { deliveryFeeRwf } from "@/modules/delivery/tariff";
import styles from "@/components/staff/Staff.module.css";

const num = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);
const dec = (v: string) => (v.trim() === "" ? NaN : Number(v.trim()));

/** Fee preview with the exact server tariff function. */
function previewFee(base: number, includedMetres: number, perKm: number, rounding: number, km: number) {
  return deliveryFeeRwf(km * 1000, { baseRwf: base, includedMetres, extraRwfPerKm: perKm, roundingRwf: rounding });
}

export function SettingsEditor({ settings, canEdit }: { settings: SettingsView; canEdit: boolean }) {
  const router = useRouter();
  const t = settings.tariff;
  const [f, setF] = useState({
    originLabel: settings.originLabel ?? "",
    lat: settings.origin ? String(settings.origin.lat) : "",
    lng: settings.origin ? String(settings.origin.lng) : "",
    dispatchHours: settings.dispatchHours ?? "",
    originApproved: settings.originApproved,
    coverage: settings.coverageGeoJson ? JSON.stringify(settings.coverageGeoJson, null, 1) : "",
    baseRwf: t ? String(t.baseRwf) : "",
    includedMetres: t ? String(t.includedMetres) : "",
    extraRwfPerKm: t ? String(t.extraRwfPerKm) : "",
    roundingRwf: t ? String(t.roundingRwf) : "",
    tariffApproved: t?.approved ?? false,
    maxItems: settings.parcelLimits ? String(settings.parcelLimits.maxItems) : "",
    maxWeightGrams: settings.parcelLimits?.maxWeightGrams ? String(settings.parcelLimits.maxWeightGrams) : "",
    quoteTtlSeconds: String(settings.quoteTtlSeconds),
    supportPhone: settings.supportPhone ?? "",
    supportEmail: settings.supportEmail ?? "",
    deliveryPromise: settings.deliveryPromise ?? "",
    policiesApproved: settings.policiesApproved,
    checkoutEnabled: settings.checkoutEnabled,
    livePaymentsEnabled: settings.livePaymentsEnabled,
    reason: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string; conflict?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((prev) => ({ ...prev, [k]: v }));

  const tariffOk = [f.baseRwf, f.includedMetres, f.extraRwfPerKm].every((v) => Number.isFinite(num(v))) && num(f.roundingRwf) >= 1;
  const previews = tariffOk ? [3, 5, 10].map((km) => `${km} km: RWF ${previewFee(num(f.baseRwf), num(f.includedMetres), num(f.extraRwfPerKm), num(f.roundingRwf), km).toLocaleString("en-US")}`) : [];

  function build(): Record<string, unknown> | null {
    const e: Record<string, string> = {};
    let coverage: unknown = null;
    try {
      coverage = JSON.parse(f.coverage);
    } catch {
      e.coverage = "Paste a valid GeoJSON Polygon.";
    }
    if (!Number.isFinite(dec(f.lat)) || !Number.isFinite(dec(f.lng))) e.lat = "Enter the pin latitude and longitude.";
    if (!f.originLabel.trim()) e.originLabel = "Required.";
    if (!tariffOk) e.baseRwf = "Enter whole RWF amounts and metres; rounding must be at least 1.";
    if (!Number.isFinite(num(f.maxItems)) || num(f.maxItems) < 1) e.maxItems = "Enter a whole number of items.";
    if (f.maxWeightGrams && !Number.isFinite(num(f.maxWeightGrams))) e.maxWeightGrams = "Enter grams as a whole number.";
    if (!Number.isFinite(num(f.quoteTtlSeconds))) e.quoteTtlSeconds = "Enter seconds (60-3600).";
    if (!f.reason.trim()) e.reason = "Give a reason for the change.";
    setErrors(e);
    if (Object.keys(e).length) return null;
    return {
      origin: { lat: dec(f.lat), lng: dec(f.lng) },
      originLabel: f.originLabel.trim(),
      supportPhone: f.supportPhone.trim() || null,
      supportEmail: f.supportEmail.trim() || null,
      dispatchHours: f.dispatchHours.trim() || null,
      deliveryPromise: f.deliveryPromise.trim() || null,
      coverageGeoJson: coverage,
      tariff: { baseRwf: num(f.baseRwf), includedMetres: num(f.includedMetres), extraRwfPerKm: num(f.extraRwfPerKm), roundingRwf: num(f.roundingRwf), approved: f.tariffApproved },
      checkoutEnabled: f.checkoutEnabled,
      livePaymentsEnabled: f.livePaymentsEnabled,
      parcelLimits: { maxItems: num(f.maxItems), maxWeightGrams: f.maxWeightGrams ? num(f.maxWeightGrams) : null, allowedClasses: ["STANDARD"] },
      quoteTtlSeconds: num(f.quoteTtlSeconds),
      originApproved: f.originApproved,
      policiesApproved: f.policiesApproved,
    };
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const body = build();
    if (!body) return;
    setBusy(true);
    setMessage(null);
    key.current ??= newIdempotencyKey();
    try {
      await api("/staff/settings", { method: "PUT", idempotencyKey: key.current, body: { expectedVersion: settings.version, settings: body, reason: f.reason.trim() } });
      key.current = null;
      setMessage({ tone: "success", text: "Saved as a new settings version." });
      set("reason", "");
      router.refresh();
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 0) key.current = null;
      if (e instanceof ApiError) {
        setMessage({ tone: "danger", text: e.message, conflict: e.code === "VERSION_CONFLICT" });
        if (e.fieldErrors.length) setErrors(Object.fromEntries(e.fieldErrors.map((x) => [x.field.replace(/^settings\./, "").replace(/^coverageGeoJson$/, "coverage"), x.message])));
      } else {
        setMessage({ tone: "danger", text: "Something went wrong." });
      }
    } finally {
      setBusy(false);
    }
  }

  const check = (k: "originApproved" | "tariffApproved" | "policiesApproved" | "checkoutEnabled" | "livePaymentsEnabled", label: string) => (
    <label className={styles.row}>
      <input type="checkbox" checked={f[k]} disabled={!canEdit} onChange={(e) => set(k, e.target.checked)} /> {label}
    </label>
  );

  return (
    <form className={styles.formGrid} onSubmit={save} noValidate aria-label="Settings">
      <fieldset className={`${styles.formGrid} ${styles.fieldsetPanel}`} disabled={!canEdit}>
        <legend className="u-w-600">Dispatch point</legend>
        <TextField id="s-origin-label" label="Name" value={f.originLabel} onChange={(e) => set("originLabel", e.target.value)} error={errors.originLabel} />
        <div className={styles.row}>
          <TextField id="s-lat" label="Pin latitude" inputMode="decimal" value={f.lat} onChange={(e) => set("lat", e.target.value)} error={errors.lat ?? errors.origin} />
          <TextField id="s-lng" label="Pin longitude" inputMode="decimal" value={f.lng} onChange={(e) => set("lng", e.target.value)} />
        </div>
        <TextField id="s-hours" label="Dispatch hours" optional value={f.dispatchHours} onChange={(e) => set("dispatchHours", e.target.value)} help="For example: Mon-Sat 09:00-18:00" />
        {check("originApproved", "The pin and hours were verified on site (B03/B04).")}
      </fieldset>

      <fieldset className={`${styles.formGrid} ${styles.fieldsetPanel}`} disabled={!canEdit}>
        <legend className="u-w-600">Delivery tariff and area</legend>
        <div className={styles.row}>
          <TextField id="s-base" label="Base fee (RWF)" inputMode="numeric" value={f.baseRwf} onChange={(e) => set("baseRwf", e.target.value)} error={errors.baseRwf ?? errors["tariff"]} />
          <TextField id="s-included" label="Included distance (metres)" inputMode="numeric" value={f.includedMetres} onChange={(e) => set("includedMetres", e.target.value)} />
          <TextField id="s-perkm" label="Each extra km (RWF)" inputMode="numeric" value={f.extraRwfPerKm} onChange={(e) => set("extraRwfPerKm", e.target.value)} />
          <TextField id="s-round" label="Round up to (RWF)" inputMode="numeric" value={f.roundingRwf} onChange={(e) => set("roundingRwf", e.target.value)} />
        </div>
        {previews.length ? <p className="label-text muted" aria-live="polite">Preview: {previews.join(" · ")}</p> : null}
        {check("tariffApproved", "This tariff is approved for customers (B05).")}
        <TextAreaField
          id="s-coverage"
          label="Delivery area (GeoJSON Polygon, longitude then latitude)"
          rows={6}
          value={f.coverage}
          onChange={(e) => set("coverage", e.target.value)}
          error={errors.coverage}
          help="One GeoJSON boundary without holes, inside Rwanda; up to 2,048 points. The complete Kigali boundary is available through the local configuration command."
        />
      </fieldset>

      <fieldset className={`${styles.formGrid} ${styles.fieldsetPanel}`} disabled={!canEdit}>
        <legend className="u-w-600">Parcels and quotes</legend>
        <div className={styles.row}>
          <TextField id="s-items" label="Most items per delivery" inputMode="numeric" value={f.maxItems} onChange={(e) => set("maxItems", e.target.value)} error={errors.maxItems} />
          <TextField id="s-weight" label="Weight limit (grams)" optional inputMode="numeric" value={f.maxWeightGrams} onChange={(e) => set("maxWeightGrams", e.target.value)} error={errors.maxWeightGrams} help="Recorded only: products do not carry weights yet." />
          <TextField id="s-ttl" label="Quote valid for (seconds)" inputMode="numeric" value={f.quoteTtlSeconds} onChange={(e) => set("quoteTtlSeconds", e.target.value)} error={errors.quoteTtlSeconds} />
        </div>
      </fieldset>

      <fieldset className={`${styles.formGrid} ${styles.fieldsetPanel}`} disabled={!canEdit}>
        <legend className="u-w-600">Customer support and policies</legend>
        <div className={styles.row}>
          <TextField id="s-phone" label="Support phone" optional value={f.supportPhone} onChange={(e) => set("supportPhone", e.target.value)} error={errors.supportPhone} help="+2507XXXXXXXX" />
          <TextField id="s-email" label="Support email" optional value={f.supportEmail} onChange={(e) => set("supportEmail", e.target.value)} error={errors.supportEmail} />
        </div>
        <TextField id="s-promise" label="Delivery promise shown to customers" optional value={f.deliveryPromise} onChange={(e) => set("deliveryPromise", e.target.value)} />
        {check("policiesApproved", "Delivery, returns, terms and privacy texts are approved and published (B09).")}
      </fieldset>

      <fieldset className={`${styles.formGrid} ${styles.fieldsetPanel}`} disabled={!canEdit}>
        <legend className="u-w-600">Selling</legend>
        {check("checkoutEnabled", "Checkout open (untick to pause new payments)")}
        {check("livePaymentsEnabled", "Live payments (production only after every release gate passes)")}
      </fieldset>

      {canEdit ? (
        <>
          <TextAreaField id="s-reason" label="Reason for this change" rows={2} value={f.reason} onChange={(e) => set("reason", e.target.value)} error={errors.reason} />
          {message ? (
            <Notice
              tone={message.tone}
              title={message.text}
              role={message.tone === "danger" ? "alert" : "status"}
              actions={message.conflict ? <Button variant="secondary" onClick={() => router.refresh()}>Reload settings</Button> : null}
            />
          ) : null}
          <div className={styles.row}>
            <Button type="submit" busy={busy}>
              Save new version
            </Button>
          </div>
        </>
      ) : (
        <p className="muted">Only an administrator can change settings.</p>
      )}
    </form>
  );
}
