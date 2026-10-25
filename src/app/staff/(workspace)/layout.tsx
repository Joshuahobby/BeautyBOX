import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StaffShell } from "@/components/staff/StaffShell";
import { SignOutButton } from "@/components/staff/StaffClient";
import { capabilitiesOf } from "@/modules/staff/capabilities";
import { currentStaffState } from "@/server/staff-page";
import styles from "@/components/staff/Staff.module.css";

export const metadata: Metadata = { title: "Staff", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Every staff page re-checks identity, MFA and active membership on each request; the
// API routes check again for every action (UI hiding is a convenience, never security).
export default async function StaffWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const state = await currentStaffState();
  if (state.kind === "SIGNED_OUT") redirect("/staff/sign-in");
  if (state.kind === "MFA_REQUIRED") redirect("/staff/mfa");
  if (state.kind === "NOT_STAFF" || state.kind === "DISABLED") {
    return (
      <main className={styles.authPage}>
        <div className={styles.authCard}>
          <h1 className="page-title">No staff access</h1>
          <p>This account does not have active access to the BeautyBOX staff workspace. Ask the administrator if you need access.</p>
          <SignOutButton />
        </div>
      </main>
    );
  }
  return (
    <StaffShell staff={state.staff} capabilities={capabilitiesOf(state.staff.role)}>
      {children}
    </StaffShell>
  );
}
