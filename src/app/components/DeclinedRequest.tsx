import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowRight } from "lucide-react";
import { MOCK_REJECTION_REASON_EXAMPLE } from "../mockRejectionReason";
import { LicensePlate, type PlateType } from "./LicensePlate";

function rejectionReasonFromParams(searchParams: URLSearchParams): string {
  const raw = searchParams.get("reason");
  if (raw) {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return MOCK_REJECTION_REASON_EXAMPLE;
}

export function DeclinedRequest() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const licensePlate = searchParams.get("plate") || "";
  const plateType = (searchParams.get("type") || "civilian") as PlateType;
  const rejectionReason = rejectionReasonFromParams(searchParams);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-primary p-4 shadow-md">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <button
            onClick={() => navigate("/dashboard")}
            className="text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-6 h-6" />
          </button>
          <h1 className="text-xl text-primary-foreground font-semibold">{t("declinedRequest.title")}</h1>
          <div className="w-6" /> {/* Spacer for alignment */}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl space-y-8">
          {/* License Plate Display */}
          <LicensePlate plateNumber={licensePlate} plateType={plateType} className="w-full max-w-md mx-auto" />

          {/* Error Message */}
          <div className="bg-destructive/10 border-2 border-destructive rounded-2xl p-8 space-y-4">
            <div className="flex items-center justify-center gap-3 text-destructive">
              <AlertCircle className="w-8 h-8" />
              <h2 className="text-2xl font-semibold">{t("declinedRequest.noApproval")}</h2>
            </div>
            
            <div className="bg-background rounded-lg p-6 space-y-2">
              <p className="text-muted-foreground font-semibold">{t("declinedRequest.rejectionReason")}</p>
              <p className="text-foreground text-lg leading-relaxed whitespace-pre-wrap">{rejectionReason}</p>
            </div>
          </div>

          {/* Back Button */}
          <button
            onClick={() => navigate("/dashboard")}
            className="w-full bg-primary hover:bg-secondary text-primary-foreground py-4 rounded-lg transition-colors duration-200 shadow-md hover:shadow-lg font-semibold"
          >
            {t("declinedRequest.backHome")}
          </button>
        </div>
      </div>
    </div>
  );
}
