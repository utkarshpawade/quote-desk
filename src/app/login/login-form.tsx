"use client";

import { useActionState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { login, type LoginState } from "@/server/auth/actions";
import type { DemoAccount } from "@/server/demo";

export function LoginForm({
  next,
  demo,
}: {
  next?: string;
  demo: { accounts: DemoAccount[]; password: string } | null;
}) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, {});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function signInAs(email: string) {
    if (!emailRef.current || !passwordRef.current || !demo) return;
    emailRef.current.value = email;
    passwordRef.current.value = demo.password;
    passwordRef.current.form?.requestSubmit();
  }

  return (
    <>
      <form action={formAction} className="mt-6 flex flex-col gap-4" noValidate>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <Field label="Work email" htmlFor="email">
          <Input
            ref={emailRef}
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            defaultValue={state.email}
            required
            autoFocus
            aria-invalid={state.error ? true : undefined}
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            ref={passwordRef}
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={state.error ? true : undefined}
          />
        </Field>

        <div aria-live="polite" className="min-h-5">
          {state.error ? <p className="text-dense text-danger">{state.error}</p> : null}
        </div>

        <Button type="submit" variant="primary" size="lg" loading={pending} className="justify-center">
          Sign in
        </Button>
      </form>

      {demo ? (
        <section className="mt-8 rounded-lg border border-line bg-surface" aria-labelledby="demo-heading">
          <div className="flex items-baseline justify-between border-b border-line px-4 py-2.5">
            <h2 id="demo-heading" className="text-dense font-medium">
              Demo accounts
            </h2>
            <span className="text-xs text-ink-3">
              password <span className="font-mono text-ink-2">{demo.password}</span>
            </span>
          </div>
          <ul className="divide-y divide-line">
            {demo.accounts.map((account) => (
              <li key={account.email} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {account.name} <span className="text-ink-3">· {account.roleLabel}</span>
                  </p>
                  <p className="truncate text-xs text-ink-3">{account.hint}</p>
                </div>
                <Button size="sm" onClick={() => signInAs(account.email)} disabled={pending}>
                  Sign in
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
