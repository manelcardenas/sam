"use client";

import { useState } from "react";
import { ExternalLink, Globe } from "lucide-react";

/**
 * Renders a recipe's source URL as a clean pill — the site's favicon + bare
 * hostname (e.g. "elmundo.es") instead of the raw, often-huge URL. Opens in a
 * new tab. Returns null for anything that isn't a parseable URL.
 */
export default function SourceLink({ url }: { url: string }) {
  const [faviconOk, setFaviconOk] = useState(true);

  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }

  const favicon = `https://www.google.com/s2/favicons?domain=${host}&sz=64`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:hover:border-indigo-500 dark:hover:text-indigo-300"
    >
      {faviconOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={favicon}
          alt=""
          width={14}
          height={14}
          className="shrink-0 rounded-sm"
          onError={() => setFaviconOk(false)}
        />
      ) : (
        <Globe className="w-3.5 h-3.5 shrink-0" />
      )}
      <span className="truncate">{host}</span>
      <ExternalLink className="w-3 h-3 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
    </a>
  );
}
