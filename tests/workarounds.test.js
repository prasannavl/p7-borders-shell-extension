import GObject from "gi://GObject";
import Meta from "gi://Meta";
import { createX11ScalingWorkaround } from "../shell/workarounds/x11scaling.js";
import { assertEquals } from "./assert.js";

let passed = 0;

function test(name, callback) {
  callback();
  passed++;
  print(`ok - ${name}`);
}

function windowState() {
  return {
    frame: { x: 110, y: 120, width: 800, height: 600 },
    buffer: { x: 100, y: 100, width: 820, height: 640 },
    marker: "preserved",
  };
}

function textureFixture(width = 410, height = 320) {
  return {
    width,
    height,
    preferredSizeReads: 0,
    connections: [],
    disconnections: [],
    connectObject(signal, handler, owner) {
      this.connections.push({ signal, handler, owner });
    },
    disconnectObject(owner) {
      this.disconnections.push(owner);
    },
    get_preferred_size() {
      this.preferredSizeReads++;
      return [true, this.width, this.height];
    },
  };
}

test("X11 scaling APIs are available", () => {
  GObject.type_class_ref(Meta.ShapedTexture.$gtype);
  assertEquals(
    typeof Meta.Window.prototype.get_client_type === "function" &&
      typeof Meta.WindowClientType.X11 === "number" &&
      typeof Meta.WindowActor.prototype.get_texture === "function" &&
      typeof Meta.ShapedTexture.prototype.get_preferred_size === "function" &&
      GObject.signal_lookup("size-changed", Meta.ShapedTexture.$gtype) > 0,
    true,
  );
});

test("X11 scaling uses the rendered texture coordinate space", () => {
  const texture = textureFixture();
  const workaround = createX11ScalingWorkaround(
    { get_client_type: () => Meta.WindowClientType.X11 },
    { get_texture: () => texture },
    true,
  );
  workaround.connect(() => {}, {});

  assertEquals(workaround.apply(windowState()), {
    frame: { x: 105, y: 110, width: 400, height: 300 },
    buffer: { x: 100, y: 100, width: 410, height: 320 },
    marker: "preserved",
  });
  workaround.apply(windowState());
  assertEquals(texture.preferredSizeReads, 1);
});

test("matching X11 geometry returns the original state", () => {
  const texture = textureFixture(820, 640);
  const workaround = createX11ScalingWorkaround(
    { get_client_type: () => Meta.WindowClientType.X11 },
    { get_texture: () => texture },
    true,
  );
  workaround.connect(() => {}, {});
  const state = windowState();

  assertEquals(workaround.apply(state) === state, true);
});

test("X11 scaling owns and refreshes rendered size signal connections", () => {
  const firstTexture = textureFixture();
  const secondTexture = textureFixture();
  let texture = firstTexture;
  const actor = { get_texture: () => texture };
  const workaround = createX11ScalingWorkaround(
    { get_client_type: () => Meta.WindowClientType.X11 },
    actor,
    true,
  );
  const owner = {};
  let updates = 0;
  const handler = () => updates++;

  workaround.connect(handler, owner);
  workaround.connect(handler, owner);
  assertEquals(firstTexture.connections.length, 1);
  assertEquals(firstTexture.connections[0].signal, "size-changed");
  assertEquals(firstTexture.connections[0].owner === owner, true);

  texture = secondTexture;
  workaround.connect(handler, owner);
  assertEquals(firstTexture.disconnections, [owner]);
  assertEquals(secondTexture.connections.length, 1);
  assertEquals(secondTexture.connections[0].signal, "size-changed");
  assertEquals(secondTexture.connections[0].owner === owner, true);

  workaround.apply(windowState());
  assertEquals(secondTexture.preferredSizeReads, 1);
  secondTexture.connections[0].handler();
  assertEquals(updates, 1);
  workaround.apply(windowState());
  assertEquals(secondTexture.preferredSizeReads, 2);

  workaround.disconnect(owner);
  assertEquals(secondTexture.disconnections, [owner]);
});

test("native Wayland windows have no X11 scaling workaround", () => {
  assertEquals(
    createX11ScalingWorkaround(
      { get_client_type: () => Meta.WindowClientType.WAYLAND },
      {},
      true,
    ),
    null,
  );
});

test("disabled X11 scaling performs no window or actor work", () => {
  assertEquals(
    createX11ScalingWorkaround(
      {
        get_client_type: () => {
          throw new Error("window queried");
        },
      },
      {
        get_texture: () => {
          throw new Error("actor queried");
        },
      },
      false,
    ),
    null,
  );
});

print(`${passed} workaround tests passed`);
