import Canvas from "./components/Canvas";
import Toolbar from "./components/Toolbar";
import RoomManager from "./components/RoomManager";
import Toast from "./components/Toast";
import useCanvas from "./hooks/useCanvas";
import useTheme from "./hooks/useTheme";
import socketService from "./services/socketService";
import { useEffect, useState } from "react";
import "./App.scss";
import "./styles/themes.scss";

function App() {
  // Hook pour la gestion du thème
  const { theme, toggleTheme } = useTheme();

  // State pour les toasts
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info";
    isVisible: boolean;
  }>({
    message: "",
    type: "success",
    isVisible: false,
  });

  const showToast = (
    message: string,
    type: "success" | "error" | "info" = "success"
  ) => {
    setToast({ message, type, isVisible: true });
  };

  const hideToast = () => {
    setToast((prev) => ({ ...prev, isVisible: false }));
  };

  const {
    drawings,
    users,
    currentTool,
    currentColor,
    currentLineWidth,
    currentOpacity,
    currentHardness,
    isDrawing,
    roomId,
    userId,
    isConnected,
    userHistory,
    userHistoryIndex,
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
    setHardness,
    clearCanvas,
    saveCanvas,
    undo,
    redo,
  } = useCanvas();

  // Connexion automatique au chargement de l'application
  useEffect(() => {
    const connectToServer = async () => {
      try {
        if (!socketService.isConnected()) {
          await socketService.connect();
        }
      } catch (error) {
        console.error("Erreur lors de la connexion automatique:", error);
      }
    };

    connectToServer();
  }, []);

  const handleJoinRoom = async (newRoomId: string) => {
    try {
      if (!isConnected) {
        await socketService.connect();
      }
      await joinRoom(newRoomId);
    } catch (error) {
      console.error("Erreur lors de la connexion:", error);
      alert(
        "Impossible de se connecter au serveur. Vérifiez que le serveur est démarré."
      );
    }
  };

  const handleLeaveRoom = () => {
    leaveRoom();
  };

  // Fonction pour copier avec fallback pour Firefox
  const copyToClipboard = async (text: string) => {
    try {
      // Essayer l'API moderne (Chrome, Edge, Safari)
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        showToast("ID de la salle copié !", "success");
        return;
      }
    } catch (error) {
      console.warn("Clipboard API failed, using fallback:", error);
    }

    // Fallback pour Firefox et navigateurs anciens
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);

      if (successful) {
        showToast("ID de la salle copié !", "success");
      } else {
        throw new Error("execCommand failed");
      }
    } catch (fallbackError) {
      console.error("All copy methods failed:", fallbackError);
      showToast(`Impossible de copier automatiquement. ID: ${text}`, "error");
    }
  };

  // Si pas dans une salle, afficher le gestionnaire de salle
  if (!roomId) {
    return (
      <RoomManager onJoinRoom={handleJoinRoom} isConnected={isConnected} />
    );
  }

  // Afficher l'interface de dessin
  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <div className="logo">
            <h1>Share Paint</h1>
          </div>
        </div>

        <div className="header-center">
          <div className="room-info">
            <span className="room-id">
              <i className="fas fa-door-open"></i>
              <strong>{roomId}</strong>
              <button
                className="copy-room-id"
                onClick={() => copyToClipboard(roomId)}
                title="Copier l'ID de la salle"
              >
                <i className="fas fa-copy"></i>
              </button>
            </span>

            <div className="users-info">
              <div className="users-count">
                <i className="fas fa-users"></i>
              </div>
              <div className="users-list">
                {Array.from(users.values()).map((user) => (
                  <span
                    key={user.id}
                    className={`user-indicator ${
                      user.id === userId ? "current-user" : ""
                    }`}
                    style={{ backgroundColor: user.color }}
                    title={
                      user.id === userId
                        ? "Vous"
                        : `Utilisateur ${user.id.slice(0, 8)}`
                    }
                  />
                ))}
              </div>
            </div>

            {/* <div className="connection-status">
              <div
                className={`status-indicator ${
                  isConnected ? "connected" : "disconnected"
                }`}
              />
              <span className="status-text">
                {isConnected ? "Connecté" : "Déconnecté"}
              </span>
            </div> */}

            <button
              className="theme-toggle"
              title={`Basculer vers le thème ${
                theme === "light" ? "sombre" : "clair"
              }`}
              onClick={toggleTheme}
            >
              <i
                className={`fas ${theme === "light" ? "fa-moon" : "fa-sun"}`}
              ></i>
            </button>
          </div>
        </div>

        <div className="header-right">
          <button onClick={handleLeaveRoom} className="leave-button">
            <i className="fas fa-sign-out-alt"></i>
            Quitter
          </button>
        </div>
      </header>

      <div className="app-content">
        <Toolbar
          currentTool={currentTool}
          currentColor={currentColor}
          currentLineWidth={currentLineWidth}
          currentOpacity={currentOpacity}
          currentHardness={currentHardness}
          onToolChange={setTool}
          onColorChange={setColor}
          onLineWidthChange={setLineWidth}
          onOpacityChange={setOpacity}
          onHardnessChange={setHardness}
          onClearCanvas={clearCanvas}
          onSaveCanvas={saveCanvas}
          onUndo={undo}
          onRedo={redo}
          canUndo={userHistoryIndex >= 0}
          canRedo={userHistoryIndex < userHistory.length - 1}
        />

        <Canvas
          drawings={drawings}
          users={users}
          currentTool={currentTool}
          currentColor={currentColor}
          currentLineWidth={currentLineWidth}
          currentOpacity={currentOpacity}
          currentHardness={currentHardness}
          isDrawing={isDrawing}
          onStartDrawing={startDrawing}
          onDraw={draw}
          onEndDrawing={endDrawing}
          onMouseMove={handleMouseMove}
          onColorChange={setColor}
          userId={userId}
        />
      </div>

      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.isVisible}
        onClose={hideToast}
      />
    </div>
  );
}

export default App;
