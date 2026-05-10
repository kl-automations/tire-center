import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { usePhoneBackSync } from "../usePhoneBackSync";

/** Action keys aligned with `monthlyReceipt.actions.*` in locales (no mock data). */
const MONTHLY_RECEIPT_ACTION_KEYS = [
  "tireReplacement",
  "punctureRepair",
  "wheelBalancing",
  "frontAlignment",
  "relocation",
  "valveReplacement",
  "tpmsSensor",
  "rimRepair",
] as const;

type MonthlyActionRow = { actionKey: (typeof MONTHLY_RECEIPT_ACTION_KEYS)[number]; count: number };

/**
 * Phase 2 placeholder — full UI at zero until daily Tafnit aggregates exist.
 *
 * Navigation: route registered; dashboard tile disabled. Back → `/dashboard`.
 */
export function MonthlyReceipt() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePhoneBackSync({ fallback: "/dashboard" });

  const monthOptions: string[] = [];
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [compareMonth, setCompareMonth] = useState<string>("");
  const [showPastMonths, setShowPastMonths] = useState(false);

  const compareSnapshot = useMemo(
    () => (compareMonth ? monthOptions.find((m) => m === compareMonth) : undefined),
    [monthOptions, compareMonth],
  );
  const compareByAction = useMemo(() => new Map<string, number>(), []);

  const sortedActions: MonthlyActionRow[] = useMemo(() => {
    return MONTHLY_RECEIPT_ACTION_KEYS.map((actionKey) => ({
      actionKey,
      count: 0,
    }));
  }, []);

  const totalThisMonth = 0;
  const totalCompareMonth = 0;

  const formatMonthLabel = (monthKey: string) => {
    if (!monthKey) return "—";
    const [year, month] = monthKey.split("-");
    if (!year || !month) return "—";
    return `${month}/${year}`;
  };

  const triggerDownload = (content: BlobPart, mime: string, filename: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = () => {
    const header = [t("monthlyReceipt.action"), t("monthlyReceipt.count"), t("monthlyReceipt.compareDelta")].join(",");
    const lines = sortedActions.map((item) => {
      const prev = compareByAction.get(item.actionKey) ?? 0;
      const delta = compareSnapshot ? item.count - prev : "";
      return [`"${t(`monthlyReceipt.actions.${item.actionKey}`)}"`, item.count, delta].join(",");
    });
    const monthSlug = selectedMonth || "empty";
    triggerDownload([header, ...lines].join("\n"), "text/csv;charset=utf-8;", `monthly-receipt-${monthSlug}.csv`);
  };

  const exportXls = () => {
    const rows = sortedActions
      .map((item) => {
        const prev = compareByAction.get(item.actionKey) ?? 0;
        const delta = compareSnapshot ? item.count - prev : "";
        return `<tr><td>${t(`monthlyReceipt.actions.${item.actionKey}`)}</td><td>${item.count}</td><td>${delta}</td></tr>`;
      })
      .join("");
    const table = `
      <table>
        <tr>
          <th>${t("monthlyReceipt.action")}</th>
          <th>${t("monthlyReceipt.count")}</th>
          <th>${t("monthlyReceipt.compareDelta")}</th>
        </tr>
        ${rows}
      </table>
    `;
    triggerDownload(table, "application/vnd.ms-excel", `monthly-receipt-${selectedMonth || "empty"}.xls`);
  };

  const exportPdf = () => {
    const lines = sortedActions
      .map((item) => {
        const prev = compareByAction.get(item.actionKey) ?? 0;
        const delta = compareSnapshot ? item.count - prev : 0;
        const deltaText = compareSnapshot ? ` (${delta >= 0 ? "+" : ""}${delta})` : "";
        return `<tr><td>${t(`monthlyReceipt.actions.${item.actionKey}`)}</td><td>${item.count}${deltaText}</td></tr>`;
      })
      .join("");
    const html = `
      <html>
        <head><title>${t("monthlyReceipt.title")}</title></head>
        <body style="font-family: Arial, sans-serif; padding: 16px;">
          <h2>${t("monthlyReceipt.title")} - ${formatMonthLabel(selectedMonth)}</h2>
          <table border="1" cellspacing="0" cellpadding="6" style="border-collapse: collapse; width: 100%;">
            <tr><th>${t("monthlyReceipt.action")}</th><th>${t("monthlyReceipt.count")}</th></tr>
            ${lines}
          </table>
        </body>
      </html>
    `;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="h-screen bg-background flex flex-col" style={{ height: "100dvh" }}>
      <div className="bg-primary p-4 shadow-md shrink-0">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-6 h-6" />
          </button>
          <h1 className="text-xl text-primary-foreground font-semibold">{t("monthlyReceipt.title")}</h1>
          <div className="w-6" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-8">
        <div className="max-w-4xl mx-auto min-h-full flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3">
            <article className="bg-card border border-border rounded-xl p-4 text-center">
              <p className="text-xs text-muted-foreground font-semibold">{t("monthlyReceipt.totalThisMonth")}</p>
              <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">{totalThisMonth}</p>
            </article>
          </div>

          <section className="bg-card border border-border rounded-2xl p-4">
            <div
              className={`mb-3 grid ${compareSnapshot ? "grid-cols-[1fr_auto_auto]" : "grid-cols-[1fr_auto]"} items-center gap-3 text-xs font-semibold text-muted-foreground`}
            >
              <span>{t("monthlyReceipt.action")}</span>
              <span>{t("monthlyReceipt.count")}</span>
              {compareSnapshot && <span>{t("monthlyReceipt.compareDelta")}</span>}
            </div>

            <div className="space-y-2">
              {sortedActions.map((item) => {
                const prev = compareByAction.get(item.actionKey) ?? 0;
                const delta = item.count - prev;
                return (
                  <div
                    key={item.actionKey}
                    className={`grid ${compareSnapshot ? "grid-cols-[1fr_auto_auto]" : "grid-cols-[1fr_auto]"} items-center gap-3 rounded-lg bg-muted/40 px-3 py-2`}
                  >
                    <span className="text-sm font-medium text-foreground">
                      {t(`monthlyReceipt.actions.${item.actionKey}`)}
                    </span>
                    <span className="text-sm font-bold text-foreground tabular-nums">{item.count}</span>
                    {compareSnapshot && (
                      <span
                        className={`text-sm font-semibold tabular-nums ${
                          delta > 0
                            ? "text-green-700 dark:text-green-300"
                            : delta < 0
                              ? "text-red-700 dark:text-red-300"
                              : "text-muted-foreground"
                        }`}
                      >
                        {delta > 0 ? `+${delta}` : delta}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-foreground">
                <span className="text-muted-foreground">{t("monthlyReceipt.currentMonth")}:</span>{" "}
                <span className="font-semibold">{formatMonthLabel(selectedMonth)}</span>
              </p>
              <button
                type="button"
                onClick={() => setShowPastMonths((v) => !v)}
                className="px-3 py-1.5 text-sm rounded-lg border border-border bg-muted/40 hover:bg-muted/70"
              >
                {t("monthlyReceipt.lookAtPastMonths")}
              </button>
            </div>

            {showPastMonths && (
              <label className="space-y-1 block">
                <span className="text-xs font-semibold text-muted-foreground">{t("monthlyReceipt.selectedMonth")}</span>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  disabled={monthOptions.length === 0}
                  className="w-full bg-input-background border border-border rounded-lg px-3 py-2 text-sm text-foreground disabled:opacity-60"
                >
                  {monthOptions.length === 0 ? (
                    <option value="">{t("monthlyReceipt.noMonthsYet")}</option>
                  ) : (
                    monthOptions.map((m) => (
                      <option key={m} value={m}>
                        {formatMonthLabel(m)}
                      </option>
                    ))
                  )}
                </select>
              </label>
            )}
          </section>

          <section className="bg-card border border-border rounded-xl p-4 space-y-3 mt-auto">
            <label className="space-y-1 block">
              <span className="text-xs font-semibold text-muted-foreground">{t("monthlyReceipt.compareMonth")}</span>
              <select
                value={compareMonth}
                onChange={(e) => setCompareMonth(e.target.value)}
                className="w-full bg-input-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
              >
                <option value="">{t("monthlyReceipt.noCompare")}</option>
                {monthOptions
                  .filter((m) => m !== selectedMonth)
                  .map((m) => (
                    <option key={m} value={m}>
                      {formatMonthLabel(m)}
                    </option>
                  ))}
              </select>
            </label>

            {compareSnapshot && (
              <article className="bg-muted/40 border border-border rounded-xl p-4 text-center">
                <p className="text-xs text-muted-foreground font-semibold">{t("monthlyReceipt.totalCompareMonth")}</p>
                <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">{totalCompareMonth}</p>
              </article>
            )}
          </section>

          <section className="bg-card border border-border rounded-xl p-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={exportCsv}
                className="px-3 py-1.5 text-sm rounded-lg border border-border bg-muted/40 hover:bg-muted/70"
              >
                {t("monthlyReceipt.exportCsv")}
              </button>
              <button
                type="button"
                onClick={exportXls}
                className="px-3 py-1.5 text-sm rounded-lg border border-border bg-muted/40 hover:bg-muted/70"
              >
                {t("monthlyReceipt.exportXls")}
              </button>
              <button
                type="button"
                onClick={exportPdf}
                className="px-3 py-1.5 text-sm rounded-lg border border-border bg-muted/40 hover:bg-muted/70"
              >
                {t("monthlyReceipt.exportPdf")}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
