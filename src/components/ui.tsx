"use client";
import {
  useEffect,
  useRef,
  useId,
  createContext,
  useContext,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { X, Inbox, ChevronDown } from "lucide-react";
import { DateTime } from "luxon";
export function Button({
  children,
  className = "",
  variant = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger";
}) {
  return (
    <button className={`button ${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function IconButton({
  children,
  label,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      className={`icon-button ${className}`}
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function StageBadge({ stage }: { stage: string }) {
  return (
    <Badge
      tone={
        stage === "converted"
          ? "green"
          : stage === "qualified"
            ? "blue"
            : "neutral"
      }
    >
      {stage === "not_qualified"
        ? "Not qualified"
        : stage[0].toUpperCase() + stage.slice(1)}
    </Badge>
  );
}
export function Avatar({
  name,
  size = "normal",
}: {
  name: string;
  size?: "small" | "normal" | "large";
}) {
  let n = 0;
  for (const char of name) n += char.charCodeAt(0);
  return (
    <span className={`avatar ${size} avatar-${n % 5}`}>
      {name
        .split(" ")
        .slice(0, 2)
        .map((n) => n[0])
        .join("")}
    </span>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Inbox size={25} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
const FieldLabel = createContext<string | undefined>(undefined);
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <label className="field">
      <span id={id}>{label}</span>
      <FieldLabel.Provider value={id}>{children}</FieldLabel.Provider>
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Select({
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useContext(FieldLabel);
  return (
    <span className="select-wrap">
      <select aria-labelledby={props["aria-label"] ? undefined : id} {...props}>
        {children}
      </select>
      <ChevronDown size={14} />
    </span>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll("[role=dialog]");
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const nodes = Array.from(
          ref.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input,select,textarea,a[href],[tabindex="0"]',
          ),
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
export const formatMoney = (
  minor: number | null,
  currency = "PHP",
  compact = false,
) =>
  minor === null
    ? "—"
    : new Intl.NumberFormat("en-PH", {
        style: "currency",
        currency,
        maximumFractionDigits: compact ? 0 : 2,
        minimumFractionDigits: compact || Number.isInteger(minor / 100) ? 0 : 2,
        ...(compact ? { notation: "compact" as const } : {}),
      }).format(minor / 100);
export const formatNumber = (n: number) =>
  new Intl.NumberFormat("en-PH").format(n);
export const formatPercent = (n: number | null) =>
  n === null ? "—" : `${(n * 100).toFixed(1)}%`;
export const formatDate = (
  iso: string,
  zone = "Asia/Manila",
  format = "MMM d, h:mm a",
) => DateTime.fromISO(iso).setZone(zone).toFormat(format);
export function Sparkline({
  values,
  color = "#478c76",
}: {
  values: number[];
  color?: string;
}) {
  const max = Math.max(...values, 1),
    min = Math.min(...values, 0),
    range = max - min || 1;
  return (
    <svg
      className="sparkline"
      viewBox="0 0 110 35"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d={values
          .map(
            (v, i) =>
              `${i ? "L" : "M"} ${(i * 110) / Math.max(1, values.length - 1)} ${30 - ((v - min) / range) * 25}`,
          )
          .join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
