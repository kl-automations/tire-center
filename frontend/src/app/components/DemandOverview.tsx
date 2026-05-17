import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { usePhoneBackSync } from "../usePhoneBackSync";

/**
 * Phase 2 placeholder — column chrome only, no rows until Tafnit bulk data lands.
 *
 * Navigation: route exists for deep links; dashboard tile is disabled. Back → `/dashboard`.
 */
export function DemandOverview() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePhoneBackSync({ fallback: "/dashboard" });

  return (
    <div className="h-screen bg-background flex flex-col" style={{ height: "100dvh" }}>
      <div className="bg-primary p-4 shadow-md shrink-0">
        <div className="flex items-center justify-between max-w-5xl mx-auto">
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="flex items-center justify-center w-11 h-11 -ms-1 text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-6 h-6 ltr:rotate-180" />
          </button>
          <h1 className="text-2xl text-primary-foreground font-semibold">{t("demandOverview.title")}</h1>
          <div className="w-11" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-8">
        <div className="max-w-5xl mx-auto" dir="ltr">
          <div className="mb-4 grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3 px-1 text-sm text-muted-foreground font-semibold">
            <span>{t("demandOverview.monthlyDemand")}</span>
            <span className="text-right">{t("demandOverview.tireSize")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
