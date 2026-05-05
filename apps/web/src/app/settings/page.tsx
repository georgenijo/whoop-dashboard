import { cookies } from "next/headers";
import { getThemeCookie } from "@/app/theme-cookie";
import ClassicSettings from "./ClassicSettings";
import AtelierSettings from "./AtelierSettings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const theme = getThemeCookie(cookieStore);
  return (
    <>
      <div className="classic-settings"><ClassicSettings /></div>
      <div className="atelier-settings"><AtelierSettings initialTheme={theme} /></div>
    </>
  );
}
