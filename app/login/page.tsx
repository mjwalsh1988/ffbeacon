import type { Metadata } from "next";
import { PageBody } from "@/components/app-shell/page-body";
import { PageMasthead } from "@/components/app-shell/page-masthead";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in or create an FF Beacon account to vote, save your Sleeper username, and follow players.",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; next?: string }>;
}) {
  return (
    <main id="main">
      <PageBody width="reading">
        <PageMasthead eyebrow="Account" title="Sign in or register" />
        {/* The form card stays at its intended narrower width inside the
            reading column. */}
        <div className="mx-auto mt-8 max-w-xl">
          <LoginForm searchParamsPromise={searchParams} />
        </div>
      </PageBody>
    </main>
  );
}
