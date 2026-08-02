/* Interaction refinements for the shared table. */
window.openCard = function (owner, zone, id) {
  const state = stateFor(owner), card = (state?.[zone] || []).find(c => c.id === id);
  if (!card) return;
  const own = owner === 'me' || owner === me;
  const actions = isProgressCard(card)
    ? (zone === 'progress' && own ? `<button onclick="play('${zone}','${id}')">Play</button>` : '')
    : own
      ? `<button onclick="toHand('${zone}','${id}')">Draw</button><button onclick="discard('${owner}','${zone}','${id}')">Discard</button><button onclick="play('${zone}','${id}')">Play</button><button onclick="move('${zone}','${id}')">Move</button>`
      : `<button onclick="discard('${owner}','${zone}','${id}')">Discard</button>`;
  modalBody.innerHTML = `<h2>${card.title}</h2><img class="card-preview" src="${card.image || ''}" alt=""><div class="card-actions">${actions}</div>`;
  modal.showModal();
};

window.viewGridCell = function (index) {
  const cards = [];
  for (const [owner, state] of Object.entries(room.game.players)) {
    for (const card of state.grid?.[index] || []) cards.push({ owner, card });
  }
  cards.sort((a, b) => cardLayer(b.card, index) - cardLayer(a.card, index));
  modalBody.innerHTML = `<h2>Cards in this cell (${cards.length})</h2><div class="modal-cards">${cards.map(({owner, card}) => `<button class="card ${owner===me?'own-card':''}" onclick="openGridCard('${owner}',${index},'${card.id}')"><img src="${card.image || ''}" alt=""><span>${card.title}</span></button>`).join('') || '<p>No cards here.</p>'}</div>`;
  modal.showModal();
};

window.openGridCard = function (owner, index, id) {
  const state = stateFor(owner), card = (state.grid?.[index] || []).find(c => c.id === id);
  if (!card) return;
  const own = owner === me;
  const zone = `grid:${index}`;
  const actions = isProgressCard(card)
    ? `<button onclick="returnProgress('${owner}',${index},'${id}')">Discard</button>`
    : own
      ? `<button onclick="toHand('${zone}','${id}')">Draw</button><button onclick="discardGridCell(${index})">Discard</button><button onclick="play('${zone}','${id}')">Play</button><button onclick="moveGridCell(${index})">Move</button>`
      : `<button onclick="discardGridCell(${index})">Discard</button>`;
  modalBody.innerHTML = `<h2>${card.title}</h2><img class="card-preview" src="${card.image || ''}" alt=""><div class="card-actions">${actions}</div>`;
  modal.showModal();
};

window.returnProgress = function (owner, index, id) {
  const state = stateFor(owner), card = take(state, `grid:${index}`, id);
  if (!card) return;
  if (owner === me) clone();
  (state.progress ??= []).push(card);
  modal.close();
  sync('A progress card returned to its progress pile.');
};

window.moveGridCell = function (index) {
  mine().selected = { zone: `grid:${index}`, all: true };
  modal.close();
  board();
};

window.cellAction = function (index) {
  const selected = mine().selected;
  if (selected) {
    const reserved = [188, 189];
    if (reserved.includes(index)) { alert('Only progress cards can be placed in the two central progress cells.'); return; }
    clone();
    if (selected.all) {
      for (const state of Object.values(room.game.players)) {
        const stack = state.grid?.[Number(selected.zone.slice(5))] || [];
        if (stack.length) { state.grid[Number(selected.zone.slice(5))] = []; (state.grid[index] ??= []).push(...stack); }
      }
    } else {
      const card = take(mine(), selected.zone, selected.id);
      if (card) (mine().grid[index] ??= []).push(card);
    }
    mine().selected = null;
    sync('Cards were moved on the board.');
    return;
  }
  viewGridCell(index);
};

window.doUndo = function () {
  socket.emit('game:undo', { code: room.code }, result => { if (!result?.ok) alert(result?.error || 'Nothing to undo.'); });
};

const originalEndGame = window.endGame;
window.endGame = function () {
  originalEndGame();
  requestAnimationFrame(() => { const title = modalBody.querySelector('h2'); if (title) title.textContent = 'Count points'; });
};

/* Center the fresh 20 x 20 board on row 10 / columns 9-10. */
new MutationObserver(() => requestAnimationFrame(() => {
  const grid = document.querySelector('.grid');
  if (!grid || grid.dataset.centered) return;
  grid.dataset.centered = 'yes';
  grid.scrollLeft = Math.max(0, 9 * 92 - grid.clientWidth / 2);
  grid.scrollTop = Math.max(0, 9 * 129 - grid.clientHeight / 2);
})).observe(app, { childList: true, subtree: true });

new MutationObserver(() => requestAnimationFrame(() => {
  const roomTitle = [...app.querySelectorAll('h1')].find(h => h.textContent.startsWith('Room '));
  if (roomTitle && !roomTitle.querySelector('.copy-code')) {
    const code = roomTitle.textContent.replace('Room ', '').trim();
    const button = document.createElement('button');
    button.className = 'copy-code'; button.type = 'button'; button.title = 'Copy room code'; button.textContent = 'Copy';
    button.onclick = async () => { await navigator.clipboard.writeText(code); button.textContent = 'Copied'; setTimeout(() => button.textContent = 'Copy', 1400); };
    roomTitle.append(' ', button);
  }
  const help = app.querySelector('.help');
  if (help && room?.game) {
    help.classList.toggle('waiting', room.game.turn !== me);
    if (room.game.turn === me && room.game.step === 2 && !help.querySelector('.action-hint')) {
      const hint = document.createElement('small'); hint.className = 'action-hint'; hint.textContent = 'Actions: discard one card to draw three; play a species card; move up to two species cards; or play an event card.'; help.append(hint);
    }
  }
  const countButton = [...app.querySelectorAll('button')].find(button => button.textContent.trim() === 'End of game');
  if (countButton) { countButton.textContent = 'Count points'; countButton.classList.remove('secondary'); }
})).observe(app, { childList: true, subtree: true });

