import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowRight } from "lucide-react";
import { MOCK_REJECTION_REASON_EXAMPLE } from "../mockRejectionReason";
import { LicensePlate, type PlateType } from "./LicensePlate";
import { useScreenCache } from "../useScreenCache";
import { usePhoneBackSync } from "../usePhoneBackSync";

interface DeclinedCache {
  plate: string;
  plateType: PlateType;
  reason?: string;
}

/**
 * Screen shown when the ERP rejects a licence-plate lookup (vehicle not recognised
 * or service not approved at the time of lookup).
 *
 * Reads the plate / plateType / reason from `route-declined-{orderId}` in
 * sessionStorage so a full page reload restores the same view. The route's
 * `:orderId` segment is the synthetic slug `LicensePlateModal` writes when
 * the ERP rejects (no real order exists yet).
 */
export function DeclinedRequest() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ orderId: string }>();
  const orderId = params.orderId ?? "";
  const [cache] = useScreenCache<DeclinedCache>(`route-declined-${orderId}`);
  usePhoneBackSync({ fallback: "/dashboard" });

  useEffect(() => {
    if (!cache) navigate("/dashboard", { replace: true });
  }, [cache, navigate]);

  if (!cache) return null;

  const { plate: licensePlate, plateType, reason } = cache;
  const rejectionReason = reason ?? MOCK_REJECTION_REASON_EXAMPLE;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="bg-primary p-4 shadow-md">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <button
            onClick={() => navigate("/dashboard")}
            className="text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-5 h-5 ltr:rotate-180" />
          </button>
          <h1 className="text-2xl text-primary-foreground font-semibold">{t("declinedRequest.title")}</h1>
          <div className="w-5" />
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
