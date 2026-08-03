/* Nature Challenge and Timeline are isolated from the original game table. */
(() => {
  const originalLobby = lobby, originalBoard = board;
  const modeInfo = { phylogenome:{label:'PhyloGenome',limits:[2]}, nature:{label:'Nature Challenge',limits:[2,3,4]}, timeline:{label:'Timeline',limits:[1,2,3,4]} };
  const categories = () => rules[room.edition].categories || (room.edition==='genome' ? ['First publication date','Genome size','Coding genes','Unique chromosomes'] : ['Genetic diversity','Date of assessment','No. of mature individuals','Habitats']);

  requirement = function () {
    const r = rules[room.edition];
    if (room.mode === 'phylogenome') {
      const out=[]; r.progress.forEach(x=>out.push({kind:'progress',tag:x,n:1,label:`${room.edition==='genome'?'Generation progress':'Conservation status progress'}: ${x}`}));
      out.push({kind:'event',n:10,label:'Event cards'}); r.species.forEach((n,i)=>out.push({kind:'species',tag:r.progress[i],n,label:`Species: ${r.progress[i]}`})); return out;
    }
    return r.species.map((n,i)=>({kind:'species',tag:r.progress[i],n,label:`Species: ${r.progress[i]}`}));
  };

  openForm = function (mode) {
    if (mode === 'join') {
      modalBody.innerHTML=`<h2>Join a game room</h2><label class="field">Your name<input id="name" maxlength="24"></label><label class="field">Room code<input id="code" maxlength="6" style="text-transform:uppercase"></label><button id="send" type="button">Join room</button>`;
      modal.showModal(); document.querySelector('#send').onclick=()=>socket.emit('room:join',{name:document.querySelector('#name').value,code:document.querySelector('#code').value},receive); return;
    }
    let edition='genome', gameMode='phylogenome';
    modalBody.innerHTML=`<h2>Create a game room</h2><label class="field">Your name<input id="name" maxlength="24"></label><p class="field">Choose an edition</p><div class="edition-picker"><button type="button" class="edition-choice selected" data-edition="genome"><img src="/assets/ge.jpg" alt="Genome Edition"><span>Genome Edition</span></button><button type="button" class="edition-choice" data-edition="extinction"><img src="/assets/ee.jpg" alt="Extinction Edition"><span>Extinction Edition</span></button></div><p class="field">Choose a game mode</p><div class="mode-picker">${Object.entries(modeInfo).map(([id,item])=>`<button type="button" class="mode-choice ${id==='phylogenome'?'selected':''}" data-mode="${id}"><b>${item.label}</b><small>${item.limits.join('-')} players</small></button>`).join('')}</div><label class="field">Number of players<select id="playerCount"></select></label><button id="send" type="button">Create room</button>`;
    const setCount=()=>{document.querySelector('#playerCount').innerHTML=modeInfo[gameMode].limits.map(n=>`<option value="${n}">${n}</option>`).join('');}; setCount(); modal.showModal();
    document.querySelectorAll('.edition-choice').forEach(b=>b.onclick=()=>{edition=b.dataset.edition;document.querySelectorAll('.edition-choice').forEach(x=>x.classList.toggle('selected',x===b));});
    document.querySelectorAll('.mode-choice').forEach(b=>b.onclick=()=>{gameMode=b.dataset.mode;document.querySelectorAll('.mode-choice').forEach(x=>x.classList.toggle('selected',x===b));setCount();});
    document.querySelector('#send').onclick=()=>socket.emit('room:create',{name:document.querySelector('#name').value,edition,mode:gameMode,maxPlayers:+document.querySelector('#playerCount').value},receive);
  };
  function receive(result){if(!result.ok)return alert(result.error);room=result.room;me=result.playerId;modal.close();render();}

  lobby = function () {
    if (room.mode === 'phylogenome') return originalLobby();
    const r=rules[room.edition], ready=room.players.filter(p=>p.ready), catalogue=cards.filter(c=>editionOf(c)===room.edition), loading=cardsState==='idle'||cardsState==='loading';
    const group=q=>{const pool=catalogue.filter(c=>matches(c,q));return `<section class="card-group"><h3>${q.label}<span>${pool.length} available</span></h3><div class="card-list">${pool.map(c=>`<button class="card ${selection.some(x=>x.id===c.id)?'selected':''}" onclick="pick('${c.id}')"><img src="${c.image}" alt="${c.title}"></button>`).join('')}</div></section>`;};
    app.innerHTML=`<section class="room"><p class="eyebrow">${r.label} - ${modeInfo[room.mode].label}</p><h1>Room ${room.code} <button class="copy-code" onclick="copyAltCode()">Copy</button></h1><p>Share this code with the other players.</p><div class="lobby"><div><h2>Players (${room.players.length}/${room.maxPlayers})</h2>${room.players.map(p=>`<p>${p.name} ${p.ready?'Deck ready':'choosing cards...'}</p>`).join('')}<p class="notice">${ready.length===room.maxPlayers?'All decks are ready. Setting up the game...':'Each player chooses independently.'}</p></div><div><h2>Your deck</h2><p class="muted">Select the required species cards, or choose Random select.</p><button onclick="random()" ${cardsState==='ready'?'':'disabled'}>Random select</button> <button class="secondary" onclick="selection=[];render()">Clear</button>${counts().map(x=>`<div>${x.label}: <b>${x.got}/${x.n}</b></div>`).join('')}<p class="muted">${loading?'Loading the PhyloGenome card catalogue...':`${catalogue.length} cards loaded.`}</p><button id="ready">Deck ready</button></div></div><h2>Choose cards</h2>${requirement().map(group).join('')}</section>`;
    if(cardsState==='idle')loadCards(); document.querySelector('#ready').onclick=()=>{if(!valid())return alert('Complete your deck before selecting Deck ready.');socket.emit('deck:ready',{code:room.code,deck:selection});};
  };
  window.copyAltCode = async function(){try{await navigator.clipboard.writeText(room.code);}catch{const input=document.createElement('input');input.value=room.code;document.body.append(input);input.select();document.execCommand('copy');input.remove();}const b=document.querySelector('.copy-code');if(b){b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1200);}};

  board = function () { if(room.mode==='nature') return natureBoard(); if(room.mode==='timeline') return timelineBoard(); return originalBoard(); };
  const name=id=>room.players.find(p=>p.id===id)?.name||'Player';
  const deckCount=state=>Array.isArray(state.deck)?state.deck.length:(state.deck?.count||0);
  const image=card=>card?.hidden?`<div class="card-back">${card.progress||'?'}</div>`:`<div class="play-card"><img src="${card.image||''}" alt="${card.title||'Card'}"></div>`;
  const categoryControls=(actionName,enabled=true)=>`<div class="category-buttons">${categories().map(c=>`<button class="${room.game.category===c?'selected-category':''}" ${enabled?'':'disabled'} onclick="altAction({type:'${actionName}',category:'${c}'})">${c}</button>`).join('')}</div>`;
  const header=(title,body)=>`<div class="gamebar"><div><b>${rules[room.edition].label}</b> - ${title} - Room ${room.code}</div><button onclick="countAltPoints()">Count points</button></div><div class="help">${body}</div>`;
  window.altAction = action => socket.emit('mode:action',{code:room.code,action},result=>{if(!result?.ok)alert(result?.error||'This action is not available now.');});
  window.countAltPoints = function(){const values=room.players.map(p=>({name:p.name,n:deckCount(room.game.players[p.id])}));const best=room.mode==='nature'?Math.max(...values.map(x=>x.n)):Math.min(...values.map(x=>x.n));const winners=values.filter(x=>x.n===best).map(x=>x.name).join(' and ');modalBody.innerHTML=`<h2>Count points</h2>${values.map(x=>`<p><b>${x.name}:</b> ${x.n} cards in deck</p>`).join('')}<p><b>${winners} ${winners.includes(' and ')?'win':'wins'}.</b></p>`;modal.showModal();};
  function natureBoard(){const g=room.game, active=g.turn===me;let text='';if(g.phase==='draw')text=`<b>${name(g.turn)}'s turn.</b> ${active?'<button onclick="altAction({type:\'draw-round\'})">Start round</button>':''}`;else if(g.phase==='choose-category')text=`<b>${name(g.turn)}</b> chooses the category.`;else if(g.phase==='challenge')text=`<b>Category selected: ${g.category}.</b> A player with a higher progress level may change it. <button onclick="altAction({type:'reveal'})">Show all cards</button>`;else text='<b>All cards are visible.</b> Click the winning card.';
    const controls=categoryControls(g.phase==='choose-category'?'choose-category':'override-category',g.phase==='choose-category'?active:g.phase==='challenge');
    app.className='game alternative-game';app.innerHTML=header('Nature Challenge',`${text}${controls}`)+`<section class="nature-table">${room.players.map(p=>{const state=g.players[p.id],click=g.phase==='award'?`onclick="altAction({type:'award',winner:'${p.id}'})"`:'';return `<article class="player-pile ${p.id===me?'is-me':''}"><h2>${p.name}<small>Deck: ${deckCount(state)}</small></h2><div class="nature-card ${g.phase==='award'?'clickable':''}" ${click}>${state.revealed?image(state.revealed):'<div class="empty-card">Waiting for a card</div>'}</div></article>`;}).join('')}</section>`;}
  function timelineBoard(){const g=room.game,active=g.turn===me;let text=`<b>${g.category?`Sorting by: ${g.category}`:'Choose a category to begin.'}</b>`;if(g.phase==='draw'&&active&&g.category)text+=' <button onclick="altAction({type:\'draw\'})">Draw a card</button>';if(g.phase==='place')text=`<b>${name(g.turn)} is placing a card.</b> ${active?'Choose a plus sign in the timeline.':''}`;if(g.phase==='confirm')text=`<b>Is this card in the correct position?</b>${active?' <button onclick="altAction({type:\'confirm\',correct:true})">Correct</button> <button class="secondary" onclick="altAction({type:\'confirm\',correct:false})">Not correct</button>':''}`;
    const controls=categoryControls('set-category',true);
    const items=[...g.timeline];if(g.pending)items.splice(g.pending.index,0,{...g.pending,pending:true});const slot=i=>`<button class="timeline-slot" ${active&&g.phase==='place'?'':'disabled'} onclick="altAction({type:'place',index:${i}})">+</button>`;
    app.className='game alternative-game';app.innerHTML=header('Timeline',`${text}${controls}`)+`<div class="timeline-piles">${room.players.map(p=>`<div class="zone ${p.id===me?'own-zone':''}"><b>${p.name}'s deck (${deckCount(g.players[p.id])})</b></div>`).join('')}</div><section class="timeline-line">${slot(0)}${items.map((entry,i)=>`<button class="timeline-card ${entry.pending?'pending-card':''}" onclick="openTimelineCard('${entry.card.id}')">${image(entry.card)}</button>${slot(i+1)}`).join('')}</section>${g.peek&&g.peek.owner===me?`<section class="timeline-peek"><h2>Your card</h2><div class="partial-card"><img src="${g.peek.card.image}" alt="${g.peek.card.title}"></div><p>Only the upper half is visible until you place it.</p></section>`:''}`;
  }
  window.openTimelineCard=function(id){const g=room.game,entry=[...g.timeline,g.pending].filter(Boolean).find(x=>x.card.id===id);if(!entry)return;modalBody.innerHTML=`<h2>${entry.card.title}</h2><img class="card-preview" src="${entry.card.image}" alt="${entry.card.title}">`;modal.showModal();};
  window.openPlatformHelp=function(){modalBody.innerHTML='<h2>How to play</h2><p>Create or join a room, choose your cards, and select Deck ready. The room opens when every player is ready.</p><p>Use the category controls in Nature Challenge and Timeline to guide each round. The standard PhyloGenome mode follows the turn guide at the top of the table.</p>';modal.showModal();};
  const deferImages=()=>document.querySelectorAll('img:not([loading])').forEach(img=>{img.loading='lazy';img.decoding='async';});
  deferImages(); new MutationObserver(deferImages).observe(document.body,{childList:true,subtree:true});
})();
