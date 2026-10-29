// Browser release entry: the same components run on Home, Jobs and Visa.
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { GaryAppsDirectory, GaryAppsMenu } from "./gary-apps";

type RuntimeProps = Parameters<typeof GaryAppsMenu>[0] & { kind?: "menu" | "directory" };
let serial = 0;

export function mount(target: HTMLElement, initial: RuntimeProps) {
  const root = createRoot(target, { identifierPrefix: `gary-shared-${++serial}-` });
  let props = initial, disposed = false;
  function render() {
    const { kind, ...shared } = props;
    delete shared.renderLink;
    const Component = kind === "directory" ? GaryAppsDirectory : GaryAppsMenu;
    flushSync(() => root.render(<Component {...shared}/>));
    // Fail before the consumer hides its working local fallback.
    if (!target.firstElementChild) throw new Error("Gary Apps failed to render");
  }
  try { render(); } catch (error) { root.unmount(); throw error; }
  return {
    update(next: Partial<RuntimeProps>) { if (!disposed) { props = { ...props, ...next }; render(); } },
    unmount() { if (!disposed) { disposed = true; root.unmount(); } },
  };
}
