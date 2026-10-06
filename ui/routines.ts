import { mount, unmount } from "svelte";
import type { RoutinesUiContext } from "./host";
import Routines from "./Routines.svelte";

/** PlaneAI mounts this into the Routines main pane, opened from Cmd+K. */
const entrypoint = {
  mount(root: HTMLElement, context: RoutinesUiContext): () => void {
    const app = mount(Routines, { target: root, props: { context } });
    return () => void unmount(app);
  },
};

export default entrypoint;
