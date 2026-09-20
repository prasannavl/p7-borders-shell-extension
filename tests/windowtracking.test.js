import Meta from "gi://Meta";
import { computeBorderState } from "../common/border.js";
import { applyBorderState, getWindowState } from "../shell/compat.js";

import {
  createBorderAttachment,
  isInterestingWindow,
  isLiveObject,
  runAll,
  WindowTracker,
} from "../shell/windowtracking.js";
import { assertEquals } from "./assert.js";

let passed = 0;

function test(name, callback) {
  callback();
  passed++;
  print(`ok - ${name}`);
}

function signalObject({ destroyed = false, throws = false } = {}) {
  return {
    connections: [],
    disconnections: [],
    connectObject(signal, handler, token) {
      this.connections.push({ signal, handler, token });
    },
    disconnectObject(token) {
      this.disconnections.push(token);
    },
    is_destroyed() {
      if (throws) throw new Error("disposed");
      return destroyed;
    },
    emit(signal) {
      for (const connection of this.connections) {
        if (connection.signal === signal) connection.handler();
      }
    },
  };
}

function managerFixture() {
  return {
    syncs: [],
    cleanups: [],
    isLiveWindowData(data) {
      return !!data?.live;
    },
    syncBorder(metaWindow, data) {
      this.syncs.push([metaWindow, data]);
    },
    cleanupWindow(metaWindow, data) {
      this.cleanups.push([metaWindow, data]);
    },
  };
}

let nextDeferredId = 1;
const deferredCallbacks = new Map();
const testLaters = {
  add(when, callback) {
    assertEquals(when, Meta.LaterType.BEFORE_REDRAW);
    const id = nextDeferredId++;
    deferredCallbacks.set(id, callback);
    return id;
  },
  remove(id) {
    deferredCallbacks.delete(id);
  },
};

function trackerFixture(manager = managerFixture()) {
  return new WindowTracker(manager, testLaters);
}

function drainDeferred() {
  while (deferredCallbacks.size > 0) {
    const [[id, callback]] = deferredCallbacks;
    deferredCallbacks.delete(id);
    callback();
  }
}

function drainUntil(predicate) {
  while (!predicate() && deferredCallbacks.size > 0) {
    const [[id, callback]] = deferredCallbacks;
    deferredCallbacks.delete(id);
    callback();
  }
}

function laterQueue() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    added: [],
    removed: [],
    add(when, callback) {
      const id = nextId++;
      this.added.push({ id, when });
      callbacks.set(id, callback);
      return id;
    },
    remove(id) {
      this.removed.push(id);
      callbacks.delete(id);
    },
    run() {
      const [[id, callback]] = callbacks;
      callbacks.delete(id);
      callback();
    },
  };
}

test("live object checks handle normal, destroyed, and disposed objects", () => {
  assertEquals(isLiveObject(null), false);
  assertEquals(isLiveObject({}), true);
  assertEquals(isLiveObject(signalObject()), true);
  assertEquals(isLiveObject(signalObject({ destroyed: true })), false);
  assertEquals(isLiveObject(signalObject({ throws: true })), false);
});

test("batch work continues after failures and returns the first error", () => {
  const calls = [];
  const error = runAll([
    () => {
      calls.push(1);
      throw new Error("first failure");
    },
    () => calls.push(2),
    () => {
      calls.push(3);
      throw new Error("later failure");
    },
  ]);

  assertEquals(calls, [1, 2, 3]);
  assertEquals(error?.message, "first failure");
});

function borderActor() {
  const actor = signalObject();
  actor.clip_to_allocation = true;
  actor.children = [];
  actor.add_child = (child) => {
    actor.children.push(child);
    child.parent = actor;
  };
  actor.set_child_above_sibling = () => {};
  actor.remove_child = (child) => {
    actor.children.splice(actor.children.indexOf(child), 1);
    child.parent = null;
  };
  return actor;
}

function borderFixture() {
  return {
    clip_to_allocation: true,
    parent: null,
    get_parent() {
      return this.parent;
    },
  };
}

test("border attachment lease restores the actor and removes the border", () => {
  const actor = borderActor();
  const border = borderFixture();
  const attachment = createBorderAttachment(actor, border);
  attachment.attach();
  assertEquals(actor.clip_to_allocation, false);
  assertEquals(border.clip_to_allocation, false);
  assertEquals(actor.children.length, 1);
  assertEquals(actor.children[0] === border, true);
  attachment.release();
  assertEquals(actor.clip_to_allocation, true);
  assertEquals(actor.children, []);
});

test("border attachment lease preserves a newer external clip value", () => {
  const actor = borderActor();
  const border = borderFixture();
  const attachment = createBorderAttachment(actor, border);
  attachment.attach();
  actor.clip_to_allocation = true;
  attachment.release();
  assertEquals(actor.clip_to_allocation, true);
});

test("failed border removal still restores actor clipping", () => {
  const actor = borderActor();
  const border = borderFixture();
  const attachment = createBorderAttachment(actor, border);
  attachment.attach();
  actor.remove_child = () => {
    throw new Error("removal failed");
  };

  let error = null;
  try {
    attachment.release();
  } catch (caught) {
    error = caught;
  }
  assertEquals(error?.message, "removal failed");
  assertEquals(actor.clip_to_allocation, true);
  assertEquals(border.parent === actor, true);

  actor.remove_child = (child) => {
    actor.children.splice(actor.children.indexOf(child), 1);
    child.parent = null;
  };
  attachment.release();
  assertEquals(actor.children, []);
});

test("failed border attachment rolls back actor mutations", () => {
  const actor = borderActor();
  const border = borderFixture();
  actor.set_child_above_sibling = () => {
    throw new Error("stacking failed");
  };
  const attachment = createBorderAttachment(actor, border);

  try {
    attachment.attach();
  } catch {
    // Expected setup failure.
  }
  attachment.release();
  assertEquals(actor.clip_to_allocation, true);
  assertEquals(actor.children, []);
});

test("failed attachment cleanup retains a retryable owner", () => {
  const actor = borderActor();
  const border = borderFixture();
  const attachment = createBorderAttachment(actor, border);
  actor.set_child_above_sibling = () => {
    throw new Error("stacking failed");
  };
  actor.remove_child = () => {
    throw new Error("removal failed");
  };

  let attachError = null;
  let cleanupError = null;
  try {
    attachment.attach();
  } catch (caught) {
    attachError = caught;
  }
  try {
    attachment.release();
  } catch (caught) {
    cleanupError = caught;
  }
  assertEquals(attachError?.message, "stacking failed");
  assertEquals(cleanupError?.message, "removal failed");
  assertEquals(actor.clip_to_allocation, true);
  assertEquals(border.parent === actor, true);

  actor.remove_child = (child) => {
    actor.children.splice(actor.children.indexOf(child), 1);
    child.parent = null;
  };
  attachment.release();
  assertEquals(actor.children, []);
});

test("failed border setup restores actor clipping", () => {
  const actor = borderActor();
  const border = borderFixture();
  Object.defineProperty(border, "clip_to_allocation", {
    set() {
      throw new Error("clip failed");
    },
  });
  const attachment = createBorderAttachment(actor, border);

  try {
    attachment.attach();
  } catch {
    // Expected setup failure.
  }
  attachment.release();
  assertEquals(actor.clip_to_allocation, true);
  assertEquals(actor.children, []);
});

const WindowType = {
  NORMAL: 1,
  DIALOG: 2,
  MODAL_DIALOG: 3,
};

function typedWindow(type, { transient = false, attached = false } = {}) {
  return {
    get_window_type: () => type,
    get_transient_for: () => transient ? {} : null,
    is_attached_dialog: () => attached,
  };
}

test("window filtering accepts normal and dialog windows", () => {
  assertEquals(
    isInterestingWindow(typedWindow(WindowType.NORMAL), false, WindowType),
    true,
  );
  assertEquals(
    isInterestingWindow(typedWindow(WindowType.DIALOG), false, WindowType),
    true,
  );
  assertEquals(isInterestingWindow(typedWindow(99), true, WindowType), false);
});

test("modal policy controls modal, transient, and attached dialogs", () => {
  assertEquals(
    isInterestingWindow(
      typedWindow(WindowType.MODAL_DIALOG),
      false,
      WindowType,
    ),
    false,
  );
  assertEquals(
    isInterestingWindow(
      typedWindow(WindowType.MODAL_DIALOG),
      true,
      WindowType,
    ),
    true,
  );
  assertEquals(
    isInterestingWindow(
      typedWindow(WindowType.NORMAL, { transient: true }),
      false,
      WindowType,
    ),
    false,
  );
  assertEquals(
    isInterestingWindow(
      typedWindow(WindowType.DIALOG, { attached: true }),
      false,
      WindowType,
    ),
    false,
  );
});

test("pending records add unmanaged cleanup and ignore duplicates", () => {
  const manager = managerFixture();
  const tracker = trackerFixture(manager);
  const metaWindow = signalObject();
  const actor = signalObject();
  tracker.addPending(metaWindow, [{
    object: actor,
    signal: "notify::allocation",
    handler() {},
  }]);
  tracker.addPending(metaWindow, []);

  assertEquals(tracker.size, 1);
  assertEquals(actor.connections.length, 1);
  assertEquals(metaWindow.connections[0].signal, "unmanaged");

  metaWindow.emit("unmanaged");
  assertEquals(tracker.size, 0);
  assertEquals(actor.disconnections.length, 1);
  assertEquals(metaWindow.disconnections.length, 1);
});

test("reconciliation does not replace a healthy pending wait", () => {
  const tracker = trackerFixture();
  const metaWindow = signalObject();
  const actor = signalObject();
  const tracked = [];
  tracker.addPending(metaWindow, [{
    object: actor,
    signal: "notify::allocation",
    handler() {},
  }]);
  const record = tracker.get(metaWindow);

  tracker.queueTrack(metaWindow, (win) => tracked.push(win));
  drainDeferred();

  assertEquals(tracker.get(metaWindow), record);
  assertEquals(record.pending.track, null);
  assertEquals(record.queued, false);
  assertEquals(record.failed, false);
  assertEquals(tracked, []);
  assertEquals(actor.disconnections, []);
  tracker.remove(metaWindow);
});

test("pending cleanup disconnects each signal object once", () => {
  const tracker = trackerFixture();
  const metaWindow = signalObject();
  tracker.addPending(metaWindow, [{
    object: metaWindow,
    signal: "shown",
    handler() {},
  }]);

  tracker.remove(metaWindow);
  assertEquals(metaWindow.connections.length, 2);
  assertEquals(metaWindow.disconnections.length, 1);
});

test("pending cleanup continues after one signal object fails", () => {
  const tracker = trackerFixture();
  const metaWindow = signalObject();
  const actor = signalObject();
  tracker.addPending(metaWindow, [{
    object: actor,
    signal: "notify::allocation",
    handler() {},
  }]);
  actor.disconnectObject = () => {
    throw new Error("actor disconnect failed");
  };

  let error = null;
  try {
    tracker.remove(metaWindow);
  } catch (caught) {
    error = caught;
  }
  assertEquals(error?.message, "actor disconnect failed");
  assertEquals(metaWindow.disconnections.length, 1);
  assertEquals(tracker.has(metaWindow), true);

  actor.disconnectObject = () => {};
  tracker.remove(metaWindow);
  assertEquals(tracker.size, 0);
});

test("failed pending setup disconnects earlier signals", () => {
  const tracker = trackerFixture();
  const metaWindow = signalObject();
  const actor = signalObject();
  metaWindow.connectObject = () => {
    throw new Error("connection failed");
  };

  let error = null;
  try {
    tracker.addPending(metaWindow, [{
      object: actor,
      signal: "notify::allocation",
      handler() {},
    }]);
  } catch (caught) {
    error = caught;
  }

  assertEquals(error?.message, "connection failed");
  assertEquals(tracker.size, 0);
  assertEquals(actor.disconnections.length, 1);
});

test("cleanup skips disposed signal objects", () => {
  const tracker = trackerFixture();
  const metaWindow = signalObject();
  const actor = signalObject({ throws: true });
  tracker.addPending(metaWindow, [{
    object: actor,
    signal: "notify::allocation",
    handler() {},
  }]);
  tracker.remove(metaWindow);

  assertEquals(actor.disconnections.length, 0);
  assertEquals(metaWindow.disconnections.length, 1);
});

test("pending records become unviable when a watched actor is disposed", () => {
  const tracker = trackerFixture();
  const metaWindow = signalObject();
  const actor = signalObject({ destroyed: true });
  tracker.addPending(metaWindow, [{
    object: actor,
    signal: "notify::allocation",
    handler() {},
  }]);

  assertEquals(tracker.isViable(metaWindow), false);
});

test("queued tracking defers work and releases pending signals", () => {
  const tracker = trackerFixture();
  const metaWindow = signalObject();
  const tracked = [];
  tracker.queueTrack(metaWindow, (win) => tracked.push(win));

  assertEquals(tracked, []);
  assertEquals(tracker.isViable(metaWindow), true);
  drainDeferred();

  assertEquals(tracked, [metaWindow]);
  assertEquals(tracker.size, 0);
  assertEquals(metaWindow.disconnections.length, 1);
});

test("removing queued tracking cancels attachment", () => {
  const tracker = trackerFixture();
  const metaWindow = signalObject();
  const tracked = [];
  tracker.queueTrack(metaWindow, (win) => tracked.push(win));
  tracker.remove(metaWindow);
  drainDeferred();

  assertEquals(tracked, []);
  assertEquals(tracker.size, 0);
  assertEquals(metaWindow.disconnections.length, 1);
});

test("failed pending cleanup can be explicitly requeued", () => {
  const tracker = trackerFixture();
  const metaWindow = signalObject();
  const tracked = [];
  tracker.queueTrack(metaWindow, (win) => tracked.push(win));

  const record = tracker.get(metaWindow);
  metaWindow.disconnectObject = () => {
    throw new Error("disconnect failed");
  };
  let error = null;
  try {
    tracker._processQueued(metaWindow, record);
  } catch (caught) {
    error = caught;
  }
  assertEquals(error?.message, "disconnect failed");
  assertEquals(record.queued, false);
  assertEquals(record.failed, true);
  assertEquals(tracker.isViable(metaWindow), false);
  assertEquals(tracker.get(metaWindow), record);

  metaWindow.disconnectObject = () => {};
  tracker.queueTrack(metaWindow, (win) => tracked.push(win));
  assertEquals(record.failed, false);
  drainDeferred();

  assertEquals(tracked, [metaWindow]);
  assertEquals(tracker.has(metaWindow), false);
});

test("clear cancels deferred attachment even when cleanup fails", () => {
  const tracker = trackerFixture();
  const metaWindow = signalObject();
  const tracked = [];
  tracker.queueTrack(metaWindow, (win) => tracked.push(win));
  const record = tracker.get(metaWindow);
  metaWindow.disconnectObject = () => {
    throw new Error("disconnect failed");
  };

  let error = null;
  try {
    tracker.clear();
  } catch (caught) {
    error = caught;
  }
  assertEquals(error?.message, "disconnect failed");
  assertEquals(record.queued, false);
  assertEquals(record.failed, true);
  drainDeferred();
  assertEquals(tracked, []);
  assertEquals(tracker.get(metaWindow), record);

  metaWindow.disconnectObject = () => {};
  tracker.clear();
  assertEquals(tracker.size, 0);
});

test("queued tracking attaches only one window per deferred turn", () => {
  const tracker = trackerFixture();
  const tracked = [];
  tracker.queueTrack(signalObject(), () => tracked.push(1));
  tracker.queueTrack(signalObject(), () => tracked.push(2));

  drainUntil(() => tracked.length === 1);
  assertEquals(tracked, [1]);
  drainUntil(() => tracked.length === 2);
  assertEquals(tracked, [1, 2]);
});

test("queued syncs coalesce for the active window record", () => {
  const manager = managerFixture();
  const tracker = trackerFixture(manager);
  const metaWindow = signalObject();
  const record = tracker.activate(metaWindow, { live: true });
  tracker.queueSync(metaWindow);
  tracker.queueSync(metaWindow);
  drainDeferred();

  assertEquals(manager.syncs.length, 1);
  assertEquals(manager.syncs[0], [metaWindow, record]);
  assertEquals(record.queued, false);
});

test("frame queue coalesces and reads the latest state before redraw", () => {
  const manager = managerFixture();
  const laters = laterQueue();
  const tracker = new WindowTracker(manager, laters);
  const metaWindow = signalObject();
  let state = "old";
  manager.syncBorder = () => manager.syncs.push(state);
  tracker.activate(metaWindow, { live: true });

  tracker.queueSync(metaWindow);
  state = "current";
  tracker.queueSync(metaWindow);

  assertEquals(laters.added, [{
    id: 1,
    when: Meta.LaterType.BEFORE_REDRAW,
  }]);
  laters.run();
  assertEquals(manager.syncs, ["current"]);
  tracker.clear();
});

test("clear cancels queued frame work", () => {
  const laters = laterQueue();
  const tracker = new WindowTracker(managerFixture(), laters);
  const metaWindow = signalObject();
  tracker.activate(metaWindow, { live: true });
  tracker.queueSync(metaWindow);

  tracker.clear();
  assertEquals(laters.removed, [1]);
});

test("failed sync remains unviable until the record is rebuilt", () => {
  const manager = managerFixture();
  const tracker = trackerFixture(manager);
  const metaWindow = signalObject();
  const record = tracker.activate(metaWindow, { live: true });
  manager.syncBorder = () => {
    throw new Error("sync failed");
  };

  let error = null;
  try {
    tracker.syncNow(metaWindow);
  } catch (caught) {
    error = caught;
  }
  assertEquals(error?.message, "sync failed");
  assertEquals(record.failed, true);
  assertEquals(tracker.isViable(metaWindow), false);

  manager.syncBorder = (win, data) => manager.syncs.push([win, data]);
  tracker.syncNow(metaWindow);
  drainDeferred();
  assertEquals(manager.syncs, []);

  tracker.remove(metaWindow);
  const replacement = tracker.activate(metaWindow, { live: true });
  tracker.queueSync(metaWindow);
  drainDeferred();
  assertEquals(manager.syncs, [[metaWindow, replacement]]);
});

test("immediate sync consumes an already queued update", () => {
  const manager = managerFixture();
  const tracker = trackerFixture(manager);
  const metaWindow = signalObject();
  const record = tracker.activate(metaWindow, { live: true });
  tracker.queueSync(metaWindow);

  tracker.syncNow(metaWindow);
  drainDeferred();

  assertEquals(manager.syncs, [[metaWindow, record]]);
  assertEquals(record.queued, false);
});

test("resize settles monitor geometry without another allocation signal", () => {
  const manager = managerFixture();
  const tracker = trackerFixture(manager);
  const metaWindow = signalObject();
  let monitor = 0;
  let frame = { x: 100, y: 100, width: 600, height: 400 };
  const workareas = [
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 1920, y: 0, width: 1280, height: 720 },
  ];
  Object.assign(metaWindow, {
    get_monitor: () => monitor,
    get_work_area_current_monitor: () => workareas[monitor],
    get_frame_rect: () => frame,
    get_buffer_rect: () => frame,
  });
  globalThis.global = {
    display: { get_n_monitors: () => 2, focus_window: metaWindow },
  };
  // The actor allocation deliberately stays unchanged throughout the move.
  const actor = {
    get_allocation_box: () => ({ x1: 0, y1: 0, x2: 600, y2: 400 }),
  };
  const border = {
    styles: [],
    set_position(x, y) {
      this.position = [x, y];
    },
    set_size(width, height) {
      this.size = [width, height];
    },
    set_style(style) {
      this.styles.push(style);
    },
  };
  const config = {
    enabled: true,
    width: 2,
    maximizedBorder: true,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    radius: { tl: 8, tr: 8, br: 8, bl: 8 },
    activeColor: "red",
    inactiveColor: "gray",
  };
  const states = [];
  manager.syncBorder = () => {
    const state = computeBorderState(getWindowState(metaWindow, actor), config);
    states.push(state);
    record.borderStyle = applyBorderState(border, state, record.borderStyle);
  };
  const record = tracker.activate(metaWindow, {
    live: true,
    borderStyle: null,
  });
  tracker.syncNow(metaWindow);
  assertEquals(border.size, [604, 404]);

  // A workarea/monitor update is queued, then size-changed arrives while
  // Mutter still reports the previous monitor. The deferred pass must survive.
  tracker.queueSync(metaWindow);
  frame = { x: 1920, y: 100, width: 900, height: 500 };
  tracker.syncGeometry(metaWindow);
  assertEquals(border.size, [904, 504]);
  monitor = 1;
  drainDeferred();
  assertEquals(border.size, [902, 504]);
  assertEquals(states.length, 3);
  assertEquals(border.position, [0, -2]);
  assertEquals(states[2].borderWidths.left, 0);
  assertEquals(states[2].radius.tl, 0);

  // A position-only relocation away from the edge restores the complete
  // border, including its radii, even though its size never changes.
  frame = { ...frame, x: 2000 };
  tracker.queueSync(metaWindow);
  tracker.queueSync(metaWindow);
  drainDeferred();
  assertEquals(states.length, 4);
  assertEquals(border.size, [904, 504]);
  assertEquals(states[3].radius.tl, 8);

  // Closing a lid can briefly leave the window without a logical monitor.
  monitor = -1;
  tracker.syncGeometry(metaWindow);
  assertEquals(border.visible, false);
  monitor = 0;
  frame = { x: 100, y: 100, width: 600, height: 400 };
  drainDeferred();
  assertEquals(border.visible, true);
  assertEquals(border.size, [604, 404]);
  tracker.clear();
});

test("resize follow-up coalesces with allocation and cancels on removal", () => {
  const manager = managerFixture();
  const tracker = trackerFixture(manager);
  const metaWindow = signalObject();
  const record = tracker.activate(metaWindow, { live: true });
  tracker.syncGeometry(metaWindow);
  tracker.syncGeometry(metaWindow);
  tracker.queueSync(metaWindow);
  drainDeferred();
  assertEquals(manager.syncs, [
    [metaWindow, record],
    [metaWindow, record],
    [metaWindow, record],
  ]);

  tracker.syncGeometry(metaWindow);
  tracker.remove(metaWindow);
  drainDeferred();
  assertEquals(manager.syncs.length, 4);
});

test("immediate updates share active-record failure ownership", () => {
  const tracker = trackerFixture();
  const metaWindow = signalObject();
  const record = tracker.activate(metaWindow, { live: true });
  const updates = [];
  tracker.updateNow(metaWindow, (data) => updates.push(data));
  tracker.queueSync(metaWindow);

  let error = null;
  try {
    tracker.updateNow(metaWindow, () => {
      throw new Error("update failed");
    });
  } catch (caught) {
    error = caught;
  }

  assertEquals(updates, [record]);
  assertEquals(error?.message, "update failed");
  assertEquals(record.failed, true);
  assertEquals(record.queued, false);
  tracker.updateNow(metaWindow, () => updates.push("unexpected"));
  drainDeferred();
  assertEquals(updates, [record]);
});

test("queued sync updates only one window per deferred turn", () => {
  const manager = managerFixture();
  const tracker = trackerFixture(manager);
  const first = signalObject();
  const second = signalObject();
  tracker.activate(first, { live: true });
  tracker.activate(second, { live: true });
  tracker.queueSync(first);
  tracker.queueSync(second);

  drainUntil(() => manager.syncs.length === 1);
  assertEquals(manager.syncs[0][0] === first, true);
  drainUntil(() => manager.syncs.length === 2);
  assertEquals(manager.syncs[1][0] === second, true);
});

test("attachment and sync work share one time-sliced queue", () => {
  const manager = managerFixture();
  const tracker = trackerFixture(manager);
  const events = [];
  const active = signalObject();
  tracker.activate(active, { live: true });
  manager.syncBorder = () => events.push("sync");
  tracker.queueSync(active);
  tracker.queueTrack(signalObject(), () => events.push("track"));

  drainUntil(() => events.length === 1);
  assertEquals(events, ["sync"]);
  drainUntil(() => events.length === 2);
  assertEquals(events, ["sync", "track"]);
});

test("a continuously requeued window cannot starve later syncs", () => {
  const manager = managerFixture();
  const tracker = trackerFixture(manager);
  const first = signalObject();
  const second = signalObject();
  tracker.activate(first, { live: true });
  tracker.activate(second, { live: true });
  let requeued = false;
  manager.syncBorder = (metaWindow, data) => {
    manager.syncs.push([metaWindow, data]);
    if (metaWindow === first && !requeued) {
      requeued = true;
      tracker.queueSync(first);
    }
  };
  tracker.queueSync(first);
  tracker.queueSync(second);

  drainUntil(() => manager.syncs.length === 2);
  assertEquals(manager.syncs.map(([metaWindow]) => metaWindow), [
    first,
    second,
  ]);
  drainDeferred();
  assertEquals(manager.syncs.map(([metaWindow]) => metaWindow), [
    first,
    second,
    first,
  ]);
});

test("queued sync skips invalid records without stranding later work", () => {
  const manager = managerFixture();
  const tracker = trackerFixture(manager);
  const deadWindow = signalObject({ destroyed: true });
  const invalidWindow = signalObject();
  const validWindow = signalObject();
  tracker.activate(deadWindow, { live: true });
  tracker.activate(invalidWindow, { live: false });
  const validRecord = tracker.activate(validWindow, { live: true });
  tracker.queueSync(deadWindow);
  tracker.queueSync(invalidWindow);
  tracker.queueSync(validWindow);
  drainDeferred();
  assertEquals(manager.syncs, [[validWindow, validRecord]]);
});

test("removing records cancels pending signals and queued syncs", () => {
  const manager = managerFixture();
  const tracker = trackerFixture(manager);
  const first = signalObject();
  const second = signalObject();
  tracker.activate(first, { live: true });
  tracker.queueSync(first);
  tracker.addPending(second, []);
  tracker.remove(first);
  tracker.remove(second);
  drainDeferred();

  assertEquals(tracker.size, 0);
  assertEquals(manager.syncs, []);
  assertEquals(manager.cleanups.length, 1);
  assertEquals(first.disconnections.length, 0);
  assertEquals(second.disconnections.length, 1);
});

test("active records remain tracked until cleanup succeeds", () => {
  const manager = managerFixture();
  const tracker = trackerFixture(manager);
  const metaWindow = signalObject();
  const record = tracker.activate(metaWindow, { live: true });
  tracker.queueSync(metaWindow);
  manager.cleanupWindow = () => {
    throw new Error("cleanup failed");
  };

  let error = null;
  try {
    tracker.remove(metaWindow);
  } catch (caught) {
    error = caught;
  }
  assertEquals(error?.message, "cleanup failed");
  assertEquals(tracker.get(metaWindow), record);
  assertEquals(record.queued, false);
  assertEquals(record.failed, true);
  assertEquals(tracker.isViable(metaWindow), false);

  manager.cleanupWindow = () => {};
  tracker.remove(metaWindow);
  assertEquals(tracker.size, 0);
});

test("batch cleanup continues after one record fails", () => {
  const manager = managerFixture();
  const tracker = trackerFixture(manager);
  const first = signalObject();
  const second = signalObject();
  tracker.activate(first, { live: true });
  tracker.activate(second, { live: true });
  manager.cleanupWindow = (metaWindow, data) => {
    manager.cleanups.push([metaWindow, data]);
    if (metaWindow === first) throw new Error("first cleanup failed");
  };

  let error = null;
  try {
    tracker.clear();
  } catch (caught) {
    error = caught;
  }
  assertEquals(error?.message, "first cleanup failed");
  assertEquals(manager.cleanups.map(([metaWindow]) => metaWindow), [
    first,
    second,
  ]);
  assertEquals(tracker.has(first), true);
  assertEquals(tracker.has(second), false);
});

print(`${passed} window tracking tests passed`);
