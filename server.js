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
// This server-side proxy avoids browser CORS restrictions and preserves every
// WordPress taxonomy (including sequencing_generation and conservation-status).
app.get('/api/cards', async (_, res) => {
  const base = 'https://phylogenome.omicsuab.org/wp-json/wp/v2/posts?per_page=100&_embed=1';
  try {
    const first = await fetch(`${base}&page=1`);
    if (!first.ok) throw new Error(`WordPress returned ${first.status}`);
    const pages = Number(first.headers.get('x-wp-totalpages') || 1);
    const batches = [await first.json()];
    for (let page = 2; page <= pages; page++) {
      const response = await fetch(`${base}&page=${page}`);
      if (!response.ok) throw new Error(`WordPress returned ${response.status}`);
      batches.push(await response.json());
    }
    const cards = batches.flat().map(post => {
      const terms = Object.fromEntries((post._embedded?.['wp:term'] || []).flat().map(term => [
        `${term.taxonomy}:${term.name}`, { taxonomy: term.taxonomy, name: term.name }
      ]));
      return {
        id: `wp-${post.id}`,
        title: post.title?.rendered?.replace(/<[^>]*>/g, '') || 'Untitled card',
        image: post._embedded?.['wp:featuredmedia']?.[0]?.source_url || post.jetpack_featured_media_url || '',
        categories: Object.values(terms).filter(t => t.taxonomy === 'category').map(t => t.name).join(' '),
        terms: Object.values(terms).map(t => `${t.taxonomy}:${t.name}`).join(' | ')
      };
    });
    res.json({ cards, total: cards.length });
  } catch (error) {
    res.status(502).json({ error: 'Could not load cards from PhyloGenome WordPress.', detail: error.message });
  }
});

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
    room.game.players[socket.id] = mine;
    // A card effect may discard or otherwise affect an opponent's public zones.
    // Preserve private hands and decks while accepting those public-zone changes.
    for (const [id, incoming] of Object.entries(game.players || {})) if (id !== socket.id && room.game.players[id]) {
      room.game.players[id].discard = incoming.discard || room.game.players[id].discard;
      room.game.players[id].inPlay = incoming.inPlay || room.game.players[id].inPlay;
      room.game.players[id].progress = incoming.progress || room.game.players[id].progress;
      room.game.players[id].grid = incoming.grid || room.game.players[id].grid;
    }
    room.game.turn = game.turn;
    room.game.step = Number.isInteger(game.step) ? game.step : room.game.step;
    room.game.log = (game.log || []).slice(-30);
    emit(room); done?.({ ok: true });
  });
  socket.on('disconnect', () => {
    for (const room of rooms.values()) if (room.players[socket.id]) { room.players[socket.id].connected = false; emit(room); }
  });
});
function shuffle(a) { return [...a].sort(() => Math.random() - .5); }
function initialGame(room) {
  const players = {};
  const ids = Object.keys(room.players);
  for (const [position, id] of ids.entries()) {
    const p = room.players[id];
    const isProgress = c => (c.categories || '').toLowerCase().includes('progress cards');
    const progress = p.deck.filter(isProgress);
    const other = shuffle(p.deck.filter(c => !isProgress(c)));
    const isStartingProgress = c => /sequencing_generation:(?:[^|]*\b1\b)|conservation-status:(?:[^|]*(?:\bCR\b|Critically Endangered))/i.test(c.terms || '');
    const startIndex = progress.findIndex(isStartingProgress);
    const starting = startIndex >= 0 ? progress.splice(startIndex, 1)[0] : progress.shift();
    // Row 10, columns 9 and 10 in the 20 x 20 board (zero-indexed 188, 189).
    const progressCell = position === 0 ? 188 : 189;
    players[p.id] = { hand: other.splice(0, 5), deck: other, discard: [], progress, inPlay: [], grid: starting ? { [progressCell]: [starting] } : {}, selected: null };
  }
  return { players, turn: Object.keys(players)[0], step: 0, log: ['Game started.'] };
}
const port = process.env.PORT || 3000;
httpServer.listen(port, () => console.log(`PhyloGenome online at http://localhost:${port}`));

