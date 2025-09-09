import { useState, useEffect } from "react";

type Theme = "light" | "dark";

const useTheme = () => {
  const [theme, setTheme] = useState<Theme>(() => {
    // Récupérer le thème sauvegardé ou utiliser le thème système
    const savedTheme = localStorage.getItem("share-paint-theme") as Theme;
    if (savedTheme) {
      return savedTheme;
    }

    // Détecter le thème système
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    return prefersDark ? "dark" : "light";
  });

  useEffect(() => {
    // Appliquer le thème au document
    document.documentElement.setAttribute("data-theme", theme);

    // Sauvegarder dans localStorage
    localStorage.setItem("share-paint-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  return { theme, toggleTheme };
};

export default useTheme;
