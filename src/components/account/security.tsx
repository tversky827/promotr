'use client';

import { useState, useTransition } from 'react';

import { ActionForm, FormBody, SubmitButton, useFieldError } from '@/components/ui/action-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Alert, Badge, Card, CardHeader } from '@/components/ui/primitives';
import { formatDateTime, formatRelative } from '@/lib/format';
import {
  beginMfaEnrollment,
  changePassword,
  confirmMfaEnrollment,
  disableMfa,
  exportMyData,
  requestAccountDeletion,
  revokeOneSession,
  signOutEverywhere,
} from '@/server/actions/auth';

/**
 * Account security.
 *
 * Shared by publishers and brand users because the account is the same object
 * for both — only the surrounding navigation differs. Every control here is
 * wired to a real action: enabling MFA really provisions a TOTP secret, and
 * revoking a session really invalidates that session's token immediately.
 */

export interface SessionView {
  id: string;
  current: boolean;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export function PasswordCard({
  csrfToken,
  hasPassword,
}: {
  csrfToken: string;
  hasPassword: boolean;
}) {
  if (!hasPassword) {
    return (
      <Card>
        <CardHeader
          title="Password"
          description="This account signs in with a connected provider, so it has no password to change."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Password"
        description="Changing your password signs out every other session."
      />
      <ActionForm action={changePassword} csrfToken={csrfToken} className="mt-4" resetOnSuccess>
        <FormBody className="grid max-w-xl gap-4">
          <PasswordField
            name="currentPassword"
            label="Current password"
            autoComplete="current-password"
          />
          <PasswordField
            name="password"
            label="New password"
            autoComplete="new-password"
            hint="At least 12 characters"
          />
          <PasswordField
            name="confirmPassword"
            label="Confirm new password"
            autoComplete="new-password"
          />
        </FormBody>
        <div className="mt-4">
          <SubmitButton>Update password</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}

function PasswordField({
  name,
  label,
  autoComplete,
  hint,
}: {
  name: string;
  label: string;
  autoComplete: string;
  hint?: string;
}) {
  return (
    <Input
      type="password"
      name={name}
      label={label}
      hint={hint}
      autoComplete={autoComplete}
      required
      error={useFieldError(name)}
    />
  );
}

export function MfaCard({
  csrfToken,
  enabled,
  required,
}: {
  csrfToken: string;
  enabled: boolean;
  /** Administrators cannot turn it off. */
  required: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [enrollment, setEnrollment] = useState<{ secret: string; uri: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const begin = () => {
    setError(null);
    startTransition(async () => {
      const result = await beginMfaEnrollment();
      if (result.ok) setEnrollment(result.data);
      else setError(result.error);
    });
  };

  if (recoveryCodes) {
    return (
      <Card>
        <CardHeader
          title="Save your recovery codes"
          description="Each code works once, and they are not shown again. Store them somewhere you can reach without your phone."
        />
        <ul className="mt-4 grid max-w-md grid-cols-2 gap-2 rounded-lg border border-border bg-surface-sunken p-4 font-mono text-sm">
          {recoveryCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <div className="mt-4 flex gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(recoveryCodes.join('\n'));
            }}
          >
            Copy codes
          </Button>
          <Button onClick={() => setRecoveryCodes(null)}>I have saved them</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Two-factor authentication"
        description="A time-based code from an authenticator app, required at sign-in."
        action={
          enabled ? <Badge tone="success">On</Badge> : <Badge tone="warning">Off</Badge>
        }
      />

      {error ? (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      ) : null}

      {enabled ? (
        required ? (
          <p className="mt-4 text-sm text-fg-muted text-pretty">
            Administrator accounts must keep two-factor authentication enabled, so it cannot be
            turned off here.
          </p>
        ) : (
          <ActionForm action={disableMfa} csrfToken={csrfToken} className="mt-4">
            <FormBody className="max-w-sm">
              <PasswordField
                name="password"
                label="Confirm your password to turn it off"
                autoComplete="current-password"
              />
            </FormBody>
            <div className="mt-4">
              <SubmitButton variant="danger">Turn off</SubmitButton>
            </div>
          </ActionForm>
        )
      ) : enrollment ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-fg-muted text-pretty">
            Add this secret to your authenticator app, then enter the six-digit code it shows.
          </p>
          <div className="max-w-md rounded-lg border border-border bg-surface-sunken p-4">
            <p className="text-xs uppercase tracking-wide text-fg-subtle">Setup key</p>
            <p className="mt-1 break-all font-mono text-sm text-fg">{enrollment.secret}</p>
            <a
              href={enrollment.uri}
              className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
            >
              Open in your authenticator app
            </a>
          </div>
          <ActionForm
            action={confirmMfaEnrollment}
            csrfToken={csrfToken}
            onSuccess={(data) => setRecoveryCodes(data.recoveryCodes)}
            refresh
          >
            <FormBody className="max-w-xs">
              <CodeField />
            </FormBody>
            <div className="mt-4">
              <SubmitButton>Turn on</SubmitButton>
            </div>
          </ActionForm>
        </div>
      ) : (
        <div className="mt-4">
          <Button onClick={begin} loading={pending}>
            Set up two-factor authentication
          </Button>
        </div>
      )}
    </Card>
  );
}

function CodeField() {
  return (
    <Input
      name="code"
      label="Six-digit code"
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="123456"
      required
      error={useFieldError('code')}
    />
  );
}

export function SessionsCard({
  csrfToken,
  sessions,
}: {
  csrfToken: string;
  sessions: SessionView[];
}) {
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-start justify-between gap-3 p-5">
        <CardHeader
          title="Active sessions"
          description="Every device currently signed in to this account."
        />
        {sessions.length > 1 ? (
          <ActionForm action={signOutEverywhere} csrfToken={csrfToken}>
            <SubmitButton variant="secondary" size="sm">
              Sign out everywhere else
            </SubmitButton>
          </ActionForm>
        ) : null}
      </div>

      <ul className="divide-y divide-border border-t border-border">
        {sessions.map((session) => (
          <li key={session.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-fg">
                {describeUserAgent(session.userAgent)}
                {session.current ? (
                  <Badge tone="success" className="ml-2">
                    This device
                  </Badge>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs text-fg-subtle">
                Last active {formatRelative(new Date(session.lastSeenAt))} · signed in{' '}
                {formatDateTime(new Date(session.createdAt))}
              </p>
            </div>
            {!session.current ? (
              <ActionForm action={revokeOneSession} csrfToken={csrfToken}>
                <input type="hidden" name="sessionId" value={session.id} />
                <SubmitButton variant="ghost" size="sm">
                  Sign out
                </SubmitButton>
              </ActionForm>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * A user agent string is not something to show a person verbatim. This reduces
 * it to the two things they actually use to recognise a device.
 */
function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser =
    /Edg\//.test(userAgent) ? 'Edge'
    : /OPR\//.test(userAgent) ? 'Opera'
    : /Chrome\//.test(userAgent) ? 'Chrome'
    : /Safari\//.test(userAgent) ? 'Safari'
    : /Firefox\//.test(userAgent) ? 'Firefox'
    : 'Browser';
  const platform =
    /iPhone|iPad/.test(userAgent) ? 'iOS'
    : /Android/.test(userAgent) ? 'Android'
    : /Mac OS X/.test(userAgent) ? 'macOS'
    : /Windows/.test(userAgent) ? 'Windows'
    : /Linux/.test(userAgent) ? 'Linux'
    : 'Unknown OS';
  return `${browser} on ${platform}`;
}

export function DataCard() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const download = () => {
    setError(null);
    startTransition(async () => {
      const result = await exportMyData();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Built and revoked in the browser: the file never becomes a URL that
      // anyone else could fetch.
      const blob = new Blob([result.data.json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  };

  return (
    <Card>
      <CardHeader
        title="Your data"
        description="Download everything held about your account as JSON — profile, activity, earnings and the agreements you have accepted."
      />
      {error ? (
        <Alert tone="danger" className="mt-4">
          {error}
        </Alert>
      ) : null}
      <div className="mt-4">
        <Button variant="secondary" onClick={download} loading={pending}>
          Download my data
        </Button>
      </div>
    </Card>
  );
}

export function DeleteAccountCard({ csrfToken }: { csrfToken: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="border-danger/40">
      <CardHeader
        title="Delete this account"
        description="Deletion is scheduled rather than immediate: you are signed out straight away and have 30 days to contact support and cancel. A publisher with an unpaid balance must withdraw it first — we will not delete an account we still owe money to."
      />

      {open ? (
        <ActionForm action={requestAccountDeletion} csrfToken={csrfToken} className="mt-4">
          <FormBody className="grid max-w-sm gap-4">
            <PasswordField
              name="password"
              label="Your password"
              autoComplete="current-password"
            />
            <ConfirmField />
          </FormBody>
          <div className="mt-4 flex gap-2">
            <SubmitButton variant="danger">Delete my account</SubmitButton>
            <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </ActionForm>
      ) : (
        <div className="mt-4">
          <Button variant="danger" onClick={() => setOpen(true)}>
            Delete account
          </Button>
        </div>
      )}
    </Card>
  );
}

function ConfirmField() {
  return (
    <Input
      name="confirm"
      label="Type DELETE to confirm"
      placeholder="DELETE"
      autoComplete="off"
      required
      error={useFieldError('confirm')}
    />
  );
}
