import type { RealtimeClient } from "@supabase/supabase-js";

type PhoenixLifecycle = {
  connect(params?: unknown): void;
  disconnect(callback?: () => void, code?: number, reason?: string): void;
};

export function serializeRealtimeReconnect(realtime: RealtimeClient) {
  // Phoenix's pageshow handler can connect before pagehide finishes closing
  // the old transport. Its late close event would then target the new socket.
  // The pinned SDK exposes the adapter at runtime but omits it from its types.
  const { socketAdapter } = realtime as RealtimeClient & { socketAdapter: { getSocket(): PhoenixLifecycle } };
  const socket = socketAdapter.getSocket();
  const connect = socket.connect.bind(socket), disconnect = socket.disconnect.bind(socket);
  let closing = false;
  let reconnect: (() => void) | undefined;
  const closed: (() => void)[] = [];

  socket.connect = params => {
    if (closing) reconnect = () => connect(params);
    else connect(params);
  };
  socket.disconnect = (callback, code, reason) => {
    reconnect = undefined;
    if (callback) closed.push(callback);
    if (closing) return;
    closing = true;
    disconnect(() => {
      // If teardown detached a slow socket before its close event, Phoenix
      // still needs to rejoin these same channels on the next connection.
      for (const channel of realtime.getChannels()) {
        if (channel.state === "joined" || channel.state === "joining") channel.state = "errored";
      }
      closing = false;
      const resume = reconnect;
      reconnect = undefined;
      for (const done of closed.splice(0)) done();
      resume?.();
    }, code, reason);
  };
}
