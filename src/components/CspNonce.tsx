"use client";

import { useEffect } from "react";
import { setNonce } from "get-nonce";

// Radix dialogs lock page scrolling by adding a small <style> element (react-remove-scroll
// through react-style-singleton, which reads its nonce from get-nonce). The production CSP
// only accepts <style> elements carrying this response's nonce (DR-039). Next.js already
// puts that nonce on its own <script> tags; browsers hide the attribute value but keep the
// `nonce` property, so it is read from there rather than sent again in the page payload.
export function CspNonce() {
  useEffect(() => {
    const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
    if (nonce) setNonce(nonce);
  }, []);
  return null;
}
