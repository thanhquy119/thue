"use client";

import { useEffect } from "react";

const CACHE_VERSION_KEY = "thue-ro-cache-version";
const CURRENT_CACHE_VERSION = "2026-07-22-tax-regression-v1";

export default function CacheVersion() {
  useEffect(() => {
    if (window.sessionStorage.getItem(CACHE_VERSION_KEY) === CURRENT_CACHE_VERSION) return;

    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith("thue-ro-search-")) window.sessionStorage.removeItem(key);
    }
    window.sessionStorage.setItem(CACHE_VERSION_KEY, CURRENT_CACHE_VERSION);
  }, []);

  return null;
}
