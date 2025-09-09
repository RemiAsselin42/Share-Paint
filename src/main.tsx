import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fortawesome/fontawesome-free/css/all.min.css";

// Import des deux versions pour test
import App from "./App.tsx";

// Pour tester le nouveau système bitmap, changez la ligne suivante :
// const CurrentApp = BitmapApp; // Nouveau système bitmap
const CurrentApp = App; // Système vectoriel actuel

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CurrentApp />
  </StrictMode>
);
