const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const sessions = new Map();
const port = Number(process.env.PORT) || 5173;

app.get('/', (_request, response) => response.sendFile(path.join(__dirname, 'index.html')));
app.use('/src', express.static(path.join(__dirname, 'src')));

function roomName(sessionId) {
  return `session:${sessionId}`;
}

function createSessionId() {
  return crypto.randomBytes(5).toString('hex');
}

function peopleFor(sessionId) {
  const session = sessions.get(sessionId);
  return session ? [...session.people.values()] : [];
}

function publishPeople(sessionId) {
  io.to(roomName(sessionId)).emit('people:update', peopleFor(sessionId));
}

function leaveSession(socket) {
  const sessionId = socket.data.sessionId;
  if (!sessionId) return;
  const session = sessions.get(sessionId);
  if (session) {
    session.people.delete(socket.id);
    publishPeople(sessionId);
    if (session.people.size === 0) sessions.delete(sessionId);
  }
  socket.leave(roomName(sessionId));
  socket.data.sessionId = undefined;
}

io.on('connection', socket => {
  socket.on('session:create', (name, callback) => {
    leaveSession(socket);
    const sessionId = createSessionId();
    const session = { people: new Map() };
    sessions.set(sessionId, session);
    socket.join(roomName(sessionId));
    socket.data.sessionId = sessionId;
    session.people.set(socket.id, { id: socket.id, name: String(name || 'Du').slice(0, 40), lat: null, lng: null, accuracy: null, lastUpdate: null });
    callback?.({ ok: true, sessionId, selfId: socket.id, people: peopleFor(sessionId) });
    publishPeople(sessionId);
  });

  socket.on('session:join', ({ sessionId, name }, callback) => {
    const session = sessions.get(sessionId);
    if (!session) return callback?.({ ok: false, error: 'Diese Einladung ist nicht mehr aktiv.' });
    leaveSession(socket);
    socket.join(roomName(sessionId));
    socket.data.sessionId = sessionId;
    session.people.set(socket.id, { id: socket.id, name: String(name || 'Gast').slice(0, 40), lat: null, lng: null, accuracy: null, lastUpdate: null });
    callback?.({ ok: true, sessionId, selfId: socket.id, people: peopleFor(sessionId) });
    publishPeople(sessionId);
  });

  socket.on('location:update', position => {
    const session = sessions.get(socket.data.sessionId);
    if (!session || !position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return;
    const person = session.people.get(socket.id);
    if (!person) return;
    person.lat = position.lat;
    person.lng = position.lng;
    person.accuracy = Number.isFinite(position.accuracy) ? position.accuracy : null;
    person.lastUpdate = Date.now();
    io.to(roomName(socket.data.sessionId)).emit('person:location', person);
  });

  socket.on('disconnect', () => leaveSession(socket));
});

function listen(nextPort) {
  server.once('error', error => {
    if (error.code === 'EADDRINUSE' && nextPort < port + 20) return listen(nextPort + 1);
    console.error(`Server konnte nicht gestartet werden: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(nextPort, '0.0.0.0', () => console.log(`Näher läuft auf http://localhost:${nextPort}`));
}

listen(port);
