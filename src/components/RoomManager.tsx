import React, { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import socketService from "../services/socketService";
import "./RoomManager.scss";

interface RoomManagerProps {
  onJoinRoom: (roomId: string) => void;
  isConnected: boolean;
}

const RoomManager: React.FC<RoomManagerProps> = ({
  onJoinRoom,
  isConnected,
}) => {
  const [roomId, setRoomId] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState("");

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomId.trim()) return;

    setIsJoining(true);
    setError("");

    try {
      // Vérifier si la salle existe avant d'essayer de la rejoindre
      const roomExists = await socketService.checkRoomExists(roomId.trim());

      if (!roomExists) {
        setError(
          `La salle "${roomId.trim()}" n'existe pas. Vérifiez l'ID ou créez une nouvelle salle.`
        );
        return;
      }

      await onJoinRoom(roomId.trim());
    } catch (error) {
      console.error("Erreur lors de la jointure:", error);
      setError("Erreur lors de la connexion à la salle.");
    } finally {
      setIsJoining(false);
    }
  };

  const handleCreateRoom = async () => {
    setIsJoining(true);
    setError("");

    try {
      const newRoomId = uuidv4().split("-")[0];

      // Créer la salle sur le serveur d'abord
      const result = await socketService.createRoom(newRoomId);

      if (!result.success) {
        setError(result.error || "Erreur lors de la création de la salle");
        return;
      }

      setRoomId(newRoomId);
      await onJoinRoom(newRoomId);
    } catch (error) {
      console.error("Erreur lors de la création:", error);
      setError("Erreur lors de la création de la salle.");
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="room-manager">
      <div className="room-manager-content">
        <h1>Share Paint</h1>
        <p>Dessinez ensemble en temps réel !</p>

        <div className="connection-status">
          <div
            className={`status-indicator ${
              isConnected ? "connected" : "disconnected"
            }`}
          />
          <span>
            {isConnected ? "Connecté au serveur" : "Déconnecté du serveur"}
          </span>
        </div>

        {error && (
          <div className="error-message">
            <i className="fas fa-exclamation-triangle"></i>
            <span>{error}</span>
          </div>
        )}

        <div className="room-actions">
          <div className="create-room">
            <h3>Créer une nouvelle salle</h3>
            <button
              onClick={handleCreateRoom}
              disabled={!isConnected || isJoining}
              className="create-button"
            >
              Créer une salle
            </button>
          </div>

          <div className="join-room">
            <h3>Rejoindre une salle existante</h3>
            <form onSubmit={handleJoinRoom}>
              <div className="input-group">
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  placeholder="ID de la salle"
                  disabled={!isConnected || isJoining}
                  maxLength={50}
                />
                <button
                  type="submit"
                  disabled={!isConnected || !roomId.trim() || isJoining}
                  className="join-button"
                >
                  {isJoining ? "Connexion..." : "Rejoindre"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoomManager;
