import Icon from "./Icons";

/** The title block at the top of a page: icon, title, one line of help, and optional actions on the right. */
export default function PageHeader({
  icon,
  title,
  subtitle,
  children,
}: {
  icon?: string;
  title: string;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {icon && (
          <span className="bg-brand-gradient mt-0.5 hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md shadow-teal-700/20 sm:flex">
            <Icon name={icon} />
          </span>
        )}
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle text-sm">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** Round initials badge for a person ("Anita Rao" → "AR"). Decorative: hidden from screen readers. */
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const clean = name.replace(/^(prof\.?\s*)?(dr\.?\s*)/i, "").trim();
  const initials = clean.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  const sizes = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-16 w-16 text-xl" };
  return (
    <span aria-hidden="true" className={`bg-brand-gradient flex shrink-0 items-center justify-center rounded-full font-bold text-white ${sizes[size]}`}>
      {initials}
    </span>
  );
}
