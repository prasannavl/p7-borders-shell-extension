const EDGE_EPS = 2;
const ZERO_RADIUS = { tl: 0, tr: 0, br: 0, bl: 0 };

export function computeBorderState(windowState, config) {
  const {
    box,
    frame,
    buffer,
    workarea,
    isFullscreen,
    maximize,
    isFocused,
  } = windowState;
  const { margins, radius, width: borderWidth } = config;
  const radiusEnabled = !!(radius.tl || radius.tr || radius.br || radius.bl);

  if (
    !workarea ||
    isFullscreen ||
    maximize.full ||
    (!config.maximizedBorder && maximize.any) ||
    !borderWidth ||
    !config.enabled
  ) {
    return { visible: false };
  }

  // Exclude shadows and other buffer-only space from border geometry.
  const effectiveFrame = buffer
    ? {
      x: frame.x - buffer.x,
      y: frame.y - buffer.y,
      width: frame.width,
      height: frame.height,
    }
    : {
      x: 0,
      y: 0,
      width: box.width,
      height: box.height,
    };

  const { width, height } = effectiveFrame;
  if (width <= 0 || height <= 0) return { visible: false };

  const edgeThreshold = Math.max(EDGE_EPS, borderWidth);
  const edges = {
    left: Math.abs(frame.x - workarea.x) <= edgeThreshold,
    right: Math.abs(frame.x + frame.width - (workarea.x + workarea.width)) <=
      edgeThreshold,
    top: Math.abs(frame.y - workarea.y) <= edgeThreshold,
    bottom: Math.abs(frame.y + frame.height - (workarea.y + workarea.height)) <=
      edgeThreshold,
  };

  const borderWidths = {
    top: edges.top ? 0 : borderWidth,
    right: edges.right ? 0 : borderWidth,
    bottom: edges.bottom ? 0 : borderWidth,
    left: edges.left ? 0 : borderWidth,
  };
  if (
    !borderWidths.top &&
    !borderWidths.right &&
    !borderWidths.bottom &&
    !borderWidths.left
  ) {
    return { visible: false };
  }

  const effectiveMargins = {
    top: edges.top ? 0 : margins.top,
    right: edges.right ? 0 : margins.right,
    bottom: edges.bottom ? 0 : margins.bottom,
    left: edges.left ? 0 : margins.left,
  };

  const effectiveRadius = !radiusEnabled || maximize.any ? ZERO_RADIUS : {
    tl: edges.top || edges.left ? 0 : radius.tl,
    tr: edges.top || edges.right ? 0 : radius.tr,
    br: edges.bottom || edges.right ? 0 : radius.br,
    bl: edges.bottom || edges.left ? 0 : radius.bl,
  };

  return {
    visible: true,
    borderWidths,
    borderColor: isFocused ? config.activeColor : config.inactiveColor,
    radius: effectiveRadius,
    pos: {
      x: effectiveFrame.x - effectiveMargins.left - borderWidths.left,
      y: effectiveFrame.y - effectiveMargins.top - borderWidths.top,
    },
    size: {
      width: Math.max(
        1,
        width +
          effectiveMargins.left +
          effectiveMargins.right +
          borderWidths.left +
          borderWidths.right,
      ),
      height: Math.max(
        1,
        height +
          effectiveMargins.top +
          effectiveMargins.bottom +
          borderWidths.top +
          borderWidths.bottom,
      ),
    },
  };
}
