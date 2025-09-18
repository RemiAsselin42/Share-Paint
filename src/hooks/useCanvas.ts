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
    currentHardness: 0.5,
    isDrawing: false,
    roomId: null,
    userId: uuidv4(),
    userHistory: [], // Historique des IDs de dessins de l'utilisateur
    userHistoryIndex: -1, // Index dans l'historique (-1 = tout est visible)
  });

  const [isConnected, setIsConnected] = useState(false);
  const currentDrawingRef = useRef<DrawingData | null>(null);
  const throttleRef = useRef<number | null>(null);

  // Système de synchronisation optimisé
  const lastCursorSentRef = useRef<number>(0);

  // Constantes pour l'optimisation
  const MIN_DISTANCE = 2; // Distance minimale entre points pour éviter le spam

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

  // Supprimé: fonction flushPointsBuffer plus utilisée avec les nouvelles optimisations

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
        hardness: state.currentHardness,
        points: [point],
        timestamp: Date.now(),
      };

      currentDrawingRef.current = drawingData;

      setState((prev) => ({
        ...prev,
        isDrawing: true,
        drawings: [...prev.drawings, drawingData], // Ajouter le dessin immédiatement
      }));

      // Envoyer une première version pour tous les outils (y compris "line") afin d'afficher le trait en temps réel
      socketService.sendDrawingData(drawingData);
    },
    [
      state.roomId,
      state.userId,
      state.currentTool,
      state.currentColor,
      state.currentLineWidth,
      state.currentOpacity,
      state.currentHardness,
    ]
  );

  // Continuer le dessin avec système de buffering optimisé
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

      // Envoyer immédiatement (y compris pour l'outil "line") pour la synchro temps réel
      socketService.sendDrawingData(updatedDrawing);

      // Mise à jour locale avec les mêmes données exactes
      setState((prev) => ({
        ...prev,
        drawings: [
          ...prev.drawings.filter((d) => d.id !== updatedDrawing.id),
          updatedDrawing,
        ],
      }));
    },
    [state.isDrawing, state.roomId, calculateDistance, interpolatePoints]
  );

  // Terminer le dessin simplifié
  const endDrawing = useCallback(() => {
    if (!state.isDrawing || !currentDrawingRef.current || !state.roomId) return;

    const finalDrawing = currentDrawingRef.current;

    // Pour l'outil ligne, on envoie aussi la version finale (idempotent)
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

    if (throttleRef.current) {
      clearTimeout(throttleRef.current);
      throttleRef.current = null;
    }
  }, [state.isDrawing, state.roomId, state.currentTool]);

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

  // Changer la dureté
  const setHardness = useCallback((hardness: number) => {
    const clamped = Math.max(0, Math.min(1, hardness));
    setState((prev) => ({
      ...prev,
      currentHardness: clamped,
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
    const event = new CustomEvent("saveCanvas", { detail: { format } });
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

        const newState = {
          ...prev,
          drawings: updatedDrawings,
          userHistoryIndex: prev.userHistoryIndex - 1,
        };

        // Forcer l'invalidation du cache du canvas (évite les artefacts de point résiduel)
        // Invalidation synchrone ET asynchrone pour garantir l'effacement immédiat
        try {
          // Invalidation immédiate synchrone
          const cacheInvalidateEvent = new CustomEvent("force-cache-clear");
          window.dispatchEvent(cacheInvalidateEvent);

          // Invalidation asynchrone (backup)
          setTimeout(() => {
            const evt = new CustomEvent("invalidate-canvas-cache");
            window.dispatchEvent(evt);
          }, 0);
        } catch {
          // no-op
        }

        return newState;
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

        const newState = {
          ...prev,
          drawings: updatedDrawings,
          userHistoryIndex: newIndex,
        };

        // Forcer l'invalidation du cache du canvas
        // Invalidation synchrone ET asynchrone pour garantir l'effacement immédiat
        try {
          // Invalidation immédiate synchrone
          const cacheInvalidateEvent = new CustomEvent("force-cache-clear");
          window.dispatchEvent(cacheInvalidateEvent);

          // Invalidation asynchrone (backup)
          setTimeout(() => {
            const evt = new CustomEvent("invalidate-canvas-cache");
            window.dispatchEvent(evt);
          }, 0);
        } catch {
          // no-op
        }

        return newState;
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

        // Invalidation explicite du cache pour undo distant
        try {
          // Invalidation immédiate synchrone
          const cacheInvalidateEvent = new CustomEvent("force-cache-clear");
          window.dispatchEvent(cacheInvalidateEvent);

          // Invalidation asynchrone (backup)
          setTimeout(() => {
            const evt = new CustomEvent("invalidate-canvas-cache");
            window.dispatchEvent(evt);
          }, 0);
        } catch {
          // no-op
        }

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

        // Invalidation explicite du cache pour redo distant
        try {
          // Invalidation immédiate synchrone
          const cacheInvalidateEvent = new CustomEvent("force-cache-clear");
          window.dispatchEvent(cacheInvalidateEvent);

          // Invalidation asynchrone (backup)
          setTimeout(() => {
            const evt = new CustomEvent("invalidate-canvas-cache");
            window.dispatchEvent(evt);
          }, 0);
        } catch {
          // no-op
        }

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
        const existing = prev.drawings.find((d) => d.id === data.id);

        let updated: DrawingData;
        if (data.isIncremental && existing) {
          // Fusionner: garder les 'basePointCount' premiers points de l'existant puis ajouter les nouveaux
          const baseCount =
            typeof data.basePointCount === "number"
              ? data.basePointCount
              : existing.points.length;
          const mergedPoints = [
            ...existing.points.slice(0, baseCount),
            ...data.points,
          ];

          updated = {
            ...existing,
            ...data,
            points: mergedPoints,
            // Assurer la cohérence du timestamp
            timestamp: data.timestamp,
          };
        } else if (data.isIncremental && !existing) {
          // Fallback: si on reçoit un incrémental sans base locale, on stocke tel quel
          // (le serveur enverra aussi un full au départ)
          updated = { ...data };
        } else {
          // Données complètes: remplacer proprement
          updated = {
            ...(existing || ({} as DrawingData)),
            ...data,
            timestamp: data.timestamp,
          };
        }

        // Préserver un éventuel état "supprimé" local
        if (existing?.isDeleted) {
          updated.isDeleted = true;
        }

        const others = prev.drawings.filter((d) => d.id !== data.id);
        return {
          ...prev,
          drawings: [...others, updated].sort(
            (a, b) => a.timestamp - b.timestamp
          ),
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
        userHistory: [],
        userHistoryIndex: -1,
      }));
    };

    const handleRoomError = (error: string) => {
      console.error("Erreur de salle:", error);
      alert(`Erreur: ${error}`);
    };

    // Désenregistrer précisément les anciens listeners (éviter removeAllListeners)
    socketService.removeListener("drawing-data");
    socketService.removeListener("user-joined");
    socketService.removeListener("user-left");
    socketService.removeListener("user-cursor");
    socketService.removeListener("room-joined");
    socketService.removeListener("room-error");
    socketService.removeListener("canvas-clear");
    socketService.removeListener("canvas-undo");
    socketService.removeListener("canvas-redo");

    // Enregistrer les listeners
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
      socketService.removeListener("drawing-data");
      socketService.removeListener("user-joined");
      socketService.removeListener("user-left");
      socketService.removeListener("user-cursor");
      socketService.removeListener("room-joined");
      socketService.removeListener("room-error");
      socketService.removeListener("canvas-clear");
      socketService.removeListener("canvas-undo");
      socketService.removeListener("canvas-redo");
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
    setHardness,

    // Utilitaires
    isConnected,
  };
};

export default useCanvas;
