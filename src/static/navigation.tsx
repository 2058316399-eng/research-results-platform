import type { AnchorHTMLAttributes } from "react";

/** Vite injects this base consistently for production and local previews. */
export const siteBase = import.meta.env.BASE_URL;

export function assetUrl(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  return `${siteBase}${path.slice(1)}`;
}

export function pageUrl(path: string): string {
  const resolved = assetUrl(path);
  if (!path.startsWith("/") || path.startsWith("//")) return resolved;
  const [pathname, suffix = ""] = resolved.split(/(?=[?#])/s, 2);
  return `${pathname.endsWith("/") ? pathname : `${pathname}/`}${suffix}`;
}

export function SiteLink({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} href={href ? pageUrl(href) : href} />;
}
