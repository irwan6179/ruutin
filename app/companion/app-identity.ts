const FALLBACK_COMPANION_APP_NAME = "Ruutin Companion";

export function companionAppName(nickname?: string | null): string {
  const cleanNickname = nickname?.normalize("NFKC").trim();
  return cleanNickname ? `Ruutin ${cleanNickname}` : FALLBACK_COMPANION_APP_NAME;
}

export function companionAppId(profileId?: string | null): string {
  return profileId ? `/companion/${encodeURIComponent(profileId)}` : "/companion";
}
