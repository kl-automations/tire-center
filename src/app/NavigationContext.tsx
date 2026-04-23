import { createContext, useContext, useState } from "react";
import type { PlateType } from "./components/LicensePlate";
import { Login } from "./components/Login";
import { Dashboard } from "./components/Dashboard";
import { DeclinedRequest } from "./components/DeclinedRequest";
import { AcceptedRequest } from "./components/AcceptedRequest";
import { CaroolCheck } from "./components/CaroolCheck";
import { OpenRequests } from "./components/OpenRequests";
import { RequestDetail } from "./components/RequestDetail";

/**
 * Discriminated union of all navigable screens in the app.
 *
 * Each variant carries only the props required to render that screen.
 * Use `useNavigation().navigate(screen)` to transition between screens.
 *
 * @example
 * navigate({ name: "accepted-request", plate: "123-456", plateType: "civilian" });
 */
export type Screen =
  | { name: "login" }
  | { name: "dashboard" }
  | {
      name: "accepted-request";
      /** Vehicle licence plate string passed from the plate-lookup modal. */
      plate: string;
      plateType: PlateType;
      /** Odometer reading entered by the mechanic (string as typed). */
      mileage?: string;
    }
  | {
      name: "declined-request";
      plate: string;
      plateType: PlateType;
      /** Free-text rejection reason from the ERP (shown to the mechanic). */
      reason?: string;
    }
  | {
      name: "carool-check";
      plate: string;
      plateType: PlateType;
      /** Ordered list of wheel positions selected for Carool photo capture. */
      wheels: string[];
    }
  | { name: "open-requests" }
  | {
      name: "request-detail";
      /** UUID of the `OpenRequest` to display (matches `open_orders.id`). */
      id: string;
    };

interface NavigationContextValue {
  screen: Screen;
  navigate: (screen: Screen) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

/**
 * Hook that returns the current screen and the `navigate` function.
 *
 * Must be called inside a component that is a descendant of `NavigationProvider`.
 * Calling it outside throws a descriptive error.
 *
 * @returns `{ screen: Screen; navigate: (screen: Screen) => void }`
 */
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

/**
 * Root navigation provider that owns the current screen state.
 *
 * Wrap the entire application with this component (done in `App.tsx`).
 * Internally renders the correct screen component via `ScreenRenderer`;
 * children are accepted but ignored (the screen is the only rendered output).
 */
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
