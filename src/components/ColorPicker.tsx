import React, { useState, useRef, useEffect } from "react";
import "./ColorPicker.scss";

interface ColorPickerProps {
  currentColor: string;
  onColorChange: (color: string) => void;
}

const ColorPicker: React.FC<ColorPickerProps> = ({
  currentColor,
  onColorChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hue, setHue] = useState(0);
  const [saturation, setSaturation] = useState(50);
  const [lightness, setLightness] = useState(50);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Convertir hex en HSL
  const hexToHsl = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s;
    const l = (max + min) / 2;

    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
        default:
          h = 0;
      }
      h /= 6;
    }

    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100),
    };
  };

  // Convertir HSL en hex
  const hslToHex = (h: number, s: number, l: number) => {
    h /= 360;
    s /= 100;
    l /= 100;

    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h * 12) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color)
        .toString(16)
        .padStart(2, "0");
    };

    return `#${f(0)}${f(8)}${f(4)}`;
  };

  // Mettre à jour les valeurs HSL quand la couleur change
  useEffect(() => {
    const hsl = hexToHsl(currentColor);
    setHue(hsl.h);
    setSaturation(hsl.s);
    setLightness(hsl.l);
  }, [currentColor]);

  // Fermer le picker en cliquant à l'extérieur
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleHueChange = (newHue: number) => {
    setHue(newHue);
    const newColor = hslToHex(newHue, saturation, lightness);
    onColorChange(newColor);
  };

  const handleSaturationChange = (newSaturation: number) => {
    setSaturation(newSaturation);
    const newColor = hslToHex(hue, newSaturation, lightness);
    onColorChange(newColor);
  };

  const handleLightnessChange = (newLightness: number) => {
    setLightness(newLightness);
    const newColor = hslToHex(hue, saturation, newLightness);
    onColorChange(newColor);
  };

  return (
    <div className="modern-color-picker" ref={pickerRef}>
      <button
        className="color-picker-trigger"
        onClick={() => setIsOpen(!isOpen)}
        title="Choisir une couleur"
      >
        <div
          className="color-preview"
          style={{ backgroundColor: currentColor }}
        ></div>
        <span></span>
        <i className={`fas fa-chevron-${isOpen ? "up" : "down"}`}></i>
      </button>

      {isOpen && (
        <div className="color-picker-dropdown">
          <div className="color-sliders">
            <h4>Couleur personnalisée</h4>

            <div className="slider-group">
              <label>Teinte: {hue}°</label>
              <input
                type="range"
                min="0"
                max="360"
                value={hue}
                onChange={(e) => handleHueChange(parseInt(e.target.value))}
                className="hue-slider"
              />
            </div>

            <div className="slider-group">
              <label>Saturation: {saturation}%</label>
              <input
                type="range"
                min="0"
                max="100"
                value={saturation}
                onChange={(e) =>
                  handleSaturationChange(parseInt(e.target.value))
                }
                className="saturation-slider"
                style={{
                  background: `linear-gradient(to right, 
                    hsl(${hue}, 0%, ${lightness}%), 
                    hsl(${hue}, 100%, ${lightness}%))`,
                }}
              />
            </div>

            <div className="slider-group">
              <label>Luminosité: {lightness}%</label>
              <input
                type="range"
                min="0"
                max="100"
                value={lightness}
                onChange={(e) =>
                  handleLightnessChange(parseInt(e.target.value))
                }
                className="lightness-slider"
                style={{
                  background: `linear-gradient(to right, 
                    hsl(${hue}, ${saturation}%, 0%), 
                    hsl(${hue}, ${saturation}%, 50%), 
                    hsl(${hue}, ${saturation}%, 100%))`,
                }}
              />
            </div>

            <div className="color-preview-large">
              <div
                className="preview-swatch"
                style={{ backgroundColor: currentColor }}
              ></div>
              <span className="color-value">{currentColor.toUpperCase()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ColorPicker;
