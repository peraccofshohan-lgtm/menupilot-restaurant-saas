"use client";

import * as React from "react";

/**
 * Registers the service worker.
 *
 * Deliberately quiet: no install prompt, no notification, no console noise. A
 * guest at a table should never be asked a question by the restaurant's app.
 *
 * Only registers in a secure context. On a local network the app is served over
 * plain HTTP from an IP address, which browsers do not treat as secure, so the
 * worker usually does not register there — and that is fine, because the whole
 * point of a local server is that the assets come from the server anyway. The
 * worker earns its keep when the same app is installed from a hostname with
 * HTTPS, or on the development preview.
 *
 * The honest consequence, documented rather than hidden: on plain HTTP local
 * installs there is no offline cache, and the app is fully functional anyway
 * because it never needed the internet.
 */
export function ServiceWorkerRegistrar() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (!window.isSecureContext) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // A failed registration must never surface to a guest or a staff member.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
