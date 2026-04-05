import React from "react";

interface LicensePlateProps {
  plateNumber: string;
  className?: string;
}

export function LicensePlate({ plateNumber, className = "" }: LicensePlateProps) {
  return (
    <div className={className}>
      <div
        className="bg-yellow-400 rounded-xl border-4 sm:border-[6px] border-black shadow-2xl flex items-center overflow-hidden w-full"
        style={{ aspectRatio: "3.8/1" }}
      >
        <div className="bg-blue-600 h-full flex flex-col items-center justify-center px-2 sm:px-4 gap-0.5 sm:gap-1 w-[20%] min-w-[60px] max-w-[80px]">
          <div className="bg-white rounded-sm p-0.5 sm:p-1 flex items-center justify-center mb-0.5 sm:mb-1">
            <svg
              className="w-6 h-4 sm:w-8 sm:h-6"
              viewBox="0 0 220 160"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect width="220" height="160" fill="white" />
              <rect width="220" height="53.33" fill="#0038b8" />
              <rect y="106.67" width="220" height="53.33" fill="#0038b8" />
              <polygon
                points="110,53.33 120,73.33 142,73.33 124,86.67 132,106.67 110,93.33 88,106.67 96,86.67 78,73.33 100,73.33"
                fill="#0038b8"
              />
            </svg>
          </div>
          <div className="text-white text-sm sm:text-xl font-bold tracking-tight">IL</div>
          <div className="text-white text-[8px] sm:text-[10px] leading-tight text-center">ישראל</div>
          <div className="text-white text-[6px] sm:text-[8px] leading-tight">ISRAEL</div>
        </div>

        <div className="flex-1 h-full flex items-center justify-center px-3 sm:px-6">
          <div
            className="text-center text-3xl sm:text-5xl font-bold text-black tracking-widest"
            style={{ fontFamily: "monospace" }}
          >
            {plateNumber}
          </div>
        </div>
      </div>
    </div>
  );
}
