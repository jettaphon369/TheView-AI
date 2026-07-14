import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, addDoc, serverTimestamp, query, orderBy, getDocs, writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fs = getFirestore(app);
setPersistence(auth, browserLocalPersistence).catch(()=>{});

// ---------- จดจำอีเมล/รหัสผ่าน (เก็บในเครื่องนี้เท่านั้น เมื่อผู้ใช้ติ๊ก "จดจำ") ----------
const REMEMBER_KEY='theview_remember_login';
function loadRememberedLogin(){
  try{
    const raw=localStorage.getItem(REMEMBER_KEY);
    if(!raw) return;
    const {email,password}=JSON.parse(raw);
    if(email) $('email').value=email;
    if(password) $('password').value=password;
    $('rememberMe').checked=true;
  }catch(e){}
}
function saveRememberedLogin(email,password){
  try{ localStorage.setItem(REMEMBER_KEY, JSON.stringify({email,password})); }catch(e){}
}
function clearRememberedLogin(){
  try{ localStorage.removeItem(REMEMBER_KEY); }catch(e){}
}
loadRememberedLogin();

const $ = (id)=>document.getElementById(id);
const state = { user:null, page:'home', products:[], approvals:[], logs:[], selectedImage:null, imageMode:null, viewProductId:null, tempMoveImage:null, tempProductImage:null };
const view = $('view');

function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1800); }
function userPath(name){ return collection(fs,'theviewUsers',state.user.uid,name); }
function productRef(id){ return doc(fs,'theviewUsers',state.user.uid,'products',id); }
function approvalRef(id){ return doc(fs,'theviewUsers',state.user.uid,'approvals',id); }
function logDocRef(id){ return doc(fs,'theviewUsers',state.user.uid,'logs',id); }
function logRef(){ return collection(fs,'theviewUsers',state.user.uid,'logs'); }
function escapeHtml(s=''){ return String(s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
async function addLog(action,detail,extra={}){ return addDoc(logRef(),{action,detail,time:new Date().toLocaleString('th-TH'),createdAt:serverTimestamp(),...extra}); }

// ---------- Realtime listeners: ยกเลิกของเดิมก่อนผูกใหม่เสมอ กันปัญหา listener ค้าง/ซ้อนข้ามบัญชี ----------
let unsubProducts=null, unsubApprovals=null, unsubLogs=null;
function bindRealtime(){
  if(unsubProducts) unsubProducts();
  if(unsubApprovals) unsubApprovals();
  if(unsubLogs) unsubLogs();
  unsubProducts = onSnapshot(userPath('products'), snap=>{ state.products=snap.docs.map(d=>({id:d.id,...d.data()})); render(); });
  unsubApprovals = onSnapshot(userPath('approvals'), snap=>{ state.approvals=snap.docs.map(d=>({id:d.id,...d.data()})); render(); });
  unsubLogs = onSnapshot(query(userPath('logs'), orderBy('createdAt','desc')), snap=>{ state.logs=snap.docs.map(d=>({id:d.id,...d.data()})); render(); });
}
function unbindRealtime(){
  if(unsubProducts){ unsubProducts(); unsubProducts=null; }
  if(unsubApprovals){ unsubApprovals(); unsubApprovals=null; }
  if(unsubLogs){ unsubLogs(); unsubLogs=null; }
  state.products=[]; state.approvals=[]; state.logs=[];
}
async function seedIfEmpty(){
  const snap = await getDocs(userPath('products'));
  if(!snap.empty) return;
  const samples = [
    {name:'แก้ว 22 oz', sku:'CUP22', stock:18, unit:'แถว', min:10, archived:false, category:'แก้ว', photo:''},
    {name:'หลอดดำ', sku:'STRAW-BK', stock:42, unit:'แพ็ค', min:15, archived:false, category:'อุปกรณ์', photo:''},
    {name:'ฝาแก้ว', sku:'LID', stock:12, unit:'แถว', min:8, archived:false, category:'ฝา', photo:''}
  ];
  for(const p of samples) await addDoc(userPath('products'),p);
  await addLog('System Seed','สร้างข้อมูลเริ่มต้น');
}

$('loginBtn').onclick=async()=>{
  const email=$('email').value, password=$('password').value;
  try{
    await signInWithEmailAndPassword(auth,email,password);
    if($('rememberMe').checked) saveRememberedLogin(email,password); else clearRememberedLogin();
  }catch(e){ toast('เข้าสู่ระบบไม่ได้: '+e.message); }
};
$('registerBtn').onclick=async()=>{ try{ await createUserWithEmailAndPassword(auth,$('email').value,$('password').value); toast('สมัครสำเร็จ'); }catch(e){ toast('สมัครไม่ได้: '+e.message); }};
$('logoutBtn').onclick=()=>signOut(auth);
$('closeModal').onclick=closeModal;
function goToPage(page){ state.page=page; document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.toggle('active', x.dataset.page===page)); render(); }
window.goToPage=goToPage;
document.querySelectorAll('.bottom-nav button').forEach(b=>b.onclick=()=>goToPage(b.dataset.page));

onAuthStateChanged(auth, async user=>{
  state.user=user;
  $('loginPage').classList.toggle('hidden',!!user);
  $('app').classList.toggle('hidden',!user);
  if(user){ await seedIfEmpty(); bindRealtime(); render(); }
  else{ unbindRealtime(); }
});

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

function render(){ if(!state.user) return; ({home:renderHome,stock:renderStock,scan:renderScan,approval:renderApproval,profile:renderProfile,trash:renderTrash,productDetail:()=>renderProductDetail(state.viewProductId)}[state.page]||renderHome)(); }
function renderHome(){ const active=state.products.filter(p=>!p.archived && !p.trashed); const low=active.filter(p=>Number(p.stock)<=Number(p.min)).length; view.innerHTML=`<h1>หน้าแรก</h1><div class="grid"><div class="stat clickable" onclick="window.goToPage('stock')"><span>สินค้า</span><b>${active.length}</b></div><div class="stat clickable" onclick="window.goToPage('approval')"><span>รอตรวจ</span><b>${state.approvals.length}</b></div><div class="stat clickable" onclick="window.goToPage('stock')"><span>ใกล้หมด</span><b>${low}</b></div><div class="stat clickable" onclick="window.goToPage('profile')"><span>Log</span><b>${state.logs.length}</b></div></div><div class="card"><h2>สถานะระบบ</h2><p>✅ ซิงก์ข้อมูลด้วย Firebase Spark</p><p>✅ ไม่ใช้ Billing / ไม่ใช้ API เสียเงิน</p><p>${low?'⚠️ มีสินค้าใกล้หมด':'✅ สต๊อกปกติ'}</p></div>`; }

function renderStock(){
  const rows = state.products.filter(p=>!p.archived && !p.trashed).map(p=>`<div class="product">
    <div class="row" style="cursor:pointer" onclick="window.viewProduct('${p.id}')">
      ${p.photo?`<img src="${p.photo}" style="width:44px;height:44px;border-radius:12px;object-fit:cover;flex:0 0 auto">`:`<div style="width:44px;height:44px;border-radius:12px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;flex:0 0 auto">📦</div>`}
      <div><b>${escapeHtml(p.name)}</b><div class="muted">${escapeHtml(p.sku||'-')} • ${p.stock} ${escapeHtml(p.unit||'')} • เตือน ${p.min}</div><span class="pill ${Number(p.stock)<=Number(p.min)?'warn':'ok'}">${Number(p.stock)<=Number(p.min)?'ใกล้หมด':'ปกติ'}</span></div>
    </div>
    <div class="row">
      <button class="btn small green" onclick="window.stockMove('${p.id}','in')">รับ</button>
      <button class="btn small yellow" onclick="window.stockMove('${p.id}','out')">เบิก</button>
      <details class="menu"><summary class="btn small">⋮</summary><div class="menu-items">
        <button class="btn small full" onclick="window.viewProduct('${p.id}')">🔍 ดูรายละเอียด</button>
        <button class="btn small full" onclick="window.editProduct('${p.id}')">✏️ แก้ไข</button>
        <button class="btn small full" onclick="window.archiveProduct('${p.id}')">📦 Archive</button>
      </div></details>
    </div>
  </div>`).join('');
  const archivedCount = state.products.filter(p=>p.archived && !p.trashed).length;
  view.innerHTML = `<div class="between"><h1>Stock</h1><button class="btn primary small" onclick="window.addProduct()">+ เพิ่ม</button></div><div class="card">${rows||'<p class="muted">ยังไม่มีสินค้า</p>'}</div>${archivedCount?`<div class="card"><button class="btn light full" onclick="window.showArchived()">📦 ดูรายการที่ Archive แล้ว (${archivedCount})</button></div>`:''}`;
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
window.unarchiveProduct=async(id)=>{ const p=state.products.find(x=>x.id===id); await updateDoc(productRef(id),{archived:false}); await addLog('กู้คืนสินค้า',p.name,{productId:id}); toast('กู้คืนแล้ว'); renderArchived(); };

// ---------- หน้ารายละเอียดสินค้า (รูป + ประวัติรับ/เบิก) ----------
window.viewProduct=(id)=>{ state.viewProductId=id; state.page='productDetail'; renderProductDetail(id); };
function renderProductDetail(id){
  const p = state.products.find(x=>x.id===id);
  if(!p){ renderStock(); return; }
  const history = state.logs.filter(l=>l.productId===id);
  const rows = history.map(l=>{
    const badgeClass = l.action==='เบิกออก' ? 'warn' : (l.action==='รับเข้า'||l.action==='อนุมัติ' ? 'ok' : '');
    return `<div class="log" style="display:flex;gap:10px;align-items:flex-start">
      ${l.photo?`<img src="${l.photo}" style="width:52px;height:52px;border-radius:10px;object-fit:cover;flex:0 0 auto">`:''}
      <div style="flex:1">
        <span class="pill ${badgeClass}">${escapeHtml(l.action)}</span>
        <div style="margin-top:4px">${l.qty?`<b>${l.qty} ${escapeHtml(l.unit||'')}</b> — `:''}${escapeHtml(l.detail||'')}</div>
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
    await addLog('อัปเดตรูปสินค้า',p.name,{productId:id});
    toast('บันทึกรูปแล้ว');
  };
}

window.addProduct=()=>openModal('เพิ่มสินค้า',`
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
`);
window.saveNewProduct=async()=>{ const name=$('pn').value.trim(), sku=$('ps').value.trim(); if(!name) return toast('กรอกชื่อสินค้า'); if(sku && state.products.some(p=>p.sku===sku)) return toast('SKU ซ้ำ'); await addDoc(userPath('products'),{name,sku,category:$('pc').value,unit:$('pu').value||'ชิ้น',stock:Number($('pq').value)||0,min:Number($('pm').value)||0,archived:false,photo:''}); await addLog('เพิ่มสินค้า',name); closeModal(); };
window.editProduct=(id)=>{ const p=state.products.find(x=>x.id===id); openModal('แก้ไขสินค้า',`
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
window.saveEditProduct=async(id)=>{ const p=state.products.find(x=>x.id===id); const sku=$('ps').value.trim(); if(sku && state.products.some(x=>x.id!==id&&x.sku===sku)) return toast('SKU ซ้ำ'); const name=$('pn').value.trim(); await updateDoc(productRef(id),{name,sku,category:$('pc').value,unit:$('pu').value,min:Number($('pm').value)||0}); await addLog('แก้ไขสินค้า',name,{productId:id}); closeModal(); };
window.deleteProduct=async(id)=>{ if(state.approvals.some(a=>a.productId===id)) return toast('มีรายการรอตรวจ ลบไม่ได้'); if(!confirm('ย้ายสินค้านี้ไปถังขยะ? (กู้คืนได้ทีหลังในหน้าโปรไฟล์)'))return; const p=state.products.find(x=>x.id===id); await updateDoc(productRef(id),{trashed:true,trashedAt:serverTimestamp()}); await addLog('ย้ายไปถังขยะ',p.name,{productId:id}); toast('ย้ายไปถังขยะแล้ว กู้คืนได้ในโปรไฟล์'); closeModal(); };
window.archiveProduct=async(id)=>{ if(state.approvals.some(a=>a.productId===id)) return toast('มีรายการรอตรวจ Archive ไม่ได้'); const p=state.products.find(x=>x.id===id); await updateDoc(productRef(id),{archived:true}); await addLog('Archive',p.name,{productId:id}); };

window.stockMove=(id,type)=>{ const p=state.products.find(x=>x.id===id); state.tempMoveImage=null; openModal(type==='in'?'รับเข้า':'เบิกออก',`<p><b>${escapeHtml(p.name)}</b></p><input id="qty" type="number" placeholder="จำนวน"><textarea id="reason" placeholder="เหตุผล/หมายเหตุ"></textarea><input id="movePhotoInput" type="file" accept="image/*" class="hidden"><button class="btn light full" onclick="movePhotoInput.click()">📷 แนบรูป (ไม่บังคับ)</button><div id="movePhotoPreview"></div><button class="btn primary full" onclick="window.applyStock('${id}','${type}')">ยืนยัน</button>`);
  $('movePhotoInput').onchange = async (e)=>{ const f=e.target.files[0]; if(!f) return; state.tempMoveImage = await compressImage(f); $('movePhotoPreview').innerHTML = `<img class="preview" src="${state.tempMoveImage}" style="max-height:160px">`; };
};
window.applyStock=async(id,type)=>{ const p=state.products.find(x=>x.id===id); const q=Number($('qty').value)||0; if(q<=0) return toast('จำนวนไม่ถูกต้อง'); if(type==='out' && q>Number(p.stock)) return toast('เบิกเกินสต๊อก'); const stock = type==='in' ? Number(p.stock)+q : Number(p.stock)-q; await updateDoc(productRef(id),{stock}); const reason=($('reason').value||'').trim(); await addLog(type==='in'?'รับเข้า':'เบิกออก',`${p.name} ${q} ${p.unit}${reason?' • '+reason:''}`,{productId:id,qty:q,unit:p.unit,photo:state.tempMoveImage||''}); state.tempMoveImage=null; closeModal(); };

function renderScan(){ view.innerHTML=`<h1>AI Assist</h1><div class="card"><h2>เลือกรูป</h2><p class="muted">ระบบฟรี: AI Assist จะจับคู่จากฐานข้อมูล/ชื่อเรียกสินค้า ยังไม่ใช้ API เสียเงิน</p><div class="grid"><button class="btn primary" onclick="cameraInput.click()">📷 ถ่ายรูป</button><button class="btn" onclick="photoInput.click()">🖼️ รูปภาพ</button><button class="btn" onclick="fileInput.click()">📁 ไฟล์</button></div>${state.selectedImage?`<img class="preview" src="${state.selectedImage}">`:''}</div><div class="card"><h2>ข้อมูลรายการ</h2><input id="scanText" placeholder="เช่น เบิกแก้ว 22 oz 2 แถว"><select id="scanProduct"><option value="">เลือกสินค้า</option>${state.products.filter(p=>!p.archived && !p.trashed).map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</select><input id="scanQty" type="number" placeholder="จำนวน"><select id="scanType"><option value="out">เบิกออก</option><option value="in">รับเข้า</option></select><button class="btn light full" onclick="window.freeAssist()">ช่วยจับคู่จากข้อความ</button><button class="btn primary full" onclick="window.sendApproval()">ส่งเข้าคิวตรวจ</button></div>`; }
['cameraInput','photoInput','fileInput'].forEach(id=>$(id).onchange=async e=>{ const f=e.target.files[0]; if(!f) return; state.selectedImage = await compressImage(f); e.target.value=''; renderScan(); toast('เลือกรูปแล้ว (บีบอัดอัตโนมัติ)'); });
window.freeAssist=()=>{ const text=($('scanText').value||'').toLowerCase(); let found=state.products.find(p=>text.includes((p.name||'').toLowerCase()) || (p.sku&&text.includes(p.sku.toLowerCase())) || (text.includes('แก้ว')&&p.name.includes('แก้ว'))); if(found) $('scanProduct').value=found.id; const nums=[...text.matchAll(/\d+/g)].map(x=>Number(x[0])); if(nums.length) $('scanQty').value=nums[nums.length-1]; toast(found?'จับคู่สินค้าให้แล้ว':'ยังไม่พบสินค้าในฐานข้อมูล'); };
// ส่งตรวจ: เก็บ logId ไว้ในตัว approval เพื่อไปอัปเดตสถานะ log เดิมตอนอนุมัติ/ปฏิเสธ แทนการสร้าง log ใหม่ซ้ำซ้อน
window.sendApproval=async()=>{ const productId=$('scanProduct').value; const qty=Number($('scanQty').value)||0; const type=$('scanType').value; if(!productId) return toast('เลือกสินค้าก่อน'); if(qty<=0) return toast('กรอกจำนวน'); const p=state.products.find(x=>x.id===productId); if(type==='out' && qty>Number(p.stock)) return toast('เบิกเกินสต๊อก'); const logDoc = await addLog('ส่งตรวจ',`${type==='out'?'เบิก':'รับ'} ${p.name} ${qty} ${p.unit}`,{productId,qty,unit:p.unit,photo:state.selectedImage||''}); await addDoc(userPath('approvals'),{productId,name:p.name,qty,unit:p.unit,type,img:state.selectedImage||'',confidence:state.selectedImage?60:0,status:'pending',logId:logDoc.id,createdAt:serverTimestamp()}); state.selectedImage=null; renderScan(); toast('ส่งเข้าคิวตรวจแล้ว'); };
function renderApproval(){ view.innerHTML=`<h1>Approval</h1>${state.approvals.map(a=>`<div class="card"><div class="between"><div><h2>${escapeHtml(a.name)}</h2><p class="muted">${a.type==='out'?'เบิกออก':'รับเข้า'} • ${a.qty} ${escapeHtml(a.unit||'')}</p></div><span class="pill warn">รอตรวจ</span></div>${a.img?`<img class="preview" src="${a.img}">`:''}<div class="row"><button class="btn green" onclick="window.approve('${a.id}')">อนุมัติ</button><button class="btn" onclick="window.editApproval('${a.id}')">แก้ไข</button><button class="btn red" onclick="window.reject('${a.id}')">ปฏิเสธ</button></div></div>`).join('')||'<div class="card" style="text-align:center"><p style="font-size:40px;margin:0 0 6px">✅</p><p class="muted" style="margin:0">ไม่มีงานค้าง ทุกอย่างเรียบร้อย</p></div>'}`; }
window.approve=async(id)=>{ const a=state.approvals.find(x=>x.id===id); const p=state.products.find(x=>x.id===a.productId); if(!p) return toast('ไม่พบสินค้า'); if(a.type==='out' && Number(a.qty)>Number(p.stock)) return toast('เบิกเกินสต๊อก'); const stock=a.type==='out'?Number(p.stock)-Number(a.qty):Number(p.stock)+Number(a.qty); await updateDoc(productRef(p.id),{stock}); await deleteDoc(approvalRef(id)); if(a.logId){ await updateDoc(logDocRef(a.logId),{action:'อนุมัติ',time:new Date().toLocaleString('th-TH')}); } else { await addLog('อนุมัติ',`${a.name} ${a.qty} ${a.unit}`,{productId:a.productId,qty:a.qty,unit:a.unit,moveType:a.type,photo:a.img||''}); } };
window.reject=async(id)=>{ const a=state.approvals.find(x=>x.id===id); await deleteDoc(approvalRef(id)); if(a.logId){ await updateDoc(logDocRef(a.logId),{action:'ปฏิเสธ',time:new Date().toLocaleString('th-TH')}); } else { await addLog('ปฏิเสธ',a.name,{productId:a.productId}); } };
window.editApproval=(id)=>{ const a=state.approvals.find(x=>x.id===id); openModal('แก้ไขรายการ',`<input id="aq" type="number" value="${a.qty}"><select id="at"><option value="out" ${a.type==='out'?'selected':''}>เบิกออก</option><option value="in" ${a.type==='in'?'selected':''}>รับเข้า</option></select><button class="btn primary full" onclick="window.saveApproval('${id}')">บันทึก</button>`); };
window.saveApproval=async(id)=>{ const qty=Number($('aq').value)||0; if(qty<=0) return toast('จำนวนไม่ถูกต้อง'); const type=$('at').value; await updateDoc(approvalRef(id),{qty,type}); await addLog('แก้ไขรายการรอตรวจ',state.approvals.find(x=>x.id===id)?.name||'',{productId:state.approvals.find(x=>x.id===id)?.productId}); closeModal(); };
function renderTrash(){
  const items = state.products.filter(p=>p.trashed).sort((a,b)=>{
    const ta=a.trashedAt?.seconds||0, tb=b.trashedAt?.seconds||0; return tb-ta;
  });
  const rows = items.map(p=>`<div class="product"><div><b>${escapeHtml(p.name)}</b><div class="muted">${escapeHtml(p.sku||'-')} • ${p.stock} ${escapeHtml(p.unit||'')}</div></div><div class="row"><button class="btn small green" onclick="window.restoreProduct('${p.id}')">↩️ กู้คืน</button><button class="btn small red" onclick="window.purgeProduct('${p.id}')">🗑️ ลบถาวรจริง</button></div></div>`).join('');
  view.innerHTML = `<div class="between"><h1>🗑️ ถังขยะ</h1><button class="btn small" onclick="window.backToProfile()">← กลับ</button></div><div class="card"><p class="muted" style="margin-top:0">สินค้าที่ลบจะเก็บไว้ที่นี่จนกว่าจะกู้คืนหรือลบถาวรจริงด้วยตัวเอง</p>${rows||'<p class="muted">ถังขยะว่างเปล่า</p>'}</div>`;
}
window.backToProfile=()=>{ state.page='profile'; renderProfile(); };
window.restoreProduct=async(id)=>{ const p=state.products.find(x=>x.id===id); await updateDoc(productRef(id),{trashed:false,trashedAt:null}); await addLog('กู้คืนจากถังขยะ',p.name,{productId:id}); toast('กู้คืนแล้ว'); renderTrash(); };
window.purgeProduct=async(id)=>{ const p=state.products.find(x=>x.id===id); const typed=prompt(`ลบ "${p.name}" ถาวร จะกู้คืนไม่ได้อีกเลย\n\nพิมพ์คำว่า "ลบถาวร" เพื่อยืนยัน`); if(typed===null) return; if(typed.trim()!=='ลบถาวร'){ toast('ยกเลิก: ข้อความไม่ตรง'); return; } await deleteDoc(productRef(id)); await addLog('ลบถาวรจริง',p.name); toast('ลบถาวรแล้ว'); renderTrash(); };

function renderProfile(){ const trashCount=state.products.filter(p=>p.trashed).length; view.innerHTML=`<h1>โปรไฟล์</h1><div class="card"><p><b>${escapeHtml(state.user.email)}</b></p><button class="btn full" onclick="window.exportBackup()">Export Backup JSON</button></div><div class="card"><button class="btn light full" onclick="window.viewTrash()">🗑️ ถังขยะ${trashCount?` (${trashCount})`:''}</button></div><div class="card"><p class="muted" style="margin-top:0">⚠️ การล้างข้อมูลจะลบสินค้า ประวัติ และรายการทั้งหมดถาวร กู้คืนไม่ได้</p><button class="btn red full" onclick="window.resetAccount()">ล้างข้อมูลบัญชีนี้</button></div><div class="card"><h2>Audit Log</h2>${state.logs.map(l=>`<div class="log"><b>${escapeHtml(l.action)}</b><br><span class="muted">${escapeHtml(l.time||'')} — ${escapeHtml(l.detail||'')}</span></div>`).join('')||'<p class="muted">ยังไม่มี Log</p>'}</div>`; }
window.viewTrash=()=>{ state.page='trash'; renderTrash(); };
window.exportBackup=()=>{ const data={products:state.products,approvals:state.approvals,logs:state.logs,exportedAt:new Date().toISOString()}; const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='theview-ai-firebase-backup.json'; a.click(); };
window.resetAccount=async()=>{ const typed=prompt('การล้างข้อมูลจะลบสินค้า ประวัติ และรายการทั้งหมดถาวร กู้คืนไม่ได้\n\nพิมพ์คำว่า "ลบทั้งหมด" เพื่อยืนยัน'); if(typed===null) return; if(typed.trim()!=='ลบทั้งหมด'){ toast('ยกเลิก: ข้อความไม่ตรง ไม่ได้ลบข้อมูล'); return; } const batch=writeBatch(fs); for(const c of ['products','approvals','logs']){ const snap=await getDocs(userPath(c)); snap.docs.forEach(d=>batch.delete(d.ref)); } await batch.commit(); await seedIfEmpty(); toast('ล้างข้อมูลแล้ว'); };
function openModal(t,b){ $('modalTitle').textContent=t; $('modalBody').innerHTML=b; $('modal').classList.remove('hidden'); } function closeModal(){ $('modal').classList.add('hidden'); }

// ลงทะเบียน Service Worker เพื่อให้ใช้งาน offline ได้ (ฟรี ไม่มีค่าใช้จ่าย)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  });
}
