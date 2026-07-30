"use client";

import { useEffect } from "react";

type StandaloneNavigator = Navigator & { standalone?: boolean };

function standalonePwa() {
  const navigatorWithStandalone = navigator as StandaloneNavigator;
  return window.matchMedia?.("(display-mode: standalone)").matches === true ||
    navigatorWithStandalone.standalone === true ||
    document.referrer.startsWith("android-app://");
}

export default function PwaContextEnhancer() {
  useEffect(() => {
    const media = window.matchMedia?.("(display-mode: standalone)");
    const apply = () => {
      const standalone = standalonePwa();
      const shell = document.querySelector<HTMLElement>(".transferShell");
      shell?.classList.toggle("transferStandalonePwa", standalone);
      const heading = document.querySelector<HTMLElement>(".transferHero h1");
      if (heading) {
        heading.setAttribute(
          "aria-label",
          standalone ? "Gửi file sang máy tính." : "Gửi file sang điện thoại.",
        );
      }
    };

    apply();
    media?.addEventListener?.("change", apply);
    document.addEventListener("visibilitychange", apply);
    window.addEventListener("pageshow", apply);
    return () => {
      media?.removeEventListener?.("change", apply);
      document.removeEventListener("visibilitychange", apply);
      window.removeEventListener("pageshow", apply);
    };
  }, []);

  return null;
}
