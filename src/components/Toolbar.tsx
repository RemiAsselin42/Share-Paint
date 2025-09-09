import React, { useState, useRef, useEffect } from "react";
import type { DrawingTool } from "../types";
import ColorPicker from "./ColorPicker";
import "./Toolbar.scss";

interface ToolbarProps {
  currentTool: DrawingTool;
  currentColor: string;
  currentLineWidth: number;
  currentOpacity: number;
  onToolChange: (tool: DrawingTool) => void;
  onColorChange: (color: string) => void;
  onLineWidthChange: (width: number) => void;
  onOpacityChange: (opacity: number) => void;
  onClearCanvas: () => void;
  onSaveCanvas: (format: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const LINE_WIDTHS = [2, 4, 8, 16, 32];

const TOOL_CONFIG = {
  brush: { icon: "fas fa-paintbrush", label: "Pinceau" },
  pencil: { icon: "fas fa-pencil-alt", label: "Crayon" },
  //   marker: { icon: "fas fa-marker", label: "Marqueur" },
  //   spray: { icon: "fas fa-spray-can", label: "Aérosol" },
  calligraphy: { icon: "fas fa-feather-alt", label: "Calligraphie" },
  marker: { icon: "fas fa-highlighter", label: "Marqueur" },
  eraser: { icon: "fas fa-eraser", label: "Gomme" },
  line: { icon: "fas fa-minus", label: "Ligne" },
  circle: { icon: "far fa-circle", label: "Cercle" },
  rectangle: { icon: "far fa-square", label: "Rectangle" },
  colorpicker: { icon: "fas fa-eye-dropper", label: "Pipette" },
  grab: { icon: "fas fa-hand-paper", label: "Déplacer" },
};

const Toolbar: React.FC<ToolbarProps> = ({
  currentTool,
  currentColor,
  currentLineWidth,
  currentOpacity,
  onToolChange,
  onColorChange,
  onLineWidthChange,
  onOpacityChange,
  onClearCanvas,
  onSaveCanvas,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}) => {
  const [showSaveMenu, setShowSaveMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState<"bottom" | "top">("bottom");
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  // Fermer le menu d'enregistrement en cliquant à l'extérieur
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        saveMenuRef.current &&
        !saveMenuRef.current.contains(event.target as Node)
      ) {
        setShowSaveMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Calculer la position du menu pour éviter le débordement
  const calculateMenuPosition = () => {
    if (!saveButtonRef.current) return;

    const buttonRect = saveButtonRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;

    // Hauteur estimée du menu (3 boutons + padding + titre)
    const menuHeight = 180;

    // Si le menu en bas dépasse la fenêtre, l'afficher en haut
    if (
      buttonRect.bottom + menuHeight > viewportHeight &&
      buttonRect.top > menuHeight
    ) {
      setMenuPosition("top");
    } else {
      setMenuPosition("bottom");
    }
  };

  const handleSaveCanvas = (format: string) => {
    onSaveCanvas(format);
    setShowSaveMenu(false);
  };

  const toggleSaveMenu = () => {
    if (!showSaveMenu) {
      calculateMenuPosition();
    }
    setShowSaveMenu(!showSaveMenu);
  };
  return (
    <div className="toolbar">
      <div className="toolbar-section">
        <h3>
          <i className="fas fa-tools"></i> Outils
        </h3>
        <div className="tool-grid">
          {Object.entries(TOOL_CONFIG).map(([tool, config]) => (
            <button
              key={tool}
              className={`tool-button ${currentTool === tool ? "active" : ""}`}
              onClick={() => onToolChange(tool as DrawingTool)}
              title={config.label}
            >
              <i className={config.icon}></i>
              <span className="tool-label">{config.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar-section">
        <h3>
          <i className="fas fa-palette"></i> Couleur
        </h3>
        <div className="color-section">
          <ColorPicker
            currentColor={currentColor}
            onColorChange={onColorChange}
          />
        </div>
      </div>

      <div className="toolbar-section">
        <h3>
          <i className="fas fa-brush"></i> Épaisseur
        </h3>
        <div className="line-width-section">
          <div className="preset-widths">
            {LINE_WIDTHS.map((width) => (
              <button
                key={width}
                className={`width-button ${
                  currentLineWidth === width ? "active" : ""
                }`}
                onClick={() => onLineWidthChange(width)}
                title={`${width}px`}
              >
                <div
                  className="width-preview"
                  style={{
                    width: `${Math.min(width * 2, 24)}px`,
                    height: `${Math.min(width, 12)}px`,
                    backgroundColor: currentColor,
                  }}
                ></div>
              </button>
            ))}
          </div>

          <div className="custom-width">
            <label htmlFor="custom-width">
              <i className="fas fa-sliders-h"></i> Personnalisé:{" "}
              {currentLineWidth}px
            </label>
            <input
              id="custom-width"
              type="range"
              min="1"
              max="50"
              value={currentLineWidth}
              onChange={(e) => onLineWidthChange(parseInt(e.target.value))}
              className="width-slider"
            />
          </div>
        </div>
      </div>

      <div className="toolbar-section">
        <h3>
          <i className="fas fa-adjust"></i> Opacité
        </h3>
        <div className="opacity-section">
          <div className="opacity-presets">
            {[0.15, 0.25, 0.5, 0.75, 1].map((opacity) => (
              <button
                key={opacity}
                className={`opacity-button ${
                  Math.abs(currentOpacity - opacity) < 0.01 ? "active" : ""
                }`}
                onClick={() => onOpacityChange(opacity)}
                title={`${Math.round(opacity * 100)}%`}
              >
                <div
                  className="opacity-preview"
                  style={{
                    backgroundColor: currentColor,
                    opacity: opacity,
                  }}
                ></div>
              </button>
            ))}
          </div>

          <div className="custom-opacity">
            <label htmlFor="custom-opacity">
              <i className="fas fa-percentage"></i> Personnalisé:{" "}
              {Math.round(currentOpacity * 100)}%
            </label>
            <input
              id="custom-opacity"
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={currentOpacity}
              onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
              className="opacity-slider"
            />
          </div>
        </div>
      </div>

      <div className="toolbar-section">
        <h3>
          <i className="fas fa-cogs"></i> Actions
        </h3>

        <div className="action-buttons">
          <div className="save-canvas-dropdown" ref={saveMenuRef}>
            <button
              ref={saveButtonRef}
              className="action-button save-button"
              onClick={toggleSaveMenu}
              title="Enregistrer le canvas"
            >
              <i className="fas fa-download"></i>
              Enregistrer
              <i
                className={`fas fa-chevron-${
                  showSaveMenu ? "up" : "down"
                } chevron`}
              ></i>
            </button>

            {showSaveMenu && (
              <div className={`save-format-menu ${menuPosition}`}>
                <h4>Choisir le format</h4>
                <button
                  className="format-button"
                  onClick={() => handleSaveCanvas("png")}
                  title="Format PNG - Haute qualité avec transparence"
                >
                  <i className="fas fa-file-image"></i>
                  PNG
                  <span className="format-desc">Haute qualité</span>
                </button>
                <button
                  className="format-button"
                  onClick={() => handleSaveCanvas("jpeg")}
                  title="Format JPEG - Taille réduite"
                >
                  <i className="fas fa-file-image"></i>
                  JPEG
                  <span className="format-desc">Taille réduite</span>
                </button>
                <button
                  className="format-button"
                  onClick={() => handleSaveCanvas("webp")}
                  title="Format WebP - Moderne et optimisé"
                >
                  <i className="fas fa-file-image"></i>
                  WebP
                  <span className="format-desc">Moderne</span>
                </button>
              </div>
            )}
          </div>
          <button
            className={`action-button undo-button ${
              !canUndo ? "disabled" : ""
            }`}
            onClick={onUndo}
            disabled={!canUndo}
            title="Annuler (Ctrl+Z)"
          >
            <i className="fas fa-undo"></i>
            Annuler
          </button>

          <button
            className={`action-button redo-button ${
              !canRedo ? "disabled" : ""
            }`}
            onClick={onRedo}
            disabled={!canRedo}
            title="Rétablir (Ctrl+Y)"
          >
            <i className="fas fa-redo"></i>
            Rétablir
          </button>

          <button
            className="action-button clear-button"
            onClick={onClearCanvas}
            title="Effacer le canvas"
          >
            <i className="fas fa-trash-alt"></i>
            Effacer tout
          </button>
        </div>
      </div>
    </div>
  );
};

export default Toolbar;
