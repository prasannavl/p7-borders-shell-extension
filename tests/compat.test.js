import {
  applyBorderState,
  getMaximizeState,
  getWindowState,
} from "../shell/compat.js";

let passed = 0;

function assertEquals(actual, expected) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}

function test(name, callback) {
  callback();
  passed++;
  print(`ok - ${name}`);
}

function maximizeFlags(horizontal, vertical) {
  let flags = 0;
  if (horizontal) flags |= 1;
  if (vertical) flags |= 2;
  return flags;
}

test("modern maximize flags report horizontal, vertical, and full states", () => {
  assertEquals(
    getMaximizeState({
      get_maximize_flags: () => maximizeFlags(true, false),
    }),
    { any: true, full: false, horizontal: true, vertical: false },
  );
  assertEquals(
    getMaximizeState({
      get_maximize_flags: () => maximizeFlags(true, true),
    }),
    { any: true, full: true, horizontal: true, vertical: true },
  );
});

test("legacy maximize properties are used when flags are unavailable", () => {
  assertEquals(
    getMaximizeState({
      maximized_horizontally: false,
      maximized_vertically: true,
    }),
    { any: true, full: false, horizontal: false, vertical: true },
  );
});

test("zero modern flags still honor legacy maximize properties", () => {
  assertEquals(
    getMaximizeState({
      get_maximize_flags: () => 0,
      maximized_horizontally: true,
      maximized_vertically: true,
    }),
    { any: true, full: true, horizontal: true, vertical: true },
  );
});

function windowFixture({ monitor = 0, buffer = true, focused = true } = {}) {
  const frame = { x: 10, y: 20, width: 300, height: 200 };
  const bufferRect = { x: 7, y: 14, width: 306, height: 212 };
  const workarea = { x: 0, y: 0, width: 1920, height: 1080 };
  let workareaCalls = 0;
  const metaWindow = {
    fullscreen: false,
    get_monitor: () => monitor,
    get_work_area_current_monitor: () => {
      workareaCalls++;
      return workarea;
    },
    get_frame_rect: () => frame,
    get_maximize_flags: () => 0,
  };
  if (buffer) metaWindow.get_buffer_rect = () => bufferRect;

  globalThis.global = {
    display: {
      focus_window: focused ? metaWindow : null,
      get_n_monitors: () => 2,
    },
  };

  return {
    metaWindow,
    frame,
    bufferRect,
    workarea,
    get workareaCalls() {
      return workareaCalls;
    },
  };
}

const actor = {
  get_allocation_box: () => ({ x1: 4, y1: 8, x2: 324, y2: 228 }),
};

test("window state collects current geometry and focus", () => {
  const fixture = windowFixture();
  const state = getWindowState(fixture.metaWindow, actor);
  assertEquals(state.box, { width: 320, height: 220 });
  assertEquals(state.frame, fixture.frame);
  assertEquals(state.buffer, fixture.bufferRect);
  assertEquals(state.workarea, fixture.workarea);
  assertEquals(state.isFocused, true);
  assertEquals(fixture.workareaCalls, 1);
});

test("frame geometry is the buffer fallback on older APIs", () => {
  const fixture = windowFixture({ buffer: false, focused: false });
  const state = getWindowState(fixture.metaWindow, actor);
  assertEquals(state.buffer, fixture.frame);
  assertEquals(state.isFocused, false);
});

for (const monitor of [-1, 2]) {
  test(`monitor ${monitor} produces no workarea`, () => {
    const fixture = windowFixture({ monitor });
    const state = getWindowState(fixture.metaWindow, actor);
    assertEquals(state.workarea, null);
    assertEquals(fixture.workareaCalls, 0);
  });
}

function borderFixture() {
  return {
    visible: false,
    positions: [],
    sizes: [],
    styles: [],
    set_position(x, y) {
      this.positions.push([x, y]);
    },
    set_size(width, height) {
      this.sizes.push([width, height]);
    },
    set_style(style) {
      this.styles.push(style);
    },
  };
}

function visibleState(overrides = {}) {
  return {
    visible: true,
    pos: { x: 2, y: 3 },
    size: { width: 100, height: 80 },
    borderWidths: { top: 1, right: 2, bottom: 3, left: 4 },
    radius: { tl: 5, tr: 6, br: 7, bl: 8 },
    borderColor: "rgba(1, 2, 3, 0.4)",
    ...overrides,
  };
}

test("hidden state clears visibility and the style cache", () => {
  const border = borderFixture();
  border.visible = true;
  const cache = { borderStyleCache: "old" };
  applyBorderState(border, { visible: false }, cache);
  assertEquals(border.visible, false);
  assertEquals(cache.borderStyleCache, null);
  assertEquals(border.styles, []);
});

test("visible state applies geometry and complete inline CSS", () => {
  const border = borderFixture();
  const cache = { borderStyleCache: null };
  applyBorderState(border, visibleState(), cache);

  assertEquals(border.visible, true);
  assertEquals(border.positions, [[2, 3]]);
  assertEquals(border.sizes, [[100, 80]]);
  assertEquals(border.styles, [
    "border-top-width: 1px;" +
    "border-right-width: 2px;" +
    "border-bottom-width: 3px;" +
    "border-left-width: 4px;" +
    "border-radius: 5px 6px 7px 8px;" +
    "border-style: solid;" +
    "border-color: rgba(1, 2, 3, 0.4);" +
    "background: transparent;",
  ]);
});

test("unchanged styles are cached while geometry still updates", () => {
  const border = borderFixture();
  const cache = { borderStyleCache: null };
  applyBorderState(border, visibleState(), cache);
  applyBorderState(
    border,
    visibleState({ pos: { x: 9, y: 10 } }),
    cache,
  );

  assertEquals(border.styles.length, 1);
  assertEquals(border.positions, [[2, 3], [9, 10]]);
});

test("style changes invalidate the cache", () => {
  const border = borderFixture();
  const cache = { borderStyleCache: null };
  applyBorderState(border, visibleState(), cache);
  applyBorderState(border, visibleState({ borderColor: "red" }), cache);
  assertEquals(border.styles.length, 2);
});

print(`${passed} compatibility tests passed`);
