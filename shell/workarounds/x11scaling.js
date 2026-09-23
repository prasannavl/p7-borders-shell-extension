// Xwayland uses one global integer scale derived from the active monitor set.
// Adding or removing a HiDPI monitor can therefore change the scale of every
// X11 surface without the X11 client performing a normal window resize.
//
// During that transition Mutter updates the Meta.ShapedTexture destination, so
// the window is painted at its new on-screen size, but the Meta.Window frame and
// buffer rectangles (and sometimes the outer actor allocation) can retain their
// previous X11 dimensions until the client is explicitly resized. This leaves
// two valid but different coordinate spaces: Meta.Window reports stale X11
// geometry while the shaped texture reports what is actually drawn. Reprocessing
// shown, move, monitor, allocation, or thaw events cannot correct a border while
// it keeps reading the unchanged Meta.Window rectangles.
//
// The texture's preferred size is its final rendered destination. Comparing it
// with the buffer rectangle gives the X/Y conversion from X11 coordinates to
// rendered coordinates. Apply that conversion to both the frame size and its
// inset inside the buffer, while preserving the buffer's stage position. Once
// Mutter and the client reconcile their geometry, the ratio naturally returns
// to 1 and this becomes a no-op.
//
// When disabled, this module creates no object and connects no signal. When
// enabled, it caches the rendered size and invalidates that cache only on the
// texture's size-changed signal, avoiding a GObject query during ordinary border
// updates.

import Meta from "gi://Meta";

export function createX11ScalingWorkaround(metaWindow, actor, enabled) {
  if (!enabled || metaWindow.get_client_type() !== Meta.WindowClientType.X11) {
    return null;
  }
  return new X11ScalingWorkaround(actor);
}

class X11ScalingWorkaround {
  constructor(actor) {
    this._actor = actor;
    /** @type {Meta.ShapedTexture | null} */
    this._texture = null;
    /** @type {{width: number, height: number} | null | undefined} */
    this._renderedSize = undefined;
  }

  connect(onSizeChanged, owner) {
    const texture = this._actor.get_texture();
    if (texture === this._texture) return;

    this.disconnect(owner);
    if (!texture) return;

    const invalidateSize = () => {
      this._renderedSize = undefined;
      onSizeChanged();
    };
    // Record ownership before the fallible signal connection so normal window
    // cleanup can recover a partially completed setup.
    this._texture = texture;
    this._renderedSize = undefined;
    texture.connectObject("size-changed", invalidateSize, owner);
  }

  disconnect(owner) {
    const texture = this._texture;
    if (!texture) return;

    // Keep failed cleanup retryable by clearing ownership only after Mutter
    // accepts the disconnect.
    texture.disconnectObject(owner);
    this._texture = null;
    this._renderedSize = undefined;
  }

  apply(windowState) {
    if (!this._texture) return windowState;
    if (this._renderedSize === undefined) {
      this._renderedSize = getRenderedSize(this._texture);
    }
    return this._renderedSize
      ? getRenderedX11Geometry(windowState, this._renderedSize)
      : windowState;
  }
}

function getRenderedSize(texture) {
  const [hasSize, width, height] = texture.get_preferred_size();
  return hasSize && width > 0 && height > 0 ? { width, height } : null;
}

function getRenderedX11Geometry(windowState, renderedSize) {
  const { frame, buffer } = windowState;
  if (buffer.width <= 0 || buffer.height <= 0) return windowState;

  const { width, height } = renderedSize;
  if (width === buffer.width && height === buffer.height) return windowState;

  const scaleX = width / buffer.width;
  const scaleY = height / buffer.height;
  return {
    ...windowState,
    frame: {
      x: buffer.x + (frame.x - buffer.x) * scaleX,
      y: buffer.y + (frame.y - buffer.y) * scaleY,
      width: frame.width * scaleX,
      height: frame.height * scaleY,
    },
    buffer: { x: buffer.x, y: buffer.y, width, height },
  };
}
