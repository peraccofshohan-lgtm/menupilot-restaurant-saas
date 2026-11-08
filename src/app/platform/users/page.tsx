import { Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/server";
import { getPlatformUsers } from "@/lib/services/platform";
import { formatDay, initials } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users" };

export default async function PlatformUsersPage() {
  const user = await requireUser("/platform/users");
  const users = await getPlatformUsers(user);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Users"
        description="Accounts and their restaurant memberships. Passwords and session tokens are never exposed here."
      />
      <Card>
        <CardHeader title={`${users.length} accounts`} description="Showing the 200 most recent registrations." />
        <CardBody className="p-0">
          <ul className="divide-y divide-ink-100">
            {users.map((account) => (
              <li key={account.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink-100 text-[11px] font-semibold text-ink-600">
                  {initials(account.full_name ?? account.email)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-[12.5px] font-medium text-ink-900">{account.full_name ?? account.email}</p>
                    {account.is_admin ? <Badge tone="clay">platform admin</Badge> : null}
                  </div>
                  <p className="truncate text-[11px] text-ink-400">
                    {account.email} · joined {formatDay(account.created_at)}
                    {account.last_sign_in_at ? ` · last seen ${formatDay(account.last_sign_in_at)}` : ""}
                  </p>
                </div>
                <p className="shrink-0 text-right text-[11px] text-ink-500">{account.restaurants ?? "no workspace"}</p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
