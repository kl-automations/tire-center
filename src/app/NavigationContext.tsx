import { createContext, useContext, useState } from "react";
import type { PlateType } from "./components/LicensePlate";
import { Login } from "./components/Login";
import { Dashboard } from "./components/Dashboard";
import { DeclinedRequest } from "./components/DeclinedRequest";
import { AcceptedRequest } from "./components/AcceptedRequest";
import { CaroolCheck } from "./components/CaroolCheck";
import { OpenRequests } from "./components/OpenRequests";
import { RequestDetail } from "./components/RequestDetail";
import { RequestHistory } from "./components/RequestHistory";
import { HistoryDetail } from "./components/HistoryDetail";

export type Screen =
  | { name: "login" }
  | { name: "dashboard" }
  | { name: "accepted-request"; plate: string; plateType: PlateType }
  | { name: "declined-request"; plate: string; plateType: PlateType; reason?: string }
  | { name: "carool-check"; plate: string; plateType: PlateType }
  | { name: "open-requests" }
  | { name: "request-detail"; id: string }
  | { name: "history" }
  | { name: "history-detail"; id: string };

interface NavigationContextValue {
  screen: Screen;
  navigate: (screen: Screen) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigation must be used within NavigationProvider");
  return ctx;
}

function ScreenRenderer({ screen }: { screen: Screen }) {
  switch (screen.name) {
    case "login":            return <Login />;
    case "dashboard":        return <Dashboard />;
    case "accepted-request": return <AcceptedRequest />;
    case "declined-request": return <DeclinedRequest />;
    case "carool-check":     return <CaroolCheck />;
    case "open-requests":    return <OpenRequests />;
    case "request-detail":   return <RequestDetail />;
    case "history":          return <RequestHistory />;
    case "history-detail":   return <HistoryDetail />;
  }
}

export function NavigationProvider({ children: _children }: { children?: React.ReactNode }) {
  const [screen, setScreen] = useState<Screen>({ name: "login" });

  return (
    <NavigationContext.Provider value={{ screen, navigate: setScreen }}>
      <ScreenRenderer screen={screen} />
    </NavigationContext.Provider>
  );
}
