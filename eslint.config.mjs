import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const NO_NEXT_IMAGE_MESSAGE = "Next's image components render inline style attributes that the production CSP blocks (DR-039); use <img> with width and height.";
const NO_NEXT_IMAGE = [
  { name: "next/image", message: NO_NEXT_IMAGE_MESSAGE },
  { name: "next/legacy/image", message: NO_NEXT_IMAGE_MESSAGE },
];

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [".next/**", ".next-e2e/**", "node_modules/**", "src/generated/**", ".local/**", "playwright-report/**", "test-results/**", "next-env.d.ts"],
  },
  {
    rules: {
      // Strict style CSP (DR-039): server-rendered style="" attributes are blocked in
      // production, so styling goes through classes (globals.css utilities or CSS modules).
      "react/forbid-dom-props": ["error", { forbid: [{ propName: "style", message: "Use a class: the production CSP blocks inline style attributes (DR-039)." }] }],
      "react/forbid-component-props": ["error", { forbid: [{ propName: "style", message: "Use a class: the production CSP blocks inline style attributes (DR-039)." }] }],
      // next/image always renders an inline style attribute, so images are plain <img> with
      // explicit width/height (product photos are pre-sized WebP from the media pipeline).
      "@next/next/no-img-element": "off",
      "no-restricted-imports": ["error", { paths: NO_NEXT_IMAGE }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='alert'], CallExpression[callee.name='confirm'], CallExpression[callee.name='prompt']",
          message: "Use app-owned dialogs (UX-CONTRACT), never native alert/confirm/prompt.",
        },
      ],
    },
  },
  {
    // Domain modules must not import UI, and client code must not import server modules.
    files: ["src/modules/**/*.ts", "src/adapters/**/*.ts", "src/server/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: NO_NEXT_IMAGE, patterns: [{ group: ["@/components/*", "@/app/*"], message: "Domain/server code must not import UI." }] }],
    },
  },
];

export default config;
