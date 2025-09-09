import { useState, useCallback, useRef, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import type {
  CanvasState,
  DrawingData,
  Point,
  DrawingTool,
  User,
} from "../types";
import socketService from "../services/socketService";

const useCanvas = () => {
  const [state, setState] = useState<CanvasState>({
    drawings: [],
    users: new Map(),
    currentTool: "brush",
    currentColor: "#40BFBF",
    currentLineWidth: 4,
    currentOpacity: 1,
    isDrawing: false,
    roomId: null,
    userId: uuidv4(),
    userHistory: [], // Historique des IDs de dessins de l'utilisateur
    userHistoryIndex: -1, // Index dans l'historique (-1 = tout est visible)
  });

  const [isConnected, setIsConnected] = useState(false);
  const currentDrawingRef = useRef<DrawingData | null>(null);
  const throttleRef = useRef<number | null>(null);

  // Système de synchronisation avancé
  const pointsBufferRef = useRef<Point[]>([]);
  const lastSentPointRef = useRef<Point | null>(null);
  const lastCursorSentRef = useRef<number>(0);
  const sendIntervalRef = useRef<number | null>(null);

  // Constantes pour l'optimisation
  const SEND_INTERVAL = 16; // ~60fps
  const MIN_DISTANCE = 2; // Distance minimale entre points pour éviter le spam
  const MAX_BUFFER_SIZE = 5; // Taille maximale du buffer de points

  // Fonctions utilitaires pour la synchronisation
  const calculateDistance = useCallback((p1: Point, p2: Point): number => {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  }, []);

  const interpolatePoints = useCallback(
    (p1: Point, p2: Point, steps: number): Point[] => {
      const points: Point[] = [];
      for (let i = 1; i <= steps; i++) {
        const t = i / (steps + 1);
        points.push({
          x: p1.x + (p2.x - p1.x) * t,
          y: p1.y + (p2.y - p1.y) * t,
        });
      }
      return points;
    },
    []
  );

  const flushPointsBuffer = useCallback(() => {
    if (pointsBufferRef.current.length === 0 || !currentDrawingRef.current) {
      return;
    }

    const bufferCopy = [...pointsBufferRef.current];
    pointsBufferRef.current = [];

    const updatedDrawing = {
      ...currentDrawingRef.current,
      points: [...currentDrawingRef.current.points, ...bufferCopy],
      timestamp: Date.now(),
    };

    currentDrawingRef.current = updatedDrawing;

    // Mettre à jour l'état local immédiatement
    setState((prev) => ({
      ...prev,
      drawings: [
        ...prev.drawings.filter((d) => d.id !== updatedDrawing.id),
        updatedDrawing,
      ],
    }));

    // Envoyer au serveur
    socketService.sendDrawingData(updatedDrawing);
    lastSentPointRef.current = bufferCopy[bufferCopy.length - 1] || null;
  }, []);

  // Générer une couleur aléatoire pour l'utilisateur
  const getUserColor = useCallback(() => {
    const colors = [
      "#ff6b6b",
      "#4ecdc4",
      "#45b7d1",
      "#96ceb4",
      "#feca57",
      "#ff9ff3",
      "#54a0ff",
      "#5f27cd",
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }, []);

  // Initialiser l'utilisateur
  const initializeUser = useCallback((): User => {
    return {
      id: state.userId,
      color: getUserColor(),
    };
  }, [state.userId, getUserColor]);

  // Rejoindre une salle
  const joinRoom = useCallback(
    async (roomId: string) => {
      try {
        if (!socketService.isConnected()) {
          await socketService.connect();
        }

        const user = initializeUser();
        socketService.joinRoom(roomId, user);

        setState((prev) => ({
          ...prev,
          roomId,
          drawings: [], // Réinitialiser les dessins lors du changement de salle
          users: new Map([[user.id, user]]),
        }));
      } catch (error) {
        console.error("Erreur lors de la connexion à la salle:", error);
        throw error;
      }
    },
    [initializeUser]
  );

  // Quitter la salle
  const leaveRoom = useCallback(() => {
    if (state.roomId) {
      socketService.leaveRoom(state.roomId, state.userId);
      setState((prev) => ({
        ...prev,
        roomId: null,
        drawings: [],
        users: new Map(),
        isDrawing: false,
      }));
    }
  }, [state.roomId, state.userId]);

  // Commencer à dessiner
  const startDrawing = useCallback(
    (point: Point) => {
      if (!state.roomId) {
        return;
      }

      const drawingData: DrawingData = {
        id: uuidv4(),
        roomId: state.roomId,
        userId: state.userId,
        tool: state.currentTool,
        color: state.currentColor,
        lineWidth: state.currentLineWidth,
        opacity: state.currentOpacity,
        points: [point],
        timestamp: Date.now(),
      };

      currentDrawingRef.current = drawingData;

      setState((prev) => ({
        ...prev,
        isDrawing: true,
        drawings: [...prev.drawings, drawingData], // Ajouter le dessin immédiatement
      }));

      // Pour l'outil ligne, on n'envoie que le début
      if (state.currentTool !== "line") {
        socketService.sendDrawingData(drawingData);
      }
    },
    [
      state.roomId,
      state.userId,
      state.currentTool,
      state.currentColor,
      state.currentLineWidth,
      state.currentOpacity,
    ]
  );

  // Continuer le dessin avec système de buffering avancé
  const draw = useCallback(
    (point: Point) => {
      if (!state.isDrawing || !currentDrawingRef.current || !state.roomId) {
        return;
      }

      // Vérifier la distance minimale pour éviter les points trop proches
      const lastPoint =
        currentDrawingRef.current.points[
          currentDrawingRef.current.points.length - 1
        ];
      if (lastPoint && calculateDistance(lastPoint, point) < MIN_DISTANCE) {
        return;
      }

      // Interpoler les points si l'écart est trop grand (dessin rapide)
      let pointsToAdd = [point];
      if (lastPoint && calculateDistance(lastPoint, point) > MIN_DISTANCE * 3) {
        const interpolatedPoints = interpolatePoints(lastPoint, point, 2);
        pointsToAdd = [...interpolatedPoints, point];
      }

      // Mettre à jour immédiatement l'état local pour une réactivité parfaite
      const updatedDrawing = {
        ...currentDrawingRef.current,
        points: [...currentDrawingRef.current.points, ...pointsToAdd],
        timestamp: Date.now(),
      };

      currentDrawingRef.current = updatedDrawing;

      // Mise à jour locale immédiate
      setState((prev) => ({
        ...prev,
        drawings: [
          ...prev.drawings.filter((d) => d.id !== updatedDrawing.id),
          updatedDrawing,
        ],
      }));

      // Gestion différenciée selon l'outil
      if (state.currentTool === "line") {
        // Pour l'outil ligne, on attend la fin pour envoyer
        return;
      }

      // Système de buffering intelligent pour les autres outils
      pointsBufferRef.current.push(...pointsToAdd);

      // Envoyer immédiatement si le buffer est plein ou si assez de temps s'est écoulé
      if (pointsBufferRef.current.length >= MAX_BUFFER_SIZE) {
        flushPointsBuffer();
      } else if (!sendIntervalRef.current) {
        // Démarrer un timer pour envoyer les points accumulés
        sendIntervalRef.current = window.setTimeout(() => {
          flushPointsBuffer();
          sendIntervalRef.current = null;
        }, SEND_INTERVAL);
      }
    },
    [
      state.isDrawing,
      state.roomId,
      state.currentTool,
      calculateDistance,
      interpolatePoints,
      flushPointsBuffer,
    ]
  );

  // Terminer le dessin avec nettoyage du buffer
  const endDrawing = useCallback(() => {
    if (!state.isDrawing || !currentDrawingRef.current || !state.roomId) return;

    // Vider le buffer de points en attente
    if (pointsBufferRef.current.length > 0) {
      flushPointsBuffer();
    }

    // Nettoyer les timers
    if (sendIntervalRef.current) {
      clearTimeout(sendIntervalRef.current);
      sendIntervalRef.current = null;
    }

    const finalDrawing = currentDrawingRef.current;

    // Pour l'outil ligne, on envoie maintenant le dessin complet
    if (state.currentTool === "line") {
      socketService.sendDrawingData(finalDrawing);
    }

    setState((prev) => {
      // Ajouter le dessin à l'historique de l'utilisateur
      if (finalDrawing && finalDrawing.userId === prev.userId) {
        const newUserHistory = [...prev.userHistory];

        // Si on est au milieu de l'historique (après des undo), supprimer les éléments suivants
        if (prev.userHistoryIndex < newUserHistory.length - 1) {
          newUserHistory.splice(prev.userHistoryIndex + 1);
        }

        newUserHistory.push(finalDrawing.id);

        // Limiter l'historique à 100 actions
        if (newUserHistory.length > 100) {
          newUserHistory.shift();
        }

        return {
          ...prev,
          isDrawing: false,
          userHistory: newUserHistory,
          userHistoryIndex: newUserHistory.length - 1,
        };
      }

      return {
        ...prev,
        isDrawing: false,
      };
    });

    // Réinitialiser les références
    currentDrawingRef.current = null;
    pointsBufferRef.current = [];
    lastSentPointRef.current = null;

    if (throttleRef.current) {
      clearTimeout(throttleRef.current);
      throttleRef.current = null;
    }
  }, [state.isDrawing, state.roomId, state.currentTool, flushPointsBuffer]);

  // Gérer le mouvement de la souris (curseur) avec throttling optimisé
  const handleMouseMove = useCallback(
    (point: Point) => {
      if (!state.roomId) return;

      // Throttling intelligent pour le curseur
      const now = Date.now();
      const timeSinceLastCursor = now - lastCursorSentRef.current;

      // Envoyer le curseur seulement si assez de temps s'est écoulé (20fps pour le curseur)
      if (timeSinceLastCursor >= 50) {
        socketService.sendCursorPosition(state.roomId, state.userId, point);
        lastCursorSentRef.current = now;
      }
    },
    [state.roomId, state.userId]
  );

  // Changer d'outil
  const setTool = useCallback((tool: DrawingTool) => {
    setState((prev) => ({
      ...prev,
      currentTool: tool,
      isDrawing: false, // Arrêter tout dessin en cours
    }));
    currentDrawingRef.current = null;
  }, []);

  // Changer de couleur
  const setColor = useCallback((color: string) => {
    setState((prev) => ({
      ...prev,
      currentColor: color,
    }));
  }, []);

  // Changer l'épaisseur de ligne
  const setLineWidth = useCallback((width: number) => {
    setState((prev) => ({
      ...prev,
      currentLineWidth: width,
    }));
  }, []);

  // Changer l'opacité
  const setOpacity = useCallback((opacity: number) => {
    setState((prev) => ({
      ...prev,
      currentOpacity: opacity,
    }));
  }, []);

  // Effacer le canvas avec confirmation
  const clearCanvas = useCallback(() => {
    if (!state.roomId) return;

    // Afficher un popup de confirmation
    const confirmed = window.confirm(
      "⚠️ Attention !\n\nCette action va :\n" +
        "• Effacer complètement le canvas pour tous les utilisateurs\n" +
        "• Supprimer définitivement l'historique de toutes les instances\n" +
        "• Rendre impossible l'annulation (Ctrl+Z)\n\n" +
        "Êtes-vous sûr de vouloir continuer ?"
    );

    if (confirmed) {
      socketService.clearCanvas(state.roomId);
      setState((prev) => ({
        ...prev,
        drawings: [],
        userHistory: [], // Supprimer l'historique de l'utilisateur actuel
        userHistoryIndex: -1, // Réinitialiser l'index
      }));
    }
  }, [state.roomId]);

  // Enregistrer le canvas
  const saveCanvas = useCallback((format: string = "png") => {
    // Cette fonction sera appelée depuis le composant qui a accès au canvas
    // Le vrai travail sera fait dans le composant Canvas
    const event = new CustomEvent("save-canvas", { detail: { format } });
    window.dispatchEvent(event);
  }, []);

  // Fonction pour revenir en arrière (Ctrl+Z) - annule le dernier dessin de l'utilisateur
  const undo = useCallback(() => {
    setState((prev) => {
      if (prev.userHistoryIndex >= 0) {
        // Obtenir l'ID du dessin à annuler
        const drawingIdToUndo = prev.userHistory[prev.userHistoryIndex];

        // Envoyer l'événement undo avec l'ID du dessin
        if (prev.roomId && drawingIdToUndo) {
          socketService.undoCanvas(prev.roomId, prev.userId, drawingIdToUndo);
        }

        // Marquer le dessin comme supprimé localement
        const updatedDrawings = prev.drawings.map((drawing) =>
          drawing.id === drawingIdToUndo && drawing.userId === prev.userId
            ? { ...drawing, isDeleted: true }
            : drawing
        );

        return {
          ...prev,
          drawings: updatedDrawings,
          userHistoryIndex: prev.userHistoryIndex - 1,
        };
      }
      return prev;
    });
  }, []);

  // Fonction pour revenir en avant (Ctrl+Y) - restaure le dernier dessin annulé
  const redo = useCallback(() => {
    setState((prev) => {
      if (prev.userHistoryIndex < prev.userHistory.length - 1) {
        const newIndex = prev.userHistoryIndex + 1;
        const drawingIdToRedo = prev.userHistory[newIndex];

        // Envoyer l'événement redo avec l'ID du dessin
        if (prev.roomId && drawingIdToRedo) {
          socketService.redoCanvas(prev.roomId, prev.userId, drawingIdToRedo);
        }

        // Restaurer le dessin localement
        const updatedDrawings = prev.drawings.map((drawing) =>
          drawing.id === drawingIdToRedo && drawing.userId === prev.userId
            ? { ...drawing, isDeleted: false }
            : drawing
        );

        return {
          ...prev,
          drawings: updatedDrawings,
          userHistoryIndex: newIndex,
        };
      }
      return prev;
    });
  }, []);

  // Fonction pour gérer l'undo reçu d'un autre utilisateur
  const handleRemoteUndo = useCallback(
    (userId: string, drawingId: string) => {
      // Ne pas traiter notre propre undo (déjà traité localement)
      if (userId === state.userId) return;

      setState((prev) => {
        // Marquer le dessin comme supprimé
        const updatedDrawings = prev.drawings.map((drawing) =>
          drawing.id === drawingId && drawing.userId === userId
            ? { ...drawing, isDeleted: true }
            : drawing
        );

        return {
          ...prev,
          drawings: updatedDrawings,
        };
      });
    },
    [state.userId]
  );

  // Fonction pour gérer le redo reçu d'un autre utilisateur
  const handleRemoteRedo = useCallback(
    (userId: string, drawingId: string) => {
      // Ne pas traiter notre propre redo (déjà traité localement)
      if (userId === state.userId) return;

      setState((prev) => {
        // Restaurer le dessin
        const updatedDrawings = prev.drawings.map((drawing) =>
          drawing.id === drawingId && drawing.userId === userId
            ? { ...drawing, isDeleted: false }
            : drawing
        );

        return {
          ...prev,
          drawings: updatedDrawings,
        };
      });
    },
    [state.userId]
  );

  // Surveiller les changements de connexion
  useEffect(() => {
    const checkConnection = () => {
      setIsConnected(socketService.isConnected());
    };

    // Vérifier immédiatement
    checkConnection();

    // Configurer les listeners de connexion/déconnexion
    const socket = socketService.getSocket();
    if (socket) {
      socket.on("connect", checkConnection);
      socket.on("disconnect", checkConnection);
    }

    // Intervalle pour vérifier régulièrement la connexion
    const interval = setInterval(checkConnection, 1000);

    return () => {
      clearInterval(interval);
      if (socket) {
        socket.off("connect", checkConnection);
        socket.off("disconnect", checkConnection);
      }
    };
  }, []);

  // Configuration des listeners Socket.IO
  useEffect(() => {
    if (!socketService.isConnected()) {
      return;
    }

    console.log("Configuration des listeners Socket.IO");

    const handleDrawingData = (data: DrawingData) => {
      console.log("Données de dessin reçues:", data);
      setState((prev) => {
        // Gestion des mises à jour incrémentales
        if (data.isIncremental && data.basePointCount !== undefined) {
          const existingDrawing = prev.drawings.find((d) => d.id === data.id);
          if (
            existingDrawing &&
            existingDrawing.points.length === data.basePointCount
          ) {
            // Ajouter les nouveaux points à la fin du dessin existant
            const updatedDrawing = {
              ...existingDrawing,
              points: [...existingDrawing.points, ...data.points],
              timestamp: data.timestamp,
            };
            return {
              ...prev,
              drawings: [
                ...prev.drawings.filter((d) => d.id !== data.id),
                updatedDrawing,
              ],
            };
          }
        }

        // Mise à jour complète ou nouveau dessin
        return {
          ...prev,
          drawings: [...prev.drawings.filter((d) => d.id !== data.id), data],
        };
      });
    };

    const handleUserJoined = (user: User) => {
      console.log("Utilisateur rejoint:", user);
      setState((prev) => ({
        ...prev,
        users: new Map(prev.users.set(user.id, user)),
      }));
    };

    const handleUserLeft = (userId: string) => {
      console.log("Utilisateur parti:", userId);
      setState((prev) => {
        const newUsers = new Map(prev.users);
        newUsers.delete(userId);
        return {
          ...prev,
          users: newUsers,
        };
      });
    };

    const handleUserCursor = (userId: string, cursor: Point) => {
      setState((prev) => {
        const user = prev.users.get(userId);
        if (user) {
          const updatedUser = { ...user, cursor };
          return {
            ...prev,
            users: new Map(prev.users.set(userId, updatedUser)),
          };
        }
        return prev;
      });
    };

    const handleRoomJoined = (roomId: string, users: User[]) => {
      console.log("Salle rejointe:", roomId, "Utilisateurs:", users);
      const usersMap = new Map(users.map((user) => [user.id, user]));
      setState((prev) => ({
        ...prev,
        roomId,
        users: usersMap,
      }));
    };

    const handleCanvasClear = () => {
      setState((prev) => ({
        ...prev,
        drawings: [],
        userHistory: [], // Supprimer l'historique de l'utilisateur
        userHistoryIndex: -1, // Réinitialiser l'index
      }));
    };

    const handleRoomError = (error: string) => {
      console.error("Erreur de salle:", error);
      alert(`Erreur: ${error}`);
    };

    // Nettoyer les anciens listeners
    socketService.removeAllListeners();

    // Enregistrer les nouveaux listeners
    socketService.onDrawingData(handleDrawingData);
    socketService.onUserJoined(handleUserJoined);
    socketService.onUserLeft(handleUserLeft);
    socketService.onUserCursor(handleUserCursor);
    socketService.onRoomJoined(handleRoomJoined);
    socketService.onCanvasClear(handleCanvasClear);
    socketService.onCanvasUndo(handleRemoteUndo);
    socketService.onCanvasRedo(handleRemoteRedo);
    socketService.onRoomError(handleRoomError);

    return () => {
      console.log("Nettoyage des listeners Socket.IO");
      socketService.removeAllListeners();
      if (throttleRef.current) {
        clearTimeout(throttleRef.current);
      }
    };
  }, [isConnected, state.roomId, handleRemoteUndo, handleRemoteRedo]); // Reconfigurer quand la connexion ou la salle change

  // Nettoyer lors du démontage
  useEffect(() => {
    return () => {
      if (throttleRef.current) {
        clearTimeout(throttleRef.current);
      }
      leaveRoom();
    };
  }, [leaveRoom]);

  // Gestion des raccourcis clavier
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) {
        if (event.key === "z" && !event.shiftKey) {
          event.preventDefault();
          undo();
        } else if (event.key === "y" || (event.key === "z" && event.shiftKey)) {
          event.preventDefault();
          redo();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  // Ajouter automatiquement à l'historique quand on termine un dessin
  const isDrawingRef = useRef(state.isDrawing);
  const drawingsRef = useRef(state.drawings);

  useEffect(() => {
    isDrawingRef.current = state.isDrawing;
    drawingsRef.current = state.drawings;
  });

  useEffect(() => {
    // L'historique est maintenant géré par utilisateur dans endDrawing()
  }, [state.isDrawing]);

  return {
    // État
    ...state,

    // Actions
    joinRoom,
    leaveRoom,
    startDrawing,
    draw,
    endDrawing,
    handleMouseMove,
    setTool,
    setColor,
    setLineWidth,
    setOpacity,
    clearCanvas,
    saveCanvas,
    undo,
    redo,

    // Utilitaires
    isConnected,
  };
};

export default useCanvas;
