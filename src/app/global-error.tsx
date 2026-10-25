"use client";

import { Button } from "@/components/ui/Button";
import { messages } from "@/messages";
import { manrope } from "./fonts";
import "./globals.css";

// Last-resort error page. Next.js's built-in one is styled with inline <style> and style=""
// attributes, which the production CSP blocks (DR-039), so this replaces it with classes.
// It renders its own document because it replaces the root layout when active. The error
// itself is never shown: production sends only a digest that matches the server logs.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body>
        <title>BeautyBOX</title>
        <main id="main" className="container page u-max-712">
          <div className="stack-4">
            <h1 className="page-title">{messages.errors.generic}</h1>
            <Button onClick={() => retry()}>{messages.errors.tryAgain}</Button>
          </div>
        </main>
      </body>
    </html>
  );
}
