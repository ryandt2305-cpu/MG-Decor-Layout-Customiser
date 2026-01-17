(() => {
  const ASSET_BASE = './assets/';
  const TILE_SIZE_WORLD = 256;
  const GARDEN_SLOT = 5;
  const GARDEN_MARGIN = 6;
  const ABS_MIN_TILE_SIZE = 16;
  const ABS_MAX_TILE_SIZE = 512;
  const AUTOSAVE_KEY = 'mg-decorcustomiser-autosave-v1';
  const MUTATION_ORDER = [
    'Gold', 'Rainbow', 'Wet', 'Chilled', 'Frozen',
    'Dawnlit', 'Ambershine', 'Dawncharged', 'Ambercharged', 'Custom'
  ];
  const MUT_META = {
    Gold: { overlayTall: null, tallIconOverride: null },
    Rainbow: { overlayTall: null, tallIconOverride: null },
    Wet: { overlayTall: "sprite/mutation-overlay/WetTallPlant", tallIconOverride: "sprite/mutation/Puddle" },
    Chilled: { overlayTall: "sprite/mutation-overlay/ChilledTallPlant", tallIconOverride: "sprite/mutation/Chilled" },
    Frozen: { overlayTall: "sprite/mutation-overlay/FrozenTallPlant", tallIconOverride: "sprite/mutation/Frozen" },
    Dawnlit: { overlayTall: null, tallIconOverride: null },
    Ambershine: { overlayTall: null, tallIconOverride: null },
    Dawncharged: { overlayTall: null, tallIconOverride: null },
    Ambercharged: { overlayTall: null, tallIconOverride: null },
    Custom: { overlayTall: null, tallIconOverride: null }
  };
  // Canvas2D compatible filter config (CSS colors for compositing)
  const FILTERS = {
    Gold: { colors: ['rgb(235,200,0)'], alpha: 0.7 },
    Rainbow: { colors: ['#FF1744', '#FF9100', '#FFEA00', '#00E676', '#2979FF', '#D500F9'], angle: 130, angleTall: 0, masked: true },
    Wet: { colors: ['rgb(50,180,200)'], alpha: 0.25 },
    Chilled: { colors: ['rgb(100,160,210)'], alpha: 0.45 },
    Frozen: { colors: ['rgb(100,130,220)'], alpha: 0.5 },
    Dawnlit: { colors: ['rgb(209,70,231)'], alpha: 0.5 },
    Ambershine: { colors: ['rgb(190,100,40)'], alpha: 0.5 },
    Dawncharged: { colors: ['rgb(140,80,200)'], alpha: 0.5 },
    Ambercharged: { colors: ['rgb(170,60,25)'], alpha: 0.5 },
    Custom: { colors: ['#ff00ff'], alpha: 0.5 }
  };

  // ======================
  // Texture and Thumbnail Caching
  // ======================
  const thumbnailCache = new Map(); // key: spriteId -> HTMLCanvasElement
  const mutatedTextureCache = new Map(); // key: "decorId|rotation|mutations" -> PIXI.Texture

  /**
   * Extract a sprite texture to a canvas using direct Canvas2D (PIXI 8 compatible)
   * PIXI 8 stores the underlying ImageBitmap at texture.source.resource
   */
  function extractTextureToCanvas(texture, targetWidth = 46, targetHeight = 46) {
    if (!texture || texture === PIXI.Texture.EMPTY) return null;

    try {
      // PIXI 8: The actual ImageBitmap is at texture.source.resource
      const src = texture.source?.resource;
      if (!src || !src.width) {
        console.warn('[extractTextureToCanvas] No valid source.resource found');
        return null;
      }

      // Get frame dimensions for spritesheet textures
      const frame = texture.frame || { x: 0, y: 0, width: src.width, height: src.height };
      const srcW = frame.width;
      const srcH = frame.height;
      const srcX = frame.x || 0;
      const srcY = frame.y || 0;

      // Create output canvas
      const outCanvas = document.createElement('canvas');
      outCanvas.width = targetWidth;
      outCanvas.height = targetHeight;
      const ctx = outCanvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;

      // Calculate scale to fit with padding
      const scale = Math.min((targetWidth - 6) / srcW, (targetHeight - 6) / srcH, 1);
      const dstW = srcW * scale;
      const dstH = srcH * scale;
      const offsetX = (targetWidth - dstW) / 2;
      const offsetY = (targetHeight - dstH) / 2;

      // Draw from source (ImageBitmap works with drawImage)
      ctx.drawImage(src, srcX, srcY, srcW, srcH, offsetX, offsetY, dstW, dstH);
      return outCanvas;
    } catch (e) {
      console.warn('[extractTextureToCanvas] Failed:', e.message);
      return null;
    }
  }

  /**
   * Get or create a cached thumbnail canvas for a sprite ID
   */
  function getThumbnail(spriteId) {
    if (thumbnailCache.has(spriteId)) return thumbnailCache.get(spriteId);

    const texture = getTextureSafe(spriteId);
    if (texture === PIXI.Texture.EMPTY) return null;

    const canvas = extractTextureToCanvas(texture, 46, 46);
    if (canvas) thumbnailCache.set(spriteId, canvas);
    return canvas;
  }

  /**
   * Apply a color tint to a canvas using source-atop compositing (game parity)
   */
  function applyCanvasTint(ctx, width, height, colorHex, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colorHex;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  /**
   * Apply rainbow gradient to a canvas
   */
  function applyRainbowGradient(ctx, width, height, alpha, isTall = false) {
    const colors = ['#FF1744', '#FF9100', '#FFEA00', '#00E676', '#2979FF', '#D500F9'];
    const grad = isTall
      ? ctx.createLinearGradient(0, 0, 0, height)  // vertical for tall
      : ctx.createLinearGradient(0, 0, width, height); // diagonal for normal
    colors.forEach((c, i) => grad.addColorStop(i / (colors.length - 1), c));

    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  /**
   * Convert hex color (0xRRGGBB) to CSS hex string
   */
  function hexToCSS(hex) {
    return '#' + hex.toString(16).padStart(6, '0');
  }

  /**
   * Bake mutations onto a sprite texture using Canvas2D
   */
  async function bakeMutatedTexture(decorId, rotation, mutations) {
    const cacheKey = `${decorId}|${rotation}|${mutations.sort().join(',')}`;
    if (mutatedTextureCache.has(cacheKey)) return mutatedTextureCache.get(cacheKey);

    // Get base texture
    const data = state.decorById.get(decorId) || { decorId, sprite: decorId };
    const baseTex = getTextureSafe(data.sprite || decorId);
    if (baseTex === PIXI.Texture.EMPTY) return null;

    // Extract base to canvas
    const baseSprite = new PIXI.Sprite(baseTex);
    baseSprite.anchor.set(0);
    if (!state.app?.renderer) return null;

    let sourceCanvas;
    try {
      sourceCanvas = await state.app.renderer.extract.canvas(baseSprite);
    } catch (e) {
      console.warn('[bakeMutatedTexture] Extract failed:', e.message);
      baseSprite.destroy();
      return null;
    }
    baseSprite.destroy();

    // Create working canvas
    const canvas = document.createElement('canvas');
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // Draw base
    ctx.drawImage(sourceCanvas, 0, 0);

    // Apply mutations
    if (mutations && mutations.length > 0) {
      const isTall = decorId.includes('tallplant');
      const sorted = [...mutations].sort((a, b) => MUTATION_ORDER.indexOf(a) - MUTATION_ORDER.indexOf(b));

      // Determine final color mutation (Gold takes priority, then Rainbow)
      const hasGold = sorted.includes('Gold');
      const hasRainbow = sorted.includes('Rainbow');

      if (hasGold) {
        const conf = FILTERS.Gold;
        const color = conf.colors ? conf.colors[0] : (conf.color != null ? hexToCSS(conf.color) : '#fff');
        applyCanvasTint(ctx, canvas.width, canvas.height, color, conf.alpha);
      } else if (hasRainbow) {
        applyRainbowGradient(ctx, canvas.width, canvas.height, 0.7, isTall);
      } else {
        // Apply all other tint mutations
        for (const mut of sorted) {
          const conf = FILTERS[mut];
          if (conf) {
            const color = conf.colors ? conf.colors[0] : (conf.color != null ? hexToCSS(conf.color) : null);
            if (color) {
              applyCanvasTint(ctx, canvas.width, canvas.height, color, conf.alpha || 0.5);
            }
          }
        }
      }

      // Apply overlay sprites for tall plants (Wet, Chilled, Frozen)
      for (const mut of sorted) {
        const meta = MUT_META[mut];
        if (isTall && meta?.overlayTall) {
          const overlayTex = getTextureSafe(meta.overlayTall);
          if (overlayTex !== PIXI.Texture.EMPTY) {
            try {
              const overlaySprite = new PIXI.Sprite(overlayTex);
              const overlayCanvas = await state.app.renderer.extract.canvas(overlaySprite);
              overlaySprite.destroy();

              // Draw overlay centered at bottom
              const ox = (canvas.width - overlayCanvas.width) / 2;
              const oy = canvas.height - overlayCanvas.height;
              ctx.drawImage(overlayCanvas, ox, oy);
            } catch (e) {
              console.warn('[bakeMutatedTexture] Overlay failed:', mut, e.message);
            }
          }
        }
      }
    }

    // Create PIXI texture from canvas
    const resultTex = PIXI.Texture.from(canvas);
    mutatedTextureCache.set(cacheKey, resultTex);
    return resultTex;
  }

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
    cropsBtn: document.getElementById('cropsBtn'),
    otherBtn: document.getElementById('otherBtn'),
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
    activeTab: 'decor',
    selectedMutations: [],
    cropData: [],
    otherData: [],
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
    const baseFrame = data.sprite;
    const baseTex = getTextureSafe(baseFrame);
    if (baseTex === PIXI.Texture.EMPTY) return null;

    const category = data.category || (decorId.startsWith('sprite/decor/') ? 'decor' : 'other');
    const container = new PIXI.Container();
    container.sortableChildren = true;
    container.decorId = decorId;
    container.rotation = (rotation * Math.PI) / 180;
    container.mutations = [...mutations];
    container.category = category;

    const base = new PIXI.Sprite(baseTex);
    base.anchor.set(0.5);
    base.zIndex = 0;
    container.addChild(base);

    applyMutationEffects(container, base, mutations, decorId, category);
    return container;
  }

  /**
   * Apply Canvas2D gradient fill for mutations (game parity)
   */
  function fillGradient(ctx, w, h, filter, isTall) {
    const colors = filter.colors || ['#fff'];
    const angle = (isTall && filter.angleTall != null) ? filter.angleTall : (filter.angle ?? 90);
    const rad = ((angle - 90) * Math.PI) / 180;
    const cx = w / 2, cy = h / 2;
    const r = (Math.abs(Math.cos(rad)) * w) / 2 + (Math.abs(Math.sin(rad)) * h) / 2;
    const grad = ctx.createLinearGradient(cx - Math.cos(rad) * r, cy - Math.sin(rad) * r, cx + Math.cos(rad) * r, cy + Math.sin(rad) * r);
    if (colors.length === 1) {
      grad.addColorStop(0, colors[0]);
      grad.addColorStop(1, colors[0]);
    } else {
      colors.forEach((c, i) => grad.addColorStop(i / (colors.length - 1), c));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * Apply a single mutation filter onto a canvas layer using Canvas2D compositing
   */
  function applyFilterOntoCanvas(ctx, sourceCanvas, mutName, isTall) {
    const filter = FILTERS[mutName];
    if (!filter) return;
    const w = sourceCanvas.width, h = sourceCanvas.height;
    ctx.save();
    // Use source-in to create tinted silhouette (game parity)
    ctx.globalCompositeOperation = filter.masked ? 'source-atop' : 'source-in';
    if (filter.alpha != null) ctx.globalAlpha = filter.alpha;
    if (filter.masked) {
      const m = document.createElement('canvas');
      m.width = w; m.height = h;
      const mctx = m.getContext('2d');
      mctx.imageSmoothingEnabled = false;
      fillGradient(mctx, w, h, filter, isTall);
      mctx.globalCompositeOperation = 'destination-in';
      mctx.drawImage(sourceCanvas, 0, 0);
      ctx.drawImage(m, 0, 0);
    } else {
      fillGradient(ctx, w, h, filter, isTall);
    }
    ctx.restore();
  }

  /**
   * Normalize mutation list for color (Gold > Rainbow > other tints)
   */
  function normalizeMutationsForColor(mutations) {
    if (!mutations || !mutations.length) return [];
    const unique = [...new Set(mutations)];
    if (unique.includes('Gold')) return ['Gold'];
    if (unique.includes('Rainbow')) return ['Rainbow'];
    // Warm mutations cancel out cold ones
    const warm = ['Ambershine', 'Dawnlit', 'Dawncharged', 'Ambercharged'];
    const hasWarm = unique.some(m => warm.includes(m));
    if (hasWarm) return unique.filter(m => !['Wet', 'Chilled', 'Frozen'].includes(m));
    return unique;
  }

  /**
   * Apply mutation effects using Canvas2D compositing (game parity)
   */
  function applyMutationEffects(container, baseSprite, mutations, decorId, category) {
    // Skip mutations for decor items
    if (category === 'decor' || !mutations || mutations.length === 0) return;

    const isTall = decorId.includes('tallplant');
    const colorMuts = normalizeMutationsForColor(mutations);
    const sorted = [...mutations].sort((a, b) => MUTATION_ORDER.indexOf(a) - MUTATION_ORDER.indexOf(b));

    // Apply color mutations via Canvas2D layers
    if (colorMuts.length > 0) {
      const w = baseSprite.texture.width;
      const h = baseSprite.texture.height;

      for (const mutName of colorMuts) {
        const layer = document.createElement('canvas');
        layer.width = w; layer.height = h;
        const lctx = layer.getContext('2d');
        lctx.imageSmoothingEnabled = false;

        // First draw base sprite silhouette
        const baseCanvas = document.createElement('canvas');
        baseCanvas.width = w; baseCanvas.height = h;
        const bctx = baseCanvas.getContext('2d');
        bctx.imageSmoothingEnabled = false;
        // Draw base texture to canvas
        const src = baseSprite.texture.source?.resource;
        if (src) {
          const frame = baseSprite.texture.frame;
          bctx.drawImage(src, frame.x, frame.y, frame.width, frame.height, 0, 0, w, h);
        }

        // Copy base to layer then apply filter
        lctx.drawImage(baseCanvas, 0, 0);
        applyFilterOntoCanvas(lctx, baseCanvas, mutName, isTall);

        // Create PIXI sprite from tinted layer
        const tex = PIXI.Texture.from(layer);
        const sprite = new PIXI.Sprite(tex);
        sprite.anchor.set(0.5);
        sprite.zIndex = 1;
        container.addChild(sprite);
      }
    }

    // Add overlay sprites for tall plants (Wet, Chilled, Frozen ice/water effects)
    for (const mut of sorted) {
      const meta = MUT_META[mut];
      if (isTall && meta?.overlayTall) {
        const overlayTex = getTextureSafe(meta.overlayTall);
        if (overlayTex !== PIXI.Texture.EMPTY) {
          const overlay = new PIXI.Sprite(overlayTex);
          overlay.anchor.set(0.5, 0.5);
          overlay.position.y = baseSprite.height * 0.3;
          overlay.zIndex = 2;
          overlay.alpha = 0.8;
          container.addChild(overlay);
        }
      }
    }
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
      const sprite = createDecorSprite(entry.decorId, entry.rotation, entry.mutations);
      if (!sprite) continue;
      const worldPos = gridToWorld(entry.gridX, entry.gridY);
      sprite.position.set(worldPos.x, worldPos.y);
      const bottomOffset = sprite.getLocalBounds().maxY;
      sprite.zIndex = calculateZIndex(worldPos.y, bottomOffset);
      state.world.addChild(sprite);
      state.sprites.set(key, sprite);
    }
  }

  function setDecorAt(tileType, localIndex, decorId, rotation, mutations = []) {
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
    state.placed.set(key, { tileType, localIndex, decorId, rotation, gridX, gridY, category, mutations: [...mutations] });
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
    if (state.pointerState.isPanning) {
      if (state.ghost) state.ghost.displayObject.visible = false;
      return;
    }
    const hover = state.lastHover;
    if (!state.selectedDecorId || !hover || !hover.valid) {
      if (state.ghost) state.ghost.displayObject.visible = false;
      return;
    }
    const mutKey = JSON.stringify(state.selectedMutations);
    if (!state.ghost || state.ghost.decorId !== state.selectedDecorId || state.ghost.rotation !== state.selectedRotation || state.ghost.mutKey !== mutKey) {
      if (state.ghost) {
        state.overlay.removeChild(state.ghost.displayObject);
        state.ghost.displayObject.destroy({ children: true });
      }
      const sprite = createDecorSprite(state.selectedDecorId, state.selectedRotation, state.selectedMutations);
      if (!sprite) return;
      sprite.alpha = 0.6;
      state.overlay.addChild(sprite);
      state.ghost = { decorId: state.selectedDecorId, rotation: state.selectedRotation, mutKey: mutKey, displayObject: sprite };
      updateSelectionPreview();
    }
    const pos = gridToWorld(hover.gridX, hover.gridY);
    state.ghost.displayObject.position.set(pos.x, pos.y);
    state.ghost.displayObject.visible = true;
  }

  async function updateSelectionPreview() {
    if (!state.selectedDecorId) { dom.selectionPreview.innerHTML = ''; return; }
    const container = createDecorSprite(state.selectedDecorId, state.selectedRotation, state.selectedMutations);
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
    state.pointerState.isPanning = false;
    if (state.pointerState.pointers.size === 2) {
      const pts = Array.from(state.pointerState.pointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      state.pointerState.pinching = { distance: dist, tileSize: state.tileSize, midpoint: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } };
    }
  }

  function handlePointerMove(event) {
    const pointers = state.pointerState.pointers;
    if (state.pointerState.pinching && pointers.size >= 2) {
      const pts = Array.from(pointers.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const midpoint = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      zoomAt(midpoint, state.pointerState.pinching.tileSize * (dist / state.pointerState.pinching.distance));
      return;
    }
    const pointer = pointers.get(event.pointerId);
    if (pointer) {
      if (!state.pointerState.isPanning && Math.hypot(event.global.x - state.pointerState.startPos.x, event.global.y - state.pointerState.startPos.y) > 5) {
        state.pointerState.isPanning = true;
      }
      if (state.pointerState.isPanning) {
        const prev = { ...pointer };
        pointers.set(event.pointerId, { x: event.global.x, y: event.global.y });
        const zoom = state.camera.scale.x || 1;
        state.targetCenter.x -= (event.global.x - prev.x) / zoom;
        state.targetCenter.y -= (event.global.y - prev.y) / zoom;
        updateCamera();
        return;
      }
    }
    const worldPos = screenToWorld(event.global);
    const { gridX, gridY } = worldToGrid(worldPos.x, worldPos.y);
    const hit = getTileHit(gridX, gridY);
    updateHoverOutline(hit ? { ...hit, gridX, gridY, valid: true } : { gridX, gridY, valid: false });
  }

  function handlePointerUp(event) {
    if (!state.pointerState.pointers.has(event.pointerId)) return;
    state.pointerState.pointers.delete(event.pointerId);
    if (state.pointerState.pointers.size < 2) state.pointerState.pinching = null;
    if (state.pointerState.isPanning) { state.pointerState.isPanning = false; return; }
    const now = Date.now();
    const isDouble = state.lastPointerUp && (now - state.lastPointerUp < 300);
    state.lastPointerUp = now;
    const worldPos = screenToWorld(event.global);
    const { gridX, gridY } = worldToGrid(worldPos.x, worldPos.y);
    const hit = getTileHit(gridX, gridY);
    if (hit) {
      const key = tileKey(hit.tileType, hit.localIndex);
      const existing = state.placed.get(key);
      if (isDouble && existing) { setDecorAt(hit.tileType, hit.localIndex, existing.decorId, (existing.rotation + 90) % 360, existing.mutations); return; }
      if (state.selectedDecorId) setDecorAt(hit.tileType, hit.localIndex, state.selectedDecorId, state.selectedRotation, state.selectedMutations);
      else if (existing) {
        state.selectedDecorId = existing.decorId; state.selectedRotation = existing.rotation; state.selectedMutations = [...(existing.mutations || [])];
        dom.selectedName.textContent = dataFromName(existing.decorId);
        dom.mutationPanel.style.display = (existing.category === 'plant' || existing.category === 'tallplant' || existing.category === 'other') ? 'block' : 'none';
        if (dom.mutationPanel.style.display === 'block') syncMutationCheckboxes();
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
    if (key === ' ' || key === 'escape') {
      state.selectedDecorId = null; state.selectedMutations = [];
      dom.selectedName.textContent = 'None selected'; dom.mutationPanel.style.display = 'none';
      updateGhost(); renderDecorList();
      return;
    }
    if (key === 'r') {
      if (state.lastHover && state.lastHover.valid) {
        const key = tileKey(state.lastHover.tileType, state.lastHover.localIndex);
        const existing = state.placed.get(key);
        if (existing) { setDecorAt(state.lastHover.tileType, state.lastHover.localIndex, existing.decorId, (existing.rotation + 90) % 360, existing.mutations); return; }
      }
      if (state.selectedDecorId) rotateBy(90);
    }
    if (['d', 's', 'o'].includes(key)) {
      event.preventDefault();
      state.activeTab = key === 'd' ? 'decor' : (key === 's' ? 'crop' : 'other');
      dom.decorModal.style.display = 'flex'; updateMenuButtons(); renderDecorList(); dom.searchDecor.focus();
    }
  }

  function handleWheel(event) { event.preventDefault(); zoomAt({ x: event.clientX, y: event.clientY }, state.tileSize * (event.deltaY > 0 ? 0.92 : 1.08)); }

  function bindEvents() {
    state.app.stage.eventMode = 'static';
    state.app.stage.hitArea = new PIXI.Rectangle(0, 0, (state.renderBounds.maxX - state.renderBounds.minX + 1) * TILE_SIZE_WORLD, (state.renderBounds.maxY - state.renderBounds.minY + 1) * TILE_SIZE_WORLD);
    state.app.stage.on('pointerdown', handlePointerDown); state.app.stage.on('pointermove', handlePointerMove); state.app.stage.on('pointerup', handlePointerUp); state.app.stage.on('pointerupoutside', handlePointerUp);
    dom.canvasWrap.addEventListener('wheel', handleWheel, { passive: false }); dom.canvasWrap.addEventListener('contextmenu', handleRightClick);
    window.addEventListener('keydown', handleKeyDown); window.addEventListener('resize', updateCamera);
    dom.searchDecor.addEventListener('input', () => renderDecorList());
    dom.decorBtn.addEventListener('click', () => { state.activeTab = 'decor'; updateMenuButtons(); dom.decorModal.style.display = 'flex'; renderDecorList(); });
    dom.cropsBtn.addEventListener('click', () => { state.activeTab = 'crop'; updateMenuButtons(); dom.decorModal.style.display = 'flex'; renderDecorList(); });
    dom.otherBtn.addEventListener('click', () => { state.activeTab = 'other'; updateMenuButtons(); dom.decorModal.style.display = 'flex'; renderDecorList(); });
    dom.closeDecorModal.addEventListener('click', () => { dom.decorModal.style.display = 'none'; });
    dom.decorModal.addEventListener('click', (e) => { if (e.target === dom.decorModal) dom.decorModal.style.display = 'none'; });
    dom.resetView.addEventListener('click', focusGarden);
    dom.exportBtn.addEventListener('click', () => { downloadText('decor-layout.json', JSON.stringify(createAriesExportPayload(), null, 2)); });
    dom.importBtn.addEventListener('click', openImportModal);
    dom.modalClose.addEventListener('click', closeModal);
    if (dom.closeTooltip) dom.closeTooltip.addEventListener('click', () => { dom.controlsTooltip.style.display = 'none'; });
  }

  function buildMutationCheckboxes() {
    dom.mutationList.innerHTML = '';
    MUTATION_ORDER.forEach((mut) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.value = mut;
      input.addEventListener('change', () => { state.selectedMutations = Array.from(dom.mutationList.querySelectorAll('input:checked')).map(cb => cb.value); updateGhost(); });
      label.appendChild(input); label.appendChild(document.createTextNode(mut)); dom.mutationList.appendChild(label);
    });
  }

  function syncMutationCheckboxes() { dom.mutationList.querySelectorAll('input').forEach(cb => { cb.checked = state.selectedMutations.includes(cb.value); }); }

  function updateMenuButtons() { [dom.decorBtn, dom.cropsBtn, dom.otherBtn].forEach(btn => btn.classList.toggle('primary', (state.activeTab === 'decor' && btn === dom.decorBtn) || (state.activeTab === 'crop' && btn === dom.cropsBtn) || (state.activeTab === 'other' && btn === dom.otherBtn))); }

  function renderDecorList() {
    const activeData = state.activeTab === 'decor' ? state.decorData : (state.activeTab === 'crop' ? state.cropData : state.otherData);
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
        state.selectedDecorId = decor.decorId;
        dom.selectedName.textContent = decor.name;
        dom.mutationPanel.style.display = (state.activeTab === 'crop' || state.activeTab === 'other') ? 'block' : 'none';
        if (state.activeTab === 'decor') state.selectedMutations = [];
        syncMutationCheckboxes();
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

      const flat = PIXI.Assets.get('flat-sprites');
      const targetFrames = (flat && flat.data) ? flat.data.frames : (flat ? (flat.frames || flat.texture?.data?.frames) : null);
      if (targetFrames) {
        Object.keys(targetFrames).filter(k => k.startsWith('sprite/')).forEach(k => {
          const item = { decorId: k, name: k.split('/').pop().replace(/([A-Z])/g, ' $1').trim(), category: k.includes('plant') ? (k.includes('tallplant') ? 'tallplant' : 'plant') : 'other' };
          (item.category === 'plant' || item.category === 'tallplant' ? state.cropData : state.otherData).push(item);
        });
      }
      [state.cropData, state.otherData].forEach(arr => arr.sort((a, b) => a.name.localeCompare(b.name)));

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
      buildMutationCheckboxes(); renderDecorList(); updateRotationLabel(); updatePlacedCount(); loadAutosave(); bindEvents();

      state.app.ticker.add(t => {
        const d = t.deltaTime * 2;
        [state.ghost?.displayObject, ...state.world.children].filter(c => c).forEach(c => {
          (c.children || []).forEach(child => { if (child.isRainbow && child.filters) child.filters.forEach(f => { if (f instanceof PIXI.ColorMatrixFilter) f.hue((f.hue || 0) + d); }); });
        });
      });
      showLoading(false);
    } catch (err) {
      console.error("Initialization Failed:", err);
      setLoading(`Error: ${err.message || 'Unknown error'}. Check console.`);
    }
  }
  init();
})();