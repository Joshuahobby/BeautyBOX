import { z } from "zod";
// Zod's normal compiler probes Function(), which strict CSP reports even when
// caught. Configure the browser runtime before any shared form schemas are built.
if (typeof window !== "undefined") z.config({ jitless: true });
export { z };
