"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Mail, Shield, UserMinus, UserPlus } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Select, cx } from "@/components/ui";
import type { PendingInvitation, StaffMember } from "@/lib/services/staff";
import { inviteStaffAction, removeMemberAction, revokeInvitationAction, updateMemberRoleAction } from "@/lib/actions/tenant";
import { formatDay, initials } from "@/lib/format";
import { initialActionState } from "@/lib/actions/types";

const ROLE_TONE: Record<string, "clay" | "blue" | "amber" | "neutral"> = {
  owner: "clay",
  manager: "blue",
  kitchen: "amber",
  waiter: "neutral",
};

export function StaffManager({
  restaurantId,
  members,
  invitations,
}: {
  restaurantId: string;
  members: StaffMember[];
  invitations: PendingInvitation[];
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);
  const [inviteState, setInviteState] = React.useState<{ status: string; message?: string; errors?: Record<string, string> }>({
    status: "idle",
  });
  const [inviting, setInviting] = React.useState(false);

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setInviting(true);
    const result = await inviteStaffAction(initialActionState, new FormData(form));
    setInviting(false);
    setInviteState(result);
    if (result.status === "success") {
      form.reset();
      router.refresh();
    }
  }

  async function changeRole(member: StaffMember, role: string) {
    setPending(member.id);
    const result = await updateMemberRoleAction(restaurantId, member.id, role);
    setPending(null);
    setInviteState(result);
    if (result.status === "success") router.refresh();
  }

  async function remove(member: StaffMember) {
    if (!window.confirm(`Remove ${member.full_name ?? member.email} from ${"this restaurant"}? They lose access immediately.`)) return;
    setPending(member.id);
    const result = await removeMemberAction(restaurantId, member.id);
    setPending(null);
    setInviteState(result);
    if (result.status === "success") router.refresh();
  }

  async function revoke(invite: PendingInvitation) {
    setPending(invite.id);
    const result = await revokeInvitationAction(restaurantId, invite.id);
    setPending(null);
    setInviteState(result);
    if (result.status === "success") router.refresh();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <Card>
        <CardHeader title="Team" description="Only owners can change roles or remove access." />
        <CardBody className="pt-0">
          <ul className="divide-y divide-ink-100">
            {members.map((member) => (
              <li key={member.id} className="flex items-center gap-3 py-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink-100 text-[12px] font-semibold text-ink-600">
                  {initials(member.full_name ?? member.email)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-[13px] font-medium text-ink-900">{member.full_name ?? member.email}</p>
                    {!member.is_active ? <Badge tone="neutral">Inactive</Badge> : null}
                  </div>
                  <p className="truncate text-[11.5px] text-ink-400">
                    {member.email} · joined {formatDay(member.created_at)}
                    {member.order_actions > 0 ? ` · ${member.order_actions} order actions` : ""}
                  </p>
                </div>
                {member.role === "owner" ? (
                  <Badge tone="clay"><Shield className="size-2.5" aria-hidden /> Owner</Badge>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Select
                      value={member.role}
                      onChange={(event) => void changeRole(member, event.target.value)}
                      disabled={pending === member.id}
                      aria-label={`Role for ${member.full_name ?? member.email}`}
                      className="h-7 w-24 text-[11.5px]"
                    >
                      <option value="manager">Manager</option>
                      <option value="kitchen">Kitchen</option>
                      <option value="waiter">Waiter</option>
                    </Select>
                    <button
                      type="button"
                      onClick={() => void remove(member)}
                      disabled={pending === member.id}
                      className="grid size-7 place-items-center rounded-md text-ink-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                      aria-label={`Remove ${member.full_name ?? member.email}`}
                    >
                      <UserMinus className="size-3.5" aria-hidden />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <div className="space-y-3">
        <Card>
          <CardHeader title="Invite someone" description="They join automatically when they register with this email." />
          <CardBody className="pt-0">
            <form onSubmit={invite} className="space-y-3" noValidate>
              <input type="hidden" name="restaurant_id" value={restaurantId} />
              <Field label="Work email" htmlFor="invite-email" required error={inviteState.errors?.email}>
                <Input id="invite-email" name="email" type="email" required placeholder="name@restaurant.com" />
              </Field>
              <Field label="Role" htmlFor="invite-role" required>
                <Select id="invite-role" name="role" defaultValue="kitchen">
                  <option value="manager">Manager — full operations</option>
                  <option value="kitchen">Kitchen — display only</option>
                  <option value="waiter">Waiter — serve orders</option>
                </Select>
              </Field>
              {inviteState.status !== "idle" && inviteState.message ? (
                <p
                  className={cx(
                    "rounded-md px-2.5 py-2 text-[12px] ring-1 ring-inset",
                    inviteState.status === "success" ? "bg-moss-50 text-moss-700 ring-moss-100" : "bg-red-50 text-red-700 ring-red-200",
                  )}
                  role={inviteState.status === "error" ? "alert" : "status"}
                >
                  {inviteState.message}
                </p>
              ) : null}
              <Button type="submit" size="sm" loading={inviting}>
                <UserPlus className="size-3.5" aria-hidden /> Send invitation
              </Button>
            </form>

            {invitations.length > 0 ? (
              <div className="mt-3 border-t border-ink-100 pt-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Pending</p>
                <ul className="mt-1.5 space-y-1.5">
                  {invitations.map((invite) => (
                    <li key={invite.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] text-ink-700">{invite.email}</p>
                        <p className="text-[10.5px] text-ink-400">expires {formatDay(invite.expires_at)}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge tone={ROLE_TONE[invite.role] ?? "neutral"}>{invite.role}</Badge>
                        <button
                          type="button"
                          onClick={() => void revoke(invite)}
                          disabled={pending === invite.id}
                          className="text-[11px] font-medium text-red-600 hover:underline disabled:opacity-40"
                        >
                          Revoke
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card className="bg-ink-50/60">
          <CardBody className="flex gap-2.5">
            <Mail className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
            <p className="text-[11.5px] leading-relaxed text-ink-500">
              Invitations are tied to the email address, not a shared link, so forwarding one does not grant access to
              someone else. Delivery uses your configured mail provider; in a self-hosted install the invitation is
              recorded here and claimed at registration.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
