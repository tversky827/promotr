'use client';

import { ActionForm, SubmitButton } from '@/components/ui/action-form';
import { markAllNotificationsRead, markNotificationRead } from '@/server/actions/auth';

/** Mark one notification read, or all of them. */
export function NotificationActions({
  csrfToken,
  notificationId,
  markAll,
}: {
  csrfToken: string;
  notificationId?: string;
  markAll?: boolean;
}) {
  if (markAll) {
    return (
      <ActionForm action={markAllNotificationsRead} csrfToken={csrfToken}>
        <SubmitButton variant="secondary" size="sm">
          Mark all read
        </SubmitButton>
      </ActionForm>
    );
  }

  return (
    <ActionForm action={markNotificationRead} csrfToken={csrfToken}>
      <input type="hidden" name="notificationId" value={notificationId} />
      <SubmitButton variant="ghost" size="sm">
        Mark read
      </SubmitButton>
    </ActionForm>
  );
}
