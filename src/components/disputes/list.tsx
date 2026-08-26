import Link from 'next/link';

import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { TBody, TD, TH, THead, TR, Table, TableWrap } from '@/components/ui/table';
import { formatRelative, humanize, statusTone } from '@/lib/format';

export interface DisputeRow {
  id: string;
  reference: string;
  kind: string;
  status: string;
  subject: string;
  openedBy: string;
  createdAt: Date;
  campaignName?: string | null;
  messageCount: number;
}

export function DisputeList({
  disputes,
  basePath,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: {
  disputes: DisputeRow[];
  basePath: string;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction?: React.ReactNode;
}) {
  if (disputes.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }

  return (
    <Card padded={false}>
      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Reference</TH>
              <TH>Subject</TH>
              <TH>Status</TH>
              <TH align="right">Messages</TH>
              <TH align="right">Opened</TH>
            </TR>
          </THead>
          <TBody>
            {disputes.map((dispute) => (
              <TR key={dispute.id}>
                <TD>
                  <Link
                    href={`${basePath}/${dispute.id}`}
                    className="font-mono text-sm font-medium text-fg hover:text-primary"
                  >
                    {dispute.reference}
                  </Link>
                  <div className="text-2xs text-fg-subtle">{humanize(dispute.kind)}</div>
                </TD>
                <TD>
                  <div className="max-w-md truncate text-fg">{dispute.subject}</div>
                  {dispute.campaignName ? (
                    <div className="text-2xs text-fg-subtle">{dispute.campaignName}</div>
                  ) : null}
                </TD>
                <TD>
                  <Badge tone={statusTone(dispute.status)}>{humanize(dispute.status)}</Badge>
                </TD>
                <TD align="right" numeric className="text-fg-muted">
                  {dispute.messageCount}
                </TD>
                <TD align="right" className="text-fg-muted">
                  {formatRelative(dispute.createdAt)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </Card>
  );
}
