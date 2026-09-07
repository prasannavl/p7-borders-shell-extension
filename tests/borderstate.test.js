import { computeBorderState } from "../common/border.js";
import { assertEquals } from "./assert.js";

function windowState(overrides = {}) {
  return {
    box: { width: 820, height: 640 },
    frame: { x: 110, y: 120, width: 800, height: 600 },
    buffer: { x: 100, y: 100, width: 820, height: 640 },
    workarea: { x: 0, y: 0, width: 1920, height: 1080 },
    maximize: {
      any: false,
      full: false,
      horizontal: false,
      vertical: false,
    },
    isFullscreen: false,
    isFocused: true,
    ...overrides,
  };
}

function config(overrides = {}) {
  return {
    enabled: true,
    maximizedBorder: true,
    width: 3,
    margins: { top: 2, right: 3, bottom: 4, left: 5 },
    radius: { tl: 10, tr: 11, br: 12, bl: 13 },
    activeColor: "active",
    inactiveColor: "inactive",
    ...overrides,
  };
}

Deno.test("floating windows use frame geometry inside the actor buffer", () => {
  assertEquals(computeBorderState(windowState(), config()), {
    visible: true,
    borderWidths: { top: 3, right: 3, bottom: 3, left: 3 },
    borderColor: "active",
    radius: { tl: 10, tr: 11, br: 12, bl: 13 },
    pos: { x: 2, y: 15 },
    size: { width: 814, height: 612 },
  });
});

Deno.test("unfocused windows use the inactive color", () => {
  const state = computeBorderState(
    windowState({ isFocused: false }),
    config(),
  );
  assertEquals(state.borderColor, "inactive");
});

Deno.test("touching edges suppresses their margins and joined corners", () => {
  const state = computeBorderState(
    windowState({
      frame: { x: 1, y: 2, width: 800, height: 600 },
      buffer: { x: -9, y: -18, width: 820, height: 640 },
    }),
    config(),
  );
  assertEquals(state.borderWidths, { top: 0, right: 3, bottom: 3, left: 0 });
  assertEquals(state.radius, { tl: 0, tr: 0, br: 12, bl: 0 });
  assertEquals(state.pos, { x: 10, y: 20 });
  assertEquals(state.size, { width: 806, height: 607 });
});

Deno.test("one hidden edge squares both corners on that edge", () => {
  const state = computeBorderState(
    windowState({
      frame: { x: 110, y: 1, width: 800, height: 600 },
      buffer: { x: 100, y: -19, width: 820, height: 640 },
    }),
    config(),
  );
  assertEquals(state.borderWidths, { top: 0, right: 3, bottom: 3, left: 3 });
  assertEquals(state.radius, { tl: 0, tr: 0, br: 12, bl: 13 });
  assertEquals(state.pos, { x: 2, y: 20 });
});

Deno.test("right edge suppression removes its margin and corner radii", () => {
  const state = computeBorderState(
    windowState({
      frame: { x: 1120, y: 120, width: 800, height: 600 },
      buffer: { x: 1110, y: 100, width: 820, height: 640 },
    }),
    config(),
  );
  assertEquals(state.borderWidths, { top: 3, right: 0, bottom: 3, left: 3 });
  assertEquals(state.radius, { tl: 10, tr: 0, br: 0, bl: 13 });
  assertEquals(state.size, { width: 808, height: 612 });
});

Deno.test("border width controls the edge detection tolerance", () => {
  const state = computeBorderState(
    windowState({
      frame: { x: 5, y: 120, width: 800, height: 600 },
    }),
    config({ width: 5 }),
  );
  assertEquals(state.borderWidths.left, 0);
});

Deno.test("partial maximization keeps allowed sides but removes radii", () => {
  const state = computeBorderState(
    windowState({
      frame: { x: 100, y: 0, width: 800, height: 1080 },
      buffer: { x: 90, y: -20, width: 820, height: 1120 },
      maximize: {
        any: true,
        full: false,
        horizontal: false,
        vertical: true,
      },
    }),
    config(),
  );
  assertEquals(state.borderWidths, { top: 0, right: 3, bottom: 0, left: 3 });
  assertEquals(state.radius, { tl: 0, tr: 0, br: 0, bl: 0 });
  assertEquals(state.pos, { x: 2, y: 20 });
  assertEquals(state.size, { width: 814, height: 1080 });
});

Deno.test("a window touching every edge has no visible border", () => {
  assertEquals(
    computeBorderState(
      windowState({
        frame: { x: 0, y: 0, width: 1920, height: 1080 },
        buffer: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
      config(),
    ),
    { visible: false },
  );
});

Deno.test("maximized borders can be disabled by policy", () => {
  const maximize = {
    any: true,
    full: false,
    horizontal: false,
    vertical: true,
  };
  assertEquals(
    computeBorderState(
      windowState({ maximize }),
      config({ maximizedBorder: false }),
    ),
    { visible: false },
  );
});

for (
  const [name, stateOverrides, configOverrides] of [
    ["missing workarea", { workarea: null }, {}],
    ["fullscreen window", { isFullscreen: true }, {}],
    [
      "fully maximized window",
      { maximize: { any: true, full: true, horizontal: true, vertical: true } },
      {},
    ],
    ["disabled config", {}, { enabled: false }],
    ["zero border width", {}, { width: 0 }],
  ]
) {
  Deno.test(`${name} hides the border`, () => {
    assertEquals(
      computeBorderState(windowState(stateOverrides), config(configOverrides)),
      { visible: false },
    );
  });
}

Deno.test("zero radius remains square", () => {
  const state = computeBorderState(
    windowState(),
    config({ radius: { tl: 0, tr: 0, br: 0, bl: 0 } }),
  );
  assertEquals(state.radius, { tl: 0, tr: 0, br: 0, bl: 0 });
});

Deno.test("missing buffer geometry falls back to actor allocation", () => {
  const state = computeBorderState(
    windowState({
      box: { width: 50, height: 40 },
      frame: { x: 200, y: 200, width: 800, height: 600 },
      buffer: null,
    }),
    config({
      width: 1,
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
    }),
  );
  assertEquals(state.pos, { x: -1, y: -1 });
  assertEquals(state.size, { width: 52, height: 42 });
});

Deno.test("invalid geometry and extreme negative margins are bounded", () => {
  assertEquals(
    computeBorderState(
      windowState({ frame: { x: 10, y: 10, width: 0, height: 10 } }),
      config(),
    ),
    { visible: false },
  );

  const state = computeBorderState(
    windowState({ box: { width: 10, height: 10 }, buffer: null }),
    config({
      width: 1,
      margins: { top: -20, right: -20, bottom: -20, left: -20 },
    }),
  );
  assertEquals(state.size, { width: 1, height: 1 });
});
