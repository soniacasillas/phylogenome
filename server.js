import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomBytes } from 'node:crypto';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const rooms = new Map();
app.use(express.static('public'));
app.get('/health', (_, res) => res.json({ ok: true, rooms: rooms.size }));

const code = () => randomBytes(3).toString('hex').toUpperCase();
const publicRoom = room => ({ code: room.code, edition: room.edition, players: Object.values(room.players).map(({ deck, ...p }) => p), started: room.started });
function view(room, viewerId) {
  const game = room.game && structuredClone(room.game);
  if (game) for (const [id, state] of Object.entries(game.players)) if (id !== viewerId) {
    state.hand = state.hand.map(({ id, ...card }) => ({ id, title: 'Opponent card', hidden: true }));
    state.deck = { hidden: true, count: state.deck.length };
  }
  return { ...publicRoom(room), game };
}
function emit(room) { for (const id of Object.keys(room.players)) io.to(id).emit('room:update', view(room, id)); }

io.on('connection', socket => {
  socket.on('room:create', ({ edition, name }, done) => {
    const roomCode = code();
    const player = { id: socket.id, name: name?.trim().slice(0, 24) || 'Player 1', ready: false };
    const room = { code: roomCode, edition, players: { [socket.id]: player }, game: null, started: false };
    rooms.set(roomCode, room); socket.join(roomCode); done({ ok: true, room: view(room, socket.id), playerId: socket.id });
  });
  socket.on('room:join', ({ code: roomCode, name }, done) => {
    const room = rooms.get(roomCode?.toUpperCase());
    if (!room) return done({ ok: false, error: 'Room not found.' });
    if (Object.keys(room.players).length >= 2) return done({ ok: false, error: 'This room already has two players.' });
    room.players[socket.id] = { id: socket.id, name: name?.trim().slice(0, 24) || 'Player 2', ready: false };
    socket.join(room.code); done({ ok: true, room: view(room, socket.id), playerId: socket.id }); emit(room);
  });
  socket.on('deck:ready', ({ code: roomCode, deck }, done) => {
    const room = rooms.get(roomCode); if (!room?.players[socket.id]) return;
    room.players[socket.id].deck = deck; room.players[socket.id].ready = true;
    if (Object.keys(room.players).length === 2 && Object.values(room.players).every(p => p.ready)) {
      room.started = true;
      room.game = initialGame(room);
    }
    emit(room); done?.({ ok: true });
  });
  socket.on('game:update', ({ code: roomCode, game }, done) => {
    const room = rooms.get(roomCode); if (!room?.players[socket.id] || !room.started) return;
    // The client only submits its own zones. The server preserves the opponent's private hand/deck.
    const mine = game.players?.[socket.id]; if (!mine) return;
    room.game.players[socket.id] = mine; room.game.turn = game.turn; room.game.log = (game.log || []).slice(-30);
    emit(room); done?.({ ok: true });
  });
  socket.on('disconnect', () => {
    for (const room of rooms.values()) if (room.players[socket.id]) { room.players[socket.id].connected = false; emit(room); }
  });
});
function shuffle(a) { return [...a].sort(() => Math.random() - .5); }
function initialGame(room) {
  const players = {};
  for (const p of Object.values(room.players)) {
    const progress = p.deck.filter(c => c.kind === 'progress');
    const other = shuffle(p.deck.filter(c => c.kind !== 'progress'));
    const starting = progress.shift();
    players[p.id] = { hand: other.splice(0, 5), deck: other, discard: [], progress, grid: starting ? { 210: [starting] } : {}, selected: null };
  }
  return { players, turn: Object.keys(players)[0], log: ['Game started.'] };
}
const port = process.env.PORT || 3000;
httpServer.listen(port, () => console.log(`PhyloGenome online at http://localhost:${port}`));

