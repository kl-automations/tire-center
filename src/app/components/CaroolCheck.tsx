import { useNavigate, useSearchParams } from "react-router";
import { ArrowRight } from "lucide-react";

export function CaroolCheck() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const licensePlate = searchParams.get("plate") || "";

  return (
    <div className="min-h-screen bg-background flex flex-col" dir="rtl">
      <div className="bg-primary p-4 shadow-md">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <button
            onClick={() => navigate(`/request/accepted?plate=${licensePlate}`)}
            className="text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-6 h-6" />
          </button>
          <h1 className="text-xl text-primary-foreground font-semibold">בדיקה עם קרול</h1>
          <div className="w-6" />
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-4 gap-6">
        <p className="text-muted-foreground text-lg">ממשק מצלמת קרול יופיע כאן</p>

        <button
          onClick={() => navigate(`/request/accepted?plate=${licensePlate}`)}
          className="w-full max-w-md bg-primary hover:bg-primary/90 text-primary-foreground py-4 rounded-xl transition-colors duration-200 shadow-lg hover:shadow-xl font-semibold text-lg"
        >
          המשך
        </button>
      </div>
    </div>
  );
}
