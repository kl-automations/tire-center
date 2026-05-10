import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import { collection, getFirestore, onSnapshot } from "firebase/firestore";

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId?: string;
  messagingSenderId?: string;
};

function isFirebaseWebConfig(x: unknown): x is FirebaseWebConfig {
  if (!x || typeof x !== "object") return false;
  const o = x as FirebaseWebConfig;
  return (
    typeof o.apiKey === "string" &&
    typeof o.authDomain === "string" &&
    typeof o.projectId === "string"
  );
}

function getOrCreateApp(cfg: FirebaseWebConfig): FirebaseApp {
  const existing = getApps();
  if (existing.length > 0) return existing[0]!;
  return initializeApp(cfg);
}

/**
 * Signs in with a backend-minted custom token and listens to
 * `orders/{shop_id}/updates/*` (same path the ERP/Carool webhooks write).
 * Returns an unsubscribe callback, or `null` if live listeners are unavailable.
 */
export async function attachShopOrderSignalsListener(
  onUpdate: () => void,
): Promise<(() => void) | null> {
  try {
    const token = localStorage.getItem("token");
    if (!token) return null;

    const cfgRes = await fetch("/api/config");
    if (!cfgRes.ok) return null;
    const pub = await cfgRes.json();
    const fb = pub?.firebase;
    if (!isFirebaseWebConfig(fb)) return null;

    const tokRes = await fetch("/api/auth/firebase-custom-token", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (!tokRes.ok) return null;
    const body = (await tokRes.json()) as { custom_token?: string; shop_id?: string };
    if (!body.custom_token || !body.shop_id) return null;

    const firebaseApp = getOrCreateApp(fb);
    const auth = getAuth(firebaseApp);
    await signInWithCustomToken(auth, body.custom_token);
    const db = getFirestore(firebaseApp);
    const col = collection(db, "orders", body.shop_id, "updates");

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        onUpdate();
      }, 150);
    };

    const unsub = onSnapshot(
      col,
      debounced,
      () => {
        /* permission/network — polling fallback continues */
      },
    );

    return () => {
      unsub();
      if (debounce) clearTimeout(debounce);
    };
  } catch {
    return null;
  }
}

/**
 * Same auth + shop scoping as {@link attachShopOrderSignalsListener}, but listens to
 * `orders/{shop_id}/stock_availability` for stock-availability signal docs.
 * Writer side lands in a follow-up ticket; the subscription is a silent no-op until then.
 */
export async function attachShopStockAvailabilitySignalsListener(
  onUpdate: () => void,
): Promise<(() => void) | null> {
  try {
    const token = localStorage.getItem("token");
    if (!token) return null;

    const cfgRes = await fetch("/api/config");
    if (!cfgRes.ok) return null;
    const pub = await cfgRes.json();
    const fb = pub?.firebase;
    if (!isFirebaseWebConfig(fb)) return null;

    const tokRes = await fetch("/api/auth/firebase-custom-token", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (!tokRes.ok) return null;
    const body = (await tokRes.json()) as { custom_token?: string; shop_id?: string };
    if (!body.custom_token || !body.shop_id) return null;

    const firebaseApp = getOrCreateApp(fb);
    const auth = getAuth(firebaseApp);
    await signInWithCustomToken(auth, body.custom_token);
    const db = getFirestore(firebaseApp);
    const col = collection(db, "orders", body.shop_id, "stock_availability");

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        onUpdate();
      }, 150);
    };

    const unsub = onSnapshot(
      col,
      debounced,
      () => {
        /* permission/network — ignore; list refresh will ship with backend */
      },
    );

    return () => {
      unsub();
      if (debounce) clearTimeout(debounce);
    };
  } catch {
    return null;
  }
}
