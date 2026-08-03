import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomBytes } from 'node:crypto';

const app = express(), httpServer = createServer(app), io = new Server(httpServer);
const rooms = new Map();
let cardCatalogueCache = null;
app.use(express.static('public'));
app.use('/assets', express.static('assets'));
app.get('/health', (_, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('/api/cards', async (_, res) => {
  if (cardCatalogueCache && cardCatalogueCache.expires > Date.now()) return res.json(cardCatalogueCache.data);
  const base = 'https://phylogenome.omicsuab.org/wp-json/wp/v2/posts?per_page=100&_embed=1';
  try {
    const first = await fetch(`${base}&page=1`); if (!first.ok) throw new Error(`WordPress returned ${first.status}`);
    const pages = Number(first.headers.get('x-wp-totalpages') || 1), batches = [await first.json()];
    for (let page = 2; page <= pages; page++) { const r = await fetch(`${base}&page=${page}`); if (!r.ok) throw new Error(`WordPress returned ${r.status}`); batches.push(await r.json()); }
    const data={ cards: batches.flat().map(post => {
      const terms = Object.values(Object.fromEntries((post._embedded?.['wp:term'] || []).flat().map(t => [`${t.taxonomy}:${t.name}`, t])));
      const media=post._embedded?.['wp:featuredmedia']?.[0], sizes=media?.media_details?.sizes || {};
      const image=sizes.large?.source_url || sizes.medium_large?.source_url || media?.source_url || post.jetpack_featured_media_url || '';
      return { id:`wp-${post.id}`, title:post.title?.rendered?.replace(/<[^>]*>/g,'') || 'Untitled card', image, categories:terms.filter(t=>t.taxonomy==='category').map(t=>t.name).join(' '), terms:terms.map(t=>`${t.taxonomy}:${t.name}`).join(' | ') };
    }), total:batches.flat().length };
    cardCatalogueCache={data,expires:Date.now()+5*60*1000}; res.json(data);
  } catch (error) { res.status(502).json({ error:'Could not load cards from PhyloGenome WordPress.', detail:error.message }); }
});

const roomCode = () => randomBytes(3).toString('hex').toUpperCase();
const shuffle = list => [...list].sort(() => Math.random() - .5);
const ids = room => Object.keys(room.players);
const rank = (edition, card) => {
  const text = card?.terms || '';
  if (edition === 'genome') return Number(text.match(/sequencing_generation:([^|]+)/i)?.[1]?.match(/[123]/)?.[0] || 0);
  return ({CR:1,EN:2,VU:3,LC:4}[text.match(/conservation-status:([^|]+)/i)?.[1]?.match(/CR|EN|VU|LC/i)?.[0]?.toUpperCase()] || 0);
};
const publicRoom = room => ({ code:room.code, edition:room.edition, mode:room.mode, maxPlayers:room.maxPlayers, players:Object.values(room.players).map(({deck,...p})=>p), started:room.started });
function view(room, viewer) {
  const game = room.game && structuredClone(room.game);
  if (!game) return { ...publicRoom(room), game };
  if (room.mode === 'nature') {
    for (const [id, p] of Object.entries(game.players)) {
      p.deck = id === viewer ? p.deck : { hidden:true, count:p.deck.length };
      if (p.revealed && id !== viewer && !game.revealAll) p.revealed = { id:p.revealed.id, hidden:true, progress:rank(room.edition,p.revealed) };
    }
  } else if (room.mode === 'timeline') {
    for (const [id,p] of Object.entries(game.players)) p.deck = id === viewer ? p.deck : { hidden:true, count:p.deck.length };
    if (game.peek && game.peek.owner !== viewer) game.peek.card = { hidden:true, title:'Opponent card' };
  } else {
    for (const [id,p] of Object.entries(game.players)) if (id !== viewer) { p.hand=p.hand.map(({id,...c})=>({id,title:'Opponent card',hidden:true})); p.deck={hidden:true,count:p.deck.length}; }
  }
  return { ...publicRoom(room), game };
}
function emit(room) { for (const id of ids(room)) io.to(id).emit('room:update', view(room,id)); }
function initialGame(room) {
  const players = {};
  if (room.mode === 'nature') {
    for (const id of ids(room)) players[id] = { deck:shuffle(room.players[id].deck), revealed:null };
    return { players, turn:ids(room)[0], phase:'draw', category:null, categoryRank:0, revealAll:false, history:[] };
  }
  if (room.mode === 'timeline') {
    for (const id of ids(room)) players[id] = { deck:shuffle(room.players[id].deck) };
    return { players, turn:ids(room)[0], category:null, timeline:[], peek:null, pending:null, phase:'choose-category', history:[] };
  }
  for (const [position,id] of ids(room).entries()) {
    const deck=room.players[id].deck, progress=deck.filter(c=>(c.categories||'').toLowerCase().includes('progress cards'));
    const other=shuffle(deck.filter(c=>!(c.categories||'').toLowerCase().includes('progress cards')));
    const start=progress.splice(progress.findIndex(c=>rank(room.edition,c)===1),1)[0] || progress.shift();
    players[id]={hand:other.splice(0,5),deck:other,discard:[],progress,inPlay:[],grid:start?{[position===0?188:189]:[start]}:{},selected:null};
  }
  return { players, turn:ids(room)[0], step:0, log:['Game started.'], history:[] };
}
function nextPlayer(room, id) { const list=ids(room), at=list.indexOf(id); return list[(at+1)%list.length]; }
function resetTimeline(room) {
  const game=room.game;
  for (const entry of game.timeline) game.players[entry.owner].deck.unshift(entry.card);
  if (game.pending) game.players[game.pending.owner].deck.unshift(game.pending.card);
  if (game.peek) game.players[game.peek.owner].deck.unshift(game.peek.card);
  game.timeline=[]; game.pending=null; game.peek=null; game.turn=ids(room)[0]; game.phase='draw';
}
function modeAction(room, actor, action, done) {
  const game=room.game, p=game.players[actor], fail=error=>done?.({ok:false,error});
  if (!p) return fail('You are not in this room.');
  if (room.mode==='nature') {
    if (action.type==='draw-round') {
      if (actor!==game.turn || game.phase!=='draw') return fail('Wait for the next round.');
      if (ids(room).some(id=>!game.players[id].deck.length)) return fail('A player has no cards left.');
      for (const id of ids(room)) game.players[id].revealed=game.players[id].deck.pop();
      game.phase='choose-category'; game.category=null; game.categoryRank=0; game.revealAll=false;
    } else if (action.type==='choose-category' || action.type==='override-category') {
      if (!p.revealed || !action.category) return fail('Draw a card first.');
      const canInitial=action.type==='choose-category' && actor===game.turn && game.phase==='choose-category';
      const canOverride=action.type==='override-category' && game.phase==='challenge' && rank(room.edition,p.revealed)>game.categoryRank;
      if (!canInitial && !canOverride) return fail('This category cannot be changed now.');
      game.category=action.category; game.categoryRank=rank(room.edition,p.revealed); game.phase='challenge';
    } else if (action.type==='reveal') {
      if (!game.category || game.phase!=='challenge') return fail('Choose a category first.');
      game.revealAll=true; game.phase='award';
    } else if (action.type==='award') {
      if (!game.revealAll || !game.players[action.winner]?.revealed) return fail('Choose the winning revealed card.');
      for (const id of ids(room)) { const card=game.players[id].revealed; if(card) game.players[action.winner].deck.unshift(card); game.players[id].revealed=null; }
      game.turn=action.winner; game.phase='draw'; game.category=null; game.categoryRank=0; game.revealAll=false;
    } else return fail('Unknown action.');
  } else if (room.mode==='timeline') {
    if (action.type==='set-category') {
      if (!action.category) return fail('Choose a category.');
      if (game.category && game.category!==action.category) resetTimeline(room);
      game.category=action.category; game.phase='draw';
    } else if (action.type==='draw') {
      if (actor!==game.turn || game.phase!=='draw' || !game.category) return fail('Wait for your turn or choose a category.');
      if (!p.deck.length) return fail('Your deck is empty.');
      game.peek={owner:actor,card:p.deck.pop()}; game.phase='place';
    } else if (action.type==='place') {
      if (actor!==game.turn || game.phase!=='place' || !game.peek || game.peek.owner!==actor) return fail('Place the card drawn on your turn.');
      const index=Math.max(0,Math.min(Number(action.index)||0,game.timeline.length)); game.pending={...game.peek,index}; game.peek=null; game.phase='confirm';
    } else if (action.type==='confirm') {
      if (actor!==game.turn || game.phase!=='confirm' || !game.pending || game.pending.owner!==actor) return fail('Confirm your own placement.');
      if (action.correct) { game.timeline.splice(game.pending.index,0,{owner:actor,card:game.pending.card}); game.pending=null; game.phase='draw'; }
      else { p.deck.unshift(game.pending.card); game.pending=null; game.turn=nextPlayer(room,actor); game.phase='draw'; }
    } else return fail('Unknown action.');
  }
  emit(room); done?.({ok:true});
}

io.on('connection', socket => {
  socket.on('room:create', ({edition,name,mode='phylogenome',maxPlayers=2},done) => {
    const limits={phylogenome:[2],nature:[2,3,4],timeline:[1,2,3,4]}, allowed=limits[mode]||limits.phylogenome;
    maxPlayers=allowed.includes(Number(maxPlayers))?Number(maxPlayers):allowed[0];
    const player={id:socket.id,name:name?.trim().slice(0,24)||'Player 1',ready:false};
    const room={code:roomCode(),edition:edition==='extinction'?'extinction':'genome',mode,maxPlayers,players:{[socket.id]:player},game:null,started:false};
    rooms.set(room.code,room); socket.join(room.code); done({ok:true,room:view(room,socket.id),playerId:socket.id});
  });
  socket.on('room:join', ({code,name},done) => { const room=rooms.get(code?.toUpperCase()); if(!room)return done({ok:false,error:'Room not found.'}); if(ids(room).length>=room.maxPlayers)return done({ok:false,error:'This room is already full.'}); room.players[socket.id]={id:socket.id,name:name?.trim().slice(0,24)||`Player ${ids(room).length+1}`,ready:false};socket.join(room.code);done({ok:true,room:view(room,socket.id),playerId:socket.id});emit(room); });
  socket.on('deck:ready', ({code,deck},done) => { const room=rooms.get(code);if(!room?.players[socket.id])return;room.players[socket.id].deck=deck;room.players[socket.id].ready=true;if(ids(room).length===room.maxPlayers&&ids(room).every(id=>room.players[id].ready)){room.started=true;room.game=initialGame(room);}emit(room);done?.({ok:true}); });
  socket.on('mode:action',({code,action},done)=>{const room=rooms.get(code);if(!room?.started)return done?.({ok:false,error:'Game not ready.'});modeAction(room,socket.id,action,done);});
  socket.on('game:update',({code,game},done)=>{const room=rooms.get(code);if(!room?.players[socket.id]||!room.started||room.mode!=='phylogenome')return;const snapshot=structuredClone(room.game);snapshot.history=[];room.game.history=[...(room.game.history||[]),snapshot].slice(-30);const mine=game.players?.[socket.id];if(!mine)return;room.game.players[socket.id]=mine;for(const [id,incoming] of Object.entries(game.players||{}))if(id!==socket.id&&room.game.players[id])for(const zone of ['discard','inPlay','progress','grid'])room.game.players[id][zone]=incoming[zone]||room.game.players[id][zone];room.game.turn=game.turn;room.game.step=Number.isInteger(game.step)?game.step:room.game.step;emit(room);done?.({ok:true});});
  socket.on('game:undo',({code},done)=>{const room=rooms.get(code),history=room?.game?.history||[],previous=history.pop();if(!previous)return done?.({ok:false,error:'Nothing to undo.'});previous.history=history;room.game=previous;emit(room);done?.({ok:true});});
  socket.on('disconnect',()=>{for(const room of rooms.values())if(room.players[socket.id]){room.players[socket.id].connected=false;emit(room);}});
});
httpServer.listen(process.env.PORT||3000,()=>console.log('PhyloGenome online server running.'));
