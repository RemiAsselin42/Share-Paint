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
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
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

  // Gestion du dessin
  sendDrawingData(data: DrawingData): void {
    if (this.socket?.connected) {
      this.socket.emit("drawing-data", data);
    }
  }

  // Gestion du curseur
  sendCursorPosition(roomId: string, userId: string, cursor: Point): void {
    if (this.socket?.connected) {
      this.socket.emit("user-cursor", roomId, userId, cursor);
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
