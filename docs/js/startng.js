// start.ng player connection (https://start.ng/docs.md, "Talk to start.ng").
// Works only when the game is served from *.start.ng. Anywhere else there is
// no player, and the game plays as a guest with the local default look.

const START_NG = "https://start.ng";

export const onStartNg = () => location.hostname.endsWith(".start.ng");

let frame;

function connectFrame() {
  frame ??= new Promise((resolve, reject) => {
    const el = document.createElement("iframe");
    el.src = `${START_NG}/connect`;
    el.hidden = true;
    el.onload = () => resolve(el);
    el.onerror = reject;
    document.body.append(el);
  });
  return frame;
}

// Sends a message and resolves to start.ng's reply, or null if it didn't answer.
async function askStartNg(message, replyType, timeoutMs = 5000) {
  if (!onStartNg()) return null;
  let el;
  try {
    el = await connectFrame();
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const done = (reply) => {
      clearTimeout(timer);
      removeEventListener("message", onMessage);
      resolve(reply);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    function onMessage(e) {
      if (e.origin !== START_NG || e.source !== el.contentWindow) return;
      if (e.data?.type === replyType && e.data.requestId === requestId) done(e.data);
    }
    addEventListener("message", onMessage);
    el.contentWindow.postMessage({ ...message, requestId }, START_NG);
  });
}

/**
 * Who is playing. Resolves to
 * { signedIn, name, account, style, face } where style/face may be null
 * (the renderer then uses its own defaults).
 */
export async function whoIsPlaying() {
  const reply = await askStartNg({ type: "startng:whoami" }, "startng:user");
  const user = reply?.user;
  const player = user ?? reply?.guest;
  return {
    signedIn: Boolean(user),
    name: player?.name ?? "Guest",
    account: user?.account ?? null,
    style: player?.style ?? null,
    face: player?.face ?? null,
  };
}

export function signInUrl() {
  return `${START_NG}/?return_to=${encodeURIComponent(location.origin + location.pathname)}`;
}

// Ask again when the player comes back to the tab: they may have signed in or out.
export function watchPlayer(onChange) {
  const refresh = () => whoIsPlaying().then(onChange);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  addEventListener("focus", refresh);
  return refresh();
}
