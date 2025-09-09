import { io, Socket } from "socket.io-client";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  DrawingData,
  User,
  Point,
} from "../types";

class SocketService {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null =
    null;
  private serverUrl: string;

  // Optimisations pour le batching et throttling
  private drawingBuffer: DrawingData[] = [];
  private cursorBuffer: { roomId: string; userId: string; cursor: Point }[] =
    [];
  private lastDrawingSend = 0;
  private lastCursorSend = 0;
  private drawingBatchTimeout: number | null = null;
  private cursorBatchTimeout: number | null = null;

  // Configuration des optimisations pour la cohérence
  private readonly DRAWING_BATCH_MS = 32; // ~30 FPS pour plus de cohérence
  private readonly CURSOR_BATCH_MS = 100; // ~10 FPS pour les curseurs
  private readonly MAX_BATCH_SIZE = 5; // Moins d'éléments par batch pour plus de cohérence

  constructor() {
    // Configuration automatique de l'URL du serveur
    this.serverUrl = this.detectServerUrl();
  }

  private detectServerUrl(): string {
    // Si une URL est explicitement définie dans l'environnement, l'utiliser
    if (import.meta.env.VITE_SERVER_URL) {
      return import.meta.env.VITE_SERVER_URL;
    }

    // Détecter automatiquement l'URL basée sur l'URL actuelle
    const currentHost = window.location.hostname;
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";

    // Port par défaut du serveur
    const serverPort = 3001;

    return `${protocol}//${currentHost}:${serverPort}`;
  }

  connect(): Promise<Socket<ServerToClientEvents, ClientToServerEvents>> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        console.log("Socket déjà connecté");
        resolve(this.socket);
        return;
      }

      console.log(`Tentative de connexion à: ${this.serverUrl}`);

      this.socket = io(this.serverUrl, {
        transports: ["websocket", "polling"],
        timeout: 10000,
        forceNew: true,
      });

      this.socket.on("connect", () => {
        console.log(`✅ Connecté au serveur Socket.IO sur ${this.serverUrl}`);
        resolve(this.socket!);
      });

      this.socket.on("connect_error", (error) => {
        console.error(
          `❌ Erreur de connexion Socket.IO vers ${this.serverUrl}:`,
          error
        );
        reject(error);
      });

      this.socket.on("disconnect", (reason) => {
        console.log("Déconnecté du serveur Socket.IO:", reason);
      });
    });
  }

  disconnect(): void {
    // Nettoyer les timeouts avant la déconnexion
    this.clearBatchTimeouts();

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private clearBatchTimeouts(): void {
    if (this.drawingBatchTimeout) {
      clearTimeout(this.drawingBatchTimeout);
      this.drawingBatchTimeout = null;
    }
    if (this.cursorBatchTimeout) {
      clearTimeout(this.cursorBatchTimeout);
      this.cursorBatchTimeout = null;
    }
  }

  private flushDrawingBuffer(): void {
    if (this.drawingBuffer.length > 0 && this.socket?.connected) {
      // Envoyer seulement les données les plus récentes pour chaque trait
      const optimizedData = this.optimizeDrawingData(this.drawingBuffer);
      optimizedData.forEach((data) => {
        this.socket!.emit("drawing-data", data);
      });
      this.drawingBuffer = [];
      this.lastDrawingSend = Date.now();
    }
  }

  private flushCursorBuffer(): void {
    if (this.cursorBuffer.length > 0 && this.socket?.connected) {
      // Ne garder que la position la plus récente pour chaque utilisateur
      const latestCursors = new Map<
        string,
        { roomId: string; userId: string; cursor: Point }
      >();

      this.cursorBuffer.forEach((cursor) => {
        latestCursors.set(cursor.userId, cursor);
      });

      latestCursors.forEach((cursor) => {
        this.socket!.emit(
          "user-cursor",
          cursor.roomId,
          cursor.userId,
          cursor.cursor
        );
      });

      this.cursorBuffer = [];
      this.lastCursorSend = Date.now();
    }
  }

  private optimizeDrawingData(buffer: DrawingData[]): DrawingData[] {
    // Grouper par ID de dessin et ne garder que les données les plus complètes
    // IMPORTANT: Garder l'ordre chronologique pour la cohérence
    const drawingMap = new Map<string, DrawingData>();
    const orderedIds: string[] = [];

    buffer.forEach((data) => {
      const existing = drawingMap.get(data.id);
      // Garder toujours la version avec le plus de points ET le timestamp le plus récent
      if (
        !existing ||
        data.points.length > existing.points.length ||
        (data.points.length === existing.points.length &&
          data.timestamp > existing.timestamp)
      ) {
        if (!existing) {
          orderedIds.push(data.id);
        }
        drawingMap.set(data.id, data);
      }
    });

    // Retourner dans l'ordre d'ajout pour maintenir la cohérence
    return orderedIds.map((id) => drawingMap.get(id)!);
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  // Gestion des salles
  joinRoom(roomId: string, user: User): void {
    if (this.socket?.connected) {
      this.socket.emit("join-room", roomId, user);
    }
  }

  leaveRoom(roomId: string, userId: string): void {
    if (this.socket?.connected) {
      this.socket.emit("leave-room", roomId, userId);
    }
  }

  // Gestion du dessin avec optimisation
  sendDrawingData(data: DrawingData): void {
    if (!this.socket?.connected) return;

    // Ajouter au buffer
    this.drawingBuffer.push(data);

    // Si le buffer est plein, envoyer immédiatement
    if (this.drawingBuffer.length >= this.MAX_BATCH_SIZE) {
      this.flushDrawingBuffer();
      return;
    }

    // Sinon, programmer un envoi différé si pas déjà fait
    if (!this.drawingBatchTimeout) {
      this.drawingBatchTimeout = setTimeout(() => {
        this.flushDrawingBuffer();
        this.drawingBatchTimeout = null;
      }, this.DRAWING_BATCH_MS);
    }
  }

  // Gestion du curseur avec optimisation
  sendCursorPosition(roomId: string, userId: string, cursor: Point): void {
    if (!this.socket?.connected) return;

    // Throttling basique pour éviter les spams
    const now = Date.now();
    if (now - this.lastCursorSend < this.CURSOR_BATCH_MS) {
      // Mettre à jour la position dans le buffer au lieu d'ignorer
      const existingIndex = this.cursorBuffer.findIndex(
        (c) => c.userId === userId
      );
      if (existingIndex >= 0) {
        this.cursorBuffer[existingIndex] = { roomId, userId, cursor };
      } else {
        this.cursorBuffer.push({ roomId, userId, cursor });
      }
      return;
    }

    // Ajouter au buffer
    this.cursorBuffer.push({ roomId, userId, cursor });

    // Programmer un envoi différé si pas déjà fait
    if (!this.cursorBatchTimeout) {
      this.cursorBatchTimeout = setTimeout(() => {
        this.flushCursorBuffer();
        this.cursorBatchTimeout = null;
      }, this.CURSOR_BATCH_MS);
    }
  }

  // Effacer le canvas
  clearCanvas(roomId: string): void {
    if (this.socket?.connected) {
      this.socket.emit("clear-canvas", roomId);
    }
  }

  // Undo canvas
  undoCanvas(roomId: string, userId: string, drawingId: string): void {
    if (this.socket?.connected) {
      this.socket.emit("undo-canvas", roomId, userId, drawingId);
    }
  }

  // Redo canvas
  redoCanvas(roomId: string, userId: string, drawingId: string): void {
    if (this.socket?.connected) {
      this.socket.emit("redo-canvas", roomId, userId, drawingId);
    }
  }

  // Événements entrants
  onDrawingData(callback: (data: DrawingData) => void): void {
    this.socket?.on("drawing-data", callback);
  }

  onUserJoined(callback: (user: User) => void): void {
    this.socket?.on("user-joined", callback);
  }

  onUserLeft(callback: (userId: string) => void): void {
    this.socket?.on("user-left", callback);
  }

  onUserCursor(callback: (userId: string, cursor: Point) => void): void {
    this.socket?.on("user-cursor", callback);
  }

  onRoomJoined(callback: (roomId: string, users: User[]) => void): void {
    this.socket?.on("room-joined", callback);
  }

  onRoomError(callback: (error: string) => void): void {
    this.socket?.on("room-error", callback);
  }

  onCanvasClear(callback: () => void): void {
    this.socket?.on("canvas-clear", callback);
  }

  onCanvasUndo(callback: (userId: string, drawingId: string) => void): void {
    this.socket?.on("canvas-undo", callback);
  }

  onCanvasRedo(callback: (userId: string, drawingId: string) => void): void {
    this.socket?.on("canvas-redo", callback);
  }

  // Nettoyer les listeners
  removeAllListeners(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
    }
  }

  removeListener(event: keyof ServerToClientEvents): void {
    if (this.socket) {
      this.socket.off(event);
    }
  }

  // Obtenir l'instance du socket pour des usages avancés
  getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> | null {
    return this.socket;
  }

  // Configurer l'URL du serveur (utile pour la configuration dynamique)
  setServerUrl(url: string): void {
    this.serverUrl = url;
    if (this.socket?.connected) {
      this.disconnect();
    }
  }

  getServerUrl(): string {
    return this.serverUrl;
  }

  // Vérifier si une salle existe via l'API REST
  async checkRoomExists(roomId: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.serverUrl}/api/room/${roomId}/exists`
      );
      if (response.ok) {
        const data = await response.json();
        return data.exists;
      }
      return false;
    } catch (error) {
      console.error("Erreur lors de la vérification de la salle:", error);
      return false;
    }
  }

  // Créer une nouvelle salle via l'API REST
  async createRoom(
    roomId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.serverUrl}/api/room/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomId }),
      });

      const data = await response.json();

      if (response.ok) {
        return { success: true };
      } else {
        return {
          success: false,
          error: data.error || "Erreur lors de la création de la salle",
        };
      }
    } catch (error) {
      console.error("Erreur lors de la création de la salle:", error);
      return { success: false, error: "Erreur de connexion au serveur" };
    }
  }
}

// Instance singleton
export const socketService = new SocketService();
export default socketService;
