import { redirect } from "next/navigation";
import { getAccountSession } from "@/lib/shop/account";
import { AuthShell } from "../account-shell";
import { SignUpForm } from "../auth-forms";
import { signUp } from "../actions";

export const metadata = { title: "Create account" };
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  const session = await getAccountSession();
  if (session) redirect("/account");

  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/account";

  return (
    <AuthShell
      title="Create account"
      description="Keep your order history in one place and skip re-typing your details at checkout."
    >
      <SignUpForm action={signUp} next={target} />
    </AuthShell>
  );
}
