import { Notice } from "@/components/ui/Notice";
import { ActionDialog } from "@/components/staff/ActionDialog";
import { listMembers } from "@/modules/staff/members";
import { staffPageAccess } from "@/server/staff-page";
import styles from "@/components/staff/Staff.module.css";

export const dynamic = "force-dynamic";

const ROLES = [
  { value: "ADMIN", label: "Administrator" },
  { value: "OPERATIONS", label: "Operations" },
  { value: "FINANCE", label: "Finance" },
  { value: "SUPPORT", label: "Support" },
];

// A09 staff access: change a member's role or disable them. Disabling takes effect on
// their very next request. New people are added in Supabase Auth (with MFA) and then
// granted a role with `npm run staff:grant`; this screen never creates accounts.
export default async function TeamPage() {
  const access = await staffPageAccess("staff.manage");
  if (access.kind === "NONE") return null;
  if (access.kind === "FORBIDDEN") return <Notice tone="warning" title="Only an administrator can manage staff access." />;
  const state = access;
  const members = await listMembers({ limit: 50 });
  return (
    <div className={styles.stack}>
      <h1 className="page-title">Staff</h1>
      <p className="muted">
        Every person has their own account with MFA. To add someone, create their user in Supabase Auth, let them enrol MFA, then grant a role with <code>npm run staff:grant</code>.
      </p>
      <div className={styles.tableRegion} role="region" aria-label="Staff members" tabIndex={0}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              <th scope="col">Access</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {members.items.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.displayName}
                  {m.id === state.staff.staffId ? " (you)" : ""}
                </td>
                <td>{ROLES.find((r) => r.value === m.role)?.label ?? m.role}</td>
                <td>
                  <span className={`${styles.status} ${m.isActive ? styles.statusOk : styles.statusWarn}`}>{m.isActive ? "Active" : "Disabled"}</span>
                </td>
                <td>
                  <ActionDialog
                    triggerLabel="Change access"
                    triggerAriaLabel={`Change access for ${m.displayName}`}
                    title={`Change access for ${m.displayName}`}
                    summary={["Changes apply on their next request. The last active administrator cannot be removed."]}
                    endpoint={`/staff/members/${m.id}`}
                    method="PATCH"
                    staticBody={{ expectedVersion: m.version }}
                    fields={[
                      { name: "role", label: "Role", kind: "select", defaultValue: m.role, options: ROLES },
                      { name: "isActive", label: "Access", kind: "select", asBoolean: true, defaultValue: m.isActive ? "true" : "false", options: [{ value: "true", label: "Active" }, { value: "false", label: "Disabled" }] },
                      { name: "reason", label: "Reason", kind: "textarea" },
                    ]}
                    confirmLabel="Save access"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
