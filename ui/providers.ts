/** One of the providers PlaneAI's task form offers, from `sessions.providers`. */
export interface SessionProvider {
  key: string;
  label: string;
  auto_approve: boolean;
}

export interface SessionProviders {
  default: string;
  providers: SessionProvider[];
}

/** The provider a session gets: the routine's own, or PlaneAI's default when it names none. */
export function findProvider(list: SessionProviders | null, key: string | null): SessionProvider | undefined {
  const wanted = key ?? list?.default;
  return list?.providers.find((provider) => provider.key === wanted);
}

export function providerName(list: SessionProviders | null, key: string | null): string {
  return findProvider(list, key)?.label ?? key ?? list?.default ?? "PlaneAI's default provider";
}
