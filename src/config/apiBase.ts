/** API root — empty string = same origin (dev proxy or unified production deploy). */
export const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${p}` : p;
}
