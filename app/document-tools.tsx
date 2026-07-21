"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type DocumentSearchResult = {
  id: string;
  title: string;
  snippet: string;
  score: number;
  element: HTMLButtonElement;
};

const STOP_WORDS = new Set([
  "a",
  "bi",
  "cac",
  "cai",
  "cho",
  "co",
  "cua",
  "da",
  "dang",
  "de",
  "den",
  "duoc",
  "gi",
  "hay",
  "la",
  "mot",
  "nay",
  "nhung",
  "o",
  "theo",
  "thi",
  "trong",
  "tu",
  "va",
  "ve",
  "voi",
]);

function normalizeVietnamese(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getQueryTerms(value: string) {
  const normalized = normalizeVietnamese(value);
  const meaningful = normalized
    .split(" ")
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));

  return meaningful.length ? [...new Set(meaningful)] : normalized ? [normalized] : [];
}

function differsByAtMostOne(left: string, right: string) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;

  let leftIndex = 0;
  let rightIndex = 0;
  let differences = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    differences += 1;
    if (differences > 1) return false;

    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }

  if (leftIndex < left.length || rightIndex < right.length) differences += 1;
  return differences <= 1;
}

function findTermMatch(term: string, normalizedText: string, words: string[]) {
  if (normalizedText.includes(term)) return "exact" as const;
  if (term.length < 4) return null;

  const fuzzy = words.some((word) => {
    if (word.length < 4 || Math.abs(word.length - term.length) > 1) return false;
    return differsByAtMostOne(term, word);
  });

  return fuzzy ? ("fuzzy" as const) : null;
}

function createSnippet(text: string, terms: string[]) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const matchIndex = words.findIndex((word) => {
    const normalizedWord = normalizeVietnamese(word);
    return terms.some((term) => normalizedWord.includes(term) || (term.length >= 4 && differsByAtMostOne(term, normalizedWord)));
  });

  const start = Math.max(0, (matchIndex < 0 ? 0 : matchIndex) - 12);
  const end = Math.min(words.length, start + 34);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < words.length ? "…" : "";
  return `${prefix}${words.slice(start, end).join(" ")}${suffix}`;
}

function searchDocument(query: string) {
  const normalizedQuery = normalizeVietnamese(query);
  const terms = getQueryTerms(query);
  if (!normalizedQuery || !terms.length) return [];

  const results: DocumentSearchResult[] = [];
  const provisions = document.querySelectorAll<HTMLElement>(".readerText .legalProvision");

  provisions.forEach((provision, provisionIndex) => {
    const title = provision.querySelector("h4")?.textContent?.replace(/\s+/g, " ").trim() || `Phần ${provisionIndex + 1}`;
    const normalizedTitle = normalizeVietnamese(title);
    const blocks = provision.querySelectorAll<HTMLButtonElement>(".legalBlock");

    blocks.forEach((element, blockIndex) => {
      const text = element.textContent?.replace(/\s+/g, " ").trim() || "";
      if (!text) return;

      const normalizedText = normalizeVietnamese(text);
      const combined = `${normalizedTitle} ${normalizedText}`.trim();
      const words = combined.split(" ");
      const phraseMatch = combined.includes(normalizedQuery);
      let matchedTerms = 0;
      let score = phraseMatch ? 120 : 0;

      terms.forEach((term) => {
        if (normalizedTitle.includes(term)) {
          matchedTerms += 1;
          score += 30;
          return;
        }

        const match = findTermMatch(term, normalizedText, words);
        if (match === "exact") {
          matchedTerms += 1;
          score += 16;
        } else if (match === "fuzzy") {
          matchedTerms += 1;
          score += 8;
        }
      });

      const coverage = matchedTerms / terms.length;
      const minimumCoverage = terms.length <= 2 ? 1 : 0.5;
      if (!phraseMatch && coverage < minimumCoverage) return;

      score += coverage * 50;
      if (normalizedText.startsWith(normalizedQuery)) score += 20;

      results.push({
        id: `${provisionIndex}-${blockIndex}`,
        title,
        snippet: createSnippet(text, terms),
        score,
        element,
      });
    });
  });

  return results.sort((left, right) => right.score - left.score).slice(0, 10);
}

export default function DocumentTools() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DocumentSearchResult[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const syncTarget = () => {
      const next = document.querySelector<HTMLElement>(".readerHeading");
      setTarget((current) => (current === next ? current : next));
    };

    syncTarget();
    const observer = new MutationObserver(syncTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setQuery("");
    setResults([]);
    setExpanded(false);
  }, [target]);

  useEffect(() => {
    const cleanQuery = query.trim();
    if (!target || cleanQuery.length < 2) {
      setResults([]);
      setExpanded(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setResults(searchDocument(cleanQuery));
      setExpanded(true);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [query, target]);

  useEffect(() => {
    const closeWhenClickingOutside = (event: PointerEvent) => {
      const node = event.target;
      if (!(node instanceof Node)) return;
      if (!target?.querySelector(".documentSearch")?.contains(node)) setExpanded(false);
    };

    document.addEventListener("pointerdown", closeWhenClickingOutside);
    return () => document.removeEventListener("pointerdown", closeWhenClickingOutside);
  }, [target]);

  const resultLabel = useMemo(() => {
    if (!query.trim()) return "";
    if (!results.length) return "Không tìm thấy nội dung phù hợp";
    return `${results.length} kết quả phù hợp nhất`;
  }, [query, results.length]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanQuery = query.trim();
    if (cleanQuery.length < 2) return;
    setResults(searchDocument(cleanQuery));
    setExpanded(true);
  }

  function openResult(result: DocumentSearchResult) {
    document.querySelectorAll(".legalBlock.searchTarget").forEach((element) => element.classList.remove("searchTarget"));
    if (!result.element.isConnected) return;

    result.element.classList.add("searchTarget");
    result.element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    setExpanded(false);

    window.setTimeout(() => result.element.classList.remove("searchTarget"), 2800);
  }

  if (!target) return null;

  return createPortal(
    <div className="documentSearch">
      <form className="documentSearchForm" onSubmit={submitSearch} role="search">
        <label className="srOnly" htmlFor="document-search">Tìm nội dung trong văn bản</label>
        <input
          id="document-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => {
            if (query.trim().length >= 2) setExpanded(true);
          }}
          placeholder="Tìm trong văn bản…"
          autoComplete="off"
          enterKeyHint="search"
        />
        <button type="submit">Tìm</button>
      </form>

      {expanded ? (
        <section className="documentSearchResults" aria-live="polite">
          <p className="documentSearchStatus">{resultLabel}</p>
          {results.length ? (
            <div className="documentSearchList">
              {results.map((result) => (
                <button type="button" key={result.id} onClick={() => openResult(result)}>
                  <strong>{result.title}</strong>
                  <span>{result.snippet}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="documentSearchEmpty">Thử nhập cụm từ ngắn hơn hoặc dùng cách diễn đạt khác.</p>
          )}
        </section>
      ) : null}
    </div>,
    target,
  );
}
