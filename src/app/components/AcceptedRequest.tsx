import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowRight } from "lucide-react";
import { CarVisualization } from "./CarVisualization";
import { TirePopup, type WheelData } from "./TirePopup";

function getStoredAffectedWheels(plate: string): Record<string, WheelData> {
  try {
    const raw = sessionStorage.getItem(`affected-wheels-${plate}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function storeAffectedWheel(plate: string, wheel: string, data: WheelData) {
  const current = getStoredAffectedWheels(plate);
  current[wheel] = data;
  sessionStorage.setItem(`affected-wheels-${plate}`, JSON.stringify(current));
}

export function AcceptedRequest() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const licensePlate = searchParams.get("plate") || "";
  const [frontAlignment, setFrontAlignment] = useState(false);
  const [selectedWheel, setSelectedWheel] = useState<string | null>(null);
  const [popupWheel, setPopupWheel] = useState<string | null>(null);
  const [affectedWheels, setAffectedWheels] = useState<Record<string, WheelData>>(
    () => getStoredAffectedWheels(licensePlate)
  );

  const handleWheelClick = (wheelPosition: string) => {
    setSelectedWheel(wheelPosition);
    setPopupWheel(wheelPosition);
  };

  const handlePopupSubmit = (wheel: string, data: WheelData) => {
    storeAffectedWheel(licensePlate, wheel, data);
    setAffectedWheels((prev) => ({ ...prev, [wheel]: data }));
  };

  return (
    <div className="min-h-screen bg-background flex flex-col" dir="rtl">
      {/* Header */}
      <div className="bg-primary p-4 shadow-md">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
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
      <div className="flex-1 p-4 pb-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto space-y-6">
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
                  <div className="text-white text-[6px] sm:text-[8px] leading-tight">isperael</div>
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

          {/* Car View with Clickable Wheels */}
          <div className="bg-card rounded-2xl p-6 shadow-md border border-border">
            <h3 className="text-lg font-semibold text-foreground mb-6 text-center">בחר גלגל</h3>
            
            {/* Responsive SVG Car Visualization */}
            <div className="relative w-full max-w-3xl mx-auto">
              <CarVisualization
                onWheelClick={handleWheelClick}
                selectedWheel={selectedWheel}
                affectedWheels={new Set(Object.keys(affectedWheels))}
                frontTireSize="205/55R16"
                rearTireSize="225/45R17"
              />
            </div>
          </div>

          {/* Front Alignment Switch */}
          <div className="bg-card rounded-2xl p-6 shadow-md border border-border">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold text-foreground">כיוון פרונט</span>
              <button
                dir="ltr"
                onClick={() => setFrontAlignment(!frontAlignment)}
                className={`relative inline-flex h-10 w-20 items-center rounded-full transition-colors duration-300 ${
                  frontAlignment ? 'bg-primary dark:bg-blue-500' : 'bg-muted'
                }`}
              >
                <span
                  className={`inline-block h-8 w-8 rounded-full bg-white shadow-lg transition-transform duration-300 ${
                    frontAlignment ? 'translate-x-[4px]' : 'translate-x-[44px]'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Continue Button */}
          <button
            onClick={() => navigate("/dashboard")}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-4 rounded-xl transition-colors duration-200 shadow-lg hover:shadow-xl font-semibold text-lg"
          >
            המשך
          </button>
        </div>
      </div>

      <TirePopup
        isOpen={popupWheel !== null}
        onClose={() => setPopupWheel(null)}
        wheelPosition={popupWheel || ""}
        licensePlate={licensePlate}
        onSubmit={handlePopupSubmit}
      />
    </div>
  );
}