import type { ReactNode } from "react";

interface SettingRowProps {
  readonly label: string;
  readonly description?: string;
  readonly children: ReactNode;
}

/** Row layout for a single setting: label and hint on the left, control on the right. */
export function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{label}</span>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
