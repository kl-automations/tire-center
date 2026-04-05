import { useNavigate } from "react-router";
import { ArrowRight } from "lucide-react";
import { LicensePlate } from "./LicensePlate";

export type RequestStatus = "waiting" | "approved" | "partly-approved" | "declined";

export type WheelApproval = "full" | "puncture-only" | "none";

export interface WheelWork {
  reason: string;
  puncture: boolean;
  balancing: boolean;
  sensor: boolean;
  approval: WheelApproval;
}

export interface OpenRequest {
  id: string;
  licensePlate: string;
  status: RequestStatus;
  hasUpdate: boolean;
  frontTireSize: string;
  rearTireSize: string;
  frontAlignment: boolean;
  wheels: Record<string, WheelWork>;
}

export const STATUS_CONFIG: Record<RequestStatus, { label: string; bg: string; text: string; border: string }> = {
  waiting: {
    label: "ממתין לאישור",
    bg: "bg-amber-100 dark:bg-amber-900/40",
    text: "text-amber-800 dark:text-amber-300",
    border: "border-amber-300 dark:border-amber-700",
  },
  approved: {
    label: "מאושר",
    bg: "bg-green-100 dark:bg-green-900/40",
    text: "text-green-800 dark:text-green-300",
    border: "border-green-300 dark:border-green-700",
  },
  "partly-approved": {
    label: "מאושר חלקית — ראה פירוט!",
    bg: "bg-blue-100 dark:bg-blue-900/40",
    text: "text-blue-900 dark:text-blue-300",
    border: "border-blue-400 dark:border-blue-700",
  },
  declined: {
    label: "נדחה",
    bg: "bg-red-100 dark:bg-red-900/40",
    text: "text-red-800 dark:text-red-300",
    border: "border-red-300 dark:border-red-700",
  },
};

const MOCK_REQUESTS: OpenRequest[] = [
  {
    id: "1",
    licensePlate: "12-345-67",
    status: "waiting",
    hasUpdate: false,
    frontTireSize: "205/55R16",
    rearTireSize: "205/55R16",
    frontAlignment: false,
    wheels: {
      "front-left": { reason: "סיבה 1", puncture: true, balancing: false, sensor: false, approval: "none" },
      "rear-right": { reason: "סיבה 3", puncture: false, balancing: true, sensor: false, approval: "none" },
    },
  },
  {
    id: "2",
    licensePlate: "98-765-43",
    status: "approved",
    hasUpdate: true,
    frontTireSize: "225/45R17",
    rearTireSize: "255/40R17",
    frontAlignment: true,
    wheels: {
      "front-left": { reason: "סיבה 2", puncture: false, balancing: true, sensor: true, approval: "full" },
      "front-right": { reason: "סיבה 0", puncture: true, balancing: false, sensor: false, approval: "full" },
    },
  },
  {
    id: "3",
    licensePlate: "55-123-88",
    status: "partly-approved",
    hasUpdate: true,
    frontTireSize: "195/65R15",
    rearTireSize: "195/65R15",
    frontAlignment: false,
    wheels: {
      "front-right": { reason: "סיבה 4", puncture: true, balancing: true, sensor: false, approval: "full" },
      "rear-left": { reason: "סיבה 1", puncture: true, balancing: false, sensor: true, approval: "puncture-only" },
      "rear-right": { reason: "סיבה 5", puncture: false, balancing: true, sensor: false, approval: "none" },
    },
  },
  {
    id: "4",
    licensePlate: "11-222-33",
    status: "declined",
    hasUpdate: false,
    frontTireSize: "205/55R16",
    rearTireSize: "225/45R17",
    frontAlignment: false,
    wheels: {
      "front-left": { reason: "סיבה 6", puncture: true, balancing: true, sensor: true, approval: "none" },
    },
  },
  {
    id: "5",
    licensePlate: "77-888-99",
    status: "waiting",
    hasUpdate: true,
    frontTireSize: "215/60R16",
    rearTireSize: "215/60R16",
    frontAlignment: true,
    wheels: {
      "front-left": { reason: "סיבה 0", puncture: false, balancing: true, sensor: false, approval: "none" },
      "rear-left": { reason: "סיבה 2", puncture: true, balancing: false, sensor: true, approval: "none" },
    },
  },
];

export function getStoredRequests(): OpenRequest[] {
  try {
    const raw = sessionStorage.getItem("open-requests");
    if (!raw) return MOCK_REQUESTS;
    const parsed: OpenRequest[] = JSON.parse(raw);
    if (parsed.length > 0 && (!parsed[0].wheels || (parsed[0].wheels && Object.values(parsed[0].wheels)[0] && "approved" in Object.values(parsed[0].wheels)[0]))) {
      sessionStorage.removeItem("open-requests");
      return MOCK_REQUESTS;
    }
    return parsed;
  } catch {
    return MOCK_REQUESTS;
  }
}

export function storeRequests(requests: OpenRequest[]) {
  sessionStorage.setItem("open-requests", JSON.stringify(requests));
}

function markAllSeen(requests: OpenRequest[]): OpenRequest[] {
  return requests.map((r) => ({ ...r, hasUpdate: false }));
}

export function hasOpenRequestUpdates(): boolean {
  const requests = getStoredRequests();
  return requests.some((r) => r.hasUpdate);
}

export function OpenRequests() {
  const navigate = useNavigate();
  const requests = getStoredRequests();

  // Mark all as seen when viewing the page
  const seenRequests = markAllSeen(requests);
  storeRequests(seenRequests);

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
          <h1 className="text-xl text-primary-foreground font-semibold">פניות פתוחות</h1>
          <div className="w-6" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 pb-8 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-4">
          {seenRequests.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">אין פניות פתוחות</p>
          ) : (
            seenRequests.map((request) => {
              const config = STATUS_CONFIG[request.status];
              return (
                <button
                  key={request.id}
                  onClick={() => navigate(`/request/detail/${request.id}`)}
                  className="w-full bg-card rounded-2xl p-5 shadow-md border border-border space-y-3 hover:shadow-lg hover:border-primary/30 transition-all duration-200 text-right"
                >
                  <LicensePlate plateNumber={request.licensePlate} className="w-full max-w-xs mx-auto" />
                  <div className="flex justify-center">
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${config.bg} ${config.text} border ${config.border}`}
                    >
                      {config.label}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
