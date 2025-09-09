export interface Point {
  x: number;
  y: number;
}

export interface DrawingData {
  id: string;
  roomId: string;
  userId: string;
  tool: DrawingTool;
  color: string;
  lineWidth: number;
  opacity: number;
  points: Point[];
  startPoint?: Point;
  endPoint?: Point;
  timestamp: number;
  // Propriétés pour l'optimisation
  isIncremental?: boolean;
  basePointCount?: number;
  // Propriété pour marquer un dessin comme supprimé
  isDeleted?: boolean;
}

export interface User {
  id: string;
  cursor?: Point;
  color: string;
}

export type DrawingTool =
  | "brush"
  | "pencil"
  | "marker"
  | "spray"
  | "calligraphy"
  | "watercolor"
  | "eraser"
  | "line"
  | "circle"
  | "rectangle"
  | "colorpicker"
  | "grab";

export interface CanvasState {
  drawings: DrawingData[];
  users: Map<string, User>;
  currentTool: DrawingTool;
  currentColor: string;
  currentLineWidth: number;
  currentOpacity: number;
  isDrawing: boolean;
  roomId: string | null;
  userId: string;
  userHistory: string[]; // IDs des dessins de l'utilisateur dans l'ordre
  userHistoryIndex: number;
}

export interface ServerToClientEvents {
  "drawing-data": (data: DrawingData) => void;
  "user-joined": (user: User) => void;
  "user-left": (userId: string) => void;
  "user-cursor": (userId: string, cursor: Point) => void;
  "room-joined": (roomId: string, users: User[]) => void;
  "room-error": (error: string) => void;
  "canvas-clear": () => void;
  "canvas-undo": (userId: string, drawingId: string) => void;
  "canvas-redo": (userId: string, drawingId: string) => void;
}

export interface ClientToServerEvents {
  "join-room": (roomId: string, user: User) => void;
  "leave-room": (roomId: string, userId: string) => void;
  "drawing-data": (data: DrawingData) => void;
  "user-cursor": (roomId: string, userId: string, cursor: Point) => void;
  "clear-canvas": (roomId: string) => void;
  "undo-canvas": (roomId: string, userId: string, drawingId: string) => void;
  "redo-canvas": (roomId: string, userId: string, drawingId: string) => void;
}
