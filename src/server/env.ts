import "server-only";
import { z } from "zod";

// Server configuration, validated once at startup. Production refuses demo adapters,
// missing secrets and anything that would let synthetic data or fake payments reach
// a real customer. Client-provided values never select an environment.

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

/**
 * PAWAPAY_BASE_URL exists only for a local imitation of pawaPay: development or tests, on this
 * machine, never a pawaPay host. So no setting outside production can reach real money (DR-042).
 */
export function isLocalImitation(
  baseUrl: string,
  appEnv: string,
  mode: string | undefined,
): boolean {
  if (appEnv !== "local" && appEnv !== "test") return false;
  if (mode === "production") return false;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (
    host === "pawapay.io" ||
    host.endsWith(".pawapay.io") ||
    host.endsWith("pawapay.cloud")
  )
    return false;
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "::1"
  );
}

/** An empty "NAME=" line in an environment file means "not set". */
const unsetIfEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const base64Key = z
  .string()
  .refine(
    (v) => Buffer.from(v, "base64").length === 32,
    "must be 32 random bytes, base64 encoded",
  );

const schema = z
  .object({
    APP_ENV: z.enum(["local", "test", "staging", "production"]),
    APP_ORIGIN: z.url(),
    DATABASE_URL: z.string().min(1),
    DATA_ENCRYPTION_KEY: base64Key,
    TOKEN_HASH_SECRET: z.string().min(32),
    WORKER_SECRET: z.string().min(32),
    PAYMENT_PROVIDER: z.enum(["fake", "pawapay"]),
    ROUTING_PROVIDER: z.enum(["fake", "google"]),
    SMS_PROVIDER: z.enum(["disabled", "fake", "africastalking"]),
    // Order e-mail (DR-057, DR-059): the launch channel for confirmations and private links.
    EMAIL_PROVIDER: z.enum(["disabled", "fake", "resend"]).default("disabled"),
    RESEND_API_KEY: unsetIfEmpty(z.string().min(10)),
    EMAIL_FROM: z
      .string()
      .regex(
        /^([^<>\r\n]{1,78} <[^\s@<>]+@[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+)$/,
        "an address, or a name and <address>",
      )
      .default("BeautyBOX <orders@beautyboxmarket.com>"),
    EMAIL_REPLY_TO: unsetIfEmpty(z.email()),
    AFRICASTALKING_SEND_ENABLED: bool,
    AFRICASTALKING_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
    AFRICASTALKING_USERNAME: unsetIfEmpty(z.string().min(1).max(100)),
    AFRICASTALKING_API_KEY: unsetIfEmpty(z.string().min(1)),
    AFRICASTALKING_SENDER_ID: unsetIfEmpty(
      z.string().regex(/^[A-Za-z0-9]{1,11}$/),
    ),
    DEMO_CATALOG_VISIBLE: bool,
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    // TLS to the database: "off" only on this machine; "verify" checks the server certificate
    // against DATABASE_SSL_CA (the Supabase project's CA, one line with literal \n).
    DATABASE_SSL: z.enum(["off", "require", "verify"]).default("off"),
    DATABASE_SSL_CA: unsetIfEmpty(z.string()),
    // pawaPay (I07, DR-042): required only when PAYMENT_PROVIDER=pawapay. The mode picks the
    // API address; production moves real money and is accepted only with APP_ENV=production.
    PAWAPAY_MODE: unsetIfEmpty(z.enum(["sandbox", "production"])),
    PAWAPAY_API_TOKEN: unsetIfEmpty(z.string()),
    // Request signing, needed once "Only accept signed requests" is on in the pawaPay dashboard.
    PAWAPAY_SIGNING_PRIVATE_KEY: unsetIfEmpty(z.string()),
    PAWAPAY_SIGNING_KEY_ID: unsetIfEmpty(z.string()),
    // A custom API address, only for a local imitation of pawaPay in development and tests.
    PAWAPAY_BASE_URL: unsetIfEmpty(z.url()),
    // Google routing (I12): required only when ROUTING_PROVIDER=google
    GOOGLE_ROUTES_API_KEY: unsetIfEmpty(z.string()),
    GOOGLE_PLACES_API_KEY: unsetIfEmpty(z.string()),
    NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY: unsetIfEmpty(z.string()),
    GOOGLE_TWO_WHEELER_COVERAGE_APPROVED: bool.default(false),
    // Staff identity (I08): Supabase Auth with TOTP MFA; "test" exists only for automated tests.
    STAFF_AUTH_PROVIDER: z
      .enum(["disabled", "supabase", "test"])
      .default("disabled"),
    NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
    SUPABASE_SECRET_KEY: z.string().optional(),
    // Product photos and private evidence: local files for development, Supabase Storage
    // otherwise (DR-041). Bucket names default to the ones created in the dev project.
    MEDIA_STORAGE: z.enum(["local", "supabase"]).default("local"),
    // Optional public base for product photos, e.g. a CDN in front of the public bucket.
    NEXT_PUBLIC_MEDIA_BASE_URL: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.url().optional(),
    ),
    SUPABASE_PRIVATE_MEDIA_BUCKET: z
      .string()
      .regex(/^[a-z0-9-]{3,63}$/)
      .default("private-media"),
    SUPABASE_PUBLIC_MEDIA_BUCKET: z
      .string()
      .regex(/^[a-z0-9-]{3,63}$/)
      .default("product-photos"),
    // Pre-launch access wall (DR-044): visitors without the access code see "Launching soon".
    SITE_GATE: z.enum(["off", "on"]).default("off"),
    // scrypt verifier of the access code (scripts/ops/site-access-code.ts); never the code itself.
    SITE_ACCESS_CODE_HASH: unsetIfEmpty(
      z
        .string()
        .regex(
          /^scrypt:\d+:\d+:\d+:[A-Za-z0-9_-]{16,}:[A-Za-z0-9_-]{32,}$/,
          "must be the output of scripts/ops/site-access-code.ts",
        ),
    ),
    // Hosts that only ever show "Launching soon" (e.g. the main domain before launch).
    HOLDING_HOSTS: unsetIfEmpty(
      z
        .string()
        .regex(
          /^[a-z0-9-]+(\.[a-z0-9-]+)*(,[a-z0-9-]+(\.[a-z0-9-]+)*)*$/,
          "comma-separated lower-case host names",
        ),
    ),
    // Launch e-mail list (DR-045): closed until the founder opens it; the privacy contact is required then.
    LAUNCH_LIST: z.enum(["closed", "open"]).default("closed"),
    LAUNCH_LIST_CONTACT_EMAIL: unsetIfEmpty(z.email()),
  })
  .superRefine((env, ctx) => {
    const problem = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (env.PAYMENT_PROVIDER === "pawapay") {
      if (!env.PAWAPAY_API_TOKEN)
        problem("PAWAPAY_API_TOKEN", "required when PAYMENT_PROVIDER=pawapay");
      if (!env.PAWAPAY_MODE && !env.PAWAPAY_BASE_URL)
        problem(
          "PAWAPAY_MODE",
          "set PAWAPAY_MODE=sandbox or PAWAPAY_MODE=production",
        );
      // A development or staging machine must never be able to collect real money.
      if (env.PAWAPAY_MODE === "production" && env.APP_ENV !== "production") {
        problem(
          "PAWAPAY_MODE",
          "production pawaPay moves real money and is only allowed with APP_ENV=production; use a sandbox account here",
        );
      }
      if (env.APP_ENV === "production" && env.PAWAPAY_MODE !== "production")
        problem("PAWAPAY_MODE", "production needs PAWAPAY_MODE=production");
      if (
        env.PAWAPAY_BASE_URL &&
        !isLocalImitation(env.PAWAPAY_BASE_URL, env.APP_ENV, env.PAWAPAY_MODE)
      ) {
        problem(
          "PAWAPAY_BASE_URL",
          "a custom pawaPay address is only for a local imitation on this machine (localhost) in development and tests",
        );
      }
    }
    if (
      Boolean(env.PAWAPAY_SIGNING_PRIVATE_KEY) !==
      Boolean(env.PAWAPAY_SIGNING_KEY_ID)
    ) {
      problem(
        "PAWAPAY_SIGNING_KEY_ID",
        "set both PAWAPAY_SIGNING_PRIVATE_KEY and PAWAPAY_SIGNING_KEY_ID, or neither",
      );
    }
    if (env.ROUTING_PROVIDER === "google" && !env.GOOGLE_ROUTES_API_KEY) {
      problem("GOOGLE_ROUTES_API_KEY", "required when ROUTING_PROVIDER=google");
    }
    if (
      env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY &&
      env.GOOGLE_ROUTES_API_KEY &&
      env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY === env.GOOGLE_ROUTES_API_KEY
    ) {
      problem(
        "NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY",
        "use a separate browser-restricted Embed key, not the server Routes key",
      );
    }
    if (env.STAFF_AUTH_PROVIDER === "test" && env.APP_ENV !== "test") {
      problem(
        "STAFF_AUTH_PROVIDER",
        "the test identity provider is only allowed when APP_ENV=test",
      );
    }
    if (
      env.MEDIA_STORAGE === "supabase" &&
      (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY)
    ) {
      problem(
        "MEDIA_STORAGE",
        "Supabase URL and SUPABASE_SECRET_KEY are required when MEDIA_STORAGE=supabase",
      );
    }
    if (env.NEXT_PUBLIC_MEDIA_BASE_URL && env.MEDIA_STORAGE !== "supabase") {
      problem(
        "NEXT_PUBLIC_MEDIA_BASE_URL",
        "a public media base is only used with MEDIA_STORAGE=supabase; local photos are served by the app",
      );
    }
    if (
      env.SUPABASE_PRIVATE_MEDIA_BUCKET === env.SUPABASE_PUBLIC_MEDIA_BUCKET
    ) {
      problem(
        "SUPABASE_PUBLIC_MEDIA_BUCKET",
        "the public and private media buckets must be different",
      );
    }
    if (
      env.STAFF_AUTH_PROVIDER === "supabase" &&
      (!env.NEXT_PUBLIC_SUPABASE_URL ||
        !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    ) {
      problem(
        "NEXT_PUBLIC_SUPABASE_URL",
        "Supabase URL and publishable key are required when STAFF_AUTH_PROVIDER=supabase",
      );
    }
    if (env.DATABASE_SSL === "verify" && !env.DATABASE_SSL_CA)
      problem("DATABASE_SSL_CA", "required when DATABASE_SSL=verify");
    if (env.DATABASE_SSL !== "off" && /[?&]sslmode=/i.test(env.DATABASE_URL)) {
      problem(
        "DATABASE_URL",
        "remove sslmode from the URL; DATABASE_SSL controls TLS (a URL setting would override it)",
      );
    }
    if (
      (env.APP_ENV === "staging" || env.APP_ENV === "production") &&
      env.DATABASE_SSL === "off"
    ) {
      problem(
        "DATABASE_SSL",
        "a hosted database must be reached over TLS: set DATABASE_SSL=verify with DATABASE_SSL_CA",
      );
    }
    if (env.APP_ENV === "production" && env.DATABASE_SSL !== "verify")
      problem(
        "DATABASE_SSL",
        "production must verify the database certificate (DATABASE_SSL=verify)",
      );
    if (env.SITE_GATE === "on" && !env.SITE_ACCESS_CODE_HASH)
      problem("SITE_ACCESS_CODE_HASH", "required when SITE_GATE=on");
    if (env.HOLDING_HOSTS) {
      const appHost = new URL(env.APP_ORIGIN).hostname;
      if (env.HOLDING_HOSTS.split(",").includes(appHost))
        problem(
          "HOLDING_HOSTS",
          "must not include the APP_ORIGIN host, which serves the shop",
        );
    }
    if (env.LAUNCH_LIST === "open" && !env.LAUNCH_LIST_CONTACT_EMAIL) {
      problem(
        "LAUNCH_LIST_CONTACT_EMAIL",
        "required when LAUNCH_LIST=open: people on the list must be able to reach you to be removed",
      );
    }
    // Implemented adapters only: an unbuilt provider would take down payments and photos too.

    if (env.EMAIL_PROVIDER === "resend" && !env.RESEND_API_KEY)
      problem("RESEND_API_KEY", "required when EMAIL_PROVIDER=resend");
    if (env.AFRICASTALKING_MODE === "live" && env.APP_ENV !== "production")
      problem("AFRICASTALKING_MODE", "live mode requires APP_ENV=production");
    if (env.AFRICASTALKING_SEND_ENABLED) {
      if (env.SMS_PROVIDER !== "africastalking")
        problem(
          "SMS_PROVIDER",
          "select africastalking before enabling its send switch",
        );
      for (const name of [
        "AFRICASTALKING_USERNAME",
        "AFRICASTALKING_API_KEY",
        "AFRICASTALKING_SENDER_ID",
      ] as const)
        if (!env[name]) problem(name, "required when SMS sending is enabled");
      if (
        env.AFRICASTALKING_MODE === "sandbox" &&
        env.AFRICASTALKING_USERNAME !== "sandbox"
      )
        problem(
          "AFRICASTALKING_USERNAME",
          "sandbox mode requires the sandbox username",
        );
      if (
        env.AFRICASTALKING_MODE === "live" &&
        env.AFRICASTALKING_USERNAME === "sandbox"
      )
        problem(
          "AFRICASTALKING_USERNAME",
          "live mode requires an approved live account",
        );
      if (env.APP_ENV === "production" && env.AFRICASTALKING_MODE !== "live")
        problem("AFRICASTALKING_MODE", "production sending requires live mode");
    }
    if (env.APP_ENV === "staging") {
      // Staging runs on serverless hosting: no writable local disk, and no simulator schema.
      if (env.MEDIA_STORAGE === "local")
        problem(
          "MEDIA_STORAGE",
          "staging needs MEDIA_STORAGE=supabase (serverless hosting has no writable disk)",
        );
      if (env.PAYMENT_PROVIDER === "fake")
        problem(
          "PAYMENT_PROVIDER",
          "staging uses the pawaPay sandbox (the payment simulator's tables exist only locally)",
        );
      if (env.SMS_PROVIDER === "fake")
        problem(
          "SMS_PROVIDER",
          "staging uses SMS_PROVIDER=disabled until a real SMS provider exists (the simulator's tables exist only locally)",
        );
      if (env.EMAIL_PROVIDER === "fake")
        problem(
          "EMAIL_PROVIDER",
          "staging uses EMAIL_PROVIDER=resend or disabled (the simulated mailbox exists only locally)",
        );
    }
    if (env.APP_ENV === "production") {
      if (env.PAYMENT_PROVIDER === "fake")
        problem(
          "PAYMENT_PROVIDER",
          "fake payments are forbidden in production",
        );
      if (env.ROUTING_PROVIDER === "fake")
        problem("ROUTING_PROVIDER", "fake routing is forbidden in production");
      if (env.SMS_PROVIDER === "fake")
        problem("SMS_PROVIDER", "fake SMS is forbidden in production");
      if (env.EMAIL_PROVIDER === "fake")
        problem("EMAIL_PROVIDER", "fake e-mail is forbidden in production");
      if (env.DEMO_CATALOG_VISIBLE)
        problem(
          "DEMO_CATALOG_VISIBLE",
          "demo catalog cannot be visible in production",
        );
      if (!env.APP_ORIGIN.startsWith("https://"))
        problem("APP_ORIGIN", "production origin must be https");
      if (env.MEDIA_STORAGE === "local")
        problem(
          "MEDIA_STORAGE",
          "local file media storage is for development only",
        );
      if (
        env.NEXT_PUBLIC_MEDIA_BASE_URL &&
        !env.NEXT_PUBLIC_MEDIA_BASE_URL.startsWith("https://")
      )
        problem(
          "NEXT_PUBLIC_MEDIA_BASE_URL",
          "production media base must be https",
        );
    }
  });

export type ServerEnv = z.infer<typeof schema>;

function isServiceRoleJwt(value: string): boolean {
  const payload = value.split(".")[1];
  if (!payload || !value.startsWith("eyJ")) return false;
  try {
    return (
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))?.role ===
      "service_role"
    );
  } catch {
    return false;
  }
}

/**
 * Names of NEXT_PUBLIC_ variables that hold a secret. Next.js builds NEXT_PUBLIC_ values
 * into browser code wherever they are referenced, so a secret must never carry that prefix.
 * Returns names only, never values.
 */
export function publicSecretProblems(
  env: Record<string, string | undefined>,
): string[] {
  return Object.entries(env)
    .filter(([name, value]) => {
      if (!name.startsWith("NEXT_PUBLIC_")) return false;
      if (
        /SECRET|PASSWORD|PRIVATE|SERVICE_ROLE|API_TOKEN|AFRICASTALKING_API_KEY/i.test(
          name,
        )
      )
        return true;
      return (
        typeof value === "string" &&
        (value.startsWith("sb_secret_") || isServiceRoleJwt(value))
      );
    })
    .map(
      ([name]) =>
        `${name}: secrets must not use the NEXT_PUBLIC_ prefix, which sends them to browsers`,
    );
}

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  const exposed = publicSecretProblems(process.env);
  if (!parsed.success || exposed.length > 0) {
    // Never echo values: only names and rule descriptions.
    const issues = [
      ...(parsed.success
        ? []
        : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)),
      ...exposed,
    ].join("; ");
    throw new Error(`Invalid server configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test hook: forget cached configuration after tests change process.env. */
export function resetServerEnvForTests() {
  cached = undefined;
}

export const isProduction = () => serverEnv().APP_ENV === "production";
