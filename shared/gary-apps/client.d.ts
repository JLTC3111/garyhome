import type { GaryAppId, GaryLanguage } from "./catalogue";

export type GaryRuntimeProps = {
  kind?: "menu" | "directory";
  language: GaryLanguage;
  currentApp?: GaryAppId;
  className?: string;
  onFollow?: () => void;
  onOpen?: () => void;
};

export function connectGaryApps(target: HTMLElement, props: GaryRuntimeProps, options?: {
  manifestUrl?: string;
  onReady?: () => void;
  onError?: (error: unknown) => void;
  isBusy?: () => boolean;
}): { update(props: Partial<GaryRuntimeProps>): void; unmount(): void };
