import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui";
import { StaffManager } from "@/components/dashboard/staff-manager";
import { requireTenant } from "@/lib/auth/server";
import { getStaff } from "@/lib/services/staff";
import { formatDay, initials } from "@/lib/format";
import { Shield, UserPlus, Users } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff" };

const ROLE_TONE: Record<string, "clay" | "blue" | "amber" | "neutral"> = {
  owner: "clay",
  manager: "blue",
  kitchen: "amber",
  waiter: "neutral",
};

export default async function StaffPage() {
  const tenant = await requireTenant(["owner"]);

  let data;
  try {
    data = await getStaff(tenant.user, tenant.restaurantId);
  } catch (error) {
    console.error("[staff] load failed", error);
    return (
      <div className="space-y-4">
        <PageHeader title="Staff" />
        <Alert tone="error" title="Team could not be loaded">Refresh the page to try again.</Alert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Staff & permissions"
        description="Roles are enforced in the database on every request, not just hidden in this screen."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Team members" value={data.members.length} hint="With workspace access" icon={<Users className="size-4" aria-hidden />} />
        <Stat label="Owners" value={data.members.filter((m) => m.role === "owner").length} hint="Full control" icon={<Shield className="size-4" aria-hidden />} tone="clay" />
        <Stat label="Kitchen" value={data.members.filter((m) => m.role === "kitchen").length} hint="Display only" icon={<Users className="size-4" aria-hidden />} tone="amber" />
        <Stat label="Pending invites" value={data.invitations.length} hint="Not yet accepted" icon={<UserPlus className="size-4" aria-hidden />} tone="blue" />
      </div>

      <StaffManager restaurantId={tenant.restaurantId} members={data.members} invitations={data.invitations} />

      <Card>
        <CardHeader title="What each role can do" description="Server-side authorization follows this table exactly." />
        <CardBody className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-ink-200 text-[11px] uppercase tracking-wider text-ink-500">
                  <th className="py-2 font-semibold">Capability</th>
                  <th className="py-2 text-center font-semibold">Owner</th>
                  <th className="py-2 text-center font-semibold">Manager</th>
                  <th className="py-2 text-center font-semibold">Kitchen</th>
                  <th className="py-2 text-center font-semibold">Waiter</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {[
                  ["Approve / reject orders", true, true, false, false],
                  ["Kitchen display", true, true, true, true],
                  ["Mark preparing / ready", true, true, true, false],
                  ["Mark served", true, true, true, true],
                  ["Manage menu & tables", true, true, false, false],
                  ["Analytics", true, true, false, false],
                  ["Settings", true, true, false, false],
                  ["Staff & roles", true, false, false, false],
                ].map(([capability, ...flags]) => (
                  <tr key={capability as string}>
                    <td className="py-2 text-ink-700">{capability as string}</td>
                    {(flags as boolean[]).map((flag, index) => (
                      <td key={index} className="py-2 text-center">
                        {flag ? (
                          <span className="text-moss-600" aria-label="allowed">✓</span>
                        ) : (
                          <span className="text-ink-300" aria-label="not allowed">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {data.invitations.length > 0 ? (
        <Card>
          <CardHeader title="Awaiting acceptance" description="The invitation is claimed automatically when they register with that email." />
          <CardBody className="pt-0">
            <ul className="divide-y divide-ink-100">
              {data.invitations.map((invite) => (
                <li key={invite.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-[12.5px] font-medium text-ink-800">{invite.email}</p>
                    <p className="text-[11px] text-ink-400">
                      Invited {formatDay(invite.created_at)} · expires {formatDay(invite.expires_at)}
                    </p>
                  </div>
                  <Badge tone={ROLE_TONE[invite.role] ?? "neutral"}>{invite.role}</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {data.members.length === 1 ? (
        <Card>
          <EmptyState
            icon={<UserPlus className="size-4" aria-hidden />}
            title="It is just you so far"
            description="Invite the staff who take orders or work the pass. Invitations are free until the moment you are ready to add them."
          />
        </Card>
      ) : null}

      <p className="text-[11.5px] leading-relaxed text-ink-400">
        Members appear with {initials(tenant.user.fullName ?? tenant.user.email)} avatars generated from their name.
        Removing access immediately revokes their session for this restaurant.
      </p>
    </div>
  );
}
