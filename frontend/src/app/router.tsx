import { useEffect } from "react";
import {
  MemoryRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { hasValidToken } from "./auth";
import { Login } from "./components/Login";
import { Dashboard } from "./components/Dashboard";
import { AcceptedRequest } from "./components/AcceptedRequest";
import { DeclinedRequest } from "./components/DeclinedRequest";
import { CaroolCheck } from "./components/CaroolCheck";
import { OpenRequests } from "./components/OpenRequests";
import { RequestDetail } from "./components/RequestDetail";

/**
 * Storage key for the most recent in-app path. Read once on boot to seed
 * the MemoryRouter so a full page reload lands the mechanic back on the
 * screen they were last on.
 */
const ROUTE_CURRENT_KEY = "route-current";

/**
 * Auth gate for any route that needs a valid JWT.
 *
 * No JWT (or an expired one) → redirect to `/`. The Login screen has its
 * own `RedirectIfAuthed` so a logged-in mechanic that lands on `/` is
 * bounced straight to `/dashboard`.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!hasValidToken()) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Mirror image of `RequireAuth` for the Login route. */
function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  if (hasValidToken()) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/**
 * Persists every route change to `route-current` so a full page reload can
 * resume the mechanic on the same screen. Mounted once inside the router.
 */
function PersistRouteOnChange() {
  const location = useLocation();
  useEffect(() => {
    try {
      sessionStorage.setItem(ROUTE_CURRENT_KEY, location.pathname + location.search);
    } catch {}
  }, [location.pathname, location.search]);
  return null;
}

function getInitialEntries(): string[] {
  try {
    const stored = sessionStorage.getItem(ROUTE_CURRENT_KEY);
    if (stored && hasValidToken()) return [stored];
  } catch {}
  return ["/"];
}

/**
 * Root router for the app.
 *
 * Uses `MemoryRouter` so the visible URL never changes. Each in-app
 * navigation pushes a fresh `history` entry via `usePhoneBackSync` so the
 * device's system back button maps onto the in-UI ← arrow.
 */
export function AppRouter() {
  return (
    <MemoryRouter initialEntries={getInitialEntries()}>
      <PersistRouteOnChange />
      <Routes>
        <Route
          path="/"
          element={
            <RedirectIfAuthed>
              <Login />
            </RedirectIfAuthed>
          }
        />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/order/:orderId"
          element={
            <RequireAuth>
              <AcceptedRequest />
            </RequireAuth>
          }
        />
        <Route
          path="/order/:orderId/declined"
          element={
            <RequireAuth>
              <DeclinedRequest />
            </RequireAuth>
          }
        />
        <Route
          path="/order/:orderId/carool/:wheel"
          element={
            <RequireAuth>
              <CaroolCheck />
            </RequireAuth>
          }
        />
        <Route
          path="/open-requests"
          element={
            <RequireAuth>
              <OpenRequests />
            </RequireAuth>
          }
        />
        <Route
          path="/open-requests/:id"
          element={
            <RequireAuth>
              <RequestDetail />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>
  );
}
