const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const os = require('os');

const app = express();
const server = http.createServer(app);

// Fonction pour obtenir toutes les adresses IP locales
function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = ['localhost', '127.0.0.1'];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push(iface.address);
            }
        }
    }
    return ips;
}

// Configuration CORS souple pour Socket.IO
const io = socketIo(server, {
    cors: {
        origin: (origin, callback) => {
            // Autoriser toutes les requêtes en développement
            // En production, vous pourrez restreindre davantage
            callback(null, true);
        },
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

// Configuration CORS souple pour Express
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());

// Stockage des salles et utilisateurs en mémoire
const rooms = new Map();
const userRooms = new Map(); // userId -> roomId

// Route de base pour vérifier que le serveur fonctionne
app.get('/', (req, res) => {
    res.json({
        message: 'Share Paint Server is running!',
        rooms: rooms.size,
        connectedUsers: io.engine.clientsCount
    });
});

// Route pour obtenir des informations sur une salle
app.get('/room/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = rooms.get(roomId);

    if (room) {
        res.json({
            roomId,
            userCount: room.users.size,
            drawingCount: room.drawings.length
        });
    } else {
        res.status(404).json({ error: 'Room not found' });
    }
});

// Nouveau endpoint pour vérifier l'existence d'une salle
app.get('/api/room/:roomId/exists', (req, res) => {
    const { roomId } = req.params;
    const roomExists = rooms.has(roomId);

    res.json({ exists: roomExists });
});

// Nouveau endpoint pour créer une salle
app.post('/api/room/create', (req, res) => {
    const roomId = req.body.roomId;

    if (!roomId) {
        return res.status(400).json({ error: 'Room ID is required' });
    }

    if (rooms.has(roomId)) {
        return res.status(409).json({ error: 'Room already exists' });
    }

    // Créer la nouvelle salle
    rooms.set(roomId, {
        id: roomId,
        users: new Map(),
        drawings: [],
        createdAt: new Date()
    });

    res.json({
        success: true,
        roomId: roomId,
        message: 'Room created successfully'
    });
});

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Rejoindre une salle
    socket.on('join-room', (roomId, user) => {
        try {
            console.log(`User ${user.id} trying to join room ${roomId}`);

            // Quitter la salle précédente si elle existe
            const previousRoom = userRooms.get(user.id);
            if (previousRoom) {
                leaveRoom(socket, previousRoom, user.id);
            }

            // Vérifier si la salle existe
            if (!rooms.has(roomId)) {
                console.log(`Room ${roomId} does not exist`);
                socket.emit('room-error', `La salle "${roomId}" n'existe pas. Créez une nouvelle salle ou vérifiez l'ID.`);
                return;
            }

            console.log(`User ${user.id} joining existing room ${roomId}`);
            const room = rooms.get(roomId);

            // Ajouter l'utilisateur à la salle
            room.users.set(user.id, {
                ...user,
                socketId: socket.id
            });

            userRooms.set(user.id, roomId);
            socket.join(roomId);

            // Envoyer les utilisateurs existants au nouvel utilisateur
            const users = Array.from(room.users.values());
            socket.emit('room-joined', roomId, users);

            // Envoyer tous les dessins existants au nouvel utilisateur
            room.drawings.forEach(drawing => {
                socket.emit('drawing-data', drawing);
            });

            // Notifier les autres utilisateurs
            socket.to(roomId).emit('user-joined', user);

            console.log(`User ${user.id} joined room ${roomId}. Total users: ${room.users.size}`);
        } catch (error) {
            console.error('Error joining room:', error);
            socket.emit('room-error', 'Failed to join room');
        }
    });

    // Quitter une salle
    socket.on('leave-room', (roomId, userId) => {
        leaveRoom(socket, roomId, userId);
    });

    // Recevoir des données de dessin avec optimisation avancée
    socket.on('drawing-data', (data) => {
        try {
            const roomId = data.roomId;
            const room = rooms.get(roomId);

            if (room) {
                // Optimisation: déduplication et compression des points
                const existingIndex = room.drawings.findIndex(d => d.id === data.id);

                if (existingIndex !== -1) {
                    // Mise à jour d'un dessin existant
                    const existingDrawing = room.drawings[existingIndex];

                    // Optimisation: n'ajouter que les nouveaux points
                    if (data.points.length > existingDrawing.points.length) {
                        room.drawings[existingIndex] = data;

                        // Envoyer seulement les nouveaux points pour optimiser la bande passante
                        const newPoints = data.points.slice(existingDrawing.points.length);
                        const incrementalUpdate = {
                            ...data,
                            points: newPoints,
                            isIncremental: true,
                            basePointCount: existingDrawing.points.length
                        };

                        socket.to(roomId).emit('drawing-data', incrementalUpdate);
                    }
                } else {
                    // Nouveau dessin
                    room.drawings.push(data);
                    socket.to(roomId).emit('drawing-data', data);
                }

                // Nettoyage périodique des dessins obsolètes (plus de 30 minutes)
                const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
                room.drawings = room.drawings.filter(d => d.timestamp > thirtyMinutesAgo);
            }
        } catch (error) {
            console.error('Error handling drawing data:', error);
        }
    });

    // Curseur utilisateur
    socket.on('user-cursor', (roomId, userId, cursor) => {
        try {
            const room = rooms.get(roomId);
            if (room && room.users.has(userId)) {
                // Mettre à jour la position du curseur
                const user = room.users.get(userId);
                user.cursor = cursor;
                room.users.set(userId, user);

                // Diffuser à tous les autres utilisateurs
                socket.to(roomId).emit('user-cursor', userId, cursor);
            }
        } catch (error) {
            console.error('Error handling cursor position:', error);
        }
    });

    // Effacer le canvas
    socket.on('clear-canvas', (roomId) => {
        try {
            const room = rooms.get(roomId);
            if (room) {
                room.drawings = [];
                io.to(roomId).emit('canvas-clear');
                console.log(`Canvas cleared in room ${roomId}`);
            }
        } catch (error) {
            console.error('Error clearing canvas:', error);
        }
    });

    // Undo canvas
    socket.on('undo-canvas', (roomId, userId, drawingId) => {
        try {
            const room = rooms.get(roomId);
            if (room && room.users.has(userId)) {
                // Diffuser l'événement undo à tous les utilisateurs de la salle
                io.to(roomId).emit('canvas-undo', userId, drawingId);
                console.log(`Canvas undo by user ${userId} for drawing ${drawingId} in room ${roomId}`);
            }
        } catch (error) {
            console.error('Error handling canvas undo:', error);
        }
    });

    // Redo canvas
    socket.on('redo-canvas', (roomId, userId, drawingId) => {
        try {
            const room = rooms.get(roomId);
            if (room && room.users.has(userId)) {
                // Diffuser l'événement redo à tous les utilisateurs de la salle
                io.to(roomId).emit('canvas-redo', userId, drawingId);
                console.log(`Canvas redo by user ${userId} for drawing ${drawingId} in room ${roomId}`);
            }
        } catch (error) {
            console.error('Error handling canvas redo:', error);
        }
    });

    // Déconnexion
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);

        // Trouver l'utilisateur et la salle
        let userToRemove = null;
        let roomToLeave = null;

        for (const [roomId, room] of rooms.entries()) {
            for (const [userId, user] of room.users.entries()) {
                if (user.socketId === socket.id) {
                    userToRemove = userId;
                    roomToLeave = roomId;
                    break;
                }
            }
            if (userToRemove) break;
        }

        if (userToRemove && roomToLeave) {
            leaveRoom(socket, roomToLeave, userToRemove);
        }
    });

    // Fonction utilitaire pour quitter une salle
    function leaveRoom(socket, roomId, userId) {
        try {
            const room = rooms.get(roomId);
            if (room && room.users.has(userId)) {
                room.users.delete(userId);
                userRooms.delete(userId);
                socket.leave(roomId);

                // Notifier les autres utilisateurs
                socket.to(roomId).emit('user-left', userId);

                // Supprimer la salle si elle est vide
                if (room.users.size === 0) {
                    rooms.delete(roomId);
                    console.log(`Room ${roomId} deleted (empty)`);
                }

                console.log(`User ${userId} left room ${roomId}. Remaining users: ${room.users.size}`);
            }
        } catch (error) {
            console.error('Error leaving room:', error);
        }
    }
});

// Nettoyage périodique des salles vides (toutes les 5 minutes)
setInterval(() => {
    const now = new Date();
    for (const [roomId, room] of rooms.entries()) {
        // Supprimer les salles vides qui existent depuis plus d'une heure
        if (room.users.size === 0 && (now - room.createdAt) > 60 * 60 * 1000) {
            rooms.delete(roomId);
            console.log(`Cleaned up empty room ${roomId}`);
        }
    }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    const localIPs = getLocalIPs();
    console.log(`Share Paint server running on port ${PORT}`);
    console.log('Available URLs:');
    localIPs.forEach(ip => {
        console.log(`  - http://${ip}:${PORT}`);
    });
    console.log('CORS: Allowing all origins in development mode');
});

// Gestion gracieuse de l'arrêt
process.on('SIGTERM', () => {
    console.log('Server shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
    });
});

process.on('SIGINT', () => {
    console.log('Server shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
    });
});
