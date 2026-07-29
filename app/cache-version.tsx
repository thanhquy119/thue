"use client";

import { useEffect } from "react";

const CACHE_VERSION_KEY = "thue-ro-cache-version";
const CURRENT_CACHE_VERSION = "2026-07-29-pwa-qr-camera-v3";

export default function CacheVersion() {
  useEffect(() => {
    if (window.sessionStorage.getItem(CACHE_VERSION_KEY) === CURRENT_CACHE_VERSION) return;

    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith("thue-ro-search-")) window.sessionStorage.removeItem(key);
    }
    window.sessionStorage.setItem(CACHE_VERSION_KEY, CURRENT_CACHE_VERSION);
  }, []);

  useEffect(() => {
    const footerBrand = document.querySelector<HTMLAnchorElement>("footer > a.brand");
    if (!footerBrand) return;
    footerBrand.href = "/transfer";
    footerBrand.className = "footerTransferButton";
    footerBrand.setAttribute("aria-label", "Chuyển file giữa điện thoại và laptop");
    footerBrand.textContent = "↗ Chuyển file giữa thiết bị";
  }, []);

  return null;
}
