import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type { SessionId, SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  SessionProviderComponent,
  SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import css from './MultiChatCanvas.module.css'

const STORAGE_KEY = 'dsh.v2.multi-chat-canvas'
/** Bumped from 1 when tile track sizes joined the record; version 1 migrates. */
const SCHEMA_VERSION = 2
const CARD_WIDTH = 430
const CARD_HEIGHT = 480
const CARD_GAP_X = 22
const CARD_GAP_Y = 22
const WORLD_PADDING = 24
const MIN_ZOOM = 0.45
const MAX_ZOOM = 1
const MAX_SEEDED_CARDS = 6
const CANVAS_MIME = 'application/x-dsh-canvas-session'
const TILE_MIN_COLUMN = 430
const TILE_MIN_ROW = 320
/* Panels sit flush: the divider is each panel's own 1px trailing border, so
   the grid contributes no gutter and no page padding. */
const TILE_GAP = 0
const TILE_PAD = 0
const MAX_TILE_COLUMNS = 4
/** Narrowest a tile column may be dragged to before the composer stops fitting. */
const TILE_MIN_COLUMN_PX = 260
/** Free-mode floors, matching the card's own CSS minimums. */
const FREE_MIN_WIDTH = 300
const FREE_MIN_HEIGHT = 340
/** One arrow-key press worth of resize on a focused handle. */
const KEY_STEP = 32

type CanvasMode = 'tile' | 'free'
type ColumnChoice = 'auto' | 1 | 2 | 3 | 4
/** The eight grab points: four edges and four corners. */
type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const EDGES: readonly Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
const SIDE_EDGES: readonly Edge[] = ['n', 's', 'e', 'w']

interface CanvasCard {
  id: SessionId
  x: number
  y: number
  width: number
  height: number
  z: number
}

/** Tile-mode track sizes for one resolved column count. */
interface TrackSizes {
  /** Column weights, in `fr` units; an empty array means every column is even. */
  cols: number[]
  /** Row heights in pixels; short arrays fall back to the computed row height. */
  rows: number[]
}

interface CanvasState {
  cards: CanvasCard[]
  zoom: number
  mode: CanvasMode
  columns: ColumnChoice
  /**
   * Track sizes keyed by the resolved column count, so switching between Auto,
   * 2 and 3 columns restores what was dragged for each rather than discarding
   * it. Absent keys size themselves.
   */
  tracks: Record<string, TrackSizes>
}

interface MultiChatCanvasProps {
  useSessions: SnapshotSelectorHook<SessionListState>
  SessionProvider: SessionProviderComponent
  renderConversation: () => ReactNode
  onSelectSession: (id: SessionId) => void
  onStartSession?: () => void
}

interface PointerDrag {
  id: SessionId
  offsetX: number
  offsetY: number
}

/** A live resize gesture, captured once at pointer-down so deltas never compound. */
interface ResizeGesture {
  id: SessionId
  edge: Edge
  startX: number
  startY: number
  card: CanvasCard
  colIndex: number
  rowIndex: number
  cols: number[]
  rows: number[]
  contentWidth: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function cardAt(id: SessionId, index: number): CanvasCard {
  const columns = 2
  return {
    id,
    x: WORLD_PADDING + (index % columns) * (CARD_WIDTH + CARD_GAP_X),
    y: WORLD_PADDING + Math.floor(index / columns) * (CARD_HEIGHT + CARD_GAP_Y),
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    z: index,
  }
}

const DEFAULT_CANVAS: CanvasState = { cards: [], zoom: 0.82, mode: 'tile', columns: 'auto', tracks: {} }

/** Read one persisted {@link TrackSizes}; anything malformed sizes itself instead. */
function readTracks(value: unknown): Record<string, TrackSizes> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, TrackSizes> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as { cols?: unknown; rows?: unknown }
    const cols = Array.isArray(record.cols)
      ? record.cols.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
      : []
    const rows = Array.isArray(record.rows)
      ? record.rows.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
      : []
    if (cols.length > 0 || rows.length > 0) out[key] = { cols, rows }
  }
  return out
}

/**
 * Restore the canvas. A version 1 record keeps its cards, zoom, mode and
 * columns and simply gains empty track sizes, so an existing layout survives
 * the schema bump instead of being thrown away.
 */
function readCanvasState(): CanvasState {
  if (typeof window === 'undefined') return DEFAULT_CANVAS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_CANVAS
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_CANVAS
    const record = parsed as {
      version?: unknown
      cards?: unknown
      zoom?: unknown
      mode?: unknown
      columns?: unknown
      tracks?: unknown
    }
    if (record.version !== 1 && record.version !== SCHEMA_VERSION) return DEFAULT_CANVAS
    if (!Array.isArray(record.cards)) return DEFAULT_CANVAS
    const cards = record.cards.flatMap((value): CanvasCard[] => {
      if (typeof value !== 'object' || value === null) return []
      const card = value as Record<string, unknown>
      if (typeof card.id !== 'string') return []
      if (typeof card.x !== 'number' || typeof card.y !== 'number') return []
      if (typeof card.width !== 'number' || typeof card.height !== 'number') return []
      if (typeof card.z !== 'number') return []
      return [{
        id: card.id as SessionId,
        x: card.x,
        y: card.y,
        width: card.width,
        height: card.height,
        z: card.z,
      }]
    })
    const zoom = typeof record.zoom === 'number' ? clamp(record.zoom, MIN_ZOOM, MAX_ZOOM) : 0.82
    const mode: CanvasMode = record.mode === 'free' ? 'free' : 'tile'
    const columns: ColumnChoice = record.columns === 1 || record.columns === 2 || record.columns === 3 || record.columns === 4
      ? record.columns
      : 'auto'
    return { cards, zoom, mode, columns, tracks: record.version === 1 ? {} : readTracks(record.tracks) }
  } catch {
    return DEFAULT_CANVAS
  }
}

function sessionStatus(summary: SessionSummary): { label: string; tone: 'live' | 'waiting' | 'idle' } {
  if (summary.pendingInteraction !== undefined) return { label: 'Needs input', tone: 'waiting' }
  if (summary.running) return { label: 'Running', tone: 'live' }
  return { label: 'Idle', tone: 'idle' }
}

/** Grow an array to `length`, filling new slots with `fill`. */
function padTo(values: readonly number[], length: number, fill: number): number[] {
  const out = values.slice(0, length)
  while (out.length < length) out.push(fill)
  return out
}

export function MultiChatCanvas({
  useSessions,
  SessionProvider,
  renderConversation,
  onSelectSession,
  onStartSession,
}: MultiChatCanvasProps) {
  const list = useSessions(state => state)
  const summaries = list.byId as Record<string, SessionSummary>
  const availableIds = useMemo(
    () => list.ids.filter(id => summaries[id]?.blank === false),
    [list.ids, summaries],
  )
  const availableIdSet = useMemo(() => new Set(availableIds.map(id => String(id))), [availableIds])
  // Pruning tracks whether the SESSION still exists, not whether it has a
  // transcript: a chat started from the canvas is blank until its first turn,
  // and pruning on blankness would close its tile the moment it opened.
  const knownIdSet = useMemo(() => new Set(list.ids.map(id => String(id))), [list.ids])
  const seeded = useRef(false)
  const [canvas, setCanvas] = useState<CanvasState>(readCanvasState)
  const [canvasSize, setCanvasSize] = useState({ width: 1200, height: 760 })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [draggingId, setDraggingId] = useState<SessionId | null>(null)
  const [reorderTargetId, setReorderTargetId] = useState<SessionId | null>(null)
  const [resizingId, setResizingId] = useState<SessionId | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const worldRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const pointerDrag = useRef<PointerDrag | null>(null)
  const resize = useRef<ResizeGesture | null>(null)
  const resizeFrame = useRef<number | null>(null)
  const pendingNewSession = useRef(false)

  useEffect(() => {
    // Seeding must wait for the arrival lifecycle to reach 'ready'. The list
    // streams in, so seeding on the first non-empty snapshot placed whichever
    // single session had landed by then and latched, leaving one tile on a
    // fresh profile instead of a filled grid.
    if (list.phase !== 'ready' || availableIds.length === 0) return
    const shouldSeed = !seeded.current && canvas.cards.length === 0
    seeded.current = true
    setCanvas((previous) => {
      const filtered = previous.cards.filter(card => knownIdSet.has(String(card.id)))
      const ids = shouldSeed
        ? [list.current, ...availableIds.filter(id => id !== list.current)]
          .filter((id): id is SessionId => id !== undefined)
          .slice(0, MAX_SEEDED_CARDS)
        : []
      const nextCards = filtered.length === 0 && ids.length > 0
        ? ids.map((id, index) => cardAt(id, index))
        : filtered
      const unchanged = nextCards.length === previous.cards.length
        && nextCards.every((card, index) => card.id === previous.cards[index]?.id)
      if (unchanged) return previous
      return { ...previous, cards: nextCards }
    })
  }, [availableIds, canvas.cards.length, knownIdSet, list.current, list.phase])

  useEffect(() => {
    const element = viewportRef.current
    if (element === null) return
    const measure = () => {
      setCanvasSize({ width: element.clientWidth, height: element.clientHeight })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [])

  useEffect(() => {
    if (draggingId !== null || resizingId !== null || typeof window === 'undefined') return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, ...canvas }))
    } catch {
      return
    }
  }, [canvas, draggingId, resizingId])

  const bounds = useMemo(() => {
    const maxX = canvas.cards.reduce((max, card) => Math.max(max, card.x + card.width), 0)
    const maxY = canvas.cards.reduce((max, card) => Math.max(max, card.y + card.height), 0)
    return {
      width: Math.max(1080, maxX + WORLD_PADDING),
      height: Math.max(720, maxY + WORLD_PADDING),
    }
  }, [canvas.cards])
  const worldWidth = Math.max(bounds.width, canvasSize.width / canvas.zoom)
  const worldHeight = Math.max(bounds.height, Math.max(1, canvasSize.height - 52) / canvas.zoom)

  const addCard = useCallback((id: SessionId, allowBlank = false) => {
    if (!(allowBlank ? knownIdSet : availableIdSet).has(String(id))) return
    setCanvas((previous) => {
      if (previous.cards.some(card => card.id === id)) return previous
      const next = cardAt(id, previous.cards.length)
      const highest = previous.cards.reduce((max, card) => Math.max(max, card.z), -1)
      return { ...previous, cards: [...previous.cards, { ...next, z: highest + 1 }] }
    })
    setPickerOpen(false)
  }, [availableIdSet, knownIdSet])

  // New chat: the shell's own shared New Session action decides the workspace
  // and the agent preset, exactly as the sidebar button does. It reuses a
  // workspace's existing blank session rather than minting a second one, so a
  // session already on the canvas is focused instead of tiled twice.
  const startNewChat = useCallback(() => {
    if (onStartSession === undefined) return
    pendingNewSession.current = true
    setPickerOpen(false)
    onStartSession()
  }, [onStartSession])

  useEffect(() => {
    if (!pendingNewSession.current) return
    const current = list.current
    if (current === undefined || !knownIdSet.has(String(current))) return
    pendingNewSession.current = false
    setCanvas((previous) => {
      if (previous.cards.some(card => card.id === current)) return previous
      const next = cardAt(current, previous.cards.length)
      const highest = previous.cards.reduce((max, card) => Math.max(max, card.z), -1)
      return { ...previous, cards: [...previous.cards, { ...next, z: highest + 1 }] }
    })
    // Focus the tile's own draft so the chat is ready to type into.
    window.requestAnimationFrame(() => {
      const host = document.querySelector(`[data-session-id="${String(current)}"]`)
      host?.querySelector<HTMLElement>('textarea, [contenteditable="true"]')?.focus()
    })
  }, [knownIdSet, list.current])

  const removeCard = useCallback((id: SessionId) => {
    setCanvas(previous => ({ ...previous, cards: previous.cards.filter(card => card.id !== id) }))
  }, [])

  const resetLayout = useCallback(() => {
    setCanvas(previous => ({
      ...previous,
      zoom: 0.82,
      tracks: {},
      cards: previous.cards.map((card, index) => ({ ...cardAt(card.id, index), z: index })),
    }))
    const element = viewportRef.current
    if (element !== null) {
      element.scrollLeft = 0
      element.scrollTop = 0
    }
  }, [])

  const fitOverview = useCallback(() => {
    const width = Math.max(1, canvasSize.width - 40)
    const height = Math.max(1, canvasSize.height - 80)
    const nextZoom = clamp(Math.min(width / bounds.width, height / bounds.height), MIN_ZOOM, MAX_ZOOM)
    setCanvas(previous => ({ ...previous, zoom: Number(nextZoom.toFixed(2)) }))
    const element = viewportRef.current
    if (element !== null) {
      element.scrollLeft = 0
      element.scrollTop = 0
    }
  }, [bounds.height, bounds.width, canvasSize.height, canvasSize.width])

  const nudgeZoom = useCallback((delta: number) => {
    setCanvas(previous => ({
      ...previous,
      zoom: Number(clamp(previous.zoom + delta, MIN_ZOOM, MAX_ZOOM).toFixed(2)),
    }))
  }, [])

  const tileColumns = useMemo(() => {
    if (canvas.columns !== 'auto') return canvas.columns
    const fits = Math.floor(canvasSize.width / TILE_MIN_COLUMN)
    return clamp(fits, 1, MAX_TILE_COLUMNS)
  }, [canvas.columns, canvasSize.width])

  const tileRows = Math.max(1, Math.ceil(Math.max(1, canvas.cards.length) / tileColumns))

  // 1fr rows resolve against content in an auto-height grid, which lets one
  // row swallow the viewport and pushes every composer below the fold. Give
  // the rows a definite pixel height instead: fill the viewport exactly while
  // the rows fit, then fall back to the minimum and let the grid scroll.
  const tileRowHeight = Math.max(
    TILE_MIN_ROW,
    Math.floor((canvasSize.height - TILE_GAP * 2 - (tileRows - 1) * TILE_GAP) / tileRows),
  )

  const trackKey = String(tileColumns)
  const savedTracks = canvas.tracks[trackKey]
  const columnWeights = useMemo(
    () => padTo(savedTracks?.cols ?? [], tileColumns, 1),
    [savedTracks?.cols, tileColumns],
  )
  const rowHeights = useMemo(
    () => padTo(savedTracks?.rows ?? [], tileRows, tileRowHeight),
    [savedTracks?.rows, tileRowHeight, tileRows],
  )

  const setMode = useCallback((mode: CanvasMode) => {
    setCanvas(previous => previous.mode === mode ? previous : { ...previous, mode })
  }, [])

  const setColumns = useCallback((columns: ColumnChoice) => {
    setCanvas(previous => ({ ...previous, columns }))
  }, [])

  const cardIds = useMemo(() => new Set(canvas.cards.map(card => String(card.id))), [canvas.cards])

  /** Close the Add-chat popover on any click outside it. */
  useEffect(() => {
    if (!pickerOpen) return
    const onDown = (event: MouseEvent) => {
      const target = event.target
      if (target instanceof Node && (target as Element).closest?.(`.${css.toolbar}`) !== null) return
      setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('mousedown', onDown) }
  }, [pickerOpen])

  // ---- move and reorder -------------------------------------------------

  const startCardDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>, card: CanvasCard) => {
    if (event.button !== 0) return
    if (canvas.mode === 'tile') {
      event.currentTarget.setPointerCapture(event.pointerId)
      setDraggingId(card.id)
      return
    }
    const world = worldRef.current
    if (world === null) return
    const rect = world.getBoundingClientRect()
    pointerDrag.current = {
      id: card.id,
      offsetX: (event.clientX - rect.left) / canvas.zoom - card.x,
      offsetY: (event.clientY - rect.top) / canvas.zoom - card.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraggingId(card.id)
    setCanvas((previous) => {
      const top = previous.cards.reduce((max, item) => Math.max(max, item.z), -1)
      return {
        ...previous,
        cards: previous.cards.map(item => item.id === card.id ? { ...item, z: top + 1 } : item),
      }
    })
  }, [canvas.mode, canvas.zoom])

  const moveCard = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    if (canvas.mode === 'tile') {
      // Reorder: the tile under the pointer is the insertion target, shown as
      // a drop outline so releasing is a decision rather than a surprise.
      const under = document.elementFromPoint(event.clientX, event.clientY)
      const host = under instanceof Element ? under.closest('[data-session-id]') : null
      const targetId = host?.getAttribute('data-session-id') ?? null
      setReorderTargetId(targetId === null || targetId === String(draggingId) ? null : targetId as SessionId)
      return
    }
    const current = pointerDrag.current
    if (current === null) return
    const world = worldRef.current
    if (world === null) return
    const rect = world.getBoundingClientRect()
    const x = (event.clientX - rect.left) / canvas.zoom - current.offsetX
    const y = (event.clientY - rect.top) / canvas.zoom - current.offsetY
    setCanvas(previous => ({
      ...previous,
      cards: previous.cards.map(candidate => candidate.id === current.id
        ? {
          ...candidate,
          x: clamp(x, WORLD_PADDING, Math.max(WORLD_PADDING, worldWidth - candidate.width - WORLD_PADDING)),
          y: clamp(y, WORLD_PADDING, Math.max(WORLD_PADDING, worldHeight - candidate.height - WORLD_PADDING)),
        }
        : candidate),
    }))
  }, [canvas.mode, canvas.zoom, draggingId, worldHeight, worldWidth])

  const endCardDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const moved = draggingId
    const target = reorderTargetId
    if (canvas.mode === 'tile' && moved !== null && target !== null && moved !== target) {
      setCanvas((previous) => {
        const from = previous.cards.findIndex(card => card.id === moved)
        const to = previous.cards.findIndex(card => card.id === target)
        if (from < 0 || to < 0) return previous
        const cards = [...previous.cards]
        const [lifted] = cards.splice(from, 1)
        if (lifted === undefined) return previous
        cards.splice(to, 0, lifted)
        return { ...previous, cards }
      })
    }
    pointerDrag.current = null
    setReorderTargetId(null)
    setDraggingId(null)
  }, [canvas.mode, draggingId, reorderTargetId])

  // ---- resize -----------------------------------------------------------

  /** Apply one resize delta against the geometry captured at pointer-down. */
  const applyResize = useCallback((gesture: ResizeGesture, dx: number, dy: number) => {
    const { edge } = gesture
    const west = edge === 'w' || edge === 'nw' || edge === 'sw'
    const east = edge === 'e' || edge === 'ne' || edge === 'se'
    const north = edge === 'n' || edge === 'ne' || edge === 'nw'
    const south = edge === 's' || edge === 'se' || edge === 'sw'

    setCanvas((previous) => {
      if (previous.mode === 'free') {
        return {
          ...previous,
          cards: previous.cards.map((card) => {
            if (card.id !== gesture.id) return card
            const base = gesture.card
            let { x, y, width, height } = base
            if (east) width = Math.max(FREE_MIN_WIDTH, base.width + dx)
            if (west) {
              width = Math.max(FREE_MIN_WIDTH, base.width - dx)
              x = base.x + (base.width - width)
            }
            if (south) height = Math.max(FREE_MIN_HEIGHT, base.height + dy)
            if (north) {
              height = Math.max(FREE_MIN_HEIGHT, base.height - dy)
              y = base.y + (base.height - height)
            }
            return { ...card, x: Math.max(0, x), y: Math.max(0, y), width, height }
          }),
        }
      }

      const cols = [...gesture.cols]
      const rows = [...gesture.rows]
      const total = cols.reduce((sum, n) => sum + n, 0)
      const pxPerFr = total > 0 && gesture.contentWidth > 0 ? gesture.contentWidth / total : 0

      // Columns share one axis, so a column edge TRANSFERS width between the
      // two tracks it divides; growing one has to shrink its neighbour or the
      // row would no longer fit the viewport.
      if (pxPerFr > 0) {
        const pair = east
          ? [gesture.colIndex, gesture.colIndex + 1]
          : west ? [gesture.colIndex - 1, gesture.colIndex] : null
        const left = pair?.[0]
        const right = pair?.[1]
        if (left !== undefined && right !== undefined
          && left >= 0 && right < cols.length) {
          const minFr = TILE_MIN_COLUMN_PX / pxPerFr
          const leftBase = cols[left] ?? 1
          const rightBase = cols[right] ?? 1
          const span = leftBase + rightBase
          const wanted = leftBase + dx / pxPerFr
          const nextLeft = clamp(wanted, minFr, Math.max(minFr, span - minFr))
          cols[left] = nextLeft
          cols[right] = span - nextLeft
        }
      }

      // Rows do not share a fixed extent: the grid simply grows and the
      // viewport scrolls, so a row edge sizes ONE row. The bottom edge sizes
      // this row, the top edge sizes the row above it.
      const rowTarget = south ? gesture.rowIndex : north ? gesture.rowIndex - 1 : -1
      if (rowTarget >= 0 && rowTarget < rows.length) {
        const base = rows[rowTarget] ?? TILE_MIN_ROW
        rows[rowTarget] = Math.max(TILE_MIN_ROW, base + (south ? dy : -dy))
      }

      return { ...previous, tracks: { ...previous.tracks, [trackKey]: { cols, rows } } }
    })
  }, [trackKey])

  const captureGesture = useCallback((card: CanvasCard, edge: Edge, clientX: number, clientY: number): ResizeGesture => {
    const index = canvas.cards.findIndex(item => item.id === card.id)
    const grid = gridRef.current
    const contentWidth = grid === null
      ? 0
      : Math.max(0, grid.clientWidth - TILE_PAD * 2 - TILE_GAP * (tileColumns - 1))
    return {
      id: card.id,
      edge,
      startX: clientX,
      startY: clientY,
      card,
      colIndex: index < 0 ? 0 : index % tileColumns,
      rowIndex: index < 0 ? 0 : Math.floor(index / tileColumns),
      cols: [...columnWeights],
      rows: [...rowHeights],
      contentWidth,
    }
  }, [canvas.cards, columnWeights, rowHeights, tileColumns])

  const onHandleDown = useCallback((event: ReactPointerEvent<HTMLDivElement>, card: CanvasCard, edge: Edge) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    resize.current = captureGesture(card, edge, event.clientX, event.clientY)
    setResizingId(card.id)
  }, [captureGesture])

  const onHandleMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = resize.current
    if (gesture === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const dx = (event.clientX - gesture.startX) / (canvas.mode === 'free' ? canvas.zoom : 1)
    const dy = (event.clientY - gesture.startY) / (canvas.mode === 'free' ? canvas.zoom : 1)
    resizeFrame.current ??= requestAnimationFrame(() => {
      resizeFrame.current = null
      applyResize(gesture, dx, dy)
    })
  }, [applyResize, canvas.mode, canvas.zoom])

  const onHandleUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (resizeFrame.current !== null) {
      cancelAnimationFrame(resizeFrame.current)
      resizeFrame.current = null
    }
    const gesture = resize.current
    if (gesture !== null) {
      applyResize(gesture, event.clientX - gesture.startX, event.clientY - gesture.startY)
    }
    resize.current = null
    setResizingId(null)
  }, [applyResize])

  /** Arrow keys on a focused edge: the same resize without a pointer. */
  const onHandleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>, card: CanvasCard, edge: Edge) => {
    const dx = event.key === 'ArrowRight' ? KEY_STEP : event.key === 'ArrowLeft' ? -KEY_STEP : 0
    const dy = event.key === 'ArrowDown' ? KEY_STEP : event.key === 'ArrowUp' ? -KEY_STEP : 0
    if (dx === 0 && dy === 0) return
    event.preventDefault()
    applyResize(captureGesture(card, edge, 0, 0), dx, dy)
  }, [applyResize, captureGesture])

  function renderEmpty() {
    return (
      <div className={css.emptyState}>
        <span className={css.emptyKicker}>Canvas ready</span>
        <strong>Start or drop a chat here</strong>
        <p>Use New chat above, drag a chat in from the sidebar, or use Add chat.</p>
      </div>
    )
  }

  function renderHandles(card: CanvasCard, positioned: boolean) {
    const index = canvas.cards.findIndex(item => item.id === card.id)
    const col = index < 0 ? 0 : index % tileColumns
    const row = index < 0 ? 0 : Math.floor(index / tileColumns)
    return EDGES.map((edge) => {
      if (!positioned) {
        // A tile edge that divides nothing cannot be dragged: the outer
        // columns have no neighbour to trade width with, and the first row has
        // no row above it. Rendering a dead handle there would be a control
        // that looks live and does nothing.
        const wantsWest = edge === 'w' || edge === 'nw' || edge === 'sw'
        const wantsEast = edge === 'e' || edge === 'ne' || edge === 'se'
        const wantsNorth = edge === 'n' || edge === 'ne' || edge === 'nw'
        const horizontal = (wantsWest && col > 0) || (wantsEast && col < tileColumns - 1)
        const vertical = (wantsNorth && row > 0) || edge === 's' || edge === 'se' || edge === 'sw'
        if (!horizontal && !vertical) return null
      }
      const side = SIDE_EDGES.includes(edge)
      return (
        <div
          key={edge}
          className={css.resizeHandle}
          data-edge={edge}
          role={side ? 'separator' : undefined}
          aria-orientation={side ? (edge === 'n' || edge === 's' ? 'horizontal' : 'vertical') : undefined}
          aria-label={side ? `Resize ${summaries[card.id]?.displayTitle ?? 'chat'} ${edge === 'n' ? 'top' : edge === 's' ? 'bottom' : edge === 'e' ? 'right' : 'left'} edge` : undefined}
          aria-hidden={side ? undefined : true}
          tabIndex={side ? 0 : -1}
          onPointerDown={(event) => { onHandleDown(event, card, edge) }}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          onKeyDown={side ? (event) => { onHandleKeyDown(event, card, edge) } : undefined}
        />
      )
    })
  }

  function renderCard(card: CanvasCard, positioned: boolean) {
    const summary = summaries[card.id]
    if (summary === undefined) return null
    const status = sessionStatus(summary)
    const index = canvas.cards.findIndex(item => item.id === card.id)
    // A partly filled final row would otherwise leave a hole at the bottom
    // right the size of the missing tiles. The last tile spans it instead.
    const remainder = canvas.cards.length % tileColumns
    const spans = !positioned && remainder !== 0 && index === canvas.cards.length - 1
      ? tileColumns - remainder + 1
      : 1
    const style = positioned
      ? { left: card.x, top: card.y, width: card.width, height: card.height, zIndex: card.z }
      : spans > 1 ? { gridColumn: `span ${spans}` } : undefined
    return (
      <article
        key={card.id}
        className={css.card}
        data-positioned={positioned || undefined}
        data-current={list.current === card.id || undefined}
        data-dragging={draggingId === card.id || undefined}
        data-resizing={resizingId === card.id || undefined}
        data-drop-target={reorderTargetId === card.id || undefined}
        data-session-id={card.id}
        style={style}
      >
        {/* Editor-group chrome, in the shape the Claude Code panels use: a tab
            strip that is also the move handle, then the panel's own title row. */}
        <div
          className={css.cardTabs}
          data-drag-handle
          title={positioned ? 'Drag to move this chat' : 'Drag to reorder this chat'}
          onPointerDown={(event) => { startCardDrag(event, card) }}
          onPointerMove={moveCard}
          onPointerUp={endCardDrag}
          onPointerCancel={endCardDrag}
          onDoubleClick={() => { onSelectSession(card.id) }}
        >
          <span className={css.tab} data-active>
            <span className={css.tabIcon} aria-hidden="true">&#10033;</span>
            <span className={css.tabTitle}>{summary.displayTitle}</span>
            <button
              type="button"
              className={css.tabClose}
              onPointerDown={(event) => { event.stopPropagation() }}
              onClick={() => { removeCard(card.id) }}
              aria-label={`Close ${summary.displayTitle}`}
            >
              &#215;
            </button>
          </span>
          <div className={css.cardActions}>
            <button
              type="button"
              className={css.cardAction}
              onPointerDown={(event) => { event.stopPropagation() }}
              onClick={() => { onSelectSession(card.id) }}
            >
              Focus
            </button>
          </div>
        </div>
        <div className={css.cardTitleRow}>
          <span className={css.statusDot} data-tone={status.tone} aria-label={status.label} />
          <strong className={css.cardTitleText}>{summary.displayTitle}</strong>
          <span className={css.cardStatus}>{status.label}</span>
        </div>
        <div className={css.cardBody}>
          <SessionProvider
            key={card.id}
            sessionId={card.id}
            empty={() => <div className={css.sessionEmpty}>This session is no longer available.</div>}
          >
            {() => <div className={css.sessionHost} data-dsh-conversation-compact>{renderConversation()}</div>}
          </SessionProvider>
        </div>
        {renderHandles(card, positioned)}
      </article>
    )
  }

  return (
    <section className={css.canvas} data-testid="multi-chat-canvas" aria-label="Multi chat canvas">
      <div className={css.toolbar}>
        <div className={css.toolbarTitle}>
          <span className={css.eyebrow}>Workspace view</span>
          <strong>Multi chat canvas</strong>
          <span className={css.count}>{canvas.cards.length} open</span>
        </div>
        <div className={css.toolbarActions}>
          {onStartSession !== undefined && (
            <button type="button" className={css.primaryButton} onClick={startNewChat}>
              New chat
            </button>
          )}
          <button
            type="button"
            className={css.toolbarButton}
            onClick={() => { setPickerOpen(open => !open) }}
            aria-expanded={pickerOpen}
          >
            Add chat
          </button>
          <div className={css.segmented} role="group" aria-label="Canvas layout">
            <button
              type="button"
              className={css.segment}
              data-active={canvas.mode === 'tile' || undefined}
              aria-pressed={canvas.mode === 'tile'}
              onClick={() => { setMode('tile') }}
            >
              Tile
            </button>
            <button
              type="button"
              className={css.segment}
              data-active={canvas.mode === 'free' || undefined}
              aria-pressed={canvas.mode === 'free'}
              onClick={() => { setMode('free') }}
            >
              Free
            </button>
          </div>
          {canvas.mode === 'tile' ? (
            <>
              <div className={css.segmented} role="group" aria-label="Columns">
                {(['auto', 1, 2, 3, 4] as const).map(choice => (
                  <button
                    key={String(choice)}
                    type="button"
                    className={css.segment}
                    data-active={canvas.columns === choice || undefined}
                    aria-pressed={canvas.columns === choice}
                    onClick={() => { setColumns(choice) }}
                  >
                    {choice === 'auto' ? 'Auto' : choice}
                  </button>
                ))}
              </div>
              <button type="button" className={css.toolbarButton} onClick={resetLayout}>Reset sizes</button>
            </>
          ) : (
            <>
              <button type="button" className={css.toolbarButton} onClick={fitOverview}>Overview</button>
              <button
                type="button"
                className={css.toolbarButton}
                onClick={() => { nudgeZoom(-0.1) }}
                aria-label="Zoom out"
              >
                Zoom out
              </button>
              <span className={css.zoom}>{Math.round(canvas.zoom * 100)}%</span>
              <button type="button" className={css.toolbarButton} onClick={() => { nudgeZoom(0.1) }} aria-label="Zoom in">Zoom in</button>
              <button type="button" className={css.toolbarButton} onClick={resetLayout}>Reset</button>
            </>
          )}
        </div>
        {pickerOpen && (
          <div className={css.picker} role="dialog" aria-label="Add an existing chat">
            <div className={css.pickerHeading}>Add an existing chat</div>
            {availableIds.filter(id => !cardIds.has(String(id))).map(id => (
              <button key={id} type="button" className={css.pickerItem} onClick={() => { addCard(id) }}>
                <span>{summaries[id]?.displayTitle ?? id}</span>
                <span className={css.pickerMeta}>Add</span>
              </button>
            ))}
            {availableIds.every(id => cardIds.has(String(id))) && <div className={css.pickerEmpty}>Every available chat is open</div>}
          </div>
        )}
      </div>
      <div
        ref={viewportRef}
        className={css.viewport}
        data-mode={canvas.mode}
        data-drop-active={dropActive || undefined}
        data-gesture={draggingId !== null || resizingId !== null || undefined}
        onDragEnter={() => { setDropActive(true) }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
        onDragLeave={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
          setDropActive(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDropActive(false)
          const id = event.dataTransfer.getData(CANVAS_MIME) || event.dataTransfer.getData('text/plain')
          if (id !== '') addCard(id as SessionId)
        }}
      >
        {canvas.mode === 'tile' ? (
          <div
            ref={gridRef}
            className={css.grid}
            style={{
              gridTemplateColumns: columnWeights.map(weight => `minmax(0, ${weight}fr)`).join(' '),
              gridTemplateRows: rowHeights.map(height => `${height}px`).join(' '),
            }}
          >
            {canvas.cards.map(card => renderCard(card, false))}
            {canvas.cards.length === 0 && renderEmpty()}
          </div>
        ) : (
          <div ref={worldRef} className={css.world} style={{ width: worldWidth, height: worldHeight, transform: `scale(${canvas.zoom})` }}>
            {canvas.cards.map(card => renderCard(card, true))}
            {canvas.cards.length === 0 && renderEmpty()}
          </div>
        )}
      </div>
    </section>
  )
}
