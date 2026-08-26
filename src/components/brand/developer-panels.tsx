'use client';

import { useState } from 'react';

import { ActionForm, FormBody, SubmitButton, useFieldError } from '@/components/ui/action-form';
import { Button } from '@/components/ui/button';
import { Checkbox, Input } from '@/components/ui/form';
import { Alert, Badge, Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { formatDateTime, formatRelative } from '@/lib/format';
import {
  addWebhookEndpoint,
  deleteWebhookEndpoint,
  issueApiKey,
  redeliverWebhook,
  revealWebhookSecret,
  revokeBrandApiKey,
  toggleWebhookEndpoint,
} from '@/server/actions/brand';

/**
 * Developer settings: API keys and webhook endpoints.
 *
 * A newly created API key is displayed once and then never again — we store
 * only its hash, so this is not a policy choice we could reverse. The UI says
 * so at the point of creation rather than after the value is gone.
 */

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface EndpointView {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  failureCount: number;
  disabledAt: string | null;
  createdAt: string;
  deliveries: DeliveryView[];
}

export interface DeliveryView {
  id: string;
  eventType: string;
  status: string;
  attempt: number;
  responseCode: number | null;
  errorMessage: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export function ApiKeysPanel({
  csrfToken,
  keys,
  scopes,
  canManage,
}: {
  csrfToken: string;
  keys: ApiKeyView[];
  scopes: readonly string[];
  canManage: boolean;
}) {
  const [issued, setIssued] = useState<{ key: string; prefix: string } | null>(null);

  return (
    <Card padded={false}>
      <div className="p-5">
        <CardHeader
          title="API keys"
          description="Used to report conversions and read your campaign data. Give each integration its own key so you can revoke one without breaking the others."
        />
      </div>

      {issued ? (
        <div className="border-t border-border px-5 py-4">
          <Alert tone="warning" title="Copy this key now — it is not shown again">
            <code className="mt-2 block break-all rounded-md border border-border bg-surface p-2.5 font-mono text-xs text-fg">
              {issued.key}
            </code>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(issued.key);
                }}
              >
                Copy key
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
                I have saved it
              </Button>
            </div>
          </Alert>
        </div>
      ) : null}

      {keys.length === 0 ? (
        <div className="px-5 pb-5">
          <EmptyState
            title="No API keys"
            description="Create one to start reporting conversions from your server."
          />
        </div>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">
                  {key.name}
                  {key.revokedAt ? (
                    <Badge tone="danger" className="ml-2">
                      Revoked
                    </Badge>
                  ) : null}
                </p>
                <p className="mt-0.5 font-mono text-xs text-fg-subtle">{key.prefix}…</p>
                <p className="mt-1 text-xs text-fg-subtle">
                  {key.scopes.join(', ') || 'no scopes'} · created{' '}
                  {formatDateTime(new Date(key.createdAt))} ·{' '}
                  {key.lastUsedAt
                    ? `last used ${formatRelative(new Date(key.lastUsedAt))}`
                    : 'never used'}
                </p>
              </div>
              {canManage && !key.revokedAt ? (
                <ActionForm action={revokeBrandApiKey} csrfToken={csrfToken}>
                  <input type="hidden" name="apiKeyId" value={key.id} />
                  <SubmitButton variant="ghost" size="sm">
                    Revoke
                  </SubmitButton>
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="border-t border-border p-5">
          <ActionForm
            action={issueApiKey}
            csrfToken={csrfToken}
            resetOnSuccess
            onSuccess={(data) => setIssued(data)}
          >
            <FormBody className="space-y-4">
              <NameField />
              <fieldset>
                <legend className="text-sm font-medium text-fg">Scopes</legend>
                <p className="mt-1 text-xs text-fg-subtle">
                  Grant only what the integration needs. A key that only reports conversions cannot
                  read your reports.
                </p>
                <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                  {scopes.map((scope) => (
                    <Checkbox
                      key={scope}
                      name="scopes"
                      value={scope}
                      defaultChecked={scope === 'conversions:write'}
                      label={<span className="font-mono text-sm">{scope}</span>}
                    />
                  ))}
                </div>
              </fieldset>
            </FormBody>
            <div className="mt-4">
              <SubmitButton>Create key</SubmitButton>
            </div>
          </ActionForm>
        </div>
      ) : (
        <div className="border-t border-border p-5">
          <Alert tone="info">Only a brand owner can create or revoke API keys.</Alert>
        </div>
      )}
    </Card>
  );
}

function NameField() {
  return (
    <Input
      name="name"
      label="Name"
      placeholder="Checkout server"
      required
      hint="Where this key will be used"
      error={useFieldError('name')}
    />
  );
}

export function WebhooksPanel({
  csrfToken,
  endpoints,
  events,
  canManage,
}: {
  csrfToken: string;
  endpoints: EndpointView[];
  events: readonly string[];
  canManage: boolean;
}) {
  const [secret, setSecret] = useState<string | null>(null);

  return (
    <Card padded={false}>
      <div className="p-5">
        <CardHeader
          title="Webhook endpoints"
          description="We POST signed events to your server. Each delivery is retried with backoff, and an endpoint that fails repeatedly is disabled rather than retried forever."
        />
      </div>

      {secret ? (
        <div className="border-t border-border px-5 py-4">
          <Alert tone="warning" title="Signing secret">
            <code className="mt-2 block break-all rounded-md border border-border bg-surface p-2.5 font-mono text-xs text-fg">
              {secret}
            </code>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(secret);
                }}
              >
                Copy secret
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>
                Hide
              </Button>
            </div>
          </Alert>
        </div>
      ) : null}

      {endpoints.length === 0 ? (
        <div className="px-5 pb-5">
          <EmptyState
            title="No endpoints"
            description="Add one to receive conversion and campaign events as they happen."
          />
        </div>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {endpoints.map((endpoint) => (
            <EndpointRow
              key={endpoint.id}
              endpoint={endpoint}
              csrfToken={csrfToken}
              canManage={canManage}
              onSecret={setSecret}
            />
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="border-t border-border p-5">
          <ActionForm
            action={addWebhookEndpoint}
            csrfToken={csrfToken}
            resetOnSuccess
            onSuccess={(data) => setSecret(data.secret)}
          >
            <FormBody className="space-y-4">
              <UrlField />
              <fieldset>
                <legend className="text-sm font-medium text-fg">Events</legend>
                <div className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <Checkbox
                    name="events"
                    value="*"
                    label={<span className="font-mono text-sm">* (everything)</span>}
                  />
                  {events.map((event) => (
                    <Checkbox
                      key={event}
                      name="events"
                      value={event}
                      label={<span className="font-mono text-sm">{event}</span>}
                    />
                  ))}
                </div>
              </fieldset>
            </FormBody>
            <div className="mt-4">
              <SubmitButton>Add endpoint</SubmitButton>
            </div>
          </ActionForm>
        </div>
      ) : (
        <div className="border-t border-border p-5">
          <Alert tone="info">Only a brand owner can manage webhook endpoints.</Alert>
        </div>
      )}
    </Card>
  );
}

function UrlField() {
  return (
    <Input
      name="url"
      label="Endpoint URL"
      placeholder="https://api.yourbrand.com/webhooks/promotr"
      required
      hint="HTTPS only"
      error={useFieldError('url')}
    />
  );
}

function EndpointRow({
  endpoint,
  csrfToken,
  canManage,
  onSecret,
}: {
  endpoint: EndpointView;
  csrfToken: string;
  canManage: boolean;
  onSecret: (secret: string) => void;
}) {
  const [showDeliveries, setShowDeliveries] = useState(false);

  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">{endpoint.url}</p>
          <p className="mt-0.5 text-xs text-fg-subtle">
            {endpoint.events.includes('*') ? 'all events' : `${endpoint.events.length} event(s)`} ·
            added {formatDateTime(new Date(endpoint.createdAt))}
            {endpoint.failureCount > 0
              ? ` · ${endpoint.failureCount} consecutive failure(s)`
              : ''}
          </p>
        </div>

        {endpoint.active ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge tone="danger">Disabled</Badge>
        )}

        <Button size="sm" variant="ghost" onClick={() => setShowDeliveries((open) => !open)}>
          {showDeliveries ? 'Hide deliveries' : 'Deliveries'}
        </Button>

        {canManage ? (
          <>
            <ActionForm
              action={revealWebhookSecret}
              csrfToken={csrfToken}
              onSuccess={(data) => onSecret(data.secret)}
              refresh={false}
            >
              <input type="hidden" name="endpointId" value={endpoint.id} />
              <SubmitButton variant="ghost" size="sm">
                Show secret
              </SubmitButton>
            </ActionForm>

            <ActionForm action={toggleWebhookEndpoint} csrfToken={csrfToken}>
              <input type="hidden" name="endpointId" value={endpoint.id} />
              <input type="hidden" name="active" value={endpoint.active ? 'false' : 'true'} />
              <SubmitButton variant="ghost" size="sm">
                {endpoint.active ? 'Disable' : 'Enable'}
              </SubmitButton>
            </ActionForm>

            <ActionForm action={deleteWebhookEndpoint} csrfToken={csrfToken}>
              <input type="hidden" name="endpointId" value={endpoint.id} />
              <SubmitButton variant="ghost" size="sm">
                Delete
              </SubmitButton>
            </ActionForm>
          </>
        ) : null}
      </div>

      {showDeliveries ? (
        endpoint.deliveries.length === 0 ? (
          <p className="mt-3 text-xs text-fg-subtle">
            No deliveries yet. Events appear here as they are sent.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5 rounded-md border border-border bg-surface-sunken p-3">
            {endpoint.deliveries.map((delivery) => (
              <li key={delivery.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono text-fg">{delivery.eventType}</span>
                <Badge
                  tone={
                    delivery.status === 'delivered'
                      ? 'success'
                      : delivery.status === 'dead'
                        ? 'danger'
                        : delivery.status === 'failed'
                          ? 'warning'
                          : 'neutral'
                  }
                >
                  {delivery.status}
                  {delivery.responseCode ? ` ${delivery.responseCode}` : ''}
                </Badge>
                <span className="text-fg-subtle">
                  attempt {delivery.attempt} · {formatRelative(new Date(delivery.createdAt))}
                </span>
                {delivery.errorMessage ? (
                  <span className="text-danger">{delivery.errorMessage}</span>
                ) : null}
                {canManage && delivery.status !== 'delivered' ? (
                  <ActionForm action={redeliverWebhook} csrfToken={csrfToken}>
                    <input type="hidden" name="deliveryId" value={delivery.id} />
                    <SubmitButton variant="ghost" size="xs">
                      Retry
                    </SubmitButton>
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </li>
  );
}
