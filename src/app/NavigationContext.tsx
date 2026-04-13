import { createContext, useContext, useState } from "react";
import type { PlateType } from "./components/LicensePlate";
import { Login } from "./components/Login";
import { Dashboard } from "./components/Dashboard";
import { DeclinedRequest } from "./components/DeclinedRequest";
import { AcceptedRequest } from "./components/AcceptedRequest";
import { CaroolCheck } from "./components/CaroolCheck";
import { OpenRequests } from "./components/OpenRequests";
import { RequestDetail } from "./components/RequestDetail";

export type Screen =
  | { name: "login" }
  | { name: "dashboard" }
  | { name: "accepted-request"; plate: string; plateType: PlateType; mileage?: string }
  | { name: "declined-request"; plate: string; plateType: PlateType; reason?: string }
  | { name: "carool-check"; plate: string; plateType: PlateType }
  | { name: "open-requests" }
  | { name: "request-detail"; id: string };

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
  }
}

export function NavigationProvider({ children: _children }: { children?: React.ReactNode }) {
  const [screen, setScreen] = useState<Screen>({ name: "login" });

  function navigate(screen: Screen) {
    window.scrollTo(0, 0);
    setScreen(screen);
  }

  return (
    <NavigationContext.Provider value={{ screen, navigate }}>
      <ScreenRenderer screen={screen} />
    </NavigationContext.Provider>
  );
}
