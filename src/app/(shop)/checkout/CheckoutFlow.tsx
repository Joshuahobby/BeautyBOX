"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  LocateFixed,
  MapPin,
} from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Money } from "@/components/ui/Money";
import { Notice } from "@/components/ui/Notice";
import { TextAreaField, TextField } from "@/components/ui/TextField";
import { useCart } from "@/components/cart/CartProvider";
import {
  api,
  ApiError,
  ensureGuestSession,
  newIdempotencyKey,
} from "@/lib/api-client";
import { displayRwandaPhone, toCanonicalRwandaPhone } from "@/lib/phone-input";
import type {
  Checkout,
  PaymentAttempt,
  PaymentMethodCode,
  PlaceSuggestion,
  Point,
  Quote,
} from "@/lib/types";
import { format, formatKigaliTime, messages } from "@/messages";
import { formatRwf } from "@/modules/shared/money";
import {
  CheckoutSummary,
  ErrorSummary,
  StepProgress,
  type FieldIssue,
  type StepKey,
} from "./parts";
import styles from "./checkout.module.css";
import { ManualLocation, StreetMapPreview } from "./LocationControls";

const NUDGE_DEGREES = 0.000225; // ~25 m

type Problem =
  | { kind: "outside" }
  | { kind: "route" }
  | { kind: "parcel"; message: string }
  | { kind: "stock" }
  | { kind: "paused"; message: string }
  | { kind: "generic"; message: string };

function problemFrom(error: unknown, phase: "quote" | "pay"): Problem {
  if (!(error instanceof ApiError))
    return { kind: "generic", message: messages.errors.generic };
  if (error.code === "OUTSIDE_COVERAGE") return { kind: "outside" };
  if (error.code === "STOCK_CHANGED") return { kind: "stock" };
  if (
    error.code === "VALIDATION_ERROR" &&
    error.fieldErrors.some((f) => f.field === "parcel")
  ) {
    return { kind: "parcel", message: error.message };
  }
  if (error.code === "PROVIDER_UNAVAILABLE") {
    return phase === "quote"
      ? { kind: "route" }
      : { kind: "paused", message: error.message };
  }
  return { kind: "generic", message: error.message };
}

export function CheckoutFlow({
  demoScenarios,
  googlePlaces = false,
  mapEmbedKey,
}: {
  demoScenarios: { suffix: string; label: string }[] | null;
  googlePlaces?: boolean;
  mapEmbedKey?: string;
}) {
  const router = useRouter();
  const { cart, refresh: refreshCart } = useCart();
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<StepKey>("contact");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  // Last location intent wins across asynchronous Places and GPS responses.
  const pinIntent = useRef(0);

  // Contact (U06)
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [contactIssues, setContactIssues] = useState<FieldIssue[]>([]);

  // Destination (U07)
  const [destination, setDestination] = useState<Point | null>(null);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const [landmark, setLandmark] = useState("");
  const [instructions, setInstructions] = useState("");
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [places, setPlaces] = useState<PlaceSuggestion[] | null>(null);
  const [placesError, setPlacesError] = useState(false);
  const [locating, setLocating] = useState(false);
  const [resolvingPlace, setResolvingPlace] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [destinationIssues, setDestinationIssues] = useState<FieldIssue[]>([]);

  // Quote (U08) and payment (U09)
  const [quote, setQuote] = useState<Quote | null>(null);
  const [previousFee, setPreviousFee] = useState<number | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [methods, setMethods] = useState<PaymentMethodCode[] | null>(null);
  const [methodsUnavailable, setMethodsUnavailable] = useState(false);
  const [method, setMethod] = useState<PaymentMethodCode | null>(null);
  const [payerPhone, setPayerPhone] = useState("");
  const [payIssues, setPayIssues] = useState<FieldIssue[]>([]);
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const payKey = useRef<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const goTo = useCallback((next: StepKey) => {
    setStep(next);
    setProblem(null);
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }, []);

  const load = useCallback(async () => {
    try {
      await ensureGuestSession();
      const currentCart = await refreshCart();
      if (!currentCart || !currentCart.checkoutId) {
        router.replace("/cart");
        return;
      }
      const current = await api<Checkout>(
        `/checkouts/${currentCart.checkoutId}`,
      );
      if (current.state === "PAYMENT_PENDING" && current.activeAttemptId) {
        router.replace(`/payment/${current.activeAttemptId}`); // recover, never a second payment
        return;
      }
      if (current.state === "CONVERTED" && current.orderId) {
        router.replace(`/orders/${current.orderId}`);
        return;
      }
      setCheckout(current);
      if (current.recipient) {
        setName(current.recipient.name);
        setPhone(displayRwandaPhone(current.recipient.phone));
        setPayerPhone((p) => p || displayRwandaPhone(current.recipient!.phone));
        setLandmark(current.recipient.landmark ?? "");
        setInstructions(current.recipient.instructions ?? "");
      }
      if (current.destination) setDestination(current.destination);
      if (current.quote) {
        setQuote({
          ...current.quote,
          checkoutId: current.id,
          checkoutRevision: current.revision,
          currency: "RWF",
        });
        setStep("payment");
      } else if (current.recipient) setStep("delivery");
      if (current.lastAttempt?.state === "FAILED" && !current.quote) {
        setNotice(messages.payment.failedRecheck);
      }
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : messages.errors.generic);
    }
  }, [refreshCart, router]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => (active ? load() : null));
    return () => {
      active = false;
    };
  }, [load]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  // Place search: 300 ms debounce, IME-safe, stale responses cancelled.
  useEffect(() => {
    if (composing) return;
    const q = query.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await api<{ items: PlaceSuggestion[] }>(
          `/places?q=${encodeURIComponent(q)}`,
          { signal: controller.signal },
        );
        setPlaces(res.items);
        setPlacesError(false);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setPlacesError(true);
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, composing]);

  useEffect(() => {
    if (step !== "payment" || methods !== null) return;
    api<{ methods: PaymentMethodCode[]; temporarilyUnavailable: boolean }>(
      "/payment-methods",
    )
      .then((res) => {
        setMethods(res.methods);
        setMethodsUnavailable(
          res.temporarilyUnavailable || res.methods.length === 0,
        );
        if (res.methods.length === 1) setMethod(res.methods[0]!);
      })
      .catch(() => {
        setMethods([]);
        setMethodsUnavailable(true);
      });
  }, [step, methods]);

  function submitContact(event: React.FormEvent) {
    event.preventDefault();
    const issues: FieldIssue[] = [];
    if (!name.trim())
      issues.push({
        fieldId: "recipient-name",
        message: messages.checkout.nameRequired,
      });
    if (!toCanonicalRwandaPhone(phone))
      issues.push({
        fieldId: "recipient-phone",
        message: messages.checkout.phoneInvalid,
      });
    setContactIssues(issues);
    if (issues.length > 0) {
      window.requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    if (!payerPhone) setPayerPhone(phone);
    const recipientChanged =
      checkout?.recipient?.name !== name.trim().replace(/\s+/g, " ") ||
      checkout?.recipient?.phone !== toCanonicalRwandaPhone(phone);
    if (recipientChanged) setQuote(null);
    goTo("delivery");
  }

  async function choosePlace(place: PlaceSuggestion) {
    const intent = ++pinIntent.current;
    setLocating(false);
    setResolvingPlace(true);
    try {
      const resolved = await api<{ label: string; point: Point }>(
        `/places/${encodeURIComponent(place.placeId)}`,
      );
      if (intent !== pinIntent.current) return;
      setDestination(resolved.point);
      setPlaceLabel(resolved.label);
      setQuote(null);
      setDestinationIssues([]);
      setLocationMessage(
        format("Pin set to {place}. Adjust it to your entrance if needed.", {
          place: resolved.label,
        }),
      );
    } catch {
      if (intent === pinIntent.current) setPlacesError(true);
    } finally {
      if (intent === pinIntent.current) setResolvingPlace(false);
    }
  }

  function useMyLocation() {
    const intent = ++pinIntent.current;
    setResolvingPlace(false);
    if (!("geolocation" in navigator)) {
      setLocationMessage(messages.checkout.locationUnavailable);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (intent !== pinIntent.current) return;
        setLocating(false);
        // GPS only proposes a pin; the customer still confirms it (never auto-submitted).
        setDestination({
          lat: Math.round(pos.coords.latitude * 1e6) / 1e6,
          lng: Math.round(pos.coords.longitude * 1e6) / 1e6,
        });
        setPlaceLabel(null);
        setQuote(null);
        setDestinationIssues([]);
        setLocationMessage(
          "Pin set to your current location. Check it and adjust it to your entrance.",
        );
      },
      (err) => {
        if (intent !== pinIntent.current) return;
        setLocating(false);
        setLocationMessage(
          err.code === err.PERMISSION_DENIED
            ? messages.checkout.locationDeclined
            : messages.checkout.locationUnavailable,
        );
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  function nudge(dLat: number, dLng: number) {
    if (!destination) return;
    pinIntent.current++;
    setResolvingPlace(false);
    setLocating(false);
    setPlaceLabel(null);
    setDestination({
      lat: Math.round((destination.lat + dLat) * 1e6) / 1e6,
      lng: Math.round((destination.lng + dLng) * 1e6) / 1e6,
    });
    setQuote(null);
  }

  async function confirmPinAndQuote() {
    if (!checkout) return;
    const canonical = toCanonicalRwandaPhone(phone);
    const issues: FieldIssue[] = [];
    if (!destination)
      issues.push({
        fieldId: "place-search",
        message: messages.checkout.pinRequired,
      });
    setDestinationIssues(issues);
    if (!canonical || !name.trim()) {
      goTo("contact");
      return;
    }
    if (issues.length > 0) {
      window.requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setQuoting(true);
    setProblem(null);
    try {
      const updated = await api<Checkout>(`/checkouts/${checkout.id}`, {
        method: "PATCH",
        body: {
          expectedRevision: checkout.revision,
          recipient: {
            name: name.trim(),
            phone: canonical,
            ...(landmark.trim() ? { landmark: landmark.trim() } : {}),
            ...(instructions.trim()
              ? { instructions: instructions.trim() }
              : {}),
          },
          destination,
          destinationConfirmed: "CUSTOMER_CONFIRMED",
        },
      });
      const fresh = await api<Quote>(`/checkouts/${updated.id}/quotes`, {
        method: "POST",
        body: { expectedRevision: updated.revision },
      });
      const after = await api<Checkout>(`/checkouts/${updated.id}`);
      setCheckout(after);
      setPreviousFee(
        quote && quote.amountRwf !== fresh.amountRwf ? quote.amountRwf : null,
      );
      setQuote(fresh);
    } catch (e) {
      if (e instanceof ApiError && e.code === "VERSION_CONFLICT") {
        setNotice(messages.checkout.staleRevision);
        await load();
      } else if (
        e instanceof ApiError &&
        e.fieldErrors.some((f) => f.field.startsWith("recipient"))
      ) {
        setContactIssues(
          e.fieldErrors.map((f) => ({
            fieldId:
              f.field === "recipient.name"
                ? "recipient-name"
                : "recipient-phone",
            message: f.message,
          })),
        );
        goTo("contact");
      } else {
        setProblem(problemFrom(e, "quote"));
      }
    } finally {
      setQuoting(false);
    }
  }

  async function recalculate() {
    if (!checkout) return;
    setQuoting(true);
    setProblem(null);
    try {
      const latest = await api<Checkout>(`/checkouts/${checkout.id}`);
      const fresh = await api<Quote>(`/checkouts/${latest.id}/quotes`, {
        method: "POST",
        body: { expectedRevision: latest.revision },
      });
      const after = await api<Checkout>(`/checkouts/${latest.id}`);
      setCheckout(after);
      if (quote && quote.amountRwf !== fresh.amountRwf) {
        setPreviousFee(quote.amountRwf);
        setQuote(fresh);
        goTo("delivery"); // a changed total must be reviewed and accepted again
      } else {
        setQuote(fresh);
      }
    } catch (e) {
      setProblem(problemFrom(e, "quote"));
    } finally {
      setQuoting(false);
    }
  }

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    if (!checkout || !quote || checkout.totalRwf === null) return;
    const canonicalPayer = toCanonicalRwandaPhone(payerPhone);
    const issues: FieldIssue[] = [];
    if (!method)
      issues.push({
        fieldId: "method-first",
        message: messages.checkout.methodRequired,
      });
    if (!canonicalPayer)
      issues.push({
        fieldId: "payer-phone",
        message: messages.checkout.payingPhoneInvalid,
      });
    setPayIssues(issues);
    if (issues.length > 0) {
      window.requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setPaying(true);
    setProblem(null);
    // One key per reviewed intent: a network retry replays the same intent, never a new one.
    payKey.current ??= newIdempotencyKey();
    try {
      const attempt = await api<PaymentAttempt>(
        `/checkouts/${checkout.id}/payments`,
        {
          method: "POST",
          idempotencyKey: payKey.current,
          body: {
            expectedRevision: checkout.revision,
            quoteId: quote.id,
            acceptedTotalRwf: checkout.totalRwf,
            method,
            payerPhone: canonicalPayer,
          },
        },
      );
      router.push(`/payment/${attempt.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        setProblem({ kind: "generic", message: messages.errors.network });
        setPaying(false);
        return; // keep the key: retrying resends the same intent
      }
      payKey.current = null;
      setPaying(false);
      if (!(e instanceof ApiError)) return setProblem(problemFrom(e, "pay"));
      if (e.code === "PAYMENT_UNRESOLVED") return void load();
      if (
        e.code === "QUOTE_EXPIRED" ||
        e.code === "QUOTE_INVALID" ||
        e.code === "VERSION_CONFLICT"
      ) {
        setNotice(
          e.code === "QUOTE_EXPIRED"
            ? messages.checkout.quoteExpired
            : messages.checkout.totalChanged,
        );
        await recalculate();
        return;
      }
      if (e.fieldErrors.length > 0) {
        setPayIssues(
          e.fieldErrors.map((f) => ({
            fieldId: f.field === "method" ? "method-first" : "payer-phone",
            message: f.message,
          })),
        );
        window.requestAnimationFrame(() => summaryRef.current?.focus());
        return;
      }
      setProblem(problemFrom(e, "pay"));
    }
  }

  if (loadError) {
    return (
      <Notice
        tone="danger"
        title={loadError}
        actions={
          <Button variant="secondary" onClick={() => void load()}>
            {messages.catalog.retry}
          </Button>
        }
      />
    );
  }
  if (!checkout) {
    return (
      <p role="status" className="muted">
        {messages.a11y.loading}
      </p>
    );
  }

  const visiblePlaces = query.trim().length >= 2 ? places : null;
  const quoteExpired = quote
    ? new Date(quote.validUntil).getTime() <= now
    : false;
  const deliveryFee = quote && !quoteExpired ? quote.amountRwf : null;
  const total = checkout.totalRwf;

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <StepProgress current={step} />
        {notice ? <Notice tone="warning" title={notice} role="status" /> : null}

        {step === "contact" ? (
          <form className={styles.form} onSubmit={submitContact} noValidate>
            <h1 ref={headingRef} tabIndex={-1} className="page-title">
              {messages.checkout.contactHeading}
            </h1>
            <ErrorSummary ref={summaryRef} issues={contactIssues} />
            <TextField
              id="recipient-name"
              label={messages.checkout.recipientName}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              error={
                contactIssues.find((i) => i.fieldId === "recipient-name")
                  ?.message
              }
            />
            <TextField
              id="recipient-phone"
              label={messages.checkout.recipientPhone}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+250 7XX XXX XXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              help={messages.checkout.recipientPhoneHelp}
              error={
                contactIssues.find((i) => i.fieldId === "recipient-phone")
                  ?.message
              }
            />
            <p className="label-text muted">{messages.checkout.noAccount}</p>
            <Button type="submit" full>
              {messages.checkout.continueToDelivery}
            </Button>
          </form>
        ) : null}

        {step === "delivery" ? (
          <div className={styles.form}>
            <h1 ref={headingRef} tabIndex={-1} className="page-title">
              {quote && !quoteExpired
                ? messages.checkout.deliveryReviewHeading
                : messages.checkout.locationHeading}
            </h1>
            <ErrorSummary ref={summaryRef} issues={destinationIssues} />
            {!quote || quoteExpired ? (
              <>
                <div className="stack-2">
                  <TextField
                    id="place-search"
                    label={messages.checkout.searchPlace}
                    type="search"
                    placeholder={messages.checkout.searchPlacePlaceholder}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onCompositionStart={() => setComposing(true)}
                    onCompositionEnd={() => setComposing(false)}
                    optional
                    autoComplete="off"
                    error={
                      destinationIssues.find(
                        (i) => i.fieldId === "place-search",
                      )?.message
                    }
                  />
                  {placesError ? (
                    <p className="label-text muted">
                      {messages.checkout.placesUnavailable}
                    </p>
                  ) : null}
                  {visiblePlaces && visiblePlaces.length === 0 ? (
                    <p className="label-text muted">
                      {messages.checkout.noPlaceResults}
                    </p>
                  ) : null}
                  {visiblePlaces && visiblePlaces.length > 0 ? (
                    <ul
                      className={styles.places}
                      aria-label={messages.checkout.placeResults}
                    >
                      {visiblePlaces.map((p) => (
                        <li key={p.placeId}>
                          <button
                            type="button"
                            className={styles.placeButton}
                            onClick={() => void choosePlace(p)}
                          >
                            <strong>{p.label}</strong>
                            {p.secondary ? (
                              <span className="label-text muted">
                                {" "}
                                · {p.secondary}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {googlePlaces ? (
                    <img
                      className={styles.googleAttribution}
                      src="/images/attribution/google-maps.svg"
                      alt="Google Maps"
                      width={98}
                      height={18}
                    />
                  ) : null}
                </div>
                <div className={styles.panel}>
                  <p className="label-text muted">
                    {messages.checkout.locationExplain}
                  </p>
                  <Button
                    variant="secondary"
                    onClick={useMyLocation}
                    busy={locating}
                    busyLabel={messages.checkout.locating}
                  >
                    <LocateFixed size={18} aria-hidden="true" />{" "}
                    {messages.checkout.useMyLocation}
                  </Button>
                </div>
                <PinPanel
                  destination={destination}
                  placeLabel={placeLabel}
                  onNudge={nudge}
                />
                <StreetMapPreview
                  point={destination}
                  browserKey={mapEmbedKey}
                />
                <ManualLocation
                  onPick={(point) => {
                    pinIntent.current++;
                    setResolvingPlace(false);
                    setLocating(false);
                    setDestination(point);
                    setPlaceLabel(null);
                    setQuote(null);
                    setDestinationIssues([]);
                    setLocationMessage(
                      "Pin set from your coordinates. Check it, then confirm to calculate delivery.",
                    );
                  }}
                />
                <p role="status" className="label-text">
                  {locationMessage}
                </p>
                <TextField
                  id="landmark"
                  label={messages.checkout.landmark}
                  optional
                  placeholder={messages.checkout.landmarkPlaceholder}
                  value={landmark}
                  onChange={(e) => setLandmark(e.target.value)}
                  maxLength={240}
                />
                <TextAreaField
                  id="instructions"
                  label={messages.checkout.instructions}
                  optional
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  maxLength={500}
                />
                {quoteExpired ? (
                  <Notice
                    tone="warning"
                    title={messages.checkout.quoteExpired}
                  />
                ) : null}
                <ProblemNotice
                  problem={problem}
                  onRetry={() => void confirmPinAndQuote()}
                />
                <Button
                  full
                  onClick={() => void confirmPinAndQuote()}
                  busy={quoting || resolvingPlace}
                  busyLabel={
                    resolvingPlace
                      ? messages.a11y.loading
                      : messages.checkout.calculating
                  }
                >
                  <MapPin size={18} aria-hidden="true" />{" "}
                  {messages.checkout.confirmPin}
                </Button>
              </>
            ) : (
              <QuoteReview
                quote={quote}
                previousFee={previousFee}
                productsRwf={checkout.productsRwf}
                totalRwf={total}
                recipient={checkout.recipient}
                destination={checkout.destination}
                placeLabel={placeLabel}
                onChange={() => {
                  setQuote(null);
                  setPreviousFee(null);
                }}
                onAccept={() => goTo("payment")}
              />
            )}
            <Button variant="quiet" onClick={() => goTo("contact")}>
              {messages.checkout.editContact}
            </Button>
          </div>
        ) : null}

        {step === "payment" && quote ? (
          <form className={styles.form} onSubmit={pay} noValidate>
            <h1 ref={headingRef} tabIndex={-1} className="page-title">
              {messages.checkout.reviewHeading}
            </h1>
            <ErrorSummary ref={summaryRef} issues={payIssues} />
            <DeliveryAddress
              recipient={checkout.recipient}
              destination={checkout.destination}
              placeLabel={placeLabel}
            />
            <div className={styles.panel}>
              <div className={styles.row}>
                <span>{messages.checkout.products}</span>
                <Money amount={checkout.productsRwf} />
              </div>
              <div className={styles.row}>
                <span>{messages.checkout.delivery}</span>
                <Money amount={quote.amountRwf} />
              </div>
              {total !== null ? (
                <div className={`${styles.row} ${styles.totalRow}`}>
                  <span>{messages.checkout.total}</span>
                  <Money amount={total} />
                </div>
              ) : null}
              <p className="label-text muted">{quote.serviceDescription}</p>
              {quoteExpired ? (
                <Notice
                  tone="warning"
                  title={messages.checkout.quoteExpired}
                  actions={
                    <Button
                      variant="secondary"
                      busy={quoting}
                      onClick={() => void recalculate()}
                    >
                      {messages.checkout.recalculate}
                    </Button>
                  }
                />
              ) : (
                <p className="label-text muted">
                  {format(messages.checkout.quoteValidUntil, {
                    time: formatKigaliTime(quote.validUntil),
                  })}
                </p>
              )}
            </div>

            {methods === null ? (
              <p role="status" className="muted">
                {messages.a11y.loading}
              </p>
            ) : methodsUnavailable ? (
              <Notice
                tone="warning"
                title={messages.checkout.methodUnavailable}
              />
            ) : (
              <fieldset
                className={styles.methods}
                aria-describedby={
                  payIssues.some((i) => i.fieldId === "method-first")
                    ? "method-error"
                    : undefined
                }
              >
                <legend>{messages.checkout.networkLabel}</legend>
                <div className={styles.methodGrid}>
                  {methods.map((m, i) => (
                    <span key={m} className={styles.method}>
                      <input
                        id={i === 0 ? "method-first" : `method-${m}`}
                        type="radio"
                        name="method"
                        value={m}
                        checked={method === m}
                        onChange={() => setMethod(m)}
                      />
                      <label
                        htmlFor={i === 0 ? "method-first" : `method-${m}`}
                        className={styles.methodLabel}
                      >
                        {messages.methods[m]}
                      </label>
                    </span>
                  ))}
                </div>
                {payIssues.some((i) => i.fieldId === "method-first") ? (
                  <p
                    id="method-error"
                    className="label-text u-danger u-w-500 u-mt-2"
                  >
                    {messages.checkout.methodRequired}
                  </p>
                ) : null}
              </fieldset>
            )}

            <TextField
              id="payer-phone"
              label={messages.checkout.payingPhone}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+250 7XX XXX XXX"
              value={payerPhone}
              onChange={(e) => setPayerPhone(e.target.value)}
              help={messages.checkout.payingPhoneHelp}
              error={
                payIssues.find((i) => i.fieldId === "payer-phone")?.message
              }
            />
            <Notice title={messages.checkout.beforePayment} />
            {demoScenarios ? (
              <div className={`${styles.panel} ${styles.demoHint}`}>
                <p>
                  <strong>Demo payment simulator.</strong> No real money moves.
                  The last three digits of the paying number choose the
                  simulated outcome:
                </p>
                <ul>
                  {demoScenarios.map((s) => (
                    <li key={s.suffix}>
                      <span className="tabular">…{s.suffix}</span>: {s.label}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="label-text">
              By placing this order you accept the{" "}
              <Link href="/help/terms">{messages.checkout.termsLink}</Link>.
              Read the{" "}
              <Link href="/help/privacy">{messages.checkout.privacyLink}</Link>.
            </p>
            <ProblemNotice
              problem={problem}
              onRetry={() => void recalculate()}
            />
            <div className={styles.payBar}>
              <Button
                type="submit"
                full
                busy={paying}
                busyLabel={messages.checkout.starting}
                disabled={methodsUnavailable || quoteExpired || total === null}
              >
                {total !== null
                  ? format(messages.checkout.payButton, {
                      amount: formatRwf(total),
                    })
                  : messages.checkout.reviewHeading}
              </Button>
              <Button variant="quiet" onClick={() => goTo("delivery")}>
                {messages.checkout.changeLocation}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
      <CheckoutSummary cart={cart} deliveryRwf={deliveryFee} />
    </div>
  );
}

function PinPanel({
  destination,
  placeLabel,
  onNudge,
}: {
  destination: Point | null;
  placeLabel: string | null;
  onNudge: (dLat: number, dLng: number) => void;
}) {
  return (
    <div className={styles.panel}>
      <h2 className="u-body-size u-w-600">{messages.checkout.pinHeading}</h2>
      <div
        className={styles.map}
        role="img"
        aria-label={
          destination
            ? format(messages.checkout.pinCoordinates, {
                lat: destination.lat.toFixed(5),
                lng: destination.lng.toFixed(5),
              })
            : messages.checkout.pinNotSet
        }
      >
        {destination ? (
          <span className={`${styles.pin} ${styles.pinCentered}`}>
            <MapPin size={36} strokeWidth={1.75} aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <p className="label-text muted">{messages.checkout.mapPreviewNote}</p>
      {destination ? (
        <>
          <p className="label-text">
            {placeLabel ? <strong>{placeLabel} · </strong> : null}
            <span className="tabular">
              {destination.lat.toFixed(5)}, {destination.lng.toFixed(5)}
            </span>
          </p>
          <p className="label-text muted">{messages.checkout.pinHelp}</p>
          <div
            className={styles.nudge}
            role="group"
            aria-label={messages.checkout.pinHelp}
          >
            <span />
            <button
              type="button"
              onClick={() => onNudge(NUDGE_DEGREES, 0)}
              aria-label={format(messages.checkout.pinNudge, {
                direction: messages.checkout.pinNorth,
              })}
            >
              <ArrowUp size={18} aria-hidden="true" />
            </button>
            <span />
            <button
              type="button"
              onClick={() => onNudge(0, -NUDGE_DEGREES)}
              aria-label={format(messages.checkout.pinNudge, {
                direction: messages.checkout.pinWest,
              })}
            >
              <ArrowLeft size={18} aria-hidden="true" />
            </button>
            <span />
            <button
              type="button"
              onClick={() => onNudge(0, NUDGE_DEGREES)}
              aria-label={format(messages.checkout.pinNudge, {
                direction: messages.checkout.pinEast,
              })}
            >
              <ArrowRight size={18} aria-hidden="true" />
            </button>
            <span />
            <button
              type="button"
              onClick={() => onNudge(-NUDGE_DEGREES, 0)}
              aria-label={format(messages.checkout.pinNudge, {
                direction: messages.checkout.pinSouth,
              })}
            >
              <ArrowDown size={18} aria-hidden="true" />
            </button>
            <span />
          </div>
        </>
      ) : (
        <p className="label-text">{messages.checkout.pinNotSet}</p>
      )}
    </div>
  );
}

function DeliveryAddress({
  recipient,
  destination,
  placeLabel,
}: {
  recipient: Checkout["recipient"];
  destination: Point | null;
  placeLabel: string | null;
}) {
  if (!recipient || !destination) return null;
  return (
    <section
      className={styles.panel + " " + styles.destinationDetails}
      aria-label="Delivery details"
    >
      <h2 className="u-body-size u-w-600">Deliver to</h2>
      <p>
        <strong>{recipient.name}</strong> ·{" "}
        {displayRwandaPhone(recipient.phone)}
      </p>
      {placeLabel ? <p>{placeLabel}</p> : null}
      <p className="label-text">
        Confirmed pin:{" "}
        <span className="tabular">
          {destination.lat.toFixed(6)}, {destination.lng.toFixed(6)}
        </span>
      </p>
      {recipient.landmark ? <p>Landmark: {recipient.landmark}</p> : null}
      {recipient.instructions ? (
        <p>Instructions: {recipient.instructions}</p>
      ) : null}
    </section>
  );
}

function QuoteReview({
  quote,
  previousFee,
  productsRwf,
  totalRwf,
  recipient,
  destination,
  placeLabel,
  onChange,
  onAccept,
}: {
  quote: Quote;
  previousFee: number | null;
  productsRwf: number;
  totalRwf: number | null;
  recipient: Checkout["recipient"];
  destination: Point | null;
  placeLabel: string | null;
  onChange: () => void;
  onAccept: () => void;
}) {
  return (
    <div className="stack-4">
      <DeliveryAddress
        recipient={recipient}
        destination={destination}
        placeLabel={placeLabel}
      />
      {previousFee !== null ? (
        <Notice
          tone="warning"
          title={messages.checkout.quoteChanged}
          role="status"
        >
          <p>
            {format(messages.checkout.previousAmount, {
              amount: formatRwf(previousFee),
            })}
          </p>
        </Notice>
      ) : null}
      <div className={styles.panel} role="status" aria-live="polite">
        <p className="label-text muted">
          {messages.checkout.confirmedDestination}
        </p>
        <div className={styles.row}>
          <span>{messages.checkout.deliveryFee}</span>
          <strong>
            <Money amount={quote.amountRwf} />
          </strong>
        </div>
        <p className="label-text muted">{quote.serviceDescription}</p>
        <p className="label-text muted">
          {messages.checkout.deliveryWindowPending}
        </p>
        <p className="label-text muted">
          {format(messages.checkout.quoteValidUntil, {
            time: formatKigaliTime(quote.validUntil),
          })}
        </p>
        <div className={styles.row}>
          <span>{messages.checkout.products}</span>
          <Money amount={productsRwf} />
        </div>
        {totalRwf !== null ? (
          <div className={`${styles.row} ${styles.totalRow}`}>
            <span>{messages.checkout.total}</span>
            <Money amount={totalRwf} />
          </div>
        ) : null}
      </div>
      <Button full onClick={onAccept}>
        {messages.checkout.acceptFee}
      </Button>
      <Button variant="secondary" full onClick={onChange}>
        {messages.checkout.changeLocation}
      </Button>
    </div>
  );
}

function ProblemNotice({
  problem,
  onRetry,
}: {
  problem: Problem | null;
  onRetry: () => void;
}) {
  if (!problem) return null;
  switch (problem.kind) {
    case "outside":
      return (
        <Notice
          tone="warning"
          title={messages.checkout.outsideCoverageTitle}
          role="alert"
          actions={
            <ButtonLink href="/help" variant="secondary">
              {messages.checkout.contactSupport}
            </ButtonLink>
          }
        >
          <p>{messages.checkout.outsideCoverage}</p>
        </Notice>
      );
    case "route":
      return (
        <Notice
          tone="warning"
          title={messages.checkout.routeFailed}
          role="alert"
          actions={
            <>
              <Button variant="secondary" onClick={onRetry}>
                {messages.checkout.retry}
              </Button>
              <ButtonLink href="/help" variant="quiet">
                {messages.checkout.contactSupport}
              </ButtonLink>
            </>
          }
        />
      );
    case "parcel":
      return (
        <Notice
          tone="warning"
          title={problem.message}
          role="alert"
          actions={
            <ButtonLink href="/cart" variant="secondary">
              {messages.payment.returnToCart}
            </ButtonLink>
          }
        />
      );
    case "stock":
      return (
        <Notice
          tone="warning"
          title={messages.checkout.stockChanged}
          role="alert"
          actions={
            <ButtonLink href="/cart" variant="secondary">
              {messages.payment.returnToCart}
            </ButtonLink>
          }
        />
      );
    case "paused":
      return <Notice tone="warning" title={problem.message} role="alert" />;
    default:
      return <Notice tone="danger" title={problem.message} role="alert" />;
  }
}
