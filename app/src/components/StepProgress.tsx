import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useThemeStore } from "@/stores/themeStore";

interface SubStep {
  key: string;
  label: string;
  done: boolean;
  active?: boolean; // currently in progress (e.g. generating)
}

interface StepProgressProps {
  subSteps?: SubStep[];
}

const MAIN_STEPS = [
  { key: "dataPrep", path: "/data-prep", labelKey: "dataPrep:pageTitle" },
  { key: "training", path: "/training", labelKey: "training:pageTitle" },
  { key: "testing", path: "/testing", labelKey: "testing:pageTitle" },
  { key: "export", path: "/export", labelKey: "export:pageTitle" },
];

export function StepProgress({ subSteps }: StepProgressProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const currentPath = location.pathname;
  const currentIdx = MAIN_STEPS.findIndex((s) => s.path === currentPath);

  return (
    <div className="w-full space-y-3">
      {/* Main progress bar - full width */}
      <div className="relative flex w-full items-center">
        {/* Background line - z-0 so it stays behind buttons */}
        <div className="absolute left-0 right-0 top-1/2 z-0 h-px -translate-y-1/2 bg-border" />
        {/* Progress line up to current step */}
        {currentIdx > 0 && (
          <div
            className="absolute left-0 top-1/2 z-0 h-px -translate-y-1/2 bg-primary/50"
            style={{
              width: `${(currentIdx / (MAIN_STEPS.length - 1)) * 100}%`,
            }}
          />
        )}
        <div className="relative flex w-full justify-between">
          {MAIN_STEPS.map((step, idx) => {
            const isCurrent = currentPath === step.path;
            const isPast = idx < currentIdx;
            return (
              <button
                key={step.key}
                onClick={() => navigate(step.path)}
                className={`relative z-10 rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                  isCurrent
                    ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                    : isPast
                      ? "bg-muted text-primary hover:bg-accent"
                      : "bg-card text-muted-foreground ring-1 ring-border hover:bg-accent"
                }`}
              >
                {t(step.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sub-step timeline for current page */}
      {subSteps && subSteps.length > 0 && (
        <div className="relative flex w-full items-center">
          {/* Background line - z-0 so it stays behind labels */}
          <div className="absolute left-0 right-0 top-1/2 z-0 h-px -translate-y-1/2 bg-border/50" />
          {/* Progress line */}
          {(() => {
            const lastDone = subSteps.reduce(
              (acc, s, i) => (s.done || s.active ? i : acc),
              -1,
            );
            if (lastDone < 0) return null;
            const pct = (lastDone / (subSteps.length - 1)) * 100;
            return (
              <div
                className="absolute left-0 top-1/2 z-0 h-px -translate-y-1/2 bg-success/40"
                style={{ width: `${pct}%` }}
              />
            );
          })()}
          <div className="relative flex w-full justify-between">
            {subSteps.map((sub) => (
              <span
                key={sub.key}
                className={`relative z-10 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-all ${
                  sub.active
                    ? "bg-card text-primary ring-1 ring-primary/40"
                    : sub.done
                      ? theme === "midnight"
                        ? "bg-card text-success ring-1 ring-success/30"
                        : theme === "ocean"
                          ? "bg-primary text-primary-foreground"
                          : "bg-success text-white"
                      : "bg-card text-muted-foreground/60 ring-1 ring-border/50"
                }`}
              >
                {sub.active && <Loader2 size={10} className="animate-spin" />}
                {sub.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
