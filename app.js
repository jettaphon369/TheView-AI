import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, addDoc, serverTimestamp, query, orderBy, getDocs, getDoc, writeBatch, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fs = getFirestore(app);
setPersistence(auth, browserLocalPersistence).catch(()=>{});

// ---------- ระบบ Username ภายในทีม ----------
const USERNAME_DOMAIN='theview.local';
const DEFAULT_PASSWORD='chartered';
function normalizeUsername(v=''){ return String(v).trim().toLowerCase().replace(/\s+/g,''); }
function usernameToEmail(v){ return `${normalizeUsername(v)}@${USERNAME_DOMAIN}`; }

const $ = (id)=>document.getElementById(id);
const LAST_PAGE_KEY='theview:lastPage';
const LAST_SCROLL_KEY='theview:lastScroll';
const VALID_PAGES=new Set(['home','stock','scan','approval','report','profile']);
const savedPage=localStorage.getItem(LAST_PAGE_KEY);
const state = { user:null, profile:null, members:[], page:VALID_PAGES.has(savedPage)?savedPage:'home', products:[], approvals:[], logs:[], selectedImage:null, imageMode:null, viewProductId:null, tempMoveImage:null, tempProductImage:null, stockFilter:'all', reportMode:'day', reportFilter:'all', reportDate:'', reportMonth:'' };
const view = $('view');

function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1800); }
function userPath(name){ return collection(fs,'theviewWorkspaces','main',name); }
function productRef(id){ return doc(fs,'theviewWorkspaces','main','products',id); }
function approvalRef(id){ return doc(fs,'theviewWorkspaces','main','approvals',id); }
function logDocRef(id){ return doc(fs,'theviewWorkspaces','main','logs',id); }
function logRef(){ return collection(fs,'theviewWorkspaces','main','logs'); }
function memberRef(uid=state.user?.uid){ return doc(fs,'members',uid); }
function role(){ return state.profile?.role || 'staff'; }
function isAdmin(){ return role()==='admin'; }
function isManager(){ return role()==='admin' || role()==='manager'; }
function requireManager(){ if(!isManager()){ toast('เฉพาะ Manager หรือ Admin เท่านั้น'); return false; } return true; }
function requireAdmin(){ if(!isAdmin()){ toast('เฉพาะ Admin เท่านั้น'); return false; } return true; }
function escapeHtml(s=''){ return String(s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
async function addLog(action,detail,extra={}){ return addDoc(logRef(),{action,detail,time:new Date().toLocaleString('th-TH'),createdAt:serverTimestamp(),actorUid:state.user?.uid||'',actorName:state.profile?.displayName||state.profile?.username||'ไม่ทราบผู้ใช้',...extra}); }

// ---------- สถานที่เบิก/รับ ----------
const STORE_LOCATION = 'Store FB';
const LOCATION_OPTIONS = ['TheView','Kiosk6','Kiosk15','InOut','DV','อื่นๆ'];
function locationFieldHtml(selectId, otherId){
  return `<select id="${selectId}" onchange="window.toggleLocationOther('${selectId}','${otherId}')">
    <option value="">เลือกสถานที่</option>
    ${LOCATION_OPTIONS.map(o=>`<option value="${o}">${o}</option>`).join('')}
  </select>
  <input id="${otherId}" placeholder="ระบุสถานที่" class="hidden">`;
}
window.toggleLocationOther=(selectId,otherId)=>{
  const sel=$(selectId), other=$(otherId);
  if(!sel||!other) return;
  if(sel.value==='อื่นๆ'){ other.classList.remove('hidden'); other.focus(); }
  else { other.classList.add('hidden'); other.value=''; }
};
function getLocationValue(selectId,otherId){
  const sel=$(selectId);
  if(!sel) return '';
  if(sel.value==='อื่นๆ') return ($(otherId).value||'').trim();
  return sel.value||'';
}

// ---------- แสดงผล badge ของ log แยกทิศทาง รับ/เบิก ให้ชัดเจน ----------
const MOVE_TYPE_LABEL = {in:'รับเข้า', out:'เบิกออก'};
function logPillInfo(l){
  let label = l.action, cls = '';
  if(l.action==='เบิกออก'){ cls='warn'; label='↑ เบิกออก'; }
  else if(l.action==='รับเข้า'){ cls='ok'; label='↓ รับเข้า'; }
  else if(l.action==='อนุมัติ'){
    cls = l.moveType==='out' ? 'warn' : (l.moveType==='in' ? 'ok' : 'ok');
    label = `✅ อนุมัติ${l.moveType?` • ${l.moveType==='out'?'↑ เบิกออก':'↓ รับเข้า'}`:''}`;
  } else if(l.action==='ปฏิเสธ'){
    cls = 'bad';
    label = `✕ ปฏิเสธ${l.moveType?` • ${l.moveType==='out'?'↑ เบิกออก':'↓ รับเข้า'}`:''}`;
  } else if(l.action==='ส่งตรวจ'){
    cls = '';
    label = `⏳ ส่งตรวจ${l.moveType?` • ${l.moveType==='out'?'↑ เบิกออก':'↓ รับเข้า'}`:''}`;
  }
  return { label, cls };
}

// ---------- รายงานยอดเบิกแยกตามสถานที่ (รายวัน/รายเดือน) ----------
function pad2(n){ return String(n).padStart(2,'0'); }
function toDateStr(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function toMonthStr(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`; }
function shiftDateStr(str,delta){ const [y,m,d]=str.split('-').map(Number); const dt=new Date(y,m-1,d); dt.setDate(dt.getDate()+delta); return toDateStr(dt); }
function shiftMonthStr(str,delta){ const [y,m]=str.split('-').map(Number); const dt=new Date(y,m-1,1); dt.setMonth(dt.getMonth()+delta); return toMonthStr(dt); }
function getLogDate(l){
  if(l.createdAt && typeof l.createdAt.toDate==='function') return l.createdAt.toDate();
  if(l.createdAt && typeof l.createdAt.seconds==='number') return new Date(l.createdAt.seconds*1000);
  return null;
}
// นับเฉพาะ Log ที่ทำให้สต๊อกเปลี่ยนจริง
function isWithdrawLog(l){
  return l.action==='เบิกออก' || (l.action==='อนุมัติ' && l.moveType==='out');
}
function isReceiveLog(l){
  return l.action==='รับเข้า' || (l.action==='อนุมัติ' && l.moveType==='in');
}
function isStockMovementLog(l){ return isWithdrawLog(l) || isReceiveLog(l); }


// ---------- Realtime listeners: ยกเลิกของเดิมก่อนผูกใหม่เสมอ กันปัญหา listener ค้าง/ซ้อนข้ามบัญชี ----------
let unsubProducts=null, unsubApprovals=null, unsubLogs=null;
function showLoadError(title, error){
  console.error(title, error);
  const code = error?.code || '';
  const detail = code === 'permission-denied'
    ? 'Firestore ปฏิเสธสิทธิ์ กรุณาตรวจสอบว่าเอกสาร members/{UID} อยู่ระดับราก มี status = active และ Rules ถูก Publish แล้ว'
    : (error?.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ');
  view.innerHTML = `<div class="card"><h2>⚠️ ${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p><p class="muted">รหัส: ${escapeHtml(code || '-')}</p><button class="btn primary full" onclick="location.reload()">ลองใหม่</button></div>`;
}
function bindRealtime(){
  if(unsubProducts) unsubProducts();
  if(unsubApprovals) unsubApprovals();
  if(unsubLogs) unsubLogs();
  unsubProducts = onSnapshot(userPath('products'), snap=>{ state.products=snap.docs.map(d=>({id:d.id,...d.data()})); render(); }, err=>showLoadError('โหลดสินค้าไม่สำเร็จ',err));
  unsubApprovals = onSnapshot(userPath('approvals'), snap=>{ state.approvals=snap.docs.map(d=>({id:d.id,...d.data()})); render(); }, err=>showLoadError('โหลดรายการตรวจไม่สำเร็จ',err));
  unsubLogs = onSnapshot(query(userPath('logs'), orderBy('createdAt','desc')), snap=>{ state.logs=snap.docs.map(d=>({id:d.id,...d.data()})); render(); }, err=>showLoadError('โหลดประวัติไม่สำเร็จ',err));
}
function unbindRealtime(){
  if(unsubProducts){ unsubProducts(); unsubProducts=null; }
  if(unsubApprovals){ unsubApprovals(); unsubApprovals=null; }
  if(unsubLogs){ unsubLogs(); unsubLogs=null; }
  state.products=[]; state.approvals=[]; state.logs=[];
}
async function submitLogin(){
  const username=normalizeUsername($('username').value), password=$('password').value;
  if(!username||!password) return toast('กรอก Username และ Password');
  $('loginBtn').disabled=true;
  $('loginBtn').textContent='กำลังเข้าสู่ระบบ...';
  try{ await signInWithEmailAndPassword(auth,usernameToEmail(username),password); }
  catch(e){ toast('เข้าสู่ระบบไม่ได้ โปรดตรวจสอบ Username หรือ Password'); }
  finally{ $('loginBtn').disabled=false; $('loginBtn').textContent='เข้าสู่ระบบ'; }
}
$('loginBtn').onclick=submitLogin;
$('username').addEventListener('keydown',e=>{ if(e.key==='Enter') $('password').focus(); });
$('password').addEventListener('keydown',e=>{ if(e.key==='Enter') submitLogin(); });
$('logoutBtn').onclick=()=>signOut(auth);
$('modalCloseBtn').onclick=hideModal;
$('firstPasswordBtn').onclick=()=>window.saveNewPassword(true);
$('passwordGateLogout').onclick=()=>signOut(auth);
$('firstNewPass').addEventListener('keydown',e=>{ if(e.key==='Enter') $('firstConfirmPass').focus(); });
$('firstConfirmPass').addEventListener('keydown',e=>{ if(e.key==='Enter') window.saveNewPassword(true); });
function goToPage(page, opts={}){
  state.page=VALID_PAGES.has(page)?page:'home';
  localStorage.setItem(LAST_PAGE_KEY,state.page);
  localStorage.setItem(LAST_SCROLL_KEY,'0');
  if(state.page==='stock') state.stockFilter = opts.filter || 'all';
  document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.toggle('active', x.dataset.page===state.page));
  render();
  window.scrollTo({top:0,behavior:'auto'});
}
window.goToPage=goToPage;
document.querySelectorAll('.bottom-nav button').forEach(b=>b.onclick=()=>goToPage(b.dataset.page));

async function enterMainApp(){
  document.body.classList.remove('password-gate-active');
  $('bootPage').classList.add('hidden');
  $('loginPage').classList.add('hidden');
  $('passwordGate').classList.add('hidden');
  $('app').classList.remove('hidden');
  document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.toggle('active', x.dataset.page===state.page));
  render();
  bindRealtime();
  requestAnimationFrame(()=>{
    const y=Number(localStorage.getItem(LAST_SCROLL_KEY)||0);
    if(Number.isFinite(y)&&y>0) window.scrollTo({top:y,behavior:'auto'});
  });
}

function showFirstPasswordGate(){
  document.body.classList.add('password-gate-active');
  $('bootPage').classList.add('hidden');
  $('loginPage').classList.add('hidden');
  $('app').classList.add('hidden');
  $('passwordGate').classList.remove('hidden');
  $('passwordGateUser').textContent = state.profile?.displayName
    ? `${state.profile.displayName} • ${state.profile.username || ''}`
    : (state.profile?.username || 'สมาชิก');
  $('firstNewPass').value='';
  $('firstConfirmPass').value='';
  setTimeout(()=>$('firstNewPass').focus(),100);
}

onAuthStateChanged(auth, async user=>{
  state.user=user; state.profile=null; state.members=[];
  $('loginPage').classList.add('hidden');
  $('passwordGate').classList.add('hidden');
  $('app').classList.add('hidden');
  document.body.classList.remove('password-gate-active');
  if(!user){
    unbindRealtime();
    $('bootPage').classList.add('hidden');
    $('loginPage').classList.remove('hidden');
    return;
  }

  try{
    const snap=await getDoc(memberRef(user.uid));
    if(!snap.exists()){
      $('bootPage').classList.add('hidden');
      $('app').classList.remove('hidden');
      view.innerHTML = `<div class="card"><h2>ยังไม่พบข้อมูลสมาชิก</h2><p>กรุณาสร้างเอกสาร <b>members/${escapeHtml(user.uid)}</b> ที่ระดับรากของ Firestore</p><button class="btn red full" onclick="window.logoutNow()">ออกจากระบบ</button></div>`;
      return;
    }
    state.profile={uid:user.uid,...snap.data()};
    if(state.profile.status!=='active'){
      toast('บัญชีนี้ถูกปิดใช้งาน');
      await signOut(auth);
      return;
    }

    if(state.profile.mustChangePassword){
      showFirstPasswordGate();
      return;
    }

    await enterMainApp();
  }catch(error){
    $('bootPage').classList.add('hidden');
    $('app').classList.remove('hidden');
    showLoadError('เริ่มระบบไม่สำเร็จ',error);
  }
});
window.logoutNow=()=>signOut(auth);

// รูปถูกย่อขนาด + บีบอัดก่อนแปลงเป็น Base64 เพื่อไม่ให้ชนโควตาฟรีของ Firestore (ลิมิต 1MB/เอกสาร)
const MAX_IMG_DIMENSION = 640; // px ด้านยาวสุด
const IMG_QUALITY = 0.6; // คุณภาพ JPEG (0-1)
function compressImage(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > MAX_IMG_DIMENSION) {
          height = Math.round(height * (MAX_IMG_DIMENSION / width));
          width = MAX_IMG_DIMENSION;
        } else if (height > MAX_IMG_DIMENSION) {
          width = Math.round(width * (MAX_IMG_DIMENSION / height));
          height = MAX_IMG_DIMENSION;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', IMG_QUALITY));
      };
      img.onerror = reject;
      img.src = r.result;
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function render(){
  if(!state.user) return;
  try {
    const renderer = ({home:renderHome,stock:renderStock,scan:renderScan,approval:renderApproval,profile:renderProfile,trash:renderTrash,report:renderReport,productDetail:()=>renderProductDetail(state.viewProductId)}[state.page]||renderHome);
    renderer();
  } catch(error) {
    showLoadError('แสดงหน้าไม่สำเร็จ', error);
  }
}
function renderHome(){ const active=state.products.filter(p=>!p.archived && !p.trashed); const low=active.filter(p=>Number(p.stock)<=Number(p.min)).length; view.innerHTML=`<h1>หน้าแรก</h1><div class="grid"><div class="stat clickable" onclick="window.goToPage('stock')"><span>สินค้า</span><b>${active.length}</b></div><div class="stat clickable" onclick="window.goToPage('approval')"><span>รอตรวจ</span><b>${state.approvals.length}</b></div><div class="stat clickable" onclick="window.goToPage('stock',{filter:'low'})"><span>ใกล้หมด</span><b>${low}</b></div><div class="stat clickable" onclick="window.goToPage('profile')"><span>Log</span><b>${state.logs.length}</b></div><div class="stat clickable" onclick="window.goToPage('report')"><span>รายงานเบิก</span><b>📊</b></div></div><div class="card"><h2>สถานะระบบ</h2><p>${low?'⚠️ มีสินค้าใกล้หมด':'✅ สต๊อกปกติ'}</p></div>`; }

function renderStock(){
  const filterLow = state.stockFilter === 'low';
  const all = state.products.filter(p=>!p.archived && !p.trashed);
  const list = filterLow ? all.filter(p=>Number(p.stock)<=Number(p.min)) : all;
  const rows = list.map(p=>`<div class="product">
    <div class="row" style="cursor:pointer" onclick="window.viewProduct('${p.id}')">
      ${p.photo?`<img src="${p.photo}" style="width:44px;height:44px;border-radius:12px;object-fit:cover;flex:0 0 auto">`:`<div style="width:44px;height:44px;border-radius:12px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;flex:0 0 auto">📦</div>`}
      <div><b>${escapeHtml(p.name)}</b><div class="muted">${escapeHtml(p.sku||'-')} • ${p.stock} ${escapeHtml(p.unit||'')} • เตือน ${p.min}</div><span class="pill ${Number(p.stock)<=Number(p.min)?'warn':'ok'}">${Number(p.stock)<=Number(p.min)?'ใกล้หมด':'ปกติ'}</span></div>
    </div>
    <div class="row">
      <button class="btn small green" onclick="window.stockMove('${p.id}','in')">รับ</button>
      <button class="btn small yellow" onclick="window.stockMove('${p.id}','out')">เบิก</button>
      <details class="menu"><summary class="btn small">⋮</summary><div class="menu-items">
        <button class="btn small full" onclick="window.viewProduct('${p.id}')">🔍 ดูรายละเอียด</button>
        ${isManager()?`<button class="btn small full" onclick="window.editProduct('${p.id}')">✏️ แก้ไข</button><button class="btn small full" onclick="window.archiveProduct('${p.id}')">📦 Archive</button>`:''}
      </div></details>
    </div>
  </div>`).join('');
  const archivedCount = state.products.filter(p=>p.archived && !p.trashed).length;
  const emptyMsg = filterLow ? '<p class="muted">ไม่มีสินค้าใกล้หมด 🎉</p>' : '<p class="muted">ยังไม่มีสินค้า</p>';
  view.innerHTML = `<div class="between"><h1>Stock${filterLow?' • ใกล้หมด':''}</h1>${isManager()?'<button class="btn primary small" onclick="window.addProduct()">+ เพิ่ม</button>':''}</div>${filterLow?`<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span class="muted">กำลังแสดงเฉพาะสินค้าใกล้หมด</span><button class="btn small" onclick="window.goToPage('stock')">แสดงทั้งหมด</button></div>`:''}<div class="card">${rows||emptyMsg}</div>${archivedCount?`<div class="card"><button class="btn light full" onclick="window.showArchived()">📦 ดูรายการที่ Archive แล้ว (${archivedCount})</button></div>`:''}`;
  attachMenuPositioning();
}

// ป้องกันเมนู ⋮ ล้นออกนอกจอ (ทั้งขอบล่างและขอบขวา) โดยเฉพาะรายการสุดท้ายในลิสต์
function attachMenuPositioning(){
  document.querySelectorAll('.menu').forEach(menu=>{
    menu.addEventListener('toggle', ()=>{
      const items = menu.querySelector('.menu-items');
      if(!items) return;
      if(!menu.open){ items.style.position=''; items.style.top=''; items.style.left=''; items.style.bottom=''; return; }
      document.querySelectorAll('.menu[open]').forEach(m=>{ if(m!==menu) m.open=false; });
      const summary = menu.querySelector('summary');
      const rect = summary.getBoundingClientRect();
      items.style.position='fixed';
      items.style.right='auto';
      const menuHeight = items.offsetHeight;
      const menuWidth = items.offsetWidth;
      const BOTTOM_NAV_HEIGHT = 90;
      const spaceBelow = window.innerHeight - rect.bottom - BOTTOM_NAV_HEIGHT;
      if(spaceBelow < menuHeight){
        items.style.top = Math.max(8, rect.top - menuHeight - 6) + 'px';
      } else {
        items.style.top = (rect.bottom + 6) + 'px';
      }
      let left = rect.right - menuWidth;
      if(left < 8) left = 8;
      if(left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
      items.style.left = left + 'px';
    });
  });
}
document.addEventListener('click', (e)=>{
  document.querySelectorAll('.menu[open]').forEach(m=>{ if(!m.contains(e.target)) m.open=false; });
});

function renderArchived(){ const rows=state.products.filter(p=>p.archived && !p.trashed).map(p=>`<div class="product"><div><b>${escapeHtml(p.name)}</b><div class="muted">${escapeHtml(p.sku||'-')} • ${p.stock} ${escapeHtml(p.unit||'')}</div></div><div class="row"><button class="btn small green" onclick="window.unarchiveProduct('${p.id}')">↩️ กู้คืน</button></div></div>`).join(''); view.innerHTML=`<div class="between"><h1>รายการที่ Archive</h1><button class="btn small" onclick="window.backToStock()">← กลับ</button></div><div class="card">${rows||'<p class="muted">ไม่มีรายการที่ Archive</p>'}</div>`; }
window.showArchived=()=>renderArchived();
window.backToStock=()=>{ state.page='stock'; renderStock(); };
window.unarchiveProduct=async(id)=>{ if(!requireManager()) return; const p=state.products.find(x=>x.id===id); await updateDoc(productRef(id),{archived:false}); await addLog('กู้คืนสินค้า',p.name,{productId:id}); toast('กู้คืนแล้ว'); renderArchived(); };

// ---------- หน้ารายละเอียดสินค้า (รูป + ประวัติรับ/เบิก) ----------
window.viewProduct=(id)=>{ state.viewProductId=id; state.page='productDetail'; renderProductDetail(id); };
function renderProductDetail(id){
  const p = state.products.find(x=>x.id===id);
  if(!p){ renderStock(); return; }
  const history = state.logs.filter(l=>l.productId===id);
  const rows = history.map(l=>{
    const {label,cls} = logPillInfo(l);
    const changesHtml = Array.isArray(l.changes) && l.changes.length
      ? `<ul style="margin:6px 0 0;padding-left:18px">${l.changes.map(c=>`<li style="margin-bottom:2px">${escapeHtml(c)}</li>`).join('')}</ul>`
      : '';
    return `<div class="log" style="display:flex;gap:10px;align-items:flex-start">
      ${l.photo?`<img src="${l.photo}" style="width:52px;height:52px;border-radius:10px;object-fit:cover;flex:0 0 auto">`:''}
      <div style="flex:1">
        <span class="pill ${cls}">${escapeHtml(label)}</span>
        <div style="margin-top:4px">${l.qty?`<b>${l.qty} ${escapeHtml(l.unit||'')}</b> — `:''}${escapeHtml(l.detail||'')}</div>
        ${l.location?`<div class="muted" style="font-size:13px">📍 ${escapeHtml(l.location)}</div>`:''}
        ${changesHtml}
        <div class="muted" style="font-size:12px">${escapeHtml(l.time||'')}</div>
      </div>
    </div>`;
  }).join('');
  view.innerHTML = `<div class="between"><h1>รายละเอียดสินค้า</h1><button class="btn small" onclick="window.backToStock()">← กลับ</button></div>
  <div class="card">
    ${p.photo?`<img src="${p.photo}" class="preview" style="max-height:220px">`:`<div style="height:120px;border-radius:16px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:40px">📦</div>`}
    <input id="prodPhotoInput" type="file" accept="image/*" class="hidden">
    <button class="btn light full" style="margin-top:10px" onclick="prodPhotoInput.click()">📷 ${p.photo?'เปลี่ยนรูปสินค้า':'เพิ่มรูปสินค้า'}</button>
    <h2 style="margin-bottom:4px">${escapeHtml(p.name)}</h2>
    <p class="muted" style="margin-top:0">${escapeHtml(p.sku||'-')} • หมวด ${escapeHtml(p.category||'-')}</p>
    <div class="grid">
      <div class="stat"><span>คงเหลือ</span><b>${p.stock} ${escapeHtml(p.unit||'')}</b></div>
      <div class="stat"><span>จุดเตือน</span><b>${p.min}</b></div>
    </div>
    <span class="pill ${Number(p.stock)<=Number(p.min)?'warn':'ok'}">${Number(p.stock)<=Number(p.min)?'ใกล้หมด':'ปกติ'}</span>
    <div class="row" style="margin-top:12px">
      <button class="btn green" onclick="window.stockMove('${p.id}','in')">รับเข้า</button>
      <button class="btn yellow" onclick="window.stockMove('${p.id}','out')">เบิกออก</button>
      <button class="btn" onclick="window.editProduct('${p.id}')">✏️ แก้ไข</button>
    </div>
  </div>
  <div class="card"><h2>ประวัติการรับ-เบิก</h2>${rows||'<p class="muted">ยังไม่มีประวัติสำหรับสินค้านี้</p>'}</div>`;
  $('prodPhotoInput').onchange = async (e)=>{
    const f = e.target.files[0]; if(!f) return;
    const dataUrl = await compressImage(f);
    await updateDoc(productRef(id),{photo:dataUrl});
    await addLog('อัปเดตรูปสินค้า',p.name,{productId:id,changes:['เปลี่ยนรูปภาพสินค้าใหม่']});
    toast('บันทึกรูปแล้ว');
  };
}

window.addProduct=()=>{ if(!requireManager()) return; openModal('เพิ่มสินค้า',`
  <label class="field-label" for="pn">ชื่อสินค้า</label>
  <input id="pn" placeholder="เช่น ถุงใส่แก้วกาแฟคู่">

  <label class="field-label" for="ps">รหัสสินค้า (SKU)</label>
  <span class="field-hint">ไม่บังคับ เว้นว่างได้</span>
  <input id="ps" placeholder="ไม่บังคับ">

  <label class="field-label" for="pc">หมวดหมู่</label>
  <input id="pc" placeholder="เช่น บรรจุภัณฑ์">

  <label class="field-label" for="pu">หน่วยนับ</label>
  <span class="field-hint">เช่น แพ็ค, ชิ้น, กระป๋อง, ใบ</span>
  <input id="pu" placeholder="เช่น แพ็ค">

  <label class="field-label" for="pq">จำนวนคงเหลือเริ่มต้น</label>
  <input id="pq" type="number" placeholder="เช่น 10">

  <label class="field-label" for="pm">จุดเตือนสต๊อกต่ำ</label>
  <span class="field-hint">แจ้งเตือน "ใกล้หมด" เมื่อคงเหลือน้อยกว่าหรือเท่ากับจำนวนนี้</span>
  <input id="pm" type="number" placeholder="เช่น 5">

  <button class="btn primary full" onclick="window.saveNewProduct()">บันทึก</button>
`); };
window.saveNewProduct=async()=>{ const name=$('pn').value.trim(), sku=$('ps').value.trim(); if(!name) return toast('กรอกชื่อสินค้า'); if(sku && state.products.some(p=>p.sku===sku)) return toast('SKU ซ้ำ'); await addDoc(userPath('products'),{name,sku,category:$('pc').value,unit:$('pu').value||'ชิ้น',stock:Number($('pq').value)||0,min:Number($('pm').value)||0,archived:false,photo:''}); await addLog('เพิ่มสินค้า',name); hideModal(); };
window.editProduct=(id)=>{ if(!requireManager()) return; const p=state.products.find(x=>x.id===id); openModal('แก้ไขสินค้า',`
  <label class="field-label" for="pn">ชื่อสินค้า</label>
  <span class="field-hint">ชื่อที่จะแสดงในรายการ Stock เช่น ถุงใส่แก้วกาแฟคู่</span>
  <input id="pn" value="${escapeHtml(p.name)}" placeholder="เช่น ถุงใส่แก้วกาแฟคู่">

  <label class="field-label" for="ps">รหัสสินค้า (SKU)</label>
  <span class="field-hint">รหัสอ้างอิงภายใน ไม่บังคับ เว้นว่างได้</span>
  <input id="ps" value="${escapeHtml(p.sku||'')}" placeholder="ไม่บังคับ">

  <label class="field-label" for="pc">หมวดหมู่</label>
  <span class="field-hint">ใช้จัดกลุ่มสินค้า เช่น บรรจุภัณฑ์, วัตถุดิบ, อุปกรณ์</span>
  <input id="pc" value="${escapeHtml(p.category||'')}" placeholder="เช่น บรรจุภัณฑ์">

  <label class="field-label" for="pu">หน่วยนับ</label>
  <span class="field-hint">หน่วยที่ใช้นับสต๊อก เช่น แพ็ค, ชิ้น, กระป๋อง, ใบ</span>
  <input id="pu" value="${escapeHtml(p.unit||'')}" placeholder="เช่น แพ็ค">

  <label class="field-label" for="pm">จุดเตือนสต๊อกต่ำ</label>
  <span class="field-hint">ระบบจะแจ้งเตือน "ใกล้หมด" เมื่อคงเหลือน้อยกว่าหรือเท่ากับจำนวนนี้ ใส่ 0 หากไม่ต้องการเตือน</span>
  <input id="pm" type="number" value="${p.min||0}" placeholder="เช่น 5">

  <button class="btn primary full" onclick="window.saveEditProduct('${id}')">บันทึก</button>
  <button class="btn red full" onclick="window.deleteProduct('${id}')">🗑️ ลบสินค้า (ย้ายไปถังขยะ)</button>
`); };
window.saveEditProduct=async(id)=>{
  const p=state.products.find(x=>x.id===id);
  const sku=$('ps').value.trim();
  if(sku && state.products.some(x=>x.id!==id&&x.sku===sku)) return toast('SKU ซ้ำ');
  const name=$('pn').value.trim();
  const category=$('pc').value;
  const unit=$('pu').value;
  const min=Number($('pm').value)||0;
  const FIELD_LABELS={name:'ชื่อสินค้า',sku:'รหัสสินค้า (SKU)',category:'หมวดหมู่',unit:'หน่วยนับ',min:'จุดเตือนสต๊อกต่ำ'};
  const before={name:p.name||'',sku:p.sku||'',category:p.category||'',unit:p.unit||'',min:p.min||0};
  const after={name,sku,category,unit,min};
  const changes=[];
  for(const key of Object.keys(FIELD_LABELS)){
    const oldVal=before[key], newVal=after[key];
    if(String(oldVal)!==String(newVal)){
      changes.push(`${FIELD_LABELS[key]}: "${oldVal||'-'}" → "${newVal||'-'}"`);
    }
  }
  await updateDoc(productRef(id),{name,sku,category,unit,min});
  await addLog('แก้ไขสินค้า',name,{productId:id,changes:changes.length?changes:['ไม่มีการเปลี่ยนแปลงข้อมูล']});
  hideModal();
};
window.deleteProduct=async(id)=>{ if(!requireManager()) return; if(state.approvals.some(a=>a.productId===id)) return toast('มีรายการรอตรวจ ลบไม่ได้'); if(!confirm('ย้ายสินค้านี้ไปถังขยะ? (กู้คืนได้ทีหลังในหน้าโปรไฟล์)'))return; const p=state.products.find(x=>x.id===id); await updateDoc(productRef(id),{trashed:true,trashedAt:serverTimestamp()}); await addLog('ย้ายไปถังขยะ',p.name,{productId:id}); toast('ย้ายไปถังขยะแล้ว กู้คืนได้ในโปรไฟล์'); hideModal(); };
window.archiveProduct=async(id)=>{ if(!requireManager()) return; if(state.approvals.some(a=>a.productId===id)) return toast('มีรายการรอตรวจ Archive ไม่ได้'); const p=state.products.find(x=>x.id===id); await updateDoc(productRef(id),{archived:true}); await addLog('Archive',p.name,{productId:id}); };

window.stockMove=(id,type)=>{ const p=state.products.find(x=>x.id===id); state.tempMoveImage=null; const locationHtml=type==='in'
  ? `<div class="card" style="margin:8px 0;box-shadow:none;border:1px solid #bbf7d0;background:#f0fdf4"><div class="muted">สถานที่รับเข้า</div><b style="font-size:20px;color:#15803d">📍 ${STORE_LOCATION}</b></div>`
  : locationFieldHtml('moveLoc','moveLocOther');
  openModal(type==='in'?'รับเข้า':'เบิกออก',`<p><b>${escapeHtml(p.name)}</b></p><input id="qty" type="number" placeholder="จำนวน">${locationHtml}<textarea id="reason" placeholder="เหตุผล/หมายเหตุ"></textarea><input id="movePhotoInput" type="file" accept="image/*" class="hidden"><button class="btn light full" onclick="movePhotoInput.click()">📷 แนบรูป (ไม่บังคับ)</button><div id="movePhotoPreview"></div><button class="btn primary full" onclick="window.applyStock('${id}','${type}')">ยืนยัน</button>`);
  $('movePhotoInput').onchange = async (e)=>{ const f=e.target.files[0]; if(!f) return; state.tempMoveImage = await compressImage(f); $('movePhotoPreview').innerHTML = `<img class="preview" src="${state.tempMoveImage}" style="max-height:160px">`; };
};
window.applyStock=async(id,type)=>{
  const q=Number($('qty').value)||0;
  if(q<=0) return toast('จำนวนไม่ถูกต้อง');
  const reason=($('reason').value||'').trim();
  const location=type==='in' ? STORE_LOCATION : getLocationValue('moveLoc','moveLocOther');
  if(type==='out' && !location) return toast('กรุณาเลือกสถานที่เบิก');
  let latestName='', latestUnit='';
  try{
    await runTransaction(fs, async tx=>{
      const ref=productRef(id);
      const snap=await tx.get(ref);
      if(!snap.exists()) throw new Error('ไม่พบสินค้า');
      const p=snap.data();
      const current=Number(p.stock)||0;
      if(type==='out' && q>current) throw new Error('เบิกเกินสต๊อก');
      latestName=p.name||''; latestUnit=p.unit||'';
      tx.update(ref,{stock:type==='in'?current+q:current-q,updatedAt:serverTimestamp()});
    });
    await addLog(type==='in'?'รับเข้า':'เบิกออก',`${latestName} ${q} ${latestUnit}${reason?' • '+reason:''}`,{productId:id,qty:q,unit:latestUnit,photo:state.tempMoveImage||'',location,moveType:type});
    state.tempMoveImage=null; hideModal(); toast('บันทึกสต๊อกแล้ว');
  }catch(e){ console.error(e); toast(e?.message||'บันทึกสต๊อกไม่สำเร็จ'); }
};

function renderScan(){ view.innerHTML=`<h1>AI Assist</h1><div class="card"><h2>เลือกรูป</h2><p class="muted">ระบบฟรี: AI Assist จะจับคู่จากฐานข้อมูล/ชื่อเรียกสินค้า ยังไม่ใช้ API เสียเงิน</p><div class="grid"><button class="btn primary" onclick="cameraInput.click()">📷 ถ่ายรูป</button><button class="btn" onclick="photoInput.click()">🖼️ รูปภาพ</button><button class="btn" onclick="fileInput.click()">📁 ไฟล์</button></div>${state.selectedImage?`<img class="preview" src="${state.selectedImage}">`:''}</div><div class="card"><h2>ข้อมูลรายการ</h2><input id="scanText" placeholder="เช่น เบิกแก้ว 22 oz 2 แถว"><select id="scanProduct"><option value="">เลือกสินค้า</option>${state.products.filter(p=>!p.archived && !p.trashed).map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select><input id="scanQty" type="number" placeholder="จำนวน"><select id="scanType" onchange="window.updateScanLocation()"><option value="out">เบิกออก</option><option value="in">รับเข้า</option></select><div id="scanLocationWrap">${locationFieldHtml('scanLoc','scanLocOther')}</div><button class="btn light full" onclick="window.freeAssist()">ช่วยจับคู่จากข้อความ</button><button class="btn primary full" onclick="window.sendApproval()">ส่งเข้าคิวตรวจ</button></div>`; }
window.updateScanLocation=()=>{ const wrap=$('scanLocationWrap'), type=$('scanType')?.value; if(!wrap) return; wrap.innerHTML=type==='in' ? `<div class="card" style="margin:8px 0;box-shadow:none;border:1px solid #bbf7d0;background:#f0fdf4"><div class="muted">สถานที่รับเข้าอัตโนมัติ</div><b style="font-size:20px;color:#15803d">📍 ${STORE_LOCATION}</b></div>` : locationFieldHtml('scanLoc','scanLocOther'); };
['cameraInput','photoInput','fileInput'].forEach(id=>$(id).onchange=async e=>{ const f=e.target.files[0]; if(!f) return; state.selectedImage = await compressImage(f); e.target.value=''; renderScan(); toast('เลือกรูปแล้ว (บีบอัดอัตโนมัติ)'); });
window.freeAssist=()=>{ const text=($('scanText').value||'').toLowerCase(); let found=state.products.find(p=>text.includes((p.name||'').toLowerCase()) || (p.sku&&text.includes(p.sku.toLowerCase())) || (text.includes('แก้ว')&&p.name.includes('แก้ว'))); if(found) $('scanProduct').value=found.id; const nums=[...text.matchAll(/\d+/g)].map(x=>Number(x[0])); if(nums.length) $('scanQty').value=nums[nums.length-1]; toast(found?'จับคู่สินค้าให้แล้ว':'ยังไม่พบสินค้าในฐานข้อมูล'); };
// ส่งตรวจ: เก็บ logId ไว้ในตัว approval เพื่อไปอัปเดตสถานะ log เดิมตอนอนุมัติ/ปฏิเสธ แทนการสร้าง log ใหม่ซ้ำซ้อน
window.sendApproval=async()=>{ const productId=$('scanProduct').value; const qty=Number($('scanQty').value)||0; const type=$('scanType').value; const location=type==='in' ? STORE_LOCATION : getLocationValue('scanLoc','scanLocOther'); if(!productId) return toast('เลือกสินค้าก่อน'); if(qty<=0) return toast('กรอกจำนวน'); if(type==='out' && !location) return toast('กรุณาเลือกสถานที่ก่อนส่งเข้าคิวตรวจ'); const p=state.products.find(x=>x.id===productId); if(type==='out' && qty>Number(p.stock)) return toast('เบิกเกินสต๊อก'); const logDoc = await addLog('ส่งตรวจ',`${type==='out'?'เบิก':'รับ'} ${p.name} ${qty} ${p.unit}`,{productId,qty,unit:p.unit,photo:state.selectedImage||'',location,moveType:type}); await addDoc(userPath('approvals'),{productId,name:p.name,qty,unit:p.unit,type,location,img:state.selectedImage||'',confidence:state.selectedImage?60:0,status:'pending',logId:logDoc.id,createdAt:serverTimestamp()}); state.selectedImage=null; renderScan(); toast('ส่งเข้าคิวตรวจแล้ว'); };
function renderApproval(){
  const canReview=isManager();
  view.innerHTML=`<h1>Approval</h1>
    ${!canReview?'<div class="card note">คุณสามารถดูคิวตรวจได้ แต่การอนุมัติ แก้ไข หรือปฏิเสธทำได้โดย Manager/Admin</div>':''}
    ${state.approvals.map(a=>`<div class="card approval-card">
      <div class="approval-head">
        <div class="approval-title-wrap">
          <h2 class="approval-title">${escapeHtml(a.name)}</h2>
          <span class="pill ${a.type==='out'?'warn':'ok'} approval-type">${a.type==='out'?'↑ เบิกออก':'↓ รับเข้า'}</span>
        </div>
        <span class="pill warn approval-status">รอตรวจ</span>
      </div>

      <div class="approval-info-grid">
        <div class="approval-info approval-qty">
          <div class="approval-icon approval-icon-blue">📦</div>
          <div>
            <div class="approval-label">จำนวน</div>
            <div class="approval-value">${Number(a.qty)||0} <span>${escapeHtml(a.unit||'')}</span></div>
          </div>
        </div>
        <div class="approval-info approval-location">
          <div class="approval-icon approval-icon-green">📍</div>
          <div>
            <div class="approval-label">${a.type==='out'?'สถานที่เบิก':'สถานที่รับ'}</div>
            <div class="approval-location-value">${escapeHtml(a.location||(a.type==='in'?STORE_LOCATION:'ไม่ระบุสถานที่'))}</div>
          </div>
        </div>
      </div>

      ${a.img?`<img class="preview" src="${a.img}">`:''}
      ${canReview?`<div class="approval-actions">
        <button class="btn green" onclick="window.confirmApprove('${a.id}')">✓ อนุมัติ</button>
        <button class="btn" onclick="window.editApproval('${a.id}')">✎ แก้ไข</button>
        <button class="btn red" onclick="window.confirmReject('${a.id}')">✕ ปฏิเสธ</button>
      </div>`:''}
    </div>`).join('')||'<div class="card" style="text-align:center"><p style="font-size:40px;margin:0 0 6px">✅</p><p class="muted" style="margin:0">ไม่มีงานค้าง ทุกอย่างเรียบร้อย</p></div>'}`;
}
function approvalDetailHtml(a, opts={}){
  const p = state.products.find(x=>x.id===a.productId);
  let stockLine = '';
  if(opts.showStockPreview && p){
    const current = Number(p.stock)||0;
    const after = a.type==='out' ? current-Number(a.qty) : current+Number(a.qty);
    const short = a.type==='out' && after<0;
    stockLine = `<p class="muted" style="font-size:13px;margin:8px 0 0;padding-top:8px;border-top:1px solid var(--line)">
      คงเหลือตอนนี้ <b>${current} ${escapeHtml(p.unit||'')}</b> → หลังอนุมัติเหลือ <b style="color:${short?'#dc2626':'#0f172a'}">${after} ${escapeHtml(p.unit||'')}</b>${short?' ⚠️ ไม่พอ':''}
    </p>`;
  }
  return `<div class="card" style="margin:0 0 12px;box-shadow:none;border:1px solid #e5e7eb">
    <h2 style="margin-top:0">${escapeHtml(a.name)}</h2>
    <p class="muted"><span class="pill ${a.type==='out'?'warn':'ok'}">${a.type==='out'?'↑ เบิกออก':'↓ รับเข้า'}</span> ${a.qty} ${escapeHtml(a.unit||'')}</p>
    ${a.location?`<p class="muted" style="font-size:13px;margin:2px 0 0">📍 ${escapeHtml(a.location)}</p>`:''}
    ${a.img?`<img class="preview" src="${a.img}">`:''}
    ${stockLine}
  </div>`;
}
window.confirmApprove=(id)=>{ if(!requireManager()) return; const a=state.approvals.find(x=>x.id===id); if(!a) return toast('ไม่พบรายการ'); openModal('ยืนยันอนุมัติ', `${approvalDetailHtml(a,{showStockPreview:true})}<button class="btn green full" onclick="window.approve('${id}')">✅ ยืนยันอนุมัติ</button>`); };
window.confirmReject=(id)=>{ if(!requireManager()) return; const a=state.approvals.find(x=>x.id===id); if(!a) return toast('ไม่พบรายการ'); openModal('ยืนยันปฏิเสธ', `${approvalDetailHtml(a)}<button class="btn red full" onclick="window.reject('${id}')">✖️ ยืนยันปฏิเสธ</button>`); };
window.approve=async(id)=>{
  if(!requireManager()) return;
  const a=state.approvals.find(x=>x.id===id);
  if(!a) return toast('ไม่พบรายการ');
  try{
    await runTransaction(fs, async tx=>{
      const pRef=productRef(a.productId), aRef=approvalRef(id);
      const [pSnap,aSnap]=await Promise.all([tx.get(pRef),tx.get(aRef)]);
      if(!pSnap.exists()) throw new Error('ไม่พบสินค้า');
      if(!aSnap.exists()) throw new Error('รายการนี้ถูกดำเนินการแล้ว');
      const p=pSnap.data(), current=Number(p.stock)||0, qty=Number(a.qty)||0;
      if(a.type==='out' && qty>current) throw new Error('เบิกเกินสต๊อก');
      tx.update(pRef,{stock:a.type==='out'?current-qty:current+qty,updatedAt:serverTimestamp()});
      tx.delete(aRef);
      if(a.logId) tx.update(logDocRef(a.logId),{action:'อนุมัติ',time:new Date().toLocaleString('th-TH'),location:a.type==='in'?STORE_LOCATION:(a.location||''),reviewerUid:state.user.uid,reviewerName:state.profile.displayName||state.profile.username});
    });
    if(!a.logId) await addLog('อนุมัติ',`${a.name} ${a.qty} ${a.unit}`,{productId:a.productId,qty:a.qty,unit:a.unit,moveType:a.type,photo:a.img||'',location:a.type==='in'?STORE_LOCATION:(a.location||'')});
    hideModal(); toast('อนุมัติแล้ว');
  }catch(e){ console.error(e); toast(e?.message||'อนุมัติไม่สำเร็จ'); }
};
window.reject=async(id)=>{ if(!requireManager()) return; const a=state.approvals.find(x=>x.id===id); await deleteDoc(approvalRef(id)); if(a.logId){ await updateDoc(logDocRef(a.logId),{action:'ปฏิเสธ',time:new Date().toLocaleString('th-TH'),location:a.type==='in'?STORE_LOCATION:(a.location||'')}); } else { await addLog('ปฏิเสธ',a.name,{productId:a.productId,moveType:a.type,location:a.type==='in'?STORE_LOCATION:(a.location||'')}); } hideModal(); toast('ปฏิเสธรายการแล้ว'); };
window.editApproval=(id)=>{ if(!requireManager()) return; const a=state.approvals.find(x=>x.id===id); openModal('แก้ไขรายการ',`<input id="aq" type="number" value="${a.qty}"><select id="at" onchange="window.updateApprovalLocation()"><option value="out" ${a.type==='out'?'selected':''}>เบิกออก</option><option value="in" ${a.type==='in'?'selected':''}>รับเข้า</option></select><div id="approvalLocationWrap"></div><button class="btn primary full" onclick="window.saveApproval('${id}')">บันทึก</button>`); window.updateApprovalLocation(); const sel=$('aLoc'); if(a.type==='out' && sel && a.location){ if(LOCATION_OPTIONS.includes(a.location)){ sel.value=a.location; } else { sel.value='อื่นๆ'; $('aLocOther').classList.remove('hidden'); $('aLocOther').value=a.location; } } };
window.updateApprovalLocation=()=>{ const wrap=$('approvalLocationWrap'), type=$('at')?.value; if(!wrap) return; wrap.innerHTML=type==='in' ? `<div class="card" style="margin:8px 0;box-shadow:none;border:1px solid #bbf7d0;background:#f0fdf4"><div class="muted">สถานที่รับเข้าอัตโนมัติ</div><b style="font-size:20px;color:#15803d">📍 ${STORE_LOCATION}</b></div>` : locationFieldHtml('aLoc','aLocOther'); };
window.saveApproval=async(id)=>{ if(!requireManager()) return; const qty=Number($('aq').value)||0; if(qty<=0) return toast('จำนวนไม่ถูกต้อง'); const type=$('at').value; const location=type==='in' ? STORE_LOCATION : getLocationValue('aLoc','aLocOther'); if(type==='out' && !location) return toast('กรุณาเลือกสถานที่เบิก'); await updateDoc(approvalRef(id),{qty,type,location}); await addLog('แก้ไขรายการรอตรวจ',state.approvals.find(x=>x.id===id)?.name||'',{productId:state.approvals.find(x=>x.id===id)?.productId,location,moveType:type}); hideModal(); };
function renderTrash(){
  const items = state.products.filter(p=>p.trashed).sort((a,b)=>{
    const ta=a.trashedAt?.seconds||0, tb=b.trashedAt?.seconds||0; return tb-ta;
  });
  const rows = items.map(p=>`<div class="product"><div><b>${escapeHtml(p.name)}</b><div class="muted">${escapeHtml(p.sku||'-')} • ${p.stock} ${escapeHtml(p.unit||'')}</div></div><div class="row"><button class="btn small green" onclick="window.restoreProduct('${p.id}')">↩️ กู้คืน</button><button class="btn small red" onclick="window.purgeProduct('${p.id}')">🗑️ ลบถาวรจริง</button></div></div>`).join('');
  view.innerHTML = `<div class="between"><h1>🗑️ ถังขยะ</h1><button class="btn small" onclick="window.backToProfile()">← กลับ</button></div><div class="card"><p class="muted" style="margin-top:0">สินค้าที่ลบจะเก็บไว้ที่นี่จนกว่าจะกู้คืนหรือลบถาวรจริงด้วยตัวเอง</p>${rows||'<p class="muted">ถังขยะว่างเปล่า</p>'}</div>`;
}
window.backToProfile=()=>{ state.page='profile'; renderProfile(); };
window.restoreProduct=async(id)=>{ if(!requireManager()) return; const p=state.products.find(x=>x.id===id); await updateDoc(productRef(id),{trashed:false,trashedAt:null}); await addLog('กู้คืนจากถังขยะ',p.name,{productId:id}); toast('กู้คืนแล้ว'); renderTrash(); };
window.purgeProduct=async(id)=>{ const p=state.products.find(x=>x.id===id); const typed=prompt(`ลบ "${p.name}" ถาวร จะกู้คืนไม่ได้อีกเลย\n\nพิมพ์คำว่า "ลบถาวร" เพื่อยืนยัน`); if(typed===null) return; if(typed.trim()!=='ลบถาวร'){ toast('ยกเลิก: ข้อความไม่ตรง'); return; } await deleteDoc(productRef(id)); await addLog('ลบถาวรจริง',p.name); toast('ลบถาวรแล้ว'); renderTrash(); };

function getReportPeriodLogs(){
  const movementLogs = state.logs
    .filter(isStockMovementLog)
    .map(l=>({ ...l, _d:getLogDate(l), _type:isReceiveLog(l)?'in':'out' }))
    .filter(l=>l._d);

  if(state.reportMode==='month'){
    const [y,m] = state.reportMonth.split('-').map(Number);
    return movementLogs.filter(l=> l._d.getFullYear()===y && (l._d.getMonth()+1)===m);
  }
  const [y,m,d] = state.reportDate.split('-').map(Number);
  return movementLogs.filter(l=> l._d.getFullYear()===y && (l._d.getMonth()+1)===m && l._d.getDate()===d);
}

function renderReport(){
  if(!state.reportDate) state.reportDate = toDateStr(new Date());
  if(!state.reportMonth) state.reportMonth = toMonthStr(new Date());
  if(!state.reportFilter) state.reportFilter = 'all';

  const periodLogs = getReportPeriodLogs();
  let periodLabel;
  if(state.reportMode==='month'){
    const [y,m] = state.reportMonth.split('-').map(Number);
    periodLabel = `เดือน ${pad2(m)}/${y}`;
  } else {
    const [y,m,d] = state.reportDate.split('-').map(Number);
    periodLabel = `วันที่ ${pad2(d)}/${pad2(m)}/${y}`;
  }

  const filtered = state.reportFilter==='all' ? periodLogs : periodLogs.filter(l=>l._type===state.reportFilter);
  const receiveLogs = filtered.filter(l=>l._type==='in');
  const withdrawLogs = filtered.filter(l=>l._type==='out');

  function summarize(logs){
    const products={}, units={};
    for(const l of logs){
      const product=state.products.find(p=>p.id===l.productId);
      const name=product?.name || l.detail || 'ไม่ทราบสินค้า';
      const unit=l.unit || product?.unit || '';
      const key=(l.productId||name)+'|'+unit;
      if(!products[key]) products[key]={name,unit,qty:0,tx:0};
      const qty=Number(l.qty)||0;
      products[key].qty+=qty; products[key].tx+=1;
      units[unit]=(units[unit]||0)+qty;
    }
    return {products:Object.values(products).sort((a,b)=>b.qty-a.qty),units,tx:logs.length};
  }
  function unitText(units){ return Object.entries(units).map(([u,q])=>`${q} ${escapeHtml(u||'หน่วย')}`).join(' • ') || '0'; }
  function productRows(items){ return items.map(p=>`<div class="between" style="padding:8px 0;border-bottom:1px solid var(--line)"><span>${escapeHtml(p.name)}</span><b>${p.qty} ${escapeHtml(p.unit||'หน่วย')}</b></div>`).join(''); }

  const receiveSummary=summarize(receiveLogs);
  const receiveCard = receiveLogs.length ? `<div class="card" style="border:1px solid #bbf7d0;cursor:pointer" onclick="window.openReportDetails('in','${STORE_LOCATION}')">
    <div class="between"><div><div class="muted">รับเข้าสินค้า</div><h2 style="margin:2px 0;color:#15803d">📥 ${STORE_LOCATION}</h2></div><button class="pill ok" style="border:0;cursor:pointer" onclick="event.stopPropagation();window.openReportDetails('in','${STORE_LOCATION}')">${receiveSummary.tx} รายการ ›</button></div>
    <div style="margin-top:8px">${productRows(receiveSummary.products)}</div>
    <div class="between" style="margin-top:10px;padding-top:8px;border-top:2px solid #bbf7d0"><span class="muted">รวมรับเข้า</span><b>${unitText(receiveSummary.units)}</b></div>
    <div class="muted" style="margin-top:8px;font-size:13px">แตะเพื่อดูวันที่และจำนวนแต่ละรายการ</div>
  </div>` : (state.reportFilter==='out'?'':`<div class="card" style="text-align:center"><p class="muted" style="margin:0">ไม่มีรายการรับเข้าในช่วงเวลานี้</p></div>`);

  const byLoc={};
  for(const l of withdrawLogs){
    const loc=(l.location||'').trim()||'ไม่ระบุสถานที่';
    if(!byLoc[loc]) byLoc[loc]=[];
    byLoc[loc].push(l);
  }
  const locNames=Object.keys(byLoc).sort((a,b)=>{
    const ia=LOCATION_OPTIONS.indexOf(a), ib=LOCATION_OPTIONS.indexOf(b);
    if(ia===-1&&ib===-1) return a.localeCompare(b); if(ia===-1) return 1; if(ib===-1) return -1; return ia-ib;
  });
  const withdrawCards=locNames.map(loc=>{
    const sm=summarize(byLoc[loc]);
    const safeLoc=encodeURIComponent(loc);
    return `<div class="card" style="border:1px solid #fde68a;cursor:pointer" onclick="window.openReportDetails('out',decodeURIComponent('${safeLoc}'))"><div class="between"><div><div class="muted">เบิกออกไปยัง</div><h2 style="margin:2px 0;color:#b45309">📍 ${escapeHtml(loc)}</h2></div><button class="pill warn" style="border:0;cursor:pointer" onclick="event.stopPropagation();window.openReportDetails('out',decodeURIComponent('${safeLoc}'))">${sm.tx} รายการ ›</button></div><div style="margin-top:8px">${productRows(sm.products)}</div><div class="between" style="margin-top:10px;padding-top:8px;border-top:2px solid #fde68a"><span class="muted">รวมเบิกออก</span><b>${unitText(sm.units)}</b></div><div class="muted" style="margin-top:8px;font-size:13px">แตะเพื่อดูวันที่และจำนวนแต่ละรายการ</div></div>`;
  }).join('') || (state.reportFilter==='in'?'':`<div class="card" style="text-align:center"><p class="muted" style="margin:0">ไม่มีรายการเบิกออกในช่วงเวลานี้</p></div>`);

  const allSummary=summarize(filtered), inSummary=summarize(receiveLogs), outSummary=summarize(withdrawLogs);
  const controls=state.reportMode==='month'
    ? `<div class="row" style="align-items:center;gap:8px"><button class="btn small" onclick="window.reportShiftMonth(-1)">◀</button><input type="month" value="${state.reportMonth}" onchange="window.reportSetMonth(this.value)" style="flex:1"><button class="btn small" onclick="window.reportShiftMonth(1)">▶</button></div>`
    : `<div class="row" style="align-items:center;gap:8px"><button class="btn small" onclick="window.reportShiftDay(-1)">◀</button><input type="date" value="${state.reportDate}" onchange="window.reportSetDate(this.value)" style="flex:1"><button class="btn small" onclick="window.reportShiftDay(1)">▶</button></div>`;

  // เมื่ออยู่หน้ารับเข้า ให้เหลือเฉพาะ ทั้งหมด/รับเข้า
  // เมื่ออยู่หน้าเบิกออก ให้เหลือเฉพาะ ทั้งหมด/เบิกออก
  // หน้า "ทั้งหมด" แสดงทางเลือกครบเพื่อให้เลือกเข้าแต่ละหน้าได้
  const filterButtons = state.reportFilter==='in'
    ? `<button class="btn small light" onclick="window.setReportFilter('all')">ทั้งหมด</button><button class="btn small green" onclick="window.setReportFilter('in')">รับเข้า</button>`
    : state.reportFilter==='out'
      ? `<button class="btn small light" onclick="window.setReportFilter('all')">ทั้งหมด</button><button class="btn small yellow" onclick="window.setReportFilter('out')">เบิกออก</button>`
      : `<button class="btn small primary" onclick="window.setReportFilter('all')">ทั้งหมด</button><button class="btn small light" onclick="window.setReportFilter('in')">รับเข้า</button><button class="btn small light" onclick="window.setReportFilter('out')">เบิกออก</button>`;

  view.innerHTML=`<h1>📊 รายงานสต๊อก</h1>
  <div class="card"><div class="row" style="gap:8px;margin-bottom:10px"><button class="btn small ${state.reportMode==='day'?'primary':'light'}" onclick="window.setReportMode('day')">รายวัน</button><button class="btn small ${state.reportMode==='month'?'primary':'light'}" onclick="window.setReportMode('month')">รายเดือน</button></div>${controls}<div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">${filterButtons}</div></div>
  <div class="card"><h2 style="margin:0">สรุป ${escapeHtml(periodLabel)}</h2><div class="grid" style="margin-top:12px"><div class="stat"><span>ทั้งหมด</span><b>${allSummary.tx}</b><small>${unitText(allSummary.units)}</small></div>${state.reportFilter!=='out'?`<div class="stat"><span>รับเข้า</span><b style="color:#16a34a">${inSummary.tx}</b><small>${unitText(inSummary.units)}</small></div>`:''}${state.reportFilter!=='in'?`<div class="stat"><span>เบิกออก</span><b style="color:#b45309">${outSummary.tx}</b><small>${unitText(outSummary.units)}</small></div>`:''}</div></div>
  ${receiveCard}${withdrawCards}`;
}
window.setReportMode=(mode)=>{ state.reportMode=mode; renderReport(); };
window.setReportFilter=(filter)=>{ state.reportFilter=filter; renderReport(); };
window.reportShiftDay=(delta)=>{ state.reportDate=shiftDateStr(state.reportDate||toDateStr(new Date()),delta); renderReport(); };
window.reportShiftMonth=(delta)=>{ state.reportMonth=shiftMonthStr(state.reportMonth||toMonthStr(new Date()),delta); renderReport(); };
window.reportSetDate=(val)=>{ if(val){ state.reportDate=val; renderReport(); } };
window.reportSetMonth=(val)=>{ if(val){ state.reportMonth=val; renderReport(); } };

window.openReportDetails=(type,location)=>{
  const logs=getReportPeriodLogs()
    .filter(l=>l._type===type)
    .filter(l=> type==='in' || ((l.location||'').trim()||'ไม่ระบุสถานที่')===location)
    .sort((a,b)=>b._d-a._d);

  const grouped={};
  for(const l of logs){
    const product=state.products.find(p=>p.id===l.productId);
    const name=product?.name || l.detail || 'ไม่ทราบสินค้า';
    const unit=l.unit || product?.unit || 'หน่วย';
    const key=(l.productId||name)+'|'+unit;
    if(!grouped[key]) grouped[key]={name,unit,total:0,rows:[]};
    const qty=Number(l.qty)||0;
    grouped[key].total+=qty;
    grouped[key].rows.push({date:l._d,qty});
  }

  const thaiDate=(d)=>d.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'});
  const thaiTime=(d)=>d.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
  const groups=Object.values(grouped).map(g=>`<div class="card" style="box-shadow:none;border:1px solid var(--line);margin:10px 0"><div class="between"><b style="font-size:20px">${escapeHtml(g.name)}</b><b>${g.total} ${escapeHtml(g.unit)}</b></div>${g.rows.map(r=>`<div class="between" style="padding:9px 0;border-bottom:1px solid var(--line)"><span>${thaiDate(r.date)} • ${thaiTime(r.date)}</span><b>${r.qty} ${escapeHtml(g.unit)}</b></div>`).join('')}<div class="between" style="padding-top:10px"><span class="muted">รวมสินค้า</span><b>${g.total} ${escapeHtml(g.unit)}</b></div></div>`).join('');
  const title=type==='in' ? `รายละเอียดรับเข้า — ${STORE_LOCATION}` : `รายละเอียดเบิกออก — ${location}`;
  const period=state.reportMode==='month' ? state.reportMonth : state.reportDate;
  openModal(title,`<p class="muted">ช่วงเวลา: ${escapeHtml(period)} • ${logs.length} รายการ</p>${groups||'<p class="muted">ไม่พบรายละเอียด</p>'}<button class="btn full" onclick="hideModal()">ปิด</button>`);
};

function renderProfile(){
  const trashCount=state.products.filter(p=>p.trashed).length;
  const auditRows = state.logs.map(l=>{ const {label,cls}=logPillInfo(l); return `<div class="log"><span class="pill ${cls}">${escapeHtml(label)}</span><div class="muted" style="margin-top:4px">${escapeHtml(l.time||'')} — ${escapeHtml(l.detail||'')}</div><div class="muted" style="font-size:12px">👤 ${escapeHtml(l.actorName||'ไม่ทราบผู้ใช้')}</div></div>`; }).join('') || '<p class="muted">ยังไม่มี Log</p>';
  view.innerHTML = `<h1>โปรไฟล์</h1>
  <div class="card"><p><b>${escapeHtml(state.profile?.displayName||'')}</b></p><p class="muted">Username: ${escapeHtml(state.profile?.username||'')} • ${escapeHtml(state.profile?.role||'staff')}</p><button class="btn full" onclick="window.openChangePassword()">🔐 เปลี่ยนรหัสผ่าน</button>${state.profile?.role==='admin'?'<button class="btn primary full" onclick="window.manageMembers()">👥 จัดการสมาชิก</button>':''}<button class="btn full" onclick="window.exportBackup()">⬇️ Export Backup JSON</button>${isAdmin()?'<button class="btn full" onclick="window.chooseBackupFile()">⬆️ Import Backup JSON</button><button class="btn red full" onclick="window.resetAccount()">ล้างข้อมูลส่วนกลาง</button>':''}</div>
  <div class="card"><button class="btn light full" onclick="window.viewTrash()">🗑️ ถังขยะ${trashCount?` (${trashCount})`:''}</button></div>
  <div class="card"><h2>Audit Log</h2>${auditRows}</div>`;
}
window.openChangePassword=()=>openModal('เปลี่ยนรหัสผ่าน',`<input id="currentPass" type="password" placeholder="รหัสผ่านปัจจุบัน"><input id="newPass" type="password" placeholder="รหัสผ่านใหม่ อย่างน้อย 6 ตัว"><input id="confirmPass" type="password" placeholder="ยืนยันรหัสผ่านใหม่"><button id="savePasswordBtn" class="btn primary full" onclick="window.saveNewPassword(false)">บันทึก</button>`);
window.openFirstPasswordChange=showFirstPasswordGate;
window.saveNewPassword=async(first)=>{
  const user=auth.currentUser;
  const a=(first ? $('firstNewPass') : $('newPass'))?.value||'', b=(first ? $('firstConfirmPass') : $('confirmPass'))?.value||'';
  const current = first ? DEFAULT_PASSWORD : ($('currentPass')?.value||'');
  if(!user) return toast('ไม่พบการเข้าสู่ระบบ กรุณาออกแล้วเข้าใหม่');
  if(!first && !current) return toast('กรอกรหัสผ่านปัจจุบัน');
  if(a.length<6) return toast('รหัสผ่านอย่างน้อย 6 ตัว');
  if(a!==b) return toast('รหัสผ่านไม่ตรงกัน');
  if(a===DEFAULT_PASSWORD) return toast('กรุณาตั้งรหัสผ่านอื่น');
  const btn=first ? $('firstPasswordBtn') : $('savePasswordBtn');
  if(btn){ btn.disabled=true; btn.textContent='กำลังเปลี่ยนรหัสผ่าน...'; }
  try{
    const credential=EmailAuthProvider.credential(user.email,current);
    await reauthenticateWithCredential(user,credential);
    await updatePassword(user,a);
    try{
      await updateDoc(memberRef(user.uid),{mustChangePassword:false,passwordChangedAt:serverTimestamp()});
    }catch(profileError){
      console.error('เปลี่ยนรหัสผ่านสำเร็จ แต่บันทึกโปรไฟล์ไม่สำเร็จ',profileError);
      toast('รหัสผ่านเปลี่ยนแล้ว กรุณาออกแล้วเข้าใหม่ด้วยรหัสใหม่');
      setTimeout(()=>signOut(auth),1200);
      return;
    }
    state.profile.mustChangePassword=false;
    if(first){
      await enterMainApp();
      toast('ตั้งรหัสผ่านสำเร็จ เข้าสู่ระบบแล้ว');
    }else{
      $('modalCloseBtn').classList.remove('hidden');
      hideModal();
      toast('เปลี่ยนรหัสผ่านแล้ว');
    }
  }catch(e){
    console.error('เปลี่ยนรหัสผ่านไม่สำเร็จ',e);
    const msg = e?.code==='auth/wrong-password' || e?.code==='auth/invalid-credential'
      ? 'รหัสผ่านปัจจุบันไม่ถูกต้อง'
      : e?.code==='auth/weak-password'
        ? 'รหัสผ่านใหม่ยังไม่ปลอดภัยพอ'
        : e?.code==='auth/requires-recent-login'
          ? 'กรุณาออกจากระบบ แล้วเข้าสู่ระบบใหม่ก่อนเปลี่ยนรหัสผ่าน'
          : `เปลี่ยนรหัสผ่านไม่สำเร็จ (${e?.code||'unknown'})`;
    toast(msg);
  }finally{
    if(btn){ btn.disabled=false; btn.textContent=first?'ตั้งรหัสผ่านและเข้าระบบ':'บันทึก'; }
  }
};
window.manageMembers=async()=>{ if(!requireAdmin()) return;
  const snap=await getDocs(collection(fs,'members'));
  state.members=snap.docs.map(d=>({uid:d.id,...d.data()}));
  const rows=state.members.map(m=>`<div class="product"><div><b>${escapeHtml(m.displayName||m.username)}</b><div class="muted">${escapeHtml(m.username)} • ${escapeHtml(m.role||'staff')} • ${m.status==='disabled'?'ปิดใช้งาน':'ใช้งาน'}</div></div></div>`).join('');
  openModal('สมาชิกในทีม',`<p class="note">เวอร์ชันฟรีจัดการบัญชีผ่าน Firebase Console เพื่อความปลอดภัย การเพิ่มสมาชิก: Authentication → Users → Add user แล้วสร้างเอกสาร members/{UID} ใน Firestore</p>${rows||'<p class="muted">ยังไม่มีสมาชิก</p>'}`);
};
window.exportBackup=()=>{
  const clean=(items)=>items.map(({id,...data})=>({id,...data}));
  const data={version:'25.6',workspace:'main',products:clean(state.products),approvals:clean(state.approvals),logs:clean(state.logs),exportedAt:new Date().toISOString(),exportedBy:state.profile?.displayName||state.profile?.username||''};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const a=document.createElement('a'); const url=URL.createObjectURL(blob); a.href=url; a.download=`theview-backup-${toDateStr(new Date())}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.chooseBackupFile=()=>{ if(!requireAdmin()) return; $('backupInput').value=''; $('backupInput').click(); };
async function commitInChunks(ops){
  for(let i=0;i<ops.length;i+=400){ const batch=writeBatch(fs); ops.slice(i,i+400).forEach(op=>batch.set(op.ref,op.data,{merge:true})); await batch.commit(); }
}
$('backupInput')?.addEventListener('change',async e=>{
  const file=e.target.files?.[0]; if(!file||!requireAdmin()) return;
  if(!confirm('นำเข้าข้อมูล Backup และรวมกับข้อมูลปัจจุบันใช่หรือไม่? รายการ ID เดิมจะถูกอัปเดต')) return;
  try{
    const data=JSON.parse(await file.text());
    const groups=['products','approvals','logs']; const ops=[];
    for(const group of groups){
      if(!Array.isArray(data[group])) continue;
      for(const item of data[group]){ const {id,...rest}=item||{}; if(!id) continue; delete rest.createdAt; ops.push({ref:doc(fs,'theviewWorkspaces','main',group,id),data:{...rest,createdAt:serverTimestamp(),importedAt:serverTimestamp(),importedBy:state.user.uid}}); }
    }
    if(!ops.length) throw new Error('ไม่พบข้อมูลที่รองรับในไฟล์');
    await commitInChunks(ops); await addLog('นำเข้า Backup',`${ops.length} รายการ`); toast(`นำเข้าสำเร็จ ${ops.length} รายการ`);
  }catch(err){ console.error(err); toast(err?.message||'นำเข้า Backup ไม่สำเร็จ'); }
});
window.resetAccount=async()=>{ if(!requireAdmin()) return; const typed=prompt('การล้างข้อมูลจะลบสินค้า ประวัติ และรายการทั้งหมดถาวร\nควร Export Backup ก่อน\n\nพิมพ์คำว่า "ลบทั้งหมด" เพื่อยืนยัน'); if(typed===null) return; if(typed.trim()!=='ลบทั้งหมด'){ toast('ยกเลิก: ข้อความไม่ตรง'); return; } try{ for(const c of ['products','approvals','logs']){ const snap=await getDocs(userPath(c)); for(let i=0;i<snap.docs.length;i+=400){ const batch=writeBatch(fs); snap.docs.slice(i,i+400).forEach(d=>batch.delete(d.ref)); await batch.commit(); } } toast('ล้างข้อมูลแล้ว ระบบจะไม่สร้างข้อมูลตัวอย่าง'); }catch(e){ console.error(e); toast('ล้างข้อมูลไม่สำเร็จ'); } };
function openModal(t,b){ $('modalTitle').textContent=t; $('modalBody').innerHTML=b; $('modal').classList.remove('hidden'); } function hideModal(){ if(state.profile?.mustChangePassword) return; $('modal').classList.add('hidden'); }
window.hideModal=hideModal;


// ---------- Modal controls: หลีกเลี่ยงชื่อชนกับ element id บน Safari ----------
$('modal').addEventListener('click',e=>{ if(e.target===$('modal')) hideModal(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && !$('modal').classList.contains('hidden')) hideModal(); });

// ---------- จำตำแหน่งหน้าและ scroll หลังรีเฟรช ----------
let scrollSaveTimer=null;
window.addEventListener('scroll',()=>{
  if($('app').classList.contains('hidden')) return;
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer=setTimeout(()=>localStorage.setItem(LAST_SCROLL_KEY,String(window.scrollY||0)),120);
},{passive:true});

window.addEventListener('error', (event) => {
  if(state.user && view) showLoadError('เกิดข้อผิดพลาดในหน้าเว็บ', event.error || new Error(event.message));
});
window.addEventListener('unhandledrejection', (event) => {
  if(state.user && view) showLoadError('คำสั่งทำงานไม่สำเร็จ', event.reason || new Error('Unhandled promise rejection'));
});

// ลงทะเบียน Service Worker เพื่อให้ใช้งาน offline ได้ (ฟรี ไม่มีค่าใช้จ่าย)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  });
}
