(() => {
  const ASSET_BASE = './assets/';
  const TILE_SIZE_WORLD = 256;
  const GARDEN_SLOT = 5;
  const GARDEN_MARGIN = 6;
  const ABS_MIN_TILE_SIZE = 16;
  const ABS_MAX_TILE_SIZE = 512;
  const AUTOSAVE_KEY = 'mg-decorcustomiser-autosave-v1';


  const dom = {
    canvasWrap: document.getElementById('canvasWrap'),
    loadingState: document.getElementById('loadingState'),
    decorList: document.getElementById('decorList'),
    searchDecor: document.getElementById('searchDecor'),
    selectedName: document.getElementById('selectedName'),
    rotationLabel: document.getElementById('rotationLabel'),
    placedCount: document.getElementById('placedCount'),
    slotLabel: document.getElementById('slotLabel'),
    exportBtn: document.getElementById('exportBtn'),
    importBtn: document.getElementById('importBtn'),
    resetView: document.getElementById('resetView'),
    decorBtn: document.getElementById('decorBtn'),
    decorModal: document.getElementById('decorModal'),
    closeDecorModal: document.getElementById('closeDecorModal'),
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modalTitle'),
    modalText: document.getElementById('modalText'),
    modalPrimary: document.getElementById('modalPrimary'),
    modalSecondary: document.getElementById('modalSecondary'),
    modalClose: document.getElementById('modalClose'),
    controlsTooltip: document.getElementById('controlsTooltip'),
    closeTooltip: document.getElementById('closeTooltip'),
    mutationPanel: document.getElementById('mutationPanel'),
    mutationList: document.getElementById('mutationList'),
    selectionPreview: document.getElementById('selectionPreview'),
  };

  const state = {
    app: null,
    camera: null,
    world: null,
    overlay: null,
    mapData: null,
    renderBounds: null,
    tileSize: 180,
    targetCenter: { x: 0, y: 0 },
    decorData: [],
    decorById: new Map(),
    selectedDecorId: null,
    selectedRotation: 0,
    gardenOutline: null,
    hoverOutline: null,
    ghost: null,
    placed: new Map(),
    sprites: new Map(),
    pointerState: {
      dragging: null,
      pointers: new Map(),
      pinching: null,
      startPos: null,
      isPanning: false,
      spacebarHeld: false,
      paintMode: false,
      lastPaintedTile: null,
      hasMoved: false,
      longPressTimer: null
    },
    tileIndex: {
      dirtGlobals: [],
      boardwalkGlobals: [],
      globalToTile: new Map(),
      tileToGlobal: { dirt: new Map(), boardwalk: new Map() }
    },
    lastHover: null,
    lastPointerUp: 0,
  };

  // Device detection for conditional controls display
  function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints && navigator.maxTouchPoints > 1);
  }

  // Apply device class to body
  document.body.classList.add(isMobileDevice() ? 'mobile' : 'desktop');

  const FLIPPED_HORIZONTALLY_FLAG = 0x80000000;
  const FLIPPED_VERTICALLY_FLAG = 0x40000000;
  const FLIPPED_DIAGONALLY_FLAG = 0x20000000;
  const TILE_ID_MASK = 0x1fffffff;

  function setLoading(text) {
    if (!dom.loadingState) return;
    dom.loadingState.textContent = text;
    console.log("[Loading State]", text);
  }

  function showLoading(show) {
    if (!dom.loadingState) return;
    dom.loadingState.style.display = show ? 'grid' : 'none';
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // PIXI 8 compatible texture lookup - searches spritesheets for textures
  function getTextureSafe(id) {
    if (!id || typeof id !== 'string') return PIXI.Texture.EMPTY;

    // Try common prefixes if id doesn't start with sprite/
    const prefixes = id.startsWith('sprite/') ? [''] : ['', 'sprite/plant/', 'sprite/decor/', 'sprite/other/', 'sprite/mutation/', 'sprite/mutation-overlay/'];

    for (const prefix of prefixes) {
      const fullId = prefix + id;
      // PIXI 8 Assets cache lookup
      if (PIXI.Assets.cache.has(fullId)) {
        return PIXI.Assets.cache.get(fullId);
      }
    }

    try {
      // Search through loaded spritesheets (PIXI 8)
      const sheets = ['tiles', 'sprites-0', 'sprites-1', 'flat-sprites'];
      for (const sheetName of sheets) {
        const sheet = PIXI.Assets.get(sheetName);
        if (sheet && sheet.textures) {
          for (const prefix of prefixes) {
            const fullId = prefix + id;
            if (sheet.textures[fullId]) return sheet.textures[fullId];
          }
        }
      }
    } catch (e) {
      console.warn('[getTextureSafe] Fallback failed:', id, e.message);
    }

    return PIXI.Texture.EMPTY;
  }

  function rotateBy(delta) {
    state.selectedRotation = (state.selectedRotation + delta + 360) % 360;
    updateRotationLabel();
    updateGhost();
  }

  function updateRotationLabel() {
    dom.rotationLabel.textContent = `Rotation: ${state.selectedRotation}°`;
  }

  function updatePlacedCount() {
    dom.placedCount.textContent = String(state.placed.size);
  }

  function tileKey(tileType, localIndex) {
    return `${tileType}:${localIndex}`;
  }

  function getAssetKeyFromPath(path) {
    const match = path.match(/(?:^|\/)(?:export-from-figma-to-this-folder\{ignore\}[^/]*)\/(.+)\./);
    if (match && match[1]) return match[1];
    const filename = path.split('/').pop();
    if (filename) return filename.split('.')[0];
    return path;
  }

  function getTileFlipFlags(gid) {
    return {
      flippedH: !!(gid & FLIPPED_HORIZONTALLY_FLAG),
      flippedV: !!(gid & FLIPPED_VERTICALLY_FLAG),
      flippedD: !!(gid & FLIPPED_DIAGONALLY_FLAG),
    };
  }

  function tiledFlipsToGroupD8(flippedH, flippedV, flippedD) {
    let group = PIXI.groupD8.E;
    if (flippedD) group = PIXI.groupD8.add(group, PIXI.groupD8.MAIN_DIAGONAL);
    if (flippedH) group = PIXI.groupD8.add(group, PIXI.groupD8.MIRROR_HORIZONTAL);
    if (flippedV) group = PIXI.groupD8.add(group, PIXI.groupD8.MIRROR_VERTICAL);
    return group;
  }

  function getTextureForGid(gid, tilesets) {
    const tileId = gid & TILE_ID_MASK;
    if (!tilesets) return null;
    let tileset;
    for (let i = tilesets.length - 1; i >= 0; i--) {
      const ts = tilesets[i];
      if (ts.firstgid <= tileId) {
        tileset = ts;
        break;
      }
    }
    if (!tileset) return null;
    const localId = tileId - tileset.firstgid;
    if (tileset.image) {
      const assetKey = getAssetKeyFromPath(tileset.image);
      const baseTexture = getTextureSafe(assetKey);
      if (baseTexture === PIXI.Texture.EMPTY) return null;
      const tileWidth = tileset.tilewidth;
      const tileHeight = tileset.tileheight;
      const columns = tileset.columns;
      const margin = tileset.margin || 0;
      const spacing = tileset.spacing || 0;
      const tileX = margin + (localId % columns) * (tileWidth + spacing);
      const tileY = margin + Math.floor(localId / columns) * (tileHeight + spacing);
      return new PIXI.Texture({
        source: baseTexture.source,
        frame: new PIXI.Rectangle(tileX, tileY, tileWidth, tileHeight),
      });
    }
    if (tileset.tiles) {
      const tile = tileset.tiles.find((t) => t.id === localId);
      if (!tile || !tile.image) return null;
      const assetKey = getAssetKeyFromPath(tile.image);
      const tex = getTextureSafe(assetKey);
      return tex === PIXI.Texture.EMPTY ? null : tex;
    }
    return null;
  }

  function gridToWorld(gridX, gridY) {
    const bounds = state.renderBounds;
    return {
      x: (gridX - bounds.minX) * TILE_SIZE_WORLD + TILE_SIZE_WORLD / 2,
      y: (gridY - bounds.minY) * TILE_SIZE_WORLD + TILE_SIZE_WORLD / 2,
    };
  }

  function worldToGrid(worldX, worldY) {
    const bounds = state.renderBounds;
    return {
      gridX: Math.floor(worldX / TILE_SIZE_WORLD) + bounds.minX,
      gridY: Math.floor(worldY / TILE_SIZE_WORLD) + bounds.minY,
    };
  }

  function calculateCameraTransform(targetX, targetY, viewportWidth, viewportHeight, tileSize, mapWidthPixels, mapHeightPixels) {
    let zoom = tileSize / TILE_SIZE_WORLD;
    const minZoomX = viewportWidth / mapWidthPixels;
    const minZoomY = viewportHeight / mapHeightPixels;
    const minZoom = Math.max(minZoomX, minZoomY);
    if (mapWidthPixels > 0 && mapHeightPixels > 0) {
      zoom = Math.max(zoom, minZoom);
    }
    const viewportWorldWidth = viewportWidth / zoom;
    const viewportWorldHeight = viewportHeight / zoom;
    const halfViewW = viewportWorldWidth / 2;
    const halfViewH = viewportWorldHeight / 2;
    const minX = halfViewW;
    const maxX = mapWidthPixels - halfViewW;
    const minY = halfViewH;
    const maxY = mapHeightPixels - halfViewH;
    let clampedX = targetX;
    let clampedY = targetY;
    if (minX > maxX) clampedX = mapWidthPixels / 2;
    else clampedX = Math.max(minX, Math.min(targetX, maxX));
    if (minY > maxY) clampedY = mapHeightPixels / 2;
    else clampedY = Math.max(minY, Math.min(targetY, maxY));
    const x = -clampedX * zoom + viewportWidth / 2;
    const y = -clampedY * zoom + viewportHeight / 2;
    return { scale: zoom, x, y, clampedX, clampedY };
  }

  function calculateMinTileSize(viewportWidth, viewportHeight, mapWidthPixels, mapHeightPixels, absoluteMinTileSize) {
    const minZoomX = viewportWidth / mapWidthPixels;
    const minZoomY = viewportHeight / mapHeightPixels;
    const minZoom = Math.max(minZoomX, minZoomY);
    if (mapWidthPixels <= 0 || mapHeightPixels <= 0) {
      return absoluteMinTileSize;
    }
    return Math.max(absoluteMinTileSize, minZoom * TILE_SIZE_WORLD);
  }

  function updateCamera() {
    if (!state.app || !state.camera) return;
    const { width, height } = state.app.renderer;
    const bounds = state.renderBounds;
    const mapWidth = (bounds.maxX - bounds.minX + 1) * TILE_SIZE_WORLD;
    const mapHeight = (bounds.maxY - bounds.minY + 1) * TILE_SIZE_WORLD;
    const minTileSize = calculateMinTileSize(width, height, mapWidth, mapHeight, ABS_MIN_TILE_SIZE);
    state.tileSize = clamp(state.tileSize, minTileSize, ABS_MAX_TILE_SIZE);
    const transform = calculateCameraTransform(
      state.targetCenter.x,
      state.targetCenter.y,
      width,
      height,
      state.tileSize,
      mapWidth,
      mapHeight
    );
    state.camera.scale.set(transform.scale);
    state.camera.position.set(transform.x, transform.y);
    state.targetCenter.x = transform.clampedX;
    state.targetCenter.y = transform.clampedY;
  }

  function screenToWorld(point) {
    return state.camera.toLocal(point);
  }

  function zoomAt(screenPoint, newTileSize) {
    const before = screenToWorld(screenPoint);
    state.tileSize = clamp(newTileSize, ABS_MIN_TILE_SIZE, ABS_MAX_TILE_SIZE);
    updateCamera();
    const after = screenToWorld(screenPoint);
    state.targetCenter.x += before.x - after.x;
    state.targetCenter.y += before.y - after.y;
    updateCamera();
  }

  function createDecorSprite(decorId, rotation = 0, mutations = []) {
    const data = state.decorById.get(decorId) || { decorId, sprite: decorId };

    // Normalize rotation to 0, 90, 180, 270
    const normRot = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;

    let activeSprite = data.sprite;
    let flipH = false;
    let flipV = false;

    // Check for rotation variants
    if (data.rotationVariants && data.rotationVariants[normRot]) {
      const variant = data.rotationVariants[normRot];
      if (variant.sprite) activeSprite = variant.sprite;
      if (variant.flipH !== undefined) flipH = variant.flipH;
      if (variant.flipV !== undefined) flipV = variant.flipV;
    }

    const baseTex = getTextureSafe(activeSprite);
    const container = new PIXI.Container();
    container.label = `decor-${decorId}`;

    const sprite = new PIXI.Sprite(baseTex);

    // Use texture's default anchor (from spritesheet) or fallback to center
    const anchorX = baseTex.defaultAnchor?.x ?? 0.5;
    const anchorY = baseTex.defaultAnchor?.y ?? 0.5;
    sprite.anchor.set(anchorX, anchorY);

    // Game uses scale 1.0 - textures are exported at world size (1 pixel = 1 world pixel)
    // baseTileScale and nudgeY are deprecated in favor of this approach
    sprite.scale.set(1.0);
    if (flipH) sprite.scale.x *= -1;
    if (flipV) sprite.scale.y *= -1;

    // Special positioning for String Lights based on rotation (from DecorVisual.ts)
    if (decorId === 'ColoredStringLights' || decorId === 'StringLights') {
      const absRotation = Math.abs(rotation);
      let offsetX = 0;
      let offsetY = 0;

      if (rotation === 0 || absRotation === 360) {
        // 0 and -360: shift up by 50% of tile height
        offsetY = -0.5 * TILE_SIZE_WORLD;
      } else if (absRotation === 180) {
        // 180 and -180: shift down by 50% of tile height
        offsetY = 0.5 * TILE_SIZE_WORLD;
      } else if (absRotation === 90) {
        // 90 and -90: shift right by 50% of tile width
        offsetX = 0.5 * TILE_SIZE_WORLD;
      } else if (absRotation === 270) {
        // 270 and -270: shift left by 50% of tile width
        offsetX = -0.5 * TILE_SIZE_WORLD;
      }
      sprite.position.set(offsetX, offsetY);
    }

    container.addChild(sprite);

    // Apply rotation if no variant sprite handles it
    // If rotationVariants exists and has a sprite for this rotation, we assume it's pre-rotated or flipped
    const variantData = data.rotationVariants && data.rotationVariants[normRot];
    if (!variantData || !variantData.sprite) {
      container.angle = normRot;
    }

    return container;
  }

  const thumbnailCache = new Map();

  function getThumbnail(spriteId) {
    if (thumbnailCache.has(spriteId)) return thumbnailCache.get(spriteId);
    const tex = getTextureSafe(spriteId);
    if (tex === PIXI.Texture.EMPTY) return null;

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;

    const src = tex.source?.resource;
    if (src) {
      const f = tex.frame;
      const aspect = f.width / f.height;
      const targetSize = 60;
      let drawW, drawH;
      if (aspect > 1) {
        drawW = targetSize;
        drawH = targetSize / aspect;
      } else {
        drawH = targetSize;
        drawW = targetSize * aspect;
      }

      // Draw texture centered in canvas
      const x = (64 - drawW) / 2;
      const y = (64 - drawH) / 2;
      ctx.drawImage(src, f.x, f.y, f.width, f.height, x, y, drawW, drawH);
    }

    thumbnailCache.set(spriteId, canvas);
    return canvas;
  }

  function calculateZIndex(worldY, bottomOffset) {
    const tieBreaker = Math.min(bottomOffset / 1000, 0.9);
    return Math.floor(worldY * 10000) + 1 + tieBreaker;
  }

  function clearDecorSprites(keys) {
    if (!keys) {
      for (const sprite of state.sprites.values()) sprite.destroy({ children: true });
      state.sprites.clear();
      return;
    }
    for (const key of keys) {
      const sprite = state.sprites.get(key);
      if (sprite) {
        sprite.destroy({ children: true });
        state.sprites.delete(key);
      }
    }
  }

  function renderDecorSprites(keys) {
    if (!state.world) return;
    if (!keys) keys = Array.from(state.placed.keys());
    for (const key of keys) {
      const entry = state.placed.get(key);
      if (!entry) continue;
      const sprite = createDecorSprite(entry.decorId, entry.rotation);
      if (!sprite) continue;
      const worldPos = gridToWorld(entry.gridX, entry.gridY);
      sprite.position.set(worldPos.x, worldPos.y);
      const bottomOffset = sprite.getLocalBounds().maxY;
      sprite.zIndex = calculateZIndex(worldPos.y, bottomOffset);
      state.world.addChild(sprite);
      state.sprites.set(key, sprite);
    }
  }

  function setDecorAt(tileType, localIndex, decorId, rotation) {
    const key = tileKey(tileType, localIndex);
    const globalIdx = state.tileIndex[tileType === 'dirt' ? 'dirtGlobals' : 'boardwalkGlobals'][localIndex];
    if (globalIdx === undefined) return;
    const gridX = globalIdx % state.mapData.width;
    const gridY = Math.floor(globalIdx / state.mapData.width);
    let category = 'decor';
    const data = state.decorById.get(decorId);
    if (data && data.category) category = data.category;
    else if (decorId.startsWith('sprite/plant/')) category = 'plant';
    else if (decorId.startsWith('sprite/tallplant/')) category = 'tallplant';
    else if (decorId.startsWith('sprite/')) category = 'other';
    state.placed.set(key, { tileType, localIndex, decorId, rotation, gridX, gridY, category });
    clearDecorSprites([key]);
    renderDecorSprites([key]);
    updatePlacedCount();
    saveAutosave();
  }

  function removeDecorAt(tileType, localIndex) {
    const key = tileKey(tileType, localIndex);
    if (!state.placed.has(key)) return;
    state.placed.delete(key);
    clearDecorSprites([key]);
    updatePlacedCount();
    saveAutosave();
  }

  function updateGhost() {
    if (!state.overlay) return;
    if (state.pointerState.isPanning || state.pointerState.pointers.size > 1) {
      if (state.ghost) state.ghost.displayObject.visible = false;
      return;
    }
    const hover = state.lastHover;
    if (!state.ghost || state.ghost.decorId !== state.selectedDecorId || state.ghost.rotation !== state.selectedRotation) {
      if (state.ghost) {
        state.overlay.removeChild(state.ghost.displayObject);
        state.ghost.displayObject.destroy({ children: true });
      }
      const sprite = createDecorSprite(state.selectedDecorId, state.selectedRotation);
      if (!sprite) return;
      sprite.alpha = 0.6;
      state.overlay.addChild(sprite);
      state.ghost = { decorId: state.selectedDecorId, rotation: state.selectedRotation, displayObject: sprite };
      updateSelectionPreview();
    }

    if (hover) {
      const pos = gridToWorld(hover.gridX, hover.gridY);
      state.ghost.displayObject.position.set(pos.x, pos.y);
      state.ghost.displayObject.visible = true;
    } else {
      state.ghost.displayObject.visible = false;
    }
  }

  async function updateSelectionPreview() {
    if (!state.selectedDecorId) { dom.selectionPreview.innerHTML = ''; return; }
    const container = createDecorSprite(state.selectedDecorId, state.selectedRotation);
    if (!container) return;
    try {
      const bounds = container.getLocalBounds();
      const padding = 4;
      const targetSize = 48 - padding;
      const scale = Math.min(targetSize / bounds.width, targetSize / bounds.height, 1);
      const renderTex = state.app.renderer.generateTexture({ target: container, frame: new PIXI.Rectangle(bounds.x, bounds.y, bounds.width, bounds.height) });
      const sprite = new PIXI.Sprite(renderTex);
      sprite.scale.set(scale);
      const canvas = await state.app.renderer.extract.canvas(sprite);
      dom.selectionPreview.innerHTML = '';
      dom.selectionPreview.appendChild(canvas);
      renderTex.destroy(true);
    } catch (err) {
      console.error('Preview error:', err);
    } finally {
      container.destroy({ children: true });
    }
  }

  function updateHoverOutline(hover) {
    state.lastHover = hover;
    if (!state.hoverOutline) return;
    state.hoverOutline.clear();
    if (!hover || !hover.valid) return;
    const b = state.renderBounds;
    const x = (hover.gridX - b.minX) * TILE_SIZE_WORLD;
    const y = (hover.gridY - b.minY) * TILE_SIZE_WORLD;
    state.hoverOutline.rect(x, y, TILE_SIZE_WORLD, TILE_SIZE_WORLD);
    state.hoverOutline.stroke({ width: 3, color: hover.tileType === 'boardwalk' ? 0x6ad2a6 : 0xff6b3d, alpha: 0.8 });
    updateGhost();
  }

  function getTileHit(gridX, gridY) {
    if (!state.mapData) return null;
    if (gridX < 0 || gridY < 0 || gridX >= state.mapData.width || gridY >= state.mapData.height) return null;
    const globalIndex = gridY * state.mapData.width + gridX;
    return state.tileIndex.globalToTile.get(globalIndex) || null;
  }

  function handlePointerDown(event) {
    state.pointerState.pointers.set(event.pointerId, { x: event.global.x, y: event.global.y });
    state.pointerState.startPos = { x: event.global.x, y: event.global.y };

    // Check if entering paint mode (spacebar held + decor selected)
    if (state.pointerState.spacebarHeld && state.selectedDecorId) {
      state.pointerState.paintMode = true;
      state.pointerState.isPanning = false;
      // Paint on initial click
      const worldPos = screenToWorld(event.global);
      const { gridX, gridY } = worldToGrid(worldPos.x, worldPos.y);
      const hit = getTileHit(gridX, gridY);
      if (hit) {
        setDecorAt(hit.tileType, hit.localIndex, state.selectedDecorId, state.selectedRotation);
        state.pointerState.lastPaintedTile = tileKey(hit.tileType, hit.localIndex);
      }
      return;
    }

    state.pointerState.isPanning = false;
    state.pointerState.hasMoved = false;

    // Start long-press timer on mobile
    if (isMobileDevice()) {
      if (state.pointerState.longPressTimer) clearTimeout(state.pointerState.longPressTimer);
      state.pointerState.longPressTimer = setTimeout(() => {
        const worldPos = screenToWorld(event.global);
        const { gridX, gridY } = worldToGrid(worldPos.x, worldPos.y);
        const hit = getTileHit(gridX, gridY);
        if (hit && !state.pointerState.hasMoved) {
          removeDecorAt(hit.tileType, hit.localIndex);
          state.pointerState.hasMoved = true; // Prevent tap on release
        }
      }, 600);
    }

    if (state.pointerState.pointers.size === 2) {
      state.pointerState.hasMoved = true; // Two fingers down = gesture
      if (state.pointerState.longPressTimer) clearTimeout(state.pointerState.longPressTimer);

      const pts = Array.from(state.pointerState.pointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      state.pointerState.pinching = {
        distance: dist,
        tileSize: state.tileSize,
        midpoint: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }
      };

      // Prevent accidental single-click actions when two fingers are down
      state.pointerState.isPanning = false;
    }
  }

  function handlePointerMove(event) {
    const pointers = state.pointerState.pointers;

    // Handle paint mode - paint on all hovered tiles
    if (state.pointerState.paintMode && state.selectedDecorId) {
      const worldPos = screenToWorld(event.global);
      const { gridX, gridY } = worldToGrid(worldPos.x, worldPos.y);
      const hit = getTileHit(gridX, gridY);
      if (hit) {
        const key = tileKey(hit.tileType, hit.localIndex);
        if (key !== state.pointerState.lastPaintedTile) {
          setDecorAt(hit.tileType, hit.localIndex, state.selectedDecorId, state.selectedRotation);
          state.pointerState.lastPaintedTile = key;
        }
      }
      updateHoverOutline(hit ? { ...hit, gridX, gridY, valid: true } : { gridX, gridY, valid: false });
      return;
    }

    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;

    // Calculate delta BEFORE updating the pointer map
    const dx = event.global.x - pointer.x;
    const dy = event.global.y - pointer.y;

    // Update the pointer map with new coordinates
    pointer.x = event.global.x;
    pointer.y = event.global.y;

    // Track movement to distinguish taps from gestures
    const moveThreshold = 10;
    if (Math.abs(dx) > moveThreshold || Math.abs(dy) > moveThreshold) {
      state.pointerState.hasMoved = true;
      if (state.pointerState.longPressTimer) {
        clearTimeout(state.pointerState.longPressTimer);
        state.pointerState.longPressTimer = null;
      }
    }

    // Handle Pinching
    if (state.pointerState.pinching && pointers.size >= 2) {
      const pts = Array.from(pointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const midpoint = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };

      zoomAt(midpoint, state.pointerState.pinching.tileSize * (dist / state.pointerState.pinching.distance));
      state.pointerState.isPanning = false; // Zooming takes priority
      state.pointerState.hasMoved = true;
      return;
    }

    // Handle Panning / Hover
    if (!state.pointerState.isPanning && Math.hypot(event.global.x - state.pointerState.startPos.x, event.global.y - state.pointerState.startPos.y) > 10) {
      state.pointerState.isPanning = true;
      state.pointerState.hasMoved = true;
    }

    if (state.pointerState.isPanning) {
      const zoom = state.camera.scale.x || 1;
      state.targetCenter.x -= dx / zoom;
      state.targetCenter.y -= dy / zoom;
      updateCamera();
    } else {
      const worldPos = screenToWorld(event.global);
      const { gridX, gridY } = worldToGrid(worldPos.x, worldPos.y);
      const hit = getTileHit(gridX, gridY);
      updateHoverOutline(hit ? { ...hit, gridX, gridY, valid: true } : { gridX, gridY, valid: false });
    }
  }

  function handlePointerUp(event) {
    if (state.pointerState.longPressTimer) {
      clearTimeout(state.pointerState.longPressTimer);
      state.pointerState.longPressTimer = null;
    }

    if (!state.pointerState.pointers.has(event.pointerId)) return;
    state.pointerState.pointers.delete(event.pointerId);
    if (state.pointerState.pointers.size < 2) state.pointerState.pinching = null;

    // Exit paint mode on pointer up
    if (state.pointerState.paintMode) {
      state.pointerState.paintMode = false;
      state.pointerState.lastPaintedTile = null;
      return;
    }

    if (state.pointerState.isPanning) {
      state.pointerState.isPanning = false;
      state.pointerState.hasMoved = true;
      return;
    }

    // If we moved significantly, don't trigger a tap action
    if (state.pointerState.hasMoved) return;

    const now = Date.now();
    const isDouble = state.lastPointerUp && (now - state.lastPointerUp < 300);
    state.lastPointerUp = now;

    const worldPos = screenToWorld(event.global);
    const { gridX, gridY } = worldToGrid(worldPos.x, worldPos.y);
    const hit = getTileHit(gridX, gridY);

    if (hit) {
      const key = tileKey(hit.tileType, hit.localIndex);
      const existing = state.placed.get(key);

      if (isDouble && existing) {
        setDecorAt(hit.tileType, hit.localIndex, existing.decorId, (existing.rotation + 90) % 360);
        return;
      }

      if (state.selectedDecorId) {
        setDecorAt(hit.tileType, hit.localIndex, state.selectedDecorId, state.selectedRotation);
      } else if (existing) {
        dom.selectedName.textContent = dataFromName(existing.decorId);
        removeDecorAt(hit.tileType, hit.localIndex);
        updateGhost();
      }
    }
  }

  function dataFromName(decorId) {
    const data = state.decorById.get(decorId);
    return data ? data.name : (decorId.includes('/') ? decorId.split('/').pop() : decorId);
  }

  function handleRightClick(event) {
    event.preventDefault();
    const rect = dom.canvasWrap.getBoundingClientRect();
    const worldPos = screenToWorld(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top));
    const { gridX, gridY } = worldToGrid(worldPos.x, worldPos.y);
    const hit = getTileHit(gridX, gridY);
    if (hit) removeDecorAt(hit.tileType, hit.localIndex);
  }

  function handleKeyDown(event) {
    const key = event.key.toLowerCase();

    // Track spacebar state for paint mode
    if (key === ' ' && !event.repeat) {
      if (state.selectedDecorId) {
        // If decor is selected, enable paint mode on hold
        event.preventDefault();
        state.pointerState.spacebarHeld = true;
        return;
      } else {
        // If no decor selected, unselect (existing behavior)
        state.selectedDecorId = null;
        dom.selectedName.textContent = 'None selected';
        updateGhost();
        renderDecorList();
        return;
      }
    }

    if (key === 'escape') {
      state.selectedDecorId = null;
      dom.selectedName.textContent = 'None selected';
      updateGhost();
      renderDecorList();
      return;
    }

    if (key === 'r') {
      if (state.lastHover && state.lastHover.valid) {
        const key = tileKey(state.lastHover.tileType, state.lastHover.localIndex);
        const existing = state.placed.get(key);
        if (existing) { setDecorAt(state.lastHover.tileType, state.lastHover.localIndex, existing.decorId, (existing.rotation + 90) % 360); return; }
      }
      if (state.selectedDecorId) rotateBy(90);
    }
    if (['d'].includes(key)) {
      event.preventDefault();
      dom.decorModal.style.display = 'flex'; updateMenuButtons(); renderDecorList(); dom.searchDecor.focus();
    }
  }

  function handleKeyUp(event) {
    const key = event.key.toLowerCase();
    if (key === ' ') {
      state.pointerState.spacebarHeld = false;
      state.pointerState.paintMode = false;
      state.pointerState.lastPaintedTile = null;
    }
  }

  function handleWheel(event) { event.preventDefault(); zoomAt({ x: event.clientX, y: event.clientY }, state.tileSize * (event.deltaY > 0 ? 0.92 : 1.08)); }

  function bindEvents() {
    state.app.stage.eventMode = 'static';
    state.app.stage.hitArea = new PIXI.Rectangle(0, 0, (state.renderBounds.maxX - state.renderBounds.minX + 1) * TILE_SIZE_WORLD, (state.renderBounds.maxY - state.renderBounds.minY + 1) * TILE_SIZE_WORLD);
    state.app.stage.on('pointerdown', handlePointerDown); state.app.stage.on('pointermove', handlePointerMove); state.app.stage.on('pointerup', handlePointerUp); state.app.stage.on('pointerupoutside', handlePointerUp);
    dom.canvasWrap.addEventListener('wheel', handleWheel, { passive: false }); dom.canvasWrap.addEventListener('contextmenu', handleRightClick);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('resize', updateCamera);
    dom.searchDecor.addEventListener('input', () => renderDecorList());
    dom.decorBtn.addEventListener('click', () => { updateMenuButtons(); dom.decorModal.style.display = 'flex'; renderDecorList(); });
    dom.closeDecorModal.addEventListener('click', () => { dom.decorModal.style.display = 'none'; });
    dom.decorModal.addEventListener('click', (e) => { if (e.target === dom.decorModal) dom.decorModal.style.display = 'none'; });
    dom.resetView.addEventListener('click', focusGarden);
    dom.exportBtn.addEventListener('click', () => { downloadText('decor-layout.json', JSON.stringify(createAriesExportPayload(), null, 2)); });
    dom.importBtn.addEventListener('click', openImportModal);
    dom.modalClose.addEventListener('click', closeModal);
    if (dom.closeTooltip) dom.closeTooltip.addEventListener('click', () => { dom.controlsTooltip.style.display = 'none'; });
  }



  function updateMenuButtons() { dom.decorBtn.classList.add('primary'); }

  function renderDecorList() {
    const activeData = state.decorData;
    const query = dom.searchDecor.value.toLowerCase();
    const filtered = query ? activeData.filter((d) => d.name.toLowerCase().includes(query)) : activeData;
    dom.decorList.innerHTML = '';

    for (const decor of filtered) {
      const item = document.createElement('div');
      item.className = 'decor-item' + (state.selectedDecorId === decor.decorId ? ' active' : '');
      const thumb = document.createElement('div');
      thumb.className = 'decor-thumb';


      // Get sprite ID for thumbnail (same logic as createDecorSprite)
      const data = state.decorById.get(decor.decorId) || { sprite: decor.decorId };
      const spriteId = data.sprite || decor.decorId;

      // Use synchronous getThumbnail which properly handles PIXI 8 textures
      const canvas = getThumbnail(spriteId);
      if (canvas) {
        // CRITICAL: cloneNode(true) on canvas doesn't clone pixel content!
        // Just append the cached canvas directly
        thumb.appendChild(canvas);
      }

      const label = document.createElement('small');
      label.textContent = decor.name;
      item.appendChild(thumb);
      item.appendChild(label);
      item.addEventListener('click', () => {
        // Auto-close modal after selection
        dom.decorModal.style.display = 'none';

        state.selectedDecorId = decor.decorId;
        dom.selectedName.textContent = decor.name;
        state.selectedMutations = [];
        renderDecorList();
        updateGhost();
      });
      dom.decorList.appendChild(item);
    }
  }

  function buildTileIndex(mapData) {
    const slotName = String(GARDEN_SLOT).padStart(2, '0');
    const layers = ['DirtTiles', 'BoardwalkTiles'].map(name => mapData.layers.find(l => (l.class === name || l.name.startsWith(name)) && l.name.endsWith(`-${slotName}`)));
    layers.forEach((layer, i) => {
      if (layer && layer.data) {
        layer.data.forEach((gid, idx) => {
          if (gid > 0) {
            const type = i === 0 ? 'dirt' : 'boardwalk';
            const localIdx = state.tileIndex[type + 'Globals'].length;
            state.tileIndex[type + 'Globals'].push(idx);
            state.tileIndex.globalToTile.set(idx, { tileType: type, localIndex: localIdx });
            state.tileIndex.tileToGlobal[type].set(localIdx, idx);
          }
        });
      }
    });
  }

  function computeRenderBounds(mapData) {
    const allGlobals = state.tileIndex.dirtGlobals.concat(state.tileIndex.boardwalkGlobals);
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    allGlobals.forEach(idx => {
      const [x, y] = [idx % mapData.width, Math.floor(idx / mapData.width)];
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    });
    state.renderBounds = { minX: clamp(minX - GARDEN_MARGIN, 0, mapData.width - 1), minY: clamp(minY - GARDEN_MARGIN, 0, mapData.height - 1), maxX: clamp(maxX + GARDEN_MARGIN, 0, mapData.width - 1), maxY: clamp(maxY + GARDEN_MARGIN, 0, mapData.height - 1), gardenMinX: minX, gardenMinY: minY, gardenMaxX: maxX, gardenMaxY: maxY };
  }

  function buildTilemap(mapData) {
    const b = state.renderBounds;
    const tilemap = (PIXI.tilemap && PIXI.tilemap.CompositeTilemap) ? new PIXI.tilemap.CompositeTilemap() : new PIXI.Container();
    const assets = { wood: [getTextureSafe('tile/WoodPlatform_A'), getTextureSafe('tile/WoodPlatform_B')], dirt: ['A', 'B', 'C'].map(suffix => getTextureSafe('tile/Dirt_' + suffix)) };
    mapData.layers.filter(l => l.type === 'tilelayer' && l.data && l.name !== 'Override' && (l.visible || l.class === 'BoardwalkTiles' || l.name.includes('BoardwalkTiles') || l.class === 'DirtTiles')).forEach(layer => {
      const isBW = layer.class === 'BoardwalkTiles' || (layer.name && layer.name.includes('BoardwalkTiles'));
      const isDirt = layer.class === 'DirtTiles';
      for (let y = b.minY; y <= b.maxY; y++) {
        for (let x = b.minX; x <= b.maxX; x++) {
          const gid = layer.data[y * mapData.width + x]; if (!gid) continue;
          let texture = isBW ? assets.wood[(x + y) % 2] : (isDirt ? assets.dirt[(x + y * 3) % 3] : getTextureForGid(gid, mapData.tilesets));
          if (!texture || texture === PIXI.Texture.EMPTY) continue;
          const [worldX, worldY] = [(x - b.minX) * TILE_SIZE_WORLD, (y - b.minY) * TILE_SIZE_WORLD - (texture.height - TILE_SIZE_WORLD)];
          if (tilemap.tile) tilemap.tile(texture, worldX, worldY, { rotate: isBW ? PIXI.groupD8.E : tiledFlipsToGroupD8(...Object.values(getTileFlipFlags(gid))) });
          else { const s = new PIXI.Sprite(texture); s.position.set(worldX, worldY); tilemap.addChild(s); }
        }
      }
    });
    return tilemap;
  }

  function focusGarden() { const b = state.renderBounds; if (!b) return; state.targetCenter = { x: ((b.gardenMinX + b.gardenMaxX + 1) / 2 - b.minX) * TILE_SIZE_WORLD, y: ((b.gardenMinY + b.gardenMaxY + 1) / 2 - b.minY) * TILE_SIZE_WORLD }; state.tileSize = 180; updateCamera(); }

  function openModal(title, text, primaryLabel, secondaryLabel, primaryHandler, secondaryHandler) {
    dom.modalTitle.textContent = title; dom.modalText.value = text; dom.modalPrimary.textContent = primaryLabel; dom.modalSecondary.textContent = secondaryLabel || 'Cancel';
    dom.modalPrimary.onclick = primaryHandler; dom.modalSecondary.onclick = secondaryHandler || closeModal; dom.modal.classList.add('show');
  }

  function closeModal() { dom.modal.classList.remove('show'); }

  function openImportModal() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => { try { applyImport(JSON.parse(event.target.result)); } catch (err) { alert('Invalid JSON file'); } };
      reader.readAsText(file);
    };
    input.click();
  }

  function createAriesExportPayload() {
    const tileObjects = {}, boardwalkTileObjects = {};
    for (const entry of state.placed.values()) {
      const globalIdx = state.tileIndex.tileToGlobal[entry.tileType].get(entry.localIndex);
      if (globalIdx === undefined) continue;
      let obj = (entry.category === 'plant' || entry.category === 'tallplant') ? { objectType: 'plant', species: entry.decorId, slots: [{ species: entry.decorId, startTime: Date.now(), endTime: Date.now() + 60000, targetScale: 1.0, mutations: entry.mutations || [] }], plantedAt: Date.now(), maturedAt: Date.now() } : { objectType: 'decor', decorId: entry.decorId, rotation: entry.rotation };
      if (entry.tileType === 'dirt') tileObjects[String(globalIdx)] = obj; else boardwalkTileObjects[String(globalIdx)] = obj;
    }
    return { tileObjects, boardwalkTileObjects };
  }

  function downloadText(filename, text) { const blob = new Blob([text], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }

  function applyImport(payload) {
    const garden = payload.garden || payload; if (!garden.tileObjects && !garden.boardwalkTileObjects) return;
    state.placed.clear(); clearDecorSprites();
    const isAries = !payload.version && !payload.garden;
    const apply = (objs, type) => { if (!objs) return; Object.keys(objs).forEach(k => { const e = objs[k]; if (!e) return; const local = isAries ? state.tileIndex.globalToTile.get(Number(k)) : Number(k); if (local === undefined) return; const tileType = (typeof local === 'object') ? local.tileType : type, localIdx = (typeof local === 'object') ? local.localIndex : local; if (e.objectType === 'decor') setDecorAt(tileType, localIdx, e.decorId, e.rotation ?? 0); else if (['plant', 'tallplant', 'egg'].includes(e.objectType)) { const spec = e.species || e.eggId, muts = (e.slots && e.slots.length > 0) ? (e.slots[e.slots.length - 1].mutations || []) : []; setDecorAt(tileType, localIdx, spec, 0, muts); } }); };
    apply(garden.tileObjects, 'dirt'); apply(garden.boardwalkTileObjects, 'boardwalk'); updatePlacedCount();
  }

  function saveAutosave() { try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(createAriesExportPayload())); } catch { } }
  function loadAutosave() { try { const saved = localStorage.getItem(AUTOSAVE_KEY); if (saved) applyImport(JSON.parse(saved)); } catch { } }

  async function init() {
    setLoading('Loading initial metadata...'); showLoading(true);
    try {
      const buster = `?v=${Date.now()}`;
      const [decorData, mapData] = await Promise.all([
        fetch(`${ASSET_BASE}decor-data.json${buster}`).then(r => r.json()),
        fetch(`${ASSET_BASE}map.json${buster}`).then(r => r.json())
      ]);
      state.decorData = decorData; state.decorData.forEach(d => state.decorById.set(d.decorId, d)); state.mapData = mapData;

      setLoading('Loading sprite assets...');
      const assetList = [
        { alias: 'tiles', src: `${ASSET_BASE}tiles.json${buster}` },
        { alias: 'sprites-0', src: `${ASSET_BASE}sprites-0.json${buster}` },
        { alias: 'sprites-1', src: `${ASSET_BASE}sprites-1.json${buster}` },
        { alias: 'flat-sprites', src: `${ASSET_BASE}flat-sprites.json${buster}` }
      ];

      for (let i = 0; i < assetList.length; i++) {
        const asset = assetList[i];
        setLoading(`Loading ${asset.alias} (${i + 1}/${assetList.length})...`);
        try {
          PIXI.Assets.add({ alias: asset.alias, src: asset.src });
          await PIXI.Assets.load(asset.alias);
          console.log(`[Asset Loaded] ${asset.alias}`);
        } catch (e) {
          console.error(`[Asset Failed] ${asset.alias}:`, e);
          throw new Error(`Failed to load ${asset.alias}: ${e.message}`);
        }
      }


      setLoading('Initializing renderer...');
      state.app = new PIXI.Application();
      await state.app.init({ resizeTo: dom.canvasWrap, backgroundAlpha: 0, antialias: false, autoDensity: true });
      dom.canvasWrap.appendChild(state.app.canvas);

      state.camera = new PIXI.Container(); state.world = new PIXI.Container({ sortableChildren: true }); state.overlay = new PIXI.Container({ sortableChildren: true });
      buildTileIndex(mapData); computeRenderBounds(mapData);
      state.world.addChild(buildTilemap(mapData));
      state.camera.addChild(state.world, state.overlay); state.app.stage.addChild(state.camera);

      const gOutline = new PIXI.Graphics(); const [b, g] = [state.renderBounds, gOutline];
      g.rect((b.gardenMinX - b.minX) * TILE_SIZE_WORLD, (b.gardenMinY - b.minY) * TILE_SIZE_WORLD, (b.gardenMaxX - b.gardenMinX + 1) * TILE_SIZE_WORLD, (b.gardenMaxY - b.gardenMinY + 1) * TILE_SIZE_WORLD);
      g.stroke({ width: 6, color: 0xff3b2f, alpha: 0.9 });
      state.gardenOutline = g; state.overlay.addChild(g);
      state.hoverOutline = new PIXI.Graphics(); state.overlay.addChild(state.hoverOutline);
      focusGarden();

      dom.slotLabel.textContent = String(GARDEN_SLOT).padStart(2, '0');
      renderDecorList(); updateRotationLabel(); updatePlacedCount(); loadAutosave(); bindEvents();

      showLoading(false);
    } catch (err) {
      console.error("Initialization Failed:", err);
      setLoading(`Error: ${err.message || 'Unknown error'}. Check console.`);
    }
  }
  init();
})();