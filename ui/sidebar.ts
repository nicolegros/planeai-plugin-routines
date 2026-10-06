import { mount, unmount } from "svelte";
import type { SidebarUiContext } from "./host";
import SidebarButton from "./SidebarButton.svelte";

/** PlaneAI mounts this at the top of its sidebar, under the New session and New project buttons. */
const entrypoint = {
  mount(root: HTMLElement, context: SidebarUiContext): () => void {
    const app = mount(SidebarButton, { target: root, props: { context } });
    return () => void unmount(app);
  },
};

export default entrypoint;
