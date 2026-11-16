"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import type { Point } from "@/lib/types";
import { manualPoint, mapEmbedUrl } from "@/lib/location-preview";
import styles from "./checkout.module.css";

export function ManualLocation({ onPick }: { onPick: (point: Point) => void }) {
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [error, setError] = useState(false);
  return (
    <details className={styles.manualLocation}>
      <summary>Enter a location manually</summary>
      <div className="stack-4">
        <p className="label-text">
          Paste coordinates from your map or delivery contact. This also works
          without location permission or place search.
        </p>
        <TextField
          id="manual-latitude"
          label="Latitude"
          inputMode="decimal"
          maxLength={32}
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          help="Use decimal degrees, for example -1.968846."
        />
        <TextField
          id="manual-longitude"
          label="Longitude"
          inputMode="decimal"
          maxLength={32}
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          help="For example 30.102513."
        />
        {error ? (
          <p role="alert" className="label-text u-danger">
            Enter a latitude from -90 to 90 and a longitude from -180 to 180.
          </p>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => {
            const point = manualPoint(lat, lng);
            setError(!point);
            if (point) onPick(point);
          }}
        >
          Use these coordinates
        </Button>
        <p className="label-text muted">
          You will still confirm the pin and review the delivery fee before
          paying.
        </p>
      </div>
    </details>
  );
}

export function StreetMapPreview({
  point,
  browserKey,
}: {
  point: Point | null;
  browserKey?: string;
}) {
  const [shown, setShown] = useState(false);
  const url = mapEmbedUrl(point, browserKey);
  if (!url) return null;
  return (
    <div className="stack-3">
      <Button
        variant="secondary"
        onClick={() => setShown((value) => !value)}
        aria-expanded={shown}
        aria-controls="street-map-preview"
      >
        {shown ? "Hide street map" : "Show street map"}
      </Button>
      <div id="street-map-preview" className="stack-2" hidden={!shown}>
        {shown ? (
          <>
            <iframe
              className={styles.streetMap}
              src={url}
              title="Delivery location on Google Maps"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
            <p className="label-text muted">
              Moving this preview does not move your delivery pin. Use the pin
              controls to adjust the delivery location.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
