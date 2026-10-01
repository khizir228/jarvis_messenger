const $ = id => document.getElementById(id);
let token = localStorage.getItem('jarvis_token') || '';
let me = null, activeRoom = null, activeRoomData = null, ws = null;
let registerMode = false, reconnectTimer = null, typingTimer = null, searchTimer = null;

function esc(s){return String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function avatar(u, cls='avatar'){
  const n=esc((u?.display_name||'?')[0].toUpperCase());
  if(u?.avatar) return `<div class="${cls}"><img src="${esc(u.avatar)}" onerror="this.style.display='none'" alt=""></div>`;
  return `<div class="${cls}">${n}</div>`;
}
function api(path,opt={}){
  const o={...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}};
  const u=new URL(path,location.origin);
  if(token) u.searchParams.set('token',token);
  return fetch(u,o).then(async r=>{
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.detail || 'Ошибка запроса');
    return d;
  });
}
function theme(){document.documentElement.style.setProperty('--accent',me?.accent||'#7c5cff');}
function auth(show){$('auth').classList.toggle('visible',show);}
function statusText(s){return ({online:'онлайн',idle:'отошёл',dnd:'не беспокоить',invisible:'невидимка'})[s]||'онлайн';}
function renderUser(){
  if(!me) return;
  $('userCard').innerHTML=`${avatar(me)}<div class="user-info"><b>${esc(me.display_name)}</b><span>@${esc(me.username)}</span><em class="status-dot ${esc(me.status)}"></em><small>${statusText(me.status)}</small></div>`;
  $('profileName').value=me.display_name||'';
  $('profileBio').value=me.bio||'';
  $('profileAvatar').value=me.avatar||'';
  $('profileAccent').value=me.accent||'#7c5cff';
  $('profileStatus').value=me.status||'online';
  theme();
}
async function loadMe(){me=await api('/api/me');renderUser();}
async function loadRooms(select=true, preferredRoomId=null){
  const rs=await api('/api/rooms');
  $('rooms').innerHTML='';
  rs.forEach(r=>{
    const el=document.createElement('button');
    el.type='button';
    el.className='room '+(activeRoom===r.id?'active':'');
    el.dataset.roomId=String(r.id);
    el.innerHTML=`<span class="room-hash">#</span><span class="room-name">${esc(r.name)}</span><span class="members">${r.members}</span>`;
    el.onclick=()=>openRoom(r);
    $('rooms').appendChild(el);
  });
  if(!select)return;
  let target=null;
  if(preferredRoomId){ target=rs.find(r=>Number(r.id)===Number(preferredRoomId))||null; }
  if(!target && activeRoom){ target=rs.find(r=>Number(r.id)===Number(activeRoom))||null; }
  if(!target) target=rs[0]||null;
  if(!target && preferredRoomId){
    try{ target=await api('/api/rooms/'+encodeURIComponent(preferredRoomId)); }catch(e){ console.warn('[Jarvis] room fallback failed',e); }
  }
  if(target){ await openRoom(target); return; }
  $('roomName').textContent='Нет комнат'; setConnection('нет комнат');
}
function setConnection(text,good=false){$('roomStatus').innerHTML=`<span class="connection ${good?'good':''}"></span>${esc(text)}`;}
function renderMessage(m){
  const el=document.createElement('article');
  el.className='message'; el.dataset.id=m.id;
  const d=new Date(m.created_at); const tm=isNaN(d)?'':d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  const reactions=(m.reactions||[]).map(r=>`<button type="button" class="reaction ${r.mine?'mine':''}" data-mid="${m.id}" data-emoji="${esc(r.emoji)}">${esc(r.emoji)} ${r.count}</button>`).join('');
  el.innerHTML=`${avatar(m)}<div class="msg-body"><div class="meta"><b>${esc(m.display_name)}</b><span>${tm}</span>${m.edited_at?'<i>изменено</i>':''}</div><div class="content">${esc(m.content)}</div><div class="reactions">${reactions}<button type="button" class="add-reaction" data-mid="${m.id}">＋</button></div></div>`;
  $('messages').appendChild(el);
}
function showHistory(list){
  $('messages').innerHTML='';
  if(!list.length){$('messages').innerHTML='<div class="empty"><div><div class="empty-icon">✦</div><h3>Здесь пока пусто</h3><p>Напиши первое сообщение.</p></div></div>';return;}
  list.forEach(renderMessage);scrollBottom();
}
function scrollBottom(){requestAnimationFrame(()=>{$('messages').scrollTop=$('messages').scrollHeight;});}
async function openRoom(r){
  activeRoom=r.id; activeRoomData=r;
  $('roomName').textContent=r.name;
  $('copyInvite').disabled=false;
  $('copyInvite').title='Код: '+r.invite_code;
  document.querySelectorAll('.room').forEach(x=>x.classList.remove('active'));
  const current=[...document.querySelectorAll('.room')].find(x=>x.querySelector('.room-name')?.textContent===r.name);
  if(current) current.classList.add('active');
  $('messageInput').disabled=false; document.querySelector('#composer button').disabled=false;
  $('messages').innerHTML='<div class="loading">Загрузка сообщений…</div>';
  $('typing').textContent='';
  if(ws){try{ws._closeByUs?.();}catch{} ws=null;}
  try{const h=await api(`/api/rooms/${r.id}/messages`);if(activeRoom!==r.id)return;showHistory(h);connectWS(r.id);}catch(e){$('messages').innerHTML=`<div class="empty">${esc(e.message)}</div>`;setConnection('ошибка');}
}
function connectWS(roomId){
  clearTimeout(reconnectTimer); setConnection('подключение…');
  console.log('[Jarvis] WS connect', roomId, location.host);
  const proto=location.protocol==='https:'?'wss':'ws'; let closedByUs=false;
  ws=new WebSocket(`${proto}://${location.host}/ws/${roomId}?token=${encodeURIComponent(token)}`);
  ws.onopen=()=>{console.log('[Jarvis] WS connected');if(activeRoom===roomId)setConnection('онлайн',true);};
  ws.onmessage=e=>{
    let d; try{d=JSON.parse(e.data)}catch{return;}
    if(d.type==='ready'){if(activeRoom===roomId)setConnection('онлайн',true);return;}
    if(d.type==='pong')return;
    if(d.type==='error'){if(activeRoom===roomId)setConnection(d.message||'ошибка');return;}
    if(d.type==='typing'){if(d.user_id!==me?.id)$('typing').textContent=d.active?`${d.display_name||'Кто-то'} печатает…`:'';return;}
    if(d.id){
      if($('messages').querySelector('.empty')) $('messages').innerHTML='';
      if(!document.querySelector(`.message[data-id="${d.id}"]`)){renderMessage(d);scrollBottom();}
    }
  };
  ws.onerror=()=>{console.error('[Jarvis] WS error');if(activeRoom===roomId)setConnection('ошибка соединения');};
  ws.onclose=e=>{
    console.warn('[Jarvis] WS closed', e.code, e.reason);
    if(activeRoom!==roomId)return;
    if(e.code===1008){setConnection('доступ запрещён');return;}
    setConnection('переподключение…');
    if(!closedByUs) reconnectTimer=setTimeout(()=>{if(activeRoom===roomId)connectWS(roomId);},1800);
  };
  ws._closeByUs=()=>{closedByUs=true;try{ws.close();}catch{}};
}
function sendMessage(){
  const v=$('messageInput').value.trim();
  if(!v||!ws||ws.readyState!==WebSocket.OPEN)return;
  ws.send(JSON.stringify({type:'message',content:v}));
  $('messageInput').value=''; $('messageInput').style.height='auto'; sendTyping(false);
}
function sendTyping(active){
  if(!ws||ws.readyState!==WebSocket.OPEN)return;
  try{ws.send(JSON.stringify({type:'typing',active,display_name:me?.display_name||''}));}catch{}
  clearTimeout(typingTimer);
  if(active)typingTimer=setTimeout(()=>sendTyping(false),900);
}
function autoGrow(){const x=$('messageInput');x.style.height='auto';x.style.height=Math.min(x.scrollHeight,130)+'px';}

$('composer').addEventListener('submit',e=>{e.preventDefault();sendMessage();});
$('messageInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}else sendTyping(true);});
$('messageInput').addEventListener('input',()=>{autoGrow();sendTyping(true);});
$('messages').addEventListener('click',async e=>{
  const r=e.target.closest('.reaction'), add=e.target.closest('.add-reaction');
  try{
    if(r) await api(`/api/messages/${r.dataset.mid}/reaction?emoji=${encodeURIComponent(r.dataset.emoji)}`,{method:'POST'});
    if(add) await api(`/api/messages/${add.dataset.mid}/reaction?emoji=${encodeURIComponent('👍')}`,{method:'POST'});
    if(r||add) showHistory(await api(`/api/rooms/${activeRoom}/messages`));
  }catch(err){console.warn(err);}
});

window.addEventListener('error', e=>{ console.error('[Jarvis] JS error:', e.error||e.message); const box=document.getElementById('authError'); if(box && document.getElementById('auth').classList.contains('visible')) box.textContent='Ошибка интерфейса: '+e.message; });
$('loginTab').onclick=()=>{registerMode=false;$('loginTab').classList.add('active');$('registerTab').classList.remove('active');$('displayName').classList.add('hidden');$('authSubmit').textContent='Войти';$('password').autocomplete='current-password';};
$('registerTab').onclick=()=>{registerMode=true;$('registerTab').classList.add('active');$('loginTab').classList.remove('active');$('displayName').classList.remove('hidden');$('authSubmit').textContent='Создать аккаунт';$('password').autocomplete='new-password';};
$('authSubmit').onclick=async()=>{const btn=$('authSubmit');btn.disabled=true;$('authError').textContent='';try{const b={username:$('username').value.trim(),password:$('password').value};if(registerMode)b.display_name=$('displayName').value.trim();const d=await api(registerMode?'/api/register':'/api/login',{method:'POST',body:JSON.stringify(b)});token=d.token;localStorage.setItem('jarvis_token',token);await loadMe();auth(false);await loadRooms(true,d.room_id||null);}catch(e){console.error('[Jarvis] auth error',e);$('authError').textContent=e.message||String(e);}finally{btn.disabled=false;}};
$('logout').onclick=()=>{localStorage.removeItem('jarvis_token');token='';try{ws?._closeByUs?.();}catch{}location.reload();};
$('addRoom').onclick=()=>{$('roomModal').classList.add('visible');$('roomNameInput').focus();};
$('joinRoom').onclick=()=>{$('roomModal').classList.add('visible');$('inviteInput').focus();};
$('closeRoomModal').onclick=()=>{$('roomModal').classList.remove('visible');$('roomError').textContent='';};
$('createRoomBtn').onclick=async()=>{try{const r=await api('/api/rooms',{method:'POST',body:JSON.stringify({name:$('roomNameInput').value.trim()})});$('roomModal').classList.remove('visible');$('roomNameInput').value='';$('roomError').textContent='';await loadRooms(false);openRoom(r);}catch(e){$('roomError').textContent=e.message;}};
$('joinRoomBtn').onclick=async()=>{try{const d=await api('/api/rooms/join',{method:'POST',body:JSON.stringify({code:$('inviteInput').value.trim()})});$('roomModal').classList.remove('visible');$('inviteInput').value='';$('roomError').textContent='';await loadRooms(false);const rs=await api('/api/rooms');const r=rs.find(x=>x.id===d.room_id);if(r)openRoom(r);}catch(e){$('roomError').textContent=e.message;}};
$('profileBtn').onclick=()=>{$('profileModal').classList.add('visible');};
$('closeProfile').onclick=()=>{$('profileModal').classList.remove('visible');};
$('saveProfile').onclick=async()=>{try{me=await api('/api/me',{method:'PUT',body:JSON.stringify({display_name:$('profileName').value.trim(),bio:$('profileBio').value,avatar:$('profileAvatar').value.trim(),accent:$('profileAccent').value,status:$('profileStatus').value})});renderUser();$('profileModal').classList.remove('visible');}catch(e){alert(e.message);}};
$('copyInvite').onclick=async()=>{if(!activeRoomData)return;try{await navigator.clipboard.writeText(activeRoomData.invite_code);const b=$('copyInvite');b.textContent='Скопировано';setTimeout(()=>b.textContent='Код',1200);}catch{alert('Код комнаты: '+activeRoomData.invite_code);}};
$('searchInput').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(async()=>{if(!activeRoom)return;try{showHistory(await api(`/api/rooms/${activeRoom}/messages?q=${encodeURIComponent($('searchInput').value.trim())}`));}catch{}},250);});
setInterval(()=>{if(ws?.readyState===WebSocket.OPEN)try{ws.send(JSON.stringify({type:'ping'}));}catch{}},20000);
(async()=>{
  if(!token){auth(true);return;}
  try{await loadMe();auth(false);await loadRooms(true);}
  catch(e){localStorage.removeItem('jarvis_token');token='';auth(true);}
})();
