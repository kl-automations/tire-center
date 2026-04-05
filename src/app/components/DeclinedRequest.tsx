import { useNavigate, useSearchParams } from "react-router";
import { AlertCircle, ArrowRight } from "lucide-react";

export function DeclinedRequest() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const licensePlate = searchParams.get("plate") || "";

  return (
    <div className="min-h-screen bg-background flex flex-col" dir="rtl">
      {/* Header */}
      <div className="bg-primary p-4 shadow-md">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <button
            onClick={() => navigate("/dashboard")}
            className="text-primary-foreground hover:opacity-80 transition-opacity"
          >
            <ArrowRight className="w-6 h-6" />
          </button>
          <h1 className="text-xl text-primary-foreground font-semibold">פנייה חדשה</h1>
          <div className="w-6" /> {/* Spacer for alignment */}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl space-y-8">
          {/* License Plate Display */}
          <div className="flex justify-center">
            <div className="w-full max-w-md">
              <div className="bg-yellow-400 rounded-xl border-4 sm:border-[6px] border-black shadow-2xl flex items-center overflow-hidden w-full" style={{ aspectRatio: '3.8/1' }}>
                {/* Blue Left Section */}
                <div className="bg-blue-600 h-full flex flex-col items-center justify-center px-2 sm:px-4 gap-0.5 sm:gap-1 w-[20%] min-w-[60px] max-w-[80px]">
                  <div className="bg-white rounded-sm p-0.5 sm:p-1 flex items-center justify-center mb-0.5 sm:mb-1">
                    <svg className="w-6 h-4 sm:w-8 sm:h-6" viewBox="0 0 220 160" xmlns="http://www.w3.org/2000/svg">
                      <rect width="220" height="160" fill="white"/>
                      <rect width="220" height="53.33" fill="#0038b8"/>
                      <rect y="106.67" width="220" height="53.33" fill="#0038b8"/>
                      <polygon points="110,53.33 120,73.33 142,73.33 124,86.67 132,106.67 110,93.33 88,106.67 96,86.67 78,73.33 100,73.33" fill="#0038b8"/>
                    </svg>
                  </div>
                  <div className="text-white text-sm sm:text-xl font-bold tracking-tight">IL</div>
                  <div className="text-white text-[8px] sm:text-[10px] leading-tight text-center">ישראל</div>
                  <div className="text-white text-[6px] sm:text-[8px] leading-tight">إسرائيل</div>
                </div>
                
                {/* Yellow Plate Number Section */}
                <div className="flex-1 h-full flex items-center justify-center px-3 sm:px-6">
                  <div className="text-center text-3xl sm:text-5xl font-bold text-black tracking-widest" style={{ fontFamily: 'monospace' }}>
                    {licensePlate}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Error Message */}
          <div className="bg-destructive/10 border-2 border-destructive rounded-2xl p-8 space-y-4">
            <div className="flex items-center justify-center gap-3 text-destructive">
              <AlertCircle className="w-8 h-8" />
              <h2 className="text-2xl font-semibold">אין אישור לביצוע</h2>
            </div>
            
            <div className="bg-background rounded-lg p-6 space-y-2">
              <p className="text-muted-foreground font-semibold">סיבת דחייה:</p>
              <p className="text-foreground text-lg">
                {/* This will be populated by the backend */}
                טוען...
              </p>
            </div>
          </div>

          {/* Back Button */}
          <button
            onClick={() => navigate("/dashboard")}
            className="w-full bg-primary hover:bg-secondary text-primary-foreground py-4 rounded-lg transition-colors duration-200 shadow-md hover:shadow-lg font-semibold"
          >
            חזור לדף הבית
          </button>
        </div>
      </div>
    </div>
  );
}
