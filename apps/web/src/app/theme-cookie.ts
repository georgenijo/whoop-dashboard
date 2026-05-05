export const THEME_COOKIE = "od-theme";
export type Theme = "classic" | "atelier";

export function getThemeCookie(
  cookieStore: { get: (name: string) => { value: string } | undefined }
): Theme {
  const val = cookieStore.get(THEME_COOKIE)?.value;
  return val === "atelier" ? "atelier" : "classic";
}
