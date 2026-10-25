import { CartProvider } from "@/components/cart/CartProvider";
import { DemoBanner, SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { messages } from "@/messages";
import { listCategories } from "@/modules/catalog/catalog";
import { serverEnv } from "@/server/env";

export const dynamic = "force-dynamic";

// Storefront chrome: demo notice (never in production), shop header with stocked
// categories, guest cart context and the policy footer.
export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const env = serverEnv();
  const showDemo = env.APP_ENV !== "production" || env.DEMO_CATALOG_VISIBLE;
  const categories = await listCategories().catch(() => []);
  return (
    <CartProvider>
      <a href="#main" className="skip-link">
        {messages.nav.skipToContent}
      </a>
      {showDemo ? <DemoBanner /> : null}
      <SiteHeader categories={categories} />
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </CartProvider>
  );
}
