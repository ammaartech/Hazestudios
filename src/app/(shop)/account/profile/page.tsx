import { requireAccount } from "@/lib/shop/account";
import { AccountShell } from "../account-shell";
import { ProfileForm } from "../auth-forms";
import { ConfirmEmailNotice } from "../order-parts";
import { updateProfile } from "../actions";

export const metadata = { title: "Your details" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await requireAccount("/account/profile");

  if (!session.customer) {
    return (
      <AccountShell title="Your details" current="/account/profile">
        <ConfirmEmailNotice email={session.email} />
      </AccountShell>
    );
  }

  const { customer } = session;

  return (
    <AccountShell
      title="Your details"
      description="Used to reach you about orders."
      current="/account/profile"
    >
      <div className="space-y-6">
        <div className="glass glass-on-light glass-panel p-5">
          <p className="meta text-(--shop-mute)">Email</p>
          <p className="mt-1.5 text-[15px] text-(--shop-ink)">{session.email}</p>
          {/* Changing the sign-in address re-runs verification, so it is
              handled through support rather than inline here. */}
          <p className="mt-2 text-sm text-(--shop-mute)">
            This is your sign-in address. Contact us if you need it changed.
          </p>
        </div>

        <div className="glass glass-on-light glass-panel p-5">
          <ProfileForm
            action={updateProfile}
            customer={{
              first_name: customer.first_name,
              last_name: customer.last_name,
              phone: customer.phone,
              accepts_marketing: customer.accepts_marketing,
            }}
          />
        </div>
      </div>
    </AccountShell>
  );
}
