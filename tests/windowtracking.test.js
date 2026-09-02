import GLib from "gi://GLib";

import {
  isInterestingWindow,
  isLiveObject,
  PendingTracker,
} from "../shell/windowtracking.js";

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
    _windowData: new Map(),
    syncs: [],
    isLiveWindowData(data) {
      return !!data?.live;
    },
    syncBorder(metaWindow, data) {
      this.syncs.push([metaWindow, data]);
    },
  };
}

function drainIdle() {
  const context = GLib.MainContext.default();
  while (context.pending()) context.iteration(false);
}

test("live object checks handle normal, destroyed, and disposed objects", () => {
  assertEquals(isLiveObject(null), false);
  assertEquals(isLiveObject({}), true);
  assertEquals(isLiveObject(signalObject()), true);
  assertEquals(isLiveObject(signalObject({ destroyed: true })), false);
  assertEquals(isLiveObject(signalObject({ throws: true })), false);
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

test("pending tracks add unmanaged cleanup and ignore duplicates", () => {
  const manager = managerFixture();
  const tracker = new PendingTracker(manager);
  const metaWindow = signalObject();
  const actor = signalObject();
  tracker.addTrack(metaWindow, [{
    object: actor,
    signal: "notify::allocation",
    handler() {},
  }]);
  tracker.addTrack(metaWindow, []);

  assertEquals(tracker.trackCount(), 1);
  assertEquals(actor.connections.length, 1);
  assertEquals(metaWindow.connections[0].signal, "unmanaged");

  metaWindow.emit("unmanaged");
  assertEquals(tracker.trackCount(), 0);
  assertEquals(actor.disconnections.length, 1);
  assertEquals(metaWindow.disconnections.length, 1);
});

test("cleanup skips disposed signal objects", () => {
  const tracker = new PendingTracker(managerFixture());
  const metaWindow = signalObject();
  const actor = signalObject({ throws: true });
  tracker.addTrack(metaWindow, [{
    object: actor,
    signal: "notify::allocation",
    handler() {},
  }]);
  tracker.clearTrack(metaWindow);

  assertEquals(actor.disconnections.length, 0);
  assertEquals(metaWindow.disconnections.length, 1);
});

test("queued syncs coalesce and use the latest window data", () => {
  const manager = managerFixture();
  const tracker = new PendingTracker(manager);
  const metaWindow = signalObject();
  manager._windowData.set(metaWindow, { live: true, version: 1 });
  tracker.addSync(metaWindow);
  manager._windowData.set(metaWindow, { live: true, version: 2 });
  tracker.addSync(metaWindow);
  drainIdle();

  assertEquals(manager.syncs.length, 1);
  assertEquals(manager.syncs[0][1].version, 2);
  assertEquals(tracker.syncs.size, 0);
});

test("queued sync can carry explicit data", () => {
  const manager = managerFixture();
  const tracker = new PendingTracker(manager);
  const metaWindow = signalObject();
  const data = { live: true, explicit: true };
  tracker.addSync(metaWindow, data);
  drainIdle();
  assertEquals(manager.syncs, [[metaWindow, data]]);
});

test("queued sync skips dead windows and invalid window data", () => {
  const manager = managerFixture();
  const tracker = new PendingTracker(manager);
  tracker.addSync(signalObject({ destroyed: true }), { live: true });
  tracker.addSync(signalObject(), { live: false });
  drainIdle();
  assertEquals(manager.syncs, []);
});

test("clear operations cancel pending tracks and syncs", () => {
  const manager = managerFixture();
  const tracker = new PendingTracker(manager);
  const first = signalObject();
  const second = signalObject();
  tracker.addTrack(first, []);
  tracker.addTrack(second, []);
  tracker.addSync(first, { live: true });
  tracker.addSync(second, { live: true });
  tracker.clearAll();
  drainIdle();

  assertEquals(tracker.trackCount(), 0);
  assertEquals(tracker.syncs.size, 0);
  assertEquals(manager.syncs, []);
  assertEquals(first.disconnections.length, 1);
  assertEquals(second.disconnections.length, 1);
});

print(`${passed} window tracking tests passed`);
