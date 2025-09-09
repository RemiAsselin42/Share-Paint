import React, { useRef, useEffect, useState, useCallback } from "react";
import type { Point, DrawingData, DrawingTool, User } from "../types";
import "./Canvas.scss";

interface CanvasProps {
  drawings: DrawingData[];
  users: Map<string, User>;
  currentTool: DrawingTool;
  currentColor: string;
  currentLineWidth: number;
  currentOpacity: number;
  isDrawing: boolean;
  onStartDrawing: (point: Point) => void;
  onDraw: (point: Point) => void;
  onEndDrawing: () => void;
  onMouseMove: (point: Point) => void;
  onColorChange: (color: string) => void;
  userId: string;
}

const Canvas: React.FC<CanvasProps> = ({
  drawings,
  users,
  currentTool,
  currentColor,
  currentLineWidth,
  currentOpacity,
  isDrawing,
  onStartDrawing,
  onDraw,
  onEndDrawing,
  onMouseMove,
  onColorChange,
  userId,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Canvas avec taille fixe de 1000x1000
  const CANVAS_WIDTH = 1000;
  const CANVAS_HEIGHT = 1000;

  // État pour le viewport (pan/zoom)
  const [viewport, setViewport] = useState({
    x: 0,
    y: 0,
    scale: 1,
  });

  // État pour le déplacement du canvas
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPoint, setLastPanPoint] = useState<Point>({ x: 0, y: 0 });
  const [containerSize, setContainerSize] = useState({
    width: 800,
    height: 600,
  });

  const getMousePos = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();

      // Position de la souris dans le container
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      // Convertir en coordonnées du canvas en tenant compte du viewport
      const canvasX = (clientX - viewport.x) / viewport.scale;
      const canvasY = (clientY - viewport.y) / viewport.scale;

      return {
        x: canvasX,
        y: canvasY,
      };
    },
    [viewport]
  );

  const getViewportMousePos = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();

      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    },
    []
  );

  // Fonction pour dessiner l'effet calligraphie
  const drawCalligraphy = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      points: Point[],
      color: string,
      lineWidth: number,
      opacity: number
    ) => {
      if (points.length < 2) return;

      ctx.globalAlpha = opacity;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;

      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];

        // Épaisseur variable basée sur la vitesse
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const speed = Math.min(distance, 10);
        const thickness = lineWidth * (1 - speed / 20);

        ctx.lineWidth = Math.max(thickness, 1);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    },
    []
  );

  const drawLine = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      points: Point[],
      color: string,
      lineWidth: number,
      opacity: number,
      tool: DrawingTool
    ) => {
      if (points.length < 1) return;

      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = lineWidth;

      // ✅ SOLUTION : Propriétés fixes pour TOUS les outils (sauf cas spéciaux)
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Anti-aliasing et qualité de rendu optimisée
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      // Gestion des différents outils
      switch (tool) {
        case "eraser":
          ctx.globalCompositeOperation = "destination-out";
          ctx.globalAlpha = opacity; // L'opacité affecte maintenant l'intensité de la gomme
          // ✅ Conserver lineCap/lineJoin round pour la gomme aussi
          break;

        case "brush":
          ctx.globalCompositeOperation = "source-over";
          // ✅ lineCap/lineJoin déjà définis en "round" ci-dessus
          break;

        case "pencil":
          ctx.globalCompositeOperation = "source-over";
          // ✅ CHANGEMENT : Plus de lineCap "square" - on garde "round" pour la cohérence
          // ctx.lineCap = "square"; // SUPPRIMÉ
          break;

        // case "marker":
        //   ctx.globalCompositeOperation = "multiply";
        //   ctx.globalAlpha = Math.min(opacity, 0.7);
        //   break;

        // case "spray":
        //   ctx.globalCompositeOperation = "source-over";
        //   return drawSpray(ctx, points, color, lineWidth, opacity);

        case "calligraphy":
          ctx.globalCompositeOperation = "source-over";
          // Traiter la calligraphie comme un cas spécial mais continuer le processus
          break;

        case "watercolor":
          ctx.globalCompositeOperation = "multiply";
          ctx.globalAlpha = Math.min(opacity, 0.6);
          // Effet aquarelle avec une ligne plus douce
          ctx.shadowColor = color;
          ctx.shadowBlur = lineWidth * 0.5;
          break;

        case "line":
        case "circle":
        case "rectangle":
          ctx.globalCompositeOperation = "source-over";
          break;

        default:
          ctx.globalCompositeOperation = "source-over";
      }

      // Dessiner selon le type d'outil
      if (tool === "calligraphy") {
        // Traitement spécial pour la calligraphie
        drawCalligraphy(ctx, points, color, lineWidth, opacity);
      } else if (tool === "line" && points.length >= 2) {
        // Ligne droite
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        ctx.stroke();
      } else if (tool === "circle" && points.length >= 2) {
        // Cercle
        const startPoint = points[0];
        const endPoint = points[points.length - 1];
        const radius = Math.sqrt(
          Math.pow(endPoint.x - startPoint.x, 2) +
            Math.pow(endPoint.y - startPoint.y, 2)
        );
        ctx.beginPath();
        ctx.arc(startPoint.x, startPoint.y, radius, 0, 2 * Math.PI);
        ctx.stroke();
      } else if (tool === "rectangle" && points.length >= 2) {
        // Rectangle
        const startPoint = points[0];
        const endPoint = points[points.length - 1];
        const width = endPoint.x - startPoint.x;
        const height = endPoint.y - startPoint.y;
        ctx.beginPath();
        ctx.rect(startPoint.x, startPoint.y, width, height);
        ctx.stroke();
      } else if (points.length === 1) {
        // Point unique
        ctx.beginPath();
        ctx.arc(points[0].x, points[0].y, lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (points.length === 2) {
        // Deux points : ligne simple
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[1].x, points[1].y);
        ctx.stroke();
      } else {
        // Courbe lissée pour les outils de pinceau
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);

        for (let i = 1; i < points.length - 2; i++) {
          const cp1x = (points[i].x + points[i + 1].x) / 2;
          const cp1y = (points[i].y + points[i + 1].y) / 2;
          ctx.quadraticCurveTo(points[i].x, points[i].y, cp1x, cp1y);
        }

        if (points.length > 2) {
          ctx.quadraticCurveTo(
            points[points.length - 2].x,
            points[points.length - 2].y,
            points[points.length - 1].x,
            points[points.length - 1].y
          );
        }

        ctx.stroke();
      }

      // Réinitialiser les effets shadow
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;

      ctx.restore();
    },
    [drawCalligraphy]
  );

  // Fonction pour extraire la couleur à un point donné
  const getColorAtPoint = useCallback(
    (point: Point): string => {
      // Créer un canvas temporaire avec tous les dessins pour la pipette
      const tempCanvas = document.createElement("canvas");
      const tempCtx = tempCanvas.getContext("2d");
      if (!tempCtx) return currentColor;

      tempCanvas.width = CANVAS_WIDTH;
      tempCanvas.height = CANVAS_HEIGHT;

      // Fond blanc pour le canvas temporaire
      tempCtx.fillStyle = "#ffffff";
      tempCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Dessiner tous les dessins non supprimés dans l'ordre chronologique
      drawings
        .filter((drawing) => !drawing.isDeleted)
        .sort((a, b) => a.timestamp - b.timestamp)
        .forEach((drawing) => {
          if (drawing.points.length > 0) {
            drawLine(
              tempCtx,
              drawing.points,
              drawing.color,
              drawing.lineWidth,
              drawing.opacity || 1,
              drawing.tool
            );
          }
        });

      // Extraire la couleur du pixel à la position demandée
      const imageData = tempCtx.getImageData(
        Math.floor(point.x),
        Math.floor(point.y),
        1,
        1
      );
      const [r, g, b, a] = imageData.data;

      // Si le pixel est transparent, retourner le blanc (fond)
      if (a === 0) return "#ffffff";

      // Convertir en format hex
      const toHex = (n: number) => n.toString(16).padStart(2, "0");
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    },
    [currentColor, drawings, drawLine, CANVAS_WIDTH, CANVAS_HEIGHT]
  );

  const drawCursor = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      point: Point,
      color: string,
      isOwnCursor = false
    ) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;

      // Draw cursor circle
      ctx.beginPath();
      ctx.arc(point.x, point.y, isOwnCursor ? 3 : 5, 0, 2 * Math.PI);
      if (isOwnCursor) {
        ctx.fill();
      } else {
        ctx.stroke();
      }

      ctx.restore();
    },
    []
  );

  // Fonction pour créer un curseur SVG dynamique
  const createDynamicCursor = useCallback(
    (tool: string, size: number, color: string = "#000000"): string => {
      // Calculer la taille du curseur (minimum 16px, maximum 64px)
      const cursorSize = Math.max(16, Math.min(64, size + 8));
      const radius = Math.max(3, Math.min(28, size / 2));
      const center = cursorSize / 2;

      let svg = "";

      switch (tool) {
        case "brush":
        case "pencil":
        case "watercolor":
        case "calligraphy":
          // Cercle avec bordure pour le pinceau
          svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cursorSize}" height="${cursorSize}" viewBox="0 0 ${cursorSize} ${cursorSize}">
            <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.8"/>
            <circle cx="${center}" cy="${center}" r="1" fill="${color}" opacity="0.6"/>
          </svg>`;
          break;

        case "eraser": {
          // Cercle avec bordure pour la gomme (maintenant rond comme demandé)
          svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cursorSize}" height="${cursorSize}" viewBox="0 0 ${cursorSize} ${cursorSize}">
            <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="#000000" stroke-width="1.5" opacity="0.8"/>
            <circle cx="${center}" cy="${center}" r="1" fill="#000000" opacity="0.6"/>
          </svg>`;
          break;
        }

        case "line":
          // Crosshair pour la ligne avec couleur
          svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cursorSize}" height="${cursorSize}" viewBox="0 0 ${cursorSize} ${cursorSize}">
            <line x1="${center - radius}" y1="${center}" x2="${
            center + radius
          }" y2="${center}" stroke="${color}" stroke-width="1.5" opacity="0.8"/>
            <line x1="${center}" y1="${center - radius}" x2="${center}" y2="${
            center + radius
          }" stroke="${color}" stroke-width="1.5" opacity="0.8"/>
            <circle cx="${center}" cy="${center}" r="1" fill="${color}" opacity="0.6"/>
          </svg>`;
          break;

        default:
          // Curseur par défaut
          svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cursorSize}" height="${cursorSize}" viewBox="0 0 ${cursorSize} ${cursorSize}">
            <circle cx="${center}" cy="${center}" r="3" fill="${color}" opacity="0.8"/>
          </svg>`;
      }

      // Encoder en base64 pour l'URL
      return `url('data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
        svg
      )}') ${center} ${center}, crosshair`;
    },
    []
  );

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Sauvegarder l'état du contexte
    ctx.save();

    // Appliquer les transformations du viewport
    ctx.translate(viewport.x, viewport.y);
    ctx.scale(viewport.scale, viewport.scale);

    // Dessiner un fond pour le canvas virtuel
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Bordure du canvas virtuel
    ctx.strokeStyle = "#dee2e6";
    ctx.lineWidth = 2 / viewport.scale; // Ajuster l'épaisseur en fonction du zoom
    ctx.strokeRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Créer un canvas temporaire pour gérer la gomme correctement
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");
    if (tempCtx) {
      tempCanvas.width = CANVAS_WIDTH;
      tempCanvas.height = CANVAS_HEIGHT;

      // Fond blanc pour le canvas temporaire
      tempCtx.fillStyle = "#ffffff";
      tempCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Dessiner tous les dessins non supprimés sur le canvas temporaire dans l'ordre chronologique
      drawings
        .filter((drawing) => !drawing.isDeleted) // Filtrer les dessins supprimés
        .sort((a, b) => a.timestamp - b.timestamp) // Trier par ordre chronologique
        .forEach((drawing) => {
          if (drawing.points.length > 0) {
            drawLine(
              tempCtx,
              drawing.points,
              drawing.color,
              drawing.lineWidth,
              drawing.opacity || 1,
              drawing.tool
            );
          }
        });

      // Dessiner le canvas temporaire sur le canvas principal
      ctx.drawImage(tempCanvas, 0, 0);
    }

    // Draw other users' cursors
    users.forEach((user, id) => {
      if (id !== userId && user.cursor) {
        drawCursor(ctx, user.cursor, user.color, false);
      }
    });

    // Restaurer l'état du contexte
    ctx.restore();
  }, [
    drawings,
    users,
    userId,
    drawLine,
    drawCursor,
    viewport,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
  ]);

  // Référence pour éviter la re-exécution du useEffect lors des changements de viewport
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  useEffect(() => {
    const updateContainerSize = () => {
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const newWidth = rect.width;
        const newHeight = rect.height;

        // Sauvegarder l'ancien viewport pour éviter les saccades
        const currentViewport = viewportRef.current;

        setContainerSize({
          width: newWidth,
          height: newHeight,
        });

        // Centrer le canvas virtuel dans le conteneur UNIQUEMENT au premier chargement
        // Vérifier si c'est vraiment le premier chargement (aucune interaction utilisateur)
        if (
          currentViewport.x === 0 &&
          currentViewport.y === 0 &&
          currentViewport.scale === 1
        ) {
          // Calculer le centrage initial
          const initialX = Math.max(0, (newWidth - CANVAS_WIDTH) / 2);
          const initialY = Math.max(0, (newHeight - CANVAS_HEIGHT) / 2);

          setViewport({
            x: initialX,
            y: initialY,
            scale: 1,
          });
        }
        // Forcer le redraw immédiatement après le resize pour éviter la disparition
        setTimeout(() => {
          redrawCanvas();
        }, 0);
      }
    };

    updateContainerSize();
    window.addEventListener("resize", updateContainerSize);
    return () => window.removeEventListener("resize", updateContainerSize);
  }, [CANVAS_WIDTH, CANVAS_HEIGHT, redrawCanvas]); // Ajouter redrawCanvas aux dépendances

  // Fonction pour recentrer le canvas manuellement
  const centerCanvas = useCallback(() => {
    setViewport({
      x: (containerSize.width - CANVAS_WIDTH) / 2,
      y: (containerSize.height - CANVAS_HEIGHT) / 2,
      scale: 1,
    });
  }, [containerSize.width, containerSize.height, CANVAS_WIDTH, CANVAS_HEIGHT]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  // Effet spécifique pour redessiner lors du changement de taille du conteneur
  useEffect(() => {
    if (containerSize.width > 0 && containerSize.height > 0) {
      // Petit délai pour s'assurer que le canvas est redimensionné
      const timeoutId = setTimeout(() => {
        redrawCanvas();
      }, 10);
      return () => clearTimeout(timeoutId);
    }
  }, [containerSize, redrawCanvas]);

  // Appliquer le curseur dynamique quand l'outil ou la taille change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cursor = createDynamicCursor(
      currentTool,
      currentLineWidth,
      currentColor
    );
    canvas.style.cursor = cursor;
  }, [
    currentTool,
    currentLineWidth,
    currentColor,
    currentOpacity,
    createDynamicCursor,
  ]);

  // Gestion des raccourcis clavier
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl + 0 pour recentrer et remettre le zoom à 100%
      if (e.ctrlKey && e.key === "0") {
        e.preventDefault();
        centerCanvas();
      }
      // Échap pour arrêter le panning en cours
      if (e.key === "Escape" && isPanning) {
        setIsPanning(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [centerCanvas, isPanning]);

  // Écouter l'événement de sauvegarde du canvas
  useEffect(() => {
    const handleSaveCanvas = (event: CustomEvent<{ format: string }>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const { format } = event.detail;
      let mimeType = "image/png";
      let quality = 1;

      switch (format.toLowerCase()) {
        case "jpeg":
        case "jpg":
          mimeType = "image/jpeg";
          quality = 0.9;
          break;
        case "webp":
          mimeType = "image/webp";
          quality = 0.9;
          break;
        case "png":
        default:
          mimeType = "image/png";
          break;
      }

      try {
        // Créer un canvas temporaire propre (sans curseurs)
        const tempCanvas = document.createElement("canvas");
        const tempCtx = tempCanvas.getContext("2d");
        if (!tempCtx) return;

        // Utiliser la taille réelle du canvas virtuel pour une meilleure qualité
        tempCanvas.width = CANVAS_WIDTH;
        tempCanvas.height = CANVAS_HEIGHT;

        // Toujours commencer avec un fond blanc
        tempCtx.fillStyle = "#ffffff";
        tempCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Filtrer les dessins non supprimés et les trier par timestamp
        const validDrawings = drawings
          .filter((drawing) => !drawing.isDeleted && drawing.points.length > 0)
          .sort((a, b) => a.timestamp - b.timestamp);

        // Dessiner tous les dessins dans l'ordre chronologique
        validDrawings.forEach((drawing) => {
          // Pour la sauvegarde, convertir les traces de gomme en blanc pour éviter la transparence
          if (drawing.tool === "eraser") {
            drawLine(
              tempCtx,
              drawing.points,
              "#ffffff", // Forcer le blanc pour la gomme lors de l'export
              drawing.lineWidth,
              1, // Opacité maximale
              "brush" // Traiter comme un pinceau blanc au lieu d'une gomme
            );
          } else {
            drawLine(
              tempCtx,
              drawing.points,
              drawing.color,
              drawing.lineWidth,
              drawing.opacity || 1,
              drawing.tool
            );
          }
        });

        // Télécharger depuis le canvas temporaire propre
        tempCanvas.toBlob(
          (blob) => {
            if (blob) {
              downloadBlob(blob, `share-paint.${format.toLowerCase()}`);
            }
          },
          mimeType,
          quality
        );
      } catch (error) {
        console.error("Erreur lors de l'enregistrement:", error);
        alert("Erreur lors de l'enregistrement de l'image.");
      }
    };

    const downloadBlob = (blob: Blob, filename: string) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    };

    window.addEventListener("save-canvas", handleSaveCanvas as EventListener);
    return () => {
      window.removeEventListener(
        "save-canvas",
        handleSaveCanvas as EventListener
      );
    };
  }, [drawings, drawLine]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const point = getMousePos(e);
    const viewportPoint = getViewportMousePos(e);

    // Gestion du clic molette ou outil grab pour le panning
    if (e.button === 1 || currentTool === "grab") {
      setIsPanning(true);
      setLastPanPoint(viewportPoint);
      return;
    }

    // Vérifier si le clic est dans les limites du canvas virtuel
    if (
      point.x < 0 ||
      point.x > CANVAS_WIDTH ||
      point.y < 0 ||
      point.y > CANVAS_HEIGHT
    ) {
      return;
    }

    if (currentTool === "colorpicker") {
      // Utiliser l'outil pipette pour extraire la couleur
      const color = getColorAtPoint(point);
      onColorChange(color);
    } else {
      // Vérifier si ce n'est pas l'outil grab
      const drawingTools = [
        "brush",
        "pencil",
        "marker",
        "spray",
        "calligraphy",
        "watercolor",
        "eraser",
        "line",
        "circle",
        "rectangle",
      ];
      if (drawingTools.includes(currentTool)) {
        onStartDrawing(point);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const point = getMousePos(e);
    const viewportPoint = getViewportMousePos(e);

    if (isPanning) {
      // Gestion du panning
      const deltaX = viewportPoint.x - lastPanPoint.x;
      const deltaY = viewportPoint.y - lastPanPoint.y;

      setViewport((prev) => {
        // Calculer les nouvelles coordonnées
        let newX = prev.x + deltaX;
        let newY = prev.y + deltaY;

        // Limites pour empêcher le canvas de sortir complètement de vue
        const scaledCanvasWidth = CANVAS_WIDTH * prev.scale;
        const scaledCanvasHeight = CANVAS_HEIGHT * prev.scale;
        const margin = 100; // Marge minimale visible

        // Limiter le déplacement pour garder une partie du canvas visible
        const minX = -(scaledCanvasWidth - margin);
        const maxX = containerSize.width - margin;
        const minY = -(scaledCanvasHeight - margin);
        const maxY = containerSize.height - margin;

        newX = Math.max(minX, Math.min(maxX, newX));
        newY = Math.max(minY, Math.min(maxY, newY));

        return {
          ...prev,
          x: newX,
          y: newY,
        };
      });

      setLastPanPoint(viewportPoint);
      return;
    }

    // Vérifier si la souris est dans les limites du canvas virtuel pour le curseur
    if (
      point.x >= 0 &&
      point.x <= CANVAS_WIDTH &&
      point.y >= 0 &&
      point.y <= CANVAS_HEIGHT
    ) {
      onMouseMove(point);
    }

    if (isDrawing && currentTool !== "grab" && currentTool !== "colorpicker") {
      // Vérifier si on dessine dans les limites du canvas virtuel
      if (
        point.x >= 0 &&
        point.x <= CANVAS_WIDTH &&
        point.y >= 0 &&
        point.y <= CANVAS_HEIGHT
      ) {
        onDraw(point);
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (isDrawing) {
      onEndDrawing();
    }
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (isDrawing) {
      onEndDrawing();
    }
  };

  // Gestion du zoom avec la molette
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(5, viewport.scale * delta));

    const viewportPoint = getViewportMousePos(e);

    setViewport((prev) => {
      const scaleChange = newScale / prev.scale;
      return {
        x: viewportPoint.x - (viewportPoint.x - prev.x) * scaleChange,
        y: viewportPoint.y - (viewportPoint.y - prev.y) * scaleChange,
        scale: newScale,
      };
    });
  };

  // Générer le style du curseur personnalisé basé sur l'outil, couleur et opacité
  const getCursorStyle = useCallback(() => {
    if (currentTool === "grab") {
      return isPanning ? "grabbing" : "grab";
    }

    const size = Math.min(currentLineWidth + 4, 20);
    if (currentTool === "brush") {
      return `url('data:image/svg+xml;charset=UTF-8,<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${
        size / 2
      }" cy="${size / 2}" r="${
        currentLineWidth / 2
      }" fill="${encodeURIComponent(
        currentColor
      )}" fill-opacity="${currentOpacity}" stroke="black" stroke-width="1"/></svg>') ${
        size / 2
      } ${size / 2}, crosshair`;
    } else if (currentTool === "eraser") {
      return `url('data:image/svg+xml;charset=UTF-8,<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect x="2" y="2" width="${
        size - 4
      }" height="${
        size - 4
      }" fill="none" stroke="black" stroke-width="2"/></svg>') ${size / 2} ${
        size / 2
      }, crosshair`;
    }
    return "crosshair";
  }, [currentTool, currentColor, currentLineWidth, currentOpacity, isPanning]);

  return (
    <div className="canvas-container" ref={containerRef}>
      <canvas
        ref={canvasRef}
        width={containerSize.width}
        height={containerSize.height}
        className={`canvas ${currentTool}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()} // Empêcher le menu contextuel
        style={{ cursor: getCursorStyle() }}
      />

      {/* Indicateur de zoom et position avec contrôles */}
      <div className="viewport-info">
        <span>Zoom: {Math.round(viewport.scale * 100)}%</span>
        <span>
          Position: X:{Math.round(-viewport.x)}, Y:{Math.round(-viewport.y)}
        </span>
        <button
          className="center-button"
          onClick={centerCanvas}
          title="Recentrer le canvas (Ctrl+0)"
        >
          <i className="fa-solid fa-arrows-to-dot"></i>
          Centrer
        </button>
      </div>
    </div>
  );
};

export default Canvas;
