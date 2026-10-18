// Turns engine events into animation. The engine has already decided what
// happened; this only shows it. Input stays locked while the queue plays.

import { START_POINT, squareCenter } from "./engine/court.js";
import { THROW_ORIGIN } from "./engine/game.js";

const lerp = (a, b, p) => a + (b - a) * p;
const easeOut = (p) => 1 - (1 - p) * (1 - p);

const GREEN = "rgba(47,158,68,A)";
const RED = "rgba(224,49,49,A)";

// Voice lines, as playful text bubbles.
const FAIL_LINES = {
  line_stone: "No match line o!",
  line: "No match line o!",
  miss: "Try again",
  stone_square: "Na there stone dey o!",
  sequence: "Wrong way o!",
  balance: "You don fall o!",
};

const spot = (at) => (at === "start" ? { x: START_POINT.x, y: START_POINT.y } : stand(squareCenter(at)));
// Feet a little toward the near edge so the body sits in the square.
const stand = (c) => ({ x: c.x, y: c.y - 0.15 });

export function createDirector({ style, say, onFlash }) {
  const view = {
    hint: null,
    stone: { x: THROW_ORIGIN.x, y: THROW_ORIGIN.y, h: 0 },
    flash: null,
    aim: null,
    hero: {
      x: START_POINT.x,
      y: START_POINT.y,
      style,
      pose: { back: true, oneLeg: false, lift: 0, bend: 0, tilt: 0, hold: false, facing: 1 },
    },
  };
  const pose = view.hero.pose;
  const queue = [];
  let cur = null;
  let carry = null; // end time of the task that just finished

  const wait = (dur) => ({ dur, run() {} });

  function resetPose() {
    Object.assign(pose, { back: true, oneLeg: false, lift: 0, bend: 0, tilt: 0, hold: false, facing: 1 });
  }

  function home() {
    resetPose();
    view.hero.x = START_POINT.x;
    view.hero.y = START_POINT.y;
    view.stone = { x: THROW_ORIGIN.x, y: THROW_ORIGIN.y, h: 0 };
  }

  function hopTask(to, skip) {
    const target = spot(to);
    let from;
    return {
      dur: skip ? 480 : 380,
      start() {
        from = { x: view.hero.x, y: view.hero.y };
        pose.oneLeg = true;
      },
      run(p) {
        view.hero.x = lerp(from.x, target.x, p);
        view.hero.y = lerp(from.y, target.y, p);
        pose.lift = Math.sin(Math.PI * p) * (skip ? 26 : 16);
      },
      end() {
        pose.lift = 0;
        view.hero.x = target.x;
        view.hero.y = target.y;
        if (to === "start") pose.oneLeg = false;
      },
    };
  }

  function play(events) {
    for (const e of events) {
      switch (e.type) {
        case "throw": {
          queue.push({
            dur: 650,
            run(p) {
              view.stone = {
                x: lerp(e.from.x, e.to.x, p),
                y: lerp(e.from.y, e.to.y, p),
                h: Math.sin(Math.PI * p) * 120,
              };
            },
            end() {
              view.stone = { x: e.to.x, y: e.to.y, h: 0 };
              if (e.square) onFlash({ square: e.square, color: e.hit ? GREEN : RED });
            },
          });
          if (e.hit) queue.push({ dur: 1, run() {}, end: () => say("Oya, hop!") });
          break;
        }
        case "hop":
          queue.push(hopTask(e.to, e.skip));
          break;
        case "turn": {
          let flipped = false;
          queue.push({
            dur: 450,
            run(p) {
              pose.facing = Math.abs(Math.cos(Math.PI * p)) || 0.02;
              if (p >= 0.5 && !flipped) {
                flipped = true;
                pose.back = false;
              }
            },
            end() {
              pose.facing = 1;
            },
          });
          break;
        }
        case "pickup": {
          let taken = false;
          queue.push({
            dur: 800,
            run(p) {
              pose.bend = Math.sin(Math.PI * p);
              if (p >= 0.5 && !taken) {
                taken = true;
                view.stone = null;
                pose.hold = true;
              }
            },
            end() {
              pose.bend = 0;
              say("Stone don enter hand!");
            },
          });
          break;
        }
        case "fail": {
          const at = e.at;
          if (at) {
            const target = stand(at);
            let from;
            queue.push({
              dur: 280,
              start() {
                from = { x: view.hero.x, y: view.hero.y };
                pose.oneLeg = true;
              },
              run(p) {
                view.hero.x = lerp(from.x, target.x, p);
                view.hero.y = lerp(from.y, target.y, p);
                pose.lift = Math.sin(Math.PI * p) * 12;
              },
              end() {
                pose.lift = 0;
              },
            });
          }
          const dir = at && at.x > 1 ? -1 : 1;
          queue.push({
            dur: 520,
            start() {
              say(FAIL_LINES[e.reason] ?? "Try again");
              pose.oneLeg = false;
            },
            run(p) {
              pose.tilt = dir * 0.9 * easeOut(p);
            },
          });
          queue.push(wait(450));
          break;
        }
        case "course_done":
          queue.push({
            dur: 350,
            run() {},
            end() {
              resetPose();
              view.stone = { x: THROW_ORIGIN.x, y: THROW_ORIGIN.y, h: 0 };
            },
          });
          break;
        case "advance":
          queue.push({ dur: 500, run() {}, start: () => say(`Correct! Next: square ${e.to}`) });
          break;
        case "circuit":
          queue.push({
            dur: 700,
            run() {},
            start: () => say("All 12 squares done! Round complete"),
          });
          break;
        case "turn_end":
          queue.push({
            dur: 300,
            run() {},
            end() {
              home();
              say("Oya, your turn");
            },
          });
          break;
      }
    }
  }

  function update(now) {
    for (let guard = 0; guard < 8; guard++) {
      if (!cur) {
        cur = queue.shift();
        if (!cur) return;
        cur.t0 = carry ?? now;
        carry = null;
        cur.start?.();
      }
      const p = Math.min(1, (now - cur.t0) / cur.dur);
      cur.run(p);
      if (p < 1) return;
      cur.end?.();
      const finished = cur;
      cur = null;
      // Carry time over so a late frame does not stretch the whole sequence.
      if (queue.length) carry = Math.min(now, finished.t0 + finished.dur);
    }
  }

  return {
    view,
    play,
    update,
    get busy() {
      return Boolean(cur) || queue.length > 0;
    },
    home,
    // Put the picture where saved state says it should be.
    sync(state) {
      resetPose();
      if (state.at === "start") return home();
      const to = spot(state.at);
      view.hero.x = to.x;
      view.hero.y = to.y;
      pose.oneLeg = true;
      pose.back = state.facing === "away";
      pose.hold = state.holding;
      view.stone = state.stone ? { x: state.stone.x, y: state.stone.y, h: 0 } : null;
    },
  };
}
