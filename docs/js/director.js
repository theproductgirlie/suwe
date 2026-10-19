// Turns engine events into animation. The engine has already decided what
// happened; this only shows it. Input stays locked while the queue plays.

import { START_POINT, squareCenter } from "./engine/court.js";
import { THROW_ORIGIN, TIE_MARK } from "./engine/game.js";

const lerp = (a, b, p) => a + (b - a) * p;
const easeOut = (p) => 1 - (1 - p) * (1 - p);

// Voice lines, as playful text bubbles.
const FAIL_LINES = {
  line_stone: "No match line o!",
  line: "No match line o!",
  miss: "Try again!",
  stone_square: "That's the stone's square!",
  sequence: "Wrong square!",
  balance: "You lost your balance!",
  opponent_house: "That's someone's house!",
  outside: "Stay inside the court!",
};

const spot = (at) => (at === "start" ? { x: START_POINT.x, y: START_POINT.y } : stand(squareCenter(at)));
// Feet a little toward the near edge so the body sits in the square.
const stand = (c) => ({ x: c.x, y: c.y - 0.15 });

export function createDirector({ style, say, onFlash, onTurn, onOver, onHouse, onFail = () => 3000, sfx = () => {} }) {
  const view = {
    hint: null,
    stone: { x: THROW_ORIGIN.x, y: THROW_ORIGIN.y, h: 0 },
    flash: null,
    aim: null,
    houses: [],
    mark: null,
    redLine: null, // a chalk line to show in red after a foot or stone touched it: {y}
    cleared: null, // squares to tint for the player on the court: {color, squares}
    hold: null, // the ring and arc while a throw is held: set by main.js
    hero: {
      x: START_POINT.x,
      y: START_POINT.y,
      style,
      pose: { back: true, oneLeg: false, lift: 0, bend: 0, tilt: 0, hold: false, facing: 1 },
    },
  };
  const pose = view.hero.pose;
  const queue = [];
  let released = false; // the player pressed OK on the missed card
  let cur = null;
  let carry = null; // end time of the task that just finished

  const wait = (dur) => ({ dur, run() {} });

  function resetPose() {
    view.redLine = null;
    Object.assign(pose, { back: true, oneLeg: false, lift: 0, bend: 0, tilt: 0, hold: false, facing: 1 });
  }

  function home() {
    resetPose();
    view.hero.x = START_POINT.x;
    view.hero.y = START_POINT.y;
    view.stone = { x: THROW_ORIGIN.x, y: THROW_ORIGIN.y, h: 0 };
  }

  // A stone flying from the throwing spot to where it lands.
  function flightTask(to, height, dur, end) {
    return {
      dur,
      run(p) {
        view.stone = {
          x: lerp(THROW_ORIGIN.x, to.x, p),
          y: lerp(THROW_ORIGIN.y, to.y, p),
          h: Math.sin(Math.PI * p) * height,
        };
      },
      end() {
        view.stone = { x: to.x, y: to.y, h: 0 };
        end?.();
      },
    };
  }

  function faceViewer() {
    let flipped = false;
    return {
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
    };
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

  // Sounds ride along with the animation: at the start or the end of an event's first task.
  const SOUND_START = {
    throw: "throw",
    backthrow: "throw",
    tiebreak_throw: "throw",
    turn: "turn",
    course_done: "good",
    circuit: "circuit",
    house: "house",
    tiebreak_start: "drumroll",
    out: "out",
    match_over: "win",
  };
  const SOUND_END = { hop: "hop", throw: "land", backthrow: "land", tiebreak_throw: "land" };

  function tagSounds(e, before) {
    const mine = queue.slice(before);
    if (!mine.length) return;
    if (e.type === "fail") {
      // The fall: the tilt task is the second to last (a wait follows it).
      mine[Math.max(0, mine.length - 2)].sfxStart = /line/.test(e.reason) ? "buzz" : "fail";
      return;
    }
    if (SOUND_START[e.type]) mine[0].sfxStart = SOUND_START[e.type];
    if (SOUND_END[e.type]) mine[0].sfxEnd = SOUND_END[e.type];
  }

  function play(events) {
    for (const e of events) {
      const before = queue.length;
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
              if (e.square) onFlash({ square: e.square, hit: e.hit });
            },
          });
          // A short bounce, then the stone settles.
          queue.push({
            dur: 240,
            run(p) {
              view.stone = { x: e.to.x, y: e.to.y, h: Math.sin(Math.PI * p) * 26 * (1 - p) };
            },
            end() {
              view.stone = { x: e.to.x, y: e.to.y, h: 0 };
            },
          });
          if (e.hit) queue.push({ dur: 1, run() {}, end: () => say("Now hop!", { tone: "good" }) });
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
                sfx("pickup");
                view.stone = null;
                pose.hold = true;
              }
            },
            end() {
              pose.bend = 0;
              say("Stone in hand!", { tone: "good" });
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
          if (/line/.test(e.reason)) {
            // The chalk line nearest to where the child stands turns red.
            queue.push({
              dur: 1,
              run() {},
              start() {
                view.redLine = { y: Math.max(0, Math.min(6, Math.round(view.hero.y))) };
              },
            });
          }
          queue.push({
            dur: 520,
            start() {
              say(FAIL_LINES[e.reason] ?? "Try again!", {
                tone: "bad",
                speech: /line/.test(e.reason) ? "No match line o" : "Try again",
              });
              pose.oneLeg = false;
            },
            run(p) {
              pose.tilt = dir * 0.9 * easeOut(p);
            },
          });
          // The "missed" pill: onFail(e) says how many ms to show it (long enough to read).
          const gate = { dur: 3000, run() {}, gate: true };
          gate.start = () => {
            released = false;
            gate.dur = onFail(e) || 3000;
          };
          queue.push(gate);
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
          queue.push({ dur: 500, run() {}, start: () => say(`Correct! Next: square ${e.to}`, { tone: "good" }) });
          break;
        case "circuit":
          queue.push(faceViewer());
          queue.push({
            dur: 1000,
            run() {},
            start: () => say("All 12 done! Now Ra Ile: throw over your shoulder", { tone: "good" }),
          });
          break;
        case "backthrow":
          queue.push(
            flightTask(e.to, 170, 800, () => {
              if (e.square) onFlash({ square: e.square, hit: Boolean(e.claimed) });
            }),
          );
          if (!e.claimed) {
            queue.push({ dur: 1000, run() {}, start: () => say("No house this time", { tone: "bad" }), end: home });
          }
          break;
        case "house":
          queue.push({
            dur: 2400,
            run() {},
            start() {
              view.houses.push({ square: e.square, color: e.color ?? "#e03131", name: e.name });
              onHouse(e);
            },
          });
          queue.push({ dur: 200, run() {}, end: home });
          break;
        case "tiebreak_start":
          queue.push({
            dur: 1600,
            run() {},
            start() {
              view.mark = { x: TIE_MARK.x, y: TIE_MARK.y };
              say(e.round > 1 ? "Still level! Throw again" : "Tie! Closest stone to the red mark wins");
            },
            end() {
              home();
              onTurn();
            },
          });
          break;
        case "tiebreak_throw":
          queue.push(flightTask(e.to, 90, 650));
          queue.push({
            dur: 1100,
            run() {},
            start: () => say(`${e.name}: ${e.dist.toFixed(2)} from the mark`),
          });
          break;
        case "tiebreak_next":
          queue.push({
            dur: 200,
            run() {},
            end() {
              home();
              onTurn();
            },
          });
          break;
        case "out":
          queue.push({ dur: 900, run() {}, start: () => say(`${e.name} has no hearts left`, { tone: "bad" }) });
          break;
        case "match_over":
          queue.push({
            dur: 500,
            run() {},
            end() {
              view.mark = null;
              onOver(e);
            },
          });
          break;
        case "turn_end":
          queue.push({
            dur: 300,
            run() {},
            end() {
              home();
              onTurn(e.next);
            },
          });
          break;
      }
      tagSounds(e, before);
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
        if (cur.sfxStart) sfx(cur.sfxStart);
      }
      const p = cur.gate && released ? 1 : Math.min(1, (now - cur.t0) / cur.dur);
      cur.run(p);
      if (p < 1) return;
      cur.end?.();
      if (cur.sfxEnd) sfx(cur.sfxEnd);
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
    // The player pressed OK on the missed card: carry on now.
    release() {
      released = true;
    },
    // Milliseconds left on the missed card (null when it is not showing).
    gateLeft(now) {
      return cur?.gate ? Math.max(0, cur.dur - (now - cur.t0)) : 0;
    },
    // Show everything that is queued at once (used to skip the computer's turn).
    finish() {
      for (let guard = 0; guard < 600 && (cur || queue.length); guard++) {
        if (!cur) {
          cur = queue.shift();
          cur.start?.();
        }
        cur.run(1);
        cur.end?.();
        cur = null;
      }
      carry = null;
    },
    // A fresh match: no houses, no mark.
    reset() {
      view.houses = [];
      view.mark = null;
      home();
    },
    // Put the picture where saved state says it should be (resuming a saved match).
    sync(state) {
      resetPose();
      view.houses = state.owners
        .map((id, i) => {
          const p = id && state.players.find((q) => q.id === id);
          return p ? { square: i + 1, color: p.color ?? "#e03131", name: p.name } : null;
        })
        .filter(Boolean);
      view.mark = state.phase === "tiebreak" ? { x: TIE_MARK.x, y: TIE_MARK.y } : null;
      view.flash = null;
      if (state.at === "start") {
        home();
        pose.back = state.facing === "away";
      } else {
        const to = spot(state.at);
        view.hero.x = to.x;
        view.hero.y = to.y;
        pose.oneLeg = true;
        pose.back = state.facing === "away";
      }
      pose.hold = state.holding;
      if (state.stone) view.stone = { x: state.stone.x, y: state.stone.y, h: 0 };
      else if (state.holding) view.stone = null;
    },
  };
}
