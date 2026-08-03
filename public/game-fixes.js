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



/* Platform help and deck-completion feedback. */
function showPlatformHelp() {
  modalBody.innerHTML = `
    <section class="platform-help">
      <h2>How to play PhyloGenome online</h2>
      <p><strong>1. Create or join a room.</strong> One player creates a room, selects Genome Edition or Extinction Edition, and shares the room code with their opponent. The other player joins using that code.</p>
      <p><strong>2. Build your deck.</strong> Each player selects the required number of cards in every category shown in <em>Your deck</em>. You can choose cards yourself or use <em>Random select</em>. Click <em>Deck ready</em> only after every category is complete. When both players are ready, the game table opens automatically.</p>
      <p><strong>3. Play from your own side of the table.</strong> Each player sees the board from their own perspective: their cards face them, while the opponent’s cards are rotated. Your cards have a red corner tab at the lower-right corner. A grey tab at the lower-left of a board cell shows how many cards are stacked there.</p>
      <h3>The game table</h3>
      <p>The left-hand piles are your draw pile, discard pile, progress cards and cards in play. Your hand is along the bottom. The opponent’s piles are on the right. The central 20 × 20 board is where species and event cards are placed; the two central reserved cells hold the players’ progress cards.</p>
      <h3>Card actions</h3>
      <ul>
        <li><strong>Draw</strong>: move a card to your hand. Drawing from your draw pile takes one random card; drawing from another visible pile lets you choose.</li>
        <li><strong>Discard</strong>: move a card to its owner’s discard pile. On an ordinary board cell, this affects the cards stacked in that cell.</li>
        <li><strong>Play</strong>: place a card in <em>Your cards in play</em>.</li>
        <li><strong>Move</strong>: choose a card or board cell, click <em>Move</em>, then click the destination cell on the board.</li>
      </ul>
      <p>Progress cards work differently: from your progress pile they can only be played into your reserved central cell; from that cell they can be returned to your progress pile.</p>
      <h3>Play together</h3>
      <p>This platform does not automatically enforce card effects or game actions. Players manage them manually, as with the physical game. We strongly recommend keeping an audio call active so you can describe your actions to your opponent—especially when event cards affect or discard an opponent’s species cards.</p>
      <h3>Turn guide, Undo and Zoom</h3>
      <p>The bar at the top shows whose turn it is and the current step. During your turn, click <em>Next</em> after completing each step. It is optional, but helps avoid missed steps and makes an opponent’s turn easier to follow when you are not speaking live. <em>Undo</em> reverses the latest shared action, whether made by you or your opponent. <em>Zoom</em> enlarges or reduces the board view.</p>
      <h3>Count points</h3>
      <p><em>Count points</em> can be used at any time. It is a simplified score only and does not use the full scoring system in the printed game rules.</p>
      <ul>
        <li><strong>Genome Edition:</strong> first-generation species × 1 + second-generation species × 2 + third-generation species × 3 + the number of different Genomic interest areas among your cards on the board.</li>
        <li><strong>Extinction Edition:</strong> CR species × 1 + EN species × 2 + VU species × 3 + LC species × 4 + the number of different Threats among your cards on the board.</li>
      </ul>
    </section>`;
  modal.showModal();
}
document.querySelectorAll('.help-trigger').forEach(button => button.addEventListener('click', showPlatformHelp));

/* Keep Deck ready available so an incomplete deck can explain what is missing. */
function refreshDeckReadyButton() {
  const ready = app.querySelector('#ready');
  if (ready) ready.disabled = false;
}
new MutationObserver(() => requestAnimationFrame(refreshDeckReadyButton)).observe(app, { childList: true, subtree: true });
document.addEventListener('click', event => {
  const ready = event.target.closest('#ready');
  if (!ready || valid()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const missing = counts().filter(group => group.got < group.n).map(group => `${group.label}: ${group.got}/${group.n}`);
  alert(`Complete your deck before selecting Deck ready.\\n\\nStill needed:\\n${missing.join('\\n')}`);
}, true);
