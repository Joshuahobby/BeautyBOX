import { Notice } from "@/components/ui/Notice";
import { getSettings } from "@/modules/settings/admin";
import { can } from "@/modules/staff/capabilities";
import { staffPageAccess } from "@/server/staff-page";
import { SettingsEditor } from "./SettingsEditor";
import styles from "@/components/staff/Staff.module.css";

export const dynamic = "force-dynamic";

const BLOCK_TEXT: Record<string, string> = {
  CHECKOUT_DISABLED: "Checkout is paused.",
  TARIFF_NOT_APPROVED: "Delivery tariff is not approved.",
  ORIGIN_NOT_APPROVED: "Dispatch pin is not approved.",
  ORIGIN_INACTIVE: "Dispatch location is inactive.",
  SETTINGS_NOT_VERIFIED: "Operating settings are demo values.",
  POLICIES_NOT_APPROVED: "Delivery, returns, terms and privacy policies are not approved.",
  SUPPORT_CONTACT_MISSING: "Support contact is not set.",
  DELIVERY_PROMISE_MISSING: "Delivery window promise is not set.",
  LIVE_PAYMENTS_DISABLED: "Live payments are off.",
  PAYMENT_ADAPTER_NOT_LIVE: "Payments use the simulator, not pawaPay (deployment setting).",
  ROUTING_ADAPTER_NOT_LIVE: "Delivery distances use the simulator, not live routing (deployment setting).",
  CUSTOMER_MESSAGES_DISABLED: "Order receipts are paused. Turn on Customer messages in Staff settings.",
  EMAIL_ADAPTER_NOT_LIVE: "Order e-mails are not sent: set EMAIL_PROVIDER=resend with a key (deployment setting).",
};

// A07 settings: dispatch pin, delivery area, tariff, hours, parcel limits, quote expiry,
// checkout pause. Every save is a new version with a reason; placed orders never change.
export default async function SettingsPage() {
  const access = await staffPageAccess("settings.read");
  if (access.kind === "NONE") return null;
  if (access.kind === "FORBIDDEN") return <Notice tone="warning" title="Your role does not include settings." />;
  const state = access;
  const settings = await getSettings(state.staff);
  return (
    <div className={styles.stack}>
      <h1 className="page-title">Settings</h1>
      <p className="muted">Version {settings.version}. Saving creates a new version. Open checkouts must recalculate their delivery fee; placed orders keep theirs.</p>
      {settings.publicationBlocks.length > 0 ? (
        <Notice tone="warning" title="Public paid checkout stays closed until these are resolved">
          <ul className="u-m-0 u-indent">
            {settings.publicationBlocks.map((b) => (
              <li key={b}>{BLOCK_TEXT[b] ?? b}</li>
            ))}
          </ul>
        </Notice>
      ) : (
        <Notice tone="success" title="No release blocks recorded." />
      )}
      <SettingsEditor settings={settings} canEdit={can(state.staff.role, "settings.write")} />
    </div>
  );
}
