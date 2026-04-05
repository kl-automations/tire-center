import { useState } from "react";
import { useNavigate } from "react-router";
import { X } from "lucide-react";

interface LicensePlateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LicensePlateModal({ isOpen, onClose }: LicensePlateModalProps) {
  const navigate = useNavigate();
  const [licensePlate, setLicensePlate] = useState("");

  const handleContinue = () => {
    if (licensePlate.trim()) {
      // Check if the license plate is the hardcoded failing number
      if (licensePlate === "12345678") {
        // Navigate to declined request page
        navigate(`/request/declined?plate=${licensePlate}`);
      } else {
        // Navigate to accepted request page
        navigate(`/request/accepted?plate=${licensePlate}`);
      }
      onClose();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow only numbers and Hebrew letters, limit length
    const value = e.target.value.toUpperCase().slice(0, 8);
    setLicensePlate(value);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" dir="rtl">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-card rounded-2xl shadow-2xl p-8 w-full max-w-2xl mx-4 border border-border">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 left-4 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-6 h-6" />
        </button>

        {/* Content */}
        <div className="text-center space-y-6">
          <div>
            <h2 className="text-2xl text-foreground mb-2">פנייה חדשה</h2>
            <p className="text-muted-foreground">הזן מספר רישוי של הרכב</p>
          </div>

          {/* License Plate Input */}
          <div className="flex justify-center px-4">
            <div className="w-full max-w-lg">
              {/* Israeli License Plate Style */}
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
                  <div className="text-white text-[6px] sm:text-[8px] leading-tight">ישראל</div>
                </div>
                
                {/* Yellow Plate Number Section */}
                <div className="flex-1 h-full flex items-center justify-center px-3 sm:px-6">
                  <input
                    type="text"
                    value={licensePlate}
                    onChange={handleInputChange}
                    placeholder="12-345-67"
                    className="w-full bg-transparent text-center text-3xl sm:text-5xl font-bold text-black outline-none placeholder:text-black/30 tracking-widest"
                    style={{ fontFamily: 'monospace' }}
                    autoFocus
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Continue Button */}
          <button
            onClick={handleContinue}
            disabled={!licensePlate.trim()}
            className="w-full bg-primary hover:bg-secondary text-primary-foreground py-3 rounded-lg transition-colors duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary"
          >
            המשך
          </button>
        </div>
      </div>
    </div>
  );
}