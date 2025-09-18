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
  currentHardness: number;
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
  currentHardness,
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

  // Canvas de cache pour optimiser les performances
  const cacheCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastDrawingsCountRef = useRef<number>(0);
  const lastDrawingsHashRef = useRef<string>("");

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

  // Fonction générique pour obtenir les coordonnées depuis différents types d'événements
  const getPointerPos = useCallback(
    (clientX: number, clientY: number): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();

      // Position du pointeur dans le container
      const containerX = clientX - rect.left;
      const containerY = clientY - rect.top;

      // Convertir en coordonnées du canvas en tenant compte du viewport
      const canvasX = (containerX - viewport.x) / viewport.scale;
      const canvasY = (containerY - viewport.y) / viewport.scale;

      return {
        x: canvasX,
        y: canvasY,
      };
    },
    [viewport]
  );

  const getMousePos = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): Point => {
      return getPointerPos(e.clientX, e.clientY);
    },
    [getPointerPos]
  );

  // Fonction pour obtenir les coordonnées depuis les événements tactiles/stylet
  const getTouchPos = useCallback(
    (
      e:
        | React.TouchEvent<HTMLCanvasElement>
        | React.PointerEvent<HTMLCanvasElement>
    ): Point => {
      if ("touches" in e && e.touches.length > 0) {
        // Événement tactile - la pression n'est généralement pas disponible
        const touch = e.touches[0];
        return {
          ...getPointerPos(touch.clientX, touch.clientY),
          pressure: 0.5, // Valeur par défaut pour le touch
        };
      } else if ("clientX" in e) {
        // Événement pointer avec support de la pression
        return {
          ...getPointerPos(e.clientX, e.clientY),
          pressure: e.pressure || 0.5, // Pression du stylet (0-1)
        };
      }
      return { x: 0, y: 0, pressure: 0.5 };
    },
    [getPointerPos]
  );

  const getViewportMousePos = useCallback(
    (clientX: number, clientY: number): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();

      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      };
    },
    []
  );

  const getViewportPosFromMouse = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): Point => {
      return getViewportMousePos(e.clientX, e.clientY);
    },
    [getViewportMousePos]
  );

  // Fonction pour dessiner l'effet calligraphie
  const drawCalligraphy = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      points: Point[],
      color: string,
      lineWidth: number,
      opacity: number,
      hardness: number
    ) => {
      // Ignorer complètement la dureté pour l'outil Calligraphie
      void hardness;

      // Variation resserrée mais un peu plus visible: ~55% à 145% de lineWidth
      const MIN_SCALE = 0.55;
      const MAX_SCALE = 1.45;
      const minThickness = Math.max(0.5, lineWidth * MIN_SCALE);
      const maxThickness = lineWidth * MAX_SCALE;

      if (points.length === 1) {
        // Permettre de faire un point sur simple clic
        const p = points[0];
        const pressure = p.pressure ?? 0.5;
        // Rayon clampé dans la même plage d'épaisseurs que le trait
        const rawDiameter = lineWidth * (0.5 + pressure * 0.5); // 0.5x -> 1.0x lineWidth
        const clampedDiameter = Math.max(
          minThickness,
          Math.min(maxThickness, rawDiameter)
        );
        const radius = Math.max(0.75, clampedDiameter / 2);
        ctx.globalAlpha = opacity;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      if (points.length < 2) return;

      // Paramètres
      ctx.globalAlpha = opacity;
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // (minThickness et maxThickness déjà définis ci-dessus)

      // Calcul de l'épaisseur par point (vitesse/angle/pression)
      const widths: number[] = new Array(points.length);
      for (let i = 0; i < points.length; i++) {
        const prev = i > 0 ? points[i - 1] : points[i];
        const next = i < points.length - 1 ? points[i + 1] : points[i];
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const distance = Math.hypot(dx, dy);
        const speed = Math.min(distance, 15);
        const speedFactor = 1 - Math.pow(speed / 15, 0.7);
        const angle = Math.atan2(dy, dx);
        const angleFactor = Math.abs(Math.sin(angle * 2)) * 0.3 + 0.7;
        const varTh =
          minThickness +
          (maxThickness - minThickness) * speedFactor * angleFactor;
        const pressure = points[i].pressure ?? 0.5;
        const finalTh = Math.max(varTh * (0.5 + pressure * 0.5), minThickness);
        widths[i] = finalTh;
      }

      // Construire le ruban (polygone) gauche/droite
      const left: Point[] = [];
      const right: Point[] = [];
      for (let i = 0; i < points.length; i++) {
        const prev = i > 0 ? points[i - 1] : points[i];
        const next = i < points.length - 1 ? points[i + 1] : points[i];
        let tx = next.x - prev.x;
        let ty = next.y - prev.y;
        const len = Math.hypot(tx, ty) || 1;
        tx /= len;
        ty /= len;
        // normale à gauche
        const nx = -ty;
        const ny = tx;
        const hw = widths[i] / 2;
        left.push({ x: points[i].x + nx * hw, y: points[i].y + ny * hw });
        right.push({ x: points[i].x - nx * hw, y: points[i].y - ny * hw });
      }

      // Tracer et remplir le polygone
      ctx.beginPath();
      ctx.moveTo(left[0].x, left[0].y);
      for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
      for (let i = right.length - 1; i >= 0; i--)
        ctx.lineTo(right[i].x, right[i].y);
      ctx.closePath();
      ctx.fill();

      // Bout arrondi aux extrémités
      const startR = widths[0] / 2;
      const endR = widths[widths.length - 1] / 2;
      if (startR > 0.25) {
        ctx.beginPath();
        ctx.arc(points[0].x, points[0].y, startR, 0, Math.PI * 2);
        ctx.fill();
      }
      if (endR > 0.25) {
        ctx.beginPath();
        ctx.arc(
          points[points.length - 1].x,
          points[points.length - 1].y,
          endR,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    },
    []
  );

  // Ramer–Douglas–Peucker simplification to control "hardness" (straighter lines)
  const perpendicularDistance = useCallback((p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    return Math.hypot(p.x - projX, p.y - projY);
  }, []);

  const rdpSimplify = useCallback(
    (pts: Point[], epsilon: number): Point[] => {
      if (pts.length < 3 || epsilon <= 0) return pts;
      let dmax = 0;
      let index = 0;
      const end = pts.length - 1;
      for (let i = 1; i < end; i++) {
        const d = perpendicularDistance(pts[i], pts[0], pts[end]);
        if (d > dmax) {
          index = i;
          dmax = d;
        }
      }
      if (dmax > epsilon) {
        const rec1 = rdpSimplify(pts.slice(0, index + 1), epsilon);
        const rec2 = rdpSimplify(pts.slice(index), epsilon);
        return rec1.slice(0, -1).concat(rec2);
      } else {
        return [pts[0], pts[end]];
      }
    },
    [perpendicularDistance]
  );

  const drawLine = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      points: Point[],
      color: string,
      lineWidth: number,
      opacity: number,
      tool: DrawingTool,
      hardnessInput?: number
    ) => {
      if (points.length < 1) return;

      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = lineWidth;

      // Ajuster en fonction de la dureté
      const hardnessRaw =
        typeof hardnessInput === "number" ? hardnessInput : currentHardness;
      const hardness = Math.max(0, Math.min(1, hardnessRaw));
      const hardnessIsZero = hardness <= 0.0001;

      // Caps/joins: si dureté minimale => aucun impact (comportement par défaut rond)
      if (hardnessIsZero) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
      } else {
        ctx.lineCap = hardness >= 0.75 ? "butt" : "round";
        ctx.lineJoin = hardness >= 0.75 ? "miter" : "round";
        ctx.miterLimit = 2 + hardness * 8; // plus dur => miter plus long
      }

      // Anti-aliasing et qualité de rendu optimisée
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      // Calculer un epsilon de simplification basé sur la dureté et l'épaisseur
      // Si dureté minimale => aucune simplification (trait 100% libre)
      const epsilon = hardnessIsZero
        ? 0
        : hardness * Math.max(1, lineWidth * 0.6);
      const simplifiedPoints =
        tool === "line" || tool === "circle" || tool === "rectangle"
          ? points
          : epsilon > 0
          ? rdpSimplify(points, epsilon)
          : points;

      // Gestion des différents outils
      switch (tool) {
        case "eraser":
          ctx.globalCompositeOperation = "destination-out";
          ctx.globalAlpha = opacity; // L'opacité affecte maintenant l'intensité de la gomme
          break;

        case "brush":
          ctx.globalCompositeOperation = "source-over";
          break;

        case "pencil":
          ctx.globalCompositeOperation = "source-over";
          break;

        case "calligraphy":
          ctx.globalCompositeOperation = "source-over";
          break;

        case "marker":
          ctx.globalCompositeOperation = "multiply";
          ctx.globalAlpha = Math.min(opacity, 0.6);
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
        // Calligraphie: chemin lissé unique, pas de simplification géométrique
        // Note: la dureté est ignorée dans drawCalligraphy (aucun impact)
        drawCalligraphy(ctx, points, color, lineWidth, opacity, hardness);
      } else if (tool === "line" && simplifiedPoints.length >= 2) {
        // Ligne droite
        ctx.beginPath();
        ctx.moveTo(simplifiedPoints[0].x, simplifiedPoints[0].y);
        ctx.lineTo(
          simplifiedPoints[simplifiedPoints.length - 1].x,
          simplifiedPoints[simplifiedPoints.length - 1].y
        );
        ctx.stroke();
      } else if (tool === "circle" && simplifiedPoints.length >= 2) {
        // Cercle
        const startPoint = simplifiedPoints[0];
        const endPoint = simplifiedPoints[simplifiedPoints.length - 1];
        const radius = Math.sqrt(
          Math.pow(endPoint.x - startPoint.x, 2) +
            Math.pow(endPoint.y - startPoint.y, 2)
        );
        ctx.beginPath();
        ctx.arc(startPoint.x, startPoint.y, radius, 0, 2 * Math.PI);
        ctx.stroke();
      } else if (tool === "rectangle" && simplifiedPoints.length >= 2) {
        // Rectangle
        const startPoint = simplifiedPoints[0];
        const endPoint = simplifiedPoints[simplifiedPoints.length - 1];
        const width = endPoint.x - startPoint.x;
        const height = endPoint.y - startPoint.y;
        ctx.beginPath();
        ctx.rect(startPoint.x, startPoint.y, width, height);
        ctx.stroke();
      } else if (simplifiedPoints.length === 1) {
        // Point unique avec gestion différenciée selon l'outil
        const point = simplifiedPoints[0];

        if (tool === "pencil") {
          // Crayon : taille constante, pas de variation de pression
          ctx.beginPath();
          ctx.arc(point.x, point.y, lineWidth / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Autres outils : avec pression
          const pressure = point.pressure || 0.5;
          const pressuredSize = lineWidth * pressure;

          ctx.beginPath();
          ctx.arc(point.x, point.y, pressuredSize / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (simplifiedPoints.length === 2) {
        // Deux points : ligne simple
        const startPoint = simplifiedPoints[0];
        const endPoint = simplifiedPoints[1];

        if (tool === "pencil") {
          // Crayon : épaisseur constante
          ctx.lineWidth = lineWidth;
        } else {
          // Autres outils : avec pression moyenne
          const startPressure = startPoint.pressure || 0.5;
          const endPressure = endPoint.pressure || 0.5;
          const avgPressure = (startPressure + endPressure) / 2;
          ctx.lineWidth = lineWidth * avgPressure;
        }

        ctx.beginPath();
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(endPoint.x, endPoint.y);
        ctx.stroke();
      } else {
        // Courbe lissée avec gestion différenciée selon l'outil
        if (tool === "brush" || tool === "eraser") {
          if (hardnessIsZero) {
            // Dureté minimale: tracer une courbe continue lissée sans points ni segments visibles
            // Approche: courbe quadratique avec épaisseur constante (pression moyenne)
            const pressures = simplifiedPoints.map((p) => p.pressure ?? 0.5);
            const avgPressure =
              pressures.reduce((a, b) => a + b, 0) / (pressures.length || 1);
            const width =
              tool === "brush"
                ? lineWidth * Math.max(0.1, avgPressure)
                : lineWidth;

            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(simplifiedPoints[0].x, simplifiedPoints[0].y);
            for (let i = 1; i < simplifiedPoints.length - 2; i++) {
              const cp1x =
                (simplifiedPoints[i].x + simplifiedPoints[i + 1].x) / 2;
              const cp1y =
                (simplifiedPoints[i].y + simplifiedPoints[i + 1].y) / 2;
              ctx.quadraticCurveTo(
                simplifiedPoints[i].x,
                simplifiedPoints[i].y,
                cp1x,
                cp1y
              );
            }
            if (simplifiedPoints.length > 2) {
              ctx.quadraticCurveTo(
                simplifiedPoints[simplifiedPoints.length - 2].x,
                simplifiedPoints[simplifiedPoints.length - 2].y,
                simplifiedPoints[simplifiedPoints.length - 1].x,
                simplifiedPoints[simplifiedPoints.length - 1].y
              );
            }
            ctx.stroke();
          } else {
            // Dureté > 0: segments variables avec pression (comportement existant)
            for (let i = 0; i < simplifiedPoints.length - 1; i++) {
              const currentPoint = simplifiedPoints[i];
              const nextPoint = simplifiedPoints[i + 1];

              const currentPressure = currentPoint.pressure || 0.5;
              const nextPressure = nextPoint.pressure || 0.5;
              const avgPressure = (currentPressure + nextPressure) / 2;

              const pressuredLineWidth = lineWidth * Math.max(0.1, avgPressure);

              ctx.lineWidth = pressuredLineWidth;
              ctx.beginPath();
              ctx.moveTo(currentPoint.x, currentPoint.y);
              ctx.lineTo(nextPoint.x, nextPoint.y);
              ctx.stroke();
            }
          }
        } else if (tool === "pencil") {
          // Crayon : courbe lissée avec épaisseur constante (pas de variation de pression)
          ctx.lineWidth = lineWidth; // Épaisseur fixe
          ctx.beginPath();
          ctx.moveTo(simplifiedPoints[0].x, simplifiedPoints[0].y);

          for (let i = 1; i < simplifiedPoints.length - 2; i++) {
            const cp1x =
              (simplifiedPoints[i].x + simplifiedPoints[i + 1].x) / 2;
            const cp1y =
              (simplifiedPoints[i].y + simplifiedPoints[i + 1].y) / 2;
            ctx.quadraticCurveTo(
              simplifiedPoints[i].x,
              simplifiedPoints[i].y,
              cp1x,
              cp1y
            );
          }

          if (simplifiedPoints.length > 2) {
            ctx.quadraticCurveTo(
              simplifiedPoints[simplifiedPoints.length - 2].x,
              simplifiedPoints[simplifiedPoints.length - 2].y,
              simplifiedPoints[simplifiedPoints.length - 1].x,
              simplifiedPoints[simplifiedPoints.length - 1].y
            );
          }

          ctx.stroke();
        } else {
          // Autres outils : courbe lissée avec épaisseur constante
          ctx.lineWidth = lineWidth; // Épaisseur fixe pour tous les autres outils
          ctx.beginPath();
          ctx.moveTo(simplifiedPoints[0].x, simplifiedPoints[0].y);

          for (let i = 1; i < simplifiedPoints.length - 2; i++) {
            const cp1x =
              (simplifiedPoints[i].x + simplifiedPoints[i + 1].x) / 2;
            const cp1y =
              (simplifiedPoints[i].y + simplifiedPoints[i + 1].y) / 2;
            ctx.quadraticCurveTo(
              simplifiedPoints[i].x,
              simplifiedPoints[i].y,
              cp1x,
              cp1y
            );
          }

          if (simplifiedPoints.length > 2) {
            ctx.quadraticCurveTo(
              simplifiedPoints[simplifiedPoints.length - 2].x,
              simplifiedPoints[simplifiedPoints.length - 2].y,
              simplifiedPoints[simplifiedPoints.length - 1].x,
              simplifiedPoints[simplifiedPoints.length - 1].y
            );
          }

          ctx.stroke();
        }
      }

      // Réinitialiser les effets shadow
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;

      ctx.restore();
    },
    [drawCalligraphy, currentHardness, rdpSimplify]
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
        case "marker":
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

  // Fonction pour créer un hash des dessins pour détecter les changements
  const createDrawingsHash = useCallback((drawings: DrawingData[]): string => {
    return drawings
      .filter((drawing) => !drawing.isDeleted)
      .map(
        (drawing) =>
          `${drawing.id}-${drawing.timestamp}-${drawing.points.length}`
      )
      .join("|");
  }, []);

  // Fonction pour initialiser ou obtenir le canvas de cache
  const getCacheCanvas = useCallback((): HTMLCanvasElement => {
    if (!cacheCanvasRef.current) {
      cacheCanvasRef.current = document.createElement("canvas");
      cacheCanvasRef.current.width = CANVAS_WIDTH;
      cacheCanvasRef.current.height = CANVAS_HEIGHT;
    }
    return cacheCanvasRef.current;
  }, [CANVAS_WIDTH, CANVAS_HEIGHT]);

  // Fonction pour regénérer complètement le cache
  const regenerateCache = useCallback(() => {
    const cacheCanvas = getCacheCanvas();
    const cacheCtx = cacheCanvas.getContext("2d");
    if (!cacheCtx) return;

    // Vider le cache
    cacheCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Fond blanc pour le cache
    cacheCtx.fillStyle = "#ffffff";
    cacheCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Dessiner tous les dessins non supprimés dans l'ordre chronologique
    drawings
      .filter((drawing) => !drawing.isDeleted)
      .sort((a, b) => a.timestamp - b.timestamp)
      .forEach((drawing) => {
        if (drawing.points.length > 0) {
          drawLine(
            cacheCtx,
            drawing.points,
            drawing.color,
            drawing.lineWidth,
            drawing.opacity || 1,
            drawing.tool,
            drawing.hardness ?? currentHardness
          );
        }
      });
  }, [
    getCacheCanvas,
    drawings,
    drawLine,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    currentHardness,
  ]);

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Vérifier si nous devons mettre à jour le cache
    const currentDrawingsHash = createDrawingsHash(drawings);
    const currentDrawingsCount = drawings.filter((d) => !d.isDeleted).length;

    // Si le hash a changé ou c'est le premier rendu, mettre à jour le cache
    if (
      lastDrawingsHashRef.current !== currentDrawingsHash ||
      !cacheCanvasRef.current
    ) {
      regenerateCache();
      lastDrawingsHashRef.current = currentDrawingsHash;
      lastDrawingsCountRef.current = currentDrawingsCount;
    }

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

    // Dessiner le cache au lieu de redessiner tous les traits
    const cacheCanvas = getCacheCanvas();
    ctx.drawImage(cacheCanvas, 0, 0);

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
    drawCursor,
    viewport,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    createDrawingsHash,
    regenerateCache,
    getCacheCanvas,
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

        // Taille réelle du canvas virtuel pour une meilleure qualité
        tempCanvas.width = CANVAS_WIDTH;
        tempCanvas.height = CANVAS_HEIGHT;

        // Fond blanc
        tempCtx.fillStyle = "#ffffff";
        tempCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Dessins valides triés
        const validDrawings = drawings
          .filter((d) => !d.isDeleted && d.points.length > 0)
          .sort((a, b) => a.timestamp - b.timestamp);

        // Rejouer tous les tracés (gomme aplatie en blanc)
        validDrawings.forEach((d) => {
          if (d.tool === "eraser") {
            drawLine(
              tempCtx,
              d.points,
              "#ffffff",
              d.lineWidth,
              1,
              "brush",
              d.hardness ?? currentHardness
            );
          } else {
            drawLine(
              tempCtx,
              d.points,
              d.color,
              d.lineWidth,
              d.opacity || 1,
              d.tool,
              d.hardness ?? currentHardness
            );
          }
        });

        // Exporter
        const dataUrl = tempCanvas.toDataURL(mimeType, quality);
        const a = document.createElement("a");
        a.href = dataUrl;
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        const ext =
          format.toLowerCase() === "jpg" ? "jpeg" : format.toLowerCase();
        a.download = `share-paint-${ts}.${ext}`;
        a.click();
      } catch (err) {
        console.error("Erreur lors de la sauvegarde du canvas:", err);
      }
    };

    const listener = (e: Event) =>
      handleSaveCanvas(e as CustomEvent<{ format: string }>);
    window.addEventListener("saveCanvas", listener as EventListener);
    return () =>
      window.removeEventListener("saveCanvas", listener as EventListener);
  }, [drawings, drawLine, CANVAS_WIDTH, CANVAS_HEIGHT, currentHardness]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const point = getMousePos(e);
    const viewportPoint = getViewportPosFromMouse(e);

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
    const viewportPoint = getViewportPosFromMouse(e);

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

  // === GESTION DES ÉVÉNEMENTS TACTILES ET STYLET ===

  // Variables pour gérer l'état des événements tactiles
  const [activePointerId, setActivePointerId] = useState<number | null>(null);
  const [isPanningTouch, setIsPanningTouch] = useState(false);
  const [lastTouchPanPoint, setLastTouchPanPoint] = useState<Point>({
    x: 0,
    y: 0,
  });

  // Gestionnaire pour le début des événements pointer/touch
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Seulement prévenir les événements par défaut pour les stylets et le tactile
    // Laisser les événements de souris passer aux gestionnaires traditionnels
    if (e.pointerType === "pen" || e.pointerType === "touch") {
      e.preventDefault();

      // Capturer le pointeur pour garantir la réception des événements suivants
      e.currentTarget.setPointerCapture(e.pointerId);

      const point = getTouchPos(e);
      const viewportPoint = getViewportMousePos(e.clientX, e.clientY);

      // Gestion du panning avec le doigt ou un stylet avec bouton secondaire
      if (e.pointerType === "touch" && e.isPrimary && currentTool === "grab") {
        setActivePointerId(e.pointerId);
        setIsPanningTouch(true);
        setLastTouchPanPoint(viewportPoint);
        return;
      }

      // Pour les stylets et le tactile, traiter comme un événement de dessin
      if (
        e.pointerType === "pen" ||
        (e.pointerType === "touch" && e.isPrimary)
      ) {
        setActivePointerId(e.pointerId);

        // Vérifier si le point est dans les limites du canvas virtuel
        if (
          point.x < 0 ||
          point.x > CANVAS_WIDTH ||
          point.y < 0 ||
          point.y > CANVAS_HEIGHT
        ) {
          return;
        }

        if (currentTool === "colorpicker") {
          const color = getColorAtPoint(point);
          onColorChange(color);
        } else {
          const drawingTools = [
            "brush",
            "pencil",
            "marker",
            "spray",
            "calligraphy",
            "eraser",
            "line",
            "circle",
            "rectangle",
          ];
          if (drawingTools.includes(currentTool)) {
            onStartDrawing(point);
          }
        }
      }
    }
    // Pour la souris (pointerType === "mouse"), laisser passer à handleMouseDown
  };

  // Gestionnaire pour le mouvement des événements pointer/touch
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Seulement traiter les stylets et le tactile, laisser la souris aux gestionnaires traditionnels
    if (e.pointerType === "pen" || e.pointerType === "touch") {
      e.preventDefault();

      // Ignorer les événements qui ne correspondent pas au pointeur actif
      if (activePointerId !== null && e.pointerId !== activePointerId) {
        return;
      }

      const point = getTouchPos(e);
      const viewportPoint = getViewportMousePos(e.clientX, e.clientY);

      if (isPanningTouch && e.pointerId === activePointerId) {
        // Gestion du panning tactile
        const deltaX = viewportPoint.x - lastTouchPanPoint.x;
        const deltaY = viewportPoint.y - lastTouchPanPoint.y;

        setViewport((prev) => {
          // Calculer les nouvelles coordonnées
          let newX = prev.x + deltaX;
          let newY = prev.y + deltaY;

          // Limites pour empêcher le canvas de sortir complètement de vue
          const scaledCanvasWidth = CANVAS_WIDTH * prev.scale;
          const scaledCanvasHeight = CANVAS_HEIGHT * prev.scale;
          const margin = 100;

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

        setLastTouchPanPoint(viewportPoint);
        return;
      }

      // Mise à jour du curseur si dans les limites du canvas
      if (
        point.x >= 0 &&
        point.x <= CANVAS_WIDTH &&
        point.y >= 0 &&
        point.y <= CANVAS_HEIGHT
      ) {
        onMouseMove(point);
      }

      // Dessin en cours
      if (
        isDrawing &&
        e.pointerId === activePointerId &&
        currentTool !== "grab" &&
        currentTool !== "colorpicker"
      ) {
        if (
          point.x >= 0 &&
          point.x <= CANVAS_WIDTH &&
          point.y >= 0 &&
          point.y <= CANVAS_HEIGHT
        ) {
          onDraw(point);
        }
      }
    }
    // Pour la souris (pointerType === "mouse"), laisser passer à handleMouseMove
  };

  // Gestionnaire pour la fin des événements pointer/touch
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Seulement traiter les stylets et le tactile, laisser la souris aux gestionnaires traditionnels
    if (e.pointerType === "pen" || e.pointerType === "touch") {
      e.preventDefault();

      // Libérer la capture du pointeur
      e.currentTarget.releasePointerCapture(e.pointerId);

      if (e.pointerId === activePointerId) {
        if (isPanningTouch) {
          setIsPanningTouch(false);
        }

        if (isDrawing) {
          onEndDrawing();
        }

        setActivePointerId(null);
      }
    }
    // Pour la souris (pointerType === "mouse"), laisser passer à handleMouseUp
  };

  // Gestionnaire pour l'annulation des événements pointer/touch
  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Seulement traiter les stylets et le tactile
    if (e.pointerType === "pen" || e.pointerType === "touch") {
      e.preventDefault();

      if (e.pointerId === activePointerId) {
        if (isPanningTouch) {
          setIsPanningTouch(false);
        }

        if (isDrawing) {
          onEndDrawing();
        }

        setActivePointerId(null);
      }
    }
  };

  // Gestionnaires pour les événements touch (compatibilité)
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const point = getTouchPos(e);
      const viewportPoint = getViewportMousePos(touch.clientX, touch.clientY);

      if (currentTool === "grab") {
        setIsPanningTouch(true);
        setLastTouchPanPoint(viewportPoint);
        return;
      }

      // Vérifier si le point est dans les limites du canvas virtuel
      if (
        point.x < 0 ||
        point.x > CANVAS_WIDTH ||
        point.y < 0 ||
        point.y > CANVAS_HEIGHT
      ) {
        return;
      }

      if (currentTool === "colorpicker") {
        const color = getColorAtPoint(point);
        onColorChange(color);
      } else {
        const drawingTools = [
          "brush",
          "pencil",
          "marker",
          "spray",
          "calligraphy",
          "eraser",
          "line",
          "circle",
          "rectangle",
        ];
        if (drawingTools.includes(currentTool)) {
          onStartDrawing(point);
        }
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const point = getTouchPos(e);
      const viewportPoint = getViewportMousePos(touch.clientX, touch.clientY);

      if (isPanningTouch) {
        const deltaX = viewportPoint.x - lastTouchPanPoint.x;
        const deltaY = viewportPoint.y - lastTouchPanPoint.y;

        setViewport((prev) => {
          let newX = prev.x + deltaX;
          let newY = prev.y + deltaY;

          const scaledCanvasWidth = CANVAS_WIDTH * prev.scale;
          const scaledCanvasHeight = CANVAS_HEIGHT * prev.scale;
          const margin = 100;

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

        setLastTouchPanPoint(viewportPoint);
        return;
      }

      if (
        point.x >= 0 &&
        point.x <= CANVAS_WIDTH &&
        point.y >= 0 &&
        point.y <= CANVAS_HEIGHT
      ) {
        onMouseMove(point);
      }

      if (
        isDrawing &&
        currentTool !== "grab" &&
        currentTool !== "colorpicker"
      ) {
        if (
          point.x >= 0 &&
          point.x <= CANVAS_WIDTH &&
          point.y >= 0 &&
          point.y <= CANVAS_HEIGHT
        ) {
          onDraw(point);
        }
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    if (isPanningTouch) {
      setIsPanningTouch(false);
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

    const viewportPoint = getViewportMousePos(e.clientX, e.clientY);

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
        // Événements de souris traditionnels
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        // Événements pointer (stylet, souris, touch moderne)
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        // Événements tactiles (compatibilité)
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onContextMenu={(e) => e.preventDefault()} // Empêcher le menu contextuel
        style={{
          cursor: getCursorStyle(),
          // Optimisations pour les tablettes graphiques
          touchAction: "none", // Désactive les gestes natifs du navigateur
          userSelect: "none", // Empêche la sélection de texte
        }}
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
