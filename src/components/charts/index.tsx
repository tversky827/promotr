import { cn } from '@/lib/cn';

/**
 * Charts.
 *
 * Rendered as server-side SVG rather than through a charting library. At the
 * sizes this product needs — a handful of series, a few hundred points — a
 * library costs 150-400KB of client JavaScript to draw shapes the server can
 * emit directly. These render with zero client JS, are keyboard- and
 * screen-reader-navigable, and inherit the theme tokens automatically.
 */

export interface SeriesPoint {
  label: string;
  value: number;
  /** Secondary value rendered as a comparison line/bar where supported. */
  compare?: number;
}

interface ChartProps {
  data: SeriesPoint[];
  height?: number;
  className?: string;
  formatValue?: (value: number) => string;
  ariaLabel: string;
  color?: string;
}

const PAD = { top: 12, right: 8, bottom: 22, left: 8 };

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Area chart with a subtle gradient fill — the default for time series. */
export function AreaChart({
  data,
  height = 220,
  className,
  formatValue = (v) => v.toLocaleString(),
  ariaLabel,
  color = 'hsl(var(--primary))',
}: ChartProps) {
  if (data.length === 0) return <ChartEmpty height={height} className={className} />;

  const width = 100; // viewBox units; the SVG scales to its container
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const innerH = height - PAD.top - PAD.bottom;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;

  const x = (i: number) => (data.length > 1 ? i * stepX : width / 2);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(d.value).toFixed(2)}`).join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(2)},${PAD.top + innerH} L${x(0).toFixed(2)},${PAD.top + innerH} Z`;
  const gradientId = `area-${ariaLabel.replace(/\W/g, '')}`;

  const peak = data.reduce((best, d, i) => (d.value > data[best]!.value ? i : best), 0);

  return (
    <figure className={cn('w-full', className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`${ariaLabel}. Peak ${formatValue(data[peak]!.value)} on ${data[peak]!.label}.`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={t}
            x1={0}
            x2={width}
            y1={PAD.top + innerH * t}
            y2={PAD.top + innerH * t}
            stroke="hsl(var(--border))"
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <AxisLabels data={data} />
      <ScaleLabels max={max} formatValue={formatValue} />
      <VisuallyHiddenTable data={data} formatValue={formatValue} ariaLabel={ariaLabel} />
    </figure>
  );
}

/** Bar chart — used for discrete comparisons such as spend by day. */
export function BarChart({
  data,
  height = 220,
  className,
  formatValue = (v) => v.toLocaleString(),
  ariaLabel,
  color = 'hsl(var(--primary))',
}: ChartProps) {
  if (data.length === 0) return <ChartEmpty height={height} className={className} />;

  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const innerH = height - PAD.top - PAD.bottom;
  const slot = 100 / data.length;
  const barW = Math.min(slot * 0.62, 6);

  return (
    <figure className={cn('w-full', className)}>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
      >
        {[0, 0.5, 1].map((t) => (
          <line
            key={t}
            x1={0}
            x2={100}
            y1={PAD.top + innerH * t}
            y2={PAD.top + innerH * t}
            stroke="hsl(var(--border))"
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {data.map((d, i) => {
          const h = max > 0 ? (d.value / max) * innerH : 0;
          return (
            <rect
              key={`${d.label}-${i}`}
              x={i * slot + (slot - barW) / 2}
              y={PAD.top + innerH - h}
              width={barW}
              height={Math.max(h, d.value > 0 ? 1 : 0)}
              rx="0.8"
              fill={color}
              opacity={0.88}
            />
          );
        })}
      </svg>
      <AxisLabels data={data} />
      <ScaleLabels max={max} formatValue={formatValue} />
      <VisuallyHiddenTable data={data} formatValue={formatValue} ariaLabel={ariaLabel} />
    </figure>
  );
}

/** Horizontal bars for breakdowns (country, device, source). */
export function RankedBars({
  data,
  formatValue = (v) => v.toLocaleString(),
  className,
  maxItems = 8,
  emptyMessage = 'No data for this period',
}: {
  data: Array<{ label: string; value: number; share?: number }>;
  formatValue?: (value: number) => string;
  className?: string;
  maxItems?: number;
  emptyMessage?: string;
}) {
  if (data.length === 0) {
    return <p className={cn('py-8 text-center text-sm text-fg-muted', className)}>{emptyMessage}</p>;
  }

  const items = data.slice(0, maxItems);
  const max = Math.max(...items.map((d) => d.value), 1);

  return (
    <ul className={cn('space-y-2.5', className)}>
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-fg">{item.label}</span>
            <span className="shrink-0 tabular-nums text-fg-muted">
              {formatValue(item.value)}
              {item.share !== undefined ? (
                <span className="ml-1.5 text-xs text-fg-subtle">{item.share.toFixed(1)}%</span>
              ) : null}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${Math.max((item.value / max) * 100, 1.5)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Conversion funnel with drop-off between stages made explicit. */
export function Funnel({
  stages,
  className,
}: {
  stages: Array<{ label: string; count: number; conversionFromPrevious: number }>;
  className?: string;
}) {
  const max = Math.max(...stages.map((s) => s.count), 1);

  return (
    <ol className={cn('space-y-3', className)}>
      {stages.map((stage, index) => (
        <li key={stage.label}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-fg">{stage.label}</span>
            <span className="text-sm tabular-nums text-fg">{stage.count.toLocaleString()}</span>
          </div>
          <div className="mt-1.5 h-7 overflow-hidden rounded-md bg-surface-sunken">
            <div
              className="flex h-full items-center rounded-md bg-primary/85 px-2"
              style={{ width: `${Math.max((stage.count / max) * 100, 2)}%` }}
            />
          </div>
          {index > 0 ? (
            <p className="mt-1 text-xs text-fg-subtle">
              {stage.conversionFromPrevious.toFixed(1)}% of {stages[index - 1]!.label.toLowerCase()}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** Sparkline for inline trends in tables and cards. */
export function Sparkline({
  values,
  className,
  color = 'hsl(var(--primary))',
  ariaLabel,
}: {
  values: number[];
  className?: string;
  color?: string;
  ariaLabel: string;
}) {
  if (values.length < 2) return <span className={cn('block h-6', className)} />;

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = 100 / (values.length - 1);
  const path = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)},${(20 - ((v - min) / range) * 18).toFixed(2)}`)
    .join(' ');

  return (
    <svg
      viewBox="0 0 100 20"
      preserveAspectRatio="none"
      className={cn('h-6 w-full', className)}
      role="img"
      aria-label={ariaLabel}
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function AxisLabels({ data }: { data: SeriesPoint[] }) {
  // Show at most five labels so they never collide on a narrow screen.
  const stride = Math.max(1, Math.ceil(data.length / 5));
  return (
    <div className="mt-1 flex justify-between text-2xs text-fg-subtle" aria-hidden="true">
      {data
        .filter((_, i) => i % stride === 0 || i === data.length - 1)
        .map((d, i) => (
          <span key={`${d.label}-${i}`} className="truncate">
            {d.label}
          </span>
        ))}
    </div>
  );
}

function ScaleLabels({ max, formatValue }: { max: number; formatValue: (v: number) => string }) {
  return (
    <div className="mt-1 flex justify-between text-2xs text-fg-subtle" aria-hidden="true">
      <span>0</span>
      <span>{formatValue(max)}</span>
    </div>
  );
}

/**
 * The chart's data as a real table, available to screen readers and to anyone
 * who needs the exact numbers. A chart without this is inaccessible.
 */
function VisuallyHiddenTable({
  data,
  formatValue,
  ariaLabel,
}: {
  data: SeriesPoint[];
  formatValue: (v: number) => string;
  ariaLabel: string;
}) {
  return (
    <table className="sr-only">
      <caption>{ariaLabel}</caption>
      <thead>
        <tr>
          <th scope="col">Period</th>
          <th scope="col">Value</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d, i) => (
          <tr key={`${d.label}-${i}`}>
            <th scope="row">{d.label}</th>
            <td>{formatValue(d.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChartEmpty({ height, className }: { height: number; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-md border border-dashed border-border text-sm text-fg-subtle',
        className,
      )}
      style={{ height }}
    >
      No data for this period
    </div>
  );
}
