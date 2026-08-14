import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence, inMemoryPersistence, updatePassword, createUserWithEmailAndPassword, deleteUser, reauthenticateWithCredential, EmailAuthProvider } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, waitForPendingWrites, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, addDoc, serverTimestamp, Timestamp, query, where, orderBy, limit, startAfter, getDocs, getDocsFromServer, getDoc, writeBatch, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { getStorage, ref as storageRef, uploadString, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js';

const APP_ENV='MAIN';
const EXPECTED_FIREBASE_PROJECT='theview-4d389';
if(firebaseConfig.projectId!==EXPECTED_FIREBASE_PROJECT){
  document.documentElement.innerHTML=`<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Environment blocked</title></head><body style="font-family:system-ui;padding:24px;background:#fff7f7;color:#7f1d1d"><h2>⛔ บล็อกการเชื่อมต่อ Firebase ผิดระบบ</h2><p>เว็บนี้เป็น <b>${APP_ENV}</b> แต่ firebaseConfig ชี้ไป <code>${firebaseConfig.projectId||'-'}</code></p><p>ระบบหยุดก่อนอ่านหรือเขียนข้อมูลเพื่อป้องกันข้อมูลระหว่างระบบปะปนกัน</p></body>`;
  throw new Error(`[TheView Stock] Firebase project mismatch: expected ${EXPECTED_FIREBASE_PROJECT}, got ${firebaseConfig.projectId}`);
}
const STORAGE_NAMESPACE=`theview:${EXPECTED_FIREBASE_PROJECT}`;
const storageKey=(name)=>`${STORAGE_NAMESPACE}:${name}`;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Secondary Auth instance สำหรับ Admin สร้างบัญชีพนักงานใหม่โดยไม่ทำให้ Admin หลุดจากระบบ
const memberCreateApp = initializeApp(firebaseConfig, `${APP_ENV}-member-create`);
const memberCreateAuth = getAuth(memberCreateApp);
// เปิด Firestore Offline Persistence: อ่านข้อมูลล่าสุดจากเครื่องและคิวการเขียนไว้เมื่อเน็ตหลุด
const fs = initializeFirestore(app,{
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const storage = getStorage(app);
const authPersistenceReady = setPersistence(auth, browserLocalPersistence).catch(err=>{ console.warn('[TheView Stock] auth persistence fallback', err); });
setPersistence(memberCreateAuth, inMemoryPersistence).catch(()=>{});

// ---------- ระบบ Username ภายในทีม ----------
const USERNAME_DOMAIN='theview.local';
const DEFAULT_PASSWORD='chartered';

const BRANDING_DOC_ID='appBranding';
const BRANDING_CACHE_KEY=storageKey('systemBrandingCache');
const DASHBOARD_SECTION_CARDS=['priority','stats','chart','topUsed','alerts'];
const DASHBOARD_STAT_CARDS=['statIn','statOut','statProducts','statLow','statExpiry'];
const DASHBOARD_CARD_LABELS={priority:'รายการรออนุมัติ',stats:'สรุปตัวเลข',chart:'กราฟ 7 วันล่าสุด',topUsed:'เบิกมากที่สุด',alerts:'แจ้งเตือนสินค้า',statIn:'รับเข้าวันนี้',statOut:'เบิกออกวันนี้',statProducts:'สินค้าทั้งหมด',statLow:'สต๊อกใกล้หมด',statExpiry:'ใกล้หมดอายุ'};

const BRANDING_SAMPLE_LIBRARY={
  systemNames:['CHEE CHAN STOCK','F&B STOCK','KITCHEN STOCK','ENGINEERING STOCK','HOUSEKEEPING STOCK','MAINTENANCE STOCK'],
  subtitles:['Food & Beverage Inventory Management','Kitchen Inventory & Production Stock','Tools & Spare Parts Management','Linen & Amenity Inventory','Maintenance Material Control','Central Stock Control System'],
  loginWelcome:['เข้าสู่ระบบ','ยินดีต้อนรับเข้าสู่ระบบ','เข้าสู่ระบบจัดการสต๊อก','ระบบสต๊อกภายในองค์กร','Inventory Login'],
  loginStatus:['ระบบพร้อมใช้งาน','สำหรับพนักงานที่ได้รับสิทธิ์เท่านั้น','กรุณาเข้าสู่ระบบด้วย Username ที่ได้รับ','ตรวจสอบรายการสต๊อกก่อนบันทึกทุกครั้ง','บันทึก รับเข้า เบิกออก และตรวจสอบ LOT ได้จากระบบนี้']
};
const BRANDING_QUICK_PRESETS={
  fb:{label:'F&B',hint:'เหมาะกับเครื่องดื่ม/อาหาร',systemName:'F&B STOCK',systemSubtitle:'Food & Beverage Inventory Management',loginWelcomeText:'เข้าสู่ระบบ F&B Stock',loginStatusText:'จัดการรับเข้า เบิกออก LOT และรายงานสต๊อก F&B',themeName:'green-gold',loginLayout:'modern',loginPattern:'curves',dashboardTextSize:'normal',dashboardCardSize:'standard',dashboardCardOrder:['priority','stats','alerts','chart','topUsed'],dashboardStatOrder:['statIn','statOut','statLow','statExpiry','statProducts'],dashboardHiddenCards:[]},
  kitchen:{label:'Kitchen',hint:'เหมาะกับครัว/วัตถุดิบ',systemName:'KITCHEN STOCK',systemSubtitle:'Kitchen Inventory & Production Stock',loginWelcomeText:'เข้าสู่ระบบครัว',loginStatusText:'ตรวจสอบวัตถุดิบ รับเข้า เบิกออก และ LOT ก่อนใช้งาน',themeName:'white-green',loginLayout:'modern',loginPattern:'soft',dashboardTextSize:'large',dashboardCardSize:'standard',dashboardCardOrder:['alerts','priority','stats','topUsed','chart'],dashboardStatOrder:['statLow','statExpiry','statOut','statIn','statProducts'],dashboardHiddenCards:[]},
  engineering:{label:'Engineering',hint:'เหมาะกับอะไหล่/เครื่องมือ',systemName:'ENGINEERING STOCK',systemSubtitle:'Tools & Spare Parts Management',loginWelcomeText:'เข้าสู่ระบบแผนกช่าง',loginStatusText:'ควบคุมอะไหล่ เครื่องมือ และการเบิกใช้งานภายในแผนก',themeName:'blue-gold',loginLayout:'compact',loginPattern:'clean',dashboardTextSize:'normal',dashboardCardSize:'compact',dashboardCardOrder:['priority','stats','alerts','topUsed','chart'],dashboardStatOrder:['statProducts','statLow','statOut','statIn','statExpiry'],dashboardHiddenCards:['chart']},
  housekeeping:{label:'Housekeeping',hint:'เหมาะกับ Linen/Amenity',systemName:'HOUSEKEEPING STOCK',systemSubtitle:'Linen & Amenity Inventory',loginWelcomeText:'เข้าสู่ระบบ Housekeeping',loginStatusText:'ควบคุมผ้า Amenity และอุปกรณ์ประจำวัน',themeName:'burgundy-gold',loginLayout:'classic',loginPattern:'photo',dashboardTextSize:'large',dashboardCardSize:'large',dashboardCardOrder:['stats','priority','alerts','topUsed','chart'],dashboardStatOrder:['statOut','statLow','statProducts','statIn','statExpiry'],dashboardHiddenCards:['chart']},
  clean:{label:'เรียบง่าย',hint:'เน้นอ่านง่ายบนมือถือ',systemName:'CHEE CHAN STOCK',systemSubtitle:'Inventory Management System',loginWelcomeText:'เข้าสู่ระบบ',loginStatusText:'ระบบพร้อมใช้งาน',themeName:'green-gold',loginLayout:'compact',loginPattern:'clean',dashboardTextSize:'large',dashboardCardSize:'standard',dashboardCardOrder:['priority','stats','alerts','chart','topUsed'],dashboardStatOrder:['statIn','statOut','statLow','statExpiry','statProducts'],dashboardHiddenCards:['chart','topUsed']}
};

// ---------- Admin Stock Card UI Settings (v34.28.15) ----------
const STOCK_CARD_UI_DEFAULT={
  nameSize:'normal',
  countSize:'normal',
  metaSize:'normal',
  imageSize:'normal',
  density:'normal',
  nameLines:'2',
  locationLines:'2',
  statusPosition:'aboveCount'
};
const STOCK_CARD_UI_LABELS={
  nameSize:{small:'เล็ก',normal:'ปกติ',large:'ใหญ่',xl:'ใหญ่มาก'},
  countSize:{small:'ปกติ',normal:'ใหญ่',large:'ใหญ่มาก',xl:'ใหญ่พิเศษ'},
  metaSize:{small:'เล็ก',normal:'ปกติ',large:'ใหญ่'},
  imageSize:{small:'กะทัดรัด',normal:'ปกติ',large:'ใหญ่'},
  density:{compact:'กระชับ',normal:'ปกติ',airy:'โปร่ง'},
  nameLines:{'1':'1 บรรทัด','2':'2 บรรทัด'},
  locationLines:{'1':'1 บรรทัด','2':'2 บรรทัด'},
  statusPosition:{withName:'ข้างชื่อสินค้า',aboveCount:'เหนือจำนวน'}
};
const STOCK_CARD_UI_ALLOWED={
  nameSize:['small','normal','large','xl'],
  countSize:['small','normal','large','xl'],
  metaSize:['small','normal','large'],
  imageSize:['small','normal','large'],
  density:['compact','normal','airy'],
  nameLines:['1','2'],
  locationLines:['1','2'],
  statusPosition:['withName','aboveCount']
};
const STOCK_CARD_UI_SIZE_MAP={
  nameSize:{small:[22,21,19],normal:[24,23,21],large:[26,25,23],xl:[28,27,24]},
  countSize:{small:[52,48,42],normal:[58,54,46],large:[64,60,52],xl:[70,66,58]},
  metaSize:{small:[12,11,10.5],normal:[13,12,11],large:[14,13,12]},
  imageSize:{
    small:{desktop:[82,78,86,104],mobile:[76,74,82,96],small:[68,66,74,82]},
    normal:{desktop:[92,88,96,112],mobile:[82,80,88,104],small:[74,72,80,88]},
    large:{desktop:[104,100,108,122],mobile:[92,90,98,112],small:[82,80,88,96]}
  },
  density:{
    compact:{desktop:['152px','13px 13px 13px 18px','11px'],mobile:['146px','12px 11px 12px 16px','10px'],small:['140px','11px 9px 11px 15px','8px']},
    normal:{desktop:['164px','16px 15px 16px 20px','14px'],mobile:['156px','13px 12px 13px 17px','11px'],small:['148px','12px 10px 12px 16px','9px']},
    airy:{desktop:['178px','19px 17px 19px 22px','16px'],mobile:['168px','15px 13px 15px 18px','13px'],small:['158px','13px 11px 13px 16px','10px']}
  }
};
function stockCardUiChoice(value,allowed,fallback){ const v=String(value ?? fallback ?? '').trim(); return allowed.includes(v)?v:fallback; }
function normalizeStockCardUi(raw={}){
  const source=raw&&typeof raw==='object'?raw:{};
  return {
    nameSize:stockCardUiChoice(source.nameSize,STOCK_CARD_UI_ALLOWED.nameSize,STOCK_CARD_UI_DEFAULT.nameSize),
    countSize:stockCardUiChoice(source.countSize,STOCK_CARD_UI_ALLOWED.countSize,STOCK_CARD_UI_DEFAULT.countSize),
    metaSize:stockCardUiChoice(source.metaSize,STOCK_CARD_UI_ALLOWED.metaSize,STOCK_CARD_UI_DEFAULT.metaSize),
    imageSize:stockCardUiChoice(source.imageSize,STOCK_CARD_UI_ALLOWED.imageSize,STOCK_CARD_UI_DEFAULT.imageSize),
    density:stockCardUiChoice(source.density,STOCK_CARD_UI_ALLOWED.density,STOCK_CARD_UI_DEFAULT.density),
    nameLines:stockCardUiChoice(source.nameLines,STOCK_CARD_UI_ALLOWED.nameLines,STOCK_CARD_UI_DEFAULT.nameLines),
    locationLines:stockCardUiChoice(source.locationLines,STOCK_CARD_UI_ALLOWED.locationLines,STOCK_CARD_UI_DEFAULT.locationLines),
    statusPosition:stockCardUiChoice(source.statusPosition,STOCK_CARD_UI_ALLOWED.statusPosition,STOCK_CARD_UI_DEFAULT.statusPosition)
  };
}
function stockCardUiVars(uiInput={}){
  const ui=normalizeStockCardUi(uiInput);
  const name=STOCK_CARD_UI_SIZE_MAP.nameSize[ui.nameSize];
  const count=STOCK_CARD_UI_SIZE_MAP.countSize[ui.countSize];
  const meta=STOCK_CARD_UI_SIZE_MAP.metaSize[ui.metaSize];
  const img=STOCK_CARD_UI_SIZE_MAP.imageSize[ui.imageSize];
  const density=STOCK_CARD_UI_SIZE_MAP.density[ui.density];
  const px=v=>`${v}px`;
  return {
    '--stock-card-name-font':px(name[0]),'--stock-card-name-font-mobile':px(name[1]),'--stock-card-name-font-small':px(name[2]),
    '--stock-card-count-font':px(count[0]),'--stock-card-count-font-mobile':px(count[1]),'--stock-card-count-font-small':px(count[2]),
    '--stock-card-meta-font':px(meta[0]),'--stock-card-meta-font-mobile':px(meta[1]),'--stock-card-meta-font-small':px(meta[2]),
    '--stock-card-photo-col':px(img.desktop[0]),'--stock-card-photo-w':px(img.desktop[1]),'--stock-card-photo-h':px(img.desktop[2]),'--stock-card-side-col':px(img.desktop[3]),
    '--stock-card-photo-col-mobile':px(img.mobile[0]),'--stock-card-photo-w-mobile':px(img.mobile[1]),'--stock-card-photo-h-mobile':px(img.mobile[2]),'--stock-card-side-col-mobile':px(img.mobile[3]),
    '--stock-card-photo-col-small':px(img.small[0]),'--stock-card-photo-w-small':px(img.small[1]),'--stock-card-photo-h-small':px(img.small[2]),'--stock-card-side-col-small':px(img.small[3]),
    '--stock-card-min-height':density.desktop[0],'--stock-card-padding':density.desktop[1],'--stock-card-gap':density.desktop[2],
    '--stock-card-min-height-mobile':density.mobile[0],'--stock-card-padding-mobile':density.mobile[1],'--stock-card-gap-mobile':density.mobile[2],
    '--stock-card-min-height-small':density.small[0],'--stock-card-padding-small':density.small[1],'--stock-card-gap-small':density.small[2],
    '--stock-card-name-lines':ui.nameLines,'--stock-card-location-lines':ui.locationLines
  };
}

function stockCardStatusAboveCount(){
  try{ return normalizeStockCardUi(state.stockCardUi||state.branding?.stockCardUi||{}).statusPosition==='aboveCount'; }
  catch(_){ return STOCK_CARD_UI_DEFAULT.statusPosition==='aboveCount'; }
}

function applyStockCardUi(raw={}){
  const ui=normalizeStockCardUi(raw);
  const root=document.documentElement;
  Object.entries(stockCardUiVars(ui)).forEach(([k,v])=>root.style.setProperty(k,v));
  if(document.body){
    document.body.dataset.stockCardNameSize=ui.nameSize;
    document.body.dataset.stockCardCountSize=ui.countSize;
    document.body.dataset.stockCardMetaSize=ui.metaSize;
    document.body.dataset.stockCardImageSize=ui.imageSize;
    document.body.dataset.stockCardDensity=ui.density;
    document.body.dataset.stockCardStatusPosition=ui.statusPosition;
  }
  try{ if(typeof state!=='undefined') state.stockCardUi=ui; }catch(_){ }
  return ui;
}

const DEFAULT_BRANDING={
  systemName:'CHEE CHAN STOCK',
  systemSubtitle:'Food & Beverage Inventory Management',
  logoUrl:'chee-chan-logo.png',
  themeName:'green-gold',
  primaryColor:'#006b4f',
  secondaryColor:'#004c39',
  accentColor:'#d8b36a',
  backgroundColor:'#f7f4ed',
  cardColor:'#fffdf8',
  textColor:'#24352f',
  loginWelcomeText:'เข้าสู่ระบบ',
  loginStatusText:'ระบบพร้อมใช้งาน',
  loginLayout:'modern',
  loginPattern:'curves',
  dashboardTextSize:'normal',
  dashboardCardSize:'standard',
  dashboardCardOrder:['priority','stats','chart','topUsed','alerts'],
  dashboardStatOrder:['statIn','statOut','statProducts','statLow','statExpiry'],
  dashboardHiddenCards:[],
  desktopLoginTitleSize:'large',
  desktopLoginSubtitleSize:'large',
  desktopLoginLogoSize:'large',
  desktopLoginFormSize:'normal',
  desktopLoginPanelWidth:'balanced',
  mobileLoginTitleSize:'normal',
  mobileLoginSubtitleSize:'normal',
  mobileLoginLogoSize:'normal',
  mobileLoginPhotoHeight:'normal',
  stockCardUi: STOCK_CARD_UI_DEFAULT
};
const THEME_PRESETS={
  'green-gold':{label:'เขียวทอง',primaryColor:'#006b4f',secondaryColor:'#004c39',accentColor:'#d8b36a',backgroundColor:'#f7f4ed',cardColor:'#fffdf8',textColor:'#24352f'},
  'blue-gold':{label:'น้ำเงินทอง',primaryColor:'#174ea6',secondaryColor:'#0b2f6b',accentColor:'#d8b36a',backgroundColor:'#f4f7fb',cardColor:'#ffffff',textColor:'#172033'},
  'black-gold':{label:'ดำทอง',primaryColor:'#2d2a26',secondaryColor:'#111827',accentColor:'#d8b36a',backgroundColor:'#f4efe6',cardColor:'#fffdf8',textColor:'#1f2937'},
  'white-green':{label:'ขาวเขียว',primaryColor:'#0f7a5a',secondaryColor:'#07543f',accentColor:'#8bbf9f',backgroundColor:'#f8fffb',cardColor:'#ffffff',textColor:'#17342b'},
  'burgundy-gold':{label:'แดงไวน์ทอง',primaryColor:'#7f1d1d',secondaryColor:'#4c0d0d',accentColor:'#d8b36a',backgroundColor:'#fbf4ef',cardColor:'#fffaf5',textColor:'#2f1f1f'},
  'custom':{label:'กำหนดเอง'}
};



// ---------- Stock Group & Area Structure (v34.27.0) ----------
const STOCK_STRUCTURE_FIELD='stockStructure';
const DEFAULT_STOCK_GROUP_ID='fb-stock';
const DEFAULT_STOCK_AREA_ID='legacy-stock';
const DEFAULT_ISSUE_DESTINATIONS=['TheView','Kiosk6','Kiosk15','InOut','DV','อื่นๆ'];
function normalizeIssueDestinationList(raw=[]){
  const source=Array.isArray(raw)?raw:String(raw||'').split(/\n|,/);
  const seen=new Set();
  const list=[];
  source.forEach(item=>{
    const name=String(item||'').trim();
    if(!name) return;
    const key=name.toLowerCase().replace(/\s+/g,'');
    if(seen.has(key)) return;
    seen.add(key);
    list.push(name);
  });
  if(!list.some(x=>x==='อื่นๆ')) list.push('อื่นๆ');
  return list.length?list:[...DEFAULT_ISSUE_DESTINATIONS];
}
function issueDestinationTextToList(text=''){
  return normalizeIssueDestinationList(String(text||'').split(/\r?\n/));
}
function issueDestinationsForGroup(groupId=''){
  try{
    const structure=currentStockStructure();
    const groups=structure.groups||[];
    const group=groups.find(g=>String(g.id||'')===String(groupId||'')) || groups[0] || null;
    return normalizeIssueDestinationList(group?.issueDestinations||DEFAULT_ISSUE_DESTINATIONS);
  }catch(_){
    return normalizeIssueDestinationList(DEFAULT_ISSUE_DESTINATIONS);
  }
}
const DEFAULT_STOCK_STRUCTURE={
  version:1,
  groups:[{
    id:DEFAULT_STOCK_GROUP_ID,
    name:'F&B Stock',
    status:'active',
    sort:1,
    areas:[{id:DEFAULT_STOCK_AREA_ID,name:'สต๊อกเดิม',status:'active',sort:1}]
  }]
};
function makeStockStructureId(label,prefix='area'){
  const raw=String(label||'').trim().toLowerCase();
  const slug=raw.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9ก-๙]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,36);
  return `${prefix}-${slug||Date.now().toString(36)}`;
}
function normalizeStockStructure(raw={}){
  const source=(raw && Array.isArray(raw.groups))?raw:DEFAULT_STOCK_STRUCTURE;
  const seenGroups=new Set();
  const groups=[];
  source.groups.forEach((group,index)=>{
    let id=String(group?.id||'').trim()||makeStockStructureId(group?.name||`group-${index+1}`,'group');
    if(seenGroups.has(id)) id=`${id}-${index+1}`;
    seenGroups.add(id);
    const seenAreas=new Set();
    const areas=[];
    const rawAreas=Array.isArray(group?.areas)?group.areas:[];
    rawAreas.forEach((area,areaIndex)=>{
      let areaId=String(area?.id||'').trim()||makeStockStructureId(area?.name||`area-${areaIndex+1}`,'area');
      if(seenAreas.has(areaId)) areaId=`${areaId}-${areaIndex+1}`;
      seenAreas.add(areaId);
      const name=String(area?.name||'').trim()||`พื้นที่ ${areaIndex+1}`;
      areas.push({id:areaId,name,status:area?.status==='inactive'?'inactive':'active',sort:Number(area?.sort)||areaIndex+1});
    });
    // v34.27.6: ไม่สร้างพื้นที่ “สต๊อกเดิม” อัตโนมัติให้กลุ่มใหม่แล้ว ให้ Admin สร้างพื้นที่จริงเอง
    const issueDestinations=normalizeIssueDestinationList(group?.issueDestinations||DEFAULT_ISSUE_DESTINATIONS);
    groups.push({id,name:String(group?.name||'').trim()||`กลุ่มสต๊อก ${index+1}`,status:group?.status==='inactive'?'inactive':'active',sort:Number(group?.sort)||index+1,issueDestinations,areas:areas.sort((a,b)=>(a.sort||0)-(b.sort||0)||String(a.name).localeCompare(String(b.name),'th'))});
  });
  if(!groups.length) return normalizeStockStructure(DEFAULT_STOCK_STRUCTURE);
  return {version:1,groups:groups.sort((a,b)=>(a.sort||0)-(b.sort||0)||String(a.name).localeCompare(String(b.name),'th'))};
}
function currentStockStructure(){ return normalizeStockStructure(state?.stockStructure||DEFAULT_STOCK_STRUCTURE); }
function isLegacyStockArea(area={}){
  const id=String(area?.id||'').trim();
  const name=String(area?.name||'').trim();
  return id===DEFAULT_STOCK_AREA_ID || /legacy|default/i.test(id) || name==='สต๊อกเดิม';
}
function visibleStockAreasForGroup(group,includeInactive=false){
  const raw=(group?.areas||[]).filter(a=>includeInactive || a.status!=='inactive');
  const real=raw.filter(a=>!isLegacyStockArea(a));
  // ถ้ามีพื้นที่ที่ Admin สร้างไว้แล้ว ให้ซ่อน “สต๊อกเดิม” ออกจากตัวเลือกทั้งหมด
  return real.length?real:raw;
}
function allActiveStockGroups(){ return currentStockStructure().groups.filter(g=>g.status!=='inactive'); }
function activeStockGroups(){ return allActiveStockGroups().filter(g=>canAccessStockGroup(g.id)); }
function activeStockAreas(groupId){
  const groups=currentStockStructure().groups;
  const group=groups.find(g=>g.id===groupId) || groups[0];
  return visibleStockAreasForGroup(group,false).filter(a=>canAccessStockLocation(group.id,a.id));
}
function defaultStockLocation(){
  const group=activeStockGroups().find(g=>visibleStockAreasForGroup(g,false).length) || activeStockGroups()[0] || currentStockStructure().groups[0] || DEFAULT_STOCK_STRUCTURE.groups[0];
  const area=visibleStockAreasForGroup(group,false)[0] || visibleStockAreasForGroup(group,true)[0] || DEFAULT_STOCK_STRUCTURE.groups[0].areas[0];
  return {stockGroupId:group.id,stockGroupName:group.name,stockAreaId:area.id,stockAreaName:area.name,stockAreaPath:`${group.name} / ${area.name}`};
}
function stockLocationFromIds(groupId,areaId){
  const structure=currentStockStructure();
  const group=structure.groups.find(g=>g.id===groupId) || activeStockGroups()[0] || structure.groups[0];
  const visibleAreas=visibleStockAreasForGroup(group,false);
  const allAreas=visibleStockAreasForGroup(group,true);
  const requested=allAreas.find(a=>a.id===areaId);
  const area=(requested && visibleAreas.some(a=>a.id===requested.id)) ? requested : (visibleAreas[0] || requested || allAreas[0]);
  if(!group||!area) return defaultStockLocation();
  return {stockGroupId:group.id,stockGroupName:group.name,stockAreaId:area.id,stockAreaName:area.name,stockAreaPath:`${group.name} / ${area.name}`};
}
function productStockLocation(product={}){
  const fallback=defaultStockLocation();
  const groupId=String(product.stockGroupId||'').trim()||fallback.stockGroupId;
  const areaId=String(product.stockAreaId||'').trim()||fallback.stockAreaId;
  const resolved=stockLocationFromIds(groupId,areaId);
  // v34.27.6: ถ้าสินค้าเก่ายังชี้ “สต๊อกเดิม” แต่กลุ่มนั้นมีพื้นที่จริงแล้ว ให้แสดงพื้นที่จริงแทนเพื่อไม่ให้มีข้อมูลผี/ตัวเลือกเดิมกลับมา
  return {
    stockGroupId:resolved.stockGroupId,
    stockGroupName:resolved.stockGroupName,
    stockAreaId:resolved.stockAreaId,
    stockAreaName:resolved.stockAreaName,
    stockAreaPath:resolved.stockAreaPath
  };
}
function productStockGroupId(product){ return productStockLocation(product).stockGroupId; }
function productStockAreaId(product){ return productStockLocation(product).stockAreaId; }
function productStockLocationExtra(product){ return productStockLocation(product); }
function cleanStockCardLocationPart(value){
  return String(value||'')
    .replace(/[\u200B-\u200D\uFEFF]/g,'')
    .replace(/^[\u25CC\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0300-\u036F]+/g,'')
    .trim();
}
function stockLocationBadgeMarkup(product){
  const loc=productStockLocation(product);
  const groupName=cleanStockCardLocationPart(loc.stockGroupName);
  const areaName=cleanStockCardLocationPart(loc.stockAreaName);
  // v34.28.15: โชว์ Location ให้ครบ 2 บรรทัด และตัด hidden mark ที่ทำให้เกิดวงกลมประหลาดก่อนชื่อพื้นที่
  const label=(groupName && areaName) ? `${groupName} / ${areaName}` : (areaName || groupName || 'ยังไม่ระบุพื้นที่');
  return `<div class="stock-area-badge stock-area-badge-slim">📍 ${escapeHtml(label)}</div>`;
}
function stockLocationSelectorsMarkup(prefix='stockLoc',product={}){
  const loc=productStockLocation(product);
  const groups=activeStockGroups();
  const allGroups=groups.length?groups:currentStockStructure().groups;
  const groupOptions=allGroups.map(g=>`<option value="${escapeHtml(g.id)}" ${loc.stockGroupId===g.id?'selected':''}>${escapeHtml(g.name)}${g.status==='inactive'?' (ปิดใช้งาน)':''}</option>`).join('');
  const group=allGroups.find(g=>g.id===loc.stockGroupId)||allGroups[0];
  const areas=visibleStockAreasForGroup(group,false);
  const safeAreaId=areas.some(a=>a.id===loc.stockAreaId)?loc.stockAreaId:(areas[0]?.id||'');
  const areaOptions=areas.map(a=>`<option value="${escapeHtml(a.id)}" ${safeAreaId===a.id?'selected':''}>${escapeHtml(a.name)}${a.status==='inactive'?' (ปิดใช้งาน)':''}</option>`).join('');
  return `<section class="stock-location-form-block"><div class="settings-section-head mini"><span class="settings-step-badge">🏠</span><div><h3>กลุ่มสต๊อก / พื้นที่สต๊อก</h3><p>ใช้แยกบ้านหลังใหญ่และห้องย่อยของสินค้า</p></div></div><div class="branding-two-col"><label>กลุ่มสต๊อก<select id="${prefix}Group" onchange="window.updateStockAreaSelect('${prefix}')">${groupOptions}</select></label><label>พื้นที่สต๊อก<select id="${prefix}Area">${areaOptions}</select></label></div></section>`;
}
window.updateStockAreaSelect=(prefix='stockLoc')=>{
  const groupEl=$(`${prefix}Group`), areaEl=$(`${prefix}Area`);
  if(!groupEl||!areaEl) return;
  const group=currentStockStructure().groups.find(g=>g.id===groupEl.value)||activeStockGroups()[0]||currentStockStructure().groups[0];
  const areas=visibleStockAreasForGroup(group,false);
  areaEl.innerHTML=areas.map((a,i)=>`<option value="${escapeHtml(a.id)}" ${i===0?'selected':''}>${escapeHtml(a.name)}${a.status==='inactive'?' (ปิดใช้งาน)':''}</option>`).join('');
};
function collectStockLocationForm(prefix='stockLoc'){
  const groupId=$(`${prefix}Group`)?.value||defaultStockLocation().stockGroupId;
  const areaId=$(`${prefix}Area`)?.value||'';
  return stockLocationFromIds(groupId,areaId);
}
function stockFilterPermissionContext(){
  const groups=activeStockGroups();
  const access=normalizeMemberStockAccess(state.profile||{});
  const restricted=!isStockAccessUnrestricted(state.profile||{});
  let selectedGroup=groups.some(g=>g.id===state.stockGroupFilter)?state.stockGroupFilter:'all';
  if(restricted && groups.length===1) selectedGroup=groups[0].id;
  if(state.stockGroupFilter!==selectedGroup) state.stockGroupFilter=selectedGroup;
  const selectedGroupObj=groups.find(g=>g.id===selectedGroup)||null;
  const groupFullAccess=!!(restricted && selectedGroupObj && access.groupIds.includes(selectedGroupObj.id));
  const areaPool=selectedGroup==='all'
    ? groups.flatMap(g=>visibleStockAreasForGroup(g,false).filter(a=>canAccessStockLocation(g.id,a.id)).map(a=>({...a,groupId:g.id,groupName:g.name})))
    : activeStockAreas(selectedGroup).map(a=>({...a,groupId:selectedGroup,groupName:selectedGroupObj?.name||''}));
  if(restricted && !groupFullAccess && areaPool.length===1){
    state.stockAreaFilter=areaPool[0].id;
  }else if(state.stockAreaFilter!=='all' && !areaPool.some(a=>a.id===state.stockAreaFilter)){
    state.stockAreaFilter='all';
  }
  const lockGroup=!!(restricted && groups.length===1 && selectedGroupObj);
  // ถ้าสมาชิกเห็นทั้งกลุ่ม ให้ซ่อนกลุ่มสต๊อก แต่ยังให้เลือกพื้นที่ภายในบ้าน/กลุ่มนั้นได้
  const lockArea=!!(restricted && selectedGroupObj && !groupFullAccess && areaPool.length===1);
  return {groups,access,restricted,selectedGroup,selectedGroupObj,groupFullAccess,areaPool,lockGroup,lockArea};
}
function stockLockedFieldMarkup(text,sub=''){
  return `<div class="stock-sort-field stock-locked-field" aria-label="${escapeHtml(text)}"><span>${escapeHtml(text)}</span>${sub?`<small>${escapeHtml(sub)}</small>`:''}</div>`;
}
function stockStructureFilterMarkup(){
  const ctx=stockFilterPermissionContext();
  const {groups,selectedGroup,selectedGroupObj,areaPool,lockGroup,lockArea,groupFullAccess}=ctx;
  const groupField=lockGroup
    ? ''
    : `<select id="stockGroupFilterSelect" class="stock-sort-field" onchange="window.setStockGroupFilter(this.value)"><option value="all" ${state.stockGroupFilter==='all'?'selected':''}>ทุกกลุ่มสต๊อก</option>${groups.map(g=>`<option value="${escapeHtml(g.id)}" ${state.stockGroupFilter===g.id?'selected':''}>🏠 ${escapeHtml(g.name)}</option>`).join('')}</select>`;
  let areaText='พื้นที่ที่ได้รับสิทธิ์';
  let areaSub='ล็อกตามสิทธิ์สมาชิก';
  if(lockArea && selectedGroupObj){
    const only=areaPool[0];
    areaText=`🔒 ${only?.name||'พื้นที่ที่ได้รับสิทธิ์'}`;
    areaSub=selectedGroupObj.name;
  }
  const allAreaLabel=selectedGroup!=='all' && selectedGroupObj ? `ทุกพื้นที่ใน ${selectedGroupObj.name}` : 'ทุกพื้นที่สต๊อก';
  const areaField=lockArea
    ? stockLockedFieldMarkup(areaText,areaSub)
    : `<select id="stockAreaFilterSelect" class="stock-sort-field" onchange="window.setStockAreaFilter(this.value)"><option value="all" ${state.stockAreaFilter==='all'?'selected':''}>${escapeHtml(allAreaLabel)}</option>${areaPool.map(a=>`<option value="${escapeHtml(a.id)}" ${state.stockAreaFilter===a.id?'selected':''}>${selectedGroup==='all'?escapeHtml(a.groupName)+' / ':''}${escapeHtml(a.name)}</option>`).join('')}</select>`;
  return `${groupField}${areaField}`;
}

const LOGIN_LAYOUTS={modern:'โมเดิร์น',compact:'กะทัดรัด',classic:'เรียบง่าย'};
const LOGIN_PATTERNS={curves:'ลายเส้นโค้ง',clean:'พื้นเรียบ',soft:'พื้นนุ่ม',photo:'มีพื้นที่รูป'};
const DASHBOARD_TEXT_SIZES={small:'เล็ก',normal:'ปกติ',large:'ใหญ่',xlarge:'ใหญ่มาก'};
const DASHBOARD_CARD_SIZES={compact:'กะทัดรัด',standard:'มาตรฐาน',large:'ใหญ่'};
const LOGIN_DESKTOP_TITLE_SIZES={normal:'ปกติ',large:'ใหญ่',xlarge:'ใหญ่มาก',hero:'เด่นมาก'};
const LOGIN_DESKTOP_SUBTITLE_SIZES={normal:'ปกติ',large:'ใหญ่',xlarge:'ใหญ่มาก'};
const LOGIN_DESKTOP_LOGO_SIZES={normal:'ปกติ',large:'ใหญ่',xlarge:'ใหญ่มาก'};
const LOGIN_DESKTOP_FORM_SIZES={normal:'ปกติ',large:'ใหญ่',xlarge:'ใหญ่มาก'};
const LOGIN_DESKTOP_PANEL_WIDTHS={balanced:'สมดุล 50/50',brandFocus:'เน้นภาพ/ข้อความซ้าย',formFocus:'เน้นกล่อง Login'};
const LOGIN_MOBILE_TITLE_SIZES={compact:'กะทัดรัด',normal:'ปกติ',large:'ใหญ่'};
const LOGIN_MOBILE_SUBTITLE_SIZES={compact:'กะทัดรัด',normal:'ปกติ',large:'ใหญ่'};
const LOGIN_MOBILE_LOGO_SIZES={compact:'เล็ก',normal:'ปกติ',large:'ใหญ่'};
const LOGIN_MOBILE_PHOTO_HEIGHTS={hidden:'ซ่อนรูปภาพ',compact:'รูปสั้น',normal:'รูปปกติ',tall:'รูปสูง'};
function normalizeChoice(value,allowed,fallback){ const v=String(value||'').trim(); return allowed.includes(v)?v:fallback; }
function normalizeOrder(value,allowed,defaults){
  const raw=Array.isArray(value)?value:String(value||'').split(',');
  const seen=[];
  raw.map(x=>String(x||'').trim()).forEach(x=>{ if(allowed.includes(x) && !seen.includes(x)) seen.push(x); });
  defaults.forEach(x=>{ if(!seen.includes(x)) seen.push(x); });
  return seen.filter(x=>allowed.includes(x));
}
function normalizeHiddenCards(value){
  const allowed=[...DASHBOARD_SECTION_CARDS,...DASHBOARD_STAT_CARDS];
  const raw=Array.isArray(value)?value:String(value||'').split(',');
  const out=[];
  raw.map(x=>String(x||'').trim()).forEach(x=>{ if(allowed.includes(x) && !out.includes(x)) out.push(x); });
  return out;
}
function readCachedBranding(){
  try{ return JSON.parse(localStorage.getItem(BRANDING_CACHE_KEY)||'{}')||{}; }catch(_){ return {}; }
}
function normalizeBranding(raw={}){
  const themeName=String(raw.themeName||DEFAULT_BRANDING.themeName||'green-gold');
  const preset=THEME_PRESETS[themeName]||THEME_PRESETS['green-gold'];
  const merged={...DEFAULT_BRANDING,...preset,...raw,themeName};
  const clamp=(v,fallback)=>String(v||fallback||'').trim();
  return {
    systemName:clamp(merged.systemName,DEFAULT_BRANDING.systemName).slice(0,60),
    systemSubtitle:clamp(merged.systemSubtitle,DEFAULT_BRANDING.systemSubtitle).slice(0,120),
    logoUrl:clamp(merged.logoUrl,DEFAULT_BRANDING.logoUrl),
    themeName:THEME_PRESETS[themeName]?themeName:'green-gold',
    primaryColor:clamp(merged.primaryColor,DEFAULT_BRANDING.primaryColor),
    secondaryColor:clamp(merged.secondaryColor,DEFAULT_BRANDING.secondaryColor),
    accentColor:clamp(merged.accentColor,DEFAULT_BRANDING.accentColor),
    backgroundColor:clamp(merged.backgroundColor,DEFAULT_BRANDING.backgroundColor),
    cardColor:clamp(merged.cardColor,DEFAULT_BRANDING.cardColor),
    textColor:clamp(merged.textColor,DEFAULT_BRANDING.textColor),
    loginWelcomeText:clamp(merged.loginWelcomeText,DEFAULT_BRANDING.loginWelcomeText).slice(0,80),
    loginStatusText:clamp(merged.loginStatusText,DEFAULT_BRANDING.loginStatusText).slice(0,80),
    loginLayout:normalizeChoice(merged.loginLayout,Object.keys(LOGIN_LAYOUTS),DEFAULT_BRANDING.loginLayout),
    loginPattern:normalizeChoice(merged.loginPattern,Object.keys(LOGIN_PATTERNS),DEFAULT_BRANDING.loginPattern),
    dashboardTextSize:normalizeChoice(merged.dashboardTextSize,Object.keys(DASHBOARD_TEXT_SIZES),DEFAULT_BRANDING.dashboardTextSize),
    dashboardCardSize:normalizeChoice(merged.dashboardCardSize,Object.keys(DASHBOARD_CARD_SIZES),DEFAULT_BRANDING.dashboardCardSize),
    dashboardCardOrder:normalizeOrder(merged.dashboardCardOrder,DASHBOARD_SECTION_CARDS,DEFAULT_BRANDING.dashboardCardOrder),
    dashboardStatOrder:normalizeOrder(merged.dashboardStatOrder,DASHBOARD_STAT_CARDS,DEFAULT_BRANDING.dashboardStatOrder),
    dashboardHiddenCards:normalizeHiddenCards(merged.dashboardHiddenCards),
    desktopLoginTitleSize:normalizeChoice(merged.desktopLoginTitleSize,Object.keys(LOGIN_DESKTOP_TITLE_SIZES),DEFAULT_BRANDING.desktopLoginTitleSize),
    desktopLoginSubtitleSize:normalizeChoice(merged.desktopLoginSubtitleSize,Object.keys(LOGIN_DESKTOP_SUBTITLE_SIZES),DEFAULT_BRANDING.desktopLoginSubtitleSize),
    desktopLoginLogoSize:normalizeChoice(merged.desktopLoginLogoSize,Object.keys(LOGIN_DESKTOP_LOGO_SIZES),DEFAULT_BRANDING.desktopLoginLogoSize),
    desktopLoginFormSize:normalizeChoice(merged.desktopLoginFormSize,Object.keys(LOGIN_DESKTOP_FORM_SIZES),DEFAULT_BRANDING.desktopLoginFormSize),
    desktopLoginPanelWidth:normalizeChoice(merged.desktopLoginPanelWidth,Object.keys(LOGIN_DESKTOP_PANEL_WIDTHS),DEFAULT_BRANDING.desktopLoginPanelWidth),
    mobileLoginTitleSize:normalizeChoice(merged.mobileLoginTitleSize,Object.keys(LOGIN_MOBILE_TITLE_SIZES),DEFAULT_BRANDING.mobileLoginTitleSize),
    mobileLoginSubtitleSize:normalizeChoice(merged.mobileLoginSubtitleSize,Object.keys(LOGIN_MOBILE_SUBTITLE_SIZES),DEFAULT_BRANDING.mobileLoginSubtitleSize),
    mobileLoginLogoSize:normalizeChoice(merged.mobileLoginLogoSize,Object.keys(LOGIN_MOBILE_LOGO_SIZES),DEFAULT_BRANDING.mobileLoginLogoSize),
    mobileLoginPhotoHeight:normalizeChoice(merged.mobileLoginPhotoHeight,Object.keys(LOGIN_MOBILE_PHOTO_HEIGHTS),DEFAULT_BRANDING.mobileLoginPhotoHeight),
    stockCardUi:normalizeStockCardUi(merged.stockCardUi)
  };
}
function appName(){ return (state?.branding?.systemName)||DEFAULT_BRANDING.systemName; }
function appSubtitle(){ return (state?.branding?.systemSubtitle)||DEFAULT_BRANDING.systemSubtitle; }
function appLogoUrl(){ return (state?.branding?.logoUrl)||DEFAULT_BRANDING.logoUrl; }
function appNameWithEnvHtml(){ return escapeHtml(appName()); }
function settingsDocRef(id=BRANDING_DOC_ID){ return doc(fs,'theviewWorkspaces','main','settings',id); }
function applySystemBranding(input,opts={cache:true}){
  let source=input||{};
  try{ if(!source.stockCardUi && typeof state!=='undefined' && state.stockCardUi) source={...source,stockCardUi:state.stockCardUi}; }catch(_){ }
  const b=normalizeBranding(source||state.branding||{});
  if(typeof state!=='undefined') state.branding=b;
  const root=document.documentElement;
  root.style.setProperty('--cc-green',b.primaryColor);
  root.style.setProperty('--green',b.primaryColor);
  root.style.setProperty('--blue',b.primaryColor);
  root.style.setProperty('--bg',b.backgroundColor);
  root.style.setProperty('--cc-green-dark',b.secondaryColor);
  root.style.setProperty('--cc-gold',b.accentColor);
  root.style.setProperty('--cc-cream',b.backgroundColor);
  root.style.setProperty('--card',b.cardColor);
  root.style.setProperty('--cc-brown',b.textColor);
  root.style.setProperty('--dark',b.textColor);
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content',b.secondaryColor||b.primaryColor);
  const pageTitle=b.systemName;
  if(document.title!==pageTitle) document.title=pageTitle;
  if(document.body){
    document.body.dataset.loginLayout=b.loginLayout;
    document.body.dataset.loginPattern=b.loginPattern;
    document.body.dataset.dashboardTextSize=b.dashboardTextSize;
    document.body.dataset.dashboardCardSize=b.dashboardCardSize;
    document.body.dataset.desktopLoginTitleSize=b.desktopLoginTitleSize;
    document.body.dataset.desktopLoginSubtitleSize=b.desktopLoginSubtitleSize;
    document.body.dataset.desktopLoginLogoSize=b.desktopLoginLogoSize;
    document.body.dataset.desktopLoginFormSize=b.desktopLoginFormSize;
    document.body.dataset.desktopLoginPanelWidth=b.desktopLoginPanelWidth;
    document.body.dataset.mobileLoginTitleSize=b.mobileLoginTitleSize;
    document.body.dataset.mobileLoginSubtitleSize=b.mobileLoginSubtitleSize;
    document.body.dataset.mobileLoginLogoSize=b.mobileLoginLogoSize;
    document.body.dataset.mobileLoginPhotoHeight=b.mobileLoginPhotoHeight;
  }
  document.querySelectorAll('[data-login-welcome]').forEach(el=>{ el.textContent=b.loginWelcomeText; });
  document.querySelectorAll('[data-login-status]').forEach(el=>{ el.textContent=b.loginStatusText; });
  document.querySelectorAll('[data-system-name]').forEach(el=>{ el.textContent=b.systemName; });
  document.querySelectorAll('[data-system-name-html]').forEach(el=>{ el.innerHTML=appNameWithEnvHtml(); });
  document.querySelectorAll('[data-system-subtitle]').forEach(el=>{ el.textContent=b.systemSubtitle; });
  document.querySelectorAll('[data-system-logo]').forEach(img=>{
    const current=img.getAttribute('src')||'';
    if(current!==b.logoUrl) img.setAttribute('src',b.logoUrl);
    img.setAttribute('alt',b.systemName);
    img.classList.toggle('brand-logo-custom', !!b.logoUrl && b.logoUrl!==DEFAULT_BRANDING.logoUrl);
  });
  applyStockCardUi(b.stockCardUi);
  if(opts.cache){ try{ localStorage.setItem(BRANDING_CACHE_KEY,JSON.stringify({...b,cachedAt:Date.now()})); }catch(_){ } }
}
function normalizeUsername(v=''){ return String(v).trim().toLowerCase().replace(/\s+/g,''); }
function usernameToEmail(v){ return `${normalizeUsername(v)}@${USERNAME_DOMAIN}`; }

const BUILD_VERSION='34.29.52-R3-BULK-EDIT';
window.__THEVIEW_BUILD__=BUILD_VERSION;
window.__CHEE_AUTH_PHASE__='module-loaded';

function withTimeout(promise, ms=15000, label='timeout'){
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(()=>{ if(timer) clearTimeout(timer); }),
    new Promise((_,reject)=>{ timer=setTimeout(()=>reject(Object.assign(new Error(label),{code:'app/timeout'})), ms); })
  ]);
}
function friendlyTimeoutMessage(label=''){
  if(String(label).includes('login')) return 'การเชื่อมต่อเข้าสู่ระบบใช้เวลานานผิดปกติ กรุณาตรวจสอบอินเทอร์เน็ตหรือรีเฟรชแล้วลองใหม่';
  if(String(label).includes('member')) return 'โหลดข้อมูลสมาชิกช้ากว่าปกติ กรุณารีเฟรชหรือออกแล้วเข้าใหม่';
  return 'ระบบตอบสนองช้ากว่าปกติ กรุณาลองใหม่อีกครั้ง';
}

// v34.29.28: hard boot watchdog for iPhone/Safari and stale Service Worker cache.
// If auth/profile restore hangs too long, do not leave the user stuck on the boot card.
window.__CHEE_APP_MODULE_READY_AT__=Date.now();
function showBootRecovery(message='ระบบโหลดนานผิดปกติ กรุณาล้างแคชหรือเข้าใหม่อีกครั้ง'){
  try{
    const boot=$('bootPage');
    const retry=$('bootRetryBtn');
    const msg=$('bootMessage');
    if(msg) msg.textContent=message;
    if(retry) retry.classList.remove('hidden');
    if(boot) boot.classList.remove('hidden');
  }catch(_){ }
}
function armHardBootWatchdog(){
  setTimeout(()=>{
    try{
      const boot=$('bootPage');
      const app=$('app');
      const login=$('loginPage');
      const gate=$('passwordGate');
      const appVisible=app && !app.classList.contains('hidden');
      const loginVisible=login && !login.classList.contains('hidden');
      const gateVisible=gate && !gate.classList.contains('hidden');
      if(!boot || boot.classList.contains('hidden') || appVisible || loginVisible || gateVisible) return;
      const phase=String(window.__CHEE_AUTH_PHASE__||'unknown');
      console.warn('[TheView Stock] hard boot watchdog fired', {phase, build:BUILD_VERSION});
      showBootRecovery(`ระบบค้างที่ขั้นตอน ${phase} นานกว่าปกติ กดปุ่มรีเฟรช หรือเข้า /reset.html เพื่อล้างแคช`);
      if(window.__CHEE_SHOW_LOGIN_FALLBACK__) setTimeout(()=>window.__CHEE_SHOW_LOGIN_FALLBACK__({force:true}),1200);
    }catch(e){ console.warn('hard boot watchdog failed',e); }
  },26000);
}
armHardBootWatchdog();

function parseProductQrTargetFromUrl(){
  try{
    const url=new URL(location.href);
    const candidates=[];
    const keys=['p','qr','product','productId'];
    const add=(v)=>{ const value=String(v||'').trim(); if(value) candidates.push(value); };
    const pullParams=(params)=>{ keys.forEach(k=>add(params.get(k))); };
    pullParams(url.searchParams);

    const rawHash=String(url.hash||'').replace(/^#/,'').trim();
    if(rawHash){
      try{ pullParams(new URLSearchParams(rawHash.startsWith('?')?rawHash.slice(1):rawHash)); }catch(_){ }
      const hashPath=rawHash.match(/(?:^|\/)(?:qr|product|p)\/([^/?#&]+)/i);
      if(hashPath) add(hashPath[1]);
      if(!candidates.length && !/[=&\/]/.test(rawHash) && rawHash.length>=8) add(rawHash);
    }

    const pathMatch=url.pathname.match(/\/(?:qr|product)\/([^/?#&]+)/i);
    if(pathMatch) add(pathMatch[1]);

    const picked=candidates.find(Boolean)||'';
    try{ return decodeURIComponent(picked); }catch(_){ return picked; }
  }catch(_){ return ''; }
}
const PRODUCT_QR_QUERY_ID=parseProductQrTargetFromUrl();
function parseStaffProductTargetFromUrl(){
  try{
    const url=new URL(location.href);
    const keys=['staffProduct','openProduct','staffProductId'];
    for(const k of keys){ const v=String(url.searchParams.get(k)||'').trim(); if(v) return decodeURIComponent(v); }
    return '';
  }catch(_){ return ''; }
}
const STAFF_PRODUCT_QUERY_ID=parseStaffProductTargetFromUrl();
function isQrStaffLoginRequest(){
  try{
    const url=new URL(location.href);
    const direct=String(url.searchParams.get('qrStaffLogin')||url.searchParams.get('fromQrPreview')||'').trim().toLowerCase();
    return direct==='1' || direct==='true' || direct==='yes';
  }catch(_){ return false; }
}
const QR_STAFF_LOGIN_REQUEST=isQrStaffLoginRequest();

function isManualReturnToApp(){
  try{
    const url=new URL(location.href);
    const value=String(url.searchParams.get('fromManual')||url.searchParams.get('returnFromManual')||'').trim().toLowerCase();
    return value==='1' || value==='true' || value==='yes';
  }catch(_){ return false; }
}
function clearManualReturnParams(){
  try{
    const url=new URL(location.href);
    ['fromManual','returnFromManual'].forEach(k=>url.searchParams.delete(k));
    history.replaceState({},'',url.toString());
  }catch(_){ }
}
const IS_MANUAL_RETURN_TO_APP=isManualReturnToApp();
// รองรับ QR รุ่นเก่าที่อาจเคยสร้างเป็น ?staffProduct=...
// ถ้าไม่ได้มาจากปุ่มในหน้า Preview ให้ถือว่าเป็น QR Preview ก่อน Login
const QR_PREVIEW_TARGET=PRODUCT_QR_QUERY_ID || (!QR_STAFF_LOGIN_REQUEST ? STAFF_PRODUCT_QUERY_ID : '');
let productQrDeepLinkHandled=false;
const PRODUCT_QR_STAFF_RETURN_KEY=storageKey('productQrStaffReturn');
if(STAFF_PRODUCT_QUERY_ID){ try{ localStorage.setItem(PRODUCT_QR_STAFF_RETURN_KEY,STAFF_PRODUCT_QUERY_ID); }catch(_){ } }
const $ = (id)=>document.getElementById(id);
window.$ = window.$ || $;

// ---------- Resilient product image loading ----------
function productImageMarkup(url='', alt='', extraClass=''){
  if(!url) return `<div class="stock-card-photo-placeholder">📦</div>`;
  const safeUrl=String(url).replace(/"/g,'&quot;');
  const safeAlt=escapeHtml(alt||'รูปสินค้า');
  return `<div class="image-loader-shell"><div class="image-loader-placeholder" aria-hidden="true"><span>📦</span></div><img class="resilient-product-img ${extraClass}" src="${safeUrl}" alt="${safeAlt}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="window.productImageLoaded(this)" onerror="window.productImageFailed(this)"></div>`;
}
window.productImageLoaded=(img)=>{
  const shell=img?.closest?.('.image-loader-shell');
  if(!shell) return;
  shell.classList.add('is-loaded');
  shell.classList.remove('is-error','is-retrying');
};
window.productImageFailed=(img)=>{
  const shell=img?.closest?.('.image-loader-shell');
  if(!shell) return;
  const attempt=Number(img.dataset.retryAttempt||0);
  if(attempt<2 && navigator.onLine){
    img.dataset.retryAttempt=String(attempt+1);
    shell.classList.add('is-retrying');
    const base=(img.dataset.originalSrc||img.currentSrc||img.src||'').split('#')[0];
    img.dataset.originalSrc=base;
    setTimeout(()=>{ img.src=base+(base.includes('?')?'&':'?')+'retry='+Date.now(); }, 700*(attempt+1));
    return;
  }
  shell.classList.remove('is-retrying');
  shell.classList.add('is-error');
};

// ---------- Action safety / duplicate-submit guard ----------
const ACTION_LOCK_TTL_MS=65000;
const actionLocks=new Map();
function actionLockButtons(key, buttonId=''){
  const buttons=[];
  if(buttonId){ const primary=document.getElementById(buttonId); if(primary) buttons.push(primary); }
  document.querySelectorAll('[data-action-lock]').forEach(btn=>{
    if(btn?.dataset?.actionLock===key && !buttons.includes(btn)) buttons.push(btn);
  });
  return buttons;
}
function beginActionLock(key, buttonId, busyText='กำลังดำเนินการ...'){
  const now=Date.now();
  const current=actionLocks.get(key);
  if(current && now-current.startedAt<ACTION_LOCK_TTL_MS){
    try{ toast('กำลังดำเนินการรายการนี้อยู่ กรุณารอสักครู่'); }catch(_){ }
    return false;
  }
  if(current) actionLocks.delete(key);
  actionLocks.set(key,{startedAt:now,buttonId,busyText});
  actionLockButtons(key,buttonId).forEach(btn=>{
    if(!btn.dataset.originalText) btn.dataset.originalText=btn.innerHTML;
    btn.disabled=true;
    btn.setAttribute('aria-busy','true');
    btn.classList.add('is-busy');
    btn.innerHTML=`⏳ ${busyText}`;
  });
  return true;
}
function endActionLock(key, buttonId){
  const meta=actionLocks.get(key)||{};
  actionLocks.delete(key);
  actionLockButtons(key,buttonId||meta.buttonId||'').forEach(btn=>{
    btn.disabled=false;
    btn.removeAttribute('aria-busy');
    btn.classList.remove('is-busy');
    if(btn.dataset.originalText){ btn.innerHTML=btn.dataset.originalText; delete btn.dataset.originalText; }
  });
}
function withActionLock(key, buttonId, busyText, task){
  if(!beginActionLock(key,buttonId,busyText)) return Promise.resolve(false);
  return Promise.resolve().then(task).finally(()=>endActionLock(key,buttonId));
}
function normalizeSkuKey(v=''){
  return String(v).trim().toUpperCase().replace(/\s+/g,'');
}
function skuRegistryDocRef(sku){
  const key=normalizeSkuKey(sku);
  const safe=encodeURIComponent(key).replace(/%/g,'_');
  return doc(fs,'theviewWorkspaces','main','skuRegistry',safe || '__EMPTY__');
}

// ---------- Product image storage (Hybrid: URL ใหม่ + Base64 เดิมยังรองรับ) ----------
function isStorageUrl(value=''){
  return /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//i.test(String(value||''));
}
async function uploadProductImage(productId, dataUrl, previousPath=''){
  if(!productId || !dataUrl) throw new Error('ข้อมูลรูปสินค้าไม่ครบ');
  const path=`product-images/${productId}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
  const ref=storageRef(storage,path);
  await uploadString(ref,dataUrl,'data_url',{contentType:'image/jpeg',cacheControl:'public,max-age=31536000,immutable'});
  const url=await getDownloadURL(ref);
  if(previousPath){
    deleteObject(storageRef(storage,previousPath)).catch(err=>console.warn('ลบรูปสินค้าเก่าไม่สำเร็จ',err));
  }
  return {url,path};
}

function hasDuplicateSkuLocal(sku, excludeId=''){
  const key=normalizeSkuKey(sku);
  if(!key) return false;
  return state.products.some(p=>p.id!==excludeId && normalizeSkuKey(p.sku||'')===key);
}

function setSkuFieldError(message=''){
  const input=$('ps'), box=$('skuInlineError');
  if(box){
    box.textContent=message;
    box.classList.toggle('hidden',!message);
  }
  if(input){
    input.setAttribute('aria-invalid',message?'true':'false');
    input.style.borderColor=message?'#dc2626':'';
    input.style.boxShadow=message?'0 0 0 3px rgba(220,38,38,.12)':'';
    if(message){
      try{ input.scrollIntoView({behavior:'smooth',block:'center'}); }catch(_){ }
      setTimeout(()=>input.focus({preventScroll:true}),80);
    }
  }
}
window.validateSkuField=(_excludeId='')=>{
  // v34.29.52 R2: SKU/รหัสสั่งซื้อเป็นรหัสอ้างอิง ไม่ใช่ Primary Key
  // สินค้าคนละชนิดจึงสามารถใช้รหัสสั่งซื้อเดียวกันได้ เช่น ถุง 1 ช่อง / 2 ช่อง
  setSkuFieldError('');
  return true;
};
function isSkuDuplicateError(err){
  return /SKU\s*ซ้ำ|รหัสสินค้า.*ซ้ำ|ใช้รหัสนี้แล้ว/i.test(String(err?.message||err||''));
}
function showSkuDuplicateError(sku,err){
  const msg=`ไม่สามารถบันทึกได้ — รหัสสินค้า (SKU) "${sku||'-'}" ถูกใช้งานแล้ว กรุณาใช้รหัสอื่น`;
  setSkuFieldError(msg);
  toast(msg);
  return msg;
}


// ตรวจสอบว่า HTML / CSS / JavaScript เป็นชุดเวอร์ชันเดียวกัน
(function verifyBuildConsistency(){
  const htmlBuild=document.documentElement.dataset.build||'';
  if(htmlBuild && htmlBuild!==BUILD_VERSION){
    console.warn(`[TheView Stock] build mismatch: HTML ${htmlBuild}, JS ${BUILD_VERSION}`);
    try{
      const key=storageKey('build-reload');
      if(sessionStorage.getItem(key)!==BUILD_VERSION){
        sessionStorage.setItem(key,BUILD_VERSION);
        const url=new URL(location.href);
        url.searchParams.set('v',BUILD_VERSION);
        location.replace(url.toString());
      }
    }catch(_){ }
  }
})();
const LAST_PAGE_KEY=storageKey('lastPage');
const LAST_SCROLL_KEY=storageKey('lastScroll');
const LAST_SCROLL_MAP_KEY=storageKey('scrollByPage');
const NEW_ITEM_DRAFT_KEY=storageKey('newItemDraft');
const UI_STATE_KEY=storageKey('uiState');
const PRODUCT_DETAIL_KEY=storageKey('productDetail');
const VALID_PAGES=new Set(['home','stock','scan','approval','report','history','profile','manual','productDetail']);
const savedPage=localStorage.getItem(LAST_PAGE_KEY);
const state = { user:null, profile:null, members:[], branding:normalizeBranding(readCachedBranding()), stockStructure:normalizeStockStructure(readCachedBranding().stockStructure||{}), stockCardUi:normalizeStockCardUi(readCachedBranding().stockCardUi||{}), stockGroupFilter:'all', stockAreaFilter:'all', scanGroupId:'', scanAreaId:'all', approvalFilter:'all', page:VALID_PAGES.has(savedPage)?savedPage:'home', products:[], approvals:[], logs:[], auditLogs:[], selectedImage:null, imageMode:null, viewProductId:localStorage.getItem(PRODUCT_DETAIL_KEY)||null, productDetailTab:'general', tempMoveImage:null, tempProductImage:null, stockFilter:'all', stockSearch:'', stockSort:'name-asc', stockCategory:'all', balanceCategory:'all', reportMode:'day', reportFilter:'all', reportDashboardView:'normal', reportDetailType:'', reportGroupFilter:'all', reportAreaFilter:'all', reportDate:'', reportMonth:'', reportStart:'', reportEnd:'', historySearch:'', historyFilter:'all', historyDestinationFilter:'all', historyGroupFilter:'all', historyAreaFilter:'all', historyStart:toDateStr(new Date()), historyEnd:toDateStr(new Date()) };
applySystemBranding(state.branding,{cache:false});

async function loadInitialPublicBranding(){
  try{
    const snap=await getDoc(settingsDocRef());
    if(snap.exists()) applySystemBranding(snap.data(),{cache:true});
  }catch(err){
    console.warn('โหลด Branding ก่อน Login ไม่สำเร็จ',err);
  }
}
loadInitialPublicBranding();
try{
  const savedUi=JSON.parse(localStorage.getItem(UI_STATE_KEY)||'{}');
  ['stockFilter','stockSort','stockCategory','stockGroupFilter','stockAreaFilter','approvalFilter','balanceCategory','reportMode','reportFilter','reportDashboardView','reportGroupFilter','reportAreaFilter','reportDate','reportMonth','reportStart','reportEnd','historySearch','historyFilter','historyDestinationFilter','historyGroupFilter','historyAreaFilter','historyStart','historyEnd','newItemType','productDetailTab'].forEach(k=>{ if(savedUi[k]!==undefined) state[k]=savedUi[k]; });
}catch(_){ }

try{
  const reportDateSyncKey=storageKey('report-date-sync-v34.24.5');
  if(localStorage.getItem(reportDateSyncKey)!=='done'){
    const now=new Date();
    const today=toDateStr(now);
    state.reportMode='day';
    state.reportFilter='all';
    state.reportDetailType='';
    state.reportDate=today;
    state.reportStart=today;
    state.reportEnd=today;
    state.reportMonth=toMonthStr(now);
    localStorage.setItem(reportDateSyncKey,'done');
    try{
      const savedUi=JSON.parse(localStorage.getItem(UI_STATE_KEY)||'{}');
      Object.assign(savedUi,{reportMode:state.reportMode,reportFilter:state.reportFilter,reportDashboardView:state.reportDashboardView,reportDate:state.reportDate,reportMonth:state.reportMonth,reportStart:state.reportStart,reportEnd:state.reportEnd,reportDetailType:state.reportDetailType,reportGroupFilter:state.reportGroupFilter,reportAreaFilter:state.reportAreaFilter});
      localStorage.setItem(UI_STATE_KEY,JSON.stringify(savedUi));
    }catch(_){ }
  }
}catch(_){ }

if(IS_MANUAL_RETURN_TO_APP){
  state.page='home';
  state.viewProductId=null;
  state.productDetailTab='general';
  try{
    localStorage.setItem(LAST_PAGE_KEY,'home');
    localStorage.removeItem(PRODUCT_DETAIL_KEY);
    const map=readScrollMap?.() || {};
    map.home=0;
    localStorage.setItem(LAST_SCROLL_MAP_KEY,JSON.stringify(map));
  }catch(_){ }
  clearManualReturnParams();
}

function saveUiState(){
  const keys=['stockFilter','stockSort','stockCategory','stockGroupFilter','stockAreaFilter','approvalFilter','balanceCategory','reportMode','reportFilter','reportDashboardView','reportGroupFilter','reportAreaFilter','reportDate','reportMonth','reportStart','reportEnd','historySearch','historyFilter','historyDestinationFilter','historyGroupFilter','historyAreaFilter','historyStart','historyEnd','newItemType','productDetailTab'];
  const data={}; keys.forEach(k=>data[k]=state[k]);
  localStorage.setItem(UI_STATE_KEY,JSON.stringify(data));
}

const view = $('view');
let newItemDraftPromptChecked=false;
let restoringNewItemDraft=false;

// ---------- ปุ่มแสดง/ซ่อนรหัสผ่าน ----------
function ensurePasswordEyeStyles(){
  if(document.getElementById('theviewPasswordEyeStyles')) return;
  const style=document.createElement('style');
  style.id='theviewPasswordEyeStyles';
  style.textContent=`
    .password-eye-wrap{position:relative;width:100%}
    .password-eye-wrap>input{width:100%;padding-right:58px!important;box-sizing:border-box}
    .password-eye-btn{
      position:absolute;right:10px;top:50%;transform:translateY(-50%);
      border:0!important;background:transparent!important;box-shadow:none!important;
      width:42px;height:42px;padding:0!important;margin:0!important;
      display:flex;align-items:center;justify-content:center;
      font-size:22px;line-height:1;cursor:pointer;z-index:5;color:#334155;
      -webkit-tap-highlight-color:transparent;
    }
    .password-eye-btn:focus{
      outline:2px solid #93c5fd;outline-offset:1px;border-radius:10px
    }
  `;
  document.head.appendChild(style);
}

window.togglePasswordVisibility=(inputId,button)=>{
  const input=document.getElementById(inputId);
  if(!input) return;
  const show=input.type==='password';
  input.type=show?'text':'password';
  if(button){
    button.textContent=show?'🙈':'👁️';
    button.setAttribute('aria-label',show?'ซ่อนรหัสผ่าน':'แสดงรหัสผ่าน');
    button.setAttribute('title',show?'ซ่อนรหัสผ่าน':'แสดงรหัสผ่าน');
  }
};

function attachPasswordEye(input){
  if(!input || input.dataset.passwordEyeReady==='1') return;
  if(!input.id) input.id=`password_${Math.random().toString(36).slice(2)}`;
  input.dataset.passwordEyeReady='1';

  const parent=input.parentElement;
  if(!parent) return;

  const wrap=document.createElement('div');
  wrap.className='password-eye-wrap';
  parent.insertBefore(wrap,input);
  wrap.appendChild(input);

  const btn=document.createElement('button');
  btn.type='button';
  btn.className='password-eye-btn';
  btn.textContent='👁️';
  btn.setAttribute('aria-label','แสดงรหัสผ่าน');
  btn.setAttribute('title','แสดงรหัสผ่าน');
  btn.addEventListener('click',()=>window.togglePasswordVisibility(input.id,btn));
  wrap.appendChild(btn);
}

function refreshPasswordEyes(root=document){
  ensurePasswordEyeStyles();
  const inputs=[];
  if(root instanceof HTMLInputElement && root.type==='password') inputs.push(root);
  if(root.querySelectorAll) inputs.push(...root.querySelectorAll('input[type="password"]'));
  inputs.forEach(attachPasswordEye);
}

ensurePasswordEyeStyles();
document.addEventListener('DOMContentLoaded',()=>refreshPasswordEyes());
const passwordEyeObserver=new MutationObserver(mutations=>{
  for(const mutation of mutations){
    for(const node of mutation.addedNodes){
      if(node.nodeType===1) refreshPasswordEyes(node);
    }
  }
});
passwordEyeObserver.observe(document.documentElement,{childList:true,subtree:true});
requestAnimationFrame(()=>refreshPasswordEyes());


function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1800); }
function userPath(name){ return collection(fs,'theviewWorkspaces','main',name); }
function productRef(id){ return doc(fs,'theviewWorkspaces','main','products',id); }
function publicProductRef(id){ return doc(fs,'theviewWorkspaces','main','publicProducts',String(id||'')); }
function approvalRef(id){ return doc(fs,'theviewWorkspaces','main','approvals',id); }
function logDocRef(id){ return doc(fs,'theviewWorkspaces','main','logs',id); }
function logRef(){ return collection(fs,'theviewWorkspaces','main','logs'); }
function auditRef(){ return collection(fs,'theviewWorkspaces','main','auditLogs'); }
function memberRef(uid=state.user?.uid){ return doc(fs,'members',uid); }
function role(){ return state.profile?.role || 'staff'; }
function isAdmin(){ return role()==='admin'; }
function isManagerRole(){ return role()==='manager' || role()==='director' || isAdmin(); }
function isCaptain(){ return role()==='captain'; }
function isSupervisor(){ return role()==='supervisor'; }
function isFrontLead(){ return isCaptain() || isSupervisor(); }
function hasPermission(name){ return state.profile?.permissions?.[name] === true; }
function canManageProducts(){ return isAdmin() || isManagerRole() || isFrontLead() || hasPermission('canManageProducts'); }
function canManageLots(){ return isAdmin() || isManagerRole() || isFrontLead() || hasPermission('canManageLots'); }
function canAdjustStock(){ return isAdmin() || isManagerRole() || isFrontLead() || hasPermission('canAdjustStock'); }
function canViewReports(){ return isAdmin() || isManagerRole() || isFrontLead() || hasPermission('canViewReports'); }
function canApprove(){ return isAdmin() || isManagerRole() || isFrontLead() || hasPermission('canApprove'); }
function canReturnIssue(){ return isAdmin() || isManagerRole() || hasPermission('canReturnIssue') || hasPermission('canIssueReturn'); }
function requireIssueReturnPermission(){ if(!canReturnIssue()){ toast('คุณไม่มีสิทธิ์คืนของจากการเบิก'); return false; } return true; }
// คงชื่อ isManager ไว้เพื่อไม่ให้โค้ดเดิมเสีย: หมายถึงผู้ที่จัดการสินค้าได้
function isManager(){ return canManageProducts(); }
function canAssignApprovers(){ return isAdmin() || isManagerRole() || isFrontLead(); }

// ---------- Role Area Permission (v34.28.10) ----------
function normalizeArrayStrings(value){
  const raw=Array.isArray(value)?value:String(value||'').split(',');
  const out=[];
  raw.map(x=>String(x||'').trim()).forEach(x=>{ if(x && !out.includes(x)) out.push(x); });
  return out;
}
function stockAreaAccessKey(groupId,areaId){ return `${String(groupId||'').trim()}::${String(areaId||'').trim()}`; }
function normalizeMemberStockAccess(profile={}){
  const raw=profile?.stockAccess||{};
  const mode=raw.mode==='restricted'?'restricted':'all';
  return {mode,groupIds:normalizeArrayStrings(raw.groupIds),areaKeys:normalizeArrayStrings(raw.areaKeys)};
}
function isStockAccessUnrestricted(profile=state.profile){
  if(!profile || String(profile.role||'staff')==='admin') return true;
  const access=normalizeMemberStockAccess(profile);
  return access.mode!=='restricted';
}
function canAccessStockGroup(groupId,profile=state.profile){
  if(isStockAccessUnrestricted(profile)) return true;
  const access=normalizeMemberStockAccess(profile);
  const gid=String(groupId||'').trim();
  return access.groupIds.includes(gid) || access.areaKeys.some(key=>key.startsWith(`${gid}::`));
}
function canAccessStockLocation(groupId,areaId,profile=state.profile){
  if(isStockAccessUnrestricted(profile)) return true;
  const access=normalizeMemberStockAccess(profile);
  const gid=String(groupId||'').trim(), aid=String(areaId||'').trim();
  return access.groupIds.includes(gid) || access.areaKeys.includes(stockAreaAccessKey(gid,aid));
}
function canAccessProduct(product={},profile=state.profile){
  if(isStockAccessUnrestricted(profile)) return true;
  if(!product || !product.id) return false;
  const loc=productStockLocation(product);
  return canAccessStockLocation(loc.stockGroupId,loc.stockAreaId,profile);
}
function accessibleProducts(products=state.products,profile=state.profile){
  const list=Array.isArray(products)?products:[];
  if(isStockAccessUnrestricted(profile)) return list;
  return list.filter(p=>canAccessProduct(p,profile));
}
function canAccessLogEntry(log={},profile=state.profile){
  if(isStockAccessUnrestricted(profile)) return true;
  const actorUid=String(log.actorUid||log.submittedByUid||log.createdByUid||'');
  if(actorUid && actorUid===String(state.user?.uid||'')) return true;
  const gid=String(log.stockGroupId||'').trim(), aid=String(log.stockAreaId||'').trim();
  if(gid) return canAccessStockLocation(gid,aid,profile);
  const productId=String(log.productId||'').trim();
  if(productId){
    const product=state.products.find(p=>String(p.id)===productId);
    return product ? canAccessProduct(product,profile) : false;
  }
  return false;
}
function approvalAccessibleToUser(item={},profile=state.profile){
  if(isOwnApproval(item)) return true;
  if(isStockAccessUnrestricted(profile)) return true;
  const gid=String(item.stockGroupId||'').trim(), aid=String(item.stockAreaId||'').trim();
  if(gid) return canAccessStockLocation(gid,aid,profile);
  const product=state.products.find(p=>String(p.id)===String(item.productId||''));
  return product ? canAccessProduct(product,profile) : false;
}
function accessibleApprovals(items=state.approvals,profile=state.profile){
  const list=Array.isArray(items)?items:[];
  if(isStockAccessUnrestricted(profile)) return list;
  return list.filter(item=>approvalAccessibleToUser(item,profile));
}
function memberStockAccessSummary(member={}){
  const access=normalizeMemberStockAccess(member);
  if(access.mode!=='restricted') return 'เห็นทุกกลุ่มและทุกพื้นที่';
  const structure=currentStockStructure();
  const groupNames=access.groupIds.map(id=>structure.groups.find(g=>g.id===id)?.name||id);
  const areaNames=[];
  structure.groups.forEach(g=>(g.areas||[]).forEach(a=>{ if(access.areaKeys.includes(stockAreaAccessKey(g.id,a.id))) areaNames.push(`${g.name} / ${a.name}`); }));
  const merged=[...groupNames,...areaNames];
  return merged.length?merged.join(', '):'ยังไม่ได้กำหนดพื้นที่';
}

function requireManager(){ if(!canManageProducts()){ toast('เฉพาะ Manager / Supervisor / Captain หรือผู้ดูแลระบบเท่านั้น'); return false; } return true; }
function requireApprover(){ if(!canApprove()){ toast('คุณไม่ได้รับสิทธิ์ตรวจสอบและอนุมัติ'); return false; } return true; }
function isOwnApproval(item){ return !!item && item.submittedByUid===state.user?.uid; }
function canEditPendingApproval(item){ return canApprove() || isOwnApproval(item); }
function requirePendingOwnerOrApprover(item){
  if(!canEditPendingApproval(item)){
    toast('คุณแก้ไขได้เฉพาะรายการของตัวเอง');
    return false;
  }
  return true;
}
function requireAdmin(){ if(!isAdmin()){ toast('เฉพาะ Admin เท่านั้น'); return false; } return true; }
function escapeHtml(s=''){ return String(s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
function makeEventId(prefix='EVT'){
  const d=new Date();
  const stamp=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0'),String(d.getHours()).padStart(2,'0'),String(d.getMinutes()).padStart(2,'0'),String(d.getSeconds()).padStart(2,'0')].join('');
  return `${prefix}-${stamp}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
}
function actorSnapshot(){
  return {actorUid:state.user?.uid||'',actorName:state.profile?.displayName||state.profile?.username||'ไม่ทราบผู้ใช้',actorRole:role()};
}
function logPayload(action,detail,extra={}){
  return {action,detail,time:new Date().toLocaleString('th-TH'),createdAt:serverTimestamp(),...actorSnapshot(),...extra};
}
function auditPayload(action,detail,extra={}){
  return {action,detail,createdAt:serverTimestamp(),immutable:true,...actorSnapshot(),...extra};
}
async function addAudit(action,detail,extra={}){
  return addDoc(auditRef(),auditPayload(action,detail,extra));
}
async function addLog(action,detail,extra={}){
  const eventId=extra.eventId||makeEventId();
  const logDoc=doc(logRef()),auditDoc=doc(auditRef());
  const batch=writeBatch(fs);
  batch.set(logDoc,logPayload(action,detail,{...extra,eventId}));
  batch.set(auditDoc,auditPayload(action,detail,{...extra,eventId,logId:logDoc.id}));
  await batch.commit();
  return logDoc;
}

// ---------- ตำแหน่งสต็อกเบิก/รับ ----------
const STORE_LOCATION = 'Store FB';
const LOCATION_OPTIONS = DEFAULT_ISSUE_DESTINATIONS;
function locationFieldHtml(selectId, otherId, selectedValue='', groupId=''){
  const selected=String(selectedValue||'').trim();
  const options=issueDestinationsForGroup(groupId);
  const isKnown=options.includes(selected);
  const useOther=selected && !isKnown;
  return `<select id="${selectId}" class="new-item-input new-item-location-select issue-destination-select" onchange="window.toggleLocationOther('${selectId}','${otherId}')">
    <option value="">เลือกสถานที่เบิกไปใช้</option>
    ${options.map(o=>`<option value="${escapeHtml(o)}" ${selected===o?'selected':''}>${escapeHtml(o)}</option>`).join('')}
  </select>
  <input id="${otherId}" placeholder="ระบุสถานที่เบิกไปใช้" value="${useOther?escapeHtml(selected):''}" class="new-item-input issue-destination-other ${useOther?'':'hidden'}">`;
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

function issueDestinationPickerMarkup(selectId='scanIssueDestination',otherId='scanIssueDestinationOther',selectedValue='',groupId=''){
  return `<div id="${selectId}Wrap" class="issue-destination-picker" data-group-id="${escapeHtml(groupId||'')}"><div class="issue-destination-title">สถานที่เบิกไปใช้</div>${locationFieldHtml(selectId,otherId,selectedValue,groupId)}</div>`;
}
function refreshIssueDestinationPicker(selectId='scanIssueDestination',otherId='scanIssueDestinationOther',groupId=''){
  const wrap=$(selectId+'Wrap');
  if(!wrap) return;
  const current=getIssueDestinationValue(selectId,otherId);
  wrap.outerHTML=issueDestinationPickerMarkup(selectId,otherId,current,groupId);
}
function getIssueDestinationValue(selectId='scanIssueDestination',otherId='scanIssueDestinationOther'){
  return getLocationValue(selectId,otherId).trim();
}
function movementDestinationLabel(raw={}){
  const move=String(raw.moveType||raw.type||raw._type||'').toLowerCase();
  const isOut=move==='out' || isWithdrawLog(raw);
  if(!isOut) return '';
  return String(raw.destinationLocation||raw.issueDestination||raw.issueLocation||raw.useLocation||raw.location||'').trim();
}
function movementStockSourceLabel(raw={}){
  return String(raw.stockLocation||stockLocationPath(raw)||'').trim();
}
function reportMovementDisplayLocationLabel(raw={}){
  const move=String(raw._type||raw.moveType||raw.type||'').toLowerCase();
  if(move==='out') return movementDestinationLabel(raw) || 'ไม่ระบุสถานที่เบิกไปใช้';
  return reportLocationLabel(raw);
}
function approvalDestinationLabel(a={}){
  return movementDestinationLabel(a);
}


// ---------- Multi-house receive/issue location guard (v34.29.3) ----------
function stockLocationPath(loc={}){
  const group=cleanStockCardLocationPart(loc.stockGroupName||'');
  const area=cleanStockCardLocationPart(loc.stockAreaName||'');
  return (group && area) ? `${group} / ${area}` : (loc.stockAreaPath||area||group||STORE_LOCATION);
}
function firstAccessibleStockLocationForScan(){
  const group=activeStockGroups()[0] || currentStockStructure().groups[0] || DEFAULT_STOCK_STRUCTURE.groups[0];
  const area=activeStockAreas(group.id)[0] || visibleStockAreasForGroup(group,false)[0] || visibleStockAreasForGroup(group,true)[0] || DEFAULT_STOCK_STRUCTURE.groups[0].areas[0];
  return {stockGroupId:group.id,stockGroupName:group.name,stockAreaId:area.id,stockAreaName:area.name,stockAreaPath:`${group.name} / ${area.name}`};
}
function scanAreasForGroup(groupId){
  const group=currentStockStructure().groups.find(g=>g.id===groupId) || activeStockGroups()[0] || currentStockStructure().groups[0];
  return visibleStockAreasForGroup(group,false).filter(a=>canAccessStockLocation(group.id,a.id));
}
function getScanSelectedStockLocation(){
  const groups=activeStockGroups();
  const fallback=firstAccessibleStockLocationForScan();
  let groupId=String($('scanStockGroup')?.value || state.scanGroupId || fallback.stockGroupId || '').trim();
  if(!groups.some(g=>g.id===groupId)) groupId=fallback.stockGroupId;
  const group=groups.find(g=>g.id===groupId) || currentStockStructure().groups.find(g=>g.id===groupId) || {id:fallback.stockGroupId,name:fallback.stockGroupName};
  const areas=scanAreasForGroup(groupId);
  let areaId=String($('scanStockArea')?.value || state.scanAreaId || (areas.length>1?'all':(areas[0]?.id||fallback.stockAreaId)) || '').trim();
  const allowAll=areas.length>1;
  if(areaId==='all' && !allowAll) areaId=areas[0]?.id||fallback.stockAreaId;
  if(areaId!=='all' && !areas.some(a=>a.id===areaId)) areaId=allowAll?'all':(areas[0]?.id||fallback.stockAreaId);
  const area=areas.find(a=>a.id===areaId) || {id:areaId,name:areaId==='all'?'ทุกพื้นที่ในบ้านนี้':fallback.stockAreaName};
  const areaName=areaId==='all'?'ทุกพื้นที่ในบ้านนี้':area.name;
  return {stockGroupId:group.id,stockGroupName:group.name,stockAreaId:areaId,stockAreaName:areaName,stockAreaPath:areaId==='all'?`${group.name} / ${areaName}`:`${group.name} / ${area.name}`,allAreas:areaId==='all'};
}
function scanAreaOptionsMarkup(groupId,selectedAreaId='all'){
  const areas=scanAreasForGroup(groupId);
  if(!areas.length) return '<option value="">ไม่มีพื้นที่ที่ได้รับสิทธิ์</option>';
  const useAll=areas.length>1;
  const safe=useAll ? (selectedAreaId||'all') : areas[0].id;
  const allOption=useAll?`<option value="all" ${safe==='all'?'selected':''}>ทุกพื้นที่ในบ้านนี้</option>`:'';
  return allOption + areas.map(a=>`<option value="${escapeHtml(a.id)}" ${safe===a.id?'selected':''}>${escapeHtml(a.name)}</option>`).join('');
}
function scanStockLocationSelectorMarkup(type='out'){
  const groups=activeStockGroups();
  const fallback=firstAccessibleStockLocationForScan();
  let selectedGroup=String(state.scanGroupId||fallback.stockGroupId||'');
  if(!groups.some(g=>g.id===selectedGroup)) selectedGroup=fallback.stockGroupId;
  const selectedArea=String(state.scanAreaId||'all');
  const groupOptions=(groups.length?groups:[{id:fallback.stockGroupId,name:fallback.stockGroupName}]).map(g=>`<option value="${escapeHtml(g.id)}" ${selectedGroup===g.id?'selected':''}>🏠 ${escapeHtml(g.name)}</option>`).join('');
  const groupLabel=type==='in'?'คลังรับเข้า':'คลังที่เบิก';
  const areaLabel=type==='in'?'พื้นที่รับเข้า':'พื้นที่ที่เบิก';
  return `<div class="new-item-location-picker"><div class="new-item-location-title">ตำแหน่งสต็อก</div><div class="new-item-location-rows"><div class="new-item-location-row"><div class="new-item-location-row-label">คลัง</div><select id="scanStockGroup" class="new-item-input new-item-location-select" aria-label="${groupLabel}" onchange="window.updateScanStockAreaSelect()">${groupOptions}</select></div><div class="new-item-location-row"><div class="new-item-location-row-label">พื้นที่</div><select id="scanStockArea" class="new-item-input new-item-location-select" aria-label="${areaLabel}" onchange="window.updateScanStockLocation()">${scanAreaOptionsMarkup(selectedGroup,selectedArea)}</select></div></div></div>`;
}
function clearScanProductSelection(){
  ['scanProduct','scanProductSearch'].forEach(id=>{ const el=$(id); if(el) el.value=''; });
  const selected=$('scanProductSelected'); if(selected) selected.innerHTML='';
  const lots=$('scanLotSection'); if(lots) lots.innerHTML='';
  const unit=$('newItemUnitLabel'); if(unit) unit.textContent='หน่วย';
}
function productMatchesScanLocation(product={},selected=getScanSelectedStockLocation()){
  const loc=productStockLocation(product);
  if(loc.stockGroupId!==selected.stockGroupId) return false;
  if(selected.stockAreaId==='all') return true;
  return loc.stockAreaId===selected.stockAreaId;
}
function scanProductLocationLabel(product={}){ return stockLocationPath(productStockLocation(product)); }
function scanFixedProductLocationMarkup(product={},type='out'){
  const label=type==='in'?'รับเข้า':'เบิกจาก';
  return `<div class="new-item-fixed-location"><span>📍 ${escapeHtml(label)}:</span><b>${escapeHtml(scanProductLocationLabel(product))}</b></div>`;
}
window.updateScanStockAreaSelect=()=>{
  const groupEl=$('scanStockGroup'), areaEl=$('scanStockArea');
  if(!groupEl||!areaEl) return;
  state.scanGroupId=groupEl.value;
  const areas=scanAreasForGroup(state.scanGroupId);
  state.scanAreaId=areas.length>1?'all':(areas[0]?.id||'');
  areaEl.innerHTML=scanAreaOptionsMarkup(state.scanGroupId,state.scanAreaId);
  refreshIssueDestinationPicker('scanIssueDestination','scanIssueDestinationOther',state.scanGroupId);
  clearScanProductSelection();
  renderScanProductResults('');
  saveNewItemDraft();
};
window.updateScanStockLocation=()=>{
  state.scanGroupId=$('scanStockGroup')?.value||state.scanGroupId||'';
  state.scanAreaId=$('scanStockArea')?.value||state.scanAreaId||'all';
  refreshIssueDestinationPicker('scanIssueDestination','scanIssueDestinationOther',state.scanGroupId);
  clearScanProductSelection();
  renderScanProductResults('');
  saveNewItemDraft();
};
function approvalStockLocationLabel(a={}){
  const p=state.products.find(x=>String(x.id)===String(a.productId||''));
  if(p) return scanProductLocationLabel(p);
  if(a.stockGroupName||a.stockAreaName) return stockLocationPath(a);
  return a.location||STORE_LOCATION;
}

// ---------- แสดงผล badge ของ log แยกทิศทาง รับ/เบิก ให้ชัดเจน ----------
const MOVE_TYPE_LABEL = {in:'รับเข้า', out:'เบิกออก'};
function logPillInfo(l){
  let label = l.action, cls = '';
  if(l.action==='เบิกออก'){ cls='warn'; label='↑ เบิกออก'; }
  else if(l.action==='รับเข้า'){ cls='ok'; label='↓ รับเข้า'; }
  else if(isIssueReturnLog(l)){ cls='ok'; label='↩ คืนของ'; }
  else if(l.action==='อนุมัติ'){
    cls = l.moveType==='out' ? 'warn' : (l.moveType==='in' ? 'ok' : 'ok');
    label = `✅ อนุมัติ${l.moveType?` • ${l.moveType==='out'?'↑ เบิกออก':'↓ รับเข้า'}`:''}`;
  } else if(l.action==='ปฏิเสธ'){
    cls = 'bad';
    label = `✕ ปฏิเสธ${l.moveType?` • ${l.moveType==='out'?'↑ เบิกออก':'↓ รับเข้า'}`:''}`;
  } else if(l.action==='ส่งตรวจ'){
    cls = '';
    label = `⏳ ส่งตรวจ${l.moveType?` • ${l.moveType==='out'?'↑ เบิกออก':'↓ รับเข้า'}`:''}`;
  } else if(isAdjustmentLog(l)){
    cls = '';
    label = '⚖️ ปรับยอดสินค้า';
  } else if(l.action==='ยกเลิก'){
    cls = 'bad';
    label = `↩ ยกเลิก${l.moveType?` • ${l.moveType==='out'?'↑ เบิกออก':'↓ รับเข้า'}`:''}`;
  }
  return { label, cls };
}

// ---------- รายงานยอดเบิกแยกตามตำแหน่งสต็อก (รายวัน/รายเดือน) ----------
function pad2(n){ return String(n).padStart(2,'0'); }
function toDateStr(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function toMonthStr(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`; }
function shiftDateStr(str,delta){ const [y,m,d]=str.split('-').map(Number); const dt=new Date(y,m-1,d); dt.setDate(dt.getDate()+delta); return toDateStr(dt); }
function shiftMonthStr(str,delta){ const [y,m]=str.split('-').map(Number); const dt=new Date(y,m-1,1); dt.setMonth(dt.getMonth()+delta); return toMonthStr(dt); }

// ---------- Date utilities (v32 Stable) ----------
// Parse YYYY-MM-DD as local time, not UTC. Returns null for invalid input.
function parseLocalDate(value){
  if(value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  const text=String(value||'').trim();
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if(!match) return null;
  const y=Number(match[1]), m=Number(match[2]), d=Number(match[3]);
  const date=new Date(y,m-1,d,0,0,0,0);
  if(date.getFullYear()!==y || date.getMonth()!==m-1 || date.getDate()!==d) return null;
  return date;
}
function isSameLocalDay(a,b){
  const da=a instanceof Date?a:parseLocalDate(a);
  const db=b instanceof Date?b:parseLocalDate(b);
  return !!da && !!db && da.getFullYear()===db.getFullYear() && da.getMonth()===db.getMonth() && da.getDate()===db.getDate();
}
function isDateInLocalRange(value,start,end){
  const date=value instanceof Date?value:parseLocalDate(value);
  const from=start instanceof Date?start:parseLocalDate(start);
  const to=end instanceof Date?end:parseLocalDate(end);
  if(!date||!from||!to) return false;
  const time=new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime();
  const min=Math.min(from.getTime(),to.getTime());
  const max=Math.max(from.getTime(),to.getTime());
  return time>=min && time<=max;
}
function timestampToDateValue(value){
  if(!value) return null;
  if(value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if(typeof value.toDate==='function'){
    const date=value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if(typeof value.seconds==='number'){
    const date=new Date(value.seconds*1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if(typeof value==='number'){
    const date=new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if(typeof value==='string'){
    const local=parseLocalDate(value);
    if(local) return local;
    const date=new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}
function getRecordDate(raw={},fields=['createdAt']){
  for(const field of fields){
    const date=timestampToDateValue(raw?.[field]);
    if(date) return date;
  }
  return null;
}
function getLogDate(l){
  return getRecordDate(l,[
    'createdAt',
    'timestamp',
    'dateTime',
    'date',
    'dateKey',
    'submittedAt',
    'approvedAt',
    'rejectedAt',
    'updatedAt'
  ]);
}
function getReportRecordDate(raw={}){
  return getRecordDate(raw,[
    'createdAt',
    'approvedAt',
    'submittedAt',
    'rejectedAt',
    'updatedAt',
    'timestamp',
    'dateTime',
    'date',
    'dateKey'
  ]);
}
function isDateWithinBounds(date,bounds){
  return !!date && !!bounds && date>=bounds.start && date<=bounds.end;
}
// Compatibility helper for report export and older cached code.
function normalizeLogDate(log){ return getLogDate(log); }

// นับเฉพาะ Log ที่ทำให้สต๊อกเปลี่ยนจริง
function isWithdrawLog(l){
  return l.action==='เบิกออก' || (l.action==='อนุมัติ' && l.moveType==='out');
}
function isReceiveLog(l){
  return l.action==='รับเข้า' || (l.action==='อนุมัติ' && l.moveType==='in');
}
function isIssueReturnLog(l){
  const action=String(l?.action||'').trim();
  const move=String(l?.moveType||l?.type||'').toLowerCase();
  return action==='คืนของ' || action==='คืนของจากการเบิก' || move==='return' || move==='issue_return';
}
function isApprovedIssueLog(l){
  if(!l || isIssueReturnLog(l)) return false;
  const status=String(l.status||'approved').toLowerCase();
  return isWithdrawLog(l) && status!=='pending' && status!=='rejected' && String(l.action||'')!=='ส่งตรวจ' && String(l.action||'')!=='ปฏิเสธ';
}
function issueReturnOriginalMatches(returnLog={},issueLog={}){
  const issueId=String(issueLog?.id||'').trim();
  const issueEvent=String(issueLog?.eventId||'').trim();
  const originalId=String(returnLog.originalLogId||returnLog.returnOriginalLogId||returnLog.sourceLogId||'').trim();
  const originalEvent=String(returnLog.originalEventId||returnLog.returnOriginalEventId||'').trim();
  return !!(isIssueReturnLog(returnLog) && ((issueId && originalId===issueId) || (issueEvent && originalEvent===issueEvent)));
}
function returnedQtyForIssueLog(issueLog={}){
  const originalQty=Number(issueLog.qty)||0;
  const stored=Math.max(0,Number(issueLog.returnedQty??issueLog.issueReturnedQty??0)||0);
  const fromLogs=(state.logs||[]).filter(r=>issueReturnOriginalMatches(r,issueLog)).reduce((sum,r)=>sum+(Number(r.qty)||0),0);
  return Math.min(originalQty,Math.max(stored,fromLogs));
}
function remainingReturnQtyForIssueLog(issueLog={}){
  return Math.max(0,(Number(issueLog.qty)||0)-returnedQtyForIssueLog(issueLog));
}
function issueReturnStatusText(issueLog={}){
  const returned=returnedQtyForIssueLog(issueLog), total=Number(issueLog.qty)||0, unit=issueLog.unit||'';
  if(!returned) return `ยังไม่คืน • คืนได้ ${total} ${unit}`;
  const remain=Math.max(0,total-returned);
  return remain>0 ? `คืนแล้ว ${returned} ${unit} • ยังคืนได้ ${remain} ${unit}` : `คืนครบแล้ว ${returned} ${unit}`;
}

function qtyUnitText(qty,unit=''){
  const n=Number(qty)||0;
  const u=String(unit||'').trim();
  return `${n.toLocaleString('th-TH')}${u?` ${u}`:''}`;
}
function issueReturnLogsForIssue(issueLog={}){
  return (state.logs||[])
    .filter(r=>issueReturnOriginalMatches(r,issueLog))
    .sort((a,b)=>(getLogDate(b)?.getTime()||0)-(getLogDate(a)?.getTime()||0));
}
function originalIssueLogForReturn(returnLog={}){
  const originalId=String(returnLog.originalLogId||returnLog.returnOriginalLogId||returnLog.sourceLogId||'').trim();
  const originalEvent=String(returnLog.originalEventId||returnLog.returnOriginalEventId||'').trim();
  return (state.logs||[]).find(l=>isApprovedIssueLog(l) && ((originalId && String(l.id||'')===originalId) || (originalEvent && String(l.eventId||'')===originalEvent))) || null;
}
function issueReturnSummary(issueLog={}){
  const total=Math.max(0,Number(issueLog.qty)||0);
  const returned=returnedQtyForIssueLog(issueLog);
  const remaining=Math.max(0,total-returned);
  const netUsed=remaining;
  const unit=String(issueLog.unit||'').trim();
  return {total,returned,remaining,netUsed,unit,complete:total>0&&returned>=total,partial:returned>0&&returned<total};
}
function historyUseDestinationLabel(log={}){
  if(isIssueReturnLog(log)){
    return String(log.returnFromDestination||log.issueDestination||log.destinationLocation||log.issueLocation||log.useLocation||'').trim() || 'ไม่ระบุสถานที่เบิกไปใช้';
  }
  return historyIssueDestinationLabel(log);
}
function historyReturnInlineMarkup(log={}){
  if(isApprovedIssueLog(log)){
    const s=issueReturnSummary(log);
    if(!s.returned) return '';
    const cls=s.complete?'complete':'partial';
    return `<div class="history-return-inline ${cls}">↩ ${s.complete?'คืนครบแล้ว':'คืนบางส่วน'} ${escapeHtml(qtyUnitText(s.returned,s.unit))} / ${escapeHtml(qtyUnitText(s.total,s.unit))} • ใช้จริง ${escapeHtml(qtyUnitText(s.netUsed,s.unit))}</div>`;
  }
  if(isIssueReturnLog(log)){
    const unit=String(log.unit||'').trim();
    const totalReturned=Number(log.totalReturnedQty ?? log.qty)||Number(log.qty)||0;
    const originalQty=Number(log.originalQty)||Number(originalIssueLogForReturn(log)?.qty)||0;
    const netUsed=Math.max(0,Number(log.netUsedQty ?? (originalQty-totalReturned))||0);
    if(originalQty>0){
      return `<div class="history-return-inline complete">เบิกเดิม ${escapeHtml(qtyUnitText(originalQty,unit))} • คืนแล้วรวม ${escapeHtml(qtyUnitText(totalReturned,unit))} • ใช้จริง ${escapeHtml(qtyUnitText(netUsed,unit))}</div>`;
    }
  }
  return '';
}
function historyReturnRelationMarkup(log={}){
  if(isIssueReturnLog(log)){
    const original=originalIssueLogForReturn(log);
    return original ? `<button class="btn light full" onclick="window.viewHistoryEntry('${escapeHtml(original.id||'')}')">ดูรายการเบิกต้นทาง</button>` : `<div class="history-detail-note">รายการเบิกต้นทางอาจยังไม่ได้โหลดอยู่ในช่วงวันที่นี้</div>`;
  }
  if(isApprovedIssueLog(log)){
    const returns=issueReturnLogsForIssue(log);
    if(!returns.length) return '';
    return `<div class="history-return-linked-list">${returns.map((r,i)=>`<button class="btn light full" onclick="window.viewHistoryEntry('${escapeHtml(r.id||'')}')">ดูรายการคืนของครั้งที่ ${i+1} • ${escapeHtml(qtyUnitText(r.qty,r.unit||log.unit||''))}</button>`).join('')}</div>`;
  }
  return '';
}
function historyReturnDetailMarkup(log={}){
  if(isIssueReturnLog(log)){
    const original=originalIssueLogForReturn(log);
    const unit=String(log.unit||original?.unit||'').trim();
    const originalQty=Number(log.originalQty)||Number(original?.qty)||0;
    const totalReturned=Number(log.totalReturnedQty ?? log.qty)||Number(log.qty)||0;
    const netUsed=Math.max(0,Number(log.netUsedQty ?? (originalQty-totalReturned))||0);
    const previousStock=log.previousStock!==undefined ? qtyUnitText(log.previousStock,unit) : '-';
    const newStock=log.newStock!==undefined ? qtyUnitText(log.newStock,unit) : '-';
    const returnedNow=qtyUnitText(log.qty,unit);
    return `<section class="history-detail-section history-return-detail-section"><h3>สรุปการคืนของ</h3><div class="history-return-grid">
      <div><span>สต๊อกก่อนคืน</span><b>${escapeHtml(previousStock)}</b></div>
      <div><span>คืนกลับครั้งนี้</span><b>${escapeHtml(returnedNow)}</b></div>
      <div><span>สต๊อกหลังคืน</span><b>${escapeHtml(newStock)}</b></div>
      <div><span>เบิกเดิม</span><b>${escapeHtml(originalQty?qtyUnitText(originalQty,unit):'-')}</b></div>
      <div><span>คืนแล้วทั้งหมด</span><b>${escapeHtml(totalReturned?qtyUnitText(totalReturned,unit):returnedNow)}</b></div>
      <div><span>ใช้จริงสุทธิ</span><b>${escapeHtml(originalQty?qtyUnitText(netUsed,unit):'-')}</b></div>
    </div>${historyReturnRelationMarkup(log)}</section>`;
  }
  if(isApprovedIssueLog(log)){
    const s=issueReturnSummary(log);
    const status=s.returned ? (s.complete?'คืนครบแล้ว':'คืนบางส่วน') : 'ยังไม่มีคืนของ';
    return `<section class="history-detail-section history-return-detail-section"><h3>สรุปเบิก / คืน / ใช้จริง</h3><div class="history-return-grid">
      <div><span>เบิกออกเดิม</span><b>${escapeHtml(qtyUnitText(s.total,s.unit))}</b></div>
      <div><span>คืนแล้ว</span><b>${escapeHtml(qtyUnitText(s.returned,s.unit))}</b></div>
      <div><span>ใช้จริงสุทธิ</span><b>${escapeHtml(qtyUnitText(s.netUsed,s.unit))}</b></div>
      <div><span>ยังคืนได้</span><b>${escapeHtml(qtyUnitText(s.remaining,s.unit))}</b></div>
      <div><span>สถานะคืนของ</span><b>${escapeHtml(status)}</b></div>
    </div>${historyReturnRelationMarkup(log)}</section>`;
  }
  return '';
}
function isStockMovementLog(l){ return isWithdrawLog(l) || isReceiveLog(l); }


// ---------- Realtime listeners: ยกเลิกของเดิมก่อนผูกใหม่เสมอ กันปัญหา listener ค้าง/ซ้อนข้ามบัญชี ----------
let unsubProducts=null, unsubApprovals=null, unsubLogs=null, unsubAudit=null, unsubSettings=null;
let productsSnapshotReady=false;
const LOG_PAGE_SIZE=400;
const AUDIT_REALTIME_LIMIT=200;
let logsCursor=null;
let logsHasMore=true;
let logsLoadingMore=false;
let __lastLoadError=null;
function humanizeAppError(error){
  const code=String(error?.code||'').toLowerCase();
  const msg=String(error?.message||'').toLowerCase();
  const offline=(navigator.onLine===false)||code.includes('unavailable')||msg.includes('client is offline')||msg.includes('network');
  if(offline){
    return {
      icon:'📡',
      title:'ไม่มีการเชื่อมต่ออินเทอร์เน็ต',
      detail:'ไม่สามารถโหลดข้อมูลล่าสุดได้ในขณะนี้ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วกด “ลองใหม่”',
      kind:'offline'
    };
  }
  if(code.includes('permission-denied')){
    return {
      icon:'🔒',
      title:'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้',
      detail:'บัญชีของคุณไม่มีสิทธิ์สำหรับข้อมูลส่วนนี้ หรือสิทธิ์ยังไม่อัปเดต กรุณาติดต่อผู้ดูแลระบบ',
      kind:'permission'
    };
  }
  if(code.includes('unauthenticated')){
    return {
      icon:'🔐',
      title:'เซสชันหมดอายุ',
      detail:'กรุณาเข้าสู่ระบบใหม่เพื่อดำเนินการต่อ',
      kind:'auth'
    };
  }
  if(code.includes('deadline-exceeded')||code.includes('resource-exhausted')){
    return {
      icon:'⏳',
      title:'ระบบตอบสนองช้ากว่าปกติ',
      detail:'คำขอใช้เวลานานหรือมีการใช้งานจำนวนมาก กรุณารอสักครู่แล้วลองใหม่',
      kind:'retry'
    };
  }
  return {
    icon:'⚠️',
    title:'เกิดข้อผิดพลาด',
    detail:'ระบบไม่สามารถทำรายการนี้ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง หากยังเกิดซ้ำให้แจ้งผู้ดูแลระบบ',
    kind:'error'
  };
}
function retryLastLoad(){
  if(navigator.onLine===false){
    toast('ยังออฟไลน์อยู่ กรุณาเชื่อมต่ออินเทอร์เน็ตก่อน');
    updateNetworkStatusIndicator(false);
    return;
  }
  const btn=document.getElementById('appRetryButton');
  if(btn){ btn.disabled=true; btn.textContent='⏳ กำลังลองใหม่...'; }
  setTimeout(()=>{
    try{
      if(state?.user){
        bindRealtime();
        render();
      }else{
        location.reload();
      }
    }catch(_){ location.reload(); }
  },150);
}
window.retryLastLoad=retryLastLoad;
function showLoadError(title, error){
  console.error(title, error);
  __lastLoadError={title,error};
  const friendly=humanizeAppError(error);
  const code=error?.code||'';
  view.innerHTML = `<div class="card app-state-card app-state-error">
    <div class="app-state-icon">${friendly.icon}</div>
    <h2>${escapeHtml(friendly.title)}</h2>
    <p>${escapeHtml(friendly.detail)}</p>
    <p class="muted">${friendly.kind==='offline'?'ระบบจะลองเชื่อมต่ออีกครั้งเมื่ออินเทอร์เน็ตกลับมา':'หากยังไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'}</p>
    <button id="appRetryButton" class="btn primary full" onclick="retryLastLoad()">ลองใหม่</button>
    ${code?`<details class="app-error-detail"><summary>รายละเอียดสำหรับผู้ดูแลระบบ</summary><code>${escapeHtml(code)}</code></details>`:''}
  </div>`;
}

let __optionalPermissionNoticeShown=false;
function isPermissionError(error){
  const code=String(error?.code||'').toLowerCase();
  const msg=String(error?.message||'').toLowerCase();
  return code.includes('permission-denied') || msg.includes('permission-denied') || msg.includes('missing or insufficient permissions');
}
function handleOptionalRealtimeError(title,error,applyFallback){
  console.warn(title,error);
  if(isPermissionError(error)){
    try{ if(typeof applyFallback==='function') applyFallback(); }catch(_){ }
    if(!__optionalPermissionNoticeShown){
      __optionalPermissionNoticeShown=true;
      try{ toast('ข้อมูลบางส่วนถูกซ่อนตามสิทธิ์ผู้ใช้'); }catch(_){ }
    }
    try{ render(); }catch(_){ }
    return true;
  }
  showLoadError(title,error);
  return false;
}

function emptyStateHtml(icon,title,detail=''){
  return `<div class="app-state-card app-state-empty"><div class="app-state-icon">${icon}</div><h3>${escapeHtml(title)}</h3>${detail?`<p class="muted">${escapeHtml(detail)}</p>`:''}</div>`;
}
// ---------- Products cache + incremental realtime (v34.8) ----------
// เป้าหมาย: ลดการอ่าน Products ซ้ำทั้ง collection ทุกครั้งที่เปิดเว็บ
// - ครั้งแรกของอุปกรณ์: full sync 1 ครั้ง แล้วเก็บ snapshot ใน IndexedDB
// - ครั้งถัดไป: เปิดจาก cache ทันที และฟังเฉพาะเอกสารที่ updatedAt เปลี่ยนหลัง sync ล่าสุด
// - บังคับ full refresh อย่างน้อยทุก 24 ชม. เพื่อเก็บกวาดกรณี hard-delete จากอุปกรณ์อื่น
const PRODUCT_CACHE_DB='theview-stock-cache-v3-theview-4d389';
const PRODUCT_CACHE_STORE='kv';
const PRODUCT_CACHE_KEY='products-v3-theview-4d389';
const PRODUCT_CACHE_TTL_MS=5*60*1000; // v34.27.6: product cache is only a fast first paint, not source of truth
let productIncrementalUnsub=null;
let productsBindToken=0;
const FORCE_PRODUCT_FULL_SYNC_ON_BOOT=true; // v34.27.6: prevent ghost products after reset/delete on another device
// MAIN environment: keep browser cache isolated under the theview-4d389 namespace.
// Firestore, Authentication, Storage and local cache remain separate from Production.
function openProductCacheDb(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)) return resolve(null);
    const req=indexedDB.open(PRODUCT_CACHE_DB,1);
    req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains(PRODUCT_CACHE_STORE)) db.createObjectStore(PRODUCT_CACHE_STORE); };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function readProductCache(){
  try{
    const db=await openProductCacheDb(); if(!db) return null;
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(PRODUCT_CACHE_STORE,'readonly');
      const req=tx.objectStore(PRODUCT_CACHE_STORE).get(PRODUCT_CACHE_KEY);
      req.onsuccess=()=>resolve(req.result||null); req.onerror=()=>reject(req.error);
    });
  }catch(e){ console.warn('อ่าน Product cache ไม่สำเร็จ',e); return null; }
}
async function writeProductCache(products,lastFullSync=0,lastSyncAt=Date.now()){
  try{
    const db=await openProductCacheDb(); if(!db) return;
    const payload={products,lastFullSync,lastSyncAt,savedAt:Date.now()};
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(PRODUCT_CACHE_STORE,'readwrite');
      tx.objectStore(PRODUCT_CACHE_STORE).put(payload,PRODUCT_CACHE_KEY);
      tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error);
    });
  }catch(e){ console.warn('บันทึก Product cache ไม่สำเร็จ',e); }
}
async function clearProductCache(){
  try{
    const db=await openProductCacheDb(); if(!db) return;
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(PRODUCT_CACHE_STORE,'readwrite');
      tx.objectStore(PRODUCT_CACHE_STORE).delete(PRODUCT_CACHE_KEY);
      tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error);
    });
  }catch(e){ console.warn('ล้าง Product cache ไม่สำเร็จ',e); }
}
async function cleanupOrphanApprovals(validProductIds){
  if(!isAdmin() || !navigator.onLine) return 0;
  const snap=await getDocsFromServer(userPath('approvals'));
  const stale=snap.docs.filter(d=>{
    const productId=String(d.data()?.productId||'').trim();
    return productId && !validProductIds.has(productId);
  });
  for(let i=0;i<stale.length;i+=400){
    const batch=writeBatch(fs);
    stale.slice(i,i+400).forEach(d=>batch.delete(d.ref));
    await batch.commit();
  }
  return stale.length;
}
function mergeProductDocs(incoming){
  const map=new Map(state.products.map(p=>[p.id,p]));
  for(const item of incoming) map.set(item.id,{...(map.get(item.id)||{}),...item});
  state.products=[...map.values()];
}
async function bindProductsOptimized(options={}){
  const forceFullSync=options.forceFullSync===true;
  const token=++productsBindToken;
  productsSnapshotReady=false;
  if(unsubProducts){ try{unsubProducts();}catch(_){} unsubProducts=null; }
  if(productIncrementalUnsub){ try{productIncrementalUnsub();}catch(_){} productIncrementalUnsub=null; }
  try{
    const cached=await readProductCache();
    if(token!==productsBindToken || !state.user) return;
    const now=Date.now();
    const cacheUsable=!forceFullSync && !!(cached && Array.isArray(cached.products) && cached.products.length);
    if(cacheUsable){
      state.products=cached.products;
      productsSnapshotReady=true;
      render();
      // v34.19.7: ล้าง QR Preview เก่าที่ชี้ไปสินค้าที่ถูกลบ/Archive แล้ว
      setTimeout(cleanupPublicProductPreviewsQuietly,700);
    }
    const needsFullSync=forceFullSync || FORCE_PRODUCT_FULL_SYNC_ON_BOOT || !cacheUsable || !cached?.lastFullSync || (now-cached.lastFullSync)>=PRODUCT_CACHE_TTL_MS;
    let effectiveLastFullSync=cached?.lastFullSync||0;
    let incrementalSince=(cached?.lastSyncAt||now)-60000; // overlap 60s กันพลาด serverTimestamp ระหว่าง sync
    if(needsFullSync){
      try{
        const syncStarted=Date.now()-60000;
        const snap=await getDocsFromServer(userPath('products'));
        if(token!==productsBindToken || !state.user) return;
        state.products=snap.docs.map(d=>({id:d.id,...d.data()}));
        const validProductIds=new Set(state.products.map(p=>p.id));
        const validActiveProductIds=new Set(state.products.filter(p=>isPublicProductAllowed(p)).map(p=>p.id));
        try{ await cleanupOrphanApprovals(validProductIds); }catch(e){ console.warn('ล้างรายการค้างไม่สำเร็จ',e); }
        try{ await cleanupPublicProductPreviews(validActiveProductIds); }catch(e){ console.warn('ล้าง QR Preview เก่าไม่สำเร็จ',e); }
        productsSnapshotReady=true;
        effectiveLastFullSync=Date.now();
        await writeProductCache(state.products,effectiveLastFullSync,Date.now());
        incrementalSince=syncStarted;
        render();
      }catch(fullSyncErr){
        // v34.27.6: ถ้ามี cache ใช้เปิดหน้าไว้ได้ แต่ไม่ให้ cache เป็นข้อมูลจริงถาวร
        if(cacheUsable){ console.warn('Full product sync ไม่สำเร็จ ใช้ cache ชั่วคราว',fullSyncErr); }
        else throw fullSyncErr;
      }
    }
    // Listener นี้รับเฉพาะสินค้าที่มีการเปลี่ยนหลังจุด sync แทนการ onSnapshot ทั้ง collection
    const incrementalQuery=query(userPath('products'),where('updatedAt','>=',new Date(incrementalSince)));
    productIncrementalUnsub=onSnapshot(incrementalQuery,async snap=>{
      if(token!==productsBindToken) return;
      const changed=snap.docs.map(d=>({id:d.id,...d.data()}));
      if(changed.length) mergeProductDocs(changed);
      productsSnapshotReady=true;
      await writeProductCache(state.products,effectiveLastFullSync||Date.now(),Date.now());
      render();
    },err=>{
      productsSnapshotReady=true;
      // ถ้ามี cache อยู่ ให้แอปยังทำงานต่อได้และแจ้งเฉพาะ console; ถ้าไม่มีจึงแสดง Error state
      if(cacheUsable) console.warn('Product incremental sync ไม่สำเร็จ',err);
      else showLoadError('โหลดสินค้าไม่สำเร็จ',err);
    });
    unsubProducts=()=>{ if(productIncrementalUnsub){ try{productIncrementalUnsub();}catch(_){} productIncrementalUnsub=null; } };
  }catch(err){ productsSnapshotReady=true; showLoadError('โหลดสินค้าไม่สำเร็จ',err); }
}

function bindSystemSettings(){
  if(unsubSettings){ try{unsubSettings();}catch(_){} unsubSettings=null; }
  if(!state.user) return;
  unsubSettings=onSnapshot(settingsDocRef(),snap=>{
    const data=snap.exists()?snap.data():{};
    state.branding=normalizeBranding(data);
    state.stockStructure=normalizeStockStructure(data.stockStructure||state.stockStructure||{});
    state.stockCardUi=normalizeStockCardUi(data.stockCardUi||state.stockCardUi||{});
    applySystemBranding({...state.branding,stockStructure:state.stockStructure,stockCardUi:state.stockCardUi},{cache:true});
    if(state.page==='profile') renderProfile();
    if(state.page==='stock') renderStock();
  },err=>{
    console.warn('โหลดตั้งค่าหน้าตาระบบไม่สำเร็จ',err);
    applySystemBranding(state.branding,{cache:false});
  });
}

function bindRealtime(){
  productsSnapshotReady=false;
  if(unsubProducts) unsubProducts();
  if(unsubApprovals) unsubApprovals();
  if(unsubLogs) unsubLogs();
  if(unsubAudit) unsubAudit();
  bindSystemSettings();
  bindProductsOptimized();
  state.approvals=[];
  const approvalsSource=canApprove()
    ? userPath('approvals')
    : query(userPath('approvals'),where('submittedByUid','==',state.user.uid));
  unsubApprovals=onSnapshot(
    approvalsSource,
    snap=>{ state.approvals=snap.docs.map(d=>({id:d.id,...d.data()})); render(); },
    err=>handleOptionalRealtimeError('โหลดรายการรออนุมัติไม่สำเร็จ',err,()=>{ state.approvals=[]; })
  );
  unsubLogs = onSnapshot(query(userPath('logs'), orderBy('createdAt','desc'), limit(LOG_PAGE_SIZE)), snap=>{
    const live=snap.docs.map(d=>({id:d.id,...d.data()}));
    // เก็บข้อมูลเก่าที่ผู้ใช้กดโหลดเพิ่มไว้ และอัปเดตข้อมูลล่าสุดแบบ realtime เฉพาะชุดแรก
    const liveIds=new Set(live.map(x=>x.id));
    const older=state.logs.filter(x=>!liveIds.has(x.id));
    state.logs=[...live,...older].sort((a,b)=>(getLogDate(b)?.getTime()||0)-(getLogDate(a)?.getTime()||0));
    logsCursor=snap.docs[snap.docs.length-1]||logsCursor;
    logsHasMore=snap.docs.length===LOG_PAGE_SIZE;
    render();
  }, err=>handleOptionalRealtimeError('โหลดประวัติไม่สำเร็จ',err,()=>{ state.logs=[]; logsCursor=null; logsHasMore=false; }));
  if(canManageProducts()){
    unsubAudit=onSnapshot(query(userPath('auditLogs'),orderBy('createdAt','desc'),limit(AUDIT_REALTIME_LIMIT)),snap=>{state.auditLogs=snap.docs.map(d=>({id:d.id,...d.data()}));},err=>console.warn('โหลด Audit Log ไม่สำเร็จ',err));
  }
}
function unbindRealtime(){
  productsBindToken++;
  if(unsubProducts){ unsubProducts(); unsubProducts=null; }
  if(productIncrementalUnsub){ try{productIncrementalUnsub();}catch(_){} productIncrementalUnsub=null; }
  if(unsubApprovals){ unsubApprovals(); unsubApprovals=null; }
  if(unsubLogs){ unsubLogs(); unsubLogs=null; }
  if(unsubAudit){ unsubAudit(); unsubAudit=null; }
  if(unsubSettings){ unsubSettings(); unsubSettings=null; }
  productsSnapshotReady=false; state.products=[]; state.approvals=[]; state.logs=[]; state.auditLogs=[]; logsCursor=null; logsHasMore=true; logsLoadingMore=false;
}
async function submitLogin(){
  const username=normalizeUsername($('username').value), password=$('password').value;
  if(!username||!password) return toast('กรอก Username และ Password');
  const btn=$('loginBtn');
  btn.disabled=true;
  btn.textContent='กำลังเข้าสู่ระบบ...';
  window.__CHEE_AUTH_PHASE__='signing-in';
  try{
    await withTimeout(authPersistenceReady,5000,'auth-persistence-timeout').catch(()=>{});
    showBootScreen('กำลังเข้าสู่ระบบ...');
    const credential=await withTimeout(signInWithEmailAndPassword(auth,usernameToEmail(username),password),22000,'login-timeout');
    window.__CHEE_AUTH_PHASE__='login-success';
    await startAuthenticatedSession(credential.user,'manual-login');
  }catch(e){
    const code=String(e?.code||'auth/unknown-error');
    console.error('[TheView Stock] Firebase login error', {
      code,
      message:e?.message,
      hostname:location.hostname,
      email:usernameToEmail(username)
    });
    const messages={
      'auth/invalid-credential':'Username หรือ Password ไม่ถูกต้อง',
      'auth/invalid-login-credentials':'Username หรือ Password ไม่ถูกต้อง',
      'auth/user-not-found':'ไม่พบบัญชีผู้ใช้นี้ใน Firebase Authentication',
      'auth/wrong-password':'Password ไม่ถูกต้อง',
      'auth/unauthorized-domain':'โดเมนนี้ยังไม่ได้รับอนุญาตใน Firebase Authentication',
      'auth/network-request-failed':'เชื่อมต่อ Firebase ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตหรือการบล็อกเครือข่าย',
      'auth/too-many-requests':'มีการลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
      'auth/user-disabled':'บัญชีนี้ถูกปิดการใช้งาน',
      'auth/operation-not-allowed':'วิธีเข้าสู่ระบบ Email/Password ยังไม่ได้เปิดใช้งานใน Firebase'
    };
    const detail=code==='app/timeout'?friendlyTimeoutMessage('login'):messages[code]||'เกิดข้อผิดพลาดจาก Firebase Authentication';
    window.__CHEE_AUTH_PHASE__='login-failed';
    $('bootPage')?.classList.add('hidden');
    $('app')?.classList.add('hidden');
    $('passwordGate')?.classList.add('hidden');
    $('loginPage')?.classList.remove('hidden');
    document.body.classList.add('auth-screen-active');
    toast(`เข้าสู่ระบบไม่ได้: ${detail} (${code})`);
  }
  finally{ btn.disabled=false; btn.textContent='เข้าสู่ระบบ'; }
}
$('loginBtn').onclick=submitLogin;
window.__CHEE_LOGIN_BIND_READY__=true;
$('username').addEventListener('keydown',e=>{ if(e.key==='Enter') $('password').focus(); });
$('password').addEventListener('keydown',e=>{ if(e.key==='Enter') submitLogin(); });
const legacyLogoutBtn=$('logoutBtn');
if(legacyLogoutBtn){ legacyLogoutBtn.onclick=null; legacyLogoutBtn.classList.add('hidden'); }
$('modalCloseBtn').onclick=hideModal;
$('firstPasswordBtn').onclick=()=>window.saveNewPassword(true);
$('passwordGateLogout').onclick=logoutAndCloseMenu;



function closeHeaderMenu(){
  const panel=$('headerMenuPanel');
  const btn=$('headerMenuBtn');
  if(panel){
    panel.classList.add('hidden');
    panel.style.visibility='';
    panel.style.pointerEvents='';
  }
  if(btn) btn.setAttribute('aria-expanded','false');
  document.body.classList.remove('header-menu-open');
}

function resetNavigationAfterLogout(){
  // Logout starts a new session: always return the next login to Dashboard.
  state.page='home';
  state.viewProductId=null;
  state.productDetailTab='general';
  localStorage.setItem(LAST_PAGE_KEY,'home');
  localStorage.removeItem(PRODUCT_DETAIL_KEY);
  localStorage.removeItem(LAST_SCROLL_KEY);
  localStorage.removeItem(LAST_SCROLL_MAP_KEY);
}

async function logoutAndCloseMenu(){
  closeHeaderMenu();
  hideModal();
  resetNavigationAfterLogout();
  await signOut(auth);
}

// ---------- UI v27: เมนูล่าง 5 รายการ + เมนูแฮมเบอร์เกอร์ ----------
function ensureAppShellStyles(){
  if(document.getElementById('theviewAppShellStyles')) return;
  const style=document.createElement('style');
  style.id='theviewAppShellStyles';
  style.textContent=`
    .bottom-nav{display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:2px}
    .bottom-nav button{min-width:0!important;padding:8px 2px!important;font-size:12px!important}
    .bottom-nav button>span:first-child{font-size:25px!important}
    .bottom-nav .nav-create{position:relative}
    .bottom-nav .nav-create>span:first-child{
      width:48px;height:48px;border-radius:16px;display:flex!important;
      align-items:center;justify-content:center;margin:-20px auto 3px!important;
      background:linear-gradient(145deg,#2563eb,#0ea5e9);color:#fff;
      box-shadow:0 8px 20px rgba(37,99,235,.32);font-size:32px!important;
      border:4px solid #fff;
    }
    .hero{position:relative}
    .header-menu-btn{
      width:54px;height:54px;border-radius:18px;border:1px solid rgba(255,255,255,.28);
      color:#fff;background:rgba(255,255,255,.10);font-size:28px;line-height:1;
      display:flex;align-items:center;justify-content:center;cursor:pointer;
      -webkit-tap-highlight-color:transparent;
    }
    .header-menu-panel{
      position:absolute;right:18px;top:78px;z-index:120;min-width:250px;
      max-height:min(72vh,620px);overflow-y:auto;-webkit-overflow-scrolling:touch;
      background:#fff;border:1px solid #dbe3ef;border-radius:18px;
      box-shadow:0 20px 50px rgba(15,23,42,.25);padding:8px;
    }
    .header-menu-group{padding:6px 6px 3px}
    .header-menu-group-title{
      padding:8px 10px 5px;font-size:12px;font-weight:800;letter-spacing:.03em;
      color:#64748b;text-transform:none;
    }
    .header-menu-group+.header-menu-group{border-top:1px solid #e5e7eb;margin-top:5px;padding-top:7px}
    .header-menu-panel button{
      width:100%;border:0;background:#fff;text-align:left;padding:14px 16px;
      border-radius:12px;font-size:17px;color:#0f172a;cursor:pointer;
    }
    .header-menu-panel button:hover,.header-menu-panel button:active{background:#eff6ff}
    .header-menu-panel .logout-item{color:#dc2626;border-top:1px solid #e5e7eb;border-radius:0 0 12px 12px;margin-top:4px}
  `;
  document.head.appendChild(style);
}

function setupAppShell(){
  ensureAppShellStyles();

  const nav=document.querySelector('.bottom-nav');
  if(nav){
    nav.innerHTML=`
      <button data-page="home" class="active"><span>🏠</span><span class="nav-text">หน้าแรก</span></button>
      <button data-page="stock"><span>📦</span><span class="nav-text">สต๊อก</span></button>
      <button data-page="scan" class="nav-create"><span>＋</span><span class="nav-text">รายการใหม่</span></button>
      <button data-page="approval" class="nav-desktop-extra"><span>✅</span><span class="nav-text">รายการอนุมัติ</span></button>
      <button data-page="report" class="nav-desktop-extra"><span>📊</span><span class="nav-text">รายงาน</span></button>
      <button data-page="history"><span>📋</span><span class="nav-text">ประวัติ</span></button>
      <button data-page="manual" class="nav-desktop-extra"><span>📘</span><span class="nav-text">คู่มือ</span></button>
      <button data-page="profile"><span>👤</span><span class="nav-text">โปรไฟล์</span></button>
    `;
  }

  const oldLogout=$('logoutBtn');
  if(oldLogout){
    oldLogout.onclick=null;
    oldLogout.classList.add('hidden');
    oldLogout.setAttribute('aria-hidden','true');
    oldLogout.tabIndex=-1;
  }

  const hero=document.querySelector('.hero');
  if(hero && !document.getElementById('headerMenuBtn')){
    const btn=document.createElement('button');
    btn.id='headerMenuBtn';
    btn.type='button';
    btn.className='header-menu-btn';
    btn.setAttribute('aria-label','เปิดเมนู');
    btn.innerHTML=`<span class="mobile-menu-glyph">☰</span><span class="desktop-menu-avatar">👤</span><span class="desktop-menu-copy"><b class="desktop-menu-name">บัญชีผู้ใช้</b><small class="desktop-menu-role">เมนูและการตั้งค่า</small></span>`;
    hero.appendChild(btn);

    const panel=document.createElement('div');
    panel.id='headerMenuPanel';
    panel.className='header-menu-panel hidden';
    panel.innerHTML=`
      <button type="button" id="headerProfileBtn">👤 โปรไฟล์ของฉัน</button>
      <button type="button" id="headerLogoutBtn" class="logout-item">🚪 ออกจากระบบ</button>
    `;
    document.body.appendChild(panel);


    const positionHeaderMenu=()=>{
      const rect=btn.getBoundingClientRect();
      const vv=window.visualViewport;
      const viewportH=vv ? vv.height : window.innerHeight;
      const viewportW=vv ? vv.width : window.innerWidth;
      const viewportTop=vv ? vv.offsetTop : 0;
      const safeTop=Math.max(10, Math.round(viewportTop + 10));
      const safeBottom=92; // เว้นแถบนำทางล่างของเว็บ
      const side=Math.max(12, Math.round(viewportW - rect.right));
      const preferredTop=Math.round(rect.bottom + 10);
      const available=Math.max(360, Math.round(viewportH - (preferredTop - viewportTop) - safeBottom - 10));
      panel.style.left='auto';
      panel.style.right=`${side}px`;
      panel.style.top=`${Math.max(safeTop,preferredTop)}px`;
      panel.style.bottom='auto';
      panel.style.maxHeight=`${available}px`;
    };
    btn.addEventListener('click',e=>{
      e.preventDefault();
      e.stopPropagation();
      const willOpen=panel.classList.contains('hidden');
      if(willOpen){
        panel.classList.remove('hidden');
        panel.scrollTop=0;
        panel.style.visibility='hidden';
        requestAnimationFrame(()=>{
          positionHeaderMenu();
          panel.style.visibility='';
          btn.setAttribute('aria-expanded','true');
          document.body.classList.add('header-menu-open');
        });
      }else{
        panel.classList.add('hidden');
        btn.setAttribute('aria-expanded','false');
        document.body.classList.remove('header-menu-open');
      }
    });
    window.addEventListener('resize',()=>{ if(!panel.classList.contains('hidden')) positionHeaderMenu(); },{passive:true});
    window.addEventListener('scroll',()=>{ if(!panel.classList.contains('hidden')) positionHeaderMenu(); },{passive:true});
    $('headerProfileBtn').onclick=()=>{
      closeHeaderMenu();
      goToPage('profile');
    };
    $('headerLogoutBtn').onclick=logoutAndCloseMenu;
    document.addEventListener('click',e=>{
      if(!panel.contains(e.target) && e.target!==btn){ panel.classList.add('hidden'); document.body.classList.remove('header-menu-open'); btn.setAttribute('aria-expanded','false'); }
    });
  }
}
setupAppShell();
$('firstNewPass').addEventListener('keydown',e=>{ if(e.key==='Enter') $('firstConfirmPass').focus(); });
$('firstConfirmPass').addEventListener('keydown',e=>{ if(e.key==='Enter') window.saveNewPassword(true); });
function refreshHeaderMenu(){
  const panel=$('headerMenuPanel');
  if(!panel) return;
  panel.innerHTML=`
    <div class="header-menu-group">
      <div class="header-menu-group-title">บัญชีผู้ใช้</div>
      <button type="button" id="headerProfileBtn">👤 โปรไฟล์ของฉัน</button>
      <button type="button" id="headerManualBtn">📘 คู่มือการใช้งาน</button>
    </div>

    ${(canManageProducts()||canAdjustStock())?`<div class="header-menu-group">
      <div class="header-menu-group-title">จัดการสต๊อก</div>
      ${canAdjustStock()?`<button type="button" id="headerAdjustBtn">⚖️ ปรับยอดสต๊อก</button>`:''}
      ${canManageProducts()?`<button type="button" id="headerAuditBtn">🛡️ Audit Log</button>`:''}
    </div>`:''}

    <div class="header-menu-group">
      <div class="header-menu-group-title">รายงาน</div>
      <button type="button" id="headerReportBtn">📊 รายงานสต๊อก</button>
    </div>

    ${isAdmin()?`<div class="header-menu-group">
      <div class="header-menu-group-title">จัดการข้อมูลระบบ</div>
      <button type="button" id="headerBackupBtn">⬇️ สำรองข้อมูล</button>
      <button type="button" id="headerRestoreBtn">⬆️ กู้คืนข้อมูล</button>
    </div>`:''}

    <div class="header-menu-group">
      <button type="button" id="headerLogoutBtn" class="logout-item">🚪 ออกจากระบบ</button>
    </div>`;
  $('headerProfileBtn').onclick=()=>{ panel.classList.add('hidden'); document.body.classList.remove('header-menu-open'); goToPage('profile'); };
  $('headerManualBtn').onclick=()=>{ panel.classList.add('hidden'); document.body.classList.remove('header-menu-open'); goToPage('manual'); };
  if($('headerAdjustBtn')) $('headerAdjustBtn').onclick=()=>{ panel.classList.add('hidden'); document.body.classList.remove('header-menu-open'); goToPage('stock'); setTimeout(()=>window.openStockAdjustmentPicker(),0); };
  if($('headerAuditBtn')) $('headerAuditBtn').onclick=()=>{ panel.classList.add('hidden'); document.body.classList.remove('header-menu-open'); window.viewAuditLog(); };
  $('headerReportBtn').onclick=()=>{ panel.classList.add('hidden'); document.body.classList.remove('header-menu-open'); goToPage('report'); };
  if($('headerBackupBtn')) $('headerBackupBtn').onclick=()=>{ panel.classList.add('hidden'); document.body.classList.remove('header-menu-open'); window.exportBackup(); };
  if($('headerRestoreBtn')) $('headerRestoreBtn').onclick=()=>{ panel.classList.add('hidden'); document.body.classList.remove('header-menu-open'); window.chooseBackupFile(); };
  $('headerLogoutBtn').onclick=logoutAndCloseMenu;
}

function updateNavigationVisibility(){
  refreshHeaderMenu();
  const approvalBtn=document.querySelector('.bottom-nav button[data-page="approval"]');
  const reportBtn=document.querySelector('.bottom-nav button[data-page="report"]');
  // ทุกคนเปิดหน้ารายการของตนเองที่รอตรวจได้ ส่วนผู้มีสิทธิ์จะเห็นรายการที่ต้องอนุมัติ
  if(approvalBtn){
    approvalBtn.classList.remove('hidden');
    const label=approvalBtn.querySelector('.nav-text');
    if(label) label.textContent=canApprove()?'รายการอนุมัติ':'รายการรอตรวจ';
  }
  if(reportBtn) reportBtn.classList.toggle('hidden', !canViewReports());
  if(state.page==='report' && !canViewReports()) state.page='home';
}

function readScrollMap(){
  try{ return JSON.parse(localStorage.getItem(LAST_SCROLL_MAP_KEY)||'{}')||{}; }catch{return {};}
}

// ---------- v32.8: กู้ตำแหน่งเลื่อนแบบรอข้อมูล Realtime โหลดครบ ----------
// ก่อนหน้านี้ Safari พยายามเลื่อนไปตำแหน่งเดิมตั้งแต่รายการประวัติยังโหลดไม่ครบ
// ทำให้ตำแหน่งถูกบีบไว้ด้านบน และบางครั้ง scroll event เขียนค่า 0 ทับค่าที่บันทึกไว้
let scrollRestoreJob={active:false,page:null,target:0,attempts:0,timer:null};
function cancelScrollRestore(){
  if(scrollRestoreJob.timer) clearTimeout(scrollRestoreJob.timer);
  scrollRestoreJob={active:false,page:null,target:0,attempts:0,timer:null};
}
function saveCurrentPageScroll(){
  if(!state.page || scrollRestoreJob.active) return;
  const y=window.scrollY||document.documentElement.scrollTop||0;
  const map=readScrollMap();
  map[state.page]=y;
  localStorage.setItem(LAST_SCROLL_MAP_KEY,JSON.stringify(map));
  localStorage.setItem(LAST_SCROLL_KEY,String(y));
}
function runScrollRestoreAttempt(){
  if(!scrollRestoreJob.active || scrollRestoreJob.page!==state.page) return cancelScrollRestore();
  const target=Math.max(0,Number(scrollRestoreJob.target)||0);
  const docHeight=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);
  const maxScroll=Math.max(0,docHeight-window.innerHeight);
  const canReach=target<=maxScroll+8;
  const finalAttempt=scrollRestoreJob.attempts>=45;

  if(canReach || finalAttempt){
    const destination=Math.min(target,maxScroll);
    window.scrollTo({top:destination,behavior:'auto'});
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const current=window.scrollY||document.documentElement.scrollTop||0;
      if(Math.abs(current-destination)<=8 || finalAttempt){
        cancelScrollRestore();
      }else{
        scrollRestoreJob.attempts++;
        scrollRestoreJob.timer=setTimeout(runScrollRestoreAttempt,100);
      }
    }));
    return;
  }
  // รายการยังโหลดมาไม่ครบ รอ onSnapshot/render รอบถัดไปก่อน
  scrollRestoreJob.attempts++;
  scrollRestoreJob.timer=setTimeout(runScrollRestoreAttempt,100);
}
function restorePageScroll(page=state.page){
  const map=readScrollMap();
  const y=Number(map[page] ?? localStorage.getItem(LAST_SCROLL_KEY) ?? 0);
  cancelScrollRestore();
  if(!Number.isFinite(y)||y<=0) return;
  scrollRestoreJob={active:true,page,target:y,attempts:0,timer:null};
  requestAnimationFrame(()=>requestAnimationFrame(runScrollRestoreAttempt));
}
function continuePendingScrollRestore(){
  if(!scrollRestoreJob.active || scrollRestoreJob.page!==state.page) return;
  if(scrollRestoreJob.timer) clearTimeout(scrollRestoreJob.timer);
  scrollRestoreJob.timer=setTimeout(runScrollRestoreAttempt,20);
}
function goToPage(page, opts={}){
  if(page==='report' && !canViewReports()) return toast('คุณไม่มีสิทธิ์ดูรายงานทั้งหมด');
  const previousPage=state.page;
  saveCurrentPageScroll();
  state.page=VALID_PAGES.has(page)?page:'home';
  if(state.page!=='productDetail' && previousPage==='productDetail'){ state.viewProductId=null; localStorage.removeItem(PRODUCT_DETAIL_KEY); state.productDetailTab='general'; }
  localStorage.setItem(LAST_PAGE_KEY,state.page);
  if(opts.resetScroll===true){
    const map=readScrollMap(); map[state.page]=0; localStorage.setItem(LAST_SCROLL_MAP_KEY,JSON.stringify(map));
  }
  if(state.page==='stock'){
    const hasExplicitFilter=Object.prototype.hasOwnProperty.call(opts,'filter');
    if(hasExplicitFilter) state.stockFilter=opts.filter || 'all';
    else if(previousPage!=='stock') state.stockFilter='all';
    else state.stockFilter=state.stockFilter || 'all';
  }
  if(state.page==='history'){
    if(opts.historyFilter) state.historyFilter=opts.historyFilter;
    if(opts.historyPreset==='today'){
      const today=toDateStr(new Date()); state.historyStart=today; state.historyEnd=today;
    }
  }
  document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.toggle('active', x.dataset.page===state.page));
  render();
  if(opts.resetScroll===true) window.scrollTo({top:0,behavior:'auto'}); else restorePageScroll(state.page);
}
window.goToPage=goToPage;
document.querySelectorAll('.bottom-nav button').forEach(b=>b.onclick=()=>goToPage(b.dataset.page));

const BOOT_RESTORE_TIMEOUT = 10000;
let bootTimeoutHandle=null;
function setBootMessage(message){
  const el=$('bootMessage');
  if(el) el.textContent=message;
}
function showBootScreen(message='กำลังโหลดข้อมูล...'){
  clearTimeout(bootTimeoutHandle);
  hideNetworkStatusIndicator();
  document.body.classList.add('auth-screen-active');
  window.scrollTo(0,0);
  const boot=$('bootPage');
  const retry=$('bootRetryBtn');
  setBootMessage(message);
  if(retry) retry.classList.add('hidden');
  if(boot){
    boot.classList.remove('hidden','boot-fade-out');
    boot.style.pointerEvents='auto';
  }
  bootTimeoutHandle=setTimeout(()=>{
    setBootMessage('การโหลดใช้เวลานานกว่าปกติ');
    if(retry) retry.classList.remove('hidden');
  },BOOT_RESTORE_TIMEOUT);
}
function hideBootScreen(){
  clearTimeout(bootTimeoutHandle);
  const boot=$('bootPage');
  if(!boot) return;
  boot.classList.add('boot-fade-out');
  setTimeout(()=>{
    boot.classList.add('hidden');
    if($('loginPage')?.classList.contains('hidden') && $('passwordGate')?.classList.contains('hidden')){
      document.body.classList.remove('auth-screen-active');
    }
  },240);
}
function waitForScrollRestore(timeout=BOOT_RESTORE_TIMEOUT){
  const started=Date.now();
  return new Promise(resolve=>{
    const check=()=>{
      const targetMap=readScrollMap();
      const target=Number(targetMap[state.page] ?? localStorage.getItem(LAST_SCROLL_KEY) ?? 0);
      const current=window.scrollY||document.documentElement.scrollTop||0;
      const finished=!scrollRestoreJob.active && (target<=0 || Math.abs(current-Math.min(target,Math.max(0,document.documentElement.scrollHeight-window.innerHeight)))<=12);
      if(finished || Date.now()-started>=timeout) return resolve();
      setTimeout(check,80);
    };
    check();
  });
}
$('bootRetryBtn')?.addEventListener('click',()=>location.reload());

async function enterMainApp(){
  if(state.page==='productDetail' && !state.viewProductId){ state.page='stock'; localStorage.setItem(LAST_PAGE_KEY,'stock'); }
  normalizeMobilePageScrollV329();
  document.body.classList.remove('password-gate-active');
  document.body.classList.add('app-session-active');
  document.body.classList.add('auth-screen-active');
  document.body.classList.add('app-restoring');
  showBootScreen('กำลังโหลดข้อมูลและกลับไปยังหน้าล่าสุด...');
  $('loginPage').classList.add('hidden');
  $('passwordGate').classList.add('hidden');
  $('app').classList.remove('hidden');
  updateNavigationVisibility();
  document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.toggle('active', x.dataset.page===state.page));
  render();
  bindRealtime();
  restorePageScroll(state.page);
  await waitForScrollRestore();
  document.body.classList.remove('app-restoring');
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ hideBootScreen(); setTimeout(()=>verifyInternetConnection({showMessage:false}),450); }));
}

function showFirstPasswordGate(){
  document.body.classList.remove('auth-screen-active','app-session-active');
  hideNetworkStatusIndicator();
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

let authSessionRunId=0;
async function showSignedOutScreen(){
  authSessionRunId++;
  window.__CHEE_AUTH_PHASE__='signed-out';
  state.user=null; state.profile=null; state.members=[];
  closeHeaderMenu();
  unbindRealtime();
  document.body.classList.add('auth-screen-active');
  document.body.classList.remove('password-gate-active','app-session-active','app-restoring');
  hideNetworkStatusIndicator();
  $('app')?.classList.add('hidden');
  $('passwordGate')?.classList.add('hidden');
  $('bootPage')?.classList.add('hidden');
  window.scrollTo(0,0);
  if(QR_PREVIEW_TARGET && !QR_STAFF_LOGIN_REQUEST){
    await showProductQrPreview(QR_PREVIEW_TARGET);
  }else{
    hideProductQrPreview();
    $('loginPage')?.classList.remove('hidden');
  }
}

async function startAuthenticatedSession(user, source='auth-observer'){
  if(!user) return showSignedOutScreen();
  const runId=++authSessionRunId;
  window.__CHEE_AUTH_PHASE__=source==='manual-login'?'loading-profile-after-login':'loading-profile';
  closeHeaderMenu();
  state.user=user; state.profile=null; state.members=[];
  $('loginPage')?.classList.add('hidden');
  $('passwordGate')?.classList.add('hidden');
  $('app')?.classList.add('hidden');
  document.body.classList.remove('password-gate-active','app-session-active');
  hideNetworkStatusIndicator();
  showBootScreen('กำลังตรวจสอบข้อมูลสมาชิก...');
  try{
    const snap=await withTimeout(getDoc(memberRef(user.uid)),22000,'member-profile-timeout');
    if(runId!==authSessionRunId) return;
    if(!snap.exists()){
      $('bootPage')?.classList.add('hidden');
      $('loginPage')?.classList.add('hidden');
      $('app')?.classList.remove('hidden');
      view.innerHTML = `<div class="card"><h2>ยังไม่พบข้อมูลสมาชิก</h2><p>กรุณาสร้างเอกสาร <b>members/${escapeHtml(user.uid)}</b> ที่ระดับรากของ Firestore</p><button class="btn red full" onclick="window.logoutNow()">ออกจากระบบ</button></div>`;
      return;
    }
    state.profile={uid:user.uid,...snap.data()};
    if(state.profile.status!=='active'){
      toast('บัญชีนี้ถูกปิดใช้งาน');
      await signOut(auth);
      return;
    }
    const mustChangePassword = state.profile.mustChangePassword === true;
    if(!mustChangePassword && state.profile.passwordChangePending === true){
      state.profile.passwordChangePending=false;
    }
    if(mustChangePassword){
      showFirstPasswordGate();
      return;
    }

    window.__CHEE_AUTH_PHASE__='entering-app';
    await enterMainApp();
    if(runId!==authSessionRunId) return;
    window.__CHEE_AUTH_PHASE__='app-ready';
    const pendingStaffQr=String(localStorage.getItem(PRODUCT_QR_STAFF_RETURN_KEY)||'').trim();
    if(QR_PREVIEW_TARGET && !QR_STAFF_LOGIN_REQUEST && !pendingStaffQr && !productQrDeepLinkHandled){
      await showProductQrPreview(QR_PREVIEW_TARGET);
    }
  }catch(error){
    if(runId!==authSessionRunId) return;
    window.__CHEE_AUTH_PHASE__='profile-load-failed';
    console.error('[TheView Stock] startAuthenticatedSession failed', {source, code:error?.code, message:error?.message});
    unbindRealtime();
    $('bootPage')?.classList.add('hidden');
    $('loginPage')?.classList.add('hidden');
    $('passwordGate')?.classList.add('hidden');
    $('app')?.classList.remove('hidden');
    document.body.classList.remove('auth-screen-active','password-gate-active');
    const msg=error?.code==='app/timeout'?friendlyTimeoutMessage('member'):error?.message||'ไม่ทราบสาเหตุ';
    view.innerHTML = `<div class="card"><h2>เริ่มระบบไม่สำเร็จ</h2><p>${escapeHtml(msg)}</p><p class="muted">ระบบล็อกอินสำเร็จแล้ว แต่โหลดข้อมูลสมาชิกไม่สำเร็จ จึงไม่เปิดหน้าสต๊อกเพื่อป้องกันข้อมูลเพี้ยน</p><div class="actions"><button class="btn primary full" onclick="location.reload()">ลองโหลดใหม่</button><button class="btn light full" onclick="location.href='/reset.html?v=34.29.52-r3-bulk-edit&t='+Date.now()">ล้างแคช</button><button class="btn red full" onclick="window.logoutNow()">ออกจากระบบ</button></div></div>`;
  }
}

onAuthStateChanged(auth, async user=>{
  window.__CHEE_AUTH_PHASE__='auth-event';
  if(!user) return showSignedOutScreen();
  await startAuthenticatedSession(user,'auth-observer');
});
window.logoutNow=logoutAndCloseMenu;

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


function ensureSearchStyles(){
  if(document.getElementById('theviewSearchStyles')) return;
  const style=document.createElement('style');
  style.id='theviewSearchStyles';
  style.textContent=`
    .scan-product-search-wrap{position:relative}
    .scan-product-results{position:absolute;z-index:60;left:0;right:0;top:calc(100% + 6px);max-height:310px;overflow:auto;background:#fff;border:1px solid #dbe3ef;border-radius:16px;box-shadow:0 18px 45px rgba(15,23,42,.18);padding:6px}
    .scan-product-result{width:100%;display:flex;align-items:center;gap:10px;text-align:left;border:0;background:#fff;padding:10px;border-radius:12px;color:#0f172a}
    .scan-product-result:active,.scan-product-result:hover{background:#eff6ff}
    .scan-product-result img,.scan-product-result-icon{width:42px;height:42px;border-radius:10px;object-fit:cover;display:flex;align-items:center;justify-content:center;background:#e2e8f0;flex:0 0 auto}
    .scan-product-result-main{display:flex;flex-direction:column;min-width:0}
    .scan-product-result-main b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .scan-product-result-main small{color:#64748b;margin-top:2px}
    .scan-selected-product{margin:8px 0;padding:10px 12px;border-radius:14px;background:#eff6ff;border:1px solid #bfdbfe;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .scan-selected-product span{color:#2563eb;font-size:13px}.scan-selected-product small{color:#64748b}
  `;
  document.head.appendChild(style);
}
ensureSearchStyles();

function ensureStockCardStyles(){
  if(document.getElementById('theviewStockCardStyles')) return;
  const style=document.createElement('style');
  style.id='theviewStockCardStyles';
  style.textContent=`
    .stock-card-list{display:grid;gap:14px}
    .stock-card-modern{
      position:relative;
      display:grid;
      grid-template-columns:96px minmax(0,1fr) auto;
      gap:16px;
      align-items:center;
      min-height:150px;
      padding:18px 18px 18px 20px;
      background:#fff;
      border-radius:24px;
      border:1px solid #e7edf5;
      box-shadow:0 10px 28px rgba(15,23,42,.08);
      cursor:pointer;
      overflow:hidden;
      transition:transform .15s ease,box-shadow .15s ease;
      -webkit-tap-highlight-color:transparent;
    }
    .stock-card-modern:active{transform:scale(.985)}
    .stock-card-modern:hover{box-shadow:0 14px 34px rgba(15,23,42,.12)}
    .stock-card-modern::before{
      content:"";
      position:absolute;
      left:0;top:0;bottom:0;
      width:6px;
      background:var(--stock-accent,#22c55e);
    }
    .stock-card-photo{
      width:92px;height:112px;border-radius:18px;
      background:#f8fafc;
      display:flex;align-items:center;justify-content:center;
      overflow:hidden;
      flex:0 0 auto;
    }
    .stock-card-photo img{width:100%;height:100%;object-fit:contain}
    .stock-card-photo-placeholder{font-size:40px}
    .stock-card-main{min-width:0}
    .stock-card-name{
      margin:0 0 5px;
      font-size:21px;
      line-height:1.25;
      font-weight:800;
      color:#0f172a;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    }
    .stock-card-sku{
      color:#64748b;
      font-size:14px;
      margin-bottom:9px;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
    }
    .stock-card-label{color:#64748b;font-size:14px;margin-bottom:1px}
    .stock-card-qty{
      display:flex;align-items:baseline;gap:7px;
      color:#0f172a;
    }
    .stock-card-number{
      font-size:42px;
      line-height:1;
      font-weight:900;
      letter-spacing:-1px;
    }
    .stock-card-unit{font-size:18px;color:#475569;font-weight:700}
    .stock-card-side{
      align-self:stretch;
      min-width:118px;
      display:flex;
      align-items:center;
      justify-content:flex-end;
      gap:12px;
    }
    .stock-status-modern{
      display:inline-flex;
      align-items:center;
      gap:8px;
      padding:12px 16px;
      border-radius:18px;
      font-size:16px;
      font-weight:800;
      white-space:nowrap;
    }
    .stock-status-modern::before{
      content:"";
      width:12px;height:12px;border-radius:999px;
      background:currentColor;
      box-shadow:0 0 0 4px rgba(255,255,255,.55);
    }
    .stock-status-ok{background:#dcfce7;color:#16a34a}
    .stock-status-low{background:#fef3c7;color:#d97706}
    .stock-status-out{background:#fee2e2;color:#ef4444}
    .stock-card-arrow{
      font-size:38px;
      line-height:1;
      color:#334155;
      font-weight:300;
      margin-left:2px;
    }
    @media (max-width:560px){
      .stock-card-modern{
        grid-template-columns:74px minmax(0,1fr) auto;
        gap:12px;
        min-height:126px;
        padding:15px 14px 15px 17px;
        border-radius:21px;
      }
      .stock-card-photo{width:70px;height:88px;border-radius:15px}
      .stock-card-name{font-size:18px}
      .stock-card-sku{font-size:12px;margin-bottom:6px}
      .stock-card-label{font-size:13px}
      .stock-card-number{font-size:34px}
      .stock-card-unit{font-size:15px}
      .stock-card-side{min-width:94px;gap:7px}
      .stock-status-modern{padding:9px 11px;font-size:14px;border-radius:15px}
      .stock-status-modern::before{width:10px;height:10px}
      .stock-card-arrow{font-size:30px}
    }
    @media (max-width:390px){
      .stock-card-modern{grid-template-columns:64px minmax(0,1fr) auto;gap:9px}
      .stock-card-photo{width:60px;height:78px}
      .stock-card-side{min-width:82px}
      .stock-status-modern{padding:8px 9px;font-size:13px}
      .stock-card-arrow{display:none}
    }
  `;
  document.head.appendChild(style);
}
ensureStockCardStyles();

function ensureProductDetailV276Styles(){
  if(document.getElementById('theviewProductDetailV276Styles')) return;
  const style=document.createElement('style');
  style.id='theviewProductDetailV276Styles';
  style.textContent=`
    .product-detail-shell{display:grid;gap:16px}
    .product-detail-card{background:#fff;border:1px solid #e2e8f0;border-radius:28px;padding:22px;box-shadow:0 12px 34px rgba(15,23,42,.08);overflow:hidden}
    .product-detail-top{display:grid;grid-template-columns:minmax(220px,310px) minmax(0,1fr);gap:24px;align-items:stretch}
    .product-detail-photo-wrap{background:#f8fafc;border-radius:24px;padding:18px;display:flex;flex-direction:column;gap:12px;min-height:300px}
    .product-detail-photo{width:100%;height:220px;object-fit:contain;border-radius:18px;background:#f8fafc}
    .product-detail-photo-placeholder{height:220px;border-radius:18px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:70px}
    .product-detail-change-photo{min-height:48px;border-radius:15px;background:#eef2ff;color:#1d4ed8;border:0;font-weight:900;font-size:16px}
    .product-detail-summary{display:flex;flex-direction:column;min-width:0}
    .product-detail-name{font-size:34px;line-height:1.18;margin:2px 0 8px;color:#0f172a}
    .product-detail-meta{font-size:17px;color:#64748b;line-height:1.7}
    .product-status-banner{margin-top:18px;border-radius:22px;padding:20px 22px;display:flex;align-items:center;gap:14px}
    .product-status-dot{width:18px;height:18px;border-radius:999px;flex:0 0 auto}
    .product-status-copy b{display:block;font-size:31px;line-height:1.1}
    .product-status-copy span{display:block;margin-top:7px;font-size:15px}
    .product-status-banner.ok{background:linear-gradient(135deg,#ecfdf5,#dcfce7);color:#15803d}
    .product-status-banner.warn{background:linear-gradient(135deg,#fffbeb,#fef3c7);color:#a16207}
    .product-status-banner.bad{background:linear-gradient(135deg,#fff1f2,#fee2e2);color:#dc2626}
    .product-status-banner.ok .product-status-dot{background:#22c55e}
    .product-status-banner.warn .product-status-dot{background:#facc15}
    .product-status-banner.bad .product-status-dot{background:#ef4444}
    .product-detail-stats{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px}

    .product-quick-actions{margin-top:16px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .product-quick-action{min-height:72px;border:0;border-radius:22px;padding:14px 16px;display:flex;align-items:center;justify-content:center;gap:12px;text-align:left;font-weight:950;font-size:18px;box-shadow:0 14px 32px rgba(15,23,42,.10);cursor:pointer}
    .product-quick-action span:first-child{width:42px;height:42px;border-radius:16px;display:grid;place-items:center;background:rgba(255,255,255,.74);font-size:24px;flex:none}
    .product-quick-action b{display:block;line-height:1.1}
    .product-quick-action small{display:block;margin-top:4px;font-size:12px;font-weight:850;opacity:.84;line-height:1.35}
    .product-quick-action.in{background:linear-gradient(135deg,#ecfdf5,#b7f4d5);color:#047857}
    .product-quick-action.out{background:linear-gradient(135deg,#fff7ed,#fde68a);color:#92400e}
    .product-quick-action:active{transform:translateY(1px);opacity:.88}
    .product-quick-note{margin-top:10px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;font-size:12px;font-weight:800;line-height:1.45;padding:10px 12px}
    .product-detail-stat{min-height:140px;border-radius:22px;padding:20px 22px;border:1px solid #e2e8f0;display:flex;flex-direction:column;justify-content:center}
    .product-detail-stat.stock{background:linear-gradient(135deg,#f0fdf4,#ecfdf5)}
    .product-detail-stat.min{background:linear-gradient(135deg,#fffbeb,#fefce8)}
    .product-detail-stat-label{font-size:16px;color:#475569;font-weight:800}
    .product-detail-stat-value{margin-top:8px;font-size:43px;font-weight:900;line-height:1;color:#0f172a}
    .product-detail-stat-value small{font-size:20px;color:#334155}
    .product-detail-info-list{margin-top:16px;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;background:#fff}
    .product-detail-info-row{min-height:58px;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:18px;border-bottom:1px solid #e2e8f0}
    .product-detail-info-row:last-child{border-bottom:0}
    .product-detail-info-label{color:#64748b;font-weight:700}
    .product-detail-info-value{text-align:right;font-weight:800;color:#334155}
    .product-detail-edit-btn{width:100%;min-height:58px;margin-top:16px;border:1px solid #dbe3ef;border-radius:18px;background:#fff;color:#0f172a;font-weight:900;font-size:18px;display:flex;align-items:center;justify-content:space-between;padding:0 20px}
    .product-detail-tabs{margin-top:18px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;background:#fff}
    .product-detail-tab{min-height:54px;border:0;background:#fff;color:#64748b;font-weight:900;font-size:14px;border-bottom:3px solid transparent}
    .product-detail-tab.active{color:#2563eb;border-bottom-color:#2563eb;background:#f8fbff}
    .product-detail-panel{margin-top:14px}
    .product-history-item{display:flex;gap:12px;align-items:flex-start;padding:14px 0;border-bottom:1px solid #e2e8f0}
    .product-history-item:last-child{border-bottom:0}
    .product-history-main{flex:1;min-width:0}
    .product-history-time{font-size:12px;color:#64748b;white-space:nowrap}
    .product-empty{text-align:center;color:#64748b;padding:28px 14px}
    @media(max-width:620px){
      .product-detail-card{padding:16px;border-radius:23px}
      .product-detail-top{grid-template-columns:1fr;gap:16px}
      .product-detail-photo-wrap{min-height:auto;padding:14px}
      .product-detail-photo,.product-detail-photo-placeholder{height:190px}
      .product-detail-name{font-size:28px}
      .product-status-copy b{font-size:28px}
      .product-detail-stat{min-height:118px;padding:16px}
      .product-detail-stat-value{font-size:36px}
      .product-detail-tabs{grid-template-columns:1fr}
      .product-quick-action{min-height:64px;padding:12px;font-size:16px}
      .product-quick-action span:first-child{width:38px;height:38px;border-radius:14px;font-size:22px}
      .product-detail-tab{border-bottom:1px solid #e2e8f0}
      .product-detail-tab.active{border-bottom:3px solid #2563eb}
    }
  `;
  document.head.appendChild(style);
}
ensureProductDetailV276Styles();

function ensureTouchPolishV276(){
  if(document.getElementById('theviewTouchPolishV276')) return;
  const style=document.createElement('style');
  style.id='theviewTouchPolishV276';
  style.textContent=`
    html,body{width:100%;max-width:100%;overflow-x:hidden!important}
    html{background:#f4f7fb;overscroll-behavior:none}
    body{min-height:100dvh;overscroll-behavior:none;touch-action:pan-y}
    .app,.page,.hero,.card,.sheet{max-width:100%}
    button,[role="button"],a,summary,input,select,textarea{touch-action:manipulation;-webkit-tap-highlight-color:transparent}
    button,[role="button"],summary{min-height:44px}
    input,select,textarea{font-size:16px!important}
    .bottom-nav{z-index:100!important;transform:none!important;padding-bottom:calc(10px + env(safe-area-inset-bottom))!important}
    .bottom-nav button{min-width:54px;min-height:54px;padding:4px 6px}
    .page{padding-bottom:calc(118px + env(safe-area-inset-bottom))!important}
    .modal{overscroll-behavior:contain}
    .sheet{max-height:calc(92dvh - env(safe-area-inset-top));padding-bottom:calc(24px + env(safe-area-inset-bottom));overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
    .btn:active,.stock-card-modern:active,.product-detail-edit-btn:active,.product-detail-tab:active,.bottom-nav button:active{transform:none!important;opacity:.82}
  `;
  document.head.appendChild(style);
  document.addEventListener('gesturestart',event=>event.preventDefault(),{passive:false});
  document.addEventListener('gesturechange',event=>event.preventDefault(),{passive:false});
}
ensureTouchPolishV276();

// ---------- v28.6 Responsive PC + Mobile ----------
function ensureDesktopResponsiveV286Styles(){
  if(document.getElementById('theviewDesktopResponsiveV286')) return;
  const style=document.createElement('style');
  style.id='theviewDesktopResponsiveV286';
  style.textContent=`
    /* มือถือยังคงใช้เมนูล่าง 5 ปุ่มเหมือนเดิม */
    .nav-desktop-extra{display:none!important}
    .bottom-nav button .nav-text{display:block;font-size:12px!important;line-height:1.1}
    .stock-toolbar{display:grid;gap:10px}
    .stock-result-count{font-size:13px}

    @media (min-width:1024px){
      :root{--desktop-sidebar:272px}
      html{overflow-x:hidden!important;overflow-y:auto!important;background:#eef3f9;overscroll-behavior-y:auto!important}
      body{padding-bottom:0!important;min-height:100vh;overflow-x:hidden!important;overflow-y:visible!important;overscroll-behavior-y:auto!important;touch-action:auto!important}
      .app{max-width:none!important;width:100%!important;min-height:100vh;margin:0!important}

      .hero{
        position:fixed!important;inset:0 auto auto 0!important;
        width:var(--desktop-sidebar)!important;height:148px!important;
        min-height:156px!important;border-radius:0!important;
        padding:28px 24px!important;z-index:120!important;
        align-items:flex-start!important;
        box-shadow:10px 0 30px rgba(15,23,42,.08)
      }
      .hero>div{min-width:0;padding-right:34px}
      .hero h1{font-size:22px!important;line-height:1.15;white-space:nowrap}
      .hero p{font-size:13px!important;line-height:1.5;margin-top:10px!important;max-width:205px}
      .header-menu-btn{
        position:absolute!important;right:18px!important;top:22px!important;
        width:44px!important;height:44px!important;min-height:44px!important;
        border-radius:14px!important;font-size:23px!important;flex:0 0 auto
      }
      .header-menu-panel{left:18px!important;right:18px!important;top:92px!important;min-width:0!important}

      body .app .bottom-nav{
        position:fixed!important;left:0!important;right:auto!important;top:148px!important;bottom:0!important;
        width:var(--desktop-sidebar)!important;height:calc(100vh - 148px)!important;
        display:flex!important;flex-direction:column!important;justify-content:flex-start!important;
        align-items:stretch!important;gap:8px!important;
        padding:20px 16px 24px!important;background:#fff!important;
        border-top:0!important;border-right:1px solid #dbe3ef!important;
        overflow-y:auto!important;z-index:110!important;
        box-shadow:10px 16px 30px rgba(15,23,42,.05)
      }
      body .app .bottom-nav button{
        width:100%!important;min-width:0!important;min-height:56px!important;
        display:grid!important;grid-template-columns:38px minmax(0,1fr)!important;
        align-items:center!important;justify-items:start!important;gap:10px!important;
        padding:10px 14px!important;border-radius:15px!important;
        color:#475569!important;background:transparent!important;
        font-size:15px!important;text-align:left!important;transition:.16s ease
      }
      body .app .bottom-nav button:hover{background:#eff6ff!important;color:#1d4ed8!important}
      body .app .bottom-nav button.active{
        background:linear-gradient(135deg,#eaf2ff,#dbeafe)!important;
        color:#1d4ed8!important;box-shadow:inset 4px 0 0 #2563eb
      }
      body .app .bottom-nav button>span:first-child{
        display:grid!important;place-items:center!important;width:34px!important;height:34px!important;
        margin:0!important;font-size:23px!important;line-height:1!important
      }
      body .app .bottom-nav .nav-create span:first-child{
        width:34px!important;height:34px!important;margin:0!important;border:0!important;
        border-radius:11px!important;background:linear-gradient(145deg,#2563eb,#0ea5e9)!important;
        box-shadow:0 5px 12px rgba(37,99,235,.24)!important;font-size:25px!important;color:#fff!important
      }
      .bottom-nav .nav-text{display:block!important;font-size:15px!important;font-weight:850!important}
      .nav-desktop-extra{display:grid!important}
      .nav-desktop-extra.hidden{display:none!important}

      body .app .page{
        width:calc(100% - var(--desktop-sidebar))!important;
        max-width:none!important;margin-left:var(--desktop-sidebar)!important;
        padding:36px clamp(34px,4vw,68px) 64px!important;
        min-height:100vh!important;overflow:visible!important
      }
      .page>h1,.page>.between:first-child h1{font-size:32px;letter-spacing:-.4px}
      .card{border-radius:20px;box-shadow:0 8px 24px rgba(15,23,42,.055)}

      .home-dashboard-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:16px!important}
      .home-dashboard-grid .stat{min-height:126px;padding:20px}
      .home-dashboard-grid .stat b{font-size:34px;margin-top:9px}
      .home-priority-card{grid-template-columns:70px minmax(0,1fr) 28px;padding:22px 24px}
      .home-priority-icon{width:64px;height:64px;font-size:31px}
      .home-system-card{grid-template-columns:repeat(2,minmax(0,1fr));align-items:center}
      .home-system-card h2{grid-column:1/-1;margin-bottom:0}

      .stock-toolbar{
        grid-template-columns:minmax(300px,1fr) minmax(220px,320px)!important;
        gap:12px 16px!important;align-items:center!important;padding:20px!important
      }
      .stock-toolbar input,.stock-toolbar select{margin-top:0!important;height:52px}
      .stock-result-count{grid-column:1/-1!important;padding-left:2px;font-size:13px!important}
      .stock-card-list{
        display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;
        gap:16px!important;align-items:start!important
      }
      .stock-card-modern{min-height:158px;margin:0!important;padding:18px 18px 18px 22px!important}
      .stock-card-photo{width:88px!important;height:112px!important}
      .stock-card-name{font-size:20px!important}
      .stock-card-number{font-size:38px!important}

      .approval-info-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}
      .approval-card{padding:24px!important}
      .approval-actions{max-width:680px}

      .new-item-form-card{max-width:980px;margin-left:auto!important;margin-right:auto!important}
      .new-item-tabs{max-width:620px;margin-left:auto;margin-right:auto}

      .profile-form-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:0 18px!important}
      .profile-action-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}

      .modal{align-items:center!important;padding:32px!important}
      .sheet{
        width:min(760px,calc(100vw - 64px))!important;max-width:760px!important;
        max-height:86vh!important;border-radius:24px!important;padding:24px!important;
        box-shadow:0 28px 70px rgba(15,23,42,.28)
      }
    }

    @media (min-width:1800px){
      :root{--desktop-sidebar:288px}
      .stock-card-list{grid-template-columns:repeat(3,minmax(0,1fr))!important}
      .stock-card-modern{grid-template-columns:82px minmax(0,1fr) auto!important;gap:14px!important}
      .stock-card-photo{width:78px!important;height:104px!important}
      .stock-card-number{font-size:35px!important}
      .stock-card-side{min-width:86px!important}
      .stock-card-arrow{display:none!important}
    }
  `;
  document.head.appendChild(style);
}
ensureDesktopResponsiveV286Styles();


// ---------- v34.16.4 Desktop Brand + Profile Menu Polish ----------
function ensureDesktopWorkspaceV34163(){
  if(!document.getElementById('theviewDesktopWorkspaceV34163')){
    const style=document.createElement('style');
    style.id='theviewDesktopWorkspaceV34163';
    style.textContent=`
      .desktop-workspace-bar{display:none}
      .mobile-menu-glyph{display:inline-flex;align-items:center;justify-content:center}
      .desktop-menu-avatar,.desktop-menu-copy{display:none}

      @media (min-width:1024px){
        :root{--desktop-sidebar:292px;--desktop-brand-height:180px;--desktop-topbar:76px}
        html{background:#f3f1eb!important}
        body{background:#f3f1eb!important;padding-bottom:0!important}
        body.header-menu-open::after{display:none!important}
        .app{display:block;max-width:none!important;width:100%!important;min-height:100vh!important;margin:0!important}

        .desktop-workspace-bar{
          position:fixed;left:var(--desktop-sidebar);right:0;top:0;height:var(--desktop-topbar);
          z-index:106;display:flex;align-items:center;justify-content:space-between;gap:24px;
          padding:0 390px 0 clamp(26px,3vw,46px);background:rgba(255,255,255,.96);
          border-bottom:1px solid #dedbd2;box-shadow:0 5px 18px rgba(27,45,38,.045);
          backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)
        }
        .desktop-workspace-copy{min-width:0;display:grid;gap:2px}
        .desktop-workspace-copy small{font-size:11px;font-weight:900;letter-spacing:.13em;color:#8a6d35;text-transform:uppercase}
        .desktop-workspace-copy strong{font-family:Georgia,"Times New Roman",serif;font-size:19px;font-weight:600;color:#153d31;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .desktop-workspace-page{font-size:13px;font-weight:800;color:#6b7280;white-space:nowrap}

        .hero{
          position:fixed!important;left:0!important;top:0!important;bottom:auto!important;
          width:var(--desktop-sidebar)!important;height:var(--desktop-brand-height)!important;min-height:var(--desktop-brand-height)!important;
          margin:0!important;padding:19px 24px 16px!important;border-radius:0!important;overflow:hidden!important;
          background:radial-gradient(circle at 88% 8%,rgba(230,195,112,.14),transparent 34%),linear-gradient(155deg,#07503d 0%,#00372b 100%)!important;
          border-bottom:1px solid rgba(228,199,126,.34)!important;box-shadow:12px 0 34px rgba(16,43,35,.10)!important;z-index:120!important
        }
        .hero:before{opacity:.58!important;border-radius:0!important}
        .hero:after{display:none!important}
        .hero-shell{display:flex!important;flex-direction:column!important;align-items:center!important;width:100%!important;min-height:0!important;padding:0!important}
        .hero-topline{display:flex!important;justify-content:center!important;width:100%!important;min-height:0!important;padding:0!important}
        .hero-resort-brand{display:flex!important;align-items:center!important;justify-content:center!important;width:100%!important;max-width:none!important;height:54px!important;margin:0!important;overflow:visible!important}
        .brand-logo-hero{display:block!important;width:138px!important;height:54px!important;margin:0 auto!important;object-fit:contain!important;object-position:center!important;filter:brightness(0) invert(1) sepia(.18) saturate(.72)!important}
        .hero-main-copy{width:100%!important;margin:9px 0 0!important;padding:0!important;text-align:center!important}
        .hero h1{display:block!important;margin:0!important;font-family:Georgia,"Times New Roman",serif!important;font-size:19px!important;line-height:1.12!important;font-weight:600!important;letter-spacing:.075em!important;text-align:center!important;white-space:normal!important;color:#fff!important}
        .hero-divider{justify-content:center!important;gap:7px!important;margin:8px 0 7px!important}
        .hero-divider:before{width:52px!important}
        .hero-divider:after{width:52px!important}
        .hero-divider span{width:15px!important;height:15px!important;font-size:10px!important}
        .hero p{margin:0!important;padding:0!important;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;font-size:10px!important;line-height:1.35!important;font-weight:700!important;letter-spacing:.01em!important;text-align:center!important;white-space:normal!important;color:#e4c77e!important}

        .hero #networkStatusIndicator.network-status-pill{
          position:fixed!important;left:auto!important;right:184px!important;top:17px!important;bottom:auto!important;
          height:42px!important;min-height:42px!important;padding:0 15px!important;border:1px solid #d8e6df!important;
          background:#f7fbf8!important;color:#1d4b3e!important;box-shadow:none!important;z-index:132!important
        }
        .hero #networkStatusIndicator.network-status-pill .network-dot{width:10px!important;height:10px!important}
        .hero #networkStatusIndicator.network-status-pill span:last-child{font-size:13px!important}

        .hero .header-menu-btn{
          position:fixed!important;left:auto!important;right:24px!important;top:12px!important;
          width:148px!important;height:52px!important;min-height:52px!important;padding:7px 12px!important;
          display:grid!important;grid-template-columns:38px minmax(0,1fr)!important;gap:9px!important;align-items:center!important;
          border:1px solid #d9e2dd!important;border-radius:16px!important;background:#fff!important;color:#163f33!important;
          box-shadow:0 6px 18px rgba(25,56,46,.09)!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;z-index:133!important
        }
        .mobile-menu-glyph{display:none!important}
        .desktop-menu-avatar{display:grid!important;place-items:center;width:38px;height:38px;border-radius:12px;background:linear-gradient(145deg,#e4f5ec,#d2eadf);color:#0f6b50;font-size:17px;font-weight:900;overflow:hidden}
        .desktop-menu-avatar img{width:100%;height:100%;object-fit:cover}
        .desktop-menu-copy{display:grid!important;min-width:0;text-align:left;line-height:1.15}
        .desktop-menu-copy b,.desktop-menu-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .desktop-menu-copy b{font-size:13px;font-weight:900;color:#173f34}
        .desktop-menu-copy small{margin-top:3px;font-size:10px;font-weight:700;color:#7a8b84}

        #headerMenuPanel.header-menu-panel{
          position:fixed!important;left:auto!important;right:24px!important;top:74px!important;bottom:auto!important;
          width:340px!important;min-width:340px!important;max-height:calc(100vh - 92px)!important;padding:10px!important;
          border-radius:18px!important;border:1px solid #dce5e0!important;background:#fff!important;
          box-shadow:0 24px 58px rgba(21,46,38,.2)!important;overflow-y:auto!important;transform:none!important;z-index:220!important
        }
        #headerMenuPanel.header-menu-panel::before{
          content:""!important;display:block!important;position:fixed!important;right:58px!important;top:67px!important;
          width:14px!important;height:14px!important;background:#fff!important;border-left:1px solid #dce5e0!important;
          border-top:1px solid #dce5e0!important;transform:rotate(45deg)!important;z-index:221!important
        }
        #headerMenuPanel .header-menu-group{padding:4px 5px 6px!important}
        #headerMenuPanel .header-menu-group+.header-menu-group{margin-top:3px!important;padding-top:8px!important}
        #headerMenuPanel .header-menu-group-title{padding:5px 10px 7px!important;font-size:11px!important}
        #headerMenuPanel button{min-height:44px!important;padding:10px 12px!important;border-radius:12px!important;font-size:15px!important}

        body .app .bottom-nav{
          position:fixed!important;left:0!important;right:auto!important;top:var(--desktop-brand-height)!important;bottom:0!important;
          width:var(--desktop-sidebar)!important;height:calc(100vh - var(--desktop-brand-height))!important;
          display:flex!important;flex-direction:column!important;justify-content:flex-start!important;align-items:stretch!important;
          gap:6px!important;padding:16px 16px 22px!important;background:#fff!important;border:0!important;border-right:1px solid #dedbd2!important;
          overflow-y:auto!important;box-shadow:12px 18px 34px rgba(16,43,35,.06)!important;z-index:118!important
        }
        body .app .bottom-nav:after{content:var(--cc-version);display:block;margin-top:auto;padding:18px 10px 2px;border-top:1px solid #ece9e2;color:#9a9285;font-size:10px;font-weight:800;text-align:center;letter-spacing:.04em}
        body .app .bottom-nav button{
          width:100%!important;min-width:0!important;min-height:52px!important;display:grid!important;
          grid-template-columns:38px minmax(0,1fr)!important;align-items:center!important;justify-items:start!important;gap:10px!important;
          padding:8px 13px!important;border-radius:14px!important;background:transparent!important;color:#52645d!important;
          font-size:14px!important;text-align:left!important;transition:background .16s ease,color .16s ease,box-shadow .16s ease!important
        }
        body .app .bottom-nav button:hover{background:#f2f7f4!important;color:#0f6b50!important}
        body .app .bottom-nav button.active{background:linear-gradient(135deg,#e8f5ee,#dff0e7)!important;color:#075b44!important;box-shadow:inset 4px 0 0 #0f795a!important}
        body .app .bottom-nav button>span:first-child{display:grid!important;place-items:center!important;width:34px!important;height:34px!important;margin:0!important;font-size:21px!important;line-height:1!important}
        body .app .bottom-nav .nav-create>span:first-child{width:34px!important;height:34px!important;margin:0!important;border:0!important;border-radius:11px!important;background:linear-gradient(145deg,#0b7557,#004b39)!important;box-shadow:0 5px 12px rgba(0,75,57,.2)!important;font-size:23px!important;color:#fff!important}
        .bottom-nav .nav-text{display:block!important;font-size:14px!important;font-weight:850!important}
        .nav-desktop-extra{display:grid!important}

        body .app .page{
          width:calc(100% - var(--desktop-sidebar))!important;max-width:none!important;margin:0 0 0 var(--desktop-sidebar)!important;
          padding:calc(var(--desktop-topbar) + 30px) clamp(30px,3.5vw,62px) 64px!important;min-height:100vh!important;overflow:visible!important
        }
        .dashboard-heading{margin-bottom:18px!important}
        .dashboard-heading h1{font-size:34px!important;letter-spacing:-.03em!important;color:#182f28!important}
        .dashboard-date{padding:8px 12px;border:1px solid #e3dfd6;border-radius:12px;background:#fff;color:#6b7280!important}
        .home-priority-card{border-radius:22px!important;box-shadow:0 10px 26px rgba(27,54,45,.06)!important}
        .dashboard-stat-grid{grid-template-columns:repeat(auto-fit,minmax(175px,1fr))!important;gap:14px!important}
        .dashboard-stat{min-height:112px!important;border-radius:20px!important;padding:16px!important;box-shadow:0 8px 22px rgba(30,53,45,.045)!important}
        .dashboard-grid-main{grid-template-columns:minmax(0,1.65fr) minmax(300px,.75fr)!important;gap:16px!important}
        .dashboard-alert-columns{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:16px!important}
        .card{border-color:#e3e0d9!important;box-shadow:0 9px 25px rgba(31,52,45,.05)!important}
        .stock-card-list{grid-template-columns:repeat(auto-fit,minmax(390px,1fr))!important}
        .modal{padding-left:calc(var(--desktop-sidebar) + 32px)!important}
      }

      @media (min-width:1440px){
        .dashboard-stat-grid{grid-template-columns:repeat(5,minmax(0,1fr))!important}
      }

      @media (min-width:1800px){
        :root{--desktop-sidebar:306px}
        .stock-card-list{grid-template-columns:repeat(3,minmax(0,1fr))!important}
      }
    `;
    document.head.appendChild(style);
  }

  const appShell=document.getElementById('app');
  if(appShell && !document.getElementById('desktopWorkspaceBar')){
    const topbar=document.createElement('div');
    topbar.id='desktopWorkspaceBar';
    topbar.className='desktop-workspace-bar';
    topbar.innerHTML=`<div class="desktop-workspace-copy"><small>CHEE CHAN GOLF RESORT</small><strong>Food &amp; Beverage Inventory Management</strong></div><div id="desktopWorkspacePage" class="desktop-workspace-page">ภาพรวมคลังสินค้า</div>`;
    const hero=appShell.querySelector('.hero');
    if(hero) hero.insertAdjacentElement('afterend',topbar);
    else appShell.prepend(topbar);
  }
  syncDesktopWorkspaceV34163();
}

function syncDesktopWorkspaceV34163(){
  const pageLabel={home:'ภาพรวมคลังสินค้า',stock:'คลังสินค้า',scan:'สร้างรายการใหม่',approval:canApprove()?'รายการอนุมัติ':'รายการรอตรวจ',report:'รายงานสต๊อก',history:'ประวัติการใช้งาน',profile:'บัญชีผู้ใช้',manual:'คู่มือการใช้งาน',trash:'ถังขยะ',productDetail:'รายละเอียดสินค้า'}[state.page]||'ระบบคลังสินค้า';
  const pageEl=document.getElementById('desktopWorkspacePage');
  if(pageEl) pageEl.textContent=pageLabel;
  const displayName=(state.profile?.displayName||state.profile?.username||'บัญชีผู้ใช้').trim();
  const roleText=state.profile?.position||roleLabel(state.profile?.role||'staff');
  const nameEl=document.querySelector('.desktop-menu-name');
  const roleEl=document.querySelector('.desktop-menu-role');
  const avatar=document.querySelector('.desktop-menu-avatar');
  if(nameEl) nameEl.textContent=displayName;
  if(roleEl) roleEl.textContent=roleText||'เมนูและการตั้งค่า';
  if(avatar){
    if(state.profile?.photoURL){
      avatar.innerHTML='';
      const img=document.createElement('img');
      img.src=state.profile.photoURL;
      img.alt='';
      avatar.appendChild(img);
    }else{
      avatar.textContent=(displayName.charAt(0)||'👤').toUpperCase();
    }
  }
}
ensureDesktopWorkspaceV34163();


function ensurePCProfessionalLayoutV342940(){
  if(document.getElementById('theviewPCProfessionalV342940')) return;
  const style=document.createElement('style');
  style.id='theviewPCProfessionalV342940';
  style.textContent=`

/* v34.29.48 — PC Professional Layout Polish
   Desktop-only refinements: denser stock grid, table-like history cards,
   balanced report cards/actions, wider desktop modals, tighter dashboard spacing. */
@media (min-width:1024px){
  body:not(.auth-screen-active):not(.password-gate-active){
    background:linear-gradient(90deg,#f7f4ec 0,#f7f4ec var(--desktop-sidebar,292px),#f3f0e8 var(--desktop-sidebar,292px),#faf8f2 100%)!important;
  }
  body .app .page{
    padding-left:clamp(38px,3.2vw,56px)!important;
    padding-right:clamp(38px,3.2vw,56px)!important;
  }
  .dashboard-heading,.stock-page-head,.history-page-head,.report-page-head-premium{
    margin-bottom:18px!important;
  }
  .dashboard-heading h1,.stock-page-head h1,.history-page-head h1{
    letter-spacing:-.035em!important;
    color:#132f27!important;
  }
  .dashboard-grid-main,.dashboard-alert-columns,.report-tool-grid,.report-overview-section,.report-detail-section{
    align-items:stretch!important;
  }

  /* PC Stock: compact but still premium. More products visible per screen. */
  .stock-page-head{
    max-width:1280px!important;
    margin-left:auto!important;
    margin-right:auto!important;
  }
  .stock-head-actions{display:flex!important;gap:10px!important;align-items:center!important;flex-wrap:wrap!important;justify-content:flex-end!important}
  .stock-head-actions .btn{min-height:44px!important;border-radius:14px!important;padding:0 15px!important;font-size:14px!important}
  .stock-toolbar{
    max-width:1280px!important;
    margin:0 auto 16px!important;
    display:grid!important;
    grid-template-columns:minmax(260px,1.5fr) minmax(240px,1fr) minmax(180px,.75fr) minmax(180px,.75fr)!important;
    gap:12px!important;
    padding:16px!important;
    border-radius:22px!important;
    background:rgba(255,255,255,.92)!important;
    box-shadow:0 10px 28px rgba(31,52,45,.045)!important;
  }
  .stock-toolbar .stock-structure-filter,
  .stock-toolbar .stock-result-count{grid-column:1/-1!important}
  .stock-toolbar input,.stock-toolbar select{height:46px!important;min-height:46px!important;padding:0 14px!important;border-radius:15px!important;margin-top:0!important;font-size:14px!important}
  .stock-card-list{
    max-width:1280px!important;
    margin-left:auto!important;
    margin-right:auto!important;
    grid-template-columns:repeat(auto-fit,minmax(350px,1fr))!important;
    gap:14px!important;
  }
  .stock-card-modern{
    min-height:132px!important;
    padding:14px 14px 14px 18px!important;
    grid-template-columns:74px minmax(0,1fr) minmax(88px,auto)!important;
    gap:13px!important;
    border-radius:20px!important;
  }
  .stock-card-photo{width:70px!important;height:86px!important;border-radius:14px!important}
  .stock-card-name{font-size:18px!important;margin-bottom:4px!important}
  .stock-card-sku{font-size:12px!important;margin-bottom:6px!important}
  .stock-card-number{font-size:36px!important;letter-spacing:-.04em!important}
  .stock-card-unit{font-size:14px!important}
  .stock-status-modern{font-size:12px!important;padding:7px 10px!important;border-radius:999px!important}
  .stock-card-arrow{font-size:28px!important;color:#789083!important}

  /* PC Dashboard: reduce empty space and align decision cards. */
  .dashboard-heading,.home-priority-card,.dashboard-stat-grid,.dashboard-grid-main,.dashboard-alert-columns{
    max-width:1280px!important;
    margin-left:auto!important;
    margin-right:auto!important;
  }
  .home-priority-card{padding:18px 22px!important;border-radius:22px!important}
  .dashboard-stat-grid{grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:12px!important}
  .dashboard-stat{min-height:104px!important;padding:14px!important;border-radius:18px!important;grid-template-columns:42px minmax(0,1fr)!important}
  .dashboard-stat-icon{width:42px!important;height:42px!important;border-radius:14px!important;font-size:22px!important}
  .dashboard-stat b{font-size:30px!important}
  .dashboard-grid-main{grid-template-columns:minmax(0,1.65fr) minmax(320px,.82fr)!important;gap:16px!important}
  .dashboard-chart-card,.dashboard-side-card,.dashboard-alert-card{border-radius:22px!important;padding:18px!important}
  .dash-chart{height:160px!important}
  .dashboard-alert-columns{grid-template-columns:repeat(2,minmax(0,1fr))!important}

  /* PC History: table-like dense cards without breaking mobile card layout. */
  .history-page{max-width:1280px!important}
  .history-control-card{
    grid-template-columns:minmax(280px,1.1fr) minmax(330px,1.35fr)!important;
    gap:14px 16px!important;
    padding:16px!important;
    border-radius:22px!important;
  }
  .history-quick-range,.history-date-box,.history-summary-strip{align-self:stretch!important}
  .history-date-box{grid-template-columns:minmax(0,1fr) 24px minmax(0,1fr)!important;align-items:end!important}
  .history-summary-strip{grid-column:1/-1!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;padding:10px 14px!important}
  .history-location-filter,.history-destination-filter,.history-search-wrap,.history-filter-scroll{grid-column:1/-1!important}
  .history-filter-scroll{padding-bottom:6px!important;gap:9px!important}
  .history-filter-btn{min-height:38px!important;padding:0 14px!important;font-size:13px!important}
  .history-results{gap:20px!important}
  .history-day-heading{padding:0 4px 2px!important}
  .history-day-heading strong{font-size:18px!important}
  .history-list{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:12px!important}
  .history-entry{
    min-height:154px!important;
    display:grid!important;
    grid-template-columns:minmax(0,1fr) 86px!important;
    align-items:stretch!important;
    gap:12px!important;
    padding:14px!important;
    border-radius:18px!important;
    box-shadow:0 9px 24px rgba(31,52,45,.045)!important;
  }
  .history-entry:not(:has(.history-entry-thumb)){grid-template-columns:1fr!important}
  .history-entry-title{font-size:16px!important;margin-top:8px!important;line-height:1.35!important}
  .history-qty{font-size:14px!important;margin-top:4px!important}
  .history-entry-meta{font-size:12px!important;gap:7px 12px!important;margin-top:8px!important}
  .history-entry-open-hint{font-size:12px!important;margin-top:8px!important}
  .history-entry-thumb{width:86px!important;height:86px!important;border-radius:14px!important;object-fit:cover!important;align-self:center!important;justify-self:end!important}
  .history-detail-modal{max-width:860px!important;margin:0 auto!important}
  .history-detail-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  .history-return-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}

  /* PC Report: equal card heights, aligned buttons and balanced report grid. */
  .report-page-premium{max-width:1360px!important;margin-left:auto!important;margin-right:auto!important;gap:20px!important}
  .report-page-head-premium{padding:24px 26px!important;border-radius:28px!important}
  .report-title-wrap h1{font-size:clamp(34px,2.6vw,44px)!important;line-height:1.08!important}
  .report-title-wrap p{max-width:980px!important;font-size:15px!important;line-height:1.65!important}
  .report-control-card{padding:18px!important;border-radius:24px!important}
  .report-control-grid{grid-template-columns:minmax(0,1.28fr) minmax(340px,.9fr)!important;gap:16px!important}
  .report-mode-tabs{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:10px!important;padding:7px!important;border-radius:22px!important}
  .report-mode-btn{min-height:56px!important;border-radius:17px!important;font-size:16px!important}
  .report-period-nav{grid-template-columns:54px minmax(260px,1fr) 54px!important;gap:12px!important}
  .report-date-field input,.report-range-grid input,.report-field select,.report-nav-btn{height:54px!important;min-height:54px!important;border-radius:16px!important;font-size:16px!important}
  .report-quick-actions .btn{min-height:44px!important;border-radius:15px!important;font-size:14px!important}
  .report-top-stats{grid-template-columns:repeat(3,minmax(0,1fr))!important}
  .manager-report-panel{padding:18px!important;border-radius:24px!important}
  .manager-report-grid{grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:12px!important}
  .manager-report-card{min-height:168px!important;display:grid!important;align-content:space-between!important}
  .manager-report-card .btn,.manager-report-card button{align-self:end!important;width:100%!important}
  .report-tool-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:14px!important}
  .report-tool-grid-single{grid-template-columns:1fr!important}
  .report-export-card,.report-tool-card,.manager-inout-modal-fix-card{
    min-height:154px!important;
    display:flex!important;
    flex-direction:column!important;
    align-items:stretch!important;
    justify-content:space-between!important;
  }
  .report-export-actions{margin-top:auto!important;display:flex!important;justify-content:flex-end!important;gap:10px!important;flex-wrap:wrap!important}
  .report-export-actions .btn{min-width:126px!important;min-height:46px!important;border-radius:14px!important;font-size:14px!important}
  .report-movement-card{min-height:250px!important;display:flex!important;flex-direction:column!important}
  .report-movement-foot{margin-top:auto!important}

  /* PC Modal: premium desktop sheet instead of mobile-scaled panel. */
  body.modal-open #modal:not(.bulk-qr-modal):not(.qr-modal):not(.compact-card-modal){
    align-items:center!important;
    justify-content:center!important;
    padding:calc(var(--desktop-topbar,76px) + 24px) 34px 34px calc(var(--desktop-sidebar,292px) + 34px)!important;
  }
  body.modal-open #modal:not(.bulk-qr-modal):not(.qr-modal):not(.compact-card-modal) .sheet{
    width:min(1120px,calc(100vw - var(--desktop-sidebar,292px) - 86px))!important;
    max-width:1120px!important;
    max-height:calc(100vh - var(--desktop-topbar,76px) - 74px)!important;
    border-radius:28px!important;
    padding:22px!important;
    box-shadow:0 30px 80px rgba(8,25,20,.28)!important;
  }
  body.modal-open #modal:not(.bulk-qr-modal):not(.qr-modal):not(.compact-card-modal) #modalBody{
    padding-bottom:36px!important;
    scroll-padding-bottom:48px!important;
  }
  .inout-report-modal,.stock-balance-report,.history-detail-modal{font-size:14px!important}
  .inout-report-row,.stock-balance-report-row{border-radius:17px!important;padding:13px!important}
}

@media (min-width:1440px){
  .stock-card-list{grid-template-columns:repeat(3,minmax(0,1fr))!important}
  .history-list{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  .report-page-premium,.dashboard-heading,.home-priority-card,.dashboard-stat-grid,.dashboard-grid-main,.dashboard-alert-columns,.stock-page-head,.stock-toolbar,.stock-card-list,.history-page{max-width:1440px!important}
}

@media (min-width:1700px){
  .stock-card-list{grid-template-columns:repeat(4,minmax(0,1fr))!important}
  .history-list{grid-template-columns:repeat(3,minmax(0,1fr))!important}
  .report-tool-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}
}
`;
  document.head.appendChild(style);
}
ensurePCProfessionalLayoutV342940();

function ensurePCLargeReadabilityLayoutV342941(){
  if(document.getElementById('theviewPCLargeReadabilityV342941')) return;
  const style=document.createElement('style');
  style.id='theviewPCLargeReadabilityV342941';
  style.textContent=`


/* v34.29.48 — PC Large Readability Layout
   Bigger desktop typography and fuller use of widescreen space for senior/manager users (50+).
   Mobile layout remains unchanged. */
@media (min-width:1024px){
  :root{--pc-readable-content:1520px;--pc-readable-font:17px;--pc-readable-card-radius:24px}
  body:not(.auth-screen-active):not(.password-gate-active){font-size:var(--pc-readable-font)!important}
  .desktop-workspace-bar{height:82px!important;padding-left:clamp(30px,3.2vw,54px)!important}
  .desktop-workspace-copy small{font-size:13px!important;letter-spacing:.12em!important}
  .desktop-workspace-copy strong{font-size:23px!important;line-height:1.1!important}
  .desktop-workspace-page{font-size:16px!important;font-weight:900!important;color:#52645d!important}
  /* v34.29.50 — PC sidebar brand balance fix: true visual centering + breathing room */
  :root{--desktop-brand-height:196px}
  .hero{padding:18px 22px!important}
  .hero-shell{height:100%!important;min-height:0!important;justify-content:center!important}
  .hero-topline{min-height:0!important;padding:0!important}
  .hero-resort-brand{width:100%!important;max-width:none!important;height:50px!important;margin:0 auto!important}
  .brand-logo-hero{width:132px!important;height:50px!important;margin:0 auto!important;object-position:center!important}
  .hero-main-copy{width:100%!important;margin:8px auto 0!important;padding:0!important;text-align:center!important}
  .hero h1{max-width:224px!important;margin:0 auto!important;font-size:20px!important;line-height:1.08!important;letter-spacing:.055em!important;text-align:center!important;white-space:normal!important}
  .hero-divider{margin:8px auto 7px!important;gap:7px!important}
  .hero-divider:before,.hero-divider:after{width:54px!important}
  .hero-divider span{width:14px!important;height:14px!important;font-size:9px!important}
  .hero p{max-width:238px!important;margin:0 auto!important;padding:0 2px!important;font-size:10.5px!important;line-height:1.28!important;letter-spacing:0!important;text-align:center!important;white-space:normal!important}
  body .app .bottom-nav{gap:8px!important;padding-left:18px!important;padding-right:18px!important}
  body .app .bottom-nav button{min-height:62px!important;border-radius:17px!important;padding:10px 15px!important;grid-template-columns:42px minmax(0,1fr)!important;gap:12px!important}
  body .app .bottom-nav button>span:first-child{width:38px!important;height:38px!important;font-size:25px!important}
  body .app .bottom-nav .nav-create>span:first-child{width:38px!important;height:38px!important;font-size:26px!important}
  .bottom-nav .nav-text{font-size:16px!important;font-weight:900!important;letter-spacing:.01em!important}
  .desktop-menu-avatar{width:42px!important;height:42px!important;border-radius:14px!important;font-size:19px!important}
  .desktop-menu-copy b{font-size:15px!important}
  .desktop-menu-copy small{font-size:12px!important}
  .hero .header-menu-btn{width:164px!important;height:58px!important;border-radius:18px!important;grid-template-columns:42px minmax(0,1fr)!important}
  .hero #networkStatusIndicator.network-status-pill{height:48px!important;min-height:48px!important;padding:0 18px!important}
  .hero #networkStatusIndicator.network-status-pill span:last-child{font-size:15px!important;font-weight:900!important}

  body .app .page{padding:calc(var(--desktop-topbar,76px) + 30px) clamp(24px,2.4vw,42px) 72px!important}
  .dashboard-heading,.home-priority-card,.dashboard-stat-grid,.dashboard-grid-main,.dashboard-alert-columns,.stock-page-head,.stock-toolbar,.stock-card-list,.history-page,.report-page-premium{max-width:var(--pc-readable-content)!important}
  .card{border-radius:var(--pc-readable-card-radius)!important}

  .dashboard-heading h1,.stock-page-head h1,.history-page-head h1,.page>h1,.page>.between:first-child h1{font-size:clamp(40px,3.05vw,52px)!important;line-height:1.05!important;letter-spacing:-.045em!important}
  .dashboard-kicker{font-size:16px!important}.dashboard-date{font-size:16px!important;padding:10px 15px!important}
  .home-priority-card{grid-template-columns:78px minmax(0,1fr) 34px!important;padding:24px 28px!important;border-radius:28px!important;min-height:132px!important}
  .home-priority-icon{width:70px!important;height:70px!important;border-radius:22px!important;font-size:34px!important}
  .home-priority-copy span{font-size:22px!important}.home-priority-copy b{font-size:56px!important}.home-priority-copy small{font-size:16px!important}.home-priority-arrow{font-size:38px!important}

  .dashboard-stat-grid{grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:16px!important;margin:18px auto!important}
  .dashboard-stat{min-height:132px!important;padding:22px!important;border-radius:26px!important;grid-template-columns:58px minmax(0,1fr)!important;gap:16px!important;align-items:center!important}
  .dashboard-stat-icon{width:58px!important;height:58px!important;border-radius:19px!important;font-size:29px!important}
  .dashboard-stat small{font-size:17px!important;line-height:1.25!important}.dashboard-stat b{font-size:44px!important;line-height:1!important;margin:6px 0!important}.dashboard-stat em{font-size:15px!important;line-height:1.3!important}
  .dashboard-grid-main{grid-template-columns:minmax(0,1.55fr) minmax(390px,.9fr)!important;gap:20px!important}
  .dashboard-chart-card,.dashboard-side-card,.dashboard-alert-card{padding:24px!important;border-radius:28px!important}
  .dashboard-section-head small{font-size:15px!important}.dashboard-section-head h2{font-size:27px!important;line-height:1.15!important}.dashboard-section-head button,.dashboard-chart-footer button{font-size:16px!important}
  .dashboard-legend{font-size:15px!important;gap:18px!important}.dashboard-legend i{width:11px!important;height:11px!important}
  .dash-chart{height:230px!important;gap:12px!important;padding:24px 0 8px!important}.dash-bar{width:min(18px,38%)!important}.dash-chart-day span{font-size:14px!important}.dashboard-chart-footer{font-size:16px!important}
  .dashboard-top-row{grid-template-columns:42px minmax(0,1fr) auto!important;gap:14px!important;padding:14px 0!important}.dashboard-top-row .rank{width:36px!important;height:36px!important;border-radius:12px!important;font-size:18px!important}.dashboard-top-row b{font-size:17px!important}.dashboard-top-row small{font-size:14px!important}.dashboard-top-row strong{font-size:18px!important}
  .dashboard-low-list button{grid-template-columns:58px minmax(0,1fr) auto!important;padding:14px!important;border-radius:20px!important}.dashboard-low-list button>span{width:58px!important;height:58px!important;border-radius:16px!important}.dashboard-low-list b{font-size:17px!important}.dashboard-low-list small{font-size:14px!important}.dashboard-low-list strong{font-size:28px!important}.dashboard-empty{font-size:17px!important;padding:28px!important}

  .stock-page-head{margin-bottom:20px!important}.stock-head-actions .btn{min-height:52px!important;font-size:16px!important;border-radius:16px!important;padding:0 18px!important}
  .stock-toolbar{padding:22px!important;border-radius:28px!important;gap:16px!important;grid-template-columns:minmax(360px,1.4fr) minmax(260px,1fr) minmax(220px,.8fr) minmax(220px,.8fr)!important}
  .stock-toolbar input,.stock-toolbar select{height:58px!important;min-height:58px!important;font-size:17px!important;border-radius:18px!important;padding:0 18px!important}.stock-result-count{font-size:16px!important;font-weight:850!important}
  .stock-card-list{grid-template-columns:repeat(auto-fit,minmax(430px,1fr))!important;gap:18px!important}
  .stock-card-modern{min-height:176px!important;padding:22px 20px 22px 24px!important;grid-template-columns:96px minmax(0,1fr) minmax(106px,auto)!important;gap:18px!important;border-radius:26px!important}
  .stock-card-photo{width:92px!important;height:118px!important;border-radius:18px!important}.stock-card-name{font-size:24px!important;line-height:1.2!important}.stock-card-sku,.stock-card-meta,.stock-card-lot{font-size:15px!important;line-height:1.45!important}.stock-card-number{font-size:54px!important}.stock-card-unit{font-size:18px!important}.stock-status-modern{font-size:14px!important;padding:9px 13px!important}.stock-card-arrow{font-size:32px!important}

  .history-page{max-width:var(--pc-readable-content)!important}.history-control-card{padding:22px!important;border-radius:28px!important;gap:18px!important}.history-control-card input,.history-control-card select,.history-date-input,.history-date-box input{height:56px!important;font-size:17px!important;border-radius:18px!important}.history-filter-btn{min-height:46px!important;padding:0 18px!important;font-size:16px!important;border-radius:999px!important}.history-day-heading strong{font-size:22px!important}.history-day-heading small{font-size:16px!important}.history-list{gap:16px!important}.history-entry{min-height:184px!important;padding:18px!important;border-radius:23px!important;grid-template-columns:minmax(0,1fr) 110px!important}.history-entry-title{font-size:20px!important;line-height:1.35!important}.history-qty{font-size:17px!important}.history-entry-meta{font-size:15px!important;line-height:1.45!important}.history-entry-open-hint{font-size:15px!important}.history-entry-thumb{width:106px!important;height:106px!important;border-radius:18px!important}.history-return-inline{font-size:15px!important;padding:9px 13px!important}

  .report-page-premium{max-width:var(--pc-readable-content)!important;gap:24px!important}.report-title-wrap h1{font-size:clamp(46px,3.35vw,62px)!important}.report-title-wrap p{font-size:18px!important;line-height:1.7!important}.report-control-card{padding:24px!important}.report-mode-btn,.report-dashboard-tab{font-size:19px!important;min-height:66px!important}.report-date-field input,.report-range-grid input,.report-field select,.report-nav-btn{height:62px!important;min-height:62px!important;font-size:18px!important}.report-quick-actions .btn,.report-export-actions .btn{min-height:52px!important;font-size:16px!important}.manager-report-card{min-height:196px!important;padding:20px!important}.manager-report-card b{font-size:17px!important}.manager-report-card strong{font-size:38px!important}.manager-report-card small{font-size:15px!important}.report-tool-card,.report-export-card{min-height:182px!important;padding:22px!important}.report-tool-card b,.report-export-card b{font-size:20px!important}.report-tool-card .muted,.report-export-card .muted{font-size:16px!important;line-height:1.6!important}

  body.modal-open #modal:not(.bulk-qr-modal):not(.qr-modal):not(.compact-card-modal) .sheet{width:min(1240px,calc(100vw - var(--desktop-sidebar,292px) - 70px))!important;max-width:1240px!important;padding:28px!important;border-radius:32px!important;font-size:17px!important}
  .inout-report-modal,.stock-balance-report,.history-detail-modal{font-size:17px!important}.inout-report-modal h2,.stock-balance-report h2,.history-detail-modal h2{font-size:30px!important}.inout-report-row,.stock-balance-report-row{padding:18px!important;border-radius:22px!important}.inout-report-row b,.stock-balance-report-row b{font-size:18px!important}.inout-report-row small,.stock-balance-report-row small{font-size:15px!important}.btn{font-size:17px!important}.btn.small{font-size:15px!important}
}
@media (min-width:1500px){
  :root{--pc-readable-content:1600px}
  .stock-card-list{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  .history-list{grid-template-columns:repeat(2,minmax(0,1fr))!important}
}
@media (min-width:1800px){
  .stock-card-list{grid-template-columns:repeat(3,minmax(0,1fr))!important}
  .history-list{grid-template-columns:repeat(3,minmax(0,1fr))!important}
}

  `;
  document.head.appendChild(style);
}
ensurePCLargeReadabilityLayoutV342941();






// ---------- v33.0 Android/mobile page scrolling reliability ----------
function normalizeMobilePageScrollV329(){
  const html=document.documentElement;
  const body=document.body;
  if(!html || !body) return;

  // ถ้า modal เปิดอยู่ ห้ามล้าง scroll-lock เพราะจะทำให้ iOS Safari เลื่อนหน้าด้านหลังได้
  const modal=$('modal');
  const modalVisible=modal && !modal.classList.contains('hidden');
  if(modalVisible){
    body.classList.add('modal-open');
    return;
  }

  // ปลดสถานะล็อกการเลื่อนที่อาจค้างหลังปิด modal / กลับจาก background
  body.classList.remove('modal-open','modal-scroll-locked');
  html.classList.remove('modal-scroll-locked');

  html.style.removeProperty('position');
  html.style.removeProperty('height');
  html.style.removeProperty('overflow');
  body.style.removeProperty('position');
  body.style.removeProperty('inset');
  body.style.removeProperty('left');
  body.style.removeProperty('right');
  body.style.removeProperty('width');
  body.style.removeProperty('height');
  body.style.removeProperty('top');
  body.style.removeProperty('overflow');
  body.style.removeProperty('touch-action');
}

window.addEventListener('pageshow',()=>requestAnimationFrame(normalizeMobilePageScrollV329));
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible') requestAnimationFrame(normalizeMobilePageScrollV329);
});
window.addEventListener('orientationchange',()=>setTimeout(normalizeMobilePageScrollV329,120));

// ---------- v28.8 PC mouse-wheel scrolling anywhere ----------
function ensureDesktopWheelScrollV288(){
  if(window.__theviewDesktopWheelV288) return;
  window.__theviewDesktopWheelV288=true;

  const isDesktop=()=>window.matchMedia('(min-width:1024px)').matches;

  document.addEventListener('wheel',(event)=>{
    if(!isDesktop() || event.ctrlKey || event.metaKey) return;
    const target=event.target instanceof Element ? event.target : null;
    if(!target) return;

    // When a modal is open, wheel anywhere in that modal scrolls its sheet.
    const modal=target.closest('.modal');
    if(modal){
      const sheet=modal.querySelector('.sheet');
      if(sheet && sheet.scrollHeight>sheet.clientHeight){
        event.preventDefault();
        sheet.scrollTop += event.deltaY;
      }
      return;
    }

    // Search suggestion lists keep their own scrolling.
    const results=target.closest('.scan-product-results');
    if(results && results.scrollHeight>results.clientHeight){
      event.preventDefault();
      results.scrollTop += event.deltaY;
      return;
    }

    // On PC, wheel over header, sidebar, cards, buttons, inputs, or empty space
    // always moves the main page—not only when the pointer is over the scrollbar.
    event.preventDefault();
    window.scrollBy({top:event.deltaY,left:0,behavior:'auto'});
  },{passive:false,capture:true});
}
ensureDesktopWheelScrollV288();



function parseExpiryDate(value=''){
  const raw=String(value||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year,month,day]=raw.split('-').map(Number);
  const date=new Date(year,month-1,day);
  if(date.getFullYear()!==year || date.getMonth()!==month-1 || date.getDate()!==day) return null;
  date.setHours(0,0,0,0);
  return date;
}

// ---------- Batch/Lot + FEFO v34.18.4 LOT SPACING ----------
function normalizeProductNameKey(value=''){ return String(value||'').trim().toLowerCase().replace(/\s+/g,' '); }
function lotNamePrefix(product={}){
  return String(product.name||product.sku||'สินค้า').trim().replace(/\s+/g,' ').replace(/[\/\\#?%*:|"<>]/g,'').slice(0,28)||'สินค้า';
}
function generateLotNo(product={},expiryDate=''){
  const prefix=lotNamePrefix(product);
  const lots=normalizeProductLots(product);
  const used=lots.map(l=>String(l.lotNo||''));
  let max=lots.length;
  used.forEach(no=>{ const m=no.match(/(\d{3,})$/); if(m) max=Math.max(max,Number(m[1])||0); });
  return `${prefix}-${String(max+1).padStart(3,'0')}`;
}
function normalizeProductLots(product={}){
  if(Array.isArray(product.lots) && product.lots.length){
    return product.lots.map((lot,i)=>({
      id:String(lot.id||`LOT-${i+1}`),
      lotNo:String(lot.lotNo||lot.id||`${lotNamePrefix(product)}-${String(i+1).padStart(3,'0')}`),
      qty:Math.max(0,Number(lot.qty)||0), expiryDate:String(lot.expiryDate||''),
      receivedAt:lot.receivedAt||'', receivedByUid:lot.receivedByUid||'', receivedByName:lot.receivedByName||'',
      note:String(lot.note||''), status:lot.status||'active'
    }));
  }
  const qty=Math.max(0,Number(product.stock)||0);
  if(!qty) return [];
  return [{id:'LEGACY-001',lotNo:`${lotNamePrefix(product)}-001`,qty,expiryDate:product.hasExpiry?String(product.expiryDate||''):'',receivedAt:product.createdAt||'',receivedByUid:'',receivedByName:'ข้อมูลเดิม',note:'ยอดเดิมก่อนเปิดใช้ระบบล็อต',status:'active'}];
}
function lotDisplayMap(product={}){
  const map=new Map(),prefix=lotNamePrefix(product);
  normalizeProductLots(product).forEach((lot,index)=>map.set(lot.id,`${prefix}-${String(index+1).padStart(3,'0')}`));
  return map;
}
function activeProductLots(product={}){
  return normalizeProductLots(product).filter(l=>Number(l.qty)>0 && l.status!=='closed').sort((a,b)=>{
    const ad=parseExpiryDate(a.expiryDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bd=parseExpiryDate(b.expiryDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return ad-bd || String(a.id).localeCompare(String(b.id),'th',{numeric:true});
  });
}
function earliestProductLot(product={}){ return activeProductLots(product)[0]||null; }
function lotAwareProduct(product={}){ const lot=earliestProductLot(product); return lot?{...product,hasExpiry:!!lot.expiryDate,expiryDate:lot.expiryDate}:product; }
function lotDateLabel(value=''){ const d=parseExpiryDate(value); return d?d.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'}):'ไม่ระบุ'; }
function lotSelectHtml(product={},selectedId=''){
  const lots=activeProductLots(product),names=lotDisplayMap(product);
  if(!lots.length) return '<div class="note">สินค้านี้ยังไม่มีล็อตคงเหลือ</div>';
  return `<label class="new-item-label" for="scanLot">เลือกล็อตที่ต้องการเบิก</label><select id="scanLot" class="new-item-input">${lots.map((l,i)=>`<option value="${escapeHtml(l.id)}" ${selectedId===l.id?'selected':''}>${i===0?'⭐ ควรเบิกก่อน • ':''}${escapeHtml(names.get(l.id)||l.lotNo)} • หมดอายุ ${escapeHtml(lotDateLabel(l.expiryDate))} • เหลือ ${Number(l.qty)||0} ${escapeHtml(product.unit||'')}</option>`).join('')}</select><div class="muted" style="font-size:12px;margin-top:6px">ระบบแนะนำล็อตที่หมดอายุก่อนตามหลัก FEFO</div>`;
}
function renderScanLotSection(product={}){
  const box=$('scanLotSection'); if(!box) return;
  const type=state.newItemType||'out';
  if(type==='out') box.innerHTML=lotSelectHtml(product);
  else box.innerHTML=`<label class="new-item-label" for="scanLotExpiry">วันหมดอายุของล็อตใหม่</label><input id="scanLotExpiry" class="new-item-input" type="date"><label class="new-item-label" for="scanLotNo">เลขล็อต <span class="muted">(เว้นว่างให้ระบบสร้าง)</span></label><input id="scanLotNo" class="new-item-input" placeholder="สร้างอัตโนมัติ">`;
}
function lotSummaryMarkup(product={}){
  const lots=activeProductLots(product); if(!lots.length) return '';
  // v34.28.15: การ์ดหลักแสดงเฉพาะจำนวนล็อต ส่วน FEFO / วันหมดอายุ / ล็อตที่ควรเบิก ดูในหน้าล็อตด้านใน
  return `<div class="stock-lot-summary">📦 ${lots.length} ล็อต</div>`;
}
function lotReceivedDateValue(value){
  if(!value) return '';
  let d=value;
  if(typeof value?.toDate==='function') d=value.toDate(); else d=new Date(value);
  return d instanceof Date&&!isNaN(d)?toDateStr(d):String(value||'').slice(0,10);
}
function lotReceivedLabel(value){ const raw=lotReceivedDateValue(value),d=parseExpiryDate(raw); return d?d.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'}):'ไม่ระบุ'; }
function lotExpiryMeta(lot={}){
  const d=parseExpiryDate(lot.expiryDate||'');
  if(!d) return {key:'missing',label:'ไม่ระบุวันหมดอายุ',days:null,icon:'⚪'};
  const today=new Date(); today.setHours(0,0,0,0);
  const days=Math.round((d.getTime()-today.getTime())/86400000);
  if(days<0) return {key:'expired',label:`หมดอายุแล้ว ${Math.abs(days)} วัน`,days,icon:'🔴'};
  if(days===0) return {key:'today',label:'หมดอายุวันนี้',days,icon:'🔴'};
  if(days<=7) return {key:'urgent',label:`เหลือ ${days} วัน`,days,icon:'🟠'};
  if(days<=30) return {key:'warning',label:`เหลือ ${days} วัน`,days,icon:'🟡'};
  return {key:'normal',label:`เหลือ ${days} วัน`,days,icon:'🟢'};
}
function lotDisplayName(product={},lot={},index=0){ return lotDisplayMap(product).get(lot.id)||`${lotNamePrefix(product)}-${String(index+1).padStart(3,'0')}`; }
window.viewProductLots=(productId)=>{
  const p=state.products.find(x=>x.id===productId); if(!p) return toast('ไม่พบสินค้า');
  const names=lotDisplayMap(p),allLots=normalizeProductLots(p),fefo=activeProductLots(p)[0]||null;
  const lots=[...allLots].sort((a,b)=>{
    const ad=parseExpiryDate(a.expiryDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bd=parseExpiryDate(b.expiryDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return ad-bd || String(a.id).localeCompare(String(b.id),'th',{numeric:true});
  });
  const rows=lots.map(l=>{
    const meta=lotExpiryMeta(l),isFefo=fefo?.id===l.id,displayNo=names.get(l.id)||l.lotNo;
    return `<button type="button" class="lot-compact-card lot-${meta.key}" onclick="window.viewLotDetails('${productId}','${escapeHtml(l.id)}')">
      <div class="lot-compact-main"><div class="lot-compact-title">${escapeHtml(displayNo)}</div><div class="lot-compact-badges">${isFefo?'<span class="lot-badge fefo">⭐ ควรเบิกก่อน</span>':''}${l.status==='closed'?'<span class="lot-badge status">ปิดล็อต</span>':''}</div></div>
      <div class="lot-compact-data"><div><span>คงเหลือ</span><b>${Number(l.qty)||0} ${escapeHtml(p.unit||'')}</b></div><div><span>วันหมดอายุ</span><b>${escapeHtml(lotDateLabel(l.expiryDate))}</b><small>${escapeHtml(meta.label)}</small></div><span class="lot-chevron">›</span></div>
    </button>`;
  }).join('');
  openModal(`ล็อตสินค้า: ${escapeHtml(p.name)}`,`<div class="lot-overview"><div><span>คงเหลือรวม</span><b>${Number(p.stock)||0} ${escapeHtml(p.unit||'')}</b></div><div><span>จำนวนล็อต</span><b>${lots.length} ล็อต</b></div></div><p class="lot-tap-hint">แตะการ์ดล็อตเพื่อดูข้อมูลทั้งหมด</p><div class="lot-compact-list">${rows||'<p class="muted">ยังไม่มีข้อมูลล็อต</p>'}</div>`);
};
window.viewLotDetails=(productId,lotId)=>{
  const p=state.products.find(x=>x.id===productId),lot=normalizeProductLots(p||{}).find(l=>l.id===lotId); if(!p||!lot) return toast('ไม่พบล็อต');
  const names=lotDisplayMap(p),displayNo=names.get(lot.id)||lot.lotNo,fefo=earliestProductLot(p),meta=lotExpiryMeta(lot);
  const lotLogs=state.logs.filter(x=>x.productId===productId&&(x.lotId===lot.id||x.lotNo===lot.lotNo));
  const receiver=lot.receivedByName||((lot.id||'').startsWith('LEGACY-')?'ข้อมูลเดิมก่อนใช้ระบบล็อต':'ไม่มีข้อมูล');
  const latestLog=[...lotLogs].sort((a,b)=>(getLogDate(b)?.getTime()||0)-(getLogDate(a)?.getTime()||0))[0];
  const latestActor=latestLog?.actorName||latestLog?.username||latestLog?.performedByName||'ไม่มีข้อมูล';
  openModal(`รายละเอียด ${escapeHtml(displayNo)}`,`<section class="lot-detail-sheet lot-${meta.key}">
    <div class="lot-detail-hero"><div><span class="lot-kicker">ล็อตสินค้า</span><h3>${escapeHtml(displayNo)}</h3><div class="lot-badges">${fefo?.id===lot.id?'<span class="lot-badge fefo">⭐ ควรเบิกก่อน</span>':''}<span class="lot-badge status">${lot.status==='closed'?'ปิดล็อต':'ใช้งาน'}</span></div></div><div class="lot-detail-qty"><strong>${Number(lot.qty)||0}</strong><span>${escapeHtml(p.unit||'')}</span></div></div>
    <div class="lot-expiry-highlight ${meta.key}"><span>${meta.icon}</span><div><small>วันหมดอายุ</small><b>${escapeHtml(lotDateLabel(lot.expiryDate))}</b></div><strong>${escapeHtml(meta.label)}</strong></div>
    <div class="lot-info-grid">
      <div><span>วันที่รับเข้า</span><b>${escapeHtml(lotReceivedLabel(lot.receivedAt))}</b></div>
      <div><span>ผู้รับสินค้า</span><b>${escapeHtml(receiver)}</b></div>
      <div><span>ผู้ดำเนินการล่าสุด</span><b>${escapeHtml(latestActor)}</b></div>
      <div><span>ประวัติที่เกี่ยวข้อง</span><b>${lotLogs.length} รายการ</b></div>
      <div class="lot-detail-wide"><span>หมายเหตุ</span><b>${escapeHtml(lot.note||'ไม่มีหมายเหตุ')}</b></div>
      <div class="lot-detail-wide"><span>รหัสล็อตภายใน</span><b>${escapeHtml(lot.id||'—')}</b></div>
    </div>
    <div class="lot-actions">${Number(lot.qty)>0&&lot.status!=='closed'?`<button class="btn green small" onclick="window.withdrawSpecificLot('${productId}','${escapeHtml(lot.id)}')">📤 เบิกล็อตนี้</button>`:''}<button class="btn light small" onclick="window.viewLotHistory('${productId}','${escapeHtml(lot.id)}')">📋 ดูประวัติ</button>${canManageLots()?`<button class="btn primary small" onclick="window.editProductLot('${productId}','${escapeHtml(lot.id)}')">✏️ แก้ไขวันที่</button>`:''}<button class="btn light small" onclick="window.viewProductLots('${productId}')">← กลับไปรายการล็อต</button></div>
  </section>`);
};
window.withdrawSpecificLot=(productId,lotId)=>{
  const p=state.products.find(x=>x.id===productId); if(!p) return toast('ไม่พบสินค้า');
  const lot=activeProductLots(p).find(l=>l.id===lotId); if(!lot) return toast('ล็อตนี้ไม่พร้อมสำหรับการเบิก');
  hideModal(); state.newItemType='out'; state.page='scan'; saveUiState(); render();
  setTimeout(()=>{ window.selectScanProduct(productId); const select=$('scanLot'); if(select){ select.value=lotId; select.dispatchEvent(new Event('change',{bubbles:true})); } $('scanQty')?.focus(); toast(`เลือกล็อต ${lotDisplayName(p,lot)} แล้ว`); },80);
};
window.viewLotHistory=(productId,lotId)=>{
  const p=state.products.find(x=>x.id===productId),lot=normalizeProductLots(p||{}).find(l=>l.id===lotId); if(!p||!lot) return toast('ไม่พบล็อต');
  const displayNo=lotDisplayName(p,lot);
  const rows=state.logs.filter(x=>x.productId===productId&&(x.lotId===lot.id||x.lotNo===lot.lotNo)).sort((a,b)=>(getLogDate(b)?.getTime()||0)-(getLogDate(a)?.getTime()||0)).map(x=>`<div class="product-history-item"><div class="product-history-main"><b>${escapeHtml(x.action||'รายการ')}</b><div>${escapeHtml(x.detail||'')}</div>${x.changes?.length?`<ul>${x.changes.map(c=>`<li>${escapeHtml(c)}</li>`).join('')}</ul>`:''}</div><div class="product-history-time">${escapeHtml(x.time||'')}</div></div>`).join('');
  openModal(`ประวัติ ${escapeHtml(displayNo)}`,`${rows||'<p class="muted">ยังไม่มีประวัติของล็อตนี้</p>'}<button class="btn light full" style="margin-top:12px" onclick="window.viewLotDetails('${productId}','${escapeHtml(lotId)}')">← กลับไปหน้ารายละเอียด</button>`);
};
window.editProductLot=(productId,lotId)=>{
  if(!canManageLots()) return toast('คุณไม่มีสิทธิ์แก้ไขข้อมูลล็อต');
  const p=state.products.find(x=>x.id===productId),lot=normalizeProductLots(p||{}).find(l=>l.id===lotId); if(!p||!lot) return toast('ไม่พบล็อต');
  openModal(`แก้ไข ${escapeHtml(lotDisplayName(p,lot))}`,`<label class="field-label">วันที่รับเข้า</label><input id="editLotReceived" class="new-item-input" type="date" value="${escapeHtml(lotReceivedDateValue(lot.receivedAt))}"><label class="field-label">วันหมดอายุ</label><input id="editLotExpiry" class="new-item-input" type="date" value="${escapeHtml(String(lot.expiryDate||'').slice(0,10))}"><label class="field-label">เหตุผลที่แก้ไข <span style="color:#dc2626">*</span></label><textarea id="editLotReason" class="new-item-input" rows="3" placeholder="เช่น พนักงานกรอกวันที่ผิด"></textarea><button class="btn primary full" onclick="window.saveProductLotEdit('${productId}','${escapeHtml(lotId)}')">บันทึกการแก้ไข</button><p class="muted" style="margin-top:10px">ระบบจะเก็บค่าเดิม ค่าใหม่ ผู้แก้ไข วันเวลา และเหตุผลไว้ในประวัติถาวร</p>`);
};
window.saveProductLotEdit=async(productId,lotId)=>{
  if(!canManageLots()) return toast('คุณไม่มีสิทธิ์แก้ไขข้อมูลล็อต');
  const p=state.products.find(x=>x.id===productId); if(!p) return toast('ไม่พบสินค้า');
  const lots=normalizeProductLots(p),i=lots.findIndex(l=>l.id===lotId); if(i<0) return toast('ไม่พบล็อต');
  const receivedAt=$('editLotReceived')?.value||'',expiryDate=$('editLotExpiry')?.value||'',reason=($('editLotReason')?.value||'').trim();
  if(!reason) return toast('กรุณาระบุเหตุผลที่แก้ไข');
  const old={receivedAt:lotReceivedDateValue(lots[i].receivedAt),expiryDate:String(lots[i].expiryDate||'')};
  if(old.receivedAt===receivedAt&&old.expiryDate===expiryDate) return toast('ไม่มีข้อมูลเปลี่ยนแปลง');
  lots[i]={...lots[i],receivedAt:receivedAt?`${receivedAt}T00:00:00.000Z`:'',expiryDate};
  const earliest=earliestProductLot({...p,lots});
  const changes=[`วันที่รับเข้า: ${old.receivedAt||'ไม่ระบุ'} → ${receivedAt||'ไม่ระบุ'}`,`วันหมดอายุ: ${old.expiryDate||'ไม่ระบุ'} → ${expiryDate||'ไม่ระบุ'}`,`เหตุผล: ${reason}`];
  try{
    const batch=writeBatch(fs),eventId=makeEventId('LOTEDIT'),logDoc=doc(logRef()),auditDoc=doc(auditRef());
    batch.update(productRef(productId),{lots,expiryDate:earliest?.expiryDate||'',hasExpiry:lots.some(l=>!!l.expiryDate),updatedAt:serverTimestamp()});
    const detail=`แก้ไขข้อมูลล็อต ${lotDisplayName(p,lots[i],i)}`;
    batch.set(logDoc,logPayload('แก้ไขข้อมูลล็อต',detail,{productId,lotId,lotNo:lots[i].lotNo,changes,reason,eventId}));
    batch.set(auditDoc,auditPayload('แก้ไขข้อมูลล็อต',detail,{productId,lotId,lotNo:lots[i].lotNo,changes,reason,eventId,logId:logDoc.id}));
    await batch.commit(); hideModal(); toast('บันทึกข้อมูลล็อตและประวัติแล้ว');
  }catch(e){ console.error(e); toast(e?.code==='permission-denied'?'ไม่มีสิทธิ์แก้ไขล็อต กรุณาอัปเดต Firestore Rules':`บันทึกไม่สำเร็จ (${e?.code||'unknown'})`); }
};

function getExpiryReminderDays(product={}){
  const raw=product.expiryReminderDays ?? product.expiryAlertDays ?? 7;
  const days=Number(raw);
  return Number.isFinite(days)&&days>=0?Math.floor(days):7;
}
function getExpiryStatus(product){
  product=lotAwareProduct(product);
  if(!product?.hasExpiry) return {active:false,key:'none',days:null,label:'ไม่มีวันหมดอายุ',shortLabel:'ไม่มีวันหมดอายุ',className:'expiry-none'};
  const expiry=parseExpiryDate(product.expiryDate);
  if(!expiry) return {active:false,key:'missing',days:null,label:'ยังไม่ได้ระบุวันหมดอายุ',shortLabel:'ไม่ได้ระบุวันที่',className:'expiry-none'};
  const today=new Date(); today.setHours(0,0,0,0);
  const days=Math.round((expiry.getTime()-today.getTime())/86400000);
  const reminderDays=getExpiryReminderDays(product);
  if(days<0) return {active:true,key:'expired',days,label:`หมดอายุแล้ว ${Math.abs(days)} วัน`,shortLabel:`เกิน ${Math.abs(days)} วัน`,className:'expiry-expired'};
  if(days===0) return {active:true,key:'today',days,label:'หมดอายุวันนี้',shortLabel:'วันนี้',className:'expiry-today'};
  if(days<=reminderDays) return {active:true,key:'warning',days,label:`ใกล้หมดอายุ เหลือ ${days} วัน`,shortLabel:`เหลือ ${days} วัน`,className:'expiry-warning'};
  return {active:false,key:'normal',days,label:`ปกติ • หมดอายุใน ${days} วัน`,shortLabel:`อีก ${days} วัน`,className:'expiry-normal'};
}
function expiryDateLabel(product){
  product=lotAwareProduct(product);
  const date=parseExpiryDate(product?.expiryDate);
  return date?date.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'}):'-';
}
function expiryStatusMarkup(product,{compact=false}={}){
  const status=getExpiryStatus(product);
  if(!product?.hasExpiry || !status.active) return '';
  const label=compact?status.shortLabel:status.label;
  return `<span class="expiry-badge ${status.className}">⏰ ${escapeHtml(label)}</span>`;
}
function expiryFormMarkup(product={}){
  const has=!!product.hasExpiry;
  const reminderDays=getExpiryReminderDays(product);
  const preset=[3,7,14,30].includes(reminderDays)?String(reminderDays):'custom';
  return `<div class="expiry-form-card">
    <label class="expiry-toggle-row">
      <input id="hasExpiry" type="checkbox" ${has?'checked':''} onchange="window.toggleExpiryFields()">
      <span><b>สินค้านี้มีวันหมดอายุ</b><small>เปิดเฉพาะสินค้าที่ต้องติดตาม เช่น น้ำผลไม้ นม ครีม และวัตถุดิบ</small></span>
    </label>
    <div id="expiryFields" class="${has?'':'hidden'}">
      <label class="field-label" for="expiryDate">วันหมดอายุ</label>
      <input id="expiryDate" type="date" value="${escapeHtml(product.expiryDate||'')}">
      <label class="field-label" for="expiryReminderPreset">แจ้งเตือนก่อนหมดอายุ</label>
      <select id="expiryReminderPreset" onchange="window.toggleCustomExpiryDays()">
        <option value="3" ${preset==='3'?'selected':''}>3 วันก่อนหมดอายุ</option>
        <option value="7" ${preset==='7'?'selected':''}>7 วันก่อนหมดอายุ</option>
        <option value="14" ${preset==='14'?'selected':''}>14 วันก่อนหมดอายุ</option>
        <option value="30" ${preset==='30'?'selected':''}>30 วันก่อนหมดอายุ</option>
        <option value="custom" ${preset==='custom'?'selected':''}>อื่น ๆ — ระบุเอง</option>
      </select>
      <div id="customExpiryDaysWrap" class="${preset==='custom'?'':'hidden'}">
        <label class="field-label" for="customExpiryDays">จำนวนวันที่ต้องการแจ้งเตือนล่วงหน้า</label>
        <div class="expiry-custom-days"><input id="customExpiryDays" type="number" min="0" max="3650" step="1" value="${reminderDays}" inputmode="numeric"><span>วัน</span></div>
      </div>
    </div>
  </div>`;
}
window.toggleExpiryFields=()=>{
  const enabled=!!$('hasExpiry')?.checked;
  $('expiryFields')?.classList.toggle('hidden',!enabled);
  if(enabled && !$('expiryDate')?.value) setTimeout(()=>$('expiryDate')?.focus(),50);
};
window.toggleCustomExpiryDays=()=>{
  const custom=$('expiryReminderPreset')?.value==='custom';
  $('customExpiryDaysWrap')?.classList.toggle('hidden',!custom);
  if(custom) setTimeout(()=>$('customExpiryDays')?.focus(),50);
};
function readExpiryForm(){
  const hasExpiry=!!$('hasExpiry')?.checked;
  if(!hasExpiry) return {hasExpiry:false,expiryDate:'',expiryReminderDays:0};
  const expiryDate=$('expiryDate')?.value||'';
  const preset=$('expiryReminderPreset')?.value||'7';
  const expiryReminderDays=preset==='custom'?Number($('customExpiryDays')?.value):Number(preset);
  if(!parseExpiryDate(expiryDate)) throw new Error('กรุณาระบุวันหมดอายุให้ถูกต้อง');
  if(!Number.isInteger(expiryReminderDays)||expiryReminderDays<0||expiryReminderDays>3650) throw new Error('จำนวนวันแจ้งเตือนต้องเป็นเลข 0–3650 วัน');
  return {hasExpiry:true,expiryDate,expiryReminderDays};
}
function isExpiredForIssue(product){
  const status=getExpiryStatus(product);
  return status.key==='today'||status.key==='expired';
}
function confirmExpiredIssue(product){
  const status=getExpiryStatus(product);
  if(!isExpiredForIssue(product)) return true;
  return confirm(`⚠️ สินค้า “${product?.name||'-'}” ${status.label}\n\nต้องการดำเนินการเบิกต่อหรือไม่?`);
}

// ---------- Product QR Code (v34.19.0) ----------
function productQrBaseUrl(){
  try{
    const url=new URL(location.href);
    url.search=''; url.hash='';
    return url.origin + url.pathname;
  }catch(_){ return location.origin + location.pathname; }
}
function productQrPayload(product={}){
  const id=String(product.id||'').trim();
  // v34.19.7: ใช้หน้า QR Preview แบบ standalone ที่ root เสมอ
  // ป้องกัน QR เผลอเปิด index.html แล้วโดน Login/Auth Guard ดักก่อน Preview
  const url=new URL('/qr.html', location.origin);
  url.search='';
  url.hash='';
  url.searchParams.set('id',id);
  url.searchParams.set('v','34.29.36');
  return url.toString();
}
function productQrFileName(product={}){
  const name=String(product.name||product.sku||product.id||'product').trim().replace(/[\\/:*?"<>|#%]/g,'').replace(/\s+/g,'-').slice(0,48)||'product';
  return `QR-${name}.svg`;
}

function publicProductPreviewData(product={}){
  const id=String(product.id||'').trim();
  return {
    productId:id,
    name:String(product.name||'').trim(),
    sku:String(product.sku||'').trim(),
    skuKey:normalizeSkuKey(product.sku||''),
    category:String(product.category||'ทั่วไป').trim(),
    unit:String(product.unit||'หน่วย').trim(),
    stock:Math.max(0,Number(product.stock)||0),
    photo:String(product.photo||'').trim(),
    status: product.trashed ? 'trashed' : (product.archived ? 'archived' : 'active'),
    publicLabel:'ข้อมูลเบื้องต้นจาก QR Code',
    updatedAt:serverTimestamp()
  };
}
function isPublicProductAllowed(product={}){
  return !!product && product.trashed !== true && product.archived !== true;
}
async function revokePublicProductPreview(id,reason='inactive'){
  const target=String(id||'').trim();
  if(!target || !state.user) return false;
  try{
    await deleteDoc(publicProductRef(target));
    return true;
  }catch(err){
    console.warn('revoke public product preview failed',reason,err);
    return false;
  }
}
async function syncPublicProductPreview(product={}){
  const id=String(product.id||'').trim();
  if(!id) return false;
  // v34.19.7: QR Preview ต้องไม่เหลือข้อมูลสินค้าที่ถูกย้ายไปถังขยะ/Archive
  if(!isPublicProductAllowed(product)){
    await revokePublicProductPreview(id, product.trashed ? 'trashed' : 'archived');
    return true;
  }
  await setDoc(publicProductRef(id),publicProductPreviewData({...product,id}),{merge:true});
  return true;
}
async function syncPublicProductPreviewById(id){
  const target=String(id||'').trim();
  if(!target || !state.user) return false;
  try{
    const snap=await getDoc(productRef(target));
    if(!snap.exists()){
      await revokePublicProductPreview(target,'missing-product');
      return false;
    }
    const product={id:target,...snap.data()};
    if(!isPublicProductAllowed(product)){
      await revokePublicProductPreview(target,product.trashed?'trashed':'archived');
      return true;
    }
    await syncPublicProductPreview(product);
    return true;
  }catch(err){
    console.warn('sync public product preview by id failed',err);
    return false;
  }
}
function refreshPublicProductPreviewQuietly(id){
  syncPublicProductPreviewById(id).catch(err=>console.warn('refresh public preview failed',err));
}
let publicPreviewCleanupRunning=false;
async function cleanupPublicProductPreviews(validActiveProductIds){
  if(publicPreviewCleanupRunning || !state.user || !canManageProducts() || !navigator.onLine) return 0;
  publicPreviewCleanupRunning=true;
  try{
    const activeIds=validActiveProductIds || new Set((state.products||[]).filter(p=>isPublicProductAllowed(p)).map(p=>p.id));
    const snap=await getDocsFromServer(userPath('publicProducts'));
    const stale=snap.docs.filter(d=>!activeIds.has(d.id) || d.data()?.status !== 'active');
    for(let i=0;i<stale.length;i+=400){
      const batch=writeBatch(fs);
      stale.slice(i,i+400).forEach(d=>batch.delete(d.ref));
      await batch.commit();
    }
    if(stale.length) console.info('ล้าง QR public preview ที่ไม่ใช้งานแล้ว',stale.length);
    return stale.length;
  }catch(err){
    console.warn('cleanup public product previews failed',err);
    return 0;
  }finally{
    publicPreviewCleanupRunning=false;
  }
}
function cleanupPublicProductPreviewsQuietly(){
  cleanupPublicProductPreviews().catch(err=>console.warn('cleanup public preview failed',err));
}
function productQrStockLabel(product={}){
  if(product.missing || product.stock===undefined || product.stock===null || product.stock==='') return '-';
  const n=Number(product.stock);
  const qty=Number.isFinite(n) ? n.toLocaleString('th-TH') : String(product.stock);
  return `${qty} ${String(product.unit||'หน่วย')}`;
}
function removeProductQrParamsFromUrl(){
  try{
    const url=new URL(location.href);
    ['p','product','productId','qr','staffProduct','openProduct','staffProductId','qrStaffLogin','fromQrPreview','v'].forEach(k=>url.searchParams.delete(k));
    const rawHash=String(url.hash||'').replace(/^#/,'').trim();
    if(rawHash && (/(^|[=&\/])(qr|p|product|productId)(=|\/)/i.test(rawHash) || (!/[=&\/]/.test(rawHash) && rawHash.length>=8))){
      url.hash='';
    }
    history.replaceState(null,'',url.toString());
  }catch(_){ }
}
async function loadPublicProductPreview(id){
  const target=String(id||'').trim();
  if(!target) return null;
  try{
    const snap=await getDoc(publicProductRef(target));
    if(snap.exists()){
      const data={id:target,...snap.data()};
      if(data.status !== 'active' || data.revoked === true || data.deleted === true){
        return {id:target,missing:true,name:'QR นี้ไม่พร้อมใช้งาน',publicLabel:'สินค้านี้ถูกลบหรือปิดใช้งานแล้ว'};
      }
      return data;
    }
  }catch(err){ console.warn('public preview read failed',err); }
  if(state.user && Array.isArray(state.products) && state.products.length){
    const p=state.products.find(x=>x.id===target || normalizeSkuKey(x.sku||'')===normalizeSkuKey(target));
    if(p && isPublicProductAllowed(p)) return publicProductPreviewData({...p,id:p.id});
  }
  return {id:target,missing:true,name:'ไม่พบข้อมูลพรีวิวสินค้า',publicLabel:'ยังไม่มีข้อมูลพรีวิวสำหรับ QR นี้'};
}
function ensureProductQrPreviewPage(){
  let page=document.getElementById('productQrPreviewPage');
  if(page) return page;
  page=document.createElement('section');
  page.id='productQrPreviewPage';
  page.className='product-qr-preview-page hidden';
  document.body.appendChild(page);
  return page;
}
function hideProductQrPreview(){
  const page=document.getElementById('productQrPreviewPage');
  if(page) page.classList.add('hidden');
}
function showOnlyProductQrPreview(html){
  const page=ensureProductQrPreviewPage();
  page.innerHTML=html;
  page.classList.remove('hidden');
  ['bootPage','loginPage','passwordGate','app'].forEach(id=>document.getElementById(id)?.classList.add('hidden'));
  document.body.classList.add('auth-screen-active');
  document.body.classList.remove('password-gate-active','app-restoring');
  window.scrollTo({top:0,behavior:'auto'});
}
function productQrPreviewMarkup(product={}, loading=false){
  if(loading){
    return `<div class="product-qr-preview-shell"><div class="product-qr-preview-card"><div class="product-qr-preview-icon">🔳</div><h1>กำลังโหลดพรีวิวสินค้า</h1><p>ระบบกำลังอ่านข้อมูลเบื้องต้นจาก QR Code...</p></div></div>`;
  }
  const missing=!!product.missing;
  const name=missing?'ไม่พบข้อมูลพรีวิวสินค้า':(product.name||'-');
  const photo=product.photo?`<img class="product-qr-preview-photo" src="${String(product.photo).replace(/"/g,'&quot;')}" alt="${escapeHtml(name)}" loading="lazy" decoding="async">`:`<div class="product-qr-preview-photo-placeholder">📦</div>`;
  return `<div class="product-qr-preview-shell">
    <div class="product-qr-preview-brand">
      <img data-system-logo src="${String(appLogoUrl()).replace(/"/g,'&quot;')}" alt="${escapeHtml(appName())}">
      <div><strong>${escapeHtml(appName())}</strong><span>${escapeHtml(appSubtitle())}</span></div>
    </div>
    <article class="product-qr-preview-card ${missing?'is-missing':''}">
      <div class="product-qr-preview-safe-badge">🔒 พรีวิวปลอดภัย</div>
      <div class="product-qr-preview-photo-wrap">${photo}</div>
      <div class="product-qr-preview-copy">
        <p class="product-qr-preview-kicker">${escapeHtml(product.publicLabel||'ข้อมูลเบื้องต้นจาก QR Code')}</p>
        <h1>${escapeHtml(name)}</h1>
        <div class="product-qr-preview-info">
          <div><span>รหัสสินค้า</span><b>${escapeHtml(product.sku||'-')}</b></div>
          <div><span>หมวดหมู่</span><b>${escapeHtml(product.category||'ทั่วไป')}</b></div>
          <div><span>หน่วยนับ</span><b>${escapeHtml(product.unit||'หน่วย')}</b></div>
          <div><span>คงเหลือรวม</span><b>${escapeHtml(productQrStockLabel(product))}</b></div>
          <div><span>สถานะ</span><b>${missing?'ต้องเข้าสู่ระบบเพื่อตรวจสอบ':(product.status==='active'?'พร้อมใช้งาน':'ตรวจสอบในระบบ')}</b></div>
        </div>
        <div class="product-qr-preview-note">หน้านี้แสดงเฉพาะข้อมูลเบื้องต้นและยอดคงเหลือรวม ไม่แสดงประวัติ ล็อต ราคา หรือข้อมูลภายใน ก่อนเข้าสู่ระบบพนักงาน</div>
        <div class="product-qr-preview-actions">
          <button class="btn primary full" onclick="window.openQrStaffProduct('${escapeHtml(product.id||PRODUCT_QR_QUERY_ID)}')">เข้าสู่หน้าสินค้าสำหรับพนักงาน</button>
        </div>
      </div>
    </article>
  </div>`;
}
async function showProductQrPreview(id=PRODUCT_QR_QUERY_ID){
  const target=String(id||'').trim();
  if(!target) return false;
  showOnlyProductQrPreview(productQrPreviewMarkup({},true));
  const product=await loadPublicProductPreview(target);
  showOnlyProductQrPreview(productQrPreviewMarkup(product||{id:target,missing:true}));
  return true;
}

// v34.19.7: เปิดหน้า QR Preview ให้เร็วที่สุดก่อนหน้า Login ถ้า URL มีรหัสสินค้า รวมถึง QR รุ่นเก่าบางแบบ
if(QR_PREVIEW_TARGET && !QR_STAFF_LOGIN_REQUEST){
  document.addEventListener('DOMContentLoaded',()=>{
    setTimeout(()=>{
      if(!productQrDeepLinkHandled && !state.user){
        showProductQrPreview(QR_PREVIEW_TARGET).catch(err=>console.warn('early QR preview failed',err));
      }
    },30);
  });
}
window.showQrLoginPage=()=>{
  hideProductQrPreview();
  hideNetworkStatusIndicator();
  document.body.classList.remove('app-session-active');
  document.body.classList.add('auth-screen-active');
  ['bootPage','passwordGate','app'].forEach(id=>document.getElementById(id)?.classList.add('hidden'));
  const login=document.getElementById('loginPage');
  if(login) login.classList.remove('hidden');
  toast('เข้าสู่ระบบเพื่อดูข้อมูลสินค้าภายใน');
};
window.openQrStaffProduct=(id)=>{
  const target=String(id||PRODUCT_QR_QUERY_ID||STAFF_PRODUCT_QUERY_ID||QR_PREVIEW_TARGET||'').trim();
  if(!target) return toast('ไม่พบรหัสสินค้าจาก QR Code');
  productQrDeepLinkHandled=false;
  localStorage.setItem(PRODUCT_QR_STAFF_RETURN_KEY,target);
  if(!auth.currentUser || !state.user){
    window.showQrLoginPage();
    setTimeout(()=>document.getElementById('username')?.focus(),120);
    return;
  }
  hideProductQrPreview();
  const appEl=document.getElementById('app'); if(appEl) appEl.classList.remove('hidden');
  document.body.classList.remove('auth-screen-active');
  render();
};
function makeQrSvg(text,opts={}){
  const version=4, size=17+4*version, dataCodewords=80, eccCodewords=20, border=4;
  const bytes=Array.from(new TextEncoder().encode(String(text||'')));
  if(bytes.length>78) throw new Error('QR payload ยาวเกินไป');
  const modules=Array.from({length:size},()=>Array(size).fill(false));
  const isFunc=Array.from({length:size},()=>Array(size).fill(false));
  const setFunc=(x,y,dark)=>{ if(x>=0&&x<size&&y>=0&&y<size){ modules[y][x]=!!dark; isFunc[y][x]=true; } };
  const addFinder=(cx,cy)=>{
    for(let dy=-4;dy<=4;dy++) for(let dx=-4;dx<=4;dx++){
      const x=cx+dx,y=cy+dy;
      if(x>=0&&x<size&&y>=0&&y<size){ const m=Math.max(Math.abs(dx),Math.abs(dy)); setFunc(x,y,m!==2&&m!==4); }
    }
  };
  addFinder(3,3); addFinder(size-4,3); addFinder(3,size-4);
  for(const cy of [6,26]) for(const cx of [6,26]){
    if((cx===6&&cy===6)||(cx===6&&cy===26)||(cx===26&&cy===6)) continue;
    for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++) setFunc(cx+dx,cy+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
  }
  for(let i=8;i<size-8;i++){ setFunc(i,6,i%2===0); setFunc(6,i,i%2===0); }
  for(let i=0;i<9;i++){ if(i!==6){ setFunc(8,i,false); setFunc(i,8,false); } }
  for(let i=size-8;i<size;i++){ setFunc(8,i,false); setFunc(i,8,false); }
  setFunc(8,size-8,true);

  const bits=[];
  const appendBits=(val,len)=>{ for(let i=len-1;i>=0;i--) bits.push((val>>>i)&1); };
  appendBits(0x4,4); appendBits(bytes.length,8); bytes.forEach(b=>appendBits(b,8));
  const capacity=dataCodewords*8;
  for(let i=0,n=Math.min(4,capacity-bits.length);i<n;i++) bits.push(0);
  while(bits.length%8) bits.push(0);
  const data=[];
  for(let i=0;i<bits.length;i+=8){ let v=0; for(const b of bits.slice(i,i+8)) v=(v<<1)|b; data.push(v); }
  for(let pad=0xEC; data.length<dataCodewords; pad=pad===0xEC?0x11:0xEC) data.push(pad);

  const gfMul=(x,y)=>{ let z=0; for(let i=7;i>=0;i--){ z=((z<<1)^(((z>>>7)&1)*0x11D))&0xFF; if((y>>>i)&1) z^=x; } return z&0xFF; };
  const divisor=Array(eccCodewords-1).fill(0).concat([1]);
  let root=1;
  for(let i=0;i<eccCodewords;i++){
    for(let j=0;j<eccCodewords;j++){ divisor[j]=gfMul(divisor[j],root); if(j+1<eccCodewords) divisor[j]^=divisor[j+1]; }
    root=gfMul(root,2);
  }
  const rem=Array(eccCodewords).fill(0);
  for(const b of data){ const factor=b^rem.shift(); rem.push(0); divisor.forEach((coef,i)=>{ rem[i]^=gfMul(coef,factor); }); }
  const allCodewords=data.concat(rem);
  const dataBits=[];
  allCodewords.forEach(b=>{ for(let i=7;i>=0;i--) dataBits.push((b>>>i)&1); });
  const mask=0;
  const maskBit=(x,y)=>((x+y)%2)===0;
  let bitIndex=0;
  for(let right=size-1;right>=1;right-=2){
    if(right===6) right=5;
    const upward=((right+1)&2)===0;
    for(let vert=0;vert<size;vert++){
      const y=upward?size-1-vert:vert;
      for(let j=0;j<2;j++){
        const x=right-j;
        if(isFunc[y][x]) continue;
        let bit=bitIndex<dataBits.length?dataBits[bitIndex]:0;
        if(maskBit(x,y)) bit^=1;
        modules[y][x]=!!bit;
        bitIndex++;
      }
    }
  }
  const formatData=(1<<3)|mask;
  let formatRem=formatData;
  for(let i=0;i<10;i++) formatRem=(formatRem<<1)^(((formatRem>>>9)&1)*0x537);
  const formatBits=((formatData<<10)|formatRem)^0x5412;
  const fmtBit=i=>((formatBits>>>i)&1)!==0;
  for(let i=0;i<6;i++) setFunc(8,i,fmtBit(i));
  setFunc(8,7,fmtBit(6)); setFunc(8,8,fmtBit(7)); setFunc(7,8,fmtBit(8));
  for(let i=9;i<15;i++) setFunc(14-i,8,fmtBit(i));
  for(let i=0;i<8;i++) setFunc(size-1-i,8,fmtBit(i));
  for(let i=8;i<15;i++) setFunc(8,size-15+i,fmtBit(i));
  setFunc(8,size-8,true);

  const dim=size+border*2;
  const pixel=opts.pixel||8;
  const fg=opts.fg||'#003f30';
  let rects='';
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) if(modules[y][x]) rects+=`<rect x="${x+border}" y="${y+border}" width="1" height="1"/>`;
  return `<svg class="product-qr-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim*pixel}" height="${dim*pixel}" role="img" aria-label="QR Code"><rect width="100%" height="100%" fill="#fff"/> <g fill="${fg}">${rects}</g></svg>`;
}
function renderProductQrLabel(product={}){
  const payload=productQrPayload(product);
  const svg=makeQrSvg(payload,{pixel:7});
  return `<section class="product-qr-label">
    <div class="product-qr-brand">${escapeHtml(appName())}</div>
    <div class="product-qr-box">${svg}</div>
    <h3>${escapeHtml(product.name||'-')}</h3>
    <p>SKU: ${escapeHtml(product.sku||'-')}</p>
    <p>หมวดหมู่: ${escapeHtml(product.category||'ทั่วไป')}</p>
    <p>หน่วยนับ: ${escapeHtml(product.unit||'หน่วย')}</p>
  </section>`;
}

function qrBulkActiveProducts(){
  return accessibleProducts((state.products||[]).filter(p=>isPublicProductAllowed(p) && !p.archived && !p.trashed));
}
function sortProductsForQrBulk(list=[]){
  const sortMode=state.stockSort==='low-first'?'stock-asc':(state.stockSort||'name-asc');
  return [...(list||[])].sort((a,b)=>{
    if(sortMode==='name-desc') return String(b.name||'').localeCompare(String(a.name||''),'th',{numeric:true});
    if(sortMode==='stock-desc') return (Number(b.stock)||0)-(Number(a.stock)||0);
    if(sortMode==='stock-asc') return (Number(a.stock)||0)-(Number(b.stock)||0);
    return String(a.name||'').localeCompare(String(b.name||''),'th',{numeric:true});
  });
}
function qrBulkFilteredProducts(){
  let list=qrBulkActiveProducts();
  if(state.stockFilter==='low') list=list.filter(p=>Number(p.stock)<=Number(p.min));
  else if(state.stockFilter==='expiry') list=list.filter(p=>getExpiryStatus(p).active);
  if(state.stockGroupFilter!=='all') list=list.filter(p=>productStockGroupId(p)===state.stockGroupFilter);
  if(state.stockAreaFilter!=='all') list=list.filter(p=>productStockAreaId(p)===state.stockAreaFilter);
  if(state.stockCategory!=='all') list=list.filter(p=>String(p.category||'').trim()===state.stockCategory);
  const queryText=(state.stockSearch||'').trim().toLowerCase();
  if(queryText){
    list=list.filter(p=>{
      const loc=productStockLocation(p);
      const haystack=[p.name,p.sku,p.category,p.unit,loc.stockGroupName,loc.stockAreaName,loc.stockAreaPath].map(v=>String(v||'').toLowerCase()).join(' ');
      return haystack.includes(queryText);
    });
  }
  return sortProductsForQrBulk(list);
}
function ensureBulkQrPrintStyles(){
  if(document.getElementById('cheeBulkQrPrintStyles')) return;
  const style=document.createElement('style');
  style.id='cheeBulkQrPrintStyles';
  style.textContent=`
    /* v34.29.36 — QR print real-size polish
       ใช้ modal หลักเป็น scroller และเพิ่มตัวเลือกพิมพ์ป้ายหน้าชั้น/ป้ายชื่อ */
    .qr-bulk-sheet{display:grid;gap:14px;padding-bottom:calc(28px + env(safe-area-inset-bottom));min-height:0;touch-action:pan-y!important}
    .qr-bulk-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .qr-bulk-summary-card{border:1px solid #dbe7df;border-radius:18px;background:linear-gradient(135deg,#f8fffb,#f1faf5);padding:14px 15px}
    .qr-bulk-summary-card small{display:block;color:#64748b;font-weight:800;font-size:12px;line-height:1.35}.qr-bulk-summary-card b{display:block;margin-top:4px;color:#064e3b;font-size:26px;line-height:1}
    .qr-bulk-actions,.qr-bulk-footer-actions{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:10px}.qr-bulk-actions .btn,.qr-bulk-footer-actions .btn{min-height:48px;font-weight:900}
    .qr-bulk-search{width:100%;min-height:52px;border:1px solid #d9cfbb;border-radius:16px;padding:0 15px;font-size:16px;font-weight:800;background:#fff;color:#173f34}
    .qr-bulk-select-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.qr-bulk-select-actions .btn{min-height:42px;font-size:13px;padding:8px}
    .qr-bulk-template-card{border:1px solid #cfe7da;background:linear-gradient(135deg,#f7fffb,#edf8f1);border-radius:20px;padding:14px;display:grid;gap:12px}
    .qr-bulk-template-title{font-size:13px;font-weight:950;color:#065f46;letter-spacing:.01em}.qr-bulk-template-control{display:grid;gap:7px}.qr-bulk-template-control label,.qr-bulk-field-title{font-size:12px;font-weight:900;color:#475569}.qr-bulk-template-select{width:100%;min-height:48px;border:1px solid #d9cfbb;border-radius:15px;background:#fff;color:#0f3d32;font-size:15px;font-weight:900;padding:0 13px}.qr-bulk-template-hint{border:1px dashed #b7dcc9;background:#f0fdf4;border-radius:15px;color:#047857;font-weight:850;line-height:1.45;font-size:13px;padding:10px 12px}.qr-bulk-field-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.qr-bulk-field-option{display:flex;align-items:center;gap:7px;border:1px solid #dfe7e2;background:#fff;border-radius:13px;padding:9px 10px;font-size:12.5px;font-weight:850;color:#334155}.qr-bulk-field-option input{width:18px;height:18px;accent-color:#007a55}
    .qr-bulk-list{max-height:none!important;overflow:visible!important;border:1px solid #e5e7eb;border-radius:18px;background:#fff;padding:6px;display:grid;gap:0;touch-action:pan-y!important;-webkit-overflow-scrolling:auto!important;overscroll-behavior:auto!important}
    .qr-bulk-row{display:grid;grid-template-columns:34px 48px minmax(0,1fr);gap:10px;align-items:center;min-height:68px;border-radius:14px;padding:9px 10px;border-bottom:1px solid #f1f5f9;touch-action:pan-y!important;user-select:none;-webkit-user-select:none;cursor:pointer}
    .qr-bulk-row:last-child{border-bottom:0}.qr-bulk-row:hover{background:#f8fafc}.qr-bulk-check{width:26px;height:26px;accent-color:#007a55;touch-action:manipulation!important}.qr-bulk-photo{width:48px;height:48px;border-radius:13px;background:#eef5f0;display:grid;place-items:center;overflow:hidden;font-size:23px;flex:none}.qr-bulk-photo img{width:100%;height:100%;object-fit:cover}.qr-bulk-copy{display:block;min-width:0;overflow:hidden}.qr-bulk-name{display:block;font-weight:950;color:#0f172a;font-size:16px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.qr-bulk-meta{display:block;margin-top:4px;color:#64748b;font-size:12px;font-weight:800;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.qr-bulk-empty{padding:22px;text-align:center;color:#64748b;font-weight:800}
    .qr-bulk-scroll-note{border:1px solid #bbf7d0;background:#f0fdf4;color:#047857;border-radius:16px;padding:11px 13px;font-weight:850;line-height:1.45;font-size:13px}
    @media(max-width:560px){.qr-bulk-summary{grid-template-columns:1fr 1fr}.qr-bulk-actions,.qr-bulk-footer-actions{grid-template-columns:1fr}.qr-bulk-select-actions{grid-template-columns:1fr}.qr-bulk-field-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.qr-bulk-list{max-height:none!important;overflow:visible!important}.qr-bulk-row{grid-template-columns:32px 42px minmax(0,1fr);gap:8px;padding:9px 8px;min-height:66px}.qr-bulk-photo{width:42px;height:42px}.qr-bulk-name{font-size:15px}.qr-bulk-meta{font-size:11.5px}}
  `;
  document.head.appendChild(style);
}
function qrBulkRowMarkup(product={}, checked=false){
  const loc=stockLocationPath(productStockLocation(product));
  const hay=escapeHtml([product.name,product.sku,product.category,product.unit,loc].map(v=>String(v||'')).join(' ').toLowerCase());
  const photo=product.photo?`<img src="${String(product.photo).replace(/"/g,'&quot;')}" alt="${escapeHtml(product.name||'สินค้า')}" loading="lazy" decoding="async">`:'📦';
  // v34.29.31: ไม่ใช้ <label> ครอบทั้งแถวแล้ว เพราะ Safari/iPhone จะเอา gesture การลากไปเป็นการกด checkbox
  // ทำให้หน้า QR หลายรายการเลื่อนได้บ้างไม่ได้บ้าง เหลือให้กด checkbox โดยตรงแทน ส่วนพื้นที่ชื่อ/รูปใช้เลื่อนจอได้ลื่น
  return `<div class="qr-bulk-row" data-qr-bulk-row data-id="${escapeHtml(product.id||'')}" data-text="${hay}">
    <input class="qr-bulk-check" type="checkbox" value="${escapeHtml(product.id||'')}" ${checked?'checked':''} onchange="window.updateQrBulkCount()">
    <span class="qr-bulk-photo">${photo}</span>
    <span class="qr-bulk-copy"><span class="qr-bulk-name">${escapeHtml(product.name||'-')}</span><span class="qr-bulk-meta">SKU: ${escapeHtml(product.sku||'-')} • ${escapeHtml(product.category||'ทั่วไป')} • ${escapeHtml(loc)}</span></span>
  </div>`;
}
window.updateQrBulkCount=()=>{
  const selected=document.querySelectorAll('#modalBody .qr-bulk-check:checked').length;
  const visible=[...document.querySelectorAll('#modalBody [data-qr-bulk-row]')].filter(row=>row.style.display!=='none').length;
  const selectedEl=document.getElementById('qrBulkSelectedCount');
  const selectedBottomEl=document.getElementById('qrBulkSelectedCountBottom');
  const visibleEl=document.getElementById('qrBulkVisibleCount');
  if(selectedEl) selectedEl.textContent=selected;
  if(selectedBottomEl) selectedBottomEl.textContent=selected;
  if(visibleEl) visibleEl.textContent=visible;
};
window.filterQrBulkList=(value='')=>{
  const q=String(value||'').trim().toLowerCase();
  document.querySelectorAll('#modalBody [data-qr-bulk-row]').forEach(row=>{ row.style.display=!q || String(row.dataset.text||'').includes(q) ? '' : 'none'; });
  window.updateQrBulkCount();
};
window.setQrBulkSelection=(mode='visible')=>{
  const rows=[...document.querySelectorAll('#modalBody [data-qr-bulk-row]')];
  const filteredIds=new Set((window.__CHEE_QR_BULK_FILTERED_IDS__||[]).map(String));
  rows.forEach(row=>{
    const cb=row.querySelector('.qr-bulk-check');
    if(!cb) return;
    if(mode==='none') cb.checked=false;
    else if(mode==='filtered') cb.checked=filteredIds.has(String(cb.value));
    else if(mode==='all') cb.checked=true;
    else cb.checked=row.style.display!=='none';
  });
  window.updateQrBulkCount();
};
function selectedQrBulkProductsFromModal(){
  const ids=[...document.querySelectorAll('#modalBody .qr-bulk-check:checked')].map(cb=>String(cb.value));
  const map=new Map(qrBulkActiveProducts().map(p=>[String(p.id),p]));
  return ids.map(id=>map.get(id)).filter(Boolean);
}
const QR_PRINT_TEMPLATE_HINTS={
  standard:'การ์ด QR ใหญ่แบบเดิม เหมาะกับแปะกล่องหรือจุดที่ต้องสแกนง่าย',
  'shelf-xxs':'ป้ายหน้าชั้น QR ไมโคร 3.8×1.6 ซม. ได้ประมาณ 80 ดวง/A4 เหมาะกับขอบชั้นแคบมาก ต้องสแกนใกล้ ๆ',
  'shelf-xs':'ป้ายหน้าชั้น QR จิ๋ว 4.5×1.8 ซม. ได้ประมาณ 56 ดวง/A4 เหมาะกับขอบชั้นที่พื้นที่น้อย',
  'shelf-s':'ป้ายหน้าชั้นเล็ก 6×2.5 ซม. ได้ประมาณ 30 ดวง/A4 เหมาะกับขอบชั้น แก้ว หลอด ฝา และอุปกรณ์',
  'shelf-m':'ป้ายหน้าชั้นกลาง 7×3 ซม. ได้ประมาณ 16 ดวง/A4 เหมาะกับตู้เย็น/จุดที่ต้องสแกนง่ายขึ้น',
  'name-only':'ป้ายชื่อสินค้าอย่างเดียว 6×1.5 ซม. ได้ประมาณ 51 ดวง/A4 เหมาะกับติดช่องสินค้าแบบ Tonic / Soda / Asahi Beer Can',
  'name-xs':'ป้ายชื่อจิ๋ว 4.5×1.2 ซม. ได้ประมาณ 88 ดวง/A4 เหมาะกับช่องเล็กมากที่ไม่ต้องใช้ QR',
  'name-xxs':'ป้ายชื่อไมโคร 3.8×1 ซม. ได้ประมาณ 130 ดวง/A4 เหมาะกับช่องแคบสุด'
};
const QR_PRINT_TEMPLATE_DETAILS={
  standard:{size:'การ์ดใหญ่',count:'ประมาณ 4 ดวง/A4',qr:'QR ใหญ่ สแกนง่ายที่สุด'},
  'shelf-xxs':{size:'3.8×1.6 ซม.',count:'ประมาณ 80 ดวง/A4',qr:'QR 12 มม. สแกนใกล้ ๆ'},
  'shelf-xs':{size:'4.5×1.8 ซม.',count:'ประมาณ 56 ดวง/A4',qr:'QR 14 มม. สแกนใกล้ ๆ'},
  'shelf-s':{size:'6×2.5 ซม.',count:'ประมาณ 30 ดวง/A4',qr:'QR 18 มม. สมดุลที่สุด'},
  'shelf-m':{size:'7×3 ซม.',count:'ประมาณ 16 ดวง/A4',qr:'QR 22 มม. สแกนง่าย'},
  'name-only':{size:'6×1.5 ซม.',count:'ประมาณ 51 ดวง/A4',qr:'ไม่มี QR'},
  'name-xs':{size:'4.5×1.2 ซม.',count:'ประมาณ 88 ดวง/A4',qr:'ไม่มี QR'},
  'name-xxs':{size:'3.8×1 ซม.',count:'ประมาณ 130 ดวง/A4',qr:'ไม่มี QR'}
};
function qrPrintTemplateHint(template='standard'){
  const detail=QR_PRINT_TEMPLATE_DETAILS[template]||QR_PRINT_TEMPLATE_DETAILS.standard;
  const text=QR_PRINT_TEMPLATE_HINTS[template]||QR_PRINT_TEMPLATE_HINTS.standard;
  return `${text} • ขนาดจริง: ${detail.size} • ${detail.count} • ${detail.qr}`;
}
function qrBulkPrintSettingsFromModal(){
  const template=String(document.getElementById('qrBulkTemplate')?.value||'standard');
  const show={
    sku:document.getElementById('qrBulkShowSku')?.checked!==false,
    category:document.getElementById('qrBulkShowCategory')?.checked!==false,
    unit:document.getElementById('qrBulkShowUnit')?.checked!==false,
    location:!!document.getElementById('qrBulkShowLocation')?.checked
  };
  return {template:QR_PRINT_TEMPLATE_HINTS[template]?template:'standard',show};
}
window.applyQrBulkTemplate=(value)=>{
  const template=String(value||document.getElementById('qrBulkTemplate')?.value||'standard');
  const hint=document.getElementById('qrBulkTemplateHint');
  if(hint) hint.textContent=qrPrintTemplateHint(template);
  const category=document.getElementById('qrBulkShowCategory');
  const location=document.getElementById('qrBulkShowLocation');
  if(template==='name-only'||template==='name-xs'||template==='name-xxs'){
    if(category) category.checked=false;
    if(location) location.checked=false;
  }
  if(template==='shelf-xxs'||template==='shelf-xs'||template==='name-xs'||template==='name-xxs'){
    const sku=document.getElementById('qrBulkShowSku');
    const unit=document.getElementById('qrBulkShowUnit');
    if(sku) sku.checked=false;
    if(category) category.checked=false;
    if(unit) unit.checked=false;
    if(location) location.checked=false;
  }
};
function qrLabelMetaLines(product={},settings={}){
  const show=settings.show||{};
  const lines=[];
  if(show.sku) lines.push(`SKU: ${escapeHtml(product.sku||'-')}`);
  if(show.category) lines.push(`หมวดหมู่: ${escapeHtml(product.category||'ทั่วไป')}`);
  if(show.unit) lines.push(`หน่วยนับ: ${escapeHtml(product.unit||'หน่วย')}`);
  if(show.location){
    const loc=stockLocationPath(productStockLocation(product));
    if(loc) lines.push(`ตำแหน่ง: ${escapeHtml(loc)}`);
  }
  return lines;
}
function renderBulkQrPrintLabel(product={},settings={template:'standard',show:{sku:true,category:true,unit:true,location:false}}){
  const template=settings.template||'standard';
  const name=escapeHtml(product.name||'-');
  const meta=qrLabelMetaLines(product,settings);
  if(template==='standard'){
    const svg=makeQrSvg(productQrPayload(product),{pixel:7});
    return `<section class="product-qr-label"><div class="product-qr-brand">${escapeHtml(appName())}</div><div class="product-qr-box">${svg}</div><h3>${name}</h3>${meta.map(line=>`<p>${line}</p>`).join('')}</section>`;
  }
  if(template==='name-only'||template==='name-xs'||template==='name-xxs'){
    const nameClass=template==='name-xs'?'qr-name-xs':'';
    return `<section class="qr-name-label ${nameClass}"><div class="qr-name-title">${name}</div>${meta.slice(0,2).map(line=>`<div class="qr-name-meta">${line}</div>`).join('')}</section>`;
  }
  const svg=makeQrSvg(productQrPayload(product),{pixel:(template==='shelf-xxs'||template==='shelf-xs')?3:4});
  const sizeClass=template==='shelf-m'?'qr-shelf-m':(template==='shelf-xxs'?'qr-shelf-xxs':(template==='shelf-xs'?'qr-shelf-xs':'qr-shelf-s'));
  return `<section class="qr-shelf-label ${sizeClass}"><div class="qr-shelf-qr">${svg}</div><div class="qr-shelf-copy"><div class="qr-shelf-title">${name}</div>${meta.slice(0,3).map(line=>`<div class="qr-shelf-meta">${line}</div>`).join('')}</div></section>`;
}
function bulkQrPrintStyles(settings={template:'standard'}){
  return `:root{--print-bg:#f8f5ec;--ink:#18352c;--green:#064e3b}*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:8mm;background:var(--print-bg);color:var(--ink);-webkit-print-color-adjust:exact;print-color-adjust:exact}.qr-print-head{margin:0 0 5mm;text-align:center}.qr-print-head h1{margin:0;font-size:18px;color:var(--green);letter-spacing:.04em}.qr-print-head p{margin:3px 0 0;color:#64748b;font-size:11px;font-weight:750}.qr-print-grid{display:grid;justify-content:center;align-items:start}.qr-template-standard{grid-template-columns:repeat(2,82mm);gap:6mm}.qr-template-shelf-xxs{grid-template-columns:repeat(5,38mm);gap:1.5mm}.qr-template-shelf-xs{grid-template-columns:repeat(4,45mm);gap:1.7mm 2mm}.qr-template-shelf-s{grid-template-columns:repeat(3,60mm);gap:3mm 3mm}.qr-template-shelf-m{grid-template-columns:repeat(2,70mm);gap:4mm 7mm}.qr-template-name-only{grid-template-columns:repeat(3,60mm);gap:2mm 3mm}.qr-template-name-xs{grid-template-columns:repeat(4,45mm);gap:1.6mm 2mm}.qr-template-name-xxs{grid-template-columns:repeat(5,38mm);gap:1.3mm 1.5mm}.product-qr-label{width:74mm;min-height:96mm;margin:0 auto;background:#fff;border:1px solid #d9cfbb;border-radius:10mm;padding:5mm;text-align:center;break-inside:avoid;page-break-inside:avoid}.product-qr-brand{font-weight:900;color:var(--green);letter-spacing:.08em;margin-bottom:3mm;font-size:12px}.product-qr-box{display:grid;place-items:center;line-height:0}.product-qr-svg{width:50mm;height:50mm;display:block}.product-qr-label h3{margin:3mm 0 1mm;font-size:18px;line-height:1.18;color:#18352c;word-break:break-word}.product-qr-label p{margin:1mm 0;color:#64748b;font-weight:750;font-size:11px;line-height:1.3}.qr-shelf-label,.qr-name-label{background:#fff;border:.28mm solid #111;border-radius:2mm;break-inside:avoid;page-break-inside:avoid;overflow:hidden}.qr-shelf-label{display:grid;grid-template-columns:20mm minmax(0,1fr);align-items:center;gap:2mm;padding:1.8mm}.qr-shelf-xxs{width:38mm;height:16mm;grid-template-columns:13mm minmax(0,1fr);gap:1.2mm;padding:1.15mm;border-radius:1.6mm}.qr-shelf-xs{width:45mm;height:18mm;grid-template-columns:15mm minmax(0,1fr);gap:1.4mm;padding:1.25mm;border-radius:1.8mm}.qr-shelf-s{width:60mm;height:25mm}.qr-shelf-m{width:70mm;height:30mm;grid-template-columns:25mm minmax(0,1fr);padding:2.4mm}.qr-shelf-label .product-qr-svg{width:18mm;height:18mm}.qr-shelf-xxs .product-qr-svg{width:12mm;height:12mm}.qr-shelf-xs .product-qr-svg{width:14mm;height:14mm}.qr-shelf-m .product-qr-svg{width:22mm;height:22mm}.qr-shelf-qr{display:grid;place-items:center;line-height:0}.qr-shelf-copy{min-width:0;overflow:hidden}.qr-shelf-title{font-weight:950;color:#111827;line-height:1.08;font-size:12px;word-break:break-word;max-height:2.18em;overflow:hidden}.qr-shelf-xxs .qr-shelf-title{font-size:8.4px;line-height:1.02;max-height:2.04em}.qr-shelf-xs .qr-shelf-title{font-size:9.4px;line-height:1.03;max-height:2.08em}.qr-shelf-m .qr-shelf-title{font-size:14px}.qr-shelf-meta{font-size:7.5px;line-height:1.18;color:#475569;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:.7mm}.qr-shelf-xxs .qr-shelf-meta,.qr-shelf-xs .qr-shelf-meta{display:none}.qr-shelf-m .qr-shelf-meta{font-size:8.5px}.qr-name-label{width:60mm;height:15mm;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:1.25mm 2mm}.qr-name-xs{width:45mm;height:12mm;padding:.9mm 1.5mm}.qr-name-xxs{width:38mm;height:10mm;padding:.75mm 1.1mm;border-radius:1.5mm}.qr-name-title{font-size:13px;line-height:1.1;font-weight:950;color:#111827;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.qr-name-xs .qr-name-title{font-size:10.4px}.qr-name-xxs .qr-name-title{font-size:8.8px}.qr-name-meta{font-size:7.3px;line-height:1.15;color:#64748b;font-weight:750;margin-top:.45mm;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.qr-name-xs .qr-name-meta,.qr-name-xxs .qr-name-meta{display:none}@page{size:A4;margin:6mm}@media print{body{background:#fff;padding:0}.qr-print-head{display:none}.product-qr-label{box-shadow:none;border-color:#111}.qr-print-grid{margin:0 auto}}@media screen and (max-width:700px){body{padding:12px}.qr-print-head h1{font-size:14px}.qr-print-head p{font-size:9px}.qr-print-grid{transform-origin:top center}.qr-template-standard{grid-template-columns:repeat(2,150px);gap:14px}.product-qr-label{width:146px;min-height:190px;border-radius:18px;padding:10px}.product-qr-svg{width:108px;height:108px}.product-qr-brand{font-size:7px;margin-bottom:6px}.product-qr-label h3{font-size:12px}.product-qr-label p{font-size:7px}.qr-template-shelf-xxs,.qr-template-shelf-xs,.qr-template-shelf-s,.qr-template-shelf-m,.qr-template-name-only,.qr-template-name-xs,.qr-template-name-xxs{grid-template-columns:repeat(2,minmax(0,max-content));gap:8px}.qr-shelf-label,.qr-name-label{margin:0 auto}}`;
}
window.printBulkProductQr=(mode='selected')=>{
  let products=[];
  if(mode==='all') products=sortProductsForQrBulk(qrBulkActiveProducts());
  else if(mode==='filtered') products=qrBulkFilteredProducts();
  else products=selectedQrBulkProductsFromModal();
  products=products.filter(p=>p&&p.id);
  if(!products.length) return toast('ยังไม่ได้เลือกสินค้าเพื่อพิมพ์ QR');
  const settings=qrBulkPrintSettingsFromModal();
  if(!String(settings.template||'').startsWith('name')) products.forEach(p=>syncPublicProductPreview(p).catch(err=>console.warn('sync public QR preview before bulk print failed',p?.id,err)));
  const w=window.open('','_blank','width=900,height=900');
  if(!w) return toast('เบราว์เซอร์บล็อกหน้าพิมพ์');
  const labels=products.map(p=>renderBulkQrPrintLabel(p,settings)).join('');
  const templateName=String(document.getElementById('qrBulkTemplate')?.selectedOptions?.[0]?.textContent||'QR Code');
  const title=`${templateName} ${products.length} รายการ`;
  const gridClass=`qr-print-grid qr-template-${escapeHtml(settings.template)}`;
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${bulkQrPrintStyles(settings)}</style></head><body><div class="qr-print-head"><h1>${escapeHtml(appName())}</h1><p>${escapeHtml(title)} • ${new Date().toLocaleString('th-TH')}</p></div><main class="${gridClass}">${labels}</main><script>setTimeout(()=>{try{print()}catch(e){}},450)<\/script></body></html>`);
  w.document.close();
};
window.printProductQrTemplate=(id,template='standard')=>{
  const product=state.products.find(p=>p.id===id); if(!product) return toast('ไม่พบสินค้า');
  const miniTemplate=template==='shelf-xxs'||template==='shelf-xs'||template==='name-xs'||template==='name-xxs';
  const settings={template:QR_PRINT_TEMPLATE_HINTS[template]?template:'standard',show:{sku:!miniTemplate,category:template==='standard',unit:!miniTemplate&&template!=='name-xs',location:false}};
  if(!String(settings.template||'').startsWith('name')) syncPublicProductPreview(product).catch(err=>console.warn('sync public QR preview before single template print failed',err));
  const w=window.open('','_blank','width=620,height=720');
  if(!w) return toast('เบราว์เซอร์บล็อกหน้าพิมพ์');
  const label=renderBulkQrPrintLabel(product,settings);
  const title=`ป้าย ${product.name||'สินค้า'}`;
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${bulkQrPrintStyles(settings)}</style></head><body><div class="qr-print-head"><h1>${escapeHtml(appName())}</h1><p>${escapeHtml(title)} • ${new Date().toLocaleString('th-TH')}</p></div><main class="qr-print-grid qr-template-${escapeHtml(settings.template)}">${label}</main><script>setTimeout(()=>{try{print()}catch(e){}},350)<\/script></body></html>`);
  w.document.close();
};
window.openBulkProductQr=()=>{
  ensureBulkQrPrintStyles();
  const all=sortProductsForQrBulk(qrBulkActiveProducts());
  const filtered=qrBulkFilteredProducts();
  const filteredIds=new Set(filtered.map(p=>String(p.id)));
  window.__CHEE_QR_BULK_FILTERED_IDS__=[...filteredIds];
  if(!all.length) return toast('ยังไม่มีสินค้าที่พิมพ์ QR ได้');
  openModal('พิมพ์ QR Code หลายรายการ',`<div class="qr-bulk-sheet">
    <div class="qr-bulk-summary"><div class="qr-bulk-summary-card"><small>สินค้าทั้งหมดที่พิมพ์ได้</small><b>${all.length}</b></div><div class="qr-bulk-summary-card"><small>ตามตัวกรองหน้าสต็อกตอนนี้</small><b>${filtered.length}</b></div></div>
    <div class="qr-bulk-template-card">
      <div class="qr-bulk-template-title">เลือกรูปแบบป้ายก่อนพิมพ์</div>
      <div class="qr-bulk-template-control"><label for="qrBulkTemplate">Template</label><select id="qrBulkTemplate" class="qr-bulk-template-select" onchange="window.applyQrBulkTemplate(this.value)"><option value="standard">การ์ด QR มาตรฐาน • 4 ดวง/A4</option><option value="shelf-xxs">ป้าย QR ไมโคร 3.8×1.6 ซม. • 80 ดวง/A4</option><option value="shelf-xs">ป้าย QR จิ๋ว 4.5×1.8 ซม. • 56 ดวง/A4</option><option value="shelf-s">ป้าย QR เล็ก 6×2.5 ซม. • 30 ดวง/A4</option><option value="shelf-m">ป้าย QR กลาง 7×3 ซม. • 16 ดวง/A4</option><option value="name-only">ป้ายชื่ออย่างเดียว 6×1.5 ซม. • 51 ดวง/A4</option><option value="name-xs">ป้ายชื่อจิ๋ว 4.5×1.2 ซม. • 88 ดวง/A4</option><option value="name-xxs">ป้ายชื่อไมโคร 3.8×1 ซม. • 130 ดวง/A4</option></select></div>
      <div id="qrBulkTemplateHint" class="qr-bulk-template-hint">${qrPrintTemplateHint('standard')}</div>
      <div><div class="qr-bulk-field-title">ข้อมูลที่จะแสดง</div><div class="qr-bulk-field-grid"><label class="qr-bulk-field-option"><input id="qrBulkShowSku" type="checkbox" checked> SKU</label><label class="qr-bulk-field-option"><input id="qrBulkShowCategory" type="checkbox" checked> หมวดหมู่</label><label class="qr-bulk-field-option"><input id="qrBulkShowUnit" type="checkbox" checked> หน่วยนับ</label><label class="qr-bulk-field-option"><input id="qrBulkShowLocation" type="checkbox"> คลัง/พื้นที่</label></div></div>
    </div>
    <div class="qr-bulk-actions"><button class="btn green" onclick="window.printBulkProductQr('selected')">🖨️ พิมพ์ที่เลือก (<span id="qrBulkSelectedCount">${filtered.length}</span>)</button><button class="btn light" onclick="window.printBulkProductQr('filtered')">พิมพ์ตามตัวกรอง</button><button class="btn light" onclick="window.printBulkProductQr('all')">พิมพ์ทั้งหมด</button></div>
    <input class="qr-bulk-search" placeholder="🔍 ค้นหาสินค้า / SKU / หมวดหมู่ / คลัง" oninput="window.filterQrBulkList(this.value)">
    <div class="qr-bulk-select-actions"><button class="btn light" onclick="window.setQrBulkSelection('visible')">เลือกทั้งหมดที่เห็น (<span id="qrBulkVisibleCount">${all.length}</span>)</button><button class="btn light" onclick="window.setQrBulkSelection('filtered')">เลือกตามตัวกรอง</button><button class="btn light" onclick="window.setQrBulkSelection('none')">ล้างเลือก</button></div>
    <div class="qr-bulk-scroll-note">ถ้าต้องการติดขอบชั้นแบบในรูป ให้เลือก “ป้าย QR จิ๋ว” หรือ “ป้าย QR ไมโคร” ถ้าต้องเล็กมาก แต่ต้องทดสอบสแกนจริงก่อนใช้งาน</div>
    <div class="muted">ค่าเริ่มต้นเลือกตามตัวกรองหน้าสต็อกตอนนี้ พี่ชายสามารถติ๊กเพิ่ม/ลดก่อนพิมพ์ได้</div>
    <div class="qr-bulk-list">${all.map(p=>qrBulkRowMarkup(p,filteredIds.has(String(p.id)))).join('')}</div>
    <div class="qr-bulk-footer-actions"><button class="btn green" onclick="window.printBulkProductQr('selected')">🖨️ พิมพ์ที่เลือก (<span id="qrBulkSelectedCountBottom">${filtered.length}</span>)</button><button class="btn light" onclick="window.printBulkProductQr('filtered')">พิมพ์ตามตัวกรอง</button><button class="btn light" onclick="window.printBulkProductQr('all')">พิมพ์ทั้งหมด</button></div>
  </div>`);
  setTimeout(()=>{ window.updateQrBulkCount(); window.applyQrBulkTemplate('standard'); },80);
};

window.openProductQr=(id)=>{
  const product=state.products.find(p=>p.id===id);
  if(!product) return toast('ไม่พบสินค้า');
  let payload=productQrPayload(product), qrHtml='';
  syncPublicProductPreview(product).catch(err=>{ console.warn('sync public product preview failed',err); toast('สร้าง QR แล้ว แต่ยังไม่ได้อัปเดตพรีวิวสาธารณะ — ตรวจ Rules'); });
  try{ qrHtml=renderProductQrLabel(product); }
  catch(err){ console.error(err); return toast('สร้าง QR Code ไม่สำเร็จ'); }
  openModal('QR Code สินค้า',`<div class="product-qr-sheet">
    ${qrHtml}
    <div class="product-qr-help">สแกน QR นี้เพื่อดูพรีวิวสินค้าแบบปลอดภัยก่อน จากนั้นกดเข้าสู่หน้าพนักงานเพื่อดูข้อมูลเต็ม</div>
    <div class="product-qr-link"><span>ลิงก์ QR</span><code>${escapeHtml(payload)}</code></div>
    <div class="product-qr-actions">
      <button class="btn green" onclick="window.printProductQr('${escapeHtml(product.id)}')">🖨️ พิมพ์ป้าย QR ใหญ่</button>
      <button class="btn light" onclick="window.printProductQrTemplate('${escapeHtml(product.id)}','shelf-xxs')">🏷️ ป้าย QR ไมโคร</button><button class="btn light" onclick="window.printProductQrTemplate('${escapeHtml(product.id)}','shelf-xs')">🏷️ ป้าย QR จิ๋ว</button>
      <button class="btn light" onclick="window.printProductQrTemplate('${escapeHtml(product.id)}','shelf-s')">🏷️ ป้ายหน้าชั้นเล็ก</button>
      <button class="btn light" onclick="window.printProductQrTemplate('${escapeHtml(product.id)}','name-only')">🔖 ป้ายชื่ออย่างเดียว</button>
      <button class="btn light" onclick="window.printProductQrTemplate('${escapeHtml(product.id)}','name-xs')">🔖 ป้ายชื่อจิ๋ว</button><button class="btn light" onclick="window.printProductQrTemplate('${escapeHtml(product.id)}','name-xxs')">🔖 ป้ายชื่อไมโคร</button>
      <button class="btn light" onclick="window.openBulkProductQr()">🖨️ พิมพ์หลายรายการ/ทั้งหมด</button>
      <button class="btn light" onclick="window.downloadProductQr('${escapeHtml(product.id)}')">⬇️ ดาวน์โหลด SVG</button>
      <button class="btn light" onclick="window.copyProductQrLink('${escapeHtml(product.id)}')">🔗 คัดลอกลิงก์</button>
    </div>
  </div>`);
};
window.copyProductQrLink=async(id)=>{
  const product=state.products.find(p=>p.id===id); if(!product) return toast('ไม่พบสินค้า');
  const link=productQrPayload(product);
  try{ await navigator.clipboard.writeText(link); toast('คัดลอกลิงก์ QR แล้ว'); }
  catch(_){ window.prompt('คัดลอกลิงก์นี้',link); }
};
window.downloadProductQr=(id)=>{
  const product=state.products.find(p=>p.id===id); if(!product) return toast('ไม่พบสินค้า');
  let svg;
  try{ svg=`<?xml version="1.0" encoding="UTF-8"?>\n${makeQrSvg(productQrPayload(product),{pixel:10})}`; }
  catch(err){ console.error(err); return toast('ดาวน์โหลด QR ไม่สำเร็จ'); }
  const blob=new Blob([svg],{type:'image/svg+xml;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=productQrFileName(product); document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),800);
};
window.printProductQr=(id)=>{
  const product=state.products.find(p=>p.id===id); if(!product) return toast('ไม่พบสินค้า');
  const w=window.open('','_blank','width=420,height=640');
  if(!w) return toast('เบราว์เซอร์บล็อกหน้าพิมพ์');
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>QR ${escapeHtml(product.name||'สินค้า')}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:18px;background:#f8f5ec;color:#18352c}.product-qr-label{width:320px;margin:0 auto;background:#fff;border:1px solid #d9cfbb;border-radius:20px;padding:18px;text-align:center}.product-qr-brand{font-weight:900;color:#064e3b;letter-spacing:.08em;margin-bottom:10px}.product-qr-box{display:grid;place-items:center}.product-qr-svg{width:230px;height:230px}.product-qr-label h3{margin:10px 0 4px;font-size:24px}.product-qr-label p{margin:4px 0;color:#64748b;font-weight:700}@media print{body{background:#fff;padding:0}.product-qr-label{box-shadow:none;border-color:#111;margin:0 auto;break-inside:avoid}}</style></head><body>${renderProductQrLabel(product)}<script>setTimeout(()=>print(),300)<\/script></body></html>`);
  w.document.close();
};
function tryOpenProductDeepLink(){
  const pendingTarget=String(localStorage.getItem(PRODUCT_QR_STAFF_RETURN_KEY)||'').trim();
  if(productQrDeepLinkHandled || !pendingTarget || !state.user || !productsSnapshotReady) return false;
  let product=state.products.find(p=>p.id===pendingTarget);
  if(!product){
    const skuMatches=state.products.filter(p=>normalizeSkuKey(p.sku||'')===normalizeSkuKey(pendingTarget));
    if(skuMatches.length===1) product=skuMatches[0];
    else if(skuMatches.length>1){
      productQrDeepLinkHandled=true;
      localStorage.removeItem(PRODUCT_QR_STAFF_RETURN_KEY);
      toast('รหัสนี้ใช้กับหลายสินค้า กรุณาเปิดจาก QR ของสินค้าแต่ละรายการ');
      removeProductQrParamsFromUrl();
      return false;
    }
  }
  productQrDeepLinkHandled=true;
  localStorage.removeItem(PRODUCT_QR_STAFF_RETURN_KEY);
  if(!product){ toast('ไม่พบสินค้าจาก QR Code'); removeProductQrParamsFromUrl(); return false; }
  saveCurrentPageScroll();
  state.viewProductId=product.id; state.productDetailTab='general'; state.page='productDetail';
  localStorage.setItem(PRODUCT_DETAIL_KEY,product.id); localStorage.setItem(LAST_PAGE_KEY,'productDetail'); saveUiState();
  document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.remove('active'));
  renderProductDetail(product.id);
  removeProductQrParamsFromUrl();
  setTimeout(()=>toast('เปิดหน้าสินค้าสำหรับพนักงานแล้ว'),120);
  return true;
}


function render(){
  if(!state.user) return;
  if(tryOpenProductDeepLink()) return;
  try {
    const renderer = ({home:renderHome,stock:renderStock,scan:renderScan,approval:renderApproval,report:renderReport,history:renderHistory,profile:renderProfile,manual:renderManual,trash:renderTrash,productDetail:()=>renderProductDetail(state.viewProductId)}[state.page]||renderHome);
    renderer();
    syncDesktopWorkspaceV34163();
    continuePendingScrollRestore();
  } catch(error) {
    console.error('render failed', error);
    // v34.18.11: ถ้าเข้าหน้ารายงานจากค่าที่จำไว้แล้วเกิดข้อมูลตัวกรองเก่าทำให้หน้าแตก ให้รีเซ็ตกลับหน้าแรกแทนการค้างที่ error card
    if(state.page==='report'){
      try{
        normalizeReportState?.();
        state.page='home';
        localStorage.setItem(LAST_PAGE_KEY,'home');
        document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.toggle('active', x.dataset.page==='home'));
        renderHome();
        toast('ระบบรีเซ็ตหน้ารายงานให้แล้ว กรุณาเปิดรายงานใหม่อีกครั้ง');
        return;
      }catch(fallbackError){ console.error('report fallback failed', fallbackError); }
    }
    showLoadError('แสดงหน้าไม่สำเร็จ', error);
  }
}
function renderHome(){
  const b=normalizeBranding(state.branding||{});
  const hidden=new Set(b.dashboardHiddenCards||[]);
  const active=accessibleProducts(state.products.filter(p=>!p.archived && !p.trashed));
  const lowItems=active.filter(p=>Number(p.stock)<=Number(p.min));
  const low=lowItems.length;
  const expiryItems=active
    .map(p=>({p,status:getExpiryStatus(p)}))
    .filter(item=>item.status.active)
    .sort((a,b)=>(a.status.days??999999)-(b.status.days??999999)||String(a.p.name||'').localeCompare(String(b.p.name||''),'th'));
  const expiryCount=expiryItems.length;
  const pending=accessibleApprovals(state.approvals).length;
  const todayStr=toDateStr(new Date());
  const validDate=l=>{ const d=getLogDate(l); return d instanceof Date && !Number.isNaN(d.getTime())?d:null; };
  const accessibleProductIds=new Set(active.map(p=>p.id));
  const scopedLogs=state.logs.filter(l=>canAccessLogEntry(l));
  const completedLogs=scopedLogs.filter(l=>l.action==='อนุมัติ');
  const todayLogs=scopedLogs.filter(l=>{ const d=validDate(l); return d && toDateStr(d)===todayStr; });
  const todayCompleted=completedLogs.filter(l=>{ const d=validDate(l); return d && toDateStr(d)===todayStr; });
  const todayIn=todayCompleted.filter(l=>l.moveType==='in');
  const todayOut=todayCompleted.filter(l=>l.moveType==='out');
  const sumQty=list=>list.reduce((sum,l)=>sum+(Number(l.qty)||0),0);
  const approvalTitle=canApprove()?'รายการรออนุมัติ':'รายการของฉันรออนุมัติ';
  const approvalDescription=canApprove()
    ? (pending?'มีรายการที่ต้องตรวจสอบและอนุมัติ':'ไม่มีรายการรออนุมัติ')
    : (pending?'แตะเพื่อตรวจสอบ แก้ไข หรือยกเลิกรายการของคุณ':'ไม่มีรายการของคุณที่รออนุมัติ');

  const days=[];
  for(let i=6;i>=0;i--){
    const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-i);
    const key=toDateStr(d);
    const dayLogs=completedLogs.filter(l=>{const x=validDate(l);return x&&toDateStr(x)===key;});
    days.push({
      key,
      label:d.toLocaleDateString('th-TH',{weekday:'short'}).replace('.',''),
      inCount:dayLogs.filter(l=>l.moveType==='in').length,
      outCount:dayLogs.filter(l=>l.moveType==='out').length
    });
  }
  const maxDaily=Math.max(1,...days.map(x=>x.inCount+x.outCount));
  const chart=days.map(x=>{
    const inH=Math.max(x.inCount?10:2,Math.round((x.inCount/maxDaily)*100));
    const outH=Math.max(x.outCount?10:2,Math.round((x.outCount/maxDaily)*100));
    return `<div class="dash-chart-day" title="${escapeHtml(x.label)} รับเข้า ${x.inCount} เบิกออก ${x.outCount}">
      <div class="dash-chart-bars"><i class="dash-bar in" style="height:${inH}%"></i><i class="dash-bar out" style="height:${outH}%"></i></div>
      <span>${escapeHtml(x.label)}</span>
    </div>`;
  }).join('');

  const productUsage=new Map();
  completedLogs.filter(l=>l.moveType==='out').forEach(l=>{
    const key=l.productId||l.detail||'unknown';
    const current=productUsage.get(key)||{name:'ไม่ระบุสินค้า',qty:0,count:0,unit:l.unit||''};
    const p=state.products.find(x=>x.id===l.productId);
    current.name=p?.name||String(l.detail||'').replace(/^.*?\s/,'').trim()||'ไม่ระบุสินค้า';
    current.qty+=(Number(l.qty)||0); current.count+=1; current.unit=l.unit||p?.unit||current.unit;
    productUsage.set(key,current);
  });
  const topUsed=[...productUsage.values()].sort((a,b)=>b.qty-a.qty).slice(0,5);

  const lowAlertRows=lowItems.slice(0,4).map(p=>`<button onclick="window.viewProduct('${p.id}')">
    <span>${p.photo?productImageMarkup(p.photo,p.name):'📦'}</span>
    <div><b>${escapeHtml(p.name)}</b><small>จุดเตือน ${Number(p.min)||0} ${escapeHtml(p.unit||'')}</small></div>
    <strong>${Number(p.stock)||0}</strong>
  </button>`).join('')||'<div class="dashboard-empty ok">✅ ไม่มีสต๊อกใกล้หมด</div>';

  const expiryAlertRows=expiryItems.slice(0,4).map(({p,status})=>`<button onclick="window.viewProduct('${p.id}')">
    <span>${p.photo?productImageMarkup(p.photo,p.name):'⏰'}</span>
    <div><b>${escapeHtml(p.name)}</b><small>หมดอายุ ${escapeHtml(expiryDateLabel(p))}</small></div>
    <strong class="expiry-alert-text ${status.className}">${escapeHtml(status.shortLabel)}</strong>
  </button>`).join('')||'<div class="dashboard-empty ok">✅ ไม่มีสินค้าใกล้หมดอายุ</div>';

  const statCards={
    statIn:`<button class="dashboard-stat stat-in" onclick="window.goToPage('history',{historyPreset:'today',historyFilter:'in'})"><span class="dashboard-stat-icon">↓</span><div><small>รับเข้าวันนี้</small><b>${todayIn.length}</b><em>${sumQty(todayIn)} หน่วยรวม</em></div></button>`,
    statOut:`<button class="dashboard-stat stat-out" onclick="window.goToPage('history',{historyPreset:'today',historyFilter:'out'})"><span class="dashboard-stat-icon">↑</span><div><small>เบิกออกวันนี้</small><b>${todayOut.length}</b><em>${sumQty(todayOut)} หน่วยรวม</em></div></button>`,
    statProducts:`<button class="dashboard-stat stat-products" onclick="window.goToPage('stock')"><span class="dashboard-stat-icon">📦</span><div><small>สินค้าทั้งหมด</small><b>${active.length}</b><em>พร้อมใช้งาน</em></div></button>`,
    statLow:`<button class="dashboard-stat stat-low" onclick="window.goToPage('stock',{filter:'low'})"><span class="dashboard-stat-icon">⚠️</span><div><small>สต๊อกใกล้หมด</small><b>${low}</b><em>${low?'ควรตรวจสอบ':'สถานะปกติ'}</em></div></button>`,
    statExpiry:`<button class="dashboard-stat stat-expiry" onclick="window.goToPage('stock',{filter:'expiry'})"><span class="dashboard-stat-icon">⏰</span><div><small>ใกล้หมดอายุ</small><b>${expiryCount}</b><em>${expiryCount?'ควรตรวจสอบ':'สถานะปกติ'}</em></div></button>`
  };
  const statsHtml=b.dashboardStatOrder.filter(id=>!hidden.has(id)).map(id=>statCards[id]||'').join('');
  const sectionCards={
    priority:`<div class="home-priority-card ${pending?'has-pending':'clear'}" onclick="window.goToPage('approval')" role="button" tabindex="0"><div class="home-priority-icon">${pending?'🔔':'✅'}</div><div class="home-priority-copy"><span>${approvalTitle}</span><b>${pending}</b><small>${approvalDescription}</small></div><div class="home-priority-arrow">›</div></div>`,
    stats:statsHtml?`<div class="dashboard-stat-grid">${statsHtml}</div>`:'',
    chart:`<section class="card dashboard-chart-card"><div class="dashboard-section-head"><div><small>การเคลื่อนไหว</small><h2>7 วันล่าสุด</h2></div><div class="dashboard-legend"><span><i class="in"></i>รับเข้า</span><span><i class="out"></i>เบิกออก</span></div></div><div class="dash-chart">${chart}</div><div class="dashboard-chart-footer"><span>วันนี้ทั้งหมด <b>${todayLogs.length}</b> เหตุการณ์</span><button onclick="window.goToPage('history')">ดูประวัติทั้งหมด ›</button></div></section>`,
    topUsed:`<section class="card dashboard-side-card"><div class="dashboard-section-head"><div><small>การใช้งานสินค้า</small><h2>เบิกมากที่สุด</h2></div></div><div class="dashboard-top-list">${topUsed.map((x,i)=>`<div class="dashboard-top-row"><span class="rank">${i+1}</span><div><b>${escapeHtml(x.name)}</b><small>${x.count} รายการ</small></div><strong>${x.qty} ${escapeHtml(x.unit||'')}</strong></div>`).join('')||'<div class="dashboard-empty">ยังไม่มีข้อมูลการเบิกสินค้า</div>'}</div></section>`,
    alerts:`<section class="card dashboard-alert-card"><div class="dashboard-section-head"><div><small>ต้องดูแล</small><h2>แจ้งเตือนสินค้า</h2></div></div><div class="alert-tabs-summary"><button onclick="window.goToPage('stock',{filter:'low'})"><span>📦 สต๊อกใกล้หมด</span><b>${low}</b></button><button onclick="window.goToPage('stock',{filter:'expiry'})"><span>⏰ ใกล้หมดอายุ</span><b>${expiryCount}</b></button></div><div class="dashboard-alert-columns"><section class="dashboard-alert-group"><div class="dashboard-alert-group-head"><b>📦 สินค้าใกล้หมดสต๊อก</b><button onclick="window.goToPage('stock',{filter:'low'})">ดูทั้งหมด ›</button></div><div class="dashboard-low-list">${lowAlertRows}</div></section><section class="dashboard-alert-group"><div class="dashboard-alert-group-head"><b>⏰ สินค้าใกล้หมดอายุ</b><button onclick="window.goToPage('stock',{filter:'expiry'})">ดูทั้งหมด ›</button></div><div class="dashboard-low-list">${expiryAlertRows}</div></section></div></section>`
  };
  const orderedSections=b.dashboardCardOrder.filter(id=>!hidden.has(id)).map(id=>sectionCards[id]||'').join('\n');

  view.innerHTML=`<div class="dashboard-heading"><div><div class="dashboard-kicker">ภาพรวมคลังสินค้า</div><h1>หน้าแรก</h1></div><div class="dashboard-date">${new Date().toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'})}</div></div>${orderedSections||'<div class="card dashboard-empty">Admin ปิดการ์ดหน้าแรกทั้งหมดไว้</div>'}`;
}

// v34.27.6: หมวดหมู่ในหน้า Stock ต้องขึ้นตามกลุ่ม/พื้นที่สต๊อกที่เลือก ไม่ดึงหมวดหมู่จากทุกกลุ่มมาปนกัน
function stockCategoryOptionsForCurrentScope(products){
  let pool=[...(products||[])];
  if(state.stockGroupFilter!=='all') pool=pool.filter(p=>productStockGroupId(p)===state.stockGroupFilter);
  if(state.stockAreaFilter!=='all') pool=pool.filter(p=>productStockAreaId(p)===state.stockAreaFilter);
  return [...new Set(pool.map(p=>String(p.category||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th'));
}


function stockExpiryTimelineRows(products=[]){
  const rows=[];
  (products||[]).forEach(product=>{
    try{
      const lots=activeProductLots(product).filter(l=>Number(l.qty)>0 && String(l.expiryDate||'').trim());
      const names=lotDisplayMap(product);
      lots.forEach((lot,index)=>{
        const meta=lotExpiryMeta(lot);
        rows.push({
          product,
          lot,
          lotName:names.get(lot.id)||lotDisplayName(product,lot,index),
          meta,
          expiryTime:parseExpiryDate(lot.expiryDate)?.getTime() ?? Number.MAX_SAFE_INTEGER
        });
      });
    }catch(error){ console.warn('อ่านล็อตสำหรับไทม์ไลน์วันหมดอายุไม่ได้',product?.id||product?.name,error); }
  });
  return rows.sort((a,b)=>a.expiryTime-b.expiryTime || String(a.product?.name||'').localeCompare(String(b.product?.name||''),'th') || String(a.lotName||'').localeCompare(String(b.lotName||''),'th',{numeric:true}));
}
function renderStockExpiryTimelineRows(rows=[]){
  return rows.map(row=>{
    const p=row.product||{};
    const lot=row.lot||{};
    const meta=row.meta||lotExpiryMeta(lot);
    const loc=stockLocationPath(productStockLocation(p));
    const photo=p.photo?productImageMarkup(p.photo,p.name,'expiry-timeline-photo-img'):`<div class="expiry-timeline-photo-placeholder">📦</div>`;
    const qty=Number(lot.qty)||0;
    const expiryLabel=lot.expiryDate?lotDateLabel(lot.expiryDate):'ไม่ระบุวันหมดอายุ';
    return `<article class="expiry-timeline-card expiry-${escapeHtml(meta.key||'normal')}" role="button" tabindex="0" onclick="window.viewProduct('${escapeHtml(p.id||'')}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.viewProduct('${escapeHtml(p.id||'')}')}">
      <div class="expiry-timeline-photo">${photo}</div>
      <div class="expiry-timeline-main">
        <div class="expiry-timeline-top"><h3>${escapeHtml(p.name||'ไม่ทราบสินค้า')}</h3><span class="expiry-timeline-status">${escapeHtml(meta.icon||'🟢')} ${escapeHtml(meta.label||'')}</span></div>
        <div class="expiry-timeline-meta">📍 ${escapeHtml(loc)}</div>
        <div class="expiry-timeline-meta">ล็อต: <b>${escapeHtml(row.lotName||'-')}</b></div>
        <div class="expiry-timeline-bottom"><span>หมดอายุ ${escapeHtml(expiryLabel)}</span><b>${qty} ${escapeHtml(p.unit||'หน่วย')}</b></div>
      </div>
      <span class="expiry-timeline-arrow">›</span>
    </article>`;
  }).join('');
}

// v34.27.6 SIMPLE PROFESSIONAL STOCK UI: logic stays from v34.27.0; CSS keeps the page compact and readable.
function renderStock(){
  const filterLow=state.stockFilter==='low';
  const filterExpiry=state.stockFilter==='expiry';
  const filterExpiryTimeline=state.stockFilter==='expiry-timeline';
  const all=accessibleProducts(state.products.filter(p=>!p.archived && !p.trashed));
  const queryText=(state.stockSearch||'').trim().toLowerCase();
  stockFilterPermissionContext();
  const categories=stockCategoryOptionsForCurrentScope(all);
  if(state.stockCategory!=='all' && !categories.includes(state.stockCategory)) state.stockCategory='all';
  let list=filterLow?all.filter(p=>Number(p.stock)<=Number(p.min)):(filterExpiry?all.filter(p=>getExpiryStatus(p).active):all);
  if(state.stockGroupFilter!=='all') list=list.filter(p=>productStockGroupId(p)===state.stockGroupFilter);
  if(state.stockAreaFilter!=='all') list=list.filter(p=>productStockAreaId(p)===state.stockAreaFilter);
  if(state.stockCategory!=='all') list=list.filter(p=>String(p.category||'').trim()===state.stockCategory);

  if(queryText){
    list=list.filter(p=>{
      const loc=productStockLocation(p);
      const haystack=[p.name,p.sku,p.category,p.unit,loc.stockGroupName,loc.stockAreaName,loc.stockAreaPath].map(v=>String(v||'').toLowerCase()).join(' ');
      return haystack.includes(queryText);
    });
  }

  const sortMode=state.stockSort==='low-first'?'stock-asc':(state.stockSort||'name-asc');
  if(state.stockSort==='low-first') state.stockSort='stock-asc';
  list=[...list].sort((a,b)=>{
    if(filterExpiry || filterExpiryTimeline){
      const byExpiry=(getExpiryStatus(a).days??999999)-(getExpiryStatus(b).days??999999);
      if(byExpiry) return byExpiry;
    }
    if(sortMode==='name-desc') return String(b.name||'').localeCompare(String(a.name||''),'th');
    if(sortMode==='stock-desc') return (Number(b.stock)||0)-(Number(a.stock)||0);
    if(sortMode==='stock-asc') return (Number(a.stock)||0)-(Number(b.stock)||0);
    return String(a.name||'').localeCompare(String(b.name||''),'th');
  });

  const timelineRows=filterExpiryTimeline?stockExpiryTimelineRows(list):[];
  const rows=filterExpiryTimeline?renderStockExpiryTimelineRows(timelineRows):list.map(p=>{
    const stock=Number(p.stock)||0;
    const min=Number(p.min)||0;
    const isOut=stock<=0;
    const isLow=!isOut && stock<=min;
    const statusText=isOut?'หมด':(isLow?'ใกล้หมด':'ปกติ');
    const statusClass=isOut?'stock-status-out':(isLow?'stock-status-low':'stock-status-ok');
    const expiryStatus=getExpiryStatus(p);
    const statusAccent=isOut?'#ef4444':(isLow?'#f59e0b':'#007a55');
    const accent=expiryStatus.key==='expired'?'#111827':(expiryStatus.key==='today'?'#dc2626':(expiryStatus.key==='warning'?'#f59e0b':statusAccent));
    const expiryBadge=expiryStatusMarkup(p,{compact:true});
    const statusBadge=`<span class="stock-status-modern ${statusClass}">${statusText}</span>`;
    const statusAboveCount=stockCardStatusAboveCount();

    return `<article class="stock-card-modern ${statusAboveCount?'stock-status-above-count':'stock-status-with-name'}" style="--stock-accent:${accent};--stock-count-color:${statusAccent}" role="button" tabindex="0" aria-label="ดูรายละเอียด ${escapeHtml(p.name)}" onclick="window.viewProduct('${p.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.viewProduct('${p.id}')}">
      <div class="stock-card-photo">${p.photo?productImageMarkup(p.photo,p.name):`<div class="stock-card-photo-placeholder">📦</div>`}</div>
      <div class="stock-card-main">
        <div class="stock-card-heading"><h3 class="stock-card-name">${escapeHtml(p.name)}</h3>${statusAboveCount?'':statusBadge}</div>
        <div class="stock-card-sku">รหัสสินค้า: ${escapeHtml(p.sku||'-')}</div>${stockLocationBadgeMarkup(p)}${lotSummaryMarkup(p)}
        ${expiryBadge?`<div class="stock-card-expiry-row">${expiryBadge}<span>หมดอายุ ${escapeHtml(expiryDateLabel(p))}</span></div>`:''}
        </div>
      <div class="stock-card-side">${statusAboveCount?`<div class="stock-card-side-status">${statusBadge}</div>`:''}<div class="stock-card-qty"><span class="stock-card-number">${stock}</span><span class="stock-card-unit">${escapeHtml(p.unit||'หน่วย')}</span></div><span class="stock-card-arrow">›</span></div>
    </article>`;
  }).join('');

  const archivedCount=state.products.filter(p=>p.archived && !p.trashed).length;
  const emptyMsg=queryText
    ? '<div class="card"><p class="muted">ไม่พบสินค้าที่ค้นหา</p></div>'
    : (filterLow?'<div class="card"><p class="muted">ไม่มีสต๊อกใกล้หมด 🎉</p></div>':(filterExpiryTimeline?'<div class="card"><p class="muted">ยังไม่มีล็อตที่ระบุวันหมดอายุ</p></div>':(filterExpiry?'<div class="card"><p class="muted">ไม่มีสินค้าใกล้หมดอายุ 🎉</p></div>':'<div class="card"><p class="muted">ยังไม่มีสินค้า</p></div>')));
  const pageSuffix=filterLow?' • สต๊อกใกล้หมด':(filterExpiry?' • ใกล้หมดอายุ':(filterExpiryTimeline?' • วันหมดอายุทั้งหมด':''));

  view.innerHTML=`<div class="between stock-page-head">
      <h1>Stock${pageSuffix}</h1>
      ${(all.length||canManageProducts()||canAdjustStock())?`<div class="stock-head-actions">${all.length?`<button class="btn light small" onclick="window.openBulkProductQr()">🖨️ QR</button>`:''}${canAdjustStock()?`<button class="btn light small" onclick="window.openStockAdjustmentPicker()">⚖️ ปรับยอด</button>`:''}${canManageProducts()&&all.length?`<button class="btn light small" onclick="window.openBulkProductEditor()">✏️ แก้หลาย</button>`:''}${canManageProducts()?`<button class="btn primary small" onclick="window.addProduct()">+ เพิ่ม</button>`:''}</div>`:''}
    </div>

    <div class="card stock-toolbar">
      <input id="stockSearchInput" class="stock-search-field" value="${escapeHtml(state.stockSearch||'')}" placeholder="🔍 ค้นหาชื่อสินค้า, SKU หรือหมวดหมู่" oninput="window.setStockSearch(this.value)">
      ${stockStructureFilterMarkup()}
      <select id="stockCategorySelect" class="stock-sort-field" onchange="window.setStockCategory(this.value)">
        <option value="all" ${state.stockCategory==='all'?'selected':''}>ทุกหมวดหมู่</option>
        ${categories.map(c=>`<option value="${escapeHtml(c)}" ${state.stockCategory===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}
      </select>
      <select id="stockSortSelect" class="stock-sort-field" onchange="window.setStockSort(this.value)">
        <option value="name-asc" ${sortMode==='name-asc'?'selected':''}>เรียงชื่อ A–Z</option>
        <option value="name-desc" ${sortMode==='name-desc'?'selected':''}>เรียงชื่อ Z–A</option>
        <option value="stock-desc" ${sortMode==='stock-desc'?'selected':''}>จำนวนมากไปน้อย</option>
        <option value="stock-asc" ${sortMode==='stock-asc'?'selected':''}>จำนวนน้อยไปมาก</option>
      </select>
      <div class="muted stock-result-count">${filterExpiryTimeline?`แสดง ${timelineRows.length} ล็อต จาก ${list.length} รายการ`:`แสดง ${list.length} จาก ${all.length} รายการ`}</div>
    </div>

    ${(filterLow||filterExpiry||filterExpiryTimeline)?`<div class="card stock-active-filter"><span class="muted">${filterLow?'กำลังแสดงเฉพาะสต๊อกใกล้หมด':(filterExpiryTimeline?'กำลังแสดงวันหมดอายุทุกล็อต เรียงจากใกล้สุดไปไกลสุด':'กำลังแสดงเฉพาะสินค้าใกล้หมดอายุ เรียงวันที่ใกล้ที่สุดก่อน')}</span><div class="row" style="gap:8px;flex-wrap:wrap">${filterExpiry?`<button class="btn small green" onclick="window.goToPage('stock',{filter:'expiry-timeline',resetScroll:true})">ดูวันหมดอายุทั้งหมด</button>`:''}${filterExpiryTimeline?`<button class="btn small light" onclick="window.goToPage('stock',{filter:'expiry',resetScroll:true})">ดูเฉพาะที่ถึงจุดเตือน</button>`:''}<button class="btn small" onclick="window.goToPage('stock',{filter:'all',resetScroll:true})">แสดงทั้งหมด</button></div></div>`:''}

    ${filterExpiryTimeline?`<div class="card expiry-timeline-intro"><div><b>🗓️ วันหมดอายุล่วงหน้า</b><p class="muted">แสดงทุกล็อตที่มีวันหมดอายุ แม้ยังไม่ถึงจุดแจ้งเตือนของสินค้า</p></div></div>`:''}

    <div class="stock-card-list ${filterExpiryTimeline?'expiry-timeline-list':''}">${rows||emptyMsg}</div>

    ${archivedCount?`<div class="card"><button class="btn light full" onclick="window.showArchived()">📦 ดูรายการที่ Archive แล้ว (${archivedCount})</button></div>`:''}`;
}

function refreshStockSearchResults(){
  const listBox=document.querySelector('.stock-card-list');
  const countBox=document.querySelector('.stock-result-count');
  if(!listBox || !countBox) return;

  const filterLow=state.stockFilter==='low';
  const filterExpiry=state.stockFilter==='expiry';
  const filterExpiryTimeline=state.stockFilter==='expiry-timeline';
  const all=accessibleProducts(state.products.filter(p=>!p.archived && !p.trashed));
  const queryText=(state.stockSearch||'').trim().toLowerCase();
  let list=filterLow?all.filter(p=>Number(p.stock)<=Number(p.min)):(filterExpiry?all.filter(p=>getExpiryStatus(p).active):all);
  if(state.stockGroupFilter!=='all') list=list.filter(p=>productStockGroupId(p)===state.stockGroupFilter);
  if(state.stockAreaFilter!=='all') list=list.filter(p=>productStockAreaId(p)===state.stockAreaFilter);
  if(state.stockCategory!=='all') list=list.filter(p=>String(p.category||'').trim()===state.stockCategory);
  if(queryText){
    list=list.filter(p=>{ const loc=productStockLocation(p); return [p.name,p.sku,p.category,p.unit,loc.stockGroupName,loc.stockAreaName,loc.stockAreaPath].map(v=>String(v||'').toLowerCase()).join(' ').includes(queryText); });
  }

  const sortMode=state.stockSort==='low-first'?'stock-asc':(state.stockSort||'name-asc');
  if(state.stockSort==='low-first') state.stockSort='stock-asc';
  list=[...list].sort((a,b)=>{
    if(filterExpiry){
      const byExpiry=(getExpiryStatus(a).days??999999)-(getExpiryStatus(b).days??999999);
      if(byExpiry) return byExpiry;
    }
    if(sortMode==='name-desc') return String(b.name||'').localeCompare(String(a.name||''),'th');
    if(sortMode==='stock-desc') return (Number(b.stock)||0)-(Number(a.stock)||0);
    if(sortMode==='stock-asc') return (Number(a.stock)||0)-(Number(b.stock)||0);
    return String(a.name||'').localeCompare(String(b.name||''),'th');
  });

  const rows=list.map(p=>{
    const stock=Number(p.stock)||0;
    const min=Number(p.min)||0;
    const isOut=stock<=0;
    const isLow=!isOut && stock<=min;
    const statusText=isOut?'หมด':(isLow?'ใกล้หมด':'ปกติ');
    const statusClass=isOut?'stock-status-out':(isLow?'stock-status-low':'stock-status-ok');
    const expiryStatus=getExpiryStatus(p);
    const statusAccent=isOut?'#ef4444':(isLow?'#f59e0b':'#007a55');
    const accent=expiryStatus.key==='expired'?'#111827':(expiryStatus.key==='today'?'#dc2626':(expiryStatus.key==='warning'?'#f59e0b':statusAccent));
    const expiryBadge=expiryStatusMarkup(p,{compact:true});
    const statusBadge=`<span class="stock-status-modern ${statusClass}">${statusText}</span>`;
    const statusAboveCount=stockCardStatusAboveCount();
    return `<article class="stock-card-modern ${statusAboveCount?'stock-status-above-count':'stock-status-with-name'}" style="--stock-accent:${accent};--stock-count-color:${statusAccent}" role="button" tabindex="0" aria-label="ดูรายละเอียด ${escapeHtml(p.name)}" onclick="window.viewProduct('${p.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.viewProduct('${p.id}')}">
      <div class="stock-card-photo">${p.photo?productImageMarkup(p.photo,p.name):`<div class="stock-card-photo-placeholder">📦</div>`}</div>
      <div class="stock-card-main"><div class="stock-card-heading"><h3 class="stock-card-name">${escapeHtml(p.name)}</h3>${statusAboveCount?'':statusBadge}</div><div class="stock-card-sku">รหัสสินค้า: ${escapeHtml(p.sku||'-')}</div>${stockLocationBadgeMarkup(p)}${lotSummaryMarkup(p)}${expiryBadge?`<div class="stock-card-expiry-row">${expiryBadge}<span>หมดอายุ ${escapeHtml(expiryDateLabel(p))}</span></div>`:''}</div>
      <div class="stock-card-side">${statusAboveCount?`<div class="stock-card-side-status">${statusBadge}</div>`:''}<div class="stock-card-qty"><span class="stock-card-number">${stock}</span><span class="stock-card-unit">${escapeHtml(p.unit||'หน่วย')}</span></div><span class="stock-card-arrow">›</span></div>
    </article>`;
  }).join('');

  const emptyMsg=queryText?'<div class="card"><p class="muted">ไม่พบสินค้าที่ค้นหา</p></div>':(filterLow?'<div class="card"><p class="muted">ไม่มีสต๊อกใกล้หมด 🎉</p></div>':(filterExpiry?'<div class="card"><p class="muted">ไม่มีสินค้าใกล้หมดอายุ 🎉</p></div>':'<div class="card"><p class="muted">ยังไม่มีสินค้า</p></div>'));
  listBox.innerHTML=rows||emptyMsg;
  countBox.textContent=`แสดง ${list.length} จาก ${all.length} รายการ`;
}

window.setStockSearch=(value)=>{
  state.stockSearch=String(value||'');
  if(state.stockFilter==='expiry-timeline'){ saveUiState(); renderStock(); return; }
  refreshStockSearchResults();
};
window.setStockSort=(value)=>{ state.stockSort=value||'name-asc'; saveUiState(); renderStock(); };
window.setStockCategory=(value)=>{ state.stockCategory=value||'all'; saveUiState(); renderStock(); };
window.setStockGroupFilter=(value)=>{ state.stockGroupFilter=value||'all'; state.stockAreaFilter='all'; state.stockCategory='all'; stockFilterPermissionContext(); saveUiState(); renderStock(); };
window.setStockAreaFilter=(value)=>{ state.stockAreaFilter=value||'all'; state.stockCategory='all'; stockFilterPermissionContext(); saveUiState(); renderStock(); };

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
window.backToStock=()=>{ state.viewProductId=null; localStorage.removeItem(PRODUCT_DETAIL_KEY); state.productDetailTab='general'; saveUiState(); goToPage('stock'); };
window.unarchiveProduct=async(id)=>{ if(!requireManager()) return; const p=state.products.find(x=>x.id===id); await updateDoc(productRef(id),{archived:false,updatedAt:serverTimestamp()}); await addLog('กู้คืนสินค้า',p.name,{productId:id}); refreshPublicProductPreviewQuietly(id); toast('กู้คืนแล้ว'); renderArchived(); };

// ---------- หน้ารายละเอียดสินค้า (รูป + ประวัติรับ/เบิก) ----------
window.viewProduct=(id)=>{
  if(!id) return;
  const target=state.products.find(x=>String(x.id)===String(id));
  if(target && !canAccessProduct(target)) return toast('คุณไม่มีสิทธิ์เข้าถึงสินค้านี้');
  saveCurrentPageScroll();
  state.viewProductId=id;
  state.productDetailTab='general';
  localStorage.setItem(PRODUCT_DETAIL_KEY,id);
  saveUiState();
  state.page='productDetail';
  localStorage.setItem(LAST_PAGE_KEY,'productDetail');
  document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.remove('active'));
  renderProductDetail(id);
  restorePageScroll('productDetail');
};

function productQuickMoveActionsMarkup(p={}){
  if(!canAccessProduct(p)) return '';
  return `<div class="product-quick-actions" aria-label="ปุ่มลัดรับเข้าและเบิกออกสินค้า">
    <button type="button" class="product-quick-action out" onclick="window.openProductQuickMove('${escapeHtml(p.id||'')}','out')"><span>↑</span><div><b>เบิกสินค้า</b><small>เปิดฟอร์มเบิกสินค้านี้ทันที</small></div></button>
    <button type="button" class="product-quick-action in" onclick="window.openProductQuickMove('${escapeHtml(p.id||'')}','in')"><span>↓</span><div><b>รับสินค้า</b><small>เปิดฟอร์มรับเข้าสินค้านี้ทันที</small></div></button>
  </div><div class="product-quick-note">ใช้กับ QR Code ได้ทันที: สแกนแล้วเข้าหน้าสินค้า จากนั้นกดเบิก/รับโดยไม่ต้องค้นหาสินค้าใหม่</div>`;
}
window.openProductQuickMove=(id,type='out')=>{
  const p=state.products.find(x=>String(x.id)===String(id));
  if(!p) return toast('ไม่พบสินค้า');
  if(!canAccessProduct(p)) return toast('คุณไม่มีสิทธิ์ทำรายการสินค้านี้');
  const mode=type==='in'?'in':'out';
  const existing=readNewItemDraft?.();
  if(existing?.hasData){
    const ok=window.confirm('มีรายการเบิก/รับสินค้าที่ยังไม่ได้บันทึก\nต้องการเริ่มรายการใหม่จากสินค้านี้หรือไม่?');
    if(!ok) return;
  }
  const loc=productStockLocation(p);
  state.newItemType=mode;
  state.scanGroupId=loc.stockGroupId||state.scanGroupId||'';
  state.scanAreaId=loc.stockAreaId||state.scanAreaId||'all';
  state.selectedImage=null;
  newItemDraftPromptChecked=true;
  clearNewItemDraft?.();
  goToPage('scan',{resetScroll:true});
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    try{
      const groupEl=$('scanStockGroup');
      if(groupEl && loc.stockGroupId){ groupEl.value=loc.stockGroupId; state.scanGroupId=loc.stockGroupId; }
      const areaEl=$('scanStockArea');
      if(areaEl && loc.stockAreaId){ areaEl.value=loc.stockAreaId; state.scanAreaId=loc.stockAreaId; }
      refreshIssueDestinationPicker('scanIssueDestination','scanIssueDestinationOther',state.scanGroupId);
      window.selectScanProduct?.(p.id);
      saveNewItemDraft?.();
      const target=mode==='out'?$('scanIssueDestination'):$('scanQty');
      if(target) target.focus({preventScroll:true});
      toast(mode==='out'?'เปิดฟอร์มเบิกสินค้านี้แล้ว':'เปิดฟอร์มรับเข้าสินค้านี้แล้ว');
    }catch(err){
      console.error('openProductQuickMove failed',err);
      toast('เปิดรายการลัดไม่สำเร็จ');
    }
  }));
};

function renderProductDetail(id){
  if(!id){
    state.page='stock'; localStorage.setItem(LAST_PAGE_KEY,'stock'); renderStock(); return;
  }
  const p=state.products.find(x=>x.id===id);
  if(!p){
    if(!productsSnapshotReady){
      view.innerHTML='<div class="card"><h2>กำลังโหลดรายละเอียดสินค้า...</h2><p class="muted">กำลังกลับไปยังสินค้าที่คุณเปิดไว้ก่อนรีเฟรช</p></div>';
      return;
    }
    state.viewProductId=null; localStorage.removeItem(PRODUCT_DETAIL_KEY); state.page='stock'; localStorage.setItem(LAST_PAGE_KEY,'stock'); renderStock(); return;
  }

  if(!canAccessProduct(p)){ view.innerHTML='<div class="card"><h2>ไม่มีสิทธิ์เข้าถึงสินค้านี้</h2><p class="muted">กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดกลุ่มสต๊อกหรือพื้นที่สต๊อกให้บัญชีของคุณ</p></div>'; return; }
  const history=state.logs.filter(l=>l.productId===id||(Array.isArray(l.productIds)&&l.productIds.includes(id))).filter(l=>canAccessLogEntry(l)).sort((a,b)=>(getLogDate(b)?.getTime()||0)-(getLogDate(a)?.getTime()||0));
  const stock=Number(p.stock)||0;
  const min=Number(p.min)||0;
  const isOut=stock<=0;
  const isLow=!isOut&&stock<=min;
  const statusText=isOut?'หมด':(isLow?'ใกล้หมด':'ปกติ');
  const statusClass=isOut?'bad':(isLow?'warn':'ok');
  const statusDescription=isOut?'สินค้าไม่มีคงเหลือ ควรดำเนินการเติมสินค้า':(isLow?'เหลือน้อยกว่าหรือเท่ากับจุดเตือนที่ตั้งไว้':'จำนวนคงเหลือมากกว่าจุดเตือน');
  const expiryStatus=getExpiryStatus(p);
  const expiryReminderDays=getExpiryReminderDays(p);

  const latest=history[0];
  const latestActor=latest?.reviewerName||latest?.actorName||'-';
  const latestTime=latest?.time||'-';
  const latestNote=p.note||latest?.note||'-';

  const historyRows=history.map(l=>{
    const {label,cls}=logPillInfo(l);
    const changesHtml=Array.isArray(l.changes)&&l.changes.length?`<ul style="margin:6px 0 0;padding-left:18px">${l.changes.map(c=>`<li>${escapeHtml(c)}</li>`).join('')}</ul>`:'';
    return `<div class="product-history-item">
      ${l.photo?`<img src="${l.photo}" style="width:54px;height:54px;border-radius:12px;object-fit:cover;flex:0 0 auto">`:''}
      <div class="product-history-main">
        <span class="pill ${cls}">${escapeHtml(label)}</span>
        <div style="margin-top:6px">${l.qty?`<b>${l.qty} ${escapeHtml(l.unit||'')}</b> — `:''}${escapeHtml(l.detail||'')}</div>
        ${l.location?`<div class="muted" style="font-size:13px;margin-top:4px">📍 ${escapeHtml(l.location)}</div>`:''}
        ${changesHtml}
      </div>
      <div class="product-history-time">${escapeHtml(l.time||'')}</div>
    </div>`;
  }).join('');

  const movementRows=history.filter(l=>isStockMovementLog(l)).map(l=>{
    const incoming=isReceiveLog(l);
    return `<div class="product-history-item">
      <div style="width:42px;height:42px;border-radius:14px;display:grid;place-items:center;background:${incoming?'#dcfce7':'#fef3c7'};font-size:21px">${incoming?'↓':'↑'}</div>
      <div class="product-history-main">
        <b>${incoming?'รับเข้า':'เบิกออก'} ${Number(l.qty)||0} ${escapeHtml(l.unit||p.unit||'')}</b>
        <div class="muted" style="font-size:13px;margin-top:4px">${escapeHtml(l.detail||'')}</div>
        ${l.location?`<div class="muted" style="font-size:13px">📍 ${escapeHtml(l.location)}</div>`:''}
      </div>
      <div class="product-history-time">${escapeHtml(l.time||'')}</div>
    </div>`;
  }).join('');

  view.innerHTML=`<div class="between"><h1>รายละเอียดสินค้า</h1><button class="btn small" onclick="window.backToStock()">← กลับ</button></div>
  <div class="product-detail-shell">
    <section class="product-detail-card">
      <div class="product-detail-top">
        <div class="product-detail-photo-wrap">
          ${p.photo?productImageMarkup(p.photo,p.name,'product-detail-photo'):`<div class="product-detail-photo-placeholder">📦</div>`}
          <input id="prodPhotoInput" type="file" accept="image/*" class="hidden">
          ${canManageProducts()?`<button type="button" class="product-detail-change-photo" onclick="$('prodPhotoInput').click()">📷 ${p.photo?'เปลี่ยนรูปสินค้า':'เพิ่มรูปสินค้า'}</button>`:''}
        </div>

        <div class="product-detail-summary">
          <h2 class="product-detail-name">${escapeHtml(p.name)}</h2>
          <div class="product-detail-meta">รหัสสินค้า: ${escapeHtml(p.sku||'-')}<br>หมวดหมู่: ${escapeHtml(p.category||'ทั่วไป')}</div>

          <div class="product-status-banner ${statusClass}">
            <span class="product-status-dot"></span>
            <div class="product-status-copy"><b>${statusText}</b><span>${statusDescription}</span></div>
          </div>

          ${p.hasExpiry?`<div class="expiry-detail-banner ${expiryStatus.className}"><span>⏰</span><div><b>${escapeHtml(expiryStatus.label)}</b><small>วันหมดอายุ ${escapeHtml(expiryDateLabel(p))} • แจ้งเตือนล่วงหน้า ${expiryReminderDays} วัน</small></div></div>`:''}

          <div class="product-detail-stats">
            <div class="product-detail-stat stock">
              <div class="product-detail-stat-label">📦 คงเหลือ</div>
              <div class="product-detail-stat-value">${stock} <small>${escapeHtml(p.unit||'หน่วย')}</small></div>
            </div>
            <div class="product-detail-stat min">
              <div class="product-detail-stat-label">🔔 จุดเตือน</div>
              <div class="product-detail-stat-value">${min} <small>${escapeHtml(p.unit||'หน่วย')}</small></div>
            </div>
          </div>

          ${productQuickMoveActionsMarkup(p)}
        </div>
      </div>

      <div class="product-detail-info-list">
        <div class="product-detail-info-row"><span class="product-detail-info-label">📅 อัปเดตล่าสุด</span><span class="product-detail-info-value">${escapeHtml(latestTime)}</span></div>
        <div class="product-detail-info-row"><span class="product-detail-info-label">👤 ผู้บันทึกล่าสุด</span><span class="product-detail-info-value">${escapeHtml(latestActor)}</span></div>
        <div class="product-detail-info-row"><span class="product-detail-info-label">📝 หมายเหตุ</span><span class="product-detail-info-value">${escapeHtml(latestNote)}</span></div>
      </div>

      <button type="button" class="product-detail-edit-btn" onclick="window.openProductQr('${p.id}')"><span>🔳 QR Code สินค้า</span><span>›</span></button><button type="button" class="product-detail-edit-btn" onclick="window.viewProductLots('${p.id}')"><span>📦 ดูล็อตสินค้า (${normalizeProductLots(p).length})</span><span>›</span></button>${canAdjustStock()?`<button type="button" class="product-detail-edit-btn" onclick="window.adjustStock('${p.id}')"><span>⚖️ ปรับยอดสต๊อก</span><span>›</span></button>`:''}${canManageProducts()?`<button type="button" class="product-detail-edit-btn" onclick="window.editProduct('${p.id}')"><span>✏️ แก้ไขข้อมูลสินค้า</span><span>›</span></button>`:''}

      <div class="product-detail-tabs" role="tablist">
        <button type="button" class="product-detail-tab ${state.productDetailTab==='general'?'active':''}" data-product-tab="general" onclick="window.switchProductDetailTab('general')">ข้อมูลทั่วไป</button>
        <button type="button" class="product-detail-tab ${state.productDetailTab==='movement'?'active':''}" data-product-tab="movement" onclick="window.switchProductDetailTab('movement')">ประวัติการเคลื่อนไหว</button>
        <button type="button" class="product-detail-tab ${state.productDetailTab==='all'?'active':''}" data-product-tab="all" onclick="window.switchProductDetailTab('all')">ประวัติทั้งหมด</button>
      </div>

      <div id="productDetailPanel_general" class="product-detail-panel ${state.productDetailTab==='general'?'':'hidden'}">
        <div class="product-detail-info-list" style="margin-top:0">
          <div class="product-detail-info-row"><span class="product-detail-info-label">ชื่อสินค้า</span><span class="product-detail-info-value">${escapeHtml(p.name)}</span></div>
          <div class="product-detail-info-row"><span class="product-detail-info-label">SKU</span><span class="product-detail-info-value">${escapeHtml(p.sku||'-')}</span></div>
          <div class="product-detail-info-row"><span class="product-detail-info-label">หมวดหมู่</span><span class="product-detail-info-value">${escapeHtml(p.category||'ทั่วไป')}</span></div>
          <div class="product-detail-info-row"><span class="product-detail-info-label">กลุ่ม/พื้นที่สต๊อก</span><span class="product-detail-info-value">${escapeHtml(productStockLocation(p).stockAreaPath)}</span></div>
          <div class="product-detail-info-row"><span class="product-detail-info-label">หน่วยนับ</span><span class="product-detail-info-value">${escapeHtml(p.unit||'หน่วย')}</span></div>
          <div class="product-detail-info-row"><span class="product-detail-info-label">มีวันหมดอายุ</span><span class="product-detail-info-value">${p.hasExpiry?'มี':'ไม่มี'}</span></div>
          ${p.hasExpiry?`<div class="product-detail-info-row"><span class="product-detail-info-label">วันหมดอายุ</span><span class="product-detail-info-value">${escapeHtml(expiryDateLabel(p))}</span></div><div class="product-detail-info-row"><span class="product-detail-info-label">แจ้งเตือนล่วงหน้า</span><span class="product-detail-info-value">${expiryReminderDays} วัน</span></div><div class="product-detail-info-row"><span class="product-detail-info-label">สถานะวันหมดอายุ</span><span class="product-detail-info-value"><span class="expiry-badge ${expiryStatus.className}">${escapeHtml(expiryStatus.label)}</span></span></div>`:''}
        </div>
      </div>

      <div id="productDetailPanel_movement" class="product-detail-panel ${state.productDetailTab==='movement'?'':'hidden'}">${movementRows||'<div class="product-empty">ยังไม่มีประวัติรับเข้า–เบิกออก</div>'}</div>
      <div id="productDetailPanel_all" class="product-detail-panel ${state.productDetailTab==='all'?'':'hidden'}">${historyRows||'<div class="product-empty">ยังไม่มีประวัติสำหรับสินค้านี้</div>'}</div>
    </section>
  </div>`;

  if(canManageProducts()){
    const photoInput=$('prodPhotoInput');
    if(photoInput) photoInput.onchange=async e=>{
      const f=e.target.files[0];if(!f)return;
      try{
        toast('กำลังอัปโหลดรูปสินค้า...');
        const dataUrl=await compressImage(f);
        const uploaded=await uploadProductImage(id,dataUrl,p.photoPath||'');
        await updateDoc(productRef(id),{photo:uploaded.url,photoPath:uploaded.path,updatedAt:serverTimestamp()});
        await addLog('อัปเดตรูปสินค้า',p.name,{productId:id,changes:['เปลี่ยนรูปภาพสินค้าใหม่ (Cloud Storage)']});
        toast('บันทึกรูปแล้ว');
      }catch(error){
        console.error(error);
        toast('บันทึกรูปไม่สำเร็จ');
      }
    };
  }
}

window.switchProductDetailTab=(tab)=>{
  if(!['general','movement','all'].includes(tab)) tab='general';
  state.productDetailTab=tab; saveUiState();
  ['general','movement','all'].forEach(name=>{
    $(`productDetailPanel_${name}`)?.classList.toggle('hidden',name!==tab);
    document.querySelector(`[data-product-tab="${name}"]`)?.classList.toggle('active',name===tab);
  });
};

window.openStockAdjustmentPicker=()=>{
  if(!requireManager()) return;
  const products=accessibleProducts(state.products.filter(p=>!p.trashed&&!p.archived)).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'th'));
  if(!products.length) return toast('ยังไม่มีสินค้าให้ปรับยอด');
  openModal('⚖️ เลือกสินค้าที่ต้องการปรับยอด',`
    <label class="field-label" for="adjustProductSelect">สินค้า</label>
    <select id="adjustProductSelect">${products.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} • คงเหลือ ${Number(p.stock)||0} ${escapeHtml(p.unit||'หน่วย')}</option>`).join('')}</select>
    <p class="note">การปรับยอดจะแยกจากการแก้ไขข้อมูลสินค้า และบันทึก Audit Log ทุกครั้ง</p>
    <button class="btn primary full" onclick="window.confirmStockAdjustmentPicker()">ถัดไป</button>`);
};
window.confirmStockAdjustmentPicker=()=>{ const id=$('adjustProductSelect')?.value; if(id) window.adjustStock(id); };

function productAddModeSwitchMarkup(mode='single'){
  return `<div class="product-add-mode-switch" role="tablist" aria-label="โหมดเพิ่มสินค้า">
    <button type="button" class="product-add-mode-btn ${mode==='single'?'active':''}" onclick="window.addProduct()">1 สินค้า</button>
    <button type="button" class="product-add-mode-btn ${mode==='bulk'?'active':''}" onclick="window.addMultipleProducts()">หลายสินค้า</button>
  </div>`;
}
let bulkProductRowSeq=0;
let bulkProductImages=new Map();
function bulkProductRowMarkup(rowId){
  return `<section class="bulk-product-card" data-bulk-product-row="${rowId}">
    <div class="bulk-product-card-head"><div><span class="bulk-product-number">สินค้า</span><small>กรอกเฉพาะรายการที่ต้องการบันทึก</small></div><button type="button" class="btn ghost tiny bulk-product-remove" onclick="window.removeBulkProductRow(this)">ลบ</button></div>
    <div class="bulk-row-error hidden" role="alert"></div>
    <label class="field-label">ชื่อสินค้า <span class="required-mark">*</span></label>
    <input class="bulk-name" placeholder="เช่น น้ำส้ม" oninput="window.updateBulkProductCount()">
    <div class="bulk-product-grid">
      <label>รหัสสินค้า / รหัสสั่งซื้อ (SKU)<input class="bulk-sku" placeholder="ไม่บังคับ • ใช้รหัสซ้ำได้" oninput="window.updateBulkProductCount()"><small class="bulk-field-help">สินค้าคนละชนิดสามารถใช้รหัสสั่งซื้อเดียวกันได้</small></label>
      <label>หมวดหมู่<input class="bulk-category" placeholder="เช่น เครื่องดื่ม" oninput="window.updateBulkProductCount()"></label>
      <label>หน่วยนับ<input class="bulk-unit" value="ชิ้น" placeholder="เช่น ขวด"></label>
      <label>จำนวนเริ่มต้น<input class="bulk-stock" type="number" min="0" inputmode="decimal" placeholder="0"></label>
      <label>จุดเตือนสต๊อกต่ำ<input class="bulk-min" type="number" min="0" inputmode="decimal" placeholder="0"></label>
    </div>
    <div class="bulk-product-image-field">
      <div class="bulk-product-image-title"><b>รูปสินค้า</b><small>ไม่บังคับ • บีบอัดก่อนอัปโหลดเข้า Firebase Storage</small></div>
      <input class="bulk-product-image-input" type="file" accept="image/*" style="display:none" onchange="window.selectBulkProductImage(event,'${rowId}')">
      <button type="button" class="btn secondary full bulk-product-image-btn" onclick="this.parentElement.querySelector('.bulk-product-image-input').click()">📷 เลือกรูปสินค้านี้</button>
      <div class="bulk-product-image-preview-wrap hidden">
        <img class="bulk-product-image-preview" alt="ตัวอย่างรูปสินค้า">
        <div class="bulk-product-image-actions"><span>เลือกรูปแล้ว</span><button type="button" class="btn ghost tiny" onclick="window.clearBulkProductImage('${rowId}')">เอารูปออก</button></div>
      </div>
    </div>
    <label class="bulk-expiry-toggle-row"><input class="bulk-expiry-toggle" type="checkbox" onchange="window.toggleBulkProductExpiry(this)"><span><b>มีวันหมดอายุ</b><small>เปิดเฉพาะสินค้าที่ต้องติดตามวันหมดอายุ</small></span></label>
    <div class="bulk-product-expiry-fields hidden">
      <label>วันหมดอายุ<input class="bulk-expiry-date" type="date"></label>
      <label>แจ้งเตือนล่วงหน้า<select class="bulk-expiry-reminder"><option value="3">3 วัน</option><option value="7" selected>7 วัน</option><option value="14">14 วัน</option><option value="30">30 วัน</option></select></label>
    </div>
  </section>`;
}
function renumberBulkProductRows(){
  document.querySelectorAll('[data-bulk-product-row]').forEach((card,index)=>{
    const label=card.querySelector('.bulk-product-number');
    if(label) label.textContent=`สินค้า #${index+1}`;
  });
  window.updateBulkProductCount?.();
}
function clearBulkProductErrors(){
  document.querySelectorAll('.bulk-row-error').forEach(el=>{el.textContent='';el.classList.add('hidden');});
  document.querySelectorAll('.bulk-product-card').forEach(el=>el.classList.remove('has-error'));
}
function setBulkProductRowError(card,message){
  if(!card) return;
  card.classList.add('has-error');
  const el=card.querySelector('.bulk-row-error');
  if(el){ el.textContent=message; el.classList.remove('hidden'); }
}
function collectBulkProductRows(){
  return [...document.querySelectorAll('[data-bulk-product-row]')].map((card,index)=>{
    const value=sel=>String(card.querySelector(sel)?.value||'').trim();
    const name=value('.bulk-name'),sku=value('.bulk-sku'),category=value('.bulk-category'),unit=value('.bulk-unit')||'ชิ้น';
    const stockRaw=value('.bulk-stock'),minRaw=value('.bulk-min');
    const hasExpiry=!!card.querySelector('.bulk-expiry-toggle')?.checked;
    const expiryDate=value('.bulk-expiry-date');
    const expiryReminderDays=Number(value('.bulk-expiry-reminder')||7);
    const rowId=String(card.dataset.bulkProductRow||'');
    const imageData=bulkProductImages.get(rowId)||'';
    const hasAny=!!(name||sku||category||stockRaw||minRaw||hasExpiry||imageData||(unit&&unit!=='ชิ้น'));
    return {card,rowId,rowNumber:index+1,hasAny,name,sku,category,unit,initialStock:stockRaw===''?0:Number(stockRaw),minimumStock:minRaw===''?0:Number(minRaw),hasExpiry,expiryDate:hasExpiry?expiryDate:'',expiryReminderDays:hasExpiry?expiryReminderDays:0,imageData};
  }).filter(row=>row.hasAny);
}
function validateBulkProductRows(rows,stockLoc){
  clearBulkProductErrors();
  if(!rows.length){ toast('กรอกสินค้าอย่างน้อย 1 รายการ'); return false; }
  if(rows.length>50){ toast('เพิ่มพร้อมกันได้สูงสุด 50 รายการ'); return false; }
  if(!canAccessStockLocation(stockLoc.stockGroupId,stockLoc.stockAreaId)){ toast('คุณไม่มีสิทธิ์เพิ่มสินค้าในพื้นที่นี้'); return false; }
  let valid=true;
  const names=new Map();
  const existingNames=new Set(state.products.filter(p=>!p.trashed&&!p.archived).map(p=>normalizeProductNameKey(p.name)));
  rows.forEach(row=>{
    let error='';
    const nameKey=normalizeProductNameKey(row.name);
    if(!row.name) error='กรุณากรอกชื่อสินค้า';
    else if(existingNames.has(nameKey)) error='มีชื่อนี้ในสต๊อกแล้ว — โหมดหลายสินค้าใช้สำหรับสินค้าใหม่เท่านั้น';
    else if(!Number.isFinite(row.initialStock)||row.initialStock<0) error='จำนวนเริ่มต้นต้องเป็น 0 หรือมากกว่า';
    else if(!Number.isFinite(row.minimumStock)||row.minimumStock<0) error='จุดเตือนสต๊อกต่ำต้องเป็น 0 หรือมากกว่า';
    else if(row.hasExpiry && !parseExpiryDate(row.expiryDate)) error='กรุณาระบุวันหมดอายุให้ถูกต้อง';
    else if(row.hasExpiry && (!Number.isInteger(row.expiryReminderDays)||row.expiryReminderDays<0||row.expiryReminderDays>3650)) error='จำนวนวันแจ้งเตือนไม่ถูกต้อง';
    if(error){ setBulkProductRowError(row.card,error); valid=false; }
    if(nameKey){
      if(names.has(nameKey)){ setBulkProductRowError(row.card,'ชื่อสินค้าซ้ำกันในรายการนี้'); setBulkProductRowError(names.get(nameKey).card,'ชื่อสินค้าซ้ำกันในรายการนี้'); valid=false; }
      else names.set(nameKey,row);
    }
  });
  if(!valid){ document.querySelector('.bulk-product-card.has-error')?.scrollIntoView({behavior:'smooth',block:'center'}); toast('ตรวจข้อมูลที่ทำเครื่องหมายสีแดง'); }
  return valid;
}
window.selectBulkProductImage=async(event,rowId)=>{
  const input=event?.target;
  const file=input?.files?.[0];
  if(!file) return;
  const card=input.closest('[data-bulk-product-row]');
  try{
    const dataUrl=await compressImage(file);
    bulkProductImages.set(String(rowId),dataUrl);
    const img=card?.querySelector('.bulk-product-image-preview');
    const wrap=card?.querySelector('.bulk-product-image-preview-wrap');
    if(img) img.src=dataUrl;
    wrap?.classList.remove('hidden');
    toast('เลือกรูปสินค้านี้แล้ว');
    window.updateBulkProductCount?.();
  }catch(e){
    console.error('เตรียมรูปสินค้าหลายรายการไม่สำเร็จ',e);
    bulkProductImages.delete(String(rowId));
    toast('เตรียมรูปสินค้าไม่สำเร็จ');
  }finally{ if(input) input.value=''; }
};
window.clearBulkProductImage=(rowId)=>{
  bulkProductImages.delete(String(rowId));
  const card=document.querySelector(`[data-bulk-product-row="${String(rowId).replace(/"/g,'')}"]`);
  const img=card?.querySelector('.bulk-product-image-preview');
  const wrap=card?.querySelector('.bulk-product-image-preview-wrap');
  if(img) img.removeAttribute('src');
  wrap?.classList.add('hidden');
  window.updateBulkProductCount?.();
};

window.addMultipleProducts=()=>{
  if(!requireManager()) return;
  bulkProductRowSeq=0;
  bulkProductImages=new Map();
  const firstRows=[++bulkProductRowSeq,++bulkProductRowSeq].map(id=>bulkProductRowMarkup(id)).join('');
  openModal('เพิ่มสินค้าหลายรายการ',`
    ${productAddModeSwitchMarkup('bulk')}
    <div class="bulk-product-intro"><b>เพิ่มพร้อมกันได้สูงสุด 50 รายการ</b><span>ใช้กลุ่ม/พื้นที่สต๊อกเดียวกัน • ใส่รูปแยกแต่ละสินค้าได้ • รหัสสั่งซื้อซ้ำกันได้หากเป็นสินค้าคนละชนิด</span></div>
    ${stockLocationSelectorsMarkup('bulkProductLocation')}
    <div id="bulkProductRows" class="bulk-product-list">${firstRows}</div>
    <button id="addBulkProductRowBtn" type="button" class="btn secondary full bulk-product-add-row" onclick="window.addBulkProductRow()">＋ เพิ่มสินค้าอีก</button>
    <p class="field-hint bulk-product-photo-note">📷 รูปเป็นตัวเลือก หากใส่รูป ระบบจะบีบอัดและอัปโหลดเข้า Firebase Storage หลังสร้างสินค้าสำเร็จ</p>
    <button id="saveMultipleProductsBtn" class="btn primary full" onclick="window.saveMultipleProducts()">บันทึกสินค้าหลายรายการ</button>
  `);
  renumberBulkProductRows();
};
window.addBulkProductRow=()=>{
  const box=$('bulkProductRows'); if(!box) return;
  const current=box.querySelectorAll('[data-bulk-product-row]').length;
  if(current>=50) return toast('เพิ่มพร้อมกันได้สูงสุด 50 รายการ');
  const id=++bulkProductRowSeq;
  box.insertAdjacentHTML('beforeend',bulkProductRowMarkup(id));
  renumberBulkProductRows();
  box.lastElementChild?.querySelector('.bulk-name')?.focus();
};
window.removeBulkProductRow=(button)=>{
  const card=button?.closest('[data-bulk-product-row]'),box=$('bulkProductRows');
  if(!card||!box) return;
  if(box.querySelectorAll('[data-bulk-product-row]').length<=1) return toast('ต้องมีอย่างน้อย 1 ช่องสินค้า');
  bulkProductImages.delete(String(card.dataset.bulkProductRow||''));
  card.remove(); renumberBulkProductRows();
};
window.toggleBulkProductExpiry=(checkbox)=>{
  const card=checkbox?.closest('[data-bulk-product-row]');
  const fields=card?.querySelector('.bulk-product-expiry-fields');
  fields?.classList.toggle('hidden',!checkbox.checked);
  if(checkbox.checked) setTimeout(()=>card?.querySelector('.bulk-expiry-date')?.focus(),40);
};
window.updateBulkProductCount=()=>{
  const filled=[...document.querySelectorAll('[data-bulk-product-row] .bulk-name')].filter(el=>String(el.value||'').trim()).length;
  const button=$('saveMultipleProductsBtn');
  if(button && !button.disabled) button.textContent=filled?`บันทึกทั้งหมด ${filled} สินค้า`:'บันทึกสินค้าหลายรายการ';
};
window.saveMultipleProducts=async()=>{
  if(!requireManager()) return;
  const rows=collectBulkProductRows();
  const stockLoc=collectStockLocationForm('bulkProductLocation');
  if(!validateBulkProductRows(rows,stockLoc)) return;
  const preview=rows.slice(0,8).map((row,i)=>`${i+1}. ${row.name}`).join('\n');
  const more=rows.length>8?`\n...และอีก ${rows.length-8} รายการ`:'';
  if(!window.confirm(`กำลังเพิ่มสินค้าใหม่ ${rows.length} รายการ\nพื้นที่: ${stockLoc.stockAreaPath}\n\n${preview}${more}\n\nยืนยันบันทึกทั้งหมดหรือไม่?`)) return;
  const lockKey='saveMultipleProducts';
  if(!beginActionLock(lockKey,'saveMultipleProductsBtn','กำลังบันทึกทั้งหมด...')) return;
  const bulkBatchId=makeEventId('BULKPRODUCT');
  const actorName=state.profile?.displayName||state.profile?.username||'';
  const actorUid=state.user?.uid||'';
  const bulkLogDoc=doc(logRef()),bulkAuditDoc=doc(auditRef());
  const items=rows.map(row=>{
    const productDoc=doc(userPath('products'));
    const initialLot=row.initialStock>0?{id:makeEventId('LOT'),lotNo:generateLotNo({name:row.name,sku:row.sku,lots:[]},row.expiryDate||''),qty:row.initialStock,expiryDate:row.expiryDate||'',receivedAt:new Date().toISOString(),receivedByUid:actorUid,receivedByName:actorName,note:'ล็อตเริ่มต้นจากการเพิ่มหลายสินค้า',status:'active'}:null;
    return {...row,productDoc,initialLot};
  });
  try{
    await runTransaction(fs,async tx=>{
      for(const item of items){
        const expiry={hasExpiry:item.hasExpiry,expiryDate:item.hasExpiry?item.expiryDate:'',expiryReminderDays:item.hasExpiry?item.expiryReminderDays:0};
        const product={name:item.name,sku:item.sku,skuKey:normalizeSkuKey(item.sku),category:item.category,unit:item.unit||'ชิ้น',stock:item.initialStock,min:item.minimumStock,...stockLoc,...expiry,lots:item.initialLot?[item.initialLot]:[],archived:false,photo:'',photoPath:'',createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
        tx.set(item.productDoc,product);
      }
      // ใช้ Log/Audit แบบสรุป 1 คู่ต่อชุด เพื่อให้การเพิ่มสูงสุด 50 รายการยังคง Atomic
      // และไม่ชน Firestore Security Rules document-access limit จากการอ่านสินค้า 50 รายการซ้ำใน Log/Audit รายตัว
      const productIds=items.map(item=>item.productDoc.id),productNames=items.map(item=>item.name);
      const detail=`เพิ่มสินค้า ${items.length} รายการ • ${stockLoc.stockAreaPath}`;
      const common={productId:'',productIds,productNames,bulkBatchId,bulkAdd:true,bulkCount:items.length,bulkPhotoCount:items.filter(item=>item.imageData).length,...stockLoc};
      tx.set(bulkLogDoc,logPayload('เพิ่มสินค้าหลายรายการ',detail,common));
      tx.set(bulkAuditDoc,auditPayload('เพิ่มสินค้าหลายรายการ',detail,{...common,logId:bulkLogDoc.id}));
    });
    const withImages=items.filter(item=>item.imageData);
    let uploadedImages=0,failedImages=0;
    const saveButton=$('saveMultipleProductsBtn');
    for(let i=0;i<withImages.length;i++){
      const item=withImages[i];
      if(saveButton) saveButton.textContent=`กำลังอัปโหลดรูป ${i+1}/${withImages.length}...`;
      try{
        const uploaded=await uploadProductImage(item.productDoc.id,item.imageData,'');
        await updateDoc(item.productDoc,{photo:uploaded.url,photoPath:uploaded.path,updatedAt:serverTimestamp()});
        uploadedImages++;
      }catch(imageErr){
        failedImages++;
        console.error(`อัปโหลดรูปสินค้า #${item.rowNumber} ไม่สำเร็จ`,imageErr);
      }
    }
    items.forEach(item=>refreshPublicProductPreviewQuietly(item.productDoc.id));
    bulkProductImages.clear();
    hideModal();
    if(failedImages) toast(`เพิ่มสินค้า ${items.length} รายการแล้ว • รูปสำเร็จ ${uploadedImages} • รูปไม่สำเร็จ ${failedImages} (เพิ่มรูปภายหลังได้)`);
    else toast(withImages.length?`เพิ่มสินค้า ${items.length} รายการและรูป ${uploadedImages} รูปเรียบร้อย`:`เพิ่มสินค้า ${items.length} รายการเรียบร้อย`);
  }catch(e){
    console.error('เพิ่มสินค้าหลายรายการไม่สำเร็จ',e);
    if(e?.code==='permission-denied') toast('ไม่มีสิทธิ์บันทึกสินค้า กรุณาตรวจ Firestore Rules');
    else toast(e?.message||'เพิ่มสินค้าหลายรายการไม่สำเร็จ');
  }finally{ endActionLock(lockKey,'saveMultipleProductsBtn'); window.updateBulkProductCount?.(); }
};

window.addProduct=()=>{ if(!requireManager()) return; state.newProductImage=null; openModal('เพิ่มสินค้า',`
  ${productAddModeSwitchMarkup('single')}
  <label class="field-label" for="pn">ชื่อสินค้า</label>
  <input id="pn" placeholder="เช่น ถุงใส่แก้วกาแฟคู่">

  <label class="field-label" for="ps">รหัสสินค้า / รหัสสั่งซื้อ (SKU)</label>
  <span class="field-hint">ไม่บังคับ • สินค้าคนละชนิดสามารถใช้รหัสสั่งซื้อเดียวกันได้</span>
  <input id="ps" placeholder="ไม่บังคับ" oninput="window.validateSkuField('')" onblur="window.validateSkuField('')">
  <div id="skuInlineError" class="sku-inline-error hidden" role="alert"></div>

  <label class="field-label" for="pc">หมวดหมู่</label>
  <input id="pc" placeholder="เช่น บรรจุภัณฑ์">

  ${stockLocationSelectorsMarkup('newProduct')}

  <label class="field-label" for="pu">หน่วยนับ</label>
  <span class="field-hint">เช่น แพ็ค, ชิ้น, กระป๋อง, ใบ</span>
  <input id="pu" placeholder="เช่น แพ็ค">

  <label class="field-label" for="pq">จำนวนคงเหลือเริ่มต้น</label>
  <input id="pq" type="number" placeholder="เช่น 10">

  <label class="field-label" for="pm">จุดเตือนสต๊อกต่ำ</label>
  <span class="field-hint">แจ้งเตือน "ใกล้หมด" เมื่อคงเหลือน้อยกว่าหรือเท่ากับจำนวนนี้</span>
  <input id="pm" type="number" placeholder="เช่น 5">

  ${expiryFormMarkup()}

  <label class="field-label">รูปสินค้า</label>
  <span class="field-hint">เลือกรูปได้ตั้งแต่ตอนเพิ่มสินค้า ระบบจะบีบอัดและอัปโหลดเข้า Firebase Storage อัตโนมัติ</span>
  <input id="newProductImageInput" type="file" accept="image/*" style="display:none" onchange="window.selectNewProductImage(event)">
  <button type="button" class="btn secondary full" onclick="document.getElementById('newProductImageInput').click()">📷 เลือกรูปสินค้า</button>
  <div id="newProductImagePreviewWrap" class="hidden" style="margin-top:12px;text-align:center">
    <img id="newProductImagePreview" class="preview" alt="ตัวอย่างรูปสินค้า" style="max-height:220px;object-fit:contain">
    <button type="button" class="btn ghost full" style="margin-top:8px" onclick="window.clearNewProductImage()">ลบรูปที่เลือก</button>
  </div>

  <button id="saveNewProductBtn" class="btn primary full" onclick="window.saveNewProduct()">บันทึกสินค้า</button>
`); };

window.selectNewProductImage=async(event)=>{
  const input=event?.target;
  const file=input?.files?.[0];
  if(!file) return;
  try{
    state.newProductImage=await compressImage(file);
    const img=$('newProductImagePreview'),wrap=$('newProductImagePreviewWrap');
    if(img) img.src=state.newProductImage;
    wrap?.classList.remove('hidden');
    toast('เลือกรูปสินค้าแล้ว');
  }catch(e){ console.error(e); state.newProductImage=null; toast('เตรียมรูปสินค้าไม่สำเร็จ'); }
  finally{ if(input) input.value=''; }
};
window.clearNewProductImage=()=>{
  state.newProductImage=null;
  const img=$('newProductImagePreview'),wrap=$('newProductImagePreviewWrap');
  if(img) img.removeAttribute('src');
  wrap?.classList.add('hidden');
};

window.saveNewProduct=async()=>{
  const lockKey='saveNewProduct';
  if(!beginActionLock(lockKey,'saveNewProductBtn','กำลังบันทึก...')) return;
  const name=$('pn').value.trim(),sku=$('ps').value.trim();
  if(!name){ endActionLock(lockKey,'saveNewProductBtn'); return toast('กรอกชื่อสินค้า'); }
  const initialStock=Number($('pq').value||0);
  const minimumStock=Number($('pm').value||0);
  const stockLoc=collectStockLocationForm('newProduct');
  if(!canAccessStockLocation(stockLoc.stockGroupId,stockLoc.stockAreaId)){ endActionLock(lockKey,'saveNewProductBtn'); return toast('คุณไม่มีสิทธิ์เพิ่มสินค้าในพื้นที่นี้'); }
  if(!Number.isFinite(initialStock)||initialStock<0){ endActionLock(lockKey,'saveNewProductBtn'); return toast('จำนวนคงเหลือเริ่มต้นต้องเป็น 0 หรือมากกว่า'); }
  if(!Number.isFinite(minimumStock)||minimumStock<0){ endActionLock(lockKey,'saveNewProductBtn'); return toast('จุดเตือนสต๊อกต่ำต้องเป็น 0 หรือมากกว่า'); }
  let expiry; try{ expiry=readExpiryForm(); }catch(e){ endActionLock(lockKey,'saveNewProductBtn'); return toast(e.message); }
  const duplicateByName=state.products.find(p=>!p.trashed&&!p.archived&&normalizeProductNameKey(p.name)===normalizeProductNameKey(name));
  const productDoc=duplicateByName?productRef(duplicateByName.id):doc(userPath('products')),logDoc=doc(logRef()),auditDoc=doc(auditRef()),eventId=makeEventId('PRODUCT');
  const initialLot=initialStock>0?{id:makeEventId('LOT'),lotNo:generateLotNo(duplicateByName||{name,sku,lots:[]},expiry.expiryDate||''),qty:initialStock,expiryDate:expiry.expiryDate||'',receivedAt:new Date().toISOString(),receivedByUid:state.user?.uid||'',receivedByName:state.profile?.displayName||state.profile?.username||'',note:'ล็อตเริ่มต้น',status:'active'}:null;
  const product={name,sku,skuKey:normalizeSkuKey(sku),category:$('pc').value,unit:$('pu').value||'ชิ้น',stock:initialStock,min:minimumStock,...stockLoc,...expiry,lots:initialLot?[initialLot]:[],archived:false,photo:'',photoPath:'',createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
  try{
    await runTransaction(fs,async tx=>{
      if(duplicateByName){
        const existingSnap=await tx.get(productDoc); if(!existingSnap.exists()) throw new Error('ไม่พบสินค้าเดิม');
        const existing=existingSnap.data(); const lots=normalizeProductLots(existing); if(initialLot) lots.push(initialLot);
        tx.update(productDoc,{stock:(Number(existing.stock)||0)+initialStock,lots,hasExpiry:existing.hasExpiry||expiry.hasExpiry,expiryDate:(earliestProductLot({...existing,lots})||{}).expiryDate||existing.expiryDate||'',updatedAt:serverTimestamp()});
      }else tx.set(productDoc,product);
      tx.set(logDoc,logPayload(duplicateByName?'เพิ่มล็อต':'เพิ่มสินค้า',name,{productId:productDoc.id,eventId,lotNo:initialLot?.lotNo||'',lotId:initialLot?.id||'',...stockLoc}));
      tx.set(auditDoc,auditPayload(duplicateByName?'เพิ่มล็อต':'เพิ่มสินค้า',name,{productId:productDoc.id,eventId,logId:logDoc.id,lotNo:initialLot?.lotNo||'',lotId:initialLot?.id||'',...stockLoc}));
    });
    const pendingImage=state.newProductImage;
    if(pendingImage){
      try{
        const uploaded=await uploadProductImage(productDoc.id,pendingImage,'');
        await updateDoc(productDoc,{photo:uploaded.url,photoPath:uploaded.path,updatedAt:serverTimestamp()});
        await Promise.allSettled([
          updateDoc(logDoc,{productPhoto:uploaded.url,productPhotoPath:uploaded.path,updatedAt:serverTimestamp()}),
          updateDoc(auditDoc,{productPhoto:uploaded.url,productPhotoPath:uploaded.path,updatedAt:serverTimestamp()})
        ]);
      }catch(imageErr){
        console.error('อัปโหลดรูปสินค้าใหม่ไม่สำเร็จ',imageErr);
        hideModal();
        state.newProductImage=null;
        toast('เพิ่มสินค้าแล้ว แต่รูปอัปโหลดไม่สำเร็จ สามารถเพิ่มรูปภายหลังได้');
        return;
      }
    }
    state.newProductImage=null;
    refreshPublicProductPreviewQuietly(productDoc.id);
    hideModal(); toast(duplicateByName?'พบชื่อสินค้าเดิม — เพิ่มเป็นล็อตใหม่แล้ว':(pendingImage?'เพิ่มสินค้าและรูปเรียบร้อย':'เพิ่มสินค้าแล้ว'));
  }catch(e){ console.error(e); toast(e?.message||'เพิ่มสินค้าไม่สำเร็จ'); }
  finally{ endActionLock(lockKey,'saveNewProductBtn'); }
};
window.adjustStock=(id)=>{
  if(!canAdjustStock()) return toast('คุณไม่มีสิทธิ์ปรับยอดสต๊อก');
  const p=state.products.find(x=>x.id===id); if(!p) return;
  if(!canAccessProduct(p)) return toast('คุณไม่มีสิทธิ์ปรับยอดสินค้านี้');
  openModal('⚖️ ปรับยอดสต๊อก',`
    <div class="card stock-adjust-modal-card" style="box-shadow:none;background:#f8fafc"><b>${escapeHtml(p.name)}</b><div class="muted">ยอดปัจจุบัน ${Number(p.stock)||0} ${escapeHtml(p.unit||'หน่วย')}</div></div>
    <label class="field-label" for="adjustNewStock">ยอดใหม่</label>
    <input id="adjustNewStock" type="number" min="0" step="1" value="${Number(p.stock)||0}">
    <label class="field-label" for="adjustReason">เหตุผลในการปรับยอด</label>
    <select id="adjustPreset" onchange="window.fillAdjustReason()">
      <option value="">เลือกเหตุผล</option><option>ตรวจนับสต๊อกจริง</option><option>ของเสีย</option><option>หมดอายุ</option><option>แตกหัก / ชำรุด</option><option>สูญหาย</option><option>ใช้ภายใน</option><option>แก้ไขข้อมูลผิด</option><option>อื่น ๆ</option>
    </select>
    <input id="adjustReason" placeholder="กรุณาระบุเหตุผล">
    <button class="btn primary full" onclick="window.saveStockAdjustment('${id}')">บันทึกการปรับยอด</button>`);
};
window.fillAdjustReason=()=>{ const v=$('adjustPreset')?.value||''; if(v && v!=='อื่น ๆ') $('adjustReason').value=v; };
window.saveStockAdjustment=async(id)=>{
  if(!canAdjustStock()) return toast('คุณไม่มีสิทธิ์ปรับยอดสต๊อก');
  const cached=state.products.find(x=>x.id===id); if(!cached) return;
  if(!canAccessProduct(cached)) return toast('คุณไม่มีสิทธิ์ปรับยอดสินค้านี้');
  const newStock=Number($('adjustNewStock').value),reason=($('adjustReason').value||'').trim();
  if(!Number.isFinite(newStock)||newStock<0) return toast('ยอดใหม่ต้องเป็น 0 หรือมากกว่า');
  if(!reason) return toast('กรุณาระบุเหตุผล');
  try{
    await runTransaction(fs,async tx=>{
      const pRef=productRef(id),snap=await tx.get(pRef);
      if(!snap.exists()) throw new Error('ไม่พบสินค้า');
      const p=snap.data(),oldStock=Number(p.stock)||0;
      if(newStock===oldStock) throw new Error('ยอดใหม่เท่ากับยอดเดิม');
      const eventId=makeEventId('ADJ'),detail=p.name||cached.name||'สินค้า';
      const extra={productId:id,previousStock:oldStock,newStock,unit:p.unit||'หน่วย',reason,changes:[`จำนวนคงเหลือ: ${oldStock} → ${newStock}`],eventId};
      const logDoc=doc(logRef()),auditDoc=doc(auditRef());
      tx.update(pRef,{stock:newStock,updatedAt:serverTimestamp(),lastAdjustedAt:serverTimestamp(),lastAdjustedBy:state.user.uid,lastAdjustedReason:reason});
      tx.set(logDoc,logPayload('ปรับยอดสินค้า',detail,extra));
      tx.set(auditDoc,auditPayload('ปรับยอดสินค้า',detail,{...extra,logId:logDoc.id}));
    });
    refreshPublicProductPreviewQuietly(id);
    hideModal(); toast('ปรับยอดและบันทึกประวัติแล้ว');
  }catch(e){ console.error(e); toast(e?.message||'ปรับยอดไม่สำเร็จ'); }
};


// ---------- v34.29.52 R3: แก้ไขสินค้าหลายรายการ (รูป / ชื่อ / SKU / ประเภท) ----------
let bulkEditProductImages=new Map();
let bulkEditPhotoRemovals=new Set();
let bulkEditSelectedIds=new Set();

function bulkEditScopeProducts(){
  let list=accessibleProducts(state.products.filter(p=>!p.archived&&!p.trashed));
  if(state.stockFilter==='low') list=list.filter(p=>Number(p.stock)<=Number(p.min));
  else if(state.stockFilter==='expiry') list=list.filter(p=>getExpiryStatus(p).active);
  if(state.stockGroupFilter!=='all') list=list.filter(p=>productStockGroupId(p)===state.stockGroupFilter);
  if(state.stockAreaFilter!=='all') list=list.filter(p=>productStockAreaId(p)===state.stockAreaFilter);
  if(state.stockCategory!=='all') list=list.filter(p=>String(p.category||'').trim()===state.stockCategory);
  const queryText=(state.stockSearch||'').trim().toLowerCase();
  if(queryText){
    list=list.filter(p=>{
      const loc=productStockLocation(p);
      return [p.name,p.sku,p.category,p.unit,loc.stockGroupName,loc.stockAreaName,loc.stockAreaPath].map(v=>String(v||'').toLowerCase()).join(' ').includes(queryText);
    });
  }
  const sortMode=state.stockSort==='low-first'?'stock-asc':(state.stockSort||'name-asc');
  return [...list].sort((a,b)=>{
    if(sortMode==='name-desc') return String(b.name||'').localeCompare(String(a.name||''),'th',{numeric:true});
    if(sortMode==='stock-desc') return (Number(b.stock)||0)-(Number(a.stock)||0);
    if(sortMode==='stock-asc') return (Number(a.stock)||0)-(Number(b.stock)||0);
    return String(a.name||'').localeCompare(String(b.name||''),'th',{numeric:true});
  });
}
function bulkEditSelectionRowMarkup(product={}){
  const loc=stockLocationPath(productStockLocation(product));
  const hay=escapeHtml([product.name,product.sku,product.category,product.unit,loc].map(v=>String(v||'')).join(' ').toLowerCase());
  const photo=product.photo?`<img src="${escapeHtml(product.photo)}" alt="${escapeHtml(product.name||'สินค้า')}" loading="lazy" decoding="async">`:'📦';
  return `<div class="bulk-edit-select-row" data-bulk-edit-select-row data-id="${escapeHtml(product.id||'')}" data-text="${hay}">
    <input class="bulk-edit-select-check" type="checkbox" value="${escapeHtml(product.id||'')}" onchange="window.updateBulkEditSelectionCount()">
    <span class="bulk-edit-select-photo">${photo}</span>
    <span class="bulk-edit-select-copy"><b>${escapeHtml(product.name||'-')}</b><small>SKU: ${escapeHtml(product.sku||'-')} • ${escapeHtml(product.category||'ทั่วไป')} • ${escapeHtml(loc)}</small></span>
  </div>`;
}
window.updateBulkEditSelectionCount=()=>{
  const selected=document.querySelectorAll('#modalBody .bulk-edit-select-check:checked').length;
  const visible=[...document.querySelectorAll('#modalBody [data-bulk-edit-select-row]')].filter(row=>row.style.display!=='none').length;
  const count=$('bulkEditSelectedCount'), visibleCount=$('bulkEditVisibleCount'), button=$('bulkEditContinueBtn');
  if(count) count.textContent=selected;
  if(visibleCount) visibleCount.textContent=visible;
  if(button){ button.textContent=selected?`แก้ไขที่เลือก ${selected} รายการ`:'เลือกสินค้าที่ต้องการแก้ไข'; button.disabled=selected===0; }
};
window.filterBulkEditProductList=(value='')=>{
  const q=String(value||'').trim().toLowerCase();
  document.querySelectorAll('#modalBody [data-bulk-edit-select-row]').forEach(row=>{ row.style.display=!q || String(row.dataset.text||'').includes(q)?'':'none'; });
  window.updateBulkEditSelectionCount();
};
window.setBulkEditProductSelection=(mode='visible')=>{
  const rows=[...document.querySelectorAll('#modalBody [data-bulk-edit-select-row]')];
  if(mode==='none'){
    rows.forEach(row=>{ const cb=row.querySelector('.bulk-edit-select-check'); if(cb) cb.checked=false; });
    window.updateBulkEditSelectionCount(); return;
  }
  const targets=rows.filter(row=>mode==='all'||row.style.display!=='none');
  const allowed=new Set(targets.slice(0,50).map(row=>String(row.dataset.id||'')));
  rows.forEach(row=>{ const cb=row.querySelector('.bulk-edit-select-check'); if(cb) cb.checked=allowed.has(String(row.dataset.id||'')); });
  if(targets.length>50) toast('แก้ไขพร้อมกันได้สูงสุด 50 รายการ — เลือก 50 รายการแรกให้แล้ว');
  window.updateBulkEditSelectionCount();
};
window.openBulkProductEditor=()=>{
  if(!requireManager()) return;
  const products=bulkEditScopeProducts();
  if(!products.length) return toast('ไม่มีสินค้าในมุมมองนี้ให้แก้ไข');
  bulkEditProductImages=new Map();
  bulkEditPhotoRemovals=new Set();
  bulkEditSelectedIds=new Set();
  openModal('แก้ไขสินค้าหลายรายการ',`<div class="bulk-edit-sheet bulk-edit-selection-step">
    <div class="bulk-edit-intro"><b>✏️ เลือกสินค้าที่ต้องการแก้ไข</b><span>แก้พร้อมกันได้สูงสุด 50 รายการ • เปลี่ยนรูป ชื่อ รหัสสินค้า/รหัสสั่งซื้อ และประเภท/หมวดหมู่ได้</span></div>
    <input class="bulk-edit-search" placeholder="🔍 ค้นหาชื่อ, SKU หรือประเภท" oninput="window.filterBulkEditProductList(this.value)">
    <div class="bulk-edit-selection-actions"><button class="btn light small" type="button" onclick="window.setBulkEditProductSelection('visible')">เลือกที่แสดง</button><button class="btn light small" type="button" onclick="window.setBulkEditProductSelection('all')">เลือกทั้งหมด</button><button class="btn light small" type="button" onclick="window.setBulkEditProductSelection('none')">ล้างการเลือก</button></div>
    <div class="bulk-edit-selection-summary"><span>แสดง <b id="bulkEditVisibleCount">${products.length}</b> รายการ</span><span>เลือก <b id="bulkEditSelectedCount">0</b> รายการ</span></div>
    <div class="bulk-edit-selection-list">${products.map(bulkEditSelectionRowMarkup).join('')}</div>
    <button id="bulkEditContinueBtn" class="btn primary full" type="button" disabled onclick="window.beginBulkEditSelectedProducts()">เลือกสินค้าที่ต้องการแก้ไข</button>
  </div>`);
};
window.beginBulkEditSelectedProducts=()=>{
  const ids=[...document.querySelectorAll('#modalBody .bulk-edit-select-check:checked')].map(cb=>String(cb.value||''));
  if(!ids.length) return toast('เลือกสินค้าอย่างน้อย 1 รายการ');
  if(ids.length>50) return toast('แก้ไขพร้อมกันได้สูงสุด 50 รายการ');
  bulkEditSelectedIds=new Set(ids);
  bulkEditProductImages=new Map();
  bulkEditPhotoRemovals=new Set();
  const map=new Map(state.products.map(p=>[String(p.id),p]));
  const products=ids.map(id=>map.get(id)).filter(Boolean);
  const body=$('modalBody');
  if(!body) return;
  body.innerHTML=`<div class="bulk-edit-sheet bulk-edit-form-step">
    <div class="bulk-edit-intro"><b>แก้ไข ${products.length} รายการ</b><span>ช่องไหนไม่เปลี่ยน ระบบจะเก็บค่าเดิมไว้ • SKU ซ้ำกับสินค้าอื่นได้</span></div>
    <div class="bulk-edit-form-toolbar"><button class="btn light small" type="button" onclick="window.openBulkProductEditor()">← เลือกใหม่</button><span>รูป / ชื่อ / รหัส / ประเภท</span></div>
    <div id="bulkEditProductCards" class="bulk-edit-card-list">${products.map(bulkEditProductCardMarkup).join('')}</div>
    <button id="saveBulkProductEditsBtn" class="btn primary full" type="button" onclick="window.saveBulkProductEdits()">บันทึกการแก้ไข ${products.length} รายการ</button>
  </div>`;
  body.scrollTop=0;
};
function bulkEditProductCardMarkup(p={}){
  const photo=p.photo?`<img class="bulk-edit-photo-preview" src="${escapeHtml(p.photo)}" alt="${escapeHtml(p.name||'สินค้า')}">`:`<div class="bulk-edit-photo-preview bulk-edit-photo-placeholder">📦</div>`;
  return `<section class="bulk-edit-card" data-bulk-edit-card data-product-id="${escapeHtml(p.id||'')}">
    <div class="bulk-edit-card-head"><div class="bulk-edit-photo-box" data-bulk-edit-photo-box>${photo}</div><div class="bulk-edit-card-title"><b>${escapeHtml(p.name||'-')}</b><small>คงเหลือ ${Number(p.stock)||0} ${escapeHtml(p.unit||'หน่วย')}</small></div></div>
    <div class="bulk-edit-card-error hidden" role="alert"></div>
    <div class="bulk-edit-photo-actions">
      <input class="bulk-edit-photo-input" type="file" accept="image/*" hidden onchange="window.selectBulkEditProductImage(event,'${escapeHtml(p.id||'')}')">
      <button class="btn light small" type="button" onclick="this.parentElement.querySelector('.bulk-edit-photo-input').click()">📷 เปลี่ยนรูป</button>
      <button class="btn light small" type="button" onclick="window.restoreBulkEditProductPhoto('${escapeHtml(p.id||'')}')">↩️ ใช้รูปเดิม</button>
      ${p.photo?`<button class="btn ghost small bulk-edit-photo-remove-btn" type="button" onclick="window.removeBulkEditProductPhoto('${escapeHtml(p.id||'')}')">🗑️ ลบรูป</button>`:''}
    </div>
    <div class="bulk-edit-fields">
      <label>ชื่อสินค้า <span class="required-mark">*</span><input class="bulk-edit-name" value="${escapeHtml(p.name||'')}" placeholder="ชื่อสินค้า"></label>
      <label>รหัสสินค้า / รหัสสั่งซื้อ (SKU)<input class="bulk-edit-sku" value="${escapeHtml(p.sku||'')}" placeholder="ไม่บังคับ • ใช้รหัสซ้ำได้"><small>สินค้าคนละชนิดใช้รหัสสั่งซื้อเดียวกันได้</small></label>
      <label>ประเภท / หมวดหมู่<input class="bulk-edit-category" value="${escapeHtml(p.category||'')}" placeholder="เช่น บรรจุภัณฑ์"></label>
    </div>
  </section>`;
}
function bulkEditCardById(id){
  return [...document.querySelectorAll('#modalBody [data-bulk-edit-card]')].find(card=>String(card.dataset.productId||'')===String(id||''))||null;
}
function setBulkEditCardError(card,message=''){
  if(!card) return;
  card.classList.toggle('has-error',!!message);
  const box=card.querySelector('.bulk-edit-card-error');
  if(box){ box.textContent=message; box.classList.toggle('hidden',!message); }
}
window.selectBulkEditProductImage=async(event,id)=>{
  const input=event?.target, file=input?.files?.[0];
  if(!file) return;
  const card=bulkEditCardById(id);
  try{
    const dataUrl=await compressImage(file);
    bulkEditProductImages.set(String(id),dataUrl);
    bulkEditPhotoRemovals.delete(String(id));
    const box=card?.querySelector('[data-bulk-edit-photo-box]');
    if(box) box.innerHTML=`<img class="bulk-edit-photo-preview" src="${dataUrl}" alt="ตัวอย่างรูปใหม่">`;
    toast('เลือกรูปใหม่แล้ว');
  }catch(e){ console.error('เตรียมรูปสำหรับแก้หลายรายการไม่สำเร็จ',e); toast('เตรียมรูปไม่สำเร็จ'); }
  finally{ if(input) input.value=''; }
};
window.removeBulkEditProductPhoto=(id)=>{
  const p=state.products.find(x=>String(x.id)===String(id));
  if(!p) return;
  bulkEditProductImages.delete(String(id));
  bulkEditPhotoRemovals.add(String(id));
  const box=bulkEditCardById(id)?.querySelector('[data-bulk-edit-photo-box]');
  if(box) box.innerHTML='<div class="bulk-edit-photo-preview bulk-edit-photo-placeholder">ไม่มีรูป</div>';
};
window.restoreBulkEditProductPhoto=(id)=>{
  const p=state.products.find(x=>String(x.id)===String(id));
  if(!p) return;
  bulkEditProductImages.delete(String(id));
  bulkEditPhotoRemovals.delete(String(id));
  const box=bulkEditCardById(id)?.querySelector('[data-bulk-edit-photo-box]');
  if(box) box.innerHTML=p.photo?`<img class="bulk-edit-photo-preview" src="${escapeHtml(p.photo)}" alt="${escapeHtml(p.name||'สินค้า')}">`:'<div class="bulk-edit-photo-preview bulk-edit-photo-placeholder">📦</div>';
};
function collectBulkProductEditRows(){
  const productMap=new Map(state.products.map(p=>[String(p.id),p]));
  let valid=true;
  const rows=[...document.querySelectorAll('#modalBody [data-bulk-edit-card]')].map(card=>{
    setBulkEditCardError(card,'');
    const id=String(card.dataset.productId||''), p=productMap.get(id);
    if(!p){ setBulkEditCardError(card,'ไม่พบสินค้านี้แล้ว กรุณาปิดและเปิดใหม่'); valid=false; return null; }
    const name=String(card.querySelector('.bulk-edit-name')?.value||'').trim();
    const sku=String(card.querySelector('.bulk-edit-sku')?.value||'').trim();
    const category=String(card.querySelector('.bulk-edit-category')?.value||'').trim();
    if(!name){ setBulkEditCardError(card,'กรุณากรอกชื่อสินค้า'); valid=false; }
    const changes=[];
    if(name!==String(p.name||'')) changes.push(`ชื่อ: ${p.name||'-'} → ${name||'-'}`);
    if(sku!==String(p.sku||'')) changes.push(`SKU: ${p.sku||'-'} → ${sku||'-'}`);
    if(category!==String(p.category||'')) changes.push(`ประเภท: ${p.category||'-'} → ${category||'-'}`);
    const imageData=bulkEditProductImages.get(id)||'';
    const removePhoto=bulkEditPhotoRemovals.has(id) && !!p.photo;
    if(imageData) changes.push('เปลี่ยนรูปสินค้า');
    else if(removePhoto) changes.push('ลบรูปสินค้า');
    return {id,p,card,name,sku,category,imageData,removePhoto,changes};
  }).filter(Boolean);
  if(!valid){ document.querySelector('#modalBody .bulk-edit-card.has-error')?.scrollIntoView({behavior:'smooth',block:'center'}); toast('ตรวจข้อมูลที่ทำเครื่องหมายสีแดง'); return null; }
  return rows.filter(row=>row.changes.length);
}
window.saveBulkProductEdits=async()=>{
  if(!requireManager()) return;
  const rows=collectBulkProductEditRows();
  if(!rows) return;
  if(!rows.length) return toast('ยังไม่มีข้อมูลที่เปลี่ยนแปลง');
  if(rows.length>50) return toast('แก้ไขพร้อมกันได้สูงสุด 50 รายการ');
  const preview=rows.slice(0,8).map((r,i)=>`${i+1}. ${r.p.name} (${r.changes.length} จุด)`).join('\n');
  const more=rows.length>8?`\n...และอีก ${rows.length-8} รายการ`:'';
  if(!window.confirm(`กำลังแก้ไขสินค้า ${rows.length} รายการ\n\n${preview}${more}\n\nยืนยันบันทึกหรือไม่?`)) return;
  const lockKey='saveBulkProductEdits';
  if(!beginActionLock(lockKey,'saveBulkProductEditsBtn','กำลังบันทึก...')) return;
  const uploadedNewPaths=[];
  try{
    const imageRows=rows.filter(r=>r.imageData);
    const saveBtn=$('saveBulkProductEditsBtn');
    for(let i=0;i<imageRows.length;i++){
      const row=imageRows[i];
      if(saveBtn) saveBtn.textContent=`กำลังอัปโหลดรูป ${i+1}/${imageRows.length}...`;
      const uploaded=await uploadProductImage(row.id,row.imageData,'');
      row.uploadedPhoto=uploaded;
      uploadedNewPaths.push(uploaded.path);
    }
    if(saveBtn) saveBtn.textContent='กำลังบันทึกข้อมูลทั้งหมด...';
    const batch=writeBatch(fs);
    const bulkBatchId=makeEventId('BULKEDIT');
    rows.forEach(row=>{
      const update={updatedAt:serverTimestamp()};
      if(row.name!==String(row.p.name||'')) update.name=row.name;
      if(row.sku!==String(row.p.sku||'')){ update.sku=row.sku; update.skuKey=normalizeSkuKey(row.sku); }
      if(row.category!==String(row.p.category||'')) update.category=row.category;
      if(row.uploadedPhoto){ update.photo=row.uploadedPhoto.url; update.photoPath=row.uploadedPhoto.path; }
      else if(row.removePhoto){ update.photo=''; update.photoPath=''; }
      batch.update(productRef(row.id),update);
    });
    const logDoc=doc(logRef()), auditDoc=doc(auditRef());
    const productIds=rows.map(r=>r.id), productNames=rows.map(r=>r.name);
    const changesByProduct=rows.map(r=>({productId:r.id,productName:r.name,changes:r.changes}));
    const detail=`แก้ไขสินค้า ${rows.length} รายการพร้อมกัน`;
    const common={productId:'',productIds,productNames,bulkBatchId,bulkEdit:true,bulkCount:rows.length,bulkPhotoCount:rows.filter(r=>r.imageData||r.removePhoto).length,changesByProduct};
    batch.set(logDoc,logPayload('แก้ไขสินค้าหลายรายการ',detail,common));
    batch.set(auditDoc,auditPayload('แก้ไขสินค้าหลายรายการ',detail,{...common,logId:logDoc.id}));
    await batch.commit();
    const oldPaths=rows.filter(r=>(r.uploadedPhoto||r.removePhoto)&&r.p.photoPath).map(r=>String(r.p.photoPath));
    Promise.allSettled(oldPaths.map(path=>deleteObject(storageRef(storage,path)))).then(results=>{
      const failed=results.filter(r=>r.status==='rejected' && r.reason?.code!=='storage/object-not-found').length;
      if(failed) console.warn('ลบรูปสินค้าเก่าหลังแก้หลายรายการไม่สำเร็จบางส่วน',failed);
    });
    rows.forEach(r=>refreshPublicProductPreviewQuietly(r.id));
    bulkEditProductImages.clear(); bulkEditPhotoRemovals.clear(); bulkEditSelectedIds.clear();
    hideModal(); toast(`แก้ไขสินค้า ${rows.length} รายการเรียบร้อย`);
  }catch(e){
    console.error('แก้ไขสินค้าหลายรายการไม่สำเร็จ',e);
    await Promise.allSettled(uploadedNewPaths.map(path=>deleteObject(storageRef(storage,path))));
    if(e?.code==='permission-denied') toast('ไม่มีสิทธิ์แก้ไขสินค้า กรุณาตรวจสิทธิ์ผู้ใช้');
    else toast(e?.message||'แก้ไขสินค้าหลายรายการไม่สำเร็จ');
  }finally{ endActionLock(lockKey,'saveBulkProductEditsBtn'); }
};

window.editProduct=(id)=>{ if(!requireManager()) return; const p=state.products.find(x=>x.id===id); if(!p) return toast('ไม่พบสินค้า'); if(!canAccessProduct(p)) return toast('คุณไม่มีสิทธิ์แก้ไขสินค้านี้'); openModal('แก้ไขสินค้า',`
  <label class="field-label" for="pn">ชื่อสินค้า</label>
  <span class="field-hint">ชื่อที่จะแสดงในรายการ Stock เช่น ถุงใส่แก้วกาแฟคู่</span>
  <input id="pn" value="${escapeHtml(p.name)}" placeholder="เช่น ถุงใส่แก้วกาแฟคู่">

  <label class="field-label" for="ps">รหัสสินค้า / รหัสสั่งซื้อ (SKU)</label>
  <span class="field-hint">รหัสอ้างอิง ไม่บังคับ • ใช้รหัสเดียวกับสินค้าอื่นได้ หากเป็นสินค้าคนละชนิด</span>
  <input id="ps" value="${escapeHtml(p.sku||'')}" placeholder="ไม่บังคับ" oninput="window.validateSkuField('${id}')" onblur="window.validateSkuField('${id}')">
  <div id="skuInlineError" class="sku-inline-error hidden" role="alert"></div>

  <label class="field-label" for="pc">หมวดหมู่</label>
  <span class="field-hint">ใช้จัดกลุ่มสินค้า เช่น บรรจุภัณฑ์, วัตถุดิบ, อุปกรณ์</span>
  <input id="pc" value="${escapeHtml(p.category||'')}" placeholder="เช่น บรรจุภัณฑ์">

  ${stockLocationSelectorsMarkup('editProduct',p)}

  <label class="field-label" for="pu">หน่วยนับ</label>
  <span class="field-hint">หน่วยที่ใช้นับสต๊อก เช่น แพ็ค, ชิ้น, กระป๋อง, ใบ</span>
  <input id="pu" value="${escapeHtml(p.unit||'')}" placeholder="เช่น แพ็ค">

  <label class="field-label" for="pm">จุดเตือนสต๊อกต่ำ</label>
  <span class="field-hint">ระบบจะแจ้งเตือน "ใกล้หมด" เมื่อคงเหลือน้อยกว่าหรือเท่ากับจำนวนนี้ ใส่ 0 หากไม่ต้องการเตือน</span>
  <input id="pm" type="number" value="${p.min||0}" placeholder="เช่น 5">

  ${expiryFormMarkup(p)}

  <button id="saveEditProductBtn" class="btn primary full" onclick="window.saveEditProduct('${id}')">บันทึก</button>
  <button class="btn red full" onclick="window.deleteProduct('${id}')">🗑️ ลบสินค้า (ย้ายไปถังขยะ)</button>
`); };
window.saveEditProduct=async(id)=>{
  const lockKey=`saveEditProduct:${id}`;
  if(!beginActionLock(lockKey,'saveEditProductBtn','กำลังบันทึก...')) return;
  const p=state.products.find(x=>x.id===id);
  const sku=$('ps').value.trim();
  const name=$('pn').value.trim();
  const category=$('pc').value;
  const unit=$('pu').value;
  const min=Number($('pm').value)||0;
  const stockLoc=collectStockLocationForm('editProduct');
  if(!canAccessStockLocation(stockLoc.stockGroupId,stockLoc.stockAreaId)){ endActionLock(lockKey,'saveEditProductBtn'); return toast('คุณไม่มีสิทธิ์ย้ายสินค้าไปพื้นที่นี้'); }
  let expiry; try{ expiry=readExpiryForm(); }catch(e){ endActionLock(lockKey,'saveEditProductBtn'); return toast(e.message); }
  const FIELD_LABELS={name:'ชื่อสินค้า',sku:'รหัสสินค้า (SKU)',category:'หมวดหมู่',unit:'หน่วยนับ',min:'จุดเตือนสต๊อกต่ำ',hasExpiry:'มีวันหมดอายุ',expiryDate:'วันหมดอายุ',expiryReminderDays:'แจ้งเตือนล่วงหน้า',stockGroupName:'กลุ่มสต๊อก',stockAreaName:'พื้นที่สต๊อก'};
  const before={name:p.name||'',sku:p.sku||'',category:p.category||'',unit:p.unit||'',min:p.min||0,hasExpiry:!!p.hasExpiry,expiryDate:p.expiryDate||'',expiryReminderDays:p.hasExpiry?getExpiryReminderDays(p):0,stockGroupName:productStockLocation(p).stockGroupName,stockAreaName:productStockLocation(p).stockAreaName};
  const after={name,sku,category,unit,min,...expiry,...stockLoc};
  const changes=[];
  for(const key of Object.keys(FIELD_LABELS)){
    const oldVal=before[key], newVal=after[key];
    if(String(oldVal)!==String(newVal)) changes.push(`${FIELD_LABELS[key]}: "${oldVal||'-'}" → "${newVal||'-'}"`);
  }
  if(!changes.length){ endActionLock(lockKey,'saveEditProductBtn'); return toast('ไม่มีการเปลี่ยนแปลงข้อมูล'); }
  const eventId=makeEventId('PRODUCT'),logDoc=doc(logRef()),auditDoc=doc(auditRef());
  try{
    await runTransaction(fs,async tx=>{
      const newKey=normalizeSkuKey(sku),oldKey=normalizeSkuKey(p.sku||'');
      let oldRegRef=null,oldRegSnap=null;
      if(oldKey && oldKey!==newKey){ oldRegRef=skuRegistryDocRef(p.sku||''); oldRegSnap=await tx.get(oldRegRef); }
      tx.update(productRef(id),{name,sku,skuKey:newKey,category,unit,min,...expiry,...stockLoc,updatedAt:serverTimestamp()});
      // skuRegistry เป็นข้อมูล legacy จากรุ่นที่บังคับ SKU ไม่ซ้ำ: ลบเฉพาะ mapping ของสินค้านี้เมื่อเปลี่ยนรหัส
      if(oldRegRef && oldRegSnap?.exists() && oldRegSnap.data()?.productId===id) tx.delete(oldRegRef);
      tx.set(logDoc,logPayload('แก้ไขสินค้า',name,{productId:id,changes,eventId}));
      tx.set(auditDoc,auditPayload('แก้ไขสินค้า',name,{productId:id,changes,eventId,logId:logDoc.id}));
    });
    refreshPublicProductPreviewQuietly(id);
    hideModal(); toast('แก้ไขสินค้าแล้ว');
  }catch(e){ console.error(e); toast(e?.message||'แก้ไขสินค้าไม่สำเร็จ'); }
  finally{ endActionLock(lockKey,'saveEditProductBtn'); }
};window.deleteProduct=async(id)=>{
  if(!requireManager()) return;
  if(state.approvals.some(a=>a.productId===id)) return toast('มีรายการรอตรวจ ลบไม่ได้');
  if(!confirm('ย้ายสินค้านี้ไปถังขยะ? (กู้คืนได้ทีหลังในหน้าโปรไฟล์)')) return;

  const p=state.products.find(x=>x.id===id);
  if(!p) return toast('ไม่พบสินค้า');

  const lockKey=`deleteProduct:${id}`;
  if(!beginActionLock(lockKey,null)) return;
  try{
    await updateDoc(productRef(id),{
      trashed:true,
      trashedAt:serverTimestamp(),
      updatedAt:serverTimestamp()
    });
    await addLog('ย้ายไปถังขยะ',p.name,{productId:id});
    await revokePublicProductPreview(id,'trashed');

    // v34.15.7: อัปเดตหน้าจอทันทีและกลับหน้าสต๊อกหลัก
    // ไม่ต้องรอ Firestore listener เพื่อป้องกันการ์ดสินค้าค้างบนหน้ารายละเอียด
    p.trashed=true;
    p.trashedAt={seconds:Math.floor(Date.now()/1000)};
    state.viewProductId=null;
    state.page='stock';
    hideModal();
    render();
    toast('ย้ายไปถังขยะแล้ว กู้คืนได้ในโปรไฟล์');
  }catch(e){
    console.error('deleteProduct failed',e);
    toast(e?.message||'ย้ายไปถังขยะไม่สำเร็จ');
  }finally{
    endActionLock(lockKey,null);
  }
};
window.archiveProduct=async(id)=>{ if(!requireManager()) return; if(state.approvals.some(a=>a.productId===id)) return toast('มีรายการรอตรวจ Archive ไม่ได้'); const p=state.products.find(x=>x.id===id); await updateDoc(productRef(id),{archived:true,updatedAt:serverTimestamp()}); await addLog('Archive',p.name,{productId:id}); await revokePublicProductPreview(id,'archived'); toast('Archive แล้ว และปิด QR Preview สาธารณะ'); };

window.stockMove=(id,type)=>{ const p=state.products.find(x=>x.id===id); if(!p) return; if(!canAccessProduct(p)) return toast('คุณไม่มีสิทธิ์ทำรายการสินค้าบ้านนี้'); if(type==='out'&&!confirmExpiredIssue(p)) return; state.tempMoveImage=null; const locationHtml=scanFixedProductLocationMarkup(p,type); const destHtml=type==='out'?issueDestinationPickerMarkup('moveDestination','moveDestinationOther','',productStockLocation(p).stockGroupId):'';
  openModal(type==='in'?'รับเข้า':'เบิกออก',`<p><b>${escapeHtml(p.name)}</b></p><input id="qty" type="number" placeholder="จำนวน">${locationHtml}${destHtml}<textarea id="reason" placeholder="เหตุผล/หมายเหตุ"></textarea><input id="movePhotoInput" type="file" accept="image/*" class="hidden"><button class="btn light full" onclick="movePhotoInput.click()">📷 แนบรูป (ไม่บังคับ)</button><div id="movePhotoPreview"></div><button id="applyStockBtn" data-action-lock="applyStock:${escapeHtml(id)}:${escapeHtml(type)}" class="btn primary full" onclick="window.applyStock('${id}','${type}')">ยืนยัน</button>`);
  $('movePhotoInput').onchange = async (e)=>{ const f=e.target.files[0]; if(!f) return; state.tempMoveImage = await compressImage(f); $('movePhotoPreview').innerHTML = `<img class="preview" src="${state.tempMoveImage}" style="max-height:160px">`; };
};
window.applyStock=async(id,type)=>{
  const q=Number($('qty').value)||0;
  if(q<=0) return toast('จำนวนไม่ถูกต้อง');
  const reason=($('reason').value||'').trim();
  const productForLocation=state.products.find(x=>x.id===id)||{};
  if(!canAccessProduct(productForLocation)) return toast('คุณไม่มีสิทธิ์ทำรายการสินค้าบ้านนี้');
  const stockLocation=scanProductLocationLabel(productForLocation);
  const destinationLocation=type==='out'?getIssueDestinationValue('moveDestination','moveDestinationOther'):'';
  if(type==='out' && !destinationLocation) return toast('เลือกสถานที่เบิกไปใช้');
  const location=type==='out'?destinationLocation:stockLocation;
  const lockKey=`applyStock:${id}:${type}`;
  if(!beginActionLock(lockKey,'applyStockBtn',type==='out'?'กำลังเบิกสินค้า...':'กำลังรับสินค้า...')) return;
  try{
    await runTransaction(fs,async tx=>{
      const ref=productRef(id),snap=await tx.get(ref);
      if(!snap.exists()) throw new Error('ไม่พบสินค้า');
      const p=snap.data(),current=Number(p.stock)||0;
      if(type==='out'&&q>current) throw new Error('เบิกเกินสต๊อก');
      const newStock=type==='in'?current+q:current-q;
      const eventId=makeEventId(type==='in'?'IN':'OUT');
      const action=type==='in'?'รับเข้า':'เบิกออก';
      const detail=`${p.name||''} ${q} ${p.unit||''}${reason?' • '+reason:''}`;
      const extra={productId:id,qty:q,unit:p.unit||'',photo:state.tempMoveImage||'',location,stockLocation,destinationLocation,issueDestination:destinationLocation,moveType:type,previousStock:current,newStock,eventId,...productStockLocationExtra(p)};
      const logDoc=doc(logRef()),auditDoc=doc(auditRef());
      tx.update(ref,{stock:newStock,updatedAt:serverTimestamp()});
      tx.set(logDoc,logPayload(action,detail,extra));
      tx.set(auditDoc,auditPayload(action,detail,{...extra,logId:logDoc.id}));
    });
    refreshPublicProductPreviewQuietly(id);
    state.tempMoveImage=null; hideModal(); toast('บันทึกสต๊อกและประวัติแล้ว');
  }catch(e){ console.error(e); toast(e?.message||'บันทึกสต๊อกไม่สำเร็จ'); }
  finally{ endActionLock(lockKey,'applyStockBtn'); }
};

function getActiveProductsForSearch(){
  const selected=getScanSelectedStockLocation();
  return accessibleProducts(state.products.filter(p=>!p.archived && !p.trashed))
    .filter(p=>productMatchesScanLocation(p,selected))
    .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'th'));
}
function scanProductSearchText(p){
  return [p.name,p.sku,p.category,p.unit,scanProductLocationLabel(p)]
    .map(v=>String(v||'').toLowerCase())
    .join(' ');
}
function renderScanProductResults(queryText=''){
  const box=$('scanProductResults');
  if(!box) return;
  const q=String(queryText||'').trim().toLowerCase();
  const products=getActiveProductsForSearch();
  const matches=(q ? products.filter(p=>scanProductSearchText(p).includes(q)) : products).slice(0,12);
  if(!matches.length){
    box.innerHTML='<div class="muted" style="padding:12px">ไม่พบสินค้าในบ้าน/พื้นที่ที่เลือก</div>';
    box.classList.remove('hidden');
    return;
  }
  box.innerHTML=matches.map(p=>`<button type="button" class="scan-product-result" onclick="window.selectScanProduct('${p.id}')">
    ${p.photo?`<img src="${p.photo}" alt="">`:`<span class="scan-product-result-icon">📦</span>`}
    <span class="scan-product-result-main">
      <b>${escapeHtml(p.name)}</b>
      <small>${escapeHtml(scanProductLocationLabel(p))} • คงเหลือ ${Number(p.stock)||0} ${escapeHtml(p.unit||'')}</small>
    </span>
  </button>`).join('');
  box.classList.remove('hidden');
}
window.searchScanProducts=(value)=>{
  const hidden=$('scanProduct');
  if(hidden) hidden.value='';
  const selected=$('scanProductSelected');
  if(selected) selected.innerHTML='';
  renderScanProductResults(value);
};
window.openScanProductResults=()=>{
  renderScanProductResults($('scanProductSearch')?.value||'');
};
window.selectScanProduct=(id)=>{
  const p=state.products.find(x=>x.id===id);
  if(!p) return;
  if(!canAccessProduct(p) || !productMatchesScanLocation(p)) return toast('สินค้านี้ไม่ได้อยู่ในบ้าน/พื้นที่ที่เลือก หรือคุณไม่มีสิทธิ์');
  $('scanProduct').value=id;
  $('scanProductSearch').value=p.name||'';
  $('scanProductResults').classList.add('hidden');
  const expiryStatus=getExpiryStatus(p);
  $('scanProductSelected').innerHTML=`<div class="scan-selected-product"><span>✅ เลือกแล้ว</span><b>${escapeHtml(p.name)}</b><small>📍 ${escapeHtml(scanProductLocationLabel(p))} • คงเหลือ ${Number(p.stock)||0} ${escapeHtml(p.unit||'')}</small>${expiryStatus.active?`<div class="scan-expiry-warning ${expiryStatus.className}">⏰ ${escapeHtml(expiryStatus.label)} • ${escapeHtml(expiryDateLabel(p))}</div>`:''}</div>`;
  renderScanLotSection(p);
  const unitLabel=$('newItemUnitLabel');
  if(unitLabel) unitLabel.textContent=p.unit||'หน่วย';
  saveNewItemDraft();
  $('scanQty')?.focus();
};

function getNewItemDraftFromForm(){
  const productId=$('scanProduct')?.value||'';
  const productSearch=$('scanProductSearch')?.value||'';
  const qty=$('scanQty')?.value||'';
  const note=($('scanNote')?.value||'');
  const destination=getIssueDestinationValue();
  const type=state.newItemType||$('scanType')?.value||'out';
  const selected=getScanSelectedStockLocation();
  const hasData=Boolean(productId||productSearch.trim()||qty||note.trim()||destination||state.selectedImage);
  return {hasData,productId,productSearch,qty,note,destination,type,scanGroupId:selected.stockGroupId,scanAreaId:selected.stockAreaId,image:state.selectedImage||'',savedAt:Date.now()};
}
function saveNewItemDraft(){
  if(restoringNewItemDraft) return;
  const draft=getNewItemDraftFromForm();
  if(draft.hasData) localStorage.setItem(NEW_ITEM_DRAFT_KEY,JSON.stringify(draft));
  else localStorage.removeItem(NEW_ITEM_DRAFT_KEY);
}
function readNewItemDraft(){
  try{ return JSON.parse(localStorage.getItem(NEW_ITEM_DRAFT_KEY)||'null'); }catch{return null;}
}
function clearNewItemDraft(){ localStorage.removeItem(NEW_ITEM_DRAFT_KEY); }
function applyNewItemDraft(draft){
  if(!draft) return;
  restoringNewItemDraft=true;
  state.newItemType=draft.type==='in'?'in':'out';
  state.selectedImage=draft.image||null;
  if(draft.scanGroupId) state.scanGroupId=draft.scanGroupId;
  if(draft.scanAreaId) state.scanAreaId=draft.scanAreaId;
  renderScan();
  const g=$('scanStockGroup'); if(g&&state.scanGroupId) g.value=state.scanGroupId;
  const a=$('scanStockArea'); if(a&&state.scanAreaId) a.value=state.scanAreaId;
  const p=state.products.find(x=>x.id===draft.productId);
  if(p && canAccessProduct(p) && productMatchesScanLocation(p)){
    const hidden=$('scanProduct'); if(hidden) hidden.value=p.id;
    const search=$('scanProductSearch'); if(search) search.value=p.name||draft.productSearch||'';
    const selected=$('scanProductSelected');
    if(selected){
      const expiryStatus=getExpiryStatus(p);
      selected.innerHTML=`<div class="scan-selected-product"><span>✅ เลือกแล้ว</span><b>${escapeHtml(p.name)}</b><small>📍 ${escapeHtml(scanProductLocationLabel(p))} • คงเหลือ ${Number(p.stock)||0} ${escapeHtml(p.unit||'')}</small>${expiryStatus.active?`<div class="scan-expiry-warning ${expiryStatus.className}">⏰ ${escapeHtml(expiryStatus.label)} • ${escapeHtml(expiryDateLabel(p))}</div>`:''}</div>`;
    }
    renderScanLotSection(p);
    const unitLabel=$('newItemUnitLabel'); if(unitLabel) unitLabel.textContent=p.unit||'หน่วย';
  }else if($('scanProductSearch')) $('scanProductSearch').value=draft.productSearch||'';
  if($('scanIssueDestination') && draft.destination){
    const known=issueDestinationsForGroup(state.scanGroupId).includes(draft.destination);
    $('scanIssueDestination').value=known?draft.destination:'อื่นๆ';
    window.toggleLocationOther('scanIssueDestination','scanIssueDestinationOther');
    if(!known && $('scanIssueDestinationOther')) $('scanIssueDestinationOther').value=draft.destination;
  }
  if($('scanQty')) $('scanQty').value=draft.qty||'';
  if($('scanNote')) $('scanNote').value=draft.note||'';
  restoringNewItemDraft=false;
  toast('กู้คืนข้อมูลที่ยังไม่บันทึกแล้ว');
}
function maybePromptNewItemDraft(){
  if(newItemDraftPromptChecked) return;
  newItemDraftPromptChecked=true;
  const draft=readNewItemDraft();
  if(!draft?.hasData) return;
  setTimeout(()=>{
    const continueDraft=window.confirm('พบข้อมูลเบิก/รับสินค้าที่ยังไม่ได้บันทึก\nต้องการกลับไปทำรายการต่อหรือไม่?');
    if(continueDraft) applyNewItemDraft(draft); else clearNewItemDraft();
  },120);
}
function bindNewItemDraftListeners(){
  ['scanProductSearch','scanQty','scanNote','scanStockGroup','scanStockArea','scanIssueDestination','scanIssueDestinationOther'].forEach(id=>{
    const el=$(id); if(!el) return;
    el.addEventListener('input',saveNewItemDraft);
    el.addEventListener('change',saveNewItemDraft);
  });
}

function renderScan(){
  const currentType=state.newItemType||'out';
  const isOut=currentType==='out';

  view.innerHTML=`<div class="between">
      <h1>เบิก/รับสินค้า</h1>
      <button class="btn small" onclick="window.goToPage('home')">← กลับ</button>
    </div>

    <div class="new-item-tabs" role="tablist">
      <button type="button" class="new-item-tab ${isOut?'active out':'out'}" onclick="window.setNewItemType('out')">↑ เบิกสินค้า</button>
      <button type="button" class="new-item-tab ${!isOut?'active in':'in'}" onclick="window.setNewItemType('in')">↓ รับสินค้า</button>
    </div>

    <section class="card new-item-form-card">
      <div class="new-item-section-title">${isOut?'สินค้าที่ต้องการเบิก':'สินค้าที่ต้องการรับเข้า'}</div>

      ${scanStockLocationSelectorMarkup(currentType)}
      ${isOut?issueDestinationPickerMarkup('scanIssueDestination','scanIssueDestinationOther','',state.scanGroupId):''}

      <div class="scan-product-search-wrap">
        <input id="scanProductSearch"
          class="new-item-input"
          placeholder="🔍 ค้นหาสินค้า หรือพิมพ์ชื่อ / SKU"
          autocomplete="off"
          onfocus="window.openScanProductResults()"
          oninput="window.searchScanProducts(this.value)">
        <input id="scanProduct" type="hidden" value="">
        <div id="scanProductResults" class="scan-product-results hidden"></div>
        <div id="scanProductSelected"></div>
      </div>
      <div id="scanLotSection"></div>

      <label class="new-item-label" for="scanQty">จำนวน</label>
      <div class="new-item-qty-wrap">
        <input id="scanQty" class="new-item-input" type="number" min="1" inputmode="numeric" placeholder="ระบุจำนวน">
        <span id="newItemUnitLabel" class="new-item-unit">หน่วย</span>
      </div>

      <div id="scanLocationSection"></div>

      <label class="new-item-label" for="scanNote">หมายเหตุ <span class="muted">(ถ้ามี)</span></label>
      <textarea id="scanNote" class="new-item-input new-item-note" placeholder="ระบุหมายเหตุเพิ่มเติม (ถ้ามี)"></textarea>

      <details class="new-item-attachment">
        <summary>📷 แนบรูปหลักฐาน <span class="muted">(ไม่บังคับ)</span></summary>
        <div class="new-item-attachment-body">
          <p class="muted" style="margin-top:0">ใช้สำหรับแนบรูปสินค้าหรือเอกสารประกอบรายการ</p>
          <div class="grid">
            <button type="button" class="btn primary" onclick="cameraInput.click()">📷 ถ่ายรูป</button>
            <button type="button" class="btn" onclick="photoInput.click()">🖼️ เลือกจากคลังรูป</button>
          </div>
          ${state.selectedImage?`<img class="preview" src="${state.selectedImage}" alt="รูปหลักฐานที่แนบ">`:''}
        </div>
      </details>

      <button id="sendApprovalBtn" data-action-lock="sendApproval" type="button" class="new-item-submit ${isOut?'out':'in'}" onclick="window.sendApproval()">
        ${isOut?'✈ ส่งคำขอเบิกสินค้า':'✓ ส่งคำขอรับสินค้า'}
      </button>
    </section>

    <div class="new-item-info">
      ℹ️ คำขอของคุณจะถูกส่งเพื่อรอการอนุมัติ และสามารถแก้ไขหรือยกเลิกได้ก่อนอนุมัติ
    </div>`;

  // Keep type in a hidden field for existing sendApproval logic.
  const hiddenType=document.createElement('select');
  hiddenType.id='scanType';
  hiddenType.className='hidden';
  hiddenType.innerHTML=`<option value="out">เบิกออก</option><option value="in">รับเข้า</option>`;
  hiddenType.value=currentType;
  view.appendChild(hiddenType);
  bindNewItemDraftListeners();
  maybePromptNewItemDraft();
}

window.setNewItemType=(type)=>{
  saveNewItemDraft();
  state.newItemType=type==='in'?'in':'out';
  saveUiState();
  renderScan();
  const draft=readNewItemDraft(); if(draft) applyNewItemDraft({...draft,type:state.newItemType});
};

window.updateScanLocation=()=>window.updateScanStockLocation?.();
['cameraInput','photoInput'].forEach(id=>$(id).onchange=async e=>{ const f=e.target.files[0]; if(!f) return; const existing=getNewItemDraftFromForm(); state.selectedImage = await compressImage(f); e.target.value=''; localStorage.setItem(NEW_ITEM_DRAFT_KEY,JSON.stringify({...existing,image:state.selectedImage,hasData:true,savedAt:Date.now()})); renderScan(); applyNewItemDraft(readNewItemDraft()); toast('เลือกรูปแล้ว (บีบอัดอัตโนมัติ)'); });
// ส่งตรวจ: เก็บ logId ไว้ในตัว approval เพื่อไปอัปเดตสถานะ log เดิมตอนอนุมัติ/ปฏิเสธ แทนการสร้าง log ใหม่ซ้ำซ้อน
window.sendApproval=async()=>{
  const lockKey='sendApproval';
  if(!beginActionLock(lockKey,'sendApprovalBtn','กำลังส่งคำขอ...')) return;
  const productId=$('scanProduct')?.value||'';
  const qty=Number($('scanQty')?.value)||0;
  const type=state.newItemType||$('scanType')?.value||'out';
  const selectedScanLoc=getScanSelectedStockLocation();
  const note=($('scanNote')?.value||'').trim();
  if(!productId){ endActionLock(lockKey,'sendApprovalBtn'); return toast('เลือกสินค้าก่อน'); }
  if(qty<=0){ endActionLock(lockKey,'sendApprovalBtn'); return toast('กรอกจำนวน'); }
  const p=state.products.find(x=>x.id===productId);
  if(!p){ endActionLock(lockKey,'sendApprovalBtn'); return toast('ไม่พบสินค้า'); }
  if(!canAccessProduct(p) || !productMatchesScanLocation(p,selectedScanLoc)){ endActionLock(lockKey,'sendApprovalBtn'); return toast('สินค้านี้ไม่ได้อยู่ในบ้าน/พื้นที่ที่เลือก หรือคุณไม่มีสิทธิ์'); }
  const stockLocation=scanProductLocationLabel(p);
  const destinationLocation=type==='out'?getIssueDestinationValue():'';
  if(type==='out' && !destinationLocation){ endActionLock(lockKey,'sendApprovalBtn'); return toast('เลือกสถานที่เบิกไปใช้'); }
  const location=type==='out'?destinationLocation:stockLocation;
  if(type==='out'&&qty>Number(p.stock)){ endActionLock(lockKey,'sendApprovalBtn'); return toast('เบิกเกินสต๊อก'); }
  const lots=activeProductLots(p);
  const lotNames=lotDisplayMap(p);
  let lotId='',lotNo='',lotExpiryDate='',fefoCorrect=true,fefoOverrideReason='';
  let expectedLotId='',expectedLotNo='',expectedLotExpiryDate='';
  if(type==='out'){
    lotId=$('scanLot')?.value||lots[0]?.id||''; const selectedLot=lots.find(l=>l.id===lotId);
    const recommendedLot=lots[0]||null;
    if(!selectedLot){ endActionLock(lockKey,'sendApprovalBtn'); return toast('ไม่พบล็อตที่ต้องการเบิก'); }
    if(qty>Number(selectedLot.qty)){ endActionLock(lockKey,'sendApprovalBtn'); return toast('จำนวนเกินยอดคงเหลือของล็อตที่เลือก'); }
    lotNo=lotNames.get(selectedLot.id)||selectedLot.lotNo; lotExpiryDate=selectedLot.expiryDate||''; fefoCorrect=lotId===recommendedLot?.id;
    if(!fefoCorrect && recommendedLot){ expectedLotId=recommendedLot.id||''; expectedLotNo=lotNames.get(recommendedLot.id)||recommendedLot.lotNo||recommendedLot.id||''; expectedLotExpiryDate=recommendedLot.expiryDate||''; }
    if(!fefoCorrect){ fefoOverrideReason=window.prompt('คุณเลือกล็อตที่ไม่ใช่ล็อตแรกตาม FEFO\nกรุณาระบุเหตุผล')||''; if(!fefoOverrideReason.trim()){ endActionLock(lockKey,'sendApprovalBtn'); return toast('กรุณาระบุเหตุผลที่ไม่เบิกล็อตแรก'); } }
  }else{
    lotExpiryDate=$('scanLotExpiry')?.value||''; lotNo=($('scanLotNo')?.value||'').trim()||generateLotNo(p,lotExpiryDate); lotId=makeEventId('LOT');
  }
  if(type==='out'&&!confirmExpiredIssue({...p,hasExpiry:!!lotExpiryDate,expiryDate:lotExpiryDate,lots:[]})){ endActionLock(lockKey,'sendApprovalBtn'); return; }
  const eventId=makeEventId('REQ');
  const detail=`${type==='out'?'เบิก':'รับ'} ${p.name} ${qty} ${p.unit}${note?` • ${note}`:''}`;
  const logDoc=doc(logRef()),approvalDoc=doc(userPath('approvals')),auditDoc=doc(auditRef());
  const batch=writeBatch(fs);
  const common={productId,qty,unit:p.unit,photo:state.selectedImage||'',location,stockLocation,destinationLocation,issueDestination:destinationLocation,moveType:type,note,eventId,lotId,lotNo,lotExpiryDate,fefoCorrect,fefoOverrideReason,expectedLotId,expectedLotNo,expectedLotExpiryDate,...productStockLocationExtra(p)};
  if(!fefoCorrect){ Object.assign(common,{fefoAckRequired:true,fefoAcknowledged:false,fefoAcknowledgedAt:'',fefoAcknowledgedByUid:'',fefoAcknowledgedByName:''}); }
  batch.set(logDoc,logPayload('ส่งตรวจ',detail,{...common,status:'pending',approvalId:approvalDoc.id}));
  batch.set(approvalDoc,{productId,name:p.name,qty,unit:p.unit,type,location,stockLocation,destinationLocation,issueDestination:destinationLocation,note,lotId,lotNo,lotExpiryDate,fefoCorrect,fefoOverrideReason,expectedLotId,expectedLotNo,expectedLotExpiryDate,...productStockLocationExtra(p),img:state.selectedImage||'',confidence:state.selectedImage?60:0,status:'pending',fefoAckRequired:!fefoCorrect,fefoAcknowledged:fefoCorrect?true:false,fefoAcknowledgedAt:'',fefoAcknowledgedByUid:'',fefoAcknowledgedByName:'',logId:logDoc.id,eventId,submittedByUid:state.user?.uid||'',submittedByName:state.profile?.displayName||state.profile?.username||'',submittedByPhoto:state.profile?.photoURL||'',createdAt:serverTimestamp()});
  batch.set(auditDoc,auditPayload('ส่งตรวจ',detail,{...common,approvalId:approvalDoc.id,logId:logDoc.id,eventId}));
  try{
    await batch.commit();
    state.selectedImage=null; clearNewItemDraft(); renderScan(); toast('ส่งคำขอรออนุมัติแล้ว');
  }catch(e){ console.error(e); toast('ส่งรายการไม่สำเร็จ และไม่มีข้อมูลบางส่วนถูกบันทึก'); }
  finally{ endActionLock(lockKey,'sendApprovalBtn'); }
};
function renderApproval(){
  const canReview=canApprove();
  const baseApprovalList=accessibleApprovals(state.approvals);
  if(!['all','in','out'].includes(state.approvalFilter)) state.approvalFilter='all';
  const approvalCounts={
    all:baseApprovalList.length,
    in:baseApprovalList.filter(a=>a.type==='in').length,
    out:baseApprovalList.filter(a=>a.type==='out').length
  };
  const approvalList=state.approvalFilter==='all'?baseApprovalList:baseApprovalList.filter(a=>a.type===state.approvalFilter);
  const heading=canReview?'รายการรออนุมัติ':'รายการของฉัน';
  const note=canReview
    ? 'คุณสามารถตรวจสอบ แก้ไข อนุมัติ หรือปฏิเสธรายการได้'
    : 'คุณสามารถตรวจสอบ แก้ไข หรือยกเลิกรายการของตัวเองได้ แต่ไม่มีสิทธิ์อนุมัติ';
  const filterBtn=(filter,label,icon)=>`<button type="button" class="approval-filter-chip ${state.approvalFilter===filter?'active':''}" onclick="window.setApprovalFilter('${filter}')"><span>${escapeHtml(icon)} ${escapeHtml(label)}</span><b>${approvalCounts[filter]||0}</b></button>`;
  const emptyText=baseApprovalList.length?'ไม่มีรายการรออนุมัติประเภทนี้':'ไม่มีรายการรออนุมัติ';

  view.innerHTML=`<div class="between approval-page-head">
      <h1>${heading}</h1>
      <button class="btn small" onclick="window.goToPage('home')">← กลับ</button>
    </div>
    <div class="card note">${note}</div>
    <div class="approval-filter-wrap">
      ${filterBtn('all','ทั้งหมด','📋')}
      ${filterBtn('in','รับเข้า','↓')}
      ${filterBtn('out','เบิกออก','↑')}
    </div>
    ${approvalList.map(a=>{
      const own=isOwnApproval(a);
      return `<div class="card approval-card">
        <div class="approval-head">
          <div class="approval-title-wrap">
            <h2 class="approval-title">${escapeHtml(a.name)}</h2>
            <span class="pill ${a.type==='out'?'warn':'ok'} approval-type">${a.type==='out'?'↑ เบิกออก':'↓ รับเข้า'}</span>
          </div>
          ${canReview?'':`<span class="pill warn approval-status">รออนุมัติ</span>`}
        </div>

        ${canReview?`<div class="approval-sender-card">
          <div class="approval-sender-avatar">${a.submittedByPhoto?`<img src="${a.submittedByPhoto}" alt="ผู้ส่ง">`:'👤'}</div>
          <div class="approval-sender-copy">
            <span>ผู้ส่งรายการ</span>
            <b>${escapeHtml(a.submittedByName||'-')}</b>
          </div>
          <div class="approval-sender-status">
            <span>⏳ รออนุมัติ</span>
          </div>
        </div>`:''}

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
              <div class="approval-label">${a.type==='out'?'สถานที่เบิกไปใช้':'ตำแหน่งที่รับเข้า'}</div>
              <div class="approval-location-value">${escapeHtml(a.type==='out'?(approvalDestinationLabel(a)||'ไม่ระบุสถานที่เบิกไปใช้'):(a.location||approvalStockLocationLabel(a)||'ไม่ระบุตำแหน่ง'))}</div>
              ${a.type==='out'?`<div class="approval-location-sub">เบิกจาก ${escapeHtml(approvalStockLocationLabel(a))}</div>`:''}
            </div>
          </div>
        </div>

        ${a.img?`<img class="preview" src="${a.img}">`:''}

        ${canReview?`<div class="approval-actions">
          <button class="btn green" onclick="window.confirmApprove('${a.id}')">✓ อนุมัติ</button>
          <button class="btn" onclick="window.editApproval('${a.id}')">✎ แก้ไข</button>
          <button class="btn red" onclick="window.confirmReject('${a.id}')">✕ ปฏิเสธ</button>
        </div>`:(own?`<div class="approval-actions own-approval-actions">
          <button type="button" class="own-action-btn own-action-edit" onclick="window.editApproval('${a.id}')">
            <span class="own-action-icon">✎</span><span class="own-action-label">แก้ไขรายการ</span>
          </button>
          <button type="button" class="own-action-btn own-action-cancel" onclick="window.confirmCancelApproval('${a.id}')">
            <span class="own-action-icon">🗑</span><span class="own-action-label">ยกเลิกรายการ</span>
          </button>
        </div>`:'')}
      </div>`;
    }).join('')||`<div class="card" style="text-align:center"><p style="font-size:40px;margin:0 0 6px">✅</p><p class="muted" style="margin:0">${emptyText}</p></div>`}`;
}
window.setApprovalFilter=(filter)=>{ state.approvalFilter=['all','in','out'].includes(filter)?filter:'all'; saveUiState(); renderApproval(); };
function approvalDetailHtml(a, opts={}){
  const p = state.products.find(x=>x.id===a.productId);
  let stockLine = '';
  let expiryLine = '';
  if(a.type==='out' && p && isExpiredForIssue(p)){
    const expiryStatus=getExpiryStatus(p);
    expiryLine=`<div class="expiry-issue-warning ${expiryStatus.className}"><b>⚠️ ${escapeHtml(expiryStatus.label)}</b><span>วันหมดอายุ ${escapeHtml(expiryDateLabel(p))} กรุณาตรวจสอบก่อนอนุมัติการเบิก</span></div>`;
  }
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
    ${a.type==='out'?`<p class="muted" style="font-size:13px;margin:2px 0 0">📍 เบิกไปใช้ที่ ${escapeHtml(approvalDestinationLabel(a)||'ไม่ระบุ')}</p><p class="muted" style="font-size:13px;margin:2px 0 0">🏠 เบิกจาก ${escapeHtml(approvalStockLocationLabel(a))}</p>`:((a.location||approvalStockLocationLabel(a))?`<p class="muted" style="font-size:13px;margin:2px 0 0">📍 ${escapeHtml(a.location||approvalStockLocationLabel(a))}</p>`:'')}${a.lotNo?`<p class="muted" style="font-size:13px">📦 LOT ${escapeHtml(a.lotNo)} • หมดอายุ ${escapeHtml(lotDateLabel(a.lotExpiryDate))}${a.fefoCorrect===false?' • ⚠️ ไม่ใช่ล็อต FEFO':''}</p>`:''}
    ${a.img?`<img class="preview" src="${a.img}">`:''}
    ${expiryLine}
    ${stockLine}
  </div>`;
}
window.confirmApprove=(id)=>{ if(!requireApprover()) return; const a=state.approvals.find(x=>x.id===id); if(!a) return toast('ไม่พบรายการ'); if(!approvalAccessibleToUser(a)) return toast('คุณไม่มีสิทธิ์อนุมัติรายการนี้'); openModal('ยืนยันอนุมัติ', `${approvalDetailHtml(a,{showStockPreview:true})}<button id="confirmApproveBtn" data-action-lock="approve:${id}" class="btn green full" onclick="window.approve('${id}')">✅ ยืนยันอนุมัติ</button>`); };
window.confirmReject=(id)=>{ if(!requireApprover()) return; const a=state.approvals.find(x=>x.id===id); if(!a) return toast('ไม่พบรายการ'); if(!approvalAccessibleToUser(a)) return toast('คุณไม่มีสิทธิ์ปฏิเสธรายการนี้'); openModal('ยืนยันปฏิเสธ', `${approvalDetailHtml(a)}<button id="confirmRejectBtn" data-action-lock="reject:${id}" class="btn red full" onclick="window.reject('${id}')">✖️ ยืนยันปฏิเสธ</button>`); };
window.approve=async(id)=>{
  if(!requireApprover()) return;
  const lockKey=`approve:${id}`;
  if(!beginActionLock(lockKey,'confirmApproveBtn','กำลังอนุมัติ...')) return;
  const cached=state.approvals.find(x=>x.id===id);
  if(!cached){ endActionLock(lockKey,'confirmApproveBtn'); return toast('ไม่พบรายการ'); }
  try{
    await runTransaction(fs,async tx=>{
      const pRef=productRef(cached.productId),aRef=approvalRef(id);
      const [pSnap,aSnap]=await Promise.all([tx.get(pRef),tx.get(aRef)]);
      if(!pSnap.exists()) throw new Error('ไม่พบสินค้า');
      if(!aSnap.exists()) throw new Error('รายการนี้ถูกดำเนินการแล้ว');
      const a={id,...aSnap.data()},p=pSnap.data(),current=Number(p.stock)||0,qty=Number(a.qty)||0;
      const reviewerUid=state.user?.uid||'',reviewerName=state.profile?.displayName||state.profile?.username||'ไม่ทราบผู้ใช้';
      if(a.type==='out'&&qty>current) throw new Error('เบิกเกินสต๊อก');
      const newStock=a.type==='out'?current-qty:current+qty;
      const lots=normalizeProductLots(p);
      if(a.type==='out'){ const i=lots.findIndex(l=>l.id===a.lotId); if(i<0) throw new Error('ไม่พบล็อตที่เลือก'); if(qty>Number(lots[i].qty)) throw new Error('ยอดล็อตไม่เพียงพอ'); lots[i]={...lots[i],qty:Number(lots[i].qty)-qty}; }
      else lots.push({id:a.lotId||makeEventId('LOT'),lotNo:a.lotNo||generateLotNo(p,a.lotExpiryDate||''),qty,expiryDate:a.lotExpiryDate||'',receivedAt:new Date().toISOString(),receivedByUid:a.submittedByUid||reviewerUid||'',receivedByName:a.submittedByName||reviewerName||'',note:a.note||'',status:'active'});
      const eventId=a.eventId||makeEventId('APR');
      const detail=`${a.type==='out'?'เบิก':'รับ'} ${a.name} ${a.qty} ${a.unit}`;
      const stockLoc=productStockLocationExtra(p); const finalFields={action:'อนุมัติ',detail,time:new Date().toLocaleString('th-TH'),updatedAt:serverTimestamp(),location:a.location||stockLocationPath(stockLoc),stockLocation:a.stockLocation||stockLocationPath(stockLoc),destinationLocation:a.destinationLocation||a.issueDestination||(a.type==='out'?a.location:''),issueDestination:a.issueDestination||a.destinationLocation||(a.type==='out'?a.location:''),reviewerUid,reviewerName,submittedByUid:a.submittedByUid||'',submittedByName:a.submittedByName||'',productId:a.productId,qty:a.qty,unit:a.unit,moveType:a.type,photo:a.img||'',eventId,status:'approved',previousStock:current,newStock,lotId:a.lotId||'',lotNo:a.lotNo||'',lotExpiryDate:a.lotExpiryDate||'',fefoCorrect:a.fefoCorrect!==false,fefoOverrideReason:a.fefoOverrideReason||'',expectedLotId:a.expectedLotId||'',expectedLotNo:a.expectedLotNo||'',expectedLotExpiryDate:a.expectedLotExpiryDate||'',...stockLoc,fefoAckRequired:a.fefoCorrect===false,fefoAcknowledged:a.fefoAcknowledged===true,fefoAcknowledgedAt:a.fefoAcknowledgedAt||'',fefoAcknowledgedByUid:a.fefoAcknowledgedByUid||'',fefoAcknowledgedByName:a.fefoAcknowledgedByName||''};
      // Firestore requires every transaction read to happen before the first write.
      // Resolve the legacy/history log first, then perform all writes atomically.
      let logId=a.logId||'';
      let lRef=null,lSnap=null;
      if(logId){ lRef=logDocRef(logId); lSnap=await tx.get(lRef); }
      tx.update(pRef,{stock:newStock,lots,expiryDate:(earliestProductLot({...p,lots})||{}).expiryDate||'',hasExpiry:lots.some(l=>!!l.expiryDate),updatedAt:serverTimestamp()});
      if(logId && lSnap?.exists()) tx.update(lRef,finalFields);
      else { const fallback=doc(logRef()); logId=fallback.id; tx.set(fallback,logPayload('อนุมัติ',detail,finalFields)); }
      const auditDoc=doc(auditRef());
      tx.set(auditDoc,auditPayload('อนุมัติ',detail,{...finalFields,approvalId:id,logId,eventId}));
      tx.delete(aRef);
    });
    refreshPublicProductPreviewQuietly(cached.productId);
    hideModal(); toast('อนุมัติแล้ว');
  }catch(e){ console.error(e); toast(e?.message||'อนุมัติไม่สำเร็จ'); }
  finally{ endActionLock(lockKey,'confirmApproveBtn'); }
};
window.reject=async(id)=>{
  if(!requireApprover()) return;
  const lockKey=`reject:${id}`;
  if(!beginActionLock(lockKey,'confirmRejectBtn','กำลังปฏิเสธ...')) return;
  const cached=state.approvals.find(x=>x.id===id);
  if(!cached){ endActionLock(lockKey,'confirmRejectBtn'); return toast('ไม่พบรายการ'); }
  try{
    await runTransaction(fs,async tx=>{
      const aRef=approvalRef(id),aSnap=await tx.get(aRef);
      if(!aSnap.exists()) throw new Error('รายการนี้ถูกดำเนินการแล้ว');
      const a={id,...aSnap.data()};
      const reviewerUid=state.user?.uid||'',reviewerName=state.profile?.displayName||state.profile?.username||'ไม่ทราบผู้ใช้';
      const eventId=a.eventId||makeEventId('REJ');
      const detail=`${a.type==='out'?'เบิก':'รับ'} ${a.name} ${a.qty} ${a.unit}`;
      const stockLoc={stockGroupId:a.stockGroupId||'',stockGroupName:a.stockGroupName||'',stockAreaId:a.stockAreaId||'',stockAreaName:a.stockAreaName||'',stockAreaPath:a.stockAreaPath||''}; const finalFields={action:'ปฏิเสธ',detail,time:new Date().toLocaleString('th-TH'),updatedAt:serverTimestamp(),location:a.location||stockLocationPath(stockLoc),stockLocation:a.stockLocation||stockLocationPath(stockLoc),destinationLocation:a.destinationLocation||a.issueDestination||(a.type==='out'?a.location:''),issueDestination:a.issueDestination||a.destinationLocation||(a.type==='out'?a.location:''),reviewerUid,reviewerName,submittedByUid:a.submittedByUid||'',submittedByName:a.submittedByName||'',productId:a.productId,qty:a.qty,unit:a.unit,moveType:a.type,photo:a.img||'',eventId,status:'rejected',lotId:a.lotId||'',lotNo:a.lotNo||'',lotExpiryDate:a.lotExpiryDate||'',fefoCorrect:a.fefoCorrect!==false,fefoOverrideReason:a.fefoOverrideReason||'',expectedLotId:a.expectedLotId||'',expectedLotNo:a.expectedLotNo||'',expectedLotExpiryDate:a.expectedLotExpiryDate||'',...stockLoc,fefoAckRequired:a.fefoCorrect===false,fefoAcknowledged:a.fefoAcknowledged===true,fefoAcknowledgedAt:a.fefoAcknowledgedAt||'',fefoAcknowledgedByUid:a.fefoAcknowledgedByUid||'',fefoAcknowledgedByName:a.fefoAcknowledgedByName||''};
      let logId=a.logId||'';
      let lRef=null,lSnap=null;
      if(logId){ lRef=logDocRef(logId); lSnap=await tx.get(lRef); }
      if(logId && lSnap?.exists()) tx.update(lRef,finalFields);
      else { const fallback=doc(logRef()); logId=fallback.id; tx.set(fallback,logPayload('ปฏิเสธ',detail,finalFields)); }
      const auditDoc=doc(auditRef());
      tx.set(auditDoc,auditPayload('ปฏิเสธ',detail,{...finalFields,approvalId:id,logId,eventId}));
      tx.delete(aRef);
    });
    hideModal(); toast('ปฏิเสธรายการแล้ว');
  }catch(e){ console.error(e); toast(e?.message||'ปฏิเสธรายการไม่สำเร็จ'); }
  finally{ endActionLock(lockKey,'confirmRejectBtn'); }
};
window.editApproval=(id)=>{
  const a=state.approvals.find(x=>x.id===id);
  if(!a) return toast('ไม่พบรายการ');
  if(!requirePendingOwnerOrApprover(a)) return;
  window.__editingApprovalId=id;
  openModal('แก้ไขรายการรออนุมัติ',`<input id="aq" type="number" min="1" value="${a.qty}">
    <select id="at" onchange="window.updateApprovalLocation()">
      <option value="out" ${a.type==='out'?'selected':''}>เบิกออก</option>
      <option value="in" ${a.type==='in'?'selected':''}>รับเข้า</option>
    </select>
    <div id="approvalLocationWrap"></div>
    <button id="saveApprovalBtn" data-action-lock="saveApproval:${id}" class="btn primary full" onclick="window.saveApproval('${id}')">บันทึกการแก้ไข</button>`);
  window.updateApprovalLocation();
};
window.confirmCancelApproval=(id)=>{
  const a=state.approvals.find(x=>x.id===id);
  if(!a) return toast('ไม่พบรายการ');
  if(!isOwnApproval(a)) return toast('ยกเลิกได้เฉพาะรายการของตัวเอง');
  openModal('ยืนยันยกเลิกรายการ',`${approvalDetailHtml(a)}
    <div class="card note" style="margin:0 0 12px">เมื่อยกเลิกแล้ว รายการจะถูกนำออกจากคิวอนุมัติ แต่ยังมีประวัติว่าเคยยกเลิก</div>
    <button id="cancelApprovalBtn" data-action-lock="cancelApproval:${id}" class="btn red full" onclick="window.cancelApproval('${id}')">ยืนยันยกเลิกรายการ</button>`);
};

window.cancelApproval=async(id)=>{
  const cached=state.approvals.find(x=>x.id===id);
  if(!cached) return toast('ไม่พบรายการ');
  if(!isOwnApproval(cached)) return toast('ยกเลิกได้เฉพาะรายการของตัวเอง');
  const lockKey=`cancelApproval:${id}`;
  if(!beginActionLock(lockKey,'cancelApprovalBtn','กำลังยกเลิก...')) return;
  try{
    await runTransaction(fs,async tx=>{
      const aRef=approvalRef(id),aSnap=await tx.get(aRef);
      if(!aSnap.exists()) throw new Error('รายการนี้ถูกดำเนินการแล้ว');
      const a={id,...aSnap.data()};
      if(a.submittedByUid!==state.user?.uid) throw new Error('ยกเลิกได้เฉพาะรายการของตัวเอง');
      const eventId=a.eventId||makeEventId('CAN');
      const detail=`ยกเลิก${a.type==='out'?'เบิก':'รับ'} ${a.name} ${a.qty} ${a.unit}`;
      const stockLoc={stockGroupId:a.stockGroupId||'',stockGroupName:a.stockGroupName||'',stockAreaId:a.stockAreaId||'',stockAreaName:a.stockAreaName||'',stockAreaPath:a.stockAreaPath||''}; const finalFields={action:'ยกเลิก',detail,time:new Date().toLocaleString('th-TH'),updatedAt:serverTimestamp(),cancelledAt:serverTimestamp(),productId:a.productId,qty:a.qty,unit:a.unit,moveType:a.type,location:a.location||stockLocationPath(stockLoc),...stockLoc,submittedByUid:a.submittedByUid||'',submittedByName:a.submittedByName||'',eventId,status:'cancelled'};
      let logId=a.logId||'';
      let lRef=null,lSnap=null;
      if(logId){ lRef=logDocRef(logId); lSnap=await tx.get(lRef); }
      if(logId && lSnap?.exists()) tx.update(lRef,finalFields);
      else { const fallback=doc(logRef()); logId=fallback.id; tx.set(fallback,logPayload('ยกเลิก',detail,finalFields)); }
      const auditDoc=doc(auditRef());
      tx.set(auditDoc,auditPayload('ยกเลิก',detail,{...finalFields,approvalId:id,logId,eventId}));
      tx.delete(aRef);
    });
    hideModal(); toast('ยกเลิกรายการแล้ว');
  }catch(e){ console.error(e); toast(e?.message||'ยกเลิกรายการไม่สำเร็จ'); }
  finally{ endActionLock(lockKey,'cancelApprovalBtn'); }
};
window.updateApprovalLocation=()=>{ const wrap=$('approvalLocationWrap'); if(!wrap) return; const a=state.approvals.find(x=>x.id===window.__editingApprovalId)||{}; const type=$('at')?.value||a.type||'out'; const destination=approvalDestinationLabel(a); const p=state.products.find(x=>String(x.id)===String(a.productId||'')); const stockLoc=p?productStockLocationExtra(p):{stockGroupId:a.stockGroupId||'',stockGroupName:a.stockGroupName||'',stockAreaId:a.stockAreaId||'',stockAreaName:a.stockAreaName||'',stockAreaPath:a.stockAreaPath||''}; wrap.innerHTML=`<div class="new-item-fixed-location"><span>🏠 เบิก/รับจากสต็อก:</span><b>${escapeHtml(approvalStockLocationLabel(a))}</b></div>${type==='out'?issueDestinationPickerMarkup('approvalDestination','approvalDestinationOther',destination,stockLoc.stockGroupId||a.stockGroupId||''):''}`; };
window.saveApproval=async(id)=>{
  const cached=state.approvals.find(x=>x.id===id);
  if(!cached) return toast('ไม่พบรายการ');
  if(!requirePendingOwnerOrApprover(cached)) return;
  const lockKey=`saveApproval:${id}`;
  if(!beginActionLock(lockKey,'saveApprovalBtn','กำลังบันทึก...')) return;
  const qty=Number($('aq').value)||0;
  if(qty<=0){ endActionLock(lockKey,'saveApprovalBtn'); return toast('จำนวนไม่ถูกต้อง'); }
  const type=$('at').value;
  const p=state.products.find(x=>x.id===cached.productId);
  if(p && !canAccessProduct(p)){ endActionLock(lockKey,'saveApprovalBtn'); return toast('คุณไม่มีสิทธิ์แก้ไขรายการของบ้านนี้'); }
  const stockLoc=p?productStockLocationExtra(p):{stockGroupId:cached.stockGroupId||'',stockGroupName:cached.stockGroupName||'',stockAreaId:cached.stockAreaId||'',stockAreaName:cached.stockAreaName||'',stockAreaPath:cached.stockAreaPath||''};
  const stockLocation=approvalStockLocationLabel(cached);
  const destinationLocation=type==='out'?getIssueDestinationValue('approvalDestination','approvalDestinationOther'):'';
  if(type==='out' && !destinationLocation){ endActionLock(lockKey,'saveApprovalBtn'); return toast('เลือกสถานที่เบิกไปใช้'); }
  const location=type==='out'?destinationLocation:stockLocation;
  if(type==='out'&&p&&qty>Number(p.stock)){ endActionLock(lockKey,'saveApprovalBtn'); return toast('เบิกเกินสต๊อก'); }
  if(type==='out'&&p&&!confirmExpiredIssue(p)){ endActionLock(lockKey,'saveApprovalBtn'); return; }
  try{
    await runTransaction(fs,async tx=>{
      const aRef=approvalRef(id),aSnap=await tx.get(aRef);
      if(!aSnap.exists()) throw new Error('รายการนี้ถูกดำเนินการแล้ว');
      const a={id,...aSnap.data()};
      if(!canApprove()&&a.submittedByUid!==state.user?.uid) throw new Error('คุณแก้ไขได้เฉพาะรายการของตัวเอง');
      const eventId=a.eventId||makeEventId('EDITREQ');
      const editorName=state.profile?.displayName||state.profile?.username||'ไม่ทราบผู้ใช้';
      const detail=`${type==='out'?'เบิก':'รับ'} ${a.name} ${qty} ${a.unit}`;
      let logId=a.logId||'';
      const logFields={action:'ส่งตรวจ',detail,qty,unit:a.unit,location,stockLocation,destinationLocation,issueDestination:destinationLocation,moveType:type,time:new Date().toLocaleString('th-TH'),updatedAt:serverTimestamp(),eventId,status:'pending',...stockLoc};
      let lRef=null,lSnap=null;
      if(logId){ lRef=logDocRef(logId); lSnap=await tx.get(lRef); }
      tx.update(aRef,{qty,type,location,stockLocation,destinationLocation,issueDestination:destinationLocation,...stockLoc,eventId,updatedAt:serverTimestamp(),updatedByUid:state.user.uid,updatedByName:editorName});
      if(logId && lSnap?.exists()) tx.update(lRef,logFields);
      else { const fallback=doc(logRef()); logId=fallback.id; tx.set(fallback,logPayload('แก้ไขรายการรออนุมัติ',detail,{...logFields,productId:a.productId})); tx.update(aRef,{logId}); }
      const auditDoc=doc(auditRef());
      tx.set(auditDoc,auditPayload('แก้ไขรายการรออนุมัติ',detail,{approvalId:id,logId,eventId,productId:a.productId,qty,unit:a.unit,moveType:type,location,stockLocation,destinationLocation,issueDestination:destinationLocation,...stockLoc}));
    });
    hideModal(); toast('แก้ไขรายการแล้ว');
  }catch(e){ console.error(e); toast(e?.message||'แก้ไขรายการไม่สำเร็จ'); }
  finally{ endActionLock(lockKey,'saveApprovalBtn'); }
};
function renderTrash(){
  if(!canManageProducts()){
    state.page='profile';
    toast('คุณไม่มีสิทธิ์เข้าถึงถังขยะ');
    renderProfile();
    return;
  }
  const items = state.products.filter(p=>p.trashed).sort((a,b)=>{
    const ta=a.trashedAt?.seconds||0, tb=b.trashedAt?.seconds||0; return tb-ta;
  });
  const rows = items.map(p=>`<div class="product"><div><b>${escapeHtml(p.name)}</b><div class="muted">${escapeHtml(p.sku||'-')} • ${p.stock} ${escapeHtml(p.unit||'')}</div></div><div class="row"><button class="btn small green" onclick="window.restoreProduct('${p.id}')">↩️ กู้คืน</button><button class="btn small red" onclick="window.purgeProduct('${p.id}')">🗑️ ลบถาวรจริง</button></div></div>`).join('');
  view.innerHTML = `<div class="between"><h1>🗑️ ถังขยะ</h1><button class="btn small" onclick="window.backToProfile()">← กลับ</button></div><div class="card"><p class="muted" style="margin-top:0">สินค้าที่ลบจะเก็บไว้ที่นี่จนกว่าจะกู้คืนหรือลบถาวรจริงด้วยตัวเอง</p>${rows||'<p class="muted">ถังขยะว่างเปล่า</p>'}</div>`;
}
window.viewTrash=()=>{
  if(!canManageProducts()) return toast('คุณไม่มีสิทธิ์เข้าถึงถังขยะ');
  state.page='trash';
  renderTrash();
  window.scrollTo({top:0,behavior:'auto'});
};
window.backToProfile=()=>{ state.page='profile'; renderProfile(); };
window.restoreProduct=async(id)=>{ if(!requireManager()) return; const p=state.products.find(x=>x.id===id); await updateDoc(productRef(id),{trashed:false,trashedAt:null,updatedAt:serverTimestamp()}); await addLog('กู้คืนจากถังขยะ',p.name,{productId:id}); await syncPublicProductPreviewById(id); toast('กู้คืนแล้ว และเปิด QR Preview กลับมาแล้ว'); renderTrash(); };
window.purgeProduct=async(id)=>{
  if(!requireManager()) return;
  const p=state.products.find(x=>x.id===id);
  if(!p) return toast('ไม่พบสินค้า');
  const typed=prompt(`ลบ "${p.name}" ถาวร จะกู้คืนไม่ได้อีกเลย

พิมพ์คำว่า "ลบถาวร" เพื่อยืนยัน`);
  if(typed===null) return;
  if(typed.trim()!=='ลบถาวร'){ toast('ยกเลิก: ข้อความไม่ตรง'); return; }
  const lockKey=`purgeProduct:${id}`;
  if(!beginActionLock(lockKey)) return;
  let imageCleanupFailed=false;
  let deletedProduct={...p};
  try{
    await runTransaction(fs,async tx=>{
      const pRef=productRef(id);
      const pSnap=await tx.get(pRef);
      if(!pSnap.exists()) throw new Error('สินค้านี้ถูกลบไปแล้ว');
      const current=pSnap.data();
      deletedProduct={id,...current};
      let regRef=null,regSnap=null;
      if(current.sku){
        regRef=skuRegistryDocRef(current.sku);
        regSnap=await tx.get(regRef);
      }
      tx.delete(pRef);
      tx.delete(publicProductRef(id));
      if(regRef&&regSnap?.exists()&&regSnap.data()?.productId===id) tx.delete(regRef);
    });
    const imagePath=deletedProduct.photoPath||deletedProduct.imagePath||'';
    if(imagePath){
      try{ await deleteObject(storageRef(storage,imagePath)); }
      catch(e){
        if(e?.code!=='storage/object-not-found'){
          imageCleanupFailed=true;
          console.warn('ลบรูปสินค้าถาวรไม่สำเร็จ',imagePath,e);
        }
      }
    }
    state.products=state.products.filter(x=>x.id!==id);
    await writeProductCache(state.products,0,Date.now());
    try{ await addLog('ลบถาวรจริง',deletedProduct.name||p.name,{productId:id,sku:deletedProduct.sku||'',imageCleanupFailed}); }
    catch(logErr){ console.warn('บันทึกประวัติการลบถาวรไม่สำเร็จ',logErr); }
    toast(imageCleanupFailed?'ลบสินค้าแล้ว แต่ลบไฟล์รูปไม่สำเร็จ':'ลบสินค้าและรูปถาวรแล้ว');
    renderTrash();
  }catch(e){
    console.error(e);
    toast(e?.message||'ลบสินค้าถาวรไม่สำเร็จ');
  }finally{
    endActionLock(lockKey);
  }
};


function isValidReportDateValue(value){
  return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !!parseLocalDate(value);
}
function isValidReportMonthValue(value){
  return typeof value==='string' && /^\d{4}-\d{2}$/.test(value) && Number(value.slice(5,7))>=1 && Number(value.slice(5,7))<=12;
}
function normalizeReportState(){
  const today=toDateStr(new Date());
  const month=toMonthStr(new Date());
  if(!['day','month','range'].includes(state.reportMode)) state.reportMode='day';
  if(!['all','in','out'].includes(state.reportFilter)) state.reportFilter='all';
  if(!['normal','manager'].includes(state.reportDashboardView)) state.reportDashboardView='normal';
  if(!isValidReportDateValue(state.reportDate)) state.reportDate=today;
  if(!isValidReportMonthValue(state.reportMonth)) state.reportMonth=month;
  if(!isValidReportDateValue(state.reportStart)) state.reportStart=today;
  if(!isValidReportDateValue(state.reportEnd)) state.reportEnd=state.reportStart||today;
  if(typeof state.balanceCategory!=='string' || !state.balanceCategory.trim()) state.balanceCategory='all';
  if(typeof state.reportGroupFilter!=='string' || !state.reportGroupFilter.trim()) state.reportGroupFilter='all';
  if(typeof state.reportAreaFilter!=='string' || !state.reportAreaFilter.trim()) state.reportAreaFilter='all';
}
function reportAreaToken(groupId,areaId){ return stockAreaAccessKey(groupId,areaId); }
function reportLogStockLocation(log={}){ return historyLogStockLocation(log); }
function reportLocationLabel(log={}){ return historyLocationLabel(log); }
function reportProductLocation(product={}){ return productStockLocation(product); }
function reportLocationFilterContext(){
  const groups=activeStockGroups();
  const restricted=!isStockAccessUnrestricted(state.profile||{});
  let selectedGroup=String(state.reportGroupFilter||'all');
  if(selectedGroup!=='all' && !groups.some(g=>g.id===selectedGroup)) selectedGroup='all';
  if(restricted && groups.length===1) selectedGroup=groups[0].id;
  if(state.reportGroupFilter!==selectedGroup) state.reportGroupFilter=selectedGroup;
  const areaPool=selectedGroup==='all'
    ? groups.flatMap(g=>activeStockAreas(g.id).map(a=>({...a,groupId:g.id,groupName:g.name,value:reportAreaToken(g.id,a.id),label:`${g.name} / ${a.name}`})))
    : activeStockAreas(selectedGroup).map(a=>{ const g=groups.find(x=>x.id===selectedGroup); return {...a,groupId:selectedGroup,groupName:g?.name||'',value:reportAreaToken(selectedGroup,a.id),label:a.name}; });
  let selectedArea=String(state.reportAreaFilter||'all');
  if(selectedArea!=='all' && !areaPool.some(a=>a.value===selectedArea)) selectedArea='all';
  if(restricted && areaPool.length===1 && selectedGroup!=='all') selectedArea=areaPool[0].value;
  if(state.reportAreaFilter!==selectedArea) state.reportAreaFilter=selectedArea;
  const lockGroup=!!(restricted && groups.length===1);
  const lockArea=!!(restricted && selectedGroup!=='all' && areaPool.length===1);
  return {groups,restricted,selectedGroup,areaPool,selectedArea,lockGroup,lockArea};
}
function logMatchesReportLocation(log,ctx=reportLocationFilterContext()){
  const loc=reportLogStockLocation(log);
  if(ctx.selectedGroup!=='all' && loc.stockGroupId!==ctx.selectedGroup) return false;
  if(ctx.selectedArea!=='all'){
    if(!loc.stockGroupId || !loc.stockAreaId) return false;
    return reportAreaToken(loc.stockGroupId,loc.stockAreaId)===ctx.selectedArea;
  }
  return true;
}
function productMatchesReportLocation(product={},ctx=reportLocationFilterContext()){
  const loc=reportProductLocation(product);
  if(ctx.selectedGroup!=='all' && loc.stockGroupId!==ctx.selectedGroup) return false;
  if(ctx.selectedArea!=='all'){
    if(!loc.stockGroupId || !loc.stockAreaId) return false;
    return reportAreaToken(loc.stockGroupId,loc.stockAreaId)===ctx.selectedArea;
  }
  return true;
}
function reportScopedProducts(ctx=reportLocationFilterContext()){
  return getActiveProducts().filter(p=>canAccessProduct(p)).filter(p=>productMatchesReportLocation(p,ctx));
}
function reportLocationFilterMarkup(ctx=reportLocationFilterContext()){
  const showAllGroups=!ctx.restricted || ctx.groups.length>1;
  const groupOptions=[showAllGroups?`<option value="all" ${ctx.selectedGroup==='all'?'selected':''}>ทุกคลัง</option>`:'',...ctx.groups.map(g=>`<option value="${escapeHtml(g.id)}" ${ctx.selectedGroup===g.id?'selected':''}>${escapeHtml(g.name)}</option>`)].join('');
  const showAllAreas=!ctx.lockArea;
  const areaOptions=[showAllAreas?`<option value="all" ${ctx.selectedArea==='all'?'selected':''}>ทุกพื้นที่</option>`:'',...ctx.areaPool.map(a=>`<option value="${escapeHtml(a.value)}" ${ctx.selectedArea===a.value?'selected':''}>${escapeHtml(a.label)}</option>`)].join('');
  return `<div class="report-location-box"><div class="report-section-caption">ตำแหน่งสต็อก</div><div class="report-location-grid"><label class="report-field"><span>คลัง</span><select id="reportGroupFilter" onchange="window.setReportGroupFilter(this.value)" ${ctx.lockGroup?'disabled':''}>${groupOptions}</select></label><label class="report-field"><span>พื้นที่</span><select id="reportAreaFilter" onchange="window.setReportAreaFilter(this.value)" ${ctx.lockArea?'disabled':''}>${areaOptions}</select></label></div></div>`;
}
function reportLocationScopeLabel(ctx=reportLocationFilterContext()){
  if(ctx.selectedGroup==='all' && ctx.selectedArea==='all') return 'ทุกคลัง / ทุกพื้นที่';
  const group=ctx.groups.find(g=>g.id===ctx.selectedGroup);
  if(ctx.selectedArea==='all') return `${group?.name||'ทุกคลัง'} / ทุกพื้นที่`;
  const area=ctx.areaPool.find(a=>a.value===ctx.selectedArea);
  return area?.label || group?.name || 'ตำแหน่งที่เลือก';
}

function getReportPeriodLogs(){
  normalizeReportState();
  const locationCtx=reportLocationFilterContext();
  const movementLogs = state.logs
    .filter(l=>canAccessLogEntry(l))
    .filter(isStockMovementLog)
    .map(l=>({ ...l, _d:getReportRecordDate(l)||getLogDate(l), _type:isReceiveLog(l)?'in':'out' }))
    .filter(l=>l._d)
    .filter(l=>logMatchesReportLocation(l,locationCtx));

  if(state.reportMode==='month'){
    const [y,m] = state.reportMonth.split('-').map(Number);
    return movementLogs.filter(l=> l._d.getFullYear()===y && (l._d.getMonth()+1)===m);
  }
  if(state.reportMode==='range'){
    const start = parseLocalDate(state.reportStart || toDateStr(new Date()));
    const end = parseLocalDate(state.reportEnd || state.reportStart || toDateStr(new Date()));
    if(!start || !end) return [];
    const from = start <= end ? start : end;
    const to = start <= end ? end : start;
    to.setHours(23,59,59,999);
    return movementLogs.filter(l=>l._d>=from && l._d<=to);
  }
  const [y,m,d] = state.reportDate.split('-').map(Number);
  return movementLogs.filter(l=> l._d.getFullYear()===y && (l._d.getMonth()+1)===m && l._d.getDate()===d);
}


function getReportPeriodLabel(){
  normalizeReportState();
  if(state.reportMode==='month'){
    const [y,m]=(state.reportMonth||toMonthStr(new Date())).split('-').map(Number);
    return `เดือน ${pad2(m)}/${y}`;
  }
  if(state.reportMode==='range'){
    const start=parseLocalDate(state.reportStart), end=parseLocalDate(state.reportEnd);
    const a=start&&end&&start>end?end:start, b=start&&end&&start>end?start:end;
    return a&&b ? `ช่วงวันที่ ${a.toLocaleDateString('th-TH')} – ${b.toLocaleDateString('th-TH')}` : 'ช่วงวันที่ที่เลือก';
  }
  const [y,m,d]=(state.reportDate||toDateStr(new Date())).split('-').map(Number);
  return `วันที่ ${pad2(d)}/${pad2(m)}/${y}`;
}

function reportDateDisplayLabel(value,type='date'){
  if(type==='month'){
    const text=String(value||'').trim();
    const match=/^(\d{4})-(\d{2})$/.exec(text);
    if(!match) return 'เลือกเดือน';
    const y=Number(match[1]);
    const m=Number(match[2]);
    const date=new Date(y,m-1,1);
    if(date.getFullYear()!==y || date.getMonth()!==m-1) return text;
    return date.toLocaleDateString('th-TH',{month:'short',year:'numeric'});
  }
  const date=parseLocalDate(value);
  return date ? date.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'}) : 'เลือกวันที่';
}
function reportDatePickerMarkup({kind='date',label='เลือกวันที่',value='',onchange='',prev='',next='',prevLabel='',nextLabel='',extraClass=''}){
  const inputType=kind==='month'?'month':'date';
  const display=reportDateDisplayLabel(value,inputType);
  const prevBtn=prev?`<button type="button" class="report-date-arrow-btn" onclick="${prev}" aria-label="${escapeHtml(prevLabel||'ก่อนหน้า')}">◀</button>`:'';
  const nextBtn=next?`<button type="button" class="report-date-arrow-btn" onclick="${next}" aria-label="${escapeHtml(nextLabel||'ถัดไป')}">▶</button>`:'';
  return `<div class="report-date-control ${escapeHtml(extraClass)}"><div class="report-date-control-label">${escapeHtml(label)}</div><div class="report-date-control-row">${prevBtn}<label class="report-date-display-field"><span class="report-date-display-text">${escapeHtml(display)}</span><input class="report-native-picker" type="${inputType}" value="${escapeHtml(value||'')}" onchange="${onchange}" aria-label="${escapeHtml(label)}"></label>${nextBtn}</div></div>`;
}

function managerMetricCard(icon,title,value,desc,kind='',actionLabel='',onclick=''){
  const action=actionLabel&&onclick?`<button class="btn small light" onclick="${onclick}">${escapeHtml(actionLabel)}</button>`:'';
  return `<article class="manager-report-card ${escapeHtml(kind)}"><div class="manager-report-icon">${escapeHtml(icon)}</div><div><b>${escapeHtml(title)}</b><strong>${escapeHtml(value)}</strong><small>${escapeHtml(desc)}</small></div>${action}</article>`;
}
// v34.24.6: การ์ด FEFO ด้านนอกนับเฉพาะรายการค้างรับทราบเท่านั้น
function renderManagerReportSummary(periodLabel, periodLogs, balanceRows, lowStockRows, lotExpiryRows, fefoRows, scopeLabel='ทุกคลัง / ทุกพื้นที่'){
  const receiveCount=periodLogs.filter(l=>l._type==='in').length;
  const withdrawCount=periodLogs.filter(l=>l._type==='out').length;
  const outOfStock=balanceRows.filter(r=>r.status==='หมด').length;
  const urgentLots=lotExpiryRows.filter(r=>r?.meta && ['expired','today','urgent'].includes(r.meta.key)).length;
  const fefoUnack=getFefoUnackRows(fefoRows).length;
  return `<section class="card manager-report-panel"><div class="manager-report-head"><div><div class="dashboard-kicker">รายงานสำหรับหัวหน้างาน</div><h2>สรุปภาพรวม ${escapeHtml(periodLabel)}</h2><p class="muted">ตำแหน่ง: ${escapeHtml(scopeLabel)} • ดูจุดที่ต้องตัดสินใจเร็ว: รับเข้า เบิกออก ของใกล้หมด ล็อตใกล้หมดอายุ และรายการไม่ตรง FEFO</p></div><button class="btn small light" onclick="window.reportToday()">วันนี้</button></div>
    <div class="manager-report-grid">
      ${managerMetricCard('📥','รับเข้า',`${receiveCount} รายการ`,'จำนวนรายการรับสินค้าในช่วงที่เลือก','receive','ดูรับเข้า',"window.selectReportType('in')")}
      ${managerMetricCard('📤','เบิกออก',`${withdrawCount} รายการ`,'จำนวนรายการเบิกสินค้าในช่วงที่เลือก','withdraw','ดูเบิกออก',"window.selectReportType('out')")}
      ${managerMetricCard('📦','สินค้าใกล้หมด',`${lowStockRows.length} รายการ`,`รวมหมดสต๊อก ${outOfStock} รายการ`,'low','ดูรายการ','window.openLowStockReport()')}
      ${managerMetricCard('⏰','ล็อตต้องระวัง',`${lotExpiryRows.length} ล็อต`,`เร่งด่วน ${urgentLots} ล็อต`,'expiry','ดูล็อต','window.openLotExpiryReport()')}
      ${managerMetricCard('⚠️','ไม่ตรง FEFO',`${fefoUnack} รายการ`,fefoUnack?`ค้างรับทราบ ${fefoUnack} รายการ`:'ไม่มีค้างรับทราบ','fefo','ดู FEFO','window.openFefoExceptionReport()')}
    </div></section>`;
}
function getLowStockReportRows(){
  return getStockBalanceRows()
    .filter(r=>r.status==='ใกล้หมด'||r.status==='หมด')
    .sort((a,b)=>{
      const pa=a.status==='หมด'?0:1, pb=b.status==='หมด'?0:1;
      return pa-pb || a.category.localeCompare(b.category,'th') || a.name.localeCompare(b.name,'th');
    });
}
function renderLowStockReportCard(){
  const rows=getLowStockReportRows();
  const out=rows.filter(r=>r.status==='หมด').length;
  const low=rows.filter(r=>r.status==='ใกล้หมด').length;
  return `<div id="lowStockReportCard" class="card report-export-card manager-report-export" style="align-items:stretch;flex-direction:column;gap:12px">
    <div><b>🚨 รายงานสินค้าใกล้หมด / หมดสต๊อก</b><div class="muted" style="font-size:13px">ดึงจากยอดคงเหลือปัจจุบันและจุดเตือนของสินค้า</div></div>
    <div class="muted" style="font-size:13px">ทั้งหมด ${rows.length} รายการ • หมดสต๊อก ${out} • ใกล้หมด ${low}</div>
    <div class="row report-export-actions"><button class="btn small primary" onclick="window.openLowStockReport()">ดูรายการ</button><button class="btn small green" onclick="window.exportLowStockCSV()">📗 Excel/CSV</button><button class="btn small light" onclick="window.printLowStockPDF()">📄 PDF</button><button class="btn small light" onclick="window.goToPage('stock',{filter:'low',resetScroll:true})">ไปหน้าสต๊อก</button></div>
  </div>`;
}
function getFefoExpectedLotInfo(product={}, selectedLotId='', raw={}){
  const explicitNo=raw.expectedLotNo||raw.recommendedLotNo||raw.fefoLotNo||raw.shouldUseLotNo||raw.fefoRecommendedLotNo||'';
  const explicitExpiry=raw.expectedLotExpiryDate||raw.recommendedLotExpiryDate||raw.fefoLotExpiryDate||raw.shouldUseLotExpiryDate||'';
  if(explicitNo){
    return {lotNo:String(explicitNo), expiry:explicitExpiry||'', source:'บันทึกตอนทำรายการ'};
  }
  try{
    const lots=activeProductLots(product||{});
    const names=product?.id?lotDisplayMap(product):new Map();
    const candidate=lots.find(l=>String(l.id||'')!==String(selectedLotId||'')) || lots[0] || null;
    if(candidate){
      return {lotNo:names.get(candidate.id)||candidate.lotNo||candidate.id||'ล็อตที่ควรเบิกก่อน', expiry:candidate.expiryDate||'', source:'คำนวณจากล็อตคงเหลือปัจจุบัน'};
    }
  }catch(_){ }
  return {lotNo:'ไม่พบข้อมูลล็อต FEFO เดิม', expiry:'', source:'ข้อมูลล็อตเดิมอาจถูกใช้หมดแล้ว'};
}
function getFefoRawDate(raw={}){
  return raw._d || getReportRecordDate(raw) || getLogDate(raw) || null;
}
function hasFefoExceptionFlag(raw={}){
  if(raw.fefoCorrect===false) return true;
  if(String(raw.fefoCorrect).toLowerCase()==='false') return true;
  if(String(raw.fefoStatus||'').toLowerCase().includes('override')) return true;
  if(String(raw.fefoOverride||'').toLowerCase()==='true') return true;
  if(String(raw.isFefoOverride||'').toLowerCase()==='true') return true;
  if(String(raw.fefoOverrideReason||'').trim()) return true;
  if(String(raw.expectedLotId||raw.expectedLotNo||raw.recommendedLotId||raw.recommendedLotNo||'').trim()){
    const selected=String(raw.lotId||raw.lotNo||'').trim();
    const expected=String(raw.expectedLotId||raw.expectedLotNo||raw.recommendedLotId||raw.recommendedLotNo||'').trim();
    if(selected && expected && selected!==expected) return true;
  }
  const text=[raw.note,raw.reason,raw.detail,raw.message].filter(Boolean).join(' ');
  if(/ไม่ใช่ล็อต\s*FEFO|ไม่ตรง\s*FEFO|FEFO/i.test(text) && /ไม่ใช่|ไม่ตรง|override/i.test(text)) return true;
  return false;
}

function isFefoAcknowledged(raw={}){
  return raw.fefoAcknowledged===true
    || raw.fefoReviewed===true
    || !!raw.fefoAcknowledgedAt
    || !!raw.fefoReviewedAt;
}
function fefoAckLabel(raw={}){
  return isFefoAcknowledged(raw) ? 'รับทราบแล้ว' : 'ค้างรับทราบ';
}
function fefoAckByText(raw={}){
  return raw.fefoAcknowledgedByName || raw.fefoReviewedByName || raw.reviewedByName || '';
}
function fefoAckAtText(raw={}){
  const v=raw.fefoAcknowledgedAt || raw.fefoReviewedAt || '';
  if(!v) return '';
  if(typeof v.toDate==='function') return v.toDate().toLocaleString('th-TH');
  if(v instanceof Date) return v.toLocaleString('th-TH');
  return String(v);
}
function canAcknowledgeFefo(){
  return isManagerRole();
}
function getFefoUnackRows(rows=[]){
  return rows.filter(r=>r && !r.acknowledged);
}
function isFefoExceptionCandidate(raw={}){
  const move=String(raw.moveType||raw.type||'').toLowerCase();
  const status=String(raw.status||'').toLowerCase();
  const isOut=move==='out' || isWithdrawLog(raw) || (raw.action==='ส่งตรวจ' && (move==='out'||raw.type==='out')) || ['pending','approved','rejected','cancelled'].includes(status);
  return isOut && hasFefoExceptionFlag(raw);
}
function isRawInReportPeriod(raw={}){
  const bounds=getReportDateBounds();
  const dt=getFefoRawDate(raw);
  if(!bounds || !dt) return false;
  return dt>=bounds.start && dt<=bounds.end;
}
function getReportPeriodFefoApprovals(){
  // รายการรออนุมัติเป็นงานค้างที่หัวหน้างานต้องเห็นทันที แม้ช่วงวันที่รายงานจะยังไม่ตรง
  // ส่วนรายการที่ปิดแล้วให้ยึดตามช่วงวันที่รายงานเหมือนรายงานอื่น
  return (state.approvals||[])
    .filter(a=>String(a.type||a.moveType||'').toLowerCase()==='out' && isFefoExceptionCandidate(a))
    .map(a=>({...a,__source:'approval',_d:getLogDate(a)||new Date()}))
    .filter(a=>String(a.status||'pending').toLowerCase()==='pending' || isRawInReportPeriod(a));
}
function fefoRowStatus(raw={}){
  const status=String(raw.status||'').toLowerCase();
  if(raw.__source==='approval' || status==='pending' || raw.action==='ส่งตรวจ') return 'รออนุมัติ';
  if(status==='approved' || raw.action==='อนุมัติ') return 'อนุมัติแล้ว';
  if(status==='rejected' || raw.action==='ปฏิเสธ') return 'ปฏิเสธ';
  if(status==='cancelled' || raw.action==='ยกเลิก') return 'ยกเลิก';
  return 'บันทึกแล้ว';
}
function fefoSourcePriority(raw={}){
  const status=fefoRowStatus(raw);
  if(status==='รออนุมัติ') return 4;
  if(status==='อนุมัติแล้ว') return 3;
  if(status==='ปฏิเสธ') return 2;
  return 1;
}
function getFefoExceptionRows(sourceLogs){
  const base=Array.isArray(sourceLogs)?sourceLogs:getReportPeriodLogs();
  const pendingApprovalLogs=(state.logs||[])
    .filter(l=>String(l.status||'').toLowerCase()==='pending' || l.action==='ส่งตรวจ')
    .filter(isFefoExceptionCandidate)
    .map(l=>({...l,__source:l.__source||'log',_d:getLogDate(l)||new Date()}));
  const merged=new Map();
  const unackFefoLogs=(state.logs||[])
    .filter(isFefoExceptionCandidate)
    .filter(l=>!isFefoAcknowledged(l))
    .map(l=>({...l,__source:l.__source||'log',_d:getLogDate(l)||getFefoRawDate(l)||new Date()}));
  const candidates=[...base.map(x=>({...x,__source:x.__source||'log'})), ...pendingApprovalLogs, ...unackFefoLogs, ...getReportPeriodFefoApprovals()];
  candidates.forEach((item,index)=>{
    if(!isFefoExceptionCandidate(item)) return;
    const dt=getFefoRawDate(item);
    if(!dt) return;
    const key=String(item.eventId||item.logId||item.approvalId||item.id||`${item.productId||item.name||'item'}-${dt.getTime()}-${index}`);
    const prev=merged.get(key);
    if(!prev || fefoSourcePriority(item)>=fefoSourcePriority(prev)) merged.set(key,item);
  });
  return [...merged.values()].map((l,index)=>{
      const dt=getFefoRawDate(l);
      const product=state.products.find(p=>p.id===l.productId)||{};
      const names=product?.id?lotDisplayMap(product):new Map();
      const selectedLotName=(l.lotId&&names.get(l.lotId))||l.lotNo||l.selectedLotNo||'ไม่ระบุล็อต';
      const expected=getFefoExpectedLotInfo(product,l.lotId,l);
      const productName=product?.name||l.name||l.productName||l.detail||'ไม่ทราบสินค้า';
      const category=String(product?.category||l.category||'ไม่ระบุ').trim()||'ไม่ระบุ';
      const eventKey=l.eventId||l.logId||l.id||`${l.productId||productName}-${dt?dt.getTime():Date.now()}-${index}`;
      return {
        id:String(eventKey),
        raw:l,
        date:dt,
        status:fefoRowStatus(l),
        productId:product?.id||l.productId||'',
        product:productName,
        category,
        sku:product?.sku||l.sku||'',
        photo:product?.photo||'',
        qty:Number(l.qty)||0,
        unit:l.unit||product?.unit||'หน่วย',
        location:l.location||'ไม่ระบุตำแหน่ง',
        lot:selectedLotName,
        lotId:l.lotId||'',
        expiry:l.lotExpiryDate?lotDateLabel(l.lotExpiryDate):'ไม่ระบุ',
        expiryRaw:l.lotExpiryDate||'',
        expectedLot:expected.lotNo,
        expectedExpiry:expected.expiry?lotDateLabel(expected.expiry):'ไม่ระบุ',
        expectedSource:expected.source,
        sourceType:l.__source==='approval'?'approval':'log',
        sourceId:l.id||l.logId||'',
        acknowledged:isFefoAcknowledged(l),
        ackLabel:fefoAckLabel(l),
        ackBy:fefoAckByText(l),
        ackAt:fefoAckAtText(l),
        user:l.submittedByName||l.userName||l.displayName||l.byName||l.actorName||'ไม่ระบุผู้เบิก',
        reviewer:l.reviewerName||l.approvedByName||l.updatedByName||'',
        reason:l.fefoOverrideReason||l.reason||l.note||'ไม่ระบุเหตุผล'
      };
    })
    .sort((a,b)=>b.date-a.date);
}

function renderFefoExceptionReportCard(periodLogs){
  const rows=getFefoExceptionRows(periodLogs);
  const unack=getFefoUnackRows(rows).length;
  const ackNote=unack?`<div class="fefo-ack-alert">⚠️ มีรายการ FEFO ค้างตรวจรับทราบ ${unack} รายการ</div>`:`<div class="muted" style="font-size:13px">✅ ไม่มีรายการ FEFO ค้างรับทราบ</div>`;
  return `<div id="fefoExceptionReportCard" class="card report-export-card manager-report-export" style="align-items:stretch;flex-direction:column;gap:12px">
    <div><b>⚠️ รายงานเบิกไม่ตรง FEFO</b><div class="muted" style="font-size:13px">รายการเบิกออกที่เลือกล็อตใหม่กว่าและระบบบังคับกรอกเหตุผลไว้</div></div>
    <div class="muted" style="font-size:13px">ค้างรับทราบ ${unack} รายการ</div>
    ${ackNote}
    <div class="row report-export-actions"><button class="btn small primary" onclick="window.openFefoExceptionReport()">ดูรายการ</button><button class="btn small green" onclick="window.exportFefoExceptionCSV()">📗 Excel/CSV</button><button class="btn small light" onclick="window.printFefoExceptionPDF()">📄 PDF</button></div>
  </div>`;
}


function issueDestinationUnitText(units={}){
  const entries=Object.entries(units||{}).filter(([,q])=>Number(q));
  if(!entries.length) return '0 หน่วย';
  return entries.map(([u,q])=>`${Number(q).toLocaleString('th-TH')} ${escapeHtml(u||'หน่วย')}`).join(' • ');
}
function getIssueDestinationReportRows(sourceLogs=null){
  const source=Array.isArray(sourceLogs)?sourceLogs:getReportPeriodLogs();
  const ctx=reportLocationFilterContext();
  return (source||[])
    .map((l,index)=>{
      const d=l?._d||getReportRecordDate(l)||getLogDate(l);
      const type=isWithdrawLog(l)||String(l?._type||l?.moveType||l?.type||'').toLowerCase()==='out'?'out':(isReceiveLog(l)?'in':'');
      return {...(l||{}),__issueDestinationIndex:index,_d:d,_type:type};
    })
    .filter(l=>l._type==='out' && l._d && canAccessLogEntry(l) && logMatchesReportLocation(l,ctx))
    .sort((a,b)=>(b._d?.getTime?.()||0)-(a._d?.getTime?.()||0))
    .map((l,index)=>{
      const product=state.products.find(p=>String(p.id||'')===String(l.productId||'')) || {};
      const d=l._d || new Date();
      const destination=movementDestinationLabel(l) || 'ไม่ระบุสถานที่เบิกไปใช้';
      const sourceLocation=movementStockSourceLabel(l) || reportLocationLabel(l) || 'ไม่ระบุคลังต้นทาง';
      const name=product.name || l.productName || l.name || l.detail || 'ไม่ทราบสินค้า';
      const category=String(product.category || l.category || '').trim() || 'ไม่ระบุ';
      const unit=l.unit || product.unit || 'หน่วย';
      const actor=l.submittedByName || l.actorName || l.userName || l.displayName || l.byName || l.createdByName || '-';
      const reviewer=l.reviewerName || l.approvedByName || l.rejectedByName || '-';
      const statusLabel=getInOutReportStatusLabel(l);
      const selectedLot=l.lotNo || l.lotName || '';
      const expiry=l.lotExpiryDate || l.expiryDate || '';
      const proof=String(l.photo||l.img||l.proof||l.image||l.attachmentPhoto||'').trim();
      const rawId=String(l.id||l.eventId||l.logId||l.productId||name||index).replace(/[^a-zA-Z0-9ก-๙_-]/g,'_');
      const qty=Number(l.qty)||0;
      const returnedQty=returnedQtyForIssueLog(l);
      const netQty=Math.max(0,qty-returnedQty);
      const returnLabel=returnedQty>0 ? (netQty>0?`คืนแล้ว ${returnedQty} ${unit} • ใช้จริง ${netQty} ${unit}`:`คืนครบแล้ว ${returnedQty} ${unit}`) : 'ยังไม่มีคืนของ';
      return {
        id:`dest-${index}-${rawId}`,
        sourceId:l.id||'', eventId:l.eventId||'', productId:l.productId||product.id||'',
        raw:l, product,
        name, sku:product.sku||l.sku||'', category, photo:product.photo||'',
        destination, sourceLocation,
        date:d, dateText:d.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'}),
        timeText:d.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
        qty, returnedQty, netQty, returnLabel, unit, actor, reviewer,
        statusLabel, statusKey:getInOutReportStatusKey(statusLabel),
        lot:selectedLot, expiry, expiryText:expiry?lotDateLabel(expiry):'ไม่ระบุ',
        fefo:l.fefoCorrect===false?'ไม่ตรง FEFO':'ตรง FEFO',
        note:l.fefoOverrideReason || l.note || l.reason || '',
        proof, proofKind:proof?'proof':'none'
      };
    });
}
function summarizeIssueDestinationRows(rows=[]){
  const map=new Map();
  (rows||[]).forEach(r=>{
    const key=String(r.destination||'ไม่ระบุสถานที่เบิกไปใช้').trim()||'ไม่ระบุสถานที่เบิกไปใช้';
    if(!map.has(key)) map.set(key,{destination:key,tx:0,totalQty:0,returnedQty:0,netQty:0,units:{},returnUnits:{},netUnits:{},products:new Map(),lastDate:null});
    const item=map.get(key);
    const qty=Number(r.qty)||0, returnedQty=Number(r.returnedQty)||0, netQty=Math.max(0,Number(r.netQty ?? (qty-returnedQty))||0);
    const unit=r.unit||'หน่วย';
    item.tx+=1;
    item.totalQty+=qty;
    item.returnedQty+=returnedQty;
    item.netQty+=netQty;
    item.units[unit]=(item.units[unit]||0)+qty;
    item.returnUnits[unit]=(item.returnUnits[unit]||0)+returnedQty;
    item.netUnits[unit]=(item.netUnits[unit]||0)+netQty;
    const pKey=[r.productId||r.name,unit].join('|');
    if(!item.products.has(pKey)) item.products.set(pKey,{name:r.name,unit,qty:0,returnedQty:0,netQty:0,tx:0});
    const p=item.products.get(pKey);
    p.qty+=qty; p.returnedQty+=returnedQty; p.netQty+=netQty; p.tx+=1;
    if(r.date && (!item.lastDate || r.date>item.lastDate)) item.lastDate=r.date;
  });
  return [...map.values()].map(x=>({...x,products:[...x.products.values()].sort((a,b)=>b.netQty-a.netQty || b.qty-a.qty || a.name.localeCompare(b.name,'th'))}))
    .sort((a,b)=>b.tx-a.tx || b.netQty-a.netQty || b.totalQty-a.totalQty || a.destination.localeCompare(b.destination,'th'));
}
function renderIssueDestinationReportCard(periodLogs=[],scopeLabel='ทุกคลัง / ทุกพื้นที่'){
  const rows=getIssueDestinationReportRows(periodLogs);
  const summary=summarizeIssueDestinationRows(rows);
  const top=summary.slice(0,4);
  const preview=top.length
    ? `<div class="issue-destination-preview">${top.map(s=>`<button type="button" onclick="window.openIssueDestinationReport(decodeURIComponent('${encodeURIComponent(s.destination)}'))"><b>${escapeHtml(s.destination)}</b><span>${s.tx} รายการ • ใช้จริง ${issueDestinationUnitText(s.netUnits||s.units)}</span></button>`).join('')}</div>`
    : `<div class="issue-destination-preview-empty">ยังไม่มีรายการเบิกออกตามสถานที่ในช่วงเวลานี้</div>`;
  return `<div id="issueDestinationReportCard" class="card report-export-card manager-inout-modal-fix-card" style="align-items:stretch;flex-direction:column;gap:12px">
    <div><b>📍 รายงานสถานที่เบิกไปใช้</b><div class="muted" style="font-size:13px">สรุปว่าแต่ละสถานที่เบิกสินค้าอะไรไปบ้าง แยกจากคลังต้นทางชัดเจน</div></div>
    <div class="muted" style="font-size:13px">${escapeHtml(scopeLabel)} • ${rows.length} รายการเบิกออก • คืนของ ${issueDestinationUnitText(summary.reduce((acc,s)=>{Object.entries(s.returnUnits||{}).forEach(([u,q])=>acc[u]=(acc[u]||0)+q);return acc;},{}))} • ${summary.length} สถานที่</div>
    ${preview}
    <div class="row report-export-actions"><button class="btn small primary" onclick="window.openIssueDestinationReport()">ดูรายงาน</button><button class="btn small green" onclick="window.exportIssueDestinationReportCSV()">📗 Excel/CSV</button><button class="btn small light" onclick="window.printIssueDestinationReportPDF()">📄 PDF</button></div>
  </div>`;
}
function getIssueDestinationReportCategories(rows=[]){
  return [...new Set((rows||[]).map(r=>String(r.category||'ไม่ระบุ').trim()||'ไม่ระบุ'))].sort((a,b)=>a.localeCompare(b,'th'));
}
function getIssueDestinationReportDestinations(rows=[]){
  return [...new Set((rows||[]).map(r=>String(r.destination||'ไม่ระบุสถานที่เบิกไปใช้').trim()||'ไม่ระบุสถานที่เบิกไปใช้'))].sort((a,b)=>{
    const ia=LOCATION_OPTIONS.indexOf(a), ib=LOCATION_OPTIONS.indexOf(b);
    if(ia===-1&&ib===-1) return a.localeCompare(b,'th');
    if(ia===-1) return 1;
    if(ib===-1) return -1;
    return ia-ib;
  });
}
function issueDestinationReportSelectHtml(id,items=[],selected='all',labelAll='ทั้งหมด',onchange=''){
  const safe=String(selected||'all');
  const valid=safe==='all' || items.includes(safe);
  const finalValue=valid?safe:'all';
  return `<select id="${escapeHtml(id)}" class="stock-balance-report-category" onchange="${onchange}"><option value="all" ${finalValue==='all'?'selected':''}>${escapeHtml(labelAll)}</option>${items.map(x=>`<option value="${escapeHtml(x)}" ${finalValue===x?'selected':''}>${escapeHtml(x)}</option>`).join('')}</select>`;
}
function currentIssueDestinationReportFilters(){
  return {
    query:String(document.getElementById('issueDestinationReportSearch')?.value ?? window._issueDestinationReportQuery ?? ''),
    category:String(document.getElementById('issueDestinationReportCategory')?.value ?? window._issueDestinationReportCategory ?? 'all'),
    destination:String(document.getElementById('issueDestinationReportDestination')?.value ?? window._issueDestinationReportDestination ?? 'all')
  };
}
function filterIssueDestinationReportRows(rows=[],filters=currentIssueDestinationReportFilters()){
  const q=String(filters.query||'').toLowerCase().replace(/\s+/g,'');
  const category=String(filters.category||'all');
  const destination=String(filters.destination||'all');
  return (rows||[]).filter(r=>{
    const key=[r.name,r.sku,r.category,r.destination,r.sourceLocation,r.actor,r.reviewer,r.lot,r.note,r.statusLabel,r.fefo].filter(Boolean).join(' ').toLowerCase().replace(/\s+/g,'');
    return (!q || key.includes(q)) && (category==='all' || r.category===category) && (destination==='all' || r.destination===destination);
  });
}
window.setIssueDestinationModalDestination=(destination='all')=>{
  const sel=document.getElementById('issueDestinationReportDestination');
  if(sel) sel.value=destination||'all';
  window._issueDestinationReportDestination=destination||'all';
  window.filterIssueDestinationReportModal(document.getElementById('issueDestinationReportSearch')?.value||window._issueDestinationReportQuery||'');
  document.getElementById('issueDestinationReportList')?.scrollIntoView({behavior:'smooth',block:'start'});
};
window.filterIssueDestinationReportModal=(query='')=>{
  const filters=currentIssueDestinationReportFilters();
  filters.query=String(query||'');
  window._issueDestinationReportQuery=filters.query;
  window._issueDestinationReportCategory=filters.category;
  window._issueDestinationReportDestination=filters.destination;
  const rows=[...document.querySelectorAll('#issueDestinationReportList .stock-balance-report-row')];
  const q=filters.query.toLowerCase().replace(/\s+/g,'');
  let visible=0, totalQty=0, netQty=0, returnedQty=0;
  rows.forEach(row=>{
    const key=String(row.getAttribute('data-key')||'').toLowerCase().replace(/\s+/g,'');
    const rowCategory=String(row.getAttribute('data-category')||'');
    const rowDestination=String(row.getAttribute('data-destination')||'');
    const qty=Number(row.getAttribute('data-qty')||0)||0; const rowNet=Number(row.getAttribute('data-net-qty')||qty)||0; const rowReturned=Number(row.getAttribute('data-returned-qty')||0)||0;
    const show=(!q || key.includes(q)) && (filters.category==='all' || rowCategory===filters.category) && (filters.destination==='all' || rowDestination===filters.destination);
    row.style.display=show?'grid':'none';
    if(show){ visible++; totalQty+=qty; netQty+=rowNet; returnedQty+=rowReturned; }
  });
  const destinationLabel=filters.destination==='all'?'ทุกสถานที่':filters.destination;
  const categoryLabel=filters.category==='all'?'ทุกหมวดหมู่':filters.category;
  const countEl=document.getElementById('issueDestinationReportCount');
  if(countEl) countEl.textContent=`แสดง ${visible} รายการ • ${destinationLabel} • ${categoryLabel} • เบิก ${totalQty.toLocaleString('th-TH')} • คืน ${returnedQty.toLocaleString('th-TH')} • ใช้จริง ${netQty.toLocaleString('th-TH')} หน่วย`;
  const emptyEl=document.getElementById('issueDestinationReportEmpty');
  if(emptyEl) emptyEl.style.display=visible?'none':'block';
};
window.openIssueDestinationReportItemDetail=(rowId)=>{
  window._issueDestinationReportScroll=Number(document.querySelector('#modal .sheet')?.scrollTop||0);
  const r=(window._issueDestinationReportRows||[]).find(x=>x.id===rowId);
  if(!r){ toast('ไม่พบรายการนี้'); return; }
  const thumb=stockReportThumb(r.photo,r.name,'stock-balance-detail-img');
  const proof=r.proof?`<button class="history-detail-photo-button" type="button" onclick="window.openIssueDestinationReportProof('${rowId}')"><img class="history-detail-photo" src="${escapeHtml(r.proof)}" alt="หลักฐาน ${escapeHtml(r.name)}"><span>แตะรูปเพื่อขยายเต็มหน้าจอ</span></button>`:`<div class="history-no-photo">📷 ไม่มีรูปภาพแนบในรายการนี้</div>`;
  const lotBlock=r.lot?`<div><span>ล็อตสินค้า</span><b>${escapeHtml(r.lot)}</b></div><div><span>วันหมดอายุล็อต</span><b>${escapeHtml(r.expiryText)}</b></div>`:'';
  const skuBlock=r.sku?`<div><span>SKU</span><b>${escapeHtml(r.sku)}</b></div>`:'';
  openModal('รายละเอียดสถานที่เบิกไปใช้',`<div class="stock-balance-detail-modal inout-report-detail issue-destination-detail">
    <div class="stock-balance-detail-hero">
      <div class="stock-balance-detail-thumb">${thumb}</div>
      <div class="stock-balance-detail-head"><span class="pill warn">📤 เบิกออก</span><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.category)}</small><div class="stock-balance-badges"><span class="stock-balance-badge status-${r.statusKey}">${escapeHtml(r.statusLabel)}</span><span class="stock-balance-badge min">${escapeHtml(r.fefo)}</span></div></div>
    </div>
    <div class="stock-balance-detail-stock"><span>จำนวนที่เบิก / คืน / ใช้จริง</span><strong>${Number(r.qty)||0} / ${Number(r.returnedQty)||0} / ${Number(r.netQty)||0} ${escapeHtml(r.unit)}</strong></div>
    <div class="stock-balance-detail-grid">
      <div><span>วันที่</span><b>${escapeHtml(r.dateText)}</b></div>
      <div><span>เวลา</span><b>${escapeHtml(r.timeText)}</b></div>
      <div><span>เบิกไปใช้ที่</span><b>${escapeHtml(r.destination)}</b></div>
      <div><span>เบิกจาก</span><b>${escapeHtml(r.sourceLocation)}</b></div>
      <div><span>ผู้เบิกสินค้า</span><b>${escapeHtml(r.actor)}</b></div>
      <div><span>ผู้อนุมัติ</span><b>${escapeHtml(r.reviewer&&r.reviewer!=='-'?r.reviewer:'ยังไม่ระบุ')}</b></div>
      <div><span>สถานะคืนของ</span><b>${escapeHtml(r.returnLabel||'ยังไม่มีคืนของ')}</b></div>
      ${skuBlock}${lotBlock}
      ${r.note?`<div class="stock-balance-detail-wide"><span>หมายเหตุ / เหตุผล</span><b>${escapeHtml(r.note)}</b></div>`:''}
    </div>
    <section class="history-detail-section"><h3>รูปหลักฐาน</h3>${proof}</section>
    <div class="row stock-balance-detail-actions"><button class="btn light" onclick="window.openIssueDestinationReport(window._issueDestinationReportDestination||'all',true)">← กลับรายงาน</button><button class="btn primary" onclick="hideModal();window.viewProduct('${escapeHtml(r.productId)}')" ${r.productId?'':'disabled'}>ไปหน้าสต๊อกสินค้า</button></div>
  </div>`);
};
window.openIssueDestinationReportProof=(rowId)=>{
  const r=(window._issueDestinationReportRows||[]).find(x=>x.id===rowId);
  if(!r?.proof){ toast('ไม่พบรูปหลักฐาน'); return; }
  openModal('รูปหลักฐาน',`<div class="history-photo-viewer"><img src="${escapeHtml(r.proof)}" alt="หลักฐาน ${escapeHtml(r.name)}"><button class="btn light full" onclick="window.openIssueDestinationReportItemDetail('${rowId}')">← กลับรายละเอียด</button></div>`);
};
window.openIssueDestinationReport=(destination='all',preserveScroll=false)=>{
  const rows=getIssueDestinationReportRows();
  window._issueDestinationReportRows=rows;
  const destinations=getIssueDestinationReportDestinations(rows);
  const categories=getIssueDestinationReportCategories(rows);
  const selectedDestination=preserveScroll?(window._issueDestinationReportDestination||destination||'all'):(destination||'all');
  const selectedCategory=preserveScroll?(window._issueDestinationReportCategory||'all'):'all';
  const query=preserveScroll?(window._issueDestinationReportQuery||''):'';
  window._issueDestinationReportDestination=selectedDestination;
  window._issueDestinationReportCategory=selectedCategory;
  window._issueDestinationReportQuery=query;
  const summary=summarizeIssueDestinationRows(rows);
  const summaryCards=summary.length?`<div class="issue-destination-summary-grid">${summary.map(s=>`<button type="button" class="issue-destination-summary-card" onclick="window.setIssueDestinationModalDestination(decodeURIComponent('${encodeURIComponent(s.destination)}'))"><span>📍 ${escapeHtml(s.destination)}</span><b>${s.tx} รายการ</b><small>เบิก ${issueDestinationUnitText(s.units)} • คืน ${issueDestinationUnitText(s.returnUnits)} • ใช้จริง ${issueDestinationUnitText(s.netUnits)}</small></button>`).join('')}</div>`:`<div class="dashboard-empty ok">ยังไม่มีรายการเบิกออกตามสถานที่ในช่วงเวลานี้</div>`;
  const bodyRows=rows.map(r=>{
    const thumb=stockReportThumb(r.photo,r.name,'stock-balance-report-img');
    const skuText=r.sku?` • SKU: ${escapeHtml(r.sku)}`:'';
    const lotBadge=r.lot?`<span class="stock-balance-badge min">ล็อต ${escapeHtml(r.lot)}</span>`:'';
    const proofBadge=r.proof?`<span class="stock-balance-badge status-ok">มีรูปหลักฐาน</span>`:`<span class="stock-balance-badge min">ไม่มีรูป</span>`;
    const searchKey=escapeHtml([r.name,r.sku,r.category,r.destination,r.sourceLocation,r.actor,r.reviewer,r.lot,r.note,r.statusLabel,r.fefo].filter(Boolean).join(' '));
    return `<button type="button" class="stock-balance-report-row inout-report-row manager-inout-modal-fix-row status-${r.statusKey}" data-key="${searchKey}" data-category="${escapeHtml(r.category)}" data-destination="${escapeHtml(r.destination)}" data-qty="${Number(r.qty)||0}" data-returned-qty="${Number(r.returnedQty)||0}" data-net-qty="${Number(r.netQty)||0}" onclick="window.openIssueDestinationReportItemDetail('${r.id}')">
      <div class="stock-balance-report-thumb">${thumb}</div>
      <div class="stock-balance-report-info">
        <b>${escapeHtml(r.name)}</b>
        <small>${escapeHtml(r.category)}${skuText}</small>
        <strong>เบิก ${Number(r.qty)||0} • คืน ${Number(r.returnedQty)||0} • ใช้จริง ${Number(r.netQty)||0} ${escapeHtml(r.unit)} • ${escapeHtml(r.dateText)}</strong>
        <div class="stock-balance-badges"><span class="stock-balance-badge status-${r.statusKey}">${escapeHtml(r.statusLabel)}</span>${lotBadge}<span class="stock-balance-badge min">${escapeHtml(r.fefo)}</span>${proofBadge}</div>
        <small class="destination-source">📍 ไปใช้ที่: ${escapeHtml(r.destination)} • 🏠 เบิกจาก: ${escapeHtml(r.sourceLocation)} • ↩ ${escapeHtml(r.returnLabel||'ยังไม่มีคืนของ')}</small>
        <small>${escapeHtml(r.actor)}${r.reviewer&&r.reviewer!=='-'?` • อนุมัติ: ${escapeHtml(r.reviewer)}`:''}</small>
      </div>
      <span class="stock-balance-report-chevron">ดู</span>
    </button>`;
  }).join('');
  const filterPanel=rows.length?`<div class="stock-balance-report-filter-panel issue-destination-filter-panel"><label class="stock-balance-search-wrap"><span aria-hidden="true">🔍</span><input id="issueDestinationReportSearch" class="stock-balance-report-search" type="search" value="${escapeHtml(query)}" placeholder="ค้นหาสินค้า, ผู้เบิก, สถานที่, คลังต้นทาง หรือล็อต" oninput="window.filterIssueDestinationReportModal(this.value)"></label><label class="stock-balance-category-wrap"><span>สถานที่เบิกไปใช้</span>${issueDestinationReportSelectHtml('issueDestinationReportDestination',destinations,selectedDestination,'ทุกสถานที่เบิกไปใช้',"window._issueDestinationReportDestination=this.value;window.filterIssueDestinationReportModal(document.getElementById('issueDestinationReportSearch')?.value||'')")}</label><label class="stock-balance-category-wrap"><span>หมวดหมู่</span>${warningCategorySelectHtml('issueDestinationReportCategory',categories,selectedCategory,"window._issueDestinationReportCategory=this.value;window.filterIssueDestinationReportModal(document.getElementById('issueDestinationReportSearch')?.value||'')")}</label></div><div id="issueDestinationReportCount" class="stock-balance-report-count">แสดง ${rows.length} รายการ</div><div id="issueDestinationReportList" class="stock-balance-report-list">${bodyRows}</div><div id="issueDestinationReportEmpty" class="dashboard-empty" style="display:none">ไม่พบรายการตามตัวกรองนี้</div>`:'';
  openModal('รายงานสถานที่เบิกไปใช้',`<div class="stock-balance-report inout-report-modal manager-inout-modal-fix-modal"><p class="muted">${escapeHtml(getReportPeriodLabel())} • แยกให้เห็นว่าสถานที่ไหนเบิกสินค้าอะไรไปบ้าง และเบิกจากคลัง/พื้นที่ใด</p>${summaryCards}${filterPanel}<div class="row stock-balance-detail-actions inout-report-actions" style="margin-top:12px"><button class="btn light" onclick="hideModal()">ปิดรายงาน</button><button class="btn green" onclick="window.exportIssueDestinationReportCSV()">📗 Excel/CSV</button><button class="btn primary" onclick="window.printIssueDestinationReportPDF()">📄 PDF</button></div></div>`);
  requestAnimationFrame(()=>{
    window.filterIssueDestinationReportModal(query);
    if(preserveScroll){ const sheet=document.querySelector('#modal .sheet'); const y=Number(window._issueDestinationReportScroll||0); if(sheet&&y>0) sheet.scrollTop=y; }
    else window._issueDestinationReportScroll=0;
  });
};
async function loadIssueDestinationReportRowsForExport(){
  try{
    const rows=getIssueDestinationReportRows(await getReportSourceLogs());
    return rows;
  }catch(e){
    console.warn('โหลดรายงานสถานที่เบิกไปใช้จาก Firestore ไม่สำเร็จ ใช้ข้อมูลในเครื่องแทน',e);
    return getIssueDestinationReportRows();
  }
}
async function getIssueDestinationExportRows(){
  const modalOpen=!!document.getElementById('issueDestinationReportList');
  const base=modalOpen?(window._issueDestinationReportRows||getIssueDestinationReportRows()):(await loadIssueDestinationReportRowsForExport());
  return modalOpen?filterIssueDestinationReportRows(base,currentIssueDestinationReportFilters()):base;
}
window.exportIssueDestinationReportCSV=async()=>{
  const rows=await getIssueDestinationExportRows();
  if(!rows.length){ alert('ยังไม่มีข้อมูลรายงานสถานที่เบิกไปใช้ในช่วงเวลานี้'); return; }
  if(!confirmLargeExport('csv',rows.length)) return;
  const headers=['วันที่','เวลา','สถานที่เบิกไปใช้','เบิกจากคลัง/พื้นที่','สินค้า','หมวดหมู่','SKU','เบิกออก','คืนกลับ','ใช้จริงสุทธิ','หน่วย','ล็อต','วันหมดอายุล็อต','ผู้เบิก','ผู้อนุมัติ','สถานะ','FEFO','หมายเหตุ'];
  const lines=[
    [csvCell(`${appName()} — รายงานสถานที่เบิกไปใช้`)].join(','),
    [csvCell(`ช่วงเวลา: ${getReportPeriodLabel()} • สร้างเมื่อ ${new Date().toLocaleString('th-TH')}`)].join(','),
    [csvCell(`ทั้งหมด ${rows.length} รายการ`)].join(','),
    '',
    headers.map(csvCell).join(','),
    ...rows.map(r=>[r.dateText,r.timeText,r.destination,r.sourceLocation,r.name,r.category,r.sku,r.qty,r.returnedQty,r.netQty,r.unit,r.lot,r.expiryText,r.actor,r.reviewer,r.statusLabel,r.fefo,r.note].map(csvCell).join(','))
  ];
  const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=`CHEE_CHAN_STOCK_Issue_Destination_${toDateStr(new Date())}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.printIssueDestinationReportPDF=async()=>{
  const rows=await getIssueDestinationExportRows();
  if(!rows.length){ alert('ยังไม่มีข้อมูลรายงานสถานที่เบิกไปใช้ในช่วงเวลานี้'); return; }
  if(!confirmLargeExport('pdf',rows.length)) return;
  const summary=summarizeIssueDestinationRows(rows);
  const w=window.open('','_blank');
  if(!w){ alert('กรุณาอนุญาต Pop-up เพื่อสร้าง PDF'); return; }
  w.document.open();
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(appName())}_Issue_Destination</title><style>body{font-family:Arial,'Noto Sans Thai',sans-serif;padding:24px;color:#111827}h1{margin:0 0 6px}.meta{color:#64748b;margin-bottom:18px}.summary{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}.box{border:1px solid #cbd5e1;border-radius:10px;padding:8px 12px}.progress{margin:10px 0;color:#475569;font-size:13px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left;vertical-align:top}th{background:#eff6ff}@media print{body{padding:0}.no-print{display:none}}</style></head><body><button id="printBtn" class="no-print" disabled onclick="window.print()" style="float:right;padding:10px 16px">กำลังเตรียมเอกสาร...</button><h1>${escapeHtml(appName())} — รายงานสถานที่เบิกไปใช้</h1><div class="meta">${escapeHtml(getReportPeriodLabel())} • สร้างเมื่อ ${new Date().toLocaleString('th-TH')} • ${rows.length} รายการ</div><div class="summary">${summary.slice(0,8).map(s=>`<div class="box">${escapeHtml(s.destination)} <b>${s.tx}</b><br><small>${issueDestinationUnitText(s.units)}</small></div>`).join('')}</div><div id="buildProgress" class="progress no-print">กำลังเตรียมเอกสาร...</div><table><thead><tr><th>วันที่</th><th>สถานที่เบิกไปใช้</th><th>เบิกจาก</th><th>สินค้า</th><th>เบิก/คืน/ใช้จริง</th><th>ล็อต</th><th>ผู้เบิก</th><th>ผู้อนุมัติ</th><th>สถานะ</th><th>หมายเหตุ</th></tr></thead><tbody id="reportRows"></tbody></table></body></html>`);
  w.document.close();
  await writeRowsToPrintWindow(w,rows,r=>`<tr><td>${escapeHtml(r.dateText)}<br>${escapeHtml(r.timeText)}</td><td>${escapeHtml(r.destination)}</td><td>${escapeHtml(r.sourceLocation)}</td><td>${escapeHtml(r.name)}<br><small>${escapeHtml(r.category)}${r.sku?` • SKU: ${escapeHtml(r.sku)}`:''}</small></td><td style="text-align:right">${Number(r.qty)||0} / ${Number(r.returnedQty)||0} / ${Number(r.netQty)||0} ${escapeHtml(r.unit)}</td><td>${escapeHtml(r.lot||'-')}<br><small>${escapeHtml(r.expiryText||'')}</small></td><td>${escapeHtml(r.actor||'-')}</td><td>${escapeHtml(r.reviewer&&r.reviewer!=='-'?r.reviewer:'-')}</td><td>${escapeHtml(r.statusLabel)}<br><small>${escapeHtml(r.fefo)}</small></td><td>${escapeHtml(r.note||'')}</td></tr>`);
};


function renderReport(){
  normalizeReportState();

  const reportLocationCtx=reportLocationFilterContext();
  const reportScopeLabel=reportLocationScopeLabel(reportLocationCtx);
  const periodLogs = getReportPeriodLogs();
  let periodLabel;
  if(state.reportMode==='month'){
    const [y,m] = state.reportMonth.split('-').map(Number);
    periodLabel = `เดือน ${pad2(m)}/${y}`;
  } else if(state.reportMode==='range') {
    const start=parseLocalDate(state.reportStart), end=parseLocalDate(state.reportEnd);
    const a=start&&end&&start>end?end:start, b=start&&end&&start>end?start:end;
    periodLabel = a&&b ? `ช่วงวันที่ ${a.toLocaleDateString('th-TH')} – ${b.toLocaleDateString('th-TH')}` : 'ช่วงวันที่ที่เลือก';
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
  function productRows(items){
    if(!items.length) return `<div class="report-line-item report-line-item-empty"><span>ยังไม่มีข้อมูล</span><b>-</b></div>`;
    return items.map(p=>`<div class="report-line-item"><span>${escapeHtml(p.name)}</span><b>${p.qty} ${escapeHtml(p.unit||'หน่วย')}</b></div>`).join('');
  }
  function reportModeButton(mode,label){
    const active=state.reportMode===mode;
    return `<button class="report-mode-btn ${active?'active':''}" onclick="window.setReportMode('${mode}')">${escapeHtml(label)}</button>`;
  }
  function reportDashboardViewButton(viewKey,label,icon=''){
    const active=state.reportDashboardView===viewKey;
    return `<button class="report-dashboard-tab ${active?'active':''}" onclick="window.setReportDashboardView('${viewKey}')">${icon?`<span class="report-dashboard-tab-icon">${escapeHtml(icon)}</span>`:''}<span>${escapeHtml(label)}</span></button>`;
  }
  function reportFilterChip(value,label,tone){
    const active=state.reportFilter===value;
    return `<button class="report-filter-chip ${active?'active '+tone:''}" onclick="window.setReportFilter('${value}')">${escapeHtml(label)}</button>`;
  }
  function statTile(label,value,meta,tone=''){
    return `<div class="report-stat-tile ${tone}"><span>${escapeHtml(label)}</span><b>${escapeHtml(String(value))}</b><small>${escapeHtml(meta)}</small></div>`;
  }
  function movementCard(kind,title,headline,summary,onclick){
    const toneClass=kind==='receive'?'receive':'withdraw';
    const pillClass=kind==='receive'?'ok':'warn';
    const borderTone=kind==='receive'?'รวมรับเข้า':'รวมเบิกออก';
    const note='แตะเพื่อดูวันที่และจำนวนแต่ละรายการ';
    return `<article class="card report-movement-card ${toneClass}" onclick="${onclick}"><div class="report-movement-head"><div><div class="report-movement-label">${escapeHtml(title)}</div><h2>${escapeHtml(headline)}</h2></div><button class="pill ${pillClass}" style="border:0;cursor:pointer" onclick="event.stopPropagation();${onclick}">${summary.tx} รายการ ›</button></div><div class="report-line-list">${productRows(summary.products)}</div><div class="report-movement-foot"><span>${borderTone}</span><b>${summary.products.length} รายการ</b></div><div class="report-movement-note">${note}</div></article>`;
  }
  function emptyMovementCard(message){
    return `<div class="card report-movement-empty"><p class="muted" style="margin:0">${escapeHtml(message)}</p></div>`;
  }

  const receiveSummary=summarize(receiveLogs);
  const receiveCard = receiveLogs.length
    ? movementCard('receive','รับเข้าสินค้า',`📥 ${reportScopeLabel}`,receiveSummary,"window.openReportDetails('in','')")
    : (state.reportFilter==='out'?'':emptyMovementCard('ไม่มีรายการรับเข้าในช่วงเวลานี้'));

  const byLoc={};
  for(const l of withdrawLogs){
    const loc=reportMovementDisplayLocationLabel(l);
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
    return movementCard('withdraw','เบิกออกไปยัง',`📍 ${loc}`,sm,`window.openReportDetails('out',decodeURIComponent('${safeLoc}'))`);
  }).join('') || (state.reportFilter==='in'?'':emptyMovementCard('ไม่มีรายการเบิกออกในช่วงเวลานี้'));

  const allSummary=summarize(filtered), inSummary=summarize(receiveLogs), outSummary=summarize(withdrawLogs);
  const controls=state.reportMode==='month'
    ? `<div class="report-period-panel"><div class="report-period-nav">${reportDatePickerMarkup({kind:'month',label:'เลือกเดือน',value:state.reportMonth,onchange:'window.reportSetMonth(this.value)',prev:'window.reportShiftMonth(-1)',next:'window.reportShiftMonth(1)',prevLabel:'เดือนก่อนหน้า',nextLabel:'เดือนถัดไป'})}</div></div>`
    : state.reportMode==='range'
      ? `<div class="report-period-panel"><div class="report-range-grid">${reportDatePickerMarkup({kind:'date',label:'ตั้งแต่วันที่',value:state.reportStart,onchange:'window.reportSetRangeStart(this.value)',extraClass:'range-start'})}${reportDatePickerMarkup({kind:'date',label:'ถึงวันที่',value:state.reportEnd,onchange:'window.reportSetRangeEnd(this.value)',extraClass:'range-end'})}</div><div class="report-quick-actions"><button class="btn small light" onclick="window.reportToday()">วันนี้</button><button class="btn small light" onclick="window.reportYesterday()">เมื่อวาน</button><button class="btn small light" onclick="window.reportQuickRange(7)">7 วันล่าสุด</button><button class="btn small light" onclick="window.reportQuickRange(15)">15 วันล่าสุด</button><button class="btn small light" onclick="window.reportQuickRange(30)">30 วันล่าสุด</button><button class="btn small light" onclick="window.reportThisMonth()">เดือนนี้</button></div></div>`
      : `<div class="report-period-panel"><div class="report-period-nav">${reportDatePickerMarkup({kind:'date',label:'เลือกวันที่',value:state.reportDate,onchange:'window.reportSetDate(this.value)',prev:'window.reportShiftDay(-1)',next:'window.reportShiftDay(1)',prevLabel:'วันก่อนหน้า',nextLabel:'วันถัดไป'})}</div><div class="report-quick-actions"><button class="btn small light" onclick="window.reportToday()">วันนี้</button><button class="btn small light" onclick="window.reportYesterday()">เมื่อวาน</button><button class="btn small light" onclick="window.reportQuickRange(7)">7 วันล่าสุด</button><button class="btn small light" onclick="window.reportThisMonth()">เดือนนี้</button></div></div>`;

  const filterButtons = [
    reportFilterChip('all','ทั้งหมด','all'),
    reportFilterChip('in','รับเข้า','in'),
    reportFilterChip('out','เบิกออก','out')
  ].join('');
  const reportViewButtons=[
    reportDashboardViewButton('normal','รายงานปกติ','📋'),
    reportDashboardViewButton('manager','รายงานสำหรับหัวหน้า','👨‍💼')
  ].join('');

  const balanceRows=getStockBalanceRows();
  const lowStockRows=getLowStockReportRows();
  const lotExpiryRows=getLotExpiryReportRows();
  const fefoRows=getFefoExceptionRows(periodLogs);
  const managerSummary=renderManagerReportSummary(periodLabel,periodLogs,balanceRows,lowStockRows,lotExpiryRows,fefoRows,reportScopeLabel);
  const issueDestinationReportCard=renderIssueDestinationReportCard(periodLogs,reportScopeLabel);

  const detailType=['in','out'].includes(state.reportDetailType)?state.reportDetailType:'';
  const detailSummary=detailType==='in'?inSummary:outSummary;
  const detailSection=detailType ? `<section id="reportMovementSection" class="report-detail-section"><div class="card report-summary-card"><div class="report-section-head"><div><div class="dashboard-kicker">รายละเอียดรายงาน</div><h2>${detailType==='in'?'รายงานรับเข้า':'รายงานเบิกออก'} • ${escapeHtml(periodLabel)}</h2><p class="muted">แสดงเฉพาะข้อมูลที่เลือกจากการ์ดด้านบน • ตำแหน่ง ${escapeHtml(reportScopeLabel)}</p></div><button class="btn small light" onclick="window.clearReportDetail()">ปิดรายละเอียด</button></div><div class="report-top-stats report-top-stats-compact">${statTile(detailType==='in'?'รับเข้า':'เบิกออก',detailSummary.tx,unitText(detailSummary.units),detailType==='in'?'in':'out')}</div><div class="row report-export-actions" style="margin-top:12px;gap:8px"><button class="btn small green" onclick="window.exportReportCSV()">📗 Excel/CSV</button><button class="btn small primary" onclick="window.printReportPDF()">📄 PDF / พิมพ์</button></div></div>${detailType==='in'?receiveCard:withdrawCards}</section>` : '';

  const mainMovementSectionId=detailType?'reportMovementOverviewSection':'reportMovementSection';
  const normalReportSection=`<section id="${mainMovementSectionId}" class="report-overview-section"><div class="card report-summary-card"><div class="report-section-head"><div><div class="dashboard-kicker">ภาพรวมการเคลื่อนไหว</div><h2>สรุป ${escapeHtml(periodLabel)}</h2><p class="muted">ขอบเขตข้อมูล: ${escapeHtml(reportScopeLabel)}</p></div></div><div class="report-top-stats">${statTile('ทั้งหมด',allSummary.tx,unitText(allSummary.units),'all')}${state.reportFilter!=='out'?statTile('รับเข้า',inSummary.tx,unitText(inSummary.units),'in'):''}${state.reportFilter!=='in'?statTile('เบิกออก',outSummary.tx,unitText(outSummary.units),'out'):''}</div></div>${receiveCard}${withdrawCards}</section>${detailSection}<section class="report-tool-grid report-tool-grid-single">${issueDestinationReportCard}<div class="card report-export-card report-tool-card report-tool-card-wide"><div><b>ส่งออกรายงานการเคลื่อนไหว</b><div class="muted" style="font-size:13px">ใช้ช่วงเวลาและตัวกรองที่เลือกอยู่ พร้อมข้อมูลล็อต/FEFO ในไฟล์ส่งออก</div></div><div class="row report-export-actions"><button class="btn small green" onclick="window.exportReportCSV()">📗 Excel/CSV</button><button class="btn small primary" onclick="window.printReportPDF()">📄 PDF / พิมพ์</button></div></div></section>`;
  const managerReportSection=`${managerSummary}<section class="report-tool-grid"><div class="card report-export-card report-tool-card report-tool-card-wide"><div><b>ส่งออกรายงานการเคลื่อนไหว</b><div class="muted" style="font-size:13px">ใช้ช่วงเวลาและตัวกรองที่เลือกอยู่ พร้อมข้อมูลล็อต/FEFO ในไฟล์ส่งออก</div></div><div class="row report-export-actions"><button class="btn small green" onclick="window.exportReportCSV()">📗 Excel/CSV</button><button class="btn small primary" onclick="window.printReportPDF()">📄 PDF / พิมพ์</button></div></div>${issueDestinationReportCard}${renderStockBalanceExportCard()}${renderLowStockReportCard()}${renderLotExpiryReportCard()}${renderFefoExceptionReportCard(periodLogs)}</section>`;
  const selectedReportSection=state.reportDashboardView==='manager'?managerReportSection:normalReportSection;

  view.innerHTML=`<div class="report-page report-page-premium"><section class="report-page-head report-page-head-premium"><div class="report-title-wrap"><div class="dashboard-kicker">ศูนย์รายงาน</div><h1>📊 รายงานสต๊อก</h1><p>ดูภาพรวม ส่งออกเอกสาร และตรวจล็อตที่ต้องระวังแบบเป็นระเบียบ ใช้งานง่าย และรองรับทุกอุปกรณ์</p></div><div class="report-head-actions"><div class="report-view-switch">${reportViewButtons}</div></div></section>
  <section class="card report-control-card"><div class="report-mode-tabs">${reportModeButton('day','รายวัน')}${reportModeButton('month','รายเดือน')}${reportModeButton('range','ช่วงวันที่')}</div><div class="report-control-grid"><div class="report-control-main"><div class="report-section-caption">ช่วงเวลารายงาน</div>${controls}</div><div class="report-control-aside">${reportLocationFilterMarkup(reportLocationCtx)}</div></div><div class="report-type-block"><div class="report-section-caption">ประเภทข้อมูล</div><div class="report-filter-chips">${filterButtons}</div></div></section>
  ${selectedReportSection}</div>`;
}


function renderLotExpiryReportCard(){
  const rows=getLotExpiryReportRows();
  const urgent=rows.filter(r=>r?.meta && ['expired','today','urgent'].includes(r.meta.key)).length;
  const warning=Math.max(0, rows.length-urgent);
  return `<div id="lotExpiryReportCard" class="card report-export-card" style="align-items:stretch;flex-direction:column;gap:12px">
    <div><b>⏰ รายงานล็อตที่ต้องระวัง</b><div class="muted" style="font-size:13px">ล็อตใกล้หมดอายุหรือหมดอายุแล้ว อยู่ใต้รายงานสต๊อก</div></div>
    <div class="muted" style="font-size:13px">ทั้งหมด ${rows.length} ล็อต • เร่งด่วน ${urgent} • เฝ้าระวัง ${warning}</div>
    <div class="row report-export-actions"><button class="btn small primary" onclick="window.openLotExpiryReport()">ดูรายการ</button><button class="btn small green" onclick="window.exportLotExpiryCSV()">📗 Excel/CSV</button><button class="btn small light" onclick="window.printLotExpiryPDF()">📄 PDF</button><button class="btn small light" onclick="window.goToPage('stock',{filter:'expiry',resetScroll:true})">ไปสต๊อก</button></div>
  </div>`;
}

function getLotExpiryReportRows(){
  try{
    const products=reportScopedProducts();
    return products
      .filter(p=>p && !p.archived && !p.trashed)
      .flatMap(product=>{
        try{
          const names=lotDisplayMap(product);
          return activeProductLots(product).map((lot,index)=>({
            product,
            lot,
            displayNo:String(names.get(lot.id)||lotDisplayName(product,lot,index)||'-'),
            meta:lotExpiryMeta(lot)
          }));
        }catch(lotError){
          console.warn('ข้ามข้อมูลล็อตที่อ่านไม่ได้', product?.id||product?.name, lotError);
          return [];
        }
      })
      .filter(x=>x && x.meta && ['expired','today','urgent','warning'].includes(x.meta.key))
      .sort((a,b)=>(a.meta.days??999999)-(b.meta.days??999999)||String(a.displayNo||'').localeCompare(String(b.displayNo||''),'th',{numeric:true}));
  }catch(error){
    console.warn('สร้างรายงานล็อตที่ต้องระวังไม่สำเร็จ', error);
    return [];
  }
}
window.selectReportType=(filter='all')=>{
  const safeFilter=['in','out'].includes(filter)?filter:'all';
  state.reportFilter=safeFilter;
  state.reportDetailType='';
  saveUiState();
  if(['in','out'].includes(safeFilter)){
    // v34.29.23: Manager summary cards should open the same modal report as other manager cards.
    // The old behavior re-rendered an inline detail section that is not present in manager view, so tapping ดูรับเข้า/ดูเบิกออก looked like nothing happened.
    window._inOutReportSource='manager-summary';
    window.openReportDetails(safeFilter,'');
    return;
  }
  renderReport();
  setTimeout(()=>document.querySelector('.report-page-head')?.scrollIntoView({behavior:'smooth',block:'start'}),60);
};
window.clearReportDetail=()=>{
  state.reportDetailType='';
  state.reportFilter='all';
  saveUiState();
  renderReport();
  setTimeout(()=>document.querySelector('.report-page-head')?.scrollIntoView({behavior:'smooth',block:'start'}),60);
};
window.focusStockBalanceReport=()=>{
  if(state.page!=='report'){ goToPage('report',{resetScroll:true}); setTimeout(window.focusStockBalanceReport,120); return; }
  document.getElementById('stockBalanceReportCard')?.scrollIntoView({behavior:'smooth',block:'start'});
};

function getWarningReportCategories(rows=[]){
  return [...new Set(rows.map(r=>String(r.category||r.product?.category||'').trim()||'ไม่ระบุ'))].sort((a,b)=>a.localeCompare(b,'th'));
}
function warningCategorySelectHtml(id,categories=[],selected='all',onchange=''){
  const safe=selected||'all';
  return `<select id="${escapeHtml(id)}" class="stock-balance-report-category" onchange="${onchange}"><option value="all" ${safe==='all'?'selected':''}>ทุกหมวดหมู่</option>${categories.map(c=>`<option value="${escapeHtml(c)}" ${safe===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select>`;
}
function stockReportThumb(photo='',name='',cls='stock-balance-report-img'){
  const src=String(photo||'').trim();
  return src?productImageMarkup(src,name,cls):`<div class="stock-balance-report-placeholder">📦</div>`;
}
function lotWarningClass(key=''){
  return ['expired','today'].includes(key)?'status-out':'status-low';
}
function lotWarningBadgeClass(key=''){
  return ['expired','today'].includes(key)?'expiry-danger':'expiry-warn';
}
window.filterLowStockModal=(query='')=>{
  const q=String(query||'').toLowerCase().replace(/\s+/g,'');
  const category=String(document.getElementById('lowStockReportCategory')?.value||window._lowStockModalCategory||'all');
  window._lowStockModalCategory=category;
  const rows=[...document.querySelectorAll('#lowStockReportList .stock-balance-report-row')];
  let visible=0;
  rows.forEach(row=>{
    const key=String(row.getAttribute('data-key')||'').toLowerCase().replace(/\s+/g,'');
    const rowCategory=String(row.getAttribute('data-category')||'');
    const show=(!q || key.includes(q)) && (category==='all' || rowCategory===category);
    row.style.display=show?'grid':'none';
    if(show) visible++;
  });
  const categoryLabel=category==='all'?'ทุกหมวดหมู่':category;
  const countEl=document.getElementById('lowStockReportCount');
  if(countEl) countEl.textContent=q?`พบ ${visible} รายการจากทั้งหมด ${rows.length} รายการ • ${categoryLabel}`:`แสดง ${visible} รายการ • ${categoryLabel}`;
  const emptyEl=document.getElementById('lowStockReportEmpty');
  if(emptyEl) emptyEl.style.display=visible?'none':'block';
};
window.openLowStockItemDetail=(id)=>{
  window._lowStockModalQuery=String(document.getElementById('lowStockReportSearch')?.value||window._lowStockModalQuery||'');
  window._lowStockModalCategory=String(document.getElementById('lowStockReportCategory')?.value||window._lowStockModalCategory||'all');
  window._lowStockModalScroll=Number(document.querySelector('#modal .sheet')?.scrollTop||0);
  const r=getStockBalanceRowById(id);
  if(!r){ alert('ไม่พบข้อมูลสินค้านี้ในรายงาน'); window.openLowStockReport(window._lowStockModalQuery||'',true,window._lowStockModalCategory||'all'); return; }
  const statusKey=getStockBalanceStatusKey(r.status);
  const thumb=stockReportThumb(r.photo,r.name,'stock-balance-detail-img');
  const skuLine=r.sku?`<div><span>SKU</span><b>${escapeHtml(r.sku)}</b></div>`:'';
  openModal('รายละเอียดสินค้าใกล้หมด',`<div class="stock-balance-detail-modal">
    <div class="stock-balance-detail-hero">
      <div class="stock-balance-detail-thumb">${thumb}</div>
      <div class="stock-balance-detail-head">
        <b>${escapeHtml(r.name)}</b>
        <small>${escapeHtml(r.category)}</small>
        <div class="stock-balance-badges"><span class="stock-balance-badge status-${statusKey}">${escapeHtml(r.status)}</span><span class="stock-balance-badge min">จุดเตือน ${Number(r.min)||0} ${escapeHtml(r.unit)}</span></div>
      </div>
    </div>
    <div class="stock-balance-detail-stock"><span>ยอดคงเหลือปัจจุบัน</span><strong>${Number(r.stock)||0} ${escapeHtml(r.unit)}</strong></div>
    <div class="stock-balance-detail-grid">
      <div><span>หมวดหมู่</span><b>${escapeHtml(r.category)}</b></div>
      ${skuLine}
      <div><span>สถานะ</span><b>${escapeHtml(r.status)}</b></div>
      <div><span>จุดเตือน</span><b>${Number(r.min)||0} ${escapeHtml(r.unit)}</b></div>
      <div class="stock-balance-detail-wide"><span>วันหมดอายุใกล้สุด</span><b>${escapeHtml(getStockBalanceExpiryText(r))}</b></div>
      <div class="stock-balance-detail-wide"><span>ล็อตที่ควรระวัง</span><b>${escapeHtml(r.expiryLotNo||'ไม่พบล็อตคงเหลือ')}</b></div>
    </div>
    <p class="stock-balance-detail-note">หน้ารายละเอียดนี้ใช้ดูจากรายงานเท่านั้น หากต้องการแก้ไขหรือดูข้อมูลเต็ม ให้กดไปหน้าสต๊อกสินค้า</p>
    <div class="row stock-balance-detail-actions">
      <button class="btn light" onclick="window.openLowStockReport(window._lowStockModalQuery||'',true,window._lowStockModalCategory||'all')">← กลับไปรายการ</button>
      <button class="btn primary" onclick="hideModal();window.viewProduct('${escapeHtml(r.id)}')">ไปหน้าสต๊อกสินค้า</button>
    </div>
  </div>`);
};
window.openLowStockReport=(restoreQuery='',preserveScroll=false,restoreCategory='')=>{
  const rows=getLowStockReportRows();
  const categories=getWarningReportCategories(rows);
  const selectedCategory=String(preserveScroll?(restoreCategory||window._lowStockModalCategory||'all'):(window._lowStockModalCategory||'all'));
  const query=String(preserveScroll?(restoreQuery||window._lowStockModalQuery||''):(restoreQuery||''));
  window._lowStockModalQuery=query;
  window._lowStockModalCategory=selectedCategory;
  const body=rows.map(r=>{
    const statusKey=getStockBalanceStatusKey(r.status);
    const thumb=stockReportThumb(r.photo,r.name,'stock-balance-report-img');
    const skuText=r.sku?` • SKU: ${escapeHtml(r.sku)}`:'';
    const searchKey=escapeHtml([r.name,r.category,r.sku,r.status,r.expiryLabel,r.expiryStatusLabel,r.expiryLotNo].filter(Boolean).join(' '));
    return `<button type="button" class="stock-balance-report-row status-${statusKey}" data-key="${searchKey}" data-category="${escapeHtml(r.category)}" onclick="window.openLowStockItemDetail('${escapeHtml(r.id)}')">
      <div class="stock-balance-report-thumb">${thumb}</div>
      <div class="stock-balance-report-info">
        <b>${escapeHtml(r.name)}</b>
        <small>${escapeHtml(r.category)}${skuText}</small>
        <strong>${Number(r.stock)||0} ${escapeHtml(r.unit)}</strong>
        <div class="stock-balance-badges"><span class="stock-balance-badge status-${statusKey}">${escapeHtml(r.status)}</span><span class="stock-balance-badge min">จุดเตือน ${Number(r.min)||0} ${escapeHtml(r.unit)}</span>${getStockBalanceExpiryBadge(r)}</div>
      </div>
      <span class="stock-balance-report-chevron">ดู</span>
    </button>`;
  }).join('');
  const filterPanel=rows.length?`<div class="stock-balance-report-filter-panel"><label class="stock-balance-search-wrap"><span aria-hidden="true">🔍</span><input id="lowStockReportSearch" class="stock-balance-report-search" type="search" value="${escapeHtml(query)}" placeholder="ค้นหาชื่อสินค้า, SKU หรือหมวดหมู่" oninput="window._lowStockModalQuery=this.value;window.filterLowStockModal(this.value)"></label><label class="stock-balance-category-wrap"><span>เลือกหมวดหมู่</span>${warningCategorySelectHtml('lowStockReportCategory',categories,selectedCategory,"window._lowStockModalCategory=this.value;window.filterLowStockModal(document.getElementById('lowStockReportSearch')?.value||'')")}</label></div><div id="lowStockReportCount" class="stock-balance-report-count">แสดง ${rows.length} รายการ</div><div id="lowStockReportList" class="stock-balance-report-list">${body}</div><div id="lowStockReportEmpty" class="dashboard-empty" style="display:none">ไม่พบสินค้าที่ค้นหา</div>`:`<div class="dashboard-empty ok">✅ ยังไม่มีสินค้าใกล้หมดหรือหมดสต๊อก</div>`;
  openModal('รายงานสินค้าใกล้หมด / หมดสต๊อก',`<div class="lot-expiry-report stock-balance-report"><p class="muted">แสดงสินค้าใกล้หมดและหมดสต๊อก เรียงรายการที่ต้องรีบดูไว้บนสุด สามารถค้นหาหรือเลือกหมวดหมู่ได้</p>${filterPanel}<button class="btn light full" style="margin-top:12px" onclick="hideModal();window.goToPage('stock',{filter:'low',resetScroll:true})">ไปหน้าสต๊อก</button></div>`);
  requestAnimationFrame(()=>{
    window.filterLowStockModal(query);
    if(preserveScroll){ const sheet=document.querySelector('#modal .sheet'); const y=Number(window._lowStockModalScroll||0); if(sheet&&y>0) sheet.scrollTop=y; }
    else window._lowStockModalScroll=0;
  });
};
window.filterLotExpiryModal=(query='')=>{
  const q=String(query||'').toLowerCase().replace(/\s+/g,'');
  const category=String(document.getElementById('lotExpiryReportCategory')?.value||window._lotExpiryModalCategory||'all');
  window._lotExpiryModalCategory=category;
  const rows=[...document.querySelectorAll('#lotExpiryReportList .stock-balance-report-row')];
  let visible=0;
  rows.forEach(row=>{
    const key=String(row.getAttribute('data-key')||'').toLowerCase().replace(/\s+/g,'');
    const rowCategory=String(row.getAttribute('data-category')||'');
    const show=(!q || key.includes(q)) && (category==='all' || rowCategory===category);
    row.style.display=show?'grid':'none';
    if(show) visible++;
  });
  const categoryLabel=category==='all'?'ทุกหมวดหมู่':category;
  const countEl=document.getElementById('lotExpiryReportCount');
  if(countEl) countEl.textContent=q?`พบ ${visible} ล็อตจากทั้งหมด ${rows.length} ล็อต • ${categoryLabel}`:`แสดง ${visible} ล็อต • ${categoryLabel}`;
  const emptyEl=document.getElementById('lotExpiryReportEmpty');
  if(emptyEl) emptyEl.style.display=visible?'none':'block';
};
function findLotExpiryRow(productId='',lotKey=''){
  const pid=String(productId||''), lk=String(lotKey||'');
  return getLotExpiryReportRows().find(r=>String(r.product?.id||'')===pid && (String(r.lot?.id||'')===lk || String(r.displayNo||'')===lk));
}
window.openLotExpiryItemDetail=(productId,lotKey)=>{
  window._lotExpiryModalQuery=String(document.getElementById('lotExpiryReportSearch')?.value||window._lotExpiryModalQuery||'');
  window._lotExpiryModalCategory=String(document.getElementById('lotExpiryReportCategory')?.value||window._lotExpiryModalCategory||'all');
  window._lotExpiryModalScroll=Number(document.querySelector('#modal .sheet')?.scrollTop||0);
  const r=findLotExpiryRow(productId,lotKey);
  if(!r){ alert('ไม่พบล็อตนี้ในรายงาน'); window.openLotExpiryReport(window._lotExpiryModalQuery||'',true,window._lotExpiryModalCategory||'all'); return; }
  const product=r.product||{}, lot=r.lot||{}, meta=r.meta||lotExpiryMeta(lot);
  const thumb=stockReportThumb(product.photo,product.name,'stock-balance-detail-img');
  const daysText=typeof meta.days==='number'?(meta.days<0?`เลยวันหมดอายุ ${Math.abs(meta.days)} วัน`:`เหลือ ${meta.days} วัน`):'ไม่ระบุ';
  openModal('รายละเอียดล็อตที่ต้องระวัง',`<div class="stock-balance-detail-modal">
    <div class="stock-balance-detail-hero">
      <div class="stock-balance-detail-thumb">${thumb}</div>
      <div class="stock-balance-detail-head">
        <b>${escapeHtml(product.name||'-')}</b>
        <small>${escapeHtml(String(product.category||'').trim()||'ไม่ระบุ')}</small>
        <div class="stock-balance-badges"><span class="stock-balance-badge ${lotWarningBadgeClass(meta.key)}">${escapeHtml(meta.label)}</span><span class="stock-balance-badge min">${escapeHtml(r.displayNo||'-')}</span></div>
      </div>
    </div>
    <div class="stock-balance-detail-stock"><span>คงเหลือในล็อต</span><strong>${Number(lot.qty)||0} ${escapeHtml(product.unit||'')}</strong></div>
    <div class="stock-balance-detail-grid">
      <div><span>ล็อต</span><b>${escapeHtml(r.displayNo||'-')}</b></div>
      <div><span>สถานะ</span><b>${escapeHtml(meta.label||'-')}</b></div>
      <div><span>วันหมดอายุ</span><b>${escapeHtml(lotDateLabel(lot.expiryDate))}</b></div>
      <div><span>จำนวนวันที่เหลือ</span><b>${escapeHtml(daysText)}</b></div>
      <div class="stock-balance-detail-wide"><span>ยอดคงเหลือรวมของสินค้า</span><b>${Number(product.stock)||0} ${escapeHtml(product.unit||'')}</b></div>
    </div>
    <p class="stock-balance-detail-note">หน้ารายละเอียดนี้ใช้ดูจากรายงานเท่านั้น หากต้องการจัดการล็อต ให้กดไปหน้าสต๊อก / ล็อตสินค้า</p>
    <div class="row stock-balance-detail-actions">
      <button class="btn light" onclick="window.openLotExpiryReport(window._lotExpiryModalQuery||'',true,window._lotExpiryModalCategory||'all')">← กลับไปรายการ</button>
      <button class="btn primary" onclick="hideModal();window.viewProductLots('${escapeHtml(product.id||'')}')">ไปหน้าสต๊อก / ล็อตสินค้า</button>
    </div>
  </div>`);
};
window.openLotExpiryReport=(restoreQuery='',preserveScroll=false,restoreCategory='')=>{
  const rows=getLotExpiryReportRows();
  const categories=getWarningReportCategories(rows.map(r=>({category:String(r.product?.category||'').trim()||'ไม่ระบุ'})));
  const selectedCategory=String(preserveScroll?(restoreCategory||window._lotExpiryModalCategory||'all'):(window._lotExpiryModalCategory||'all'));
  const query=String(preserveScroll?(restoreQuery||window._lotExpiryModalQuery||''):(restoreQuery||''));
  window._lotExpiryModalQuery=query;
  window._lotExpiryModalCategory=selectedCategory;
  const body=rows.map(r=>{
    const product=r.product||{}, lot=r.lot||{}, meta=r.meta||lotExpiryMeta(lot);
    const category=String(product.category||'').trim()||'ไม่ระบุ';
    const thumb=stockReportThumb(product.photo,product.name,'stock-balance-report-img');
    const skuText=product.sku?` • SKU: ${escapeHtml(product.sku)}`:'';
    const searchKey=escapeHtml([product.name,category,product.sku,r.displayNo,lotDateLabel(lot.expiryDate),meta.label].filter(Boolean).join(' '));
    const lotKey=String(lot.id||r.displayNo||'');
    return `<button type="button" class="stock-balance-report-row ${lotWarningClass(meta.key)}" data-key="${searchKey}" data-category="${escapeHtml(category)}" onclick="window.openLotExpiryItemDetail('${escapeHtml(product.id||'')}','${escapeHtml(lotKey)}')">
      <div class="stock-balance-report-thumb">${thumb}</div>
      <div class="stock-balance-report-info">
        <b>${escapeHtml(product.name||'-')}</b>
        <small>${escapeHtml(category)}${skuText}</small>
        <strong>${escapeHtml(r.displayNo||'-')} • ${Number(lot.qty)||0} ${escapeHtml(product.unit||'')}</strong>
        <div class="stock-balance-badges"><span class="stock-balance-badge ${lotWarningBadgeClass(meta.key)}">${escapeHtml(meta.label)}</span><span class="stock-balance-badge min">หมดอายุ ${escapeHtml(lotDateLabel(lot.expiryDate))}</span></div>
      </div>
      <span class="stock-balance-report-chevron">ดู</span>
    </button>`;
  }).join('');
  const filterPanel=rows.length?`<div class="stock-balance-report-filter-panel"><label class="stock-balance-search-wrap"><span aria-hidden="true">🔍</span><input id="lotExpiryReportSearch" class="stock-balance-report-search" type="search" value="${escapeHtml(query)}" placeholder="ค้นหาชื่อสินค้า, ล็อต, SKU หรือหมวดหมู่" oninput="window._lotExpiryModalQuery=this.value;window.filterLotExpiryModal(this.value)"></label><label class="stock-balance-category-wrap"><span>เลือกหมวดหมู่</span>${warningCategorySelectHtml('lotExpiryReportCategory',categories,selectedCategory,"window._lotExpiryModalCategory=this.value;window.filterLotExpiryModal(document.getElementById('lotExpiryReportSearch')?.value||'')")}</label></div><div id="lotExpiryReportCount" class="stock-balance-report-count">แสดง ${rows.length} ล็อต</div><div id="lotExpiryReportList" class="stock-balance-report-list">${body}</div><div id="lotExpiryReportEmpty" class="dashboard-empty" style="display:none">ไม่พบล็อตที่ค้นหา</div>`:`<div class="dashboard-empty ok">✅ ยังไม่มีล็อตที่ต้องระวัง</div>`;
  openModal('รายงานล็อตที่ต้องระวัง',`<div class="lot-expiry-report stock-balance-report"><p class="muted">แสดงล็อตหมดอายุแล้ว / หมดอายุวันนี้ / เหลือไม่เกิน 30 วัน เรียงรายการเร่งด่วนไว้บนสุด พร้อมค้นหาและเลือกหมวดหมู่</p>${filterPanel}<button class="btn light full" style="margin-top:12px" onclick="hideModal();window.goToPage('stock',{filter:'expiry',resetScroll:true})">ไปหน้าสต๊อกใกล้หมดอายุ</button></div>`);
  requestAnimationFrame(()=>{
    window.filterLotExpiryModal(query);
    if(preserveScroll){ const sheet=document.querySelector('#modal .sheet'); const y=Number(window._lotExpiryModalScroll||0); if(sheet&&y>0) sheet.scrollTop=y; }
    else window._lotExpiryModalScroll=0;
  });
};

window.exportLowStockCSV=()=>{
  const rows=getLowStockReportRows();
  if(!rows.length){ alert('ยังไม่มีสินค้าใกล้หมดหรือหมดสต๊อก'); return; }
  const createdAt=new Date().toLocaleString('th-TH');
  const headers=['สินค้า','หมวดหมู่','SKU','คงเหลือ','หน่วย','จุดเตือน','สถานะ'];
  const lines=[
    [csvCell(`${appName()} — รายงานสินค้าใกล้หมด / หมดสต๊อก`)].join(','),
    [csvCell(`สร้างเมื่อ ${createdAt}`)].join(','),
    '',
    headers.map(csvCell).join(','),
    ...rows.map(r=>[r.name,r.category,r.sku,r.stock,r.unit,r.min,r.status].map(csvCell).join(','))
  ];
  const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=`CHEE_CHAN_STOCK_Low_Stock_${toDateStr(new Date())}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.printLowStockPDF=async()=>{
  const rows=getLowStockReportRows();
  if(!rows.length){ alert('ยังไม่มีสินค้าใกล้หมดหรือหมดสต๊อก'); return; }
  if(!confirmLargeExport('pdf',rows.length)) return;
  const w=window.open('','_blank');
  if(!w){ alert('กรุณาอนุญาต Pop-up เพื่อสร้าง PDF'); return; }
  w.document.open();
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(appName())}_Low_Stock</title><style>body{font-family:Arial,'Noto Sans Thai',sans-serif;padding:24px;color:#111827}h1{margin:0 0 6px}.meta{color:#64748b;margin-bottom:18px}.progress{margin:10px 0;color:#475569;font-size:13px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #cbd5e1;padding:7px;text-align:left}th{background:#fff7ed}@media print{body{padding:0}.no-print{display:none}}</style></head><body><button id="printBtn" class="no-print" disabled onclick="window.print()" style="float:right;padding:10px 16px">กำลังเตรียมเอกสาร...</button><h1>${escapeHtml(appName())} — รายงานสินค้าใกล้หมด / หมดสต๊อก</h1><div class="meta">สร้างเมื่อ ${new Date().toLocaleString('th-TH')} • ${rows.length} รายการ</div><div id="buildProgress" class="progress no-print">กำลังเตรียมเอกสาร...</div><table><thead><tr><th>#</th><th>สินค้า</th><th>หมวดหมู่</th><th>SKU</th><th>คงเหลือ</th><th>หน่วย</th><th>จุดเตือน</th><th>สถานะ</th></tr></thead><tbody id="reportRows"></tbody></table></body></html>`);
  w.document.close();
  await writeRowsToPrintWindow(w,rows,(r,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.category)}</td><td>${escapeHtml(r.sku)}</td><td style="text-align:right;font-weight:700">${r.stock}</td><td>${escapeHtml(r.unit)}</td><td style="text-align:right">${r.min}</td><td>${escapeHtml(r.status)}</td></tr>`);
};
window.exportLotExpiryCSV=()=>{
  const rows=getLotExpiryReportRows();
  if(!rows.length){ alert('ยังไม่มีล็อตที่ต้องระวัง'); return; }
  const headers=['สินค้า','ล็อต','คงเหลือ','หน่วย','วันหมดอายุ','สถานะ'];
  const lines=[
    [csvCell(`${appName()} — รายงานล็อตที่ต้องระวัง`)].join(','),
    [csvCell(`สร้างเมื่อ ${new Date().toLocaleString('th-TH')}`)].join(','),
    '',
    headers.map(csvCell).join(','),
    ...rows.map(r=>[r.product.name,r.displayNo,Number(r.lot.qty)||0,r.product.unit||'',lotDateLabel(r.lot.expiryDate),r.meta.label].map(csvCell).join(','))
  ];
  const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=`CHEE_CHAN_STOCK_Lot_Expiry_${toDateStr(new Date())}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.printLotExpiryPDF=async()=>{
  const rows=getLotExpiryReportRows();
  if(!rows.length){ alert('ยังไม่มีล็อตที่ต้องระวัง'); return; }
  const w=window.open('','_blank'); if(!w){ alert('กรุณาอนุญาต Pop-up เพื่อสร้าง PDF'); return; }
  w.document.open();
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(appName())}_Lot_Expiry</title><style>body{font-family:Arial,'Noto Sans Thai',sans-serif;padding:24px;color:#111827}h1{margin:0 0 6px}.meta{color:#64748b;margin-bottom:18px}.progress{margin:10px 0;color:#475569;font-size:13px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #cbd5e1;padding:7px;text-align:left}th{background:#fff7ed}@media print{body{padding:0}.no-print{display:none}}</style></head><body><button id="printBtn" class="no-print" disabled onclick="window.print()" style="float:right;padding:10px 16px">กำลังเตรียมเอกสาร...</button><h1>${escapeHtml(appName())} — รายงานล็อตที่ต้องระวัง</h1><div class="meta">สร้างเมื่อ ${new Date().toLocaleString('th-TH')} • ${rows.length} ล็อต</div><div id="buildProgress" class="progress no-print">กำลังเตรียมเอกสาร...</div><table><thead><tr><th>#</th><th>สินค้า</th><th>ล็อต</th><th>คงเหลือ</th><th>วันหมดอายุ</th><th>สถานะ</th></tr></thead><tbody id="reportRows"></tbody></table></body></html>`);
  w.document.close();
  await writeRowsToPrintWindow(w,rows,(r,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(r.product.name||'-')}</td><td>${escapeHtml(r.displayNo)}</td><td style="text-align:right;font-weight:700">${Number(r.lot.qty)||0} ${escapeHtml(r.product.unit||'')}</td><td>${escapeHtml(lotDateLabel(r.lot.expiryDate))}</td><td>${escapeHtml(r.meta.label)}</td></tr>`);
};
window.filterFefoExceptionModal=(query='')=>{
  const q=String(query||'').toLowerCase().replace(/\s+/g,'');
  const category=String(document.getElementById('fefoExceptionReportCategory')?.value||window._fefoExceptionModalCategory||'all');
  window._fefoExceptionModalCategory=category;
  const rows=[...document.querySelectorAll('#fefoExceptionReportList .stock-balance-report-row')];
  let visible=0;
  rows.forEach(row=>{
    const key=String(row.getAttribute('data-key')||'').toLowerCase().replace(/\s+/g,'');
    const rowCategory=String(row.getAttribute('data-category')||'');
    const show=(!q || key.includes(q)) && (category==='all' || rowCategory===category);
    row.style.display=show?'grid':'none';
    if(show) visible++;
  });
  const categoryLabel=category==='all'?'ทุกหมวดหมู่':category;
  const countEl=document.getElementById('fefoExceptionReportCount');
  if(countEl) countEl.textContent=q?`พบ ${visible} รายการจากทั้งหมด ${rows.length} รายการ • ${categoryLabel}`:`แสดง ${visible} รายการ • ${categoryLabel}`;
  const emptyEl=document.getElementById('fefoExceptionReportEmpty');
  if(emptyEl) emptyEl.style.display=visible?'none':'block';
};
function findFefoExceptionRow(id=''){
  const sid=String(id||'');
  const rows=Array.isArray(window._fefoExceptionRows)?window._fefoExceptionRows:getFefoExceptionRows();
  return rows.find(r=>String(r.id||'')===sid);
}
window.openFefoExceptionItemDetail=(id)=>{
  window._fefoExceptionModalQuery=String(document.getElementById('fefoExceptionReportSearch')?.value||window._fefoExceptionModalQuery||'');
  window._fefoExceptionModalCategory=String(document.getElementById('fefoExceptionReportCategory')?.value||window._fefoExceptionModalCategory||'all');
  window._fefoExceptionModalScroll=Number(document.querySelector('#modal .sheet')?.scrollTop||0);
  const r=findFefoExceptionRow(id);
  if(!r){ alert('ไม่พบรายการ FEFO นี้ในรายงาน'); window.openFefoExceptionReport(window._fefoExceptionModalQuery||'',true,window._fefoExceptionModalCategory||'all'); return; }
  const thumb=stockReportThumb(r.photo,r.product,'stock-balance-detail-img');
  const skuLine=r.sku?`<div><span>SKU</span><b>${escapeHtml(r.sku)}</b></div>`:'';
  openModal('รายละเอียดเบิกไม่ตรง FEFO',`<div class="stock-balance-detail-modal fefo-detail-modal">
    <div class="stock-balance-detail-hero">
      <div class="stock-balance-detail-thumb">${thumb}</div>
      <div class="stock-balance-detail-head">
        <b>${escapeHtml(r.product)}</b>
        <small>${escapeHtml(r.category)}${r.sku?` • SKU: ${escapeHtml(r.sku)}`:''}</small>
        <div class="stock-balance-badges"><span class="stock-balance-badge expiry-warn">ไม่ตรง FEFO</span><span class="stock-balance-badge min">${escapeHtml(r.status)}</span><span class="stock-balance-badge ${r.acknowledged?'status-ok':'expiry-warn'}">${escapeHtml(r.ackLabel)}</span><span class="stock-balance-badge min">${Number(r.qty)||0} ${escapeHtml(r.unit)}</span></div>
      </div>
    </div>
    <div class="stock-balance-detail-stock fefo-warning-stock"><span>เหตุผลที่ไม่ทำตาม FEFO</span><strong>${escapeHtml(r.reason)}</strong></div>
    <div class="stock-balance-detail-grid">
      <div><span>วันที่ทำรายการ</span><b>${escapeHtml(r.date.toLocaleDateString('th-TH'))}</b></div>
      <div><span>เวลา</span><b>${escapeHtml(r.date.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}))}</b></div>
      <div><span>จำนวนที่เบิก</span><b>${Number(r.qty)||0} ${escapeHtml(r.unit)}</b></div>
      <div><span>สถานะรายการ</span><b>${escapeHtml(r.status)}</b></div>
      <div><span>ตำแหน่งสต็อก</span><b>${escapeHtml(r.location)}</b></div>
      <div><span>ล็อตที่ควรเบิกก่อน</span><b>${escapeHtml(r.expectedLot)}</b></div>
      <div><span>วันหมดอายุล็อตที่ควรเบิก</span><b>${escapeHtml(r.expectedExpiry)}</b></div>
      <div><span>ล็อตที่เลือกจริง</span><b>${escapeHtml(r.lot)}</b></div>
      <div><span>วันหมดอายุล็อตที่เลือก</span><b>${escapeHtml(r.expiry)}</b></div>
      <div><span>ผู้เบิก / ผู้ส่งรายการ</span><b>${escapeHtml(r.user||'-')}</b></div>
      <div><span>ผู้อนุมัติ</span><b>${escapeHtml(r.reviewer||'-')}</b></div>
      ${skuLine}
      <div class="stock-balance-detail-wide"><span>ที่มาของล็อตที่ควรเบิก</span><b>${escapeHtml(r.expectedSource)}</b></div>
      <div><span>สถานะรับทราบ</span><b>${escapeHtml(r.ackLabel)}</b></div>
      <div><span>ผู้ตรวจรับทราบ</span><b>${escapeHtml(r.ackBy||'-')}</b></div>
      <div class="stock-balance-detail-wide"><span>เวลารับทราบ</span><b>${escapeHtml(r.ackAt||'-')}</b></div>
    </div>
    <p class="stock-balance-detail-note">รายการนี้จะค้างแจ้งเตือนจนกว่า Manager/Admin จะกดตรวจรับทราบแล้ว หลังรับทราบแล้วยังอยู่ในรายงานย้อนหลังตามช่วงวันที่ที่เลือก</p>
    <div class="row stock-balance-detail-actions">
      <button class="btn light" onclick="window.openFefoExceptionReport(window._fefoExceptionModalQuery||'',true,window._fefoExceptionModalCategory||'all')">← กลับไปรายการ</button>
      ${!r.acknowledged ? (canAcknowledgeFefo()?`<button id="fefoAckBtn" class="btn green" onclick="window.acknowledgeFefoException('${escapeHtml(r.id)}')">✅ ตรวจรับทราบแล้ว</button>`:`<button class="btn light" disabled>รอ Manager/Admin รับทราบ</button>`) : `<button class="btn light" disabled>✅ รับทราบแล้ว</button>`}
      <button class="btn primary" onclick="hideModal();window.viewProduct('${escapeHtml(r.productId||'')}')" ${r.productId?'':'disabled'}>ไปหน้าสต๊อกสินค้า</button>
    </div>
  </div>`);
};

window.acknowledgeFefoException=async(id)=>{
  const r=findFefoExceptionRow(id);
  if(!r){ toast('ไม่พบรายการ FEFO'); return; }
  if(!canAcknowledgeFefo()){ toast('เฉพาะ Manager/Admin ที่ตรวจรับทราบรายการ FEFO ได้'); return; }
  if(r.acknowledged){ toast('รายการนี้รับทราบแล้ว'); return; }
  const raw=r.raw||{};
  const targetId=String(r.sourceId||raw.id||raw.logId||'');
  if(!targetId){ alert('ไม่พบรหัสเอกสารสำหรับบันทึกรับทราบ'); return; }
  const isApproval=r.sourceType==='approval' || raw.__source==='approval';
  const targetRef=isApproval?approvalRef(targetId):logDocRef(targetId);
  const actorUid=state.user?.uid||'', actorName=state.profile?.displayName||state.profile?.username||'ไม่ทราบผู้ใช้';
  const payload={
    fefoAckRequired:true,
    fefoAcknowledged:true,
    fefoAcknowledgedAt:serverTimestamp(),
    fefoAcknowledgedByUid:actorUid,
    fefoAcknowledgedByName:actorName,
    updatedAt:serverTimestamp()
  };
  try{
    await updateDoc(targetRef,payload);
    try{ await addAudit('ตรวจรับทราบ FEFO',`${r.product} • ${r.lot}`,{productId:r.productId,qty:r.qty,unit:r.unit,lotNo:r.lot,expectedLotNo:r.expectedLot,reason:r.reason,status:r.status,sourceType:r.sourceType,sourceId:targetId}); }catch(auditErr){ console.warn('บันทึก Audit รับทราบ FEFO ไม่สำเร็จ',auditErr); }
    if(isApproval){ const item=state.approvals.find(x=>String(x.id)===targetId); if(item) Object.assign(item,{fefoAckRequired:true,fefoAcknowledged:true,fefoAcknowledgedByUid:actorUid,fefoAcknowledgedByName:actorName,fefoAcknowledgedAt:new Date()}); }
    else { const item=state.logs.find(x=>String(x.id)===targetId); if(item) Object.assign(item,{fefoAckRequired:true,fefoAcknowledged:true,fefoAcknowledgedByUid:actorUid,fefoAcknowledgedByName:actorName,fefoAcknowledgedAt:new Date()}); }
    toast('ตรวจรับทราบ FEFO แล้ว');
    window.openFefoExceptionReport(window._fefoExceptionModalQuery||'',true,window._fefoExceptionModalCategory||'all');
  }catch(e){ console.error(e); toast(e?.message||'บันทึกรับทราบ FEFO ไม่สำเร็จ'); }
};
window.openFefoExceptionReport=async(restoreQuery='',preserveScroll=false,restoreCategory='')=>{
  let rows=[];
  try{ rows=getFefoExceptionRows(await getReportSourceLogs()); }catch(e){ console.warn(e); rows=getFefoExceptionRows(); }
  window._fefoExceptionRows=rows;
  const categories=getWarningReportCategories(rows);
  const selectedCategory=String(preserveScroll?(restoreCategory||window._fefoExceptionModalCategory||'all'):(window._fefoExceptionModalCategory||'all'));
  const query=String(preserveScroll?(restoreQuery||window._fefoExceptionModalQuery||''):(restoreQuery||''));
  window._fefoExceptionModalQuery=query;
  window._fefoExceptionModalCategory=selectedCategory;
  const body=rows.map(r=>{
    const thumb=stockReportThumb(r.photo,r.product,'stock-balance-report-img');
    const searchKey=escapeHtml([r.product,r.category,r.sku,r.lot,r.expectedLot,r.reason,r.user,r.location,r.status].filter(Boolean).join(' '));
    return `<button type="button" class="stock-balance-report-row status-low fefo-exception-row" data-key="${searchKey}" data-category="${escapeHtml(r.category)}" onclick="window.openFefoExceptionItemDetail('${escapeHtml(r.id)}')">
      <div class="stock-balance-report-thumb">${thumb}</div>
      <div class="stock-balance-report-info">
        <b>${escapeHtml(r.product)}</b>
        <small>${escapeHtml(r.category)}${r.sku?` • SKU: ${escapeHtml(r.sku)}`:''}</small>
        <strong>${Number(r.qty)||0} ${escapeHtml(r.unit)} • ${escapeHtml(r.lot)}</strong>
        <div class="stock-balance-badges"><span class="stock-balance-badge expiry-warn">ไม่ตรง FEFO</span><span class="stock-balance-badge min">${escapeHtml(r.status)}</span><span class="stock-balance-badge ${r.acknowledged?'status-ok':'expiry-warn'}">${escapeHtml(r.ackLabel)}</span><span class="stock-balance-badge min">ควรเบิก ${escapeHtml(r.expectedLot)}</span><span class="stock-balance-badge expiry-warn">${escapeHtml(r.date.toLocaleDateString('th-TH'))}</span></div>
        <small>เหตุผล: ${escapeHtml(r.reason)}</small>
      </div>
      <span class="stock-balance-report-chevron">ดู</span>
    </button>`;
  }).join('');
  const unack=getFefoUnackRows(rows).length;
  const ackBanner=rows.length?(unack?`<div class="fefo-ack-alert">⚠️ มีรายการ FEFO ค้างตรวจรับทราบ ${unack} รายการ รายการจะค้างเตือนจนกว่า Manager/Admin จะกดตรวจรับทราบแล้ว</div>`:`<div class="dashboard-empty ok" style="margin-bottom:12px">✅ ไม่มีรายการ FEFO ค้างรับทราบ</div>`):'';
  const filterPanel=rows.length?`<div class="stock-balance-report-filter-panel"><label class="stock-balance-search-wrap"><span aria-hidden="true">🔍</span><input id="fefoExceptionReportSearch" class="stock-balance-report-search" type="search" value="${escapeHtml(query)}" placeholder="ค้นหาสินค้า, ผู้เบิก, ล็อต, เหตุผล หรือหมวดหมู่" oninput="window._fefoExceptionModalQuery=this.value;window.filterFefoExceptionModal(this.value)"></label><label class="stock-balance-category-wrap"><span>เลือกหมวดหมู่</span>${warningCategorySelectHtml('fefoExceptionReportCategory',categories,selectedCategory,"window._fefoExceptionModalCategory=this.value;window.filterFefoExceptionModal(document.getElementById('fefoExceptionReportSearch')?.value||'')")}</label></div><div id="fefoExceptionReportCount" class="stock-balance-report-count">แสดง ${rows.length} รายการ</div><div id="fefoExceptionReportList" class="stock-balance-report-list">${body}</div><div id="fefoExceptionReportEmpty" class="dashboard-empty" style="display:none">ไม่พบรายการ FEFO ที่ค้นหา</div>`:`<div class="dashboard-empty ok">✅ ยังไม่มีรายการเบิกไม่ตรง FEFO ในช่วงวันที่เลือก และไม่มีรายการค้างรับทราบ</div>`;
  openModal('รายงานเบิกไม่ตรง FEFO',`<div class="lot-expiry-report stock-balance-report"><p class="muted">แสดงรายการเบิกออกที่เลือกล็อตใหม่กว่า ระบบบันทึกเหตุผล ผู้เบิก ล็อตที่เลือก และล็อตที่ควรเบิกก่อน เพื่อใช้ตรวจสอบย้อนหลัง</p>${ackBanner}${filterPanel}<button class="btn light full" style="margin-top:12px" onclick="hideModal()">ปิดรายงาน</button></div>`);
  requestAnimationFrame(()=>{
    window.filterFefoExceptionModal(query);
    if(preserveScroll){ const sheet=document.querySelector('#modal .sheet'); const y=Number(window._fefoExceptionModalScroll||0); if(sheet&&y>0) sheet.scrollTop=y; }
    else window._fefoExceptionModalScroll=0;
  });
};
window.exportFefoExceptionCSV=async()=>{
  let rows=[];
  try{ rows=getFefoExceptionRows(await getReportSourceLogs()); }catch(e){ console.error(e); alert('โหลดข้อมูลรายงาน FEFO ไม่สำเร็จ'); return; }
  if(!rows.length){ alert('ยังไม่มีรายการเบิกไม่ตรง FEFO ในช่วงวันที่เลือก'); return; }
  const headers=['วันที่','เวลา','สถานะรายการ','สินค้า','หมวดหมู่','SKU','จำนวน','หน่วย','ตำแหน่งสต็อก','ล็อตที่ควรเบิกก่อน','วันหมดอายุล็อตที่ควรเบิก','ล็อตที่เลือกจริง','วันหมดอายุล็อตที่เลือก','ผู้เบิก','ผู้อนุมัติ','เหตุผล'];
  const lines=[
    [csvCell(`${appName()} — รายงานเบิกไม่ตรง FEFO`)].join(','),
    [csvCell(`ช่วงเวลา: ${getReportPeriodLabel()} • สร้างเมื่อ ${new Date().toLocaleString('th-TH')}`)].join(','),
    '',
    headers.map(csvCell).join(','),
    ...rows.map(r=>[r.date.toLocaleDateString('th-TH'),r.date.toLocaleTimeString('th-TH'),r.status,r.ackLabel,r.ackBy,r.ackAt,r.product,r.category,r.sku,r.qty,r.unit,r.location,r.expectedLot,r.expectedExpiry,r.lot,r.expiry,r.user,r.reviewer,r.reason].map(csvCell).join(','))
  ];
  const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=`CHEE_CHAN_STOCK_FEFO_Exception_${toDateStr(new Date())}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.printFefoExceptionPDF=async()=>{
  let rows=[];
  try{ rows=getFefoExceptionRows(await getReportSourceLogs()); }catch(e){ console.error(e); alert('โหลดข้อมูลรายงาน FEFO ไม่สำเร็จ'); return; }
  if(!rows.length){ alert('ยังไม่มีรายการเบิกไม่ตรง FEFO ในช่วงวันที่เลือก'); return; }
  const w=window.open('','_blank'); if(!w){ alert('กรุณาอนุญาต Pop-up เพื่อสร้าง PDF'); return; }
  w.document.open();
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(appName())}_FEFO_Exception</title><style>body{font-family:Arial,'Noto Sans Thai',sans-serif;padding:24px;color:#111827}h1{margin:0 0 6px}.meta{color:#64748b;margin-bottom:18px}.progress{margin:10px 0;color:#475569;font-size:13px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left;vertical-align:top}th{background:#fff7ed}@media print{body{padding:0}.no-print{display:none}}</style></head><body><button id="printBtn" class="no-print" disabled onclick="window.print()" style="float:right;padding:10px 16px">กำลังเตรียมเอกสาร...</button><h1>${escapeHtml(appName())} — รายงานเบิกไม่ตรง FEFO</h1><div class="meta">${escapeHtml(getReportPeriodLabel())} • สร้างเมื่อ ${new Date().toLocaleString('th-TH')} • ${rows.length} รายการ</div><div id="buildProgress" class="progress no-print">กำลังเตรียมเอกสาร...</div><table><thead><tr><th>วันที่</th><th>สถานะ</th><th>รับทราบ</th><th>สินค้า</th><th>เบิก/คืน/ใช้จริง</th><th>ตำแหน่งสต็อก</th><th>ล็อตที่ควรเบิกก่อน</th><th>ล็อตที่เลือกจริง</th><th>ผู้เบิก</th><th>เหตุผล</th></tr></thead><tbody id="reportRows"></tbody></table></body></html>`);
  w.document.close();
  await writeRowsToPrintWindow(w,rows,r=>`<tr><td>${escapeHtml(r.date.toLocaleDateString('th-TH'))}<br>${escapeHtml(r.date.toLocaleTimeString('th-TH'))}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.ackLabel)}<br><small>${escapeHtml(r.ackBy||'')}</small></td><td>${escapeHtml(r.product)}<br><small>${escapeHtml(r.category)}${r.sku?` • SKU: ${escapeHtml(r.sku)}`:''}</small></td><td style="text-align:right">${r.qty} ${escapeHtml(r.unit)}</td><td>${escapeHtml(r.location)}</td><td>${escapeHtml(r.expectedLot)}<br><small>${escapeHtml(r.expectedExpiry)}</small></td><td>${escapeHtml(r.lot)}<br><small>${escapeHtml(r.expiry)}</small></td><td>${escapeHtml(r.user||'-')}</td><td>${escapeHtml(r.reason)}</td></tr>`);
};

function getActiveProducts(){
  return accessibleProducts(state.products.filter(p=>!p.archived && !p.trashed));
}
function getStockCategories(){
  return [...new Set(getActiveProducts().map(p=>String(p.category||'').trim()||'ไม่ระบุ'))].sort((a,b)=>a.localeCompare(b,'th'));
}
function getStockBalanceRowsForCategory(category='all'){
  const selectedCategory=category||'all';
  const priority={ 'หมด':0, 'ใกล้หมด':1, 'ปกติ':2 };
  return reportScopedProducts()
    .filter(p=>selectedCategory==='all' || (String(p.category||'').trim()||'ไม่ระบุ')===selectedCategory)
    .map(p=>{
      const stock=Number(p.stock)||0, min=Number(p.min)||0;
      const status=stock<=0?'หมด':(stock<=min?'ใกล้หมด':'ปกติ');
      const lot=earliestProductLot(p);
      const expiryMeta=lot?lotExpiryMeta(lot):{key:'missing',label:'ไม่ระบุวันหมดอายุ',days:null,icon:'⚪'};
      return {
        id:p.id||'',
        name:p.name||'',
        category:String(p.category||'').trim()||'ไม่ระบุ',
        sku:String(p.sku||'').trim(),
        photo:String(p.photo||'').trim(),
        stock,
        unit:p.unit||'หน่วย',
        min,
        status,
        expiryDate:lot?.expiryDate||'',
        expiryLabel:lot?.expiryDate?lotDateLabel(lot.expiryDate):'ไม่ระบุวันหมดอายุ',
        expiryStatusKey:expiryMeta.key,
        expiryStatusLabel:expiryMeta.label,
        expiryDays:expiryMeta.days,
        expiryLotNo:lot?lotDisplayName(p,lot):'',
        ...productStockLocationExtra(p),
        location:stockLocationPath(productStockLocationExtra(p))
      };
    })
    .sort((a,b)=>(priority[a.status]??9)-(priority[b.status]??9) || a.category.localeCompare(b.category,'th') || a.name.localeCompare(b.name,'th'));
}
function getStockBalanceRows(){
  return getStockBalanceRowsForCategory(state.balanceCategory||'all');
}
function getStockBalanceExpiryBadge(row={}){
  const key=row.expiryStatusKey||'missing';
  if(!row.expiryDate) return '<span class="stock-balance-badge expiry-missing">ไม่ระบุวันหมดอายุ</span>';
  const danger=['expired','today'].includes(key), warn=key==='warning';
  const cls=danger?'expiry-danger':(warn?'expiry-warn':'expiry-ok');
  return `<span class="stock-balance-badge ${cls}">หมดอายุ ${escapeHtml(row.expiryLabel)}</span>`;
}
function getStockBalanceExpiryText(row={}){
  if(!row.expiryDate) return 'ไม่ระบุวันหมดอายุ';
  return `${row.expiryLabel} • ${row.expiryStatusLabel||''}`;
}
function renderStockBalanceExportCard(){
  const categories=getStockCategories();
  if(state.balanceCategory!=='all' && !categories.includes(state.balanceCategory)) state.balanceCategory='all';
  const rows=getStockBalanceRows();
  const low=rows.filter(r=>r.status==='ใกล้หมด').length;
  const out=rows.filter(r=>r.status==='หมด').length;
  const ok=rows.length-low-out;
  return `<div id="stockBalanceReportCard" class="card report-export-card" style="align-items:stretch;flex-direction:column;gap:12px">
    <div><b>📦 รายงานยอดคงเหลือปัจจุบัน</b><div class="muted" style="font-size:13px">สรุปยอดสินค้าที่เหลืออยู่จริง ณ เวลาที่ส่งออก ไม่อิงช่วงวันที่</div></div>
    <select class="stock-sort-field" onchange="window.setBalanceCategory(this.value)">
      <option value="all" ${state.balanceCategory==='all'?'selected':''}>ทุกหมวดหมู่</option>
      ${categories.map(c=>`<option value="${escapeHtml(c)}" ${state.balanceCategory===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}
    </select>
    <div class="muted" style="font-size:13px">ทั้งหมด ${rows.length} • ปกติ ${ok} • ใกล้หมด ${low} • หมด ${out}</div>
    <div class="row report-export-actions"><button class="btn small primary" onclick="window.openStockBalanceReport()">ดูรายการ</button><button class="btn small green" onclick="window.exportStockBalanceCSV()">📗 Excel/CSV คงเหลือ</button><button class="btn small light" onclick="window.printStockBalancePDF()">📄 PDF คงเหลือ</button><button class="btn small light" onclick="window.goToStockBalancePage()">ไปหน้าสต๊อก</button></div>
  </div>`;
}
window.setBalanceCategory=(value)=>{ state.balanceCategory=value||'all'; saveUiState(); renderReport(); };
window.goToStockBalancePage=(categoryOverride='')=>{
  const category=categoryOverride || window._stockBalanceModalCategory || state.balanceCategory || 'all';
  state.stockCategory=category==='all'?'all':category;
  state.stockFilter='all';
  saveUiState();
  goToPage('stock',{filter:'all',resetScroll:true});
};
window.filterStockBalanceModal=(query='')=>{
  const q=String(query||'').toLowerCase().replace(/\s+/g,'');
  const category=String(document.getElementById('stockBalanceReportCategory')?.value||window._stockBalanceModalCategory||'all');
  window._stockBalanceModalCategory=category;
  const rows=[...document.querySelectorAll('#stockBalanceReportList .stock-balance-report-row')];
  let visible=0;
  rows.forEach(row=>{
    const key=String(row.getAttribute('data-key')||'').toLowerCase().replace(/\s+/g,'');
    const rowCategory=String(row.getAttribute('data-category')||'');
    const matchText=!q || key.includes(q);
    const matchCategory=category==='all' || rowCategory===category;
    const show=matchText && matchCategory;
    row.style.display=show?'grid':'none';
    if(show) visible++;
  });
  const countEl=document.getElementById('stockBalanceReportCount');
  const categoryLabel=category==='all'?'ทุกหมวดหมู่':category;
  if(countEl) countEl.textContent=q?`พบ ${visible} รายการจากทั้งหมด ${rows.length} รายการ • ${categoryLabel}`:`แสดง ${visible} รายการ • ${categoryLabel}`;
  const emptyEl=document.getElementById('stockBalanceReportEmpty');
  if(emptyEl) emptyEl.style.display=visible?'none':'block';
};
function getStockBalanceStatusKey(status=''){
  return status==='หมด'?'out':(status==='ใกล้หมด'?'low':'ok');
}
function getStockBalanceRowById(id=''){
  return getStockBalanceRowsForCategory('all').find(r=>String(r.id||'')===String(id||''));
}
window.openStockBalanceItemDetail=(id)=>{
  window._stockBalanceModalQuery=String(document.getElementById('stockBalanceReportSearch')?.value||window._stockBalanceModalQuery||'');
  window._stockBalanceModalCategory=String(document.getElementById('stockBalanceReportCategory')?.value||window._stockBalanceModalCategory||state.balanceCategory||'all');
  window._stockBalanceModalScroll=Number(document.querySelector('#modal .sheet')?.scrollTop||0);
  const r=getStockBalanceRowById(id);
  if(!r){ alert('ไม่พบข้อมูลสินค้านี้ในรายงาน'); window.openStockBalanceReport(window._stockBalanceModalQuery||''); return; }
  const statusKey=getStockBalanceStatusKey(r.status);
  const thumb=r.photo?productImageMarkup(r.photo,r.name,'stock-balance-detail-img'):`<div class="stock-balance-detail-placeholder">📦</div>`;
  const skuLine=r.sku?`<div><span>SKU</span><b>${escapeHtml(r.sku)}</b></div>`:'';
  openModal('รายละเอียดยอดคงเหลือ',`<div class="stock-balance-detail-modal">
    <div class="stock-balance-detail-hero">
      <div class="stock-balance-detail-thumb">${thumb}</div>
      <div class="stock-balance-detail-head">
        <b>${escapeHtml(r.name)}</b>
        <small>${escapeHtml(r.category)}</small>
        <div class="stock-balance-badges"><span class="stock-balance-badge status-${statusKey}">${escapeHtml(r.status)}</span><span class="stock-balance-badge min">จุดเตือน ${Number(r.min)||0} ${escapeHtml(r.unit)}</span></div>
      </div>
    </div>
    <div class="stock-balance-detail-stock"><span>ยอดคงเหลือปัจจุบัน</span><strong>${Number(r.stock)||0} ${escapeHtml(r.unit)}</strong></div>
    <div class="stock-balance-detail-grid">
      <div><span>หมวดหมู่</span><b>${escapeHtml(r.category)}</b></div>
      ${skuLine}
      <div><span>สถานะ</span><b>${escapeHtml(r.status)}</b></div>
      <div><span>จุดเตือน</span><b>${Number(r.min)||0} ${escapeHtml(r.unit)}</b></div>
      <div class="stock-balance-detail-wide"><span>วันหมดอายุใกล้สุด</span><b>${escapeHtml(getStockBalanceExpiryText(r))}</b></div>
      <div class="stock-balance-detail-wide"><span>ล็อตที่ควรระวัง</span><b>${escapeHtml(r.expiryLotNo||'ไม่พบล็อตคงเหลือ')}</b></div>
    </div>
    <p class="stock-balance-detail-note">หน้ารายละเอียดนี้ใช้ดูจากรายงานเท่านั้น หากต้องการแก้ไขหรือดูข้อมูลเต็ม ให้กดไปหน้าสต๊อกสินค้า</p>
    <div class="row stock-balance-detail-actions">
      <button class="btn light" onclick="window.openStockBalanceReport(window._stockBalanceModalQuery||'',true,window._stockBalanceModalCategory||'all')">← กลับไปรายการ</button>
      <button class="btn primary" onclick="hideModal();window.viewProduct('${escapeHtml(r.id)}')">ไปหน้าสต๊อกสินค้า</button>
    </div>
  </div>`);
};
window.openStockBalanceReport=(restoreQuery='',preserveScroll=false,restoreCategory='')=>{
  const rows=getStockBalanceRowsForCategory('all');
  const categories=getStockCategories();
  const selectedCategory=String(preserveScroll?(restoreCategory||window._stockBalanceModalCategory||state.balanceCategory||'all'):(state.balanceCategory||'all'));
  const query=String(preserveScroll?(restoreQuery||window._stockBalanceModalQuery||''):(restoreQuery||''));
  window._stockBalanceModalQuery=query;
  window._stockBalanceModalCategory=selectedCategory;
  const body=rows.map(r=>{
    const statusKey=getStockBalanceStatusKey(r.status);
    const thumb=r.photo?productImageMarkup(r.photo,r.name,'stock-balance-report-img'):`<div class="stock-balance-report-placeholder">📦</div>`;
    const skuText=r.sku?` • SKU: ${escapeHtml(r.sku)}`:'';
    const searchKey=escapeHtml([r.name,r.category,r.sku,r.status,r.expiryLabel,r.expiryStatusLabel,r.expiryLotNo].filter(Boolean).join(' '));
    return `<button type="button" class="stock-balance-report-row status-${statusKey}" data-key="${searchKey}" data-category="${escapeHtml(r.category)}" onclick="window.openStockBalanceItemDetail('${escapeHtml(r.id)}')">
      <div class="stock-balance-report-thumb">${thumb}</div>
      <div class="stock-balance-report-info">
        <b>${escapeHtml(r.name)}</b>
        <small>${escapeHtml(r.category)}${skuText}</small>
        <strong>${Number(r.stock)||0} ${escapeHtml(r.unit)}</strong>
        <div class="stock-balance-badges"><span class="stock-balance-badge status-${statusKey}">${escapeHtml(r.status)}</span><span class="stock-balance-badge min">จุดเตือน ${Number(r.min)||0} ${escapeHtml(r.unit)}</span>${getStockBalanceExpiryBadge(r)}</div>
      </div>
      <span class="stock-balance-report-chevron">ดู</span>
    </button>`;
  }).join('');
  const categoryOptions=`<select id="stockBalanceReportCategory" class="stock-balance-report-category" onchange="window._stockBalanceModalCategory=this.value;window.filterStockBalanceModal(document.getElementById('stockBalanceReportSearch')?.value||'')"><option value="all" ${selectedCategory==='all'?'selected':''}>ทุกหมวดหมู่</option>${categories.map(c=>`<option value="${escapeHtml(c)}" ${selectedCategory===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}</select>`;
  const listHtml=rows.length?`<div class="stock-balance-report-filter-panel"><label class="stock-balance-search-wrap"><span aria-hidden="true">🔍</span><input id="stockBalanceReportSearch" class="stock-balance-report-search" type="search" value="${escapeHtml(query)}" placeholder="ค้นหาชื่อสินค้า, SKU หรือหมวดหมู่" oninput="window._stockBalanceModalQuery=this.value;window.filterStockBalanceModal(this.value)"></label><label class="stock-balance-category-wrap"><span>เลือกหมวดหมู่</span>${categoryOptions}</label></div><div id="stockBalanceReportCount" class="stock-balance-report-count">แสดง ${rows.length} รายการ</div><div id="stockBalanceReportList" class="stock-balance-report-list">${body}</div><div id="stockBalanceReportEmpty" class="dashboard-empty" style="display:none">ไม่พบสินค้าที่ค้นหา</div>`:`<div class="dashboard-empty ok">ยังไม่มีสินค้าในระบบ</div>`;
  openModal('รายงานยอดคงเหลือปัจจุบัน',`<div class="lot-expiry-report stock-balance-report"><p class="muted">เลือกหมวดหมู่จากดรอปดาวน์ แล้วค้นหาชื่อสินค้า / SKU / หมวดหมู่ ได้ในช่องค้นหา • แสดงยอดสินค้าที่เหลืออยู่จริง ณ เวลาปัจจุบัน</p>${listHtml}<button class="btn light full" style="margin-top:12px" onclick="hideModal();window.goToStockBalancePage(window._stockBalanceModalCategory||'all')">ไปหน้าสต๊อก</button></div>`);
  requestAnimationFrame(()=>{
    window.filterStockBalanceModal(query);
    if(preserveScroll){
      const sheet=document.querySelector('#modal .sheet');
      const y=Number(window._stockBalanceModalScroll||0);
      if(sheet && y>0) sheet.scrollTop=y;
    }else{
      window._stockBalanceModalScroll=0;
    }
  });
};
window.exportStockBalanceCSV=()=>{
  const rows=getStockBalanceRows();
  if(!rows.length){ alert('ไม่มีสินค้าในหมวดหมู่ที่เลือก'); return; }
  const low=rows.filter(r=>r.status==='ใกล้หมด').length, out=rows.filter(r=>r.status==='หมด').length, ok=rows.length-low-out;
  const categoryLabel=state.balanceCategory==='all'?'ทุกหมวดหมู่':state.balanceCategory;
  const createdAt=new Date().toLocaleString('th-TH');
  const headers=['สินค้า','หมวดหมู่','SKU','คงเหลือ','หน่วย','จุดเตือน','สถานะ','วันหมดอายุใกล้สุด','ล็อต'];
  const lines=[
    [csvCell(`${appName()} — ยอดคงเหลือปัจจุบัน`)].join(','),
    [csvCell(`หมวดหมู่: ${categoryLabel} • สร้างเมื่อ ${createdAt}`)].join(','),
    [csvCell(`สินค้าทั้งหมด ${rows.length}`),csvCell(`ปกติ ${ok}`),csvCell(`ใกล้หมด ${low}`),csvCell(`หมด ${out}`)].join(','),
    '',
    headers.map(csvCell).join(','),
    ...rows.map(r=>[r.name,r.category,r.sku,r.stock,r.unit,r.min,r.status,getStockBalanceExpiryText(r),r.expiryLotNo||''].map(csvCell).join(','))
  ];
  const category=state.balanceCategory==='all'?'All':state.balanceCategory.replace(/[\\/:*?"<>|]+/g,'_');
  const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=`CHEE_CHAN_STOCK_Current_Balance_${category}_${toDateStr(new Date())}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.printStockBalancePDF=async()=>{
  const w=window.open('','_blank');
  if(!w){ alert('กรุณาอนุญาต Pop-up เพื่อสร้าง PDF'); return; }
  const rows=getStockBalanceRows();
  if(!rows.length){ w.close(); alert('ไม่มีสินค้าในหมวดหมู่ที่เลือก'); return; }
  if(!confirmLargeExport('pdf',rows.length)){ w.close(); return; }
  const low=rows.filter(r=>r.status==='ใกล้หมด').length, out=rows.filter(r=>r.status==='หมด').length, ok=rows.length-low-out;
  const category=state.balanceCategory==='all'?'ทุกหมวดหมู่':state.balanceCategory;
  w.document.open();
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(appName())}_Current_Balance</title><style>body{font-family:Arial,'Noto Sans Thai',sans-serif;padding:24px;color:#111827}h1{margin:0 0 6px}.meta{color:#64748b;margin-bottom:18px}.summary{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}.box{border:1px solid #cbd5e1;border-radius:10px;padding:9px 14px}.progress{margin:10px 0;color:#475569;font-size:13px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left;vertical-align:top}th{background:#eff6ff}@media print{body{padding:0}.no-print{display:none}}</style></head><body><button id="printBtn" class="no-print" disabled onclick="window.print()" style="float:right;padding:10px 16px">กำลังเตรียมเอกสาร...</button><h1>${escapeHtml(appName())} — ยอดคงเหลือปัจจุบัน</h1><div class="meta">หมวดหมู่: ${escapeHtml(category)} • สร้างเมื่อ ${new Date().toLocaleString('th-TH')}</div><div class="summary"><div class="box">สินค้าทั้งหมด <b>${rows.length}</b></div><div class="box">ปกติ <b>${ok}</b></div><div class="box">ใกล้หมด <b>${low}</b></div><div class="box">หมด <b>${out}</b></div></div><div id="buildProgress" class="progress no-print">กำลังเตรียมเอกสาร...</div><table><thead><tr><th>#</th><th>สินค้า</th><th>หมวดหมู่</th><th>SKU</th><th>คงเหลือ</th><th>หน่วย</th><th>จุดเตือน</th><th>สถานะ</th><th>วันหมดอายุใกล้สุด</th><th>ล็อต</th></tr></thead><tbody id="reportRows"></tbody></table></body></html>`);
  w.document.close();
  await writeRowsToPrintWindow(w,rows,(r,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.category)}</td><td>${escapeHtml(r.sku)}</td><td style="text-align:right;font-weight:700">${r.stock}</td><td>${escapeHtml(r.unit)}</td><td style="text-align:right">${r.min}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(getStockBalanceExpiryText(r))}</td><td>${escapeHtml(r.expiryLotNo||'-')}</td></tr>`);
};
function getReportDateBounds(){
  normalizeReportState();
  let start,end;
  if(state.reportMode==='month'){
    const [y,m]=(state.reportMonth||toMonthStr(new Date())).split('-').map(Number);
    start=new Date(y,m-1,1,0,0,0,0);
    end=new Date(y,m,0,23,59,59,999);
  }else if(state.reportMode==='range'){
    const a=parseLocalDate(state.reportStart||toDateStr(new Date()));
    const b=parseLocalDate(state.reportEnd||state.reportStart||toDateStr(new Date()));
    if(!a||!b) return null;
    const lo=a<=b?a:b, hi=a<=b?b:a;
    start=new Date(lo.getFullYear(),lo.getMonth(),lo.getDate(),0,0,0,0);
    end=new Date(hi.getFullYear(),hi.getMonth(),hi.getDate(),23,59,59,999);
  }else{
    const d=parseLocalDate(state.reportDate||toDateStr(new Date()));
    if(!d) return null;
    start=new Date(d.getFullYear(),d.getMonth(),d.getDate(),0,0,0,0);
    end=new Date(d.getFullYear(),d.getMonth(),d.getDate(),23,59,59,999);
  }
  return {start,end};
}
async function getReportSourceLogs(){
  const bounds=getReportDateBounds();
  if(!bounds) return [];
  const merged=new Map();
  const add=(item)=>{
    const date=getReportRecordDate(item)||getLogDate(item);
    if(!isDateWithinBounds(date,bounds)) return;
    const key=String(item.id||item.eventId||item.logId||`${item.productId||item.detail||'row'}-${date.getTime()}-${merged.size}`);
    merged.set(key,{...item,_d:date});
  };
  (state.logs||[]).forEach(add);
  try{
    const snap=await getDocs(query(userPath('logs'),where('createdAt','>=',Timestamp.fromDate(bounds.start)),where('createdAt','<=',Timestamp.fromDate(bounds.end)),orderBy('createdAt','desc')));
    snap.docs.forEach(d=>add({id:d.id,...d.data()}));
  }catch(e){
    console.warn('โหลดรายงานจาก Firestore ด้วย createdAt ไม่สำเร็จ ใช้ข้อมูลที่โหลดในเครื่องแทน',e);
  }
  return [...merged.values()].filter(l=>canAccessLogEntry(l)).sort((a,b)=>(getReportRecordDate(b)?.getTime()||0)-(getReportRecordDate(a)?.getTime()||0));
}
function confirmLargeExport(kind,count){
  const mobile=/iPhone|iPad|iPod|Android/i.test(navigator.userAgent||'');
  if(kind==='pdf' && count>5000){
    alert(`รายงานมี ${count.toLocaleString('th-TH')} รายการ ซึ่งมากเกินไปสำหรับ PDF ครั้งเดียว

กรุณาเลือกช่วงวันที่สั้นลง หรือใช้ Excel/CSV เพื่อป้องกัน Safari/มือถือค้าง`);
    return false;
  }
  if(kind==='pdf' && count>(mobile?1200:2500)){
    return confirm(`รายงานมี ${count.toLocaleString('th-TH')} รายการ
การสร้าง PDF อาจใช้เวลาหรือหน่วยความจำสูงบนอุปกรณ์นี้

ต้องการดำเนินการต่อหรือไม่?`);
  }
  if(kind==='csv' && count>30000){
    return confirm(`รายงานมี ${count.toLocaleString('th-TH')} รายการ
ไฟล์อาจมีขนาดใหญ่และใช้เวลาสร้างสักครู่

ต้องการดำเนินการต่อหรือไม่?`);
  }
  return true;
}
async function writeRowsToPrintWindow(w,rows,rowHtml,chunkSize=250){
  const tbody=w.document.getElementById('reportRows');
  const progress=w.document.getElementById('buildProgress');
  if(!tbody) return;
  for(let i=0;i<rows.length;i+=chunkSize){
    tbody.insertAdjacentHTML('beforeend',rows.slice(i,i+chunkSize).map((r,j)=>rowHtml(r,i+j)).join(''));
    if(progress) progress.textContent=`เตรียมเอกสาร ${Math.min(i+chunkSize,rows.length).toLocaleString('th-TH')} / ${rows.length.toLocaleString('th-TH')} รายการ`;
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(progress) progress.textContent=`พร้อมพิมพ์ ${rows.length.toLocaleString('th-TH')} รายการ`;
  const btn=w.document.getElementById('printBtn');
  if(btn){ btn.disabled=false; btn.textContent='พิมพ์ / บันทึกเป็น PDF'; }
}
function buildCurrentReportRows(sourceLogs=state.logs){
  const original=state.logs;
  if(sourceLogs!==state.logs) state.logs=sourceLogs;
  try{ return getCurrentReportRows(); }
  finally{ state.logs=original; }
}

function getCurrentReportRows(){
  const logs=getReportPeriodLogs();
  const filtered=state.reportFilter==='all'?logs:logs.filter(l=>l._type===state.reportFilter);
  return filtered.map(l=>{
    const product=state.products.find(p=>p.id===l.productId);
    const dt=getLogDate(l);
    return {
      date:dt?dt.toLocaleDateString('th-TH'):'',
      time:dt?dt.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'',
      type:l._type==='in'?'รับเข้า':'เบิกออก',
      product:product?.name||l.productName||l.detail||'ไม่ทราบสินค้า',
      qty:Number(l.qty)||0,
      unit:l.unit||product?.unit||'',
      location:reportMovementDisplayLocationLabel(l),
      user:l.submittedByName||l.userName||l.displayName||l.byName||l.createdByName||l.actorName||'',
      reviewer:l.reviewerName||'',
      status:l.status==='approved'?'อนุมัติ':l.status==='rejected'?'ปฏิเสธ':l.status==='pending'?'รออนุมัติ':'—',
      lot:l.lotNo||'',
      expiry:l.lotExpiryDate?lotDateLabel(l.lotExpiryDate):'',
      fefo:l._type==='out' ? (l.fefoCorrect===false?'ไม่ตรง FEFO':'ตรง FEFO') : '—',
      note:l.fefoOverrideReason||l.note||''
    };
  }).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
}
function reportFileBase(){
  const period=state.reportMode==='month'
    ? (state.reportMonth||toMonthStr(new Date()))
    : state.reportMode==='range'
      ? `${state.reportStart||toDateStr(new Date())}_to_${state.reportEnd||state.reportStart||toDateStr(new Date())}`
      : (state.reportDate||toDateStr(new Date()));
  const type=state.reportFilter==='in'?'receive':state.reportFilter==='out'?'withdraw':'all';
  const scope=reportLocationScopeLabel().replace(/[\\/:*?"<>|]+/g,'_').replace(/\s+/g,'_');
  return `CHEE_CHAN_STOCK_Report_${period}_${type}_${scope}`;
}
function csvCell(v){
  const t=String(v??'').replace(/"/g,'""');
  return `"${t}"`;
}
window.exportReportCSV=async()=>{
  let rows=[];
  try{ rows=buildCurrentReportRows(await getReportSourceLogs()); }catch(e){ console.error(e); alert('โหลดข้อมูลรายงานไม่สำเร็จ'); return; }
  if(!rows.length){ alert('ไม่มีข้อมูลในช่วงเวลาที่เลือก'); return; }
  if(!confirmLargeExport('csv',rows.length)) return;
  const period=state.reportMode==='month'
    ? `เดือน ${state.reportMonth}`
    : state.reportMode==='range'
      ? `ช่วงวันที่ ${state.reportStart} ถึง ${state.reportEnd}`
      : `วันที่ ${state.reportDate}`;
  const totalIn=rows.filter(r=>r.type==='รับเข้า').length;
  const totalOut=rows.filter(r=>r.type==='เบิกออก').length;
  const createdAt=new Date().toLocaleString('th-TH');
  const headers=['วันที่','เวลา','ประเภท','สินค้า','จำนวน','หน่วย','ตำแหน่ง/สถานที่เบิกไปใช้','ล็อต','วันหมดอายุ','FEFO','ผู้ทำรายการ','ผู้อนุมัติ/ผู้ปฏิเสธ','ผลการอนุมัติ','หมายเหตุ'];
  const lines=[
    [csvCell(appName())].join(','),
    [csvCell(`รายงานสต๊อก ${period} • สร้างเมื่อ ${createdAt}`)].join(','),
    [csvCell(`ทั้งหมด ${rows.length} รายการ`),csvCell(`รับเข้า ${totalIn}`),csvCell(`เบิกออก ${totalOut}`)].join(','),
    '',
    headers.map(csvCell).join(','),
    ...rows.map(r=>[r.date,r.time,r.type,r.product,r.qty,r.unit,r.location,r.lot,r.expiry,r.fefo,r.user,r.reviewer,r.status,r.note].map(csvCell).join(','))
  ];
  const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=reportFileBase()+'.csv'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.printReportPDF=async()=>{
  // Fast local pre-check prevents Safari from opening a blank tab when the current report already has no rows.
  // We still re-query Firestore below when local rows exist, so exported data remains authoritative.
  const localRows=getCurrentReportRows();
  if(!localRows.length){ alert('ไม่มีข้อมูลในช่วงเวลาที่เลือก'); return; }

  const w=window.open('','_blank');
  if(!w){ alert('กรุณาอนุญาต Pop-up เพื่อสร้าง PDF'); return; }
  w.document.write('<p style="font-family:sans-serif;padding:24px">กำลังโหลดข้อมูลรายงาน...</p>');
  let rows=[];
  try{ rows=buildCurrentReportRows(await getReportSourceLogs()); }catch(e){ console.error(e); try{w.close();}catch(_){} alert('โหลดข้อมูลรายงานไม่สำเร็จ'); return; }
  if(!rows.length){ try{w.close();}catch(_){} alert('ไม่มีข้อมูลในช่วงเวลาที่เลือก'); return; }
  if(!confirmLargeExport('pdf',rows.length)){ w.close(); return; }
  const period=state.reportMode==='month'?`เดือน ${state.reportMonth}`:state.reportMode==='range'?`ช่วงวันที่ ${state.reportStart} ถึง ${state.reportEnd}`:`วันที่ ${state.reportDate}`;
  const totalIn=rows.filter(r=>r.type==='รับเข้า').length, totalOut=rows.filter(r=>r.type==='เบิกออก').length;
  w.document.open();
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${reportFileBase()}</title><style>body{font-family:Arial,'Noto Sans Thai',sans-serif;padding:24px;color:#111827}h1{margin:0 0 6px}.meta{color:#64748b;margin-bottom:18px}.summary{display:flex;gap:12px;margin:14px 0;flex-wrap:wrap}.box{border:1px solid #cbd5e1;border-radius:10px;padding:10px 16px}.progress{margin:10px 0;color:#475569;font-size:13px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #cbd5e1;padding:7px;text-align:left}th{background:#eff6ff}@media print{body{padding:0}.no-print{display:none}}</style></head><body><button id="printBtn" class="no-print" disabled onclick="window.print()" style="float:right;padding:10px 16px">กำลังเตรียมเอกสาร...</button><h1>${escapeHtml(appName())}</h1><div class="meta">รายงานสต๊อก ${escapeHtml(period)} • สร้างเมื่อ ${new Date().toLocaleString('th-TH')}</div><div class="summary"><div class="box">ทั้งหมด <b>${rows.length}</b> รายการ</div><div class="box">รับเข้า <b>${totalIn}</b></div><div class="box">เบิกออก <b>${totalOut}</b></div></div><div id="buildProgress" class="progress no-print">กำลังเตรียมเอกสาร...</div><table><thead><tr><th>วันที่</th><th>เวลา</th><th>ประเภท</th><th>สินค้า</th><th>เบิก/คืน/ใช้จริง</th><th>หน่วย</th><th>ตำแหน่งสต็อก</th><th>ล็อต</th><th>FEFO</th><th>ผู้ทำรายการ</th><th>ผู้อนุมัติ/ผู้ปฏิเสธ</th><th>ผลการอนุมัติ</th><th>หมายเหตุ</th></tr></thead><tbody id="reportRows"></tbody></table></body></html>`);
  w.document.close();
  await writeRowsToPrintWindow(w,rows,r=>`<tr><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.time)}</td><td>${escapeHtml(r.type)}</td><td>${escapeHtml(r.product)}</td><td style="text-align:right">${r.qty}</td><td>${escapeHtml(r.unit)}</td><td>${escapeHtml(r.location)}</td><td>${escapeHtml(r.lot)}</td><td>${escapeHtml(r.fefo)}</td><td>${escapeHtml(r.user)}</td><td>${escapeHtml(r.reviewer)}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.note)}</td></tr>`);
};

function applyReportStateAndRender(){
  normalizeReportState();
  saveUiState();
  renderReport();
}
window.setReportDashboardView=(view)=>{ state.reportDashboardView=['normal','manager'].includes(view)?view:'normal'; applyReportStateAndRender(); };
window.setReportMode=(mode)=>{ state.reportMode=['day','month','range'].includes(mode)?mode:'day'; state.reportDetailType=''; applyReportStateAndRender(); };
window.setReportFilter=(filter)=>{ state.reportFilter=['all','in','out'].includes(filter)?filter:'all'; applyReportStateAndRender(); };
window.setReportGroupFilter=(value)=>{ state.reportGroupFilter=value||'all'; state.reportAreaFilter='all'; state.reportDetailType=''; applyReportStateAndRender(); };
window.setReportAreaFilter=(value)=>{ state.reportAreaFilter=value||'all'; state.reportDetailType=''; applyReportStateAndRender(); };
window.reportShiftDay=(delta)=>{ state.reportDate=shiftDateStr(state.reportDate||toDateStr(new Date()),delta); state.reportMode='day'; state.reportDetailType=''; applyReportStateAndRender(); };
window.reportShiftMonth=(delta)=>{ state.reportMonth=shiftMonthStr(state.reportMonth||toMonthStr(new Date()),delta); state.reportMode='month'; state.reportDetailType=''; applyReportStateAndRender(); };
window.reportSetDate=(val)=>{ if(val){ state.reportDate=val; state.reportMode='day'; state.reportDetailType=''; applyReportStateAndRender(); } };
window.reportSetMonth=(val)=>{ if(val){ state.reportMonth=val; state.reportMode='month'; state.reportDetailType=''; applyReportStateAndRender(); } };
window.reportSetRangeStart=(val)=>{ if(val){ state.reportStart=val; if(state.reportEnd && val>state.reportEnd) state.reportEnd=val; state.reportMode='range'; state.reportDetailType=''; applyReportStateAndRender(); } };
window.reportSetRangeEnd=(val)=>{ if(val){ state.reportEnd=val; if(state.reportStart && val<state.reportStart) state.reportStart=val; state.reportMode='range'; state.reportDetailType=''; applyReportStateAndRender(); } };
window.reportQuickRange=(days)=>{ const end=new Date(); const start=new Date(); start.setDate(end.getDate()-Math.max(1,Number(days)||1)+1); state.reportStart=toDateStr(start); state.reportEnd=toDateStr(end); state.reportMode='range'; state.reportDetailType=''; applyReportStateAndRender(); };
window.reportToday=()=>{ const now=new Date(); const today=toDateStr(now); state.reportMode='day'; state.reportDate=today; state.reportStart=today; state.reportEnd=today; state.reportMonth=toMonthStr(now); state.reportDetailType=''; applyReportStateAndRender(); };
window.reportYesterday=()=>{ const y=new Date(); y.setDate(y.getDate()-1); const day=toDateStr(y); state.reportMode='day'; state.reportDate=day; state.reportStart=day; state.reportEnd=day; state.reportMonth=toMonthStr(y); state.reportDetailType=''; applyReportStateAndRender(); };
window.reportThisMonth=()=>{ const now=new Date(); state.reportMode='month'; state.reportMonth=toMonthStr(now); state.reportDate=toDateStr(now); state.reportStart=toDateStr(new Date(now.getFullYear(),now.getMonth(),1)); state.reportEnd=toDateStr(new Date(now.getFullYear(),now.getMonth()+1,0)); state.reportDetailType=''; applyReportStateAndRender(); };


function getInOutReportStatusLabel(l={}){
  const status=String(l.status||'').toLowerCase();
  if(status==='approved') return 'อนุมัติแล้ว';
  if(status==='rejected') return 'ปฏิเสธ';
  if(status==='pending') return 'รออนุมัติ';
  if(l.action==='อนุมัติ') return 'อนุมัติแล้ว';
  if(l.action==='ปฏิเสธ') return 'ปฏิเสธ';
  if(l.action==='ส่งตรวจ') return 'รออนุมัติ';
  return 'บันทึกแล้ว';
}
function getInOutReportStatusKey(label=''){
  if(String(label).includes('ปฏิเสธ')) return 'out';
  if(String(label).includes('รอ')) return 'low';
  return 'ok';
}
function getInOutReportRows(type='in', location=''){
  const safeType=type==='out'?'out':'in';
  const rows=getReportPeriodLogs()
    .filter(l=>l._type===safeType)
    .filter(l=> !location || reportMovementDisplayLocationLabel(l)===location)
    .sort((a,b)=>(b._d?.getTime?.()||0)-(a._d?.getTime?.()||0))
    .map((l,index)=>{
      const product=state.products.find(p=>p.id===l.productId) || {};
      const d=l._d || getLogDate(l) || new Date();
      const name=product.name || l.productName || l.name || l.detail || 'ไม่ทราบสินค้า';
      const category=product.category || l.category || 'ไม่ระบุ';
      const unit=l.unit || product.unit || 'หน่วย';
      const loc=reportMovementDisplayLocationLabel(l);
      const actor=l.submittedByName || l.actorName || l.userName || l.displayName || l.byName || l.createdByName || '-';
      const reviewer=l.reviewerName || l.approvedByName || l.rejectedByName || '-';
      const statusLabel=getInOutReportStatusLabel(l);
      const selectedLot=l.lotNo || l.lotName || '';
      const expiry=l.lotExpiryDate || l.expiryDate || '';
      const note=l.fefoOverrideReason || l.note || l.reason || '';
      const proof=String(l.photo||l.img||l.proof||l.image||l.attachmentPhoto||'').trim();
      const proofKind=proof?'proof':'none';
      return {
        id:`io-${safeType}-${index}-${String(l.id||l.eventId||l.productId||name).replace(/[^a-zA-Z0-9ก-๙_-]/g,'_')}`,
        sourceId:l.id||'', eventId:l.eventId||'', productId:l.productId||product.id||'',
        type:safeType, raw:l, product,
        name, sku:product.sku||l.sku||'', category, photo:product.photo||'',
        date:d, dateText:d.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'}),
        timeText:d.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
        qty:Number(l.qty)||0, unit, location:loc, actor, reviewer,
        statusLabel, statusKey:getInOutReportStatusKey(statusLabel),
        lot:selectedLot, expiry, expiryText:expiry?lotDateLabel(expiry):'ไม่ระบุ',
        fefo:l._type==='out' ? (l.fefoCorrect===false?'ไม่ตรง FEFO':'ตรง FEFO') : '—',
        note, proof, proofKind
      };
    });
  return rows;
}
function getInOutReportCategories(rows=[]){
  return [...new Set(rows.map(r=>String(r.category||'ไม่ระบุ').trim()||'ไม่ระบุ'))].sort((a,b)=>a.localeCompare(b,'th'));
}
window.filterInOutReportModal=(query='')=>{
  const q=String(query||'').toLowerCase().replace(/\s+/g,'');
  const category=String(document.getElementById('inOutReportCategory')?.value||window._inOutReportCategory||'all');
  window._inOutReportQuery=query;
  window._inOutReportCategory=category;
  const rows=[...document.querySelectorAll('#inOutReportList .stock-balance-report-row')];
  let visible=0;
  rows.forEach(row=>{
    const key=String(row.getAttribute('data-key')||'').toLowerCase().replace(/\s+/g,'');
    const rowCategory=String(row.getAttribute('data-category')||'');
    const show=(!q || key.includes(q)) && (category==='all' || rowCategory===category);
    row.style.display=show?'grid':'none';
    if(show) visible++;
  });
  const categoryLabel=category==='all'?'ทุกหมวดหมู่':category;
  const countEl=document.getElementById('inOutReportCount');
  if(countEl) countEl.textContent=q?`พบ ${visible} รายการจากทั้งหมด ${rows.length} รายการ • ${categoryLabel}`:`แสดง ${visible} รายการ • ${categoryLabel}`;
  const emptyEl=document.getElementById('inOutReportEmpty');
  if(emptyEl) emptyEl.style.display=visible?'none':'block';
};
window.openInOutReportItemDetail=(rowId)=>{
  const sheet=document.querySelector('#modal .sheet');
  window._inOutReportScroll=Number(sheet?.scrollTop||0);
  window._inOutReportQuery=String(document.getElementById('inOutReportSearch')?.value||window._inOutReportQuery||'');
  window._inOutReportCategory=String(document.getElementById('inOutReportCategory')?.value||window._inOutReportCategory||'all');
  const r=(window._inOutReportRows||[]).find(x=>x.id===rowId);
  if(!r){ toast('ไม่พบรายการนี้'); return; }
  const thumb=stockReportThumb(r.photo,r.name,'stock-balance-detail-img');
  const proofLabel=r.proofKind==='product'?'รูปสินค้า':'รูปหลักฐาน';
  const proof=r.proof?`<button class="history-detail-photo-button" type="button" onclick="window.openInOutReportProof('${rowId}')"><img class="history-detail-photo" src="${escapeHtml(r.proof)}" alt="${escapeHtml(proofLabel)} ${escapeHtml(r.name)}"><span>แตะรูปเพื่อขยายเต็มหน้าจอ</span></button>`:`<div class="history-no-photo">📷 ไม่มีรูปภาพแนบในรายการนี้</div>`;
  const lotBlock=r.lot?`<div><span>ล็อตสินค้า</span><b>${escapeHtml(r.lot)}</b></div>`:'';
  const expiryBlock=r.lot?`<div><span>วันหมดอายุล็อต</span><b>${escapeHtml(r.expiryText)}</b></div>`:'';
  const skuBlock=r.sku?`<div><span>SKU</span><b>${escapeHtml(r.sku)}</b></div>`:'';
  const title=r.type==='in'?'รายละเอียดรับเข้า':'รายละเอียดเบิกออก';
  const actorLabel=r.type==='in'?'ผู้รับสินค้า':'ผู้เบิกสินค้า';
  openModal(title,`<div class="stock-balance-detail-modal inout-report-detail">
    <div class="stock-balance-detail-hero">
      <div class="stock-balance-detail-thumb">${thumb}</div>
      <div class="stock-balance-detail-head">
        <span class="pill ${r.type==='in'?'ok':'warn'}">${r.type==='in'?'📥 รับเข้า':'📤 เบิกออก'}</span>
        <b>${escapeHtml(r.name)}</b>
        <small>${escapeHtml(r.category)}</small>
        <div class="stock-balance-badges"><span class="stock-balance-badge status-${r.statusKey}">${escapeHtml(r.statusLabel)}</span>${r.type==='out'?`<span class="stock-balance-badge min">${escapeHtml(r.fefo)}</span>`:''}</div>
      </div>
    </div>
    <div class="stock-balance-detail-stock"><span>จำนวนรายการ</span><strong>${Number(r.qty)||0} ${escapeHtml(r.unit)}</strong></div>
    <div class="stock-balance-detail-grid">
      <div><span>วันที่</span><b>${escapeHtml(r.dateText)}</b></div>
      <div><span>เวลา</span><b>${escapeHtml(r.timeText)}</b></div>
      <div><span>${actorLabel}</span><b>${escapeHtml(r.actor)}</b></div>
      <div><span>ผู้อนุมัติ</span><b>${escapeHtml(r.reviewer&&r.reviewer!=='-'?r.reviewer:'ยังไม่ระบุ')}</b></div>
      <div><span>ตำแหน่งสต็อก</span><b>${escapeHtml(r.location)}</b></div>
      <div><span>สถานะรายการ</span><b>${escapeHtml(r.statusLabel)}</b></div>
      ${skuBlock}${lotBlock}${expiryBlock}
      ${r.note?`<div class="stock-balance-detail-wide"><span>หมายเหตุ / เหตุผล</span><b>${escapeHtml(r.note)}</b></div>`:''}
    </div>
    <section class="history-detail-section"><h3>${escapeHtml(proofLabel)}</h3>${proof}</section>
    <p class="stock-balance-detail-note">หน้ารายละเอียดนี้ใช้ตรวจรายงานรับเข้า/เบิกออกย้อนหลัง หากต้องการแก้ไขหรือดูสินค้าเต็ม ให้กดไปหน้าสต๊อกสินค้า</p>
    <div class="row stock-balance-detail-actions">
      <button class="btn light" onclick="window.openReportDetails('${r.type}','${encodeURIComponent(r.location||'')} ',true)">← กลับไปรายการ</button>
      <button class="btn primary" onclick="hideModal();window.viewProduct('${escapeHtml(r.productId)}')" ${r.productId?'':'disabled'}>ไปหน้าสต๊อกสินค้า</button>
    </div>
  </div>`);
};
window.openInOutReportProof=(rowId)=>{
  const r=(window._inOutReportRows||[]).find(x=>x.id===rowId);
  if(!r?.proof){ toast('ไม่พบรูปหลักฐาน'); return; }
  const proofLabel=r.proofKind==='product'?'รูปสินค้า':'รูปหลักฐาน';
  openModal(proofLabel,`<div class="history-photo-viewer"><img src="${escapeHtml(r.proof)}" alt="${escapeHtml(proofLabel)} ${escapeHtml(r.name)}"><button class="btn light full" onclick="window.openInOutReportItemDetail('${rowId}')">← กลับรายละเอียด</button></div>`);
};

window.exportInOutReportModalCSV=()=>{
  const rows=window._inOutReportRows||[];
  if(!rows.length){ alert('ไม่มีข้อมูลในรายงานนี้'); return; }
  const typeLabel=rows[0]?.type==='in'?'รับเข้า':'เบิกออก';
  const createdAt=new Date().toLocaleString('th-TH');
  const headers=['วันที่','เวลา','ประเภท','สินค้า','หมวดหมู่','SKU','จำนวน','หน่วย','ตำแหน่ง/สถานที่เบิกไปใช้','ล็อต','วันหมดอายุล็อต','ผู้ทำรายการ','ผู้อนุมัติ','สถานะ','FEFO','มีรูปหลักฐาน','หมายเหตุ'];
  const lines=[
    [csvCell(appName())].join(','),
    [csvCell(`รายงาน${typeLabel} ${getReportPeriodLabel()} • สร้างเมื่อ ${createdAt}`)].join(','),
    [csvCell(`ทั้งหมด ${rows.length} รายการ`)].join(','),
    '',
    headers.map(csvCell).join(','),
    ...rows.map(r=>[r.dateText,r.timeText,typeLabel,r.name,r.category,r.sku,r.qty,r.unit,r.location,r.lot,r.expiryText,r.actor,r.reviewer,r.statusLabel,r.fefo,r.proof?'มี':'ไม่มี',r.note].map(csvCell).join(','))
  ];
  const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  const typeName=rows[0]?.type==='in'?'receive':'withdraw';
  a.href=url; a.download=`CHEE_CHAN_STOCK_${typeName}_${toDateStr(new Date())}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
window.printInOutReportModalPDF=()=>{
  const rows=window._inOutReportRows||[];
  if(!rows.length){ alert('ไม่มีข้อมูลในรายงานนี้'); return; }
  const typeLabel=rows[0]?.type==='in'?'รับเข้า':'เบิกออก';
  const w=window.open('','_blank');
  if(!w){ alert('กรุณาอนุญาต Pop-up เพื่อสร้าง PDF'); return; }
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(appName())} ${typeLabel}</title><style>body{font-family:Arial,'Noto Sans Thai',sans-serif;padding:24px;color:#111827}h1{margin:0}.meta{color:#64748b;margin:6px 0 16px}.summary{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}.box{border:1px solid #cbd5e1;border-radius:10px;padding:8px 12px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #cbd5e1;padding:7px;text-align:left;vertical-align:top}th{background:#eff6ff}.no-print{float:right;padding:10px 16px}@media print{body{padding:0}.no-print{display:none}}</style></head><body><button class="no-print" onclick="window.print()">พิมพ์ / บันทึกเป็น PDF</button><h1>${escapeHtml(appName())}</h1><div class="meta">รายงาน${typeLabel} ${escapeHtml(getReportPeriodLabel())} • สร้างเมื่อ ${escapeHtml(new Date().toLocaleString('th-TH'))}</div><div class="summary"><div class="box">ทั้งหมด <b>${rows.length}</b> รายการ</div></div><table><thead><tr><th>วันที่</th><th>เวลา</th><th>สินค้า</th><th>เบิก/คืน/ใช้จริง</th><th>ตำแหน่ง/สถานที่เบิกไปใช้</th><th>ล็อต</th><th>ผู้ทำรายการ</th><th>ผู้อนุมัติ</th><th>สถานะ</th><th>หมายเหตุ</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escapeHtml(r.dateText)}</td><td>${escapeHtml(r.timeText)}</td><td>${escapeHtml(r.name)}<br><small>${escapeHtml(r.category)}${r.sku?' • SKU '+escapeHtml(r.sku):''}</small></td><td style="text-align:right">${Number(r.qty)||0} ${escapeHtml(r.unit)}</td><td>${escapeHtml(r.location)}</td><td>${escapeHtml(r.lot||'-')}<br><small>${escapeHtml(r.expiryText||'')}</small></td><td>${escapeHtml(r.actor)}</td><td>${escapeHtml(r.reviewer&&r.reviewer!=='-'?r.reviewer:'-')}</td><td>${escapeHtml(r.statusLabel)}${r.type==='out'?'<br><small>'+escapeHtml(r.fefo)+'</small>':''}</td><td>${escapeHtml(r.note||'')}</td></tr>`).join('')}</tbody></table></body></html>`);
  w.document.close();
};
window.openReportDetails=(type,location='',preserveScroll=false)=>{
  const safeType=type==='out'?'out':'in';
  const safeLocation=decodeURIComponent(String(location||'')).trim();
  const rows=getInOutReportRows(safeType,safeLocation);
  window._inOutReportRows=rows;
  const categories=getInOutReportCategories(rows);
  const selectedCategory=preserveScroll?(window._inOutReportCategory||'all'):'all';
  const query=preserveScroll?(window._inOutReportQuery||''):'';
  window._inOutReportCategory=selectedCategory;
  window._inOutReportQuery=query;
  const totalQty=rows.reduce((s,r)=>s+(Number(r.qty)||0),0);
  const title=safeType==='in' ? `รายงานรับเข้า — ${safeLocation||reportLocationScopeLabel()}` : `รายงานเบิกออก — ${safeLocation||reportLocationScopeLabel()}`;
  const subtitle=safeType==='in'?'ตรวจรายการรับสินค้าเข้า ผู้รับสินค้า ล็อต วันหมดอายุ และรูปหลักฐาน':'ตรวจรายการเบิกสินค้าออก ผู้เบิก สถานที่เบิกไปใช้ ล็อต FEFO และรูปหลักฐาน';
  const bodyRows=rows.map(r=>{
    const thumb=stockReportThumb(r.photo,r.name,'stock-balance-report-img');
    const skuText=r.sku?` • SKU: ${escapeHtml(r.sku)}`:'';
    const lotBadge=r.lot?`<span class="stock-balance-badge min">ล็อต ${escapeHtml(r.lot)}</span>`:'';
    const expiryBadge=r.expiry?`<span class="stock-balance-badge expiry-ok">หมดอายุ ${escapeHtml(r.expiryText)}</span>`:'';
    const proofBadge=r.proof?`<span class="stock-balance-badge status-ok">มีรูปหลักฐาน</span>`:`<span class="stock-balance-badge min">ไม่มีรูป</span>`;
    const searchKey=escapeHtml([r.name,r.sku,r.category,r.location,r.actor,r.reviewer,r.lot,r.note,r.statusLabel,r.fefo].filter(Boolean).join(' '));
    return `<button type="button" class="stock-balance-report-row inout-report-row status-${r.statusKey}" data-key="${searchKey}" data-category="${escapeHtml(r.category)}" onclick="window.openInOutReportItemDetail('${r.id}')">
      <div class="stock-balance-report-thumb">${thumb}</div>
      <div class="stock-balance-report-info">
        <b>${escapeHtml(r.name)}</b>
        <small>${escapeHtml(r.category)}${skuText}</small>
        <strong>เบิก ${Number(r.qty)||0} • คืน ${Number(r.returnedQty)||0} • ใช้จริง ${Number(r.netQty)||0} ${escapeHtml(r.unit)} • ${escapeHtml(r.dateText)}</strong>
        <div class="stock-balance-badges"><span class="stock-balance-badge status-${r.statusKey}">${escapeHtml(r.statusLabel)}</span>${lotBadge}${expiryBadge}${proofBadge}${safeType==='out'?`<span class="stock-balance-badge min">${escapeHtml(r.fefo)}</span>`:''}</div>
        <small>${safeType==='in'?'ผู้รับสินค้า':'ผู้เบิก'}: ${escapeHtml(r.actor)} • 📍 ${escapeHtml(r.location)}</small>
      </div>
      <span class="stock-balance-report-chevron">ดู</span>
    </button>`;
  }).join('');
  const filterPanel=rows.length?`<div class="stock-balance-report-filter-panel"><label class="stock-balance-search-wrap"><span aria-hidden="true">🔍</span><input id="inOutReportSearch" class="stock-balance-report-search" type="search" value="${escapeHtml(query)}" placeholder="ค้นหาสินค้า, SKU, ผู้ทำรายการ, สถานที่เบิกไปใช้ หรือล็อต" oninput="window.filterInOutReportModal(this.value)"></label><label class="stock-balance-category-wrap"><span>เลือกหมวดหมู่</span>${warningCategorySelectHtml('inOutReportCategory',categories,selectedCategory,"window._inOutReportCategory=this.value;window.filterInOutReportModal(document.getElementById('inOutReportSearch')?.value||'')")}</label></div><div id="inOutReportCount" class="stock-balance-report-count">แสดง ${rows.length} รายการ • รวม ${totalQty} หน่วย</div><div id="inOutReportList" class="stock-balance-report-list">${bodyRows}</div><div id="inOutReportEmpty" class="dashboard-empty" style="display:none">ไม่พบรายการที่ค้นหา</div>`:`<div class="dashboard-empty">ยังไม่มีรายการ${safeType==='in'?'รับเข้า':'เบิกออก'}ในช่วงเวลานี้</div>`;
  openModal(title,`<div class="stock-balance-report inout-report-modal"><p class="muted">${escapeHtml(subtitle)} • ${escapeHtml(getReportPeriodLabel())}</p>${filterPanel}<div class="row stock-balance-detail-actions inout-report-actions" style="margin-top:12px"><button class="btn light" onclick="hideModal()">ปิดรายงาน</button><button class="btn green" onclick="window.exportInOutReportModalCSV()">📗 Excel/CSV</button><button class="btn primary" onclick="window.printInOutReportModalPDF()">📄 PDF</button></div></div>`);
  requestAnimationFrame(()=>{
    window.filterInOutReportModal(query);
    if(preserveScroll){ const sheet=document.querySelector('#modal .sheet'); const y=Number(window._inOutReportScroll||0); if(sheet&&y>0) sheet.scrollTop=y; }
    else window._inOutReportScroll=0;
  });
};

function isAdjustmentLog(log){
  const action=String(log?.action||'').trim();
  return action==='ปรับยอดสินค้า' || action==='ปรับยอดสต๊อก' || action==='ปรับยอด';
}

function historyTypeKey(log){
  if(isIssueReturnLog(log)) return 'return';
  if(log.action==='อนุมัติ') return 'approve';
  if(log.action==='ปฏิเสธ') return 'reject';
  if(log.action==='ส่งตรวจ') return 'pending';
  if(isAdjustmentLog(log)) return 'adjust';
  if(isReceiveLog(log)) return 'in';
  if(isWithdrawLog(log)) return 'out';
  return 'other';
}

// รายการหนึ่งอาจอยู่ได้มากกว่า 1 หมวด เช่น "อนุมัติ • รับเข้า"
// จึงต้องตรวจทั้งประเภทการเคลื่อนไหวและสถานะการอนุมัติ แทนการบังคับให้มีหมวดเดียว
function historyMatchesFilter(log, filter){
  if(filter==='all') return true;
  if(filter==='in') return isReceiveLog(log);
  if(filter==='out') return isWithdrawLog(log);
  if(filter==='return') return isIssueReturnLog(log);
  if(filter==='approve') return log.action==='อนุมัติ';
  if(filter==='reject') return log.action==='ปฏิเสธ';
  if(filter==='pending') return log.action==='ส่งตรวจ';
  if(filter==='adjust') return isAdjustmentLog(log);
  return historyTypeKey(log)===filter;
}

function historyAreaToken(groupId,areaId){ return stockAreaAccessKey(groupId,areaId); }
function historyLogStockLocation(log={}){
  const rawGroupId=String(log.stockGroupId||'').trim();
  const rawAreaId=String(log.stockAreaId||'').trim();
  if(rawGroupId){
    const structure=currentStockStructure();
    const group=structure.groups.find(g=>g.id===rawGroupId);
    const areas=group?visibleStockAreasForGroup(group,true):[];
    const area=areas.find(a=>a.id===rawAreaId);
    return {
      stockGroupId:rawGroupId,
      stockGroupName:String(log.stockGroupName||group?.name||'').trim(),
      stockAreaId:rawAreaId,
      stockAreaName:String(log.stockAreaName||area?.name||'').trim(),
      stockAreaPath:String(log.stockAreaPath||log.location||'').trim()
    };
  }
  const productId=String(log.productId||'').trim();
  if(productId){
    const product=state.products.find(p=>String(p.id)===productId);
    if(product) return productStockLocation(product);
  }
  const rawPath=String(log.stockAreaPath||log.location||'').replace(/\s+/g,' ').trim();
  const parts=rawPath.split('/').map(x=>cleanStockCardLocationPart(x)).filter(Boolean);
  return {
    stockGroupId:'',
    stockGroupName:String(log.stockGroupName||parts[0]||'').trim(),
    stockAreaId:'',
    stockAreaName:String(log.stockAreaName||parts.slice(1).join(' / ')||'').trim(),
    stockAreaPath:rawPath
  };
}
function historyLocationLabel(log={}){
  const loc=historyLogStockLocation(log);
  const group=cleanStockCardLocationPart(loc.stockGroupName||'');
  const area=cleanStockCardLocationPart(loc.stockAreaName||'');
  if(group && area) return `${group} / ${area}`;
  if(loc.stockAreaPath) return cleanStockCardLocationPart(loc.stockAreaPath);
  return log.location ? cleanStockCardLocationPart(log.location) : 'ตำแหน่งเดิม / ไม่ระบุพื้นที่';
}
function historyLocationFilterContext(){
  const groups=activeStockGroups();
  const restricted=!isStockAccessUnrestricted(state.profile||{});
  let selectedGroup=String(state.historyGroupFilter||'all');
  if(selectedGroup!=='all' && !groups.some(g=>g.id===selectedGroup)) selectedGroup='all';
  if(restricted && groups.length===1) selectedGroup=groups[0].id;
  if(state.historyGroupFilter!==selectedGroup) state.historyGroupFilter=selectedGroup;
  const areaPool=selectedGroup==='all'
    ? groups.flatMap(g=>activeStockAreas(g.id).map(a=>({...a,groupId:g.id,groupName:g.name,value:historyAreaToken(g.id,a.id),label:`${g.name} / ${a.name}`})))
    : activeStockAreas(selectedGroup).map(a=>{ const g=groups.find(x=>x.id===selectedGroup); return {...a,groupId:selectedGroup,groupName:g?.name||'',value:historyAreaToken(selectedGroup,a.id),label:a.name}; });
  let selectedArea=String(state.historyAreaFilter||'all');
  if(selectedArea!=='all' && !areaPool.some(a=>a.value===selectedArea)) selectedArea='all';
  if(restricted && areaPool.length===1 && selectedGroup!=='all') selectedArea=areaPool[0].value;
  if(state.historyAreaFilter!==selectedArea) state.historyAreaFilter=selectedArea;
  const lockGroup=!!(restricted && groups.length===1);
  const lockArea=!!(restricted && selectedGroup!=='all' && areaPool.length===1);
  return {groups,restricted,selectedGroup,areaPool,selectedArea,lockGroup,lockArea};
}
function logMatchesHistoryLocation(log,ctx=historyLocationFilterContext()){
  const loc=historyLogStockLocation(log);
  if(ctx.selectedGroup!=='all' && loc.stockGroupId!==ctx.selectedGroup) return false;
  if(ctx.selectedArea!=='all'){
    if(!loc.stockGroupId || !loc.stockAreaId) return false;
    return historyAreaToken(loc.stockGroupId,loc.stockAreaId)===ctx.selectedArea;
  }
  return true;
}
function historyLocationFilterMarkup(ctx=historyLocationFilterContext()){
  const showAllGroups=!ctx.restricted || ctx.groups.length>1;
  const groupOptions=[showAllGroups?`<option value="all" ${ctx.selectedGroup==='all'?'selected':''}>ทุกคลัง</option>`:'',...ctx.groups.map(g=>`<option value="${escapeHtml(g.id)}" ${ctx.selectedGroup===g.id?'selected':''}>${escapeHtml(g.name)}</option>`)].join('');
  const showAllAreas=!ctx.lockArea;
  const areaOptions=[showAllAreas?`<option value="all" ${ctx.selectedArea==='all'?'selected':''}>ทุกพื้นที่</option>`:'',...ctx.areaPool.map(a=>`<option value="${escapeHtml(a.value)}" ${ctx.selectedArea===a.value?'selected':''}>${escapeHtml(a.label)}</option>`)].join('');
  return `<div class="history-location-filter"><div class="history-location-filter-head"><span>📍</span><b>ตำแหน่งสต็อก</b></div><div class="history-location-filter-grid"><label><span>คลัง</span><select id="historyGroupFilter" onchange="window.setHistoryGroupFilter(this.value)" ${ctx.lockGroup?'disabled':''}>${groupOptions}</select></label><label><span>พื้นที่</span><select id="historyAreaFilter" onchange="window.setHistoryAreaFilter(this.value)" ${ctx.lockArea?'disabled':''}>${areaOptions}</select></label></div></div>`;
}

window.loadMoreHistory=async()=>{
  if(logsLoadingMore || !logsHasMore) return;
  logsLoadingMore=true;
  try{
    const qMore=logsCursor
      ? query(userPath('logs'),orderBy('createdAt','desc'),startAfter(logsCursor),limit(LOG_PAGE_SIZE))
      : query(userPath('logs'),orderBy('createdAt','desc'),limit(LOG_PAGE_SIZE));
    const snap=await getDocs(qMore);
    const existing=new Set(state.logs.map(x=>x.id));
    const more=snap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>!existing.has(x.id));
    state.logs=[...state.logs,...more].sort((a,b)=>(getLogDate(b)?.getTime()||0)-(getLogDate(a)?.getTime()||0));
    logsCursor=snap.docs[snap.docs.length-1]||logsCursor;
    logsHasMore=snap.docs.length===LOG_PAGE_SIZE;
    renderHistory();
    toast(more.length?`โหลดเพิ่ม ${more.length} รายการแล้ว`:'ไม่มีประวัติเก่ากว่านี้แล้ว');
  }catch(e){ console.error(e); toast('โหลดประวัติเพิ่มไม่สำเร็จ'); }
  finally{ logsLoadingMore=false; }
};

function isProductPhotoHistoryLog(log={}){
  const action=String(log.action||'').trim();
  return action.includes('เพิ่มสินค้า') || action.includes('อัปเดตรูปสินค้า') || action.includes('เปลี่ยนรูปสินค้า');
}
function historyProofPhoto(log={}){
  return String(log.photo||log.img||log.proof||log.image||log.attachmentPhoto||'').trim();
}
function historyProductPhoto(log={}){
  const loggedProductPhoto=String(log.productPhoto||log.productImage||log.productImg||log.productPhotoUrl||'').trim();
  if(loggedProductPhoto) return loggedProductPhoto;
  const productId=String(log.productId||'').trim();
  if(productId){
    const product=state.products.find(p=>String(p.id||'')===productId);
    const productPhoto=String(product?.photo||product?.image||product?.img||'').trim();
    if(productPhoto) return productPhoto;
  }
  return '';
}
function historyLogDisplayPhoto(log={}){
  const direct=historyProofPhoto(log);
  if(direct) return {url:direct,label:'รูปหลักฐาน',kind:'proof'};
  if(isProductPhotoHistoryLog(log)){
    const productPhoto=historyProductPhoto(log);
    if(productPhoto) return {url:productPhoto,label:'รูปสินค้า',kind:'product'};
  }
  return {url:'',label:'รูปหลักฐาน',kind:'none'};
}


function historyIssueDestinationLabel(log={}){
  if(!isWithdrawLog(log)) return '';
  const direct=String(log.destinationLocation||log.issueDestination||log.issueLocation||log.useLocation||'').trim();
  if(direct) return direct;
  const rawLocation=String(log.location||'').trim();
  const rawStock=String(log.stockLocation||log.stockAreaPath||'').trim();
  const cleanLoc=cleanStockCardLocationPart(rawLocation);
  const cleanStock=cleanStockCardLocationPart(rawStock);
  if(cleanLoc && (!cleanStock || cleanLoc!==cleanStock)) return cleanLoc;
  return 'ไม่ระบุสถานที่เบิกไปใช้';
}
function historyDestinationFilterOptions(logs=[]){
  const map=new Map();
  const add=(name)=>{
    const label=String(name||'').trim();
    if(!label) return;
    const key=normalizeProductNameKey(label)||label.toLowerCase();
    if(!map.has(key)) map.set(key,label);
  };
  try{
    activeStockGroups().forEach(g=>normalizeIssueDestinationList(g.issueDestinations||[]).forEach(add));
  }catch(_){ }
  (logs||[]).forEach(l=>{ if(isWithdrawLog(l)||isIssueReturnLog(l)) add(historyUseDestinationLabel(l)); });
  return [...map.values()].sort((a,b)=>a.localeCompare(b,'th',{numeric:true}));
}
function historyMatchesDestinationFilter(log={},selected='all'){
  if(!selected || selected==='all') return true;
  if(!isWithdrawLog(log) && !isIssueReturnLog(log)) return false;
  return normalizeProductNameKey(historyUseDestinationLabel(log))===normalizeProductNameKey(selected);
}
function historyDestinationFilterMarkup(options=[]){
  const selected=String(state.historyDestinationFilter||'all');
  const list=Array.isArray(options)?options:[];
  const valid=selected==='all' || list.some(x=>normalizeProductNameKey(x)===normalizeProductNameKey(selected));
  if(!valid) state.historyDestinationFilter='all';
  const safeSelected=String(state.historyDestinationFilter||'all');
  const optionHtml=list.map(name=>`<option value="${escapeHtml(name)}" ${normalizeProductNameKey(name)===normalizeProductNameKey(safeSelected)?'selected':''}>${escapeHtml(name)}</option>`).join('');
  return `<div class="history-destination-filter"><div class="history-destination-filter-head"><span>📌</span><b>สถานที่เบิกไปใช้</b></div><select id="historyDestinationFilter" onchange="window.setHistoryDestinationFilter(this.value)"><option value="all" ${safeSelected==='all'?'selected':''}>ทุกสถานที่เบิกไปใช้</option>${optionHtml}</select></div>`;
}

function historyMovementLocationMarkup(l={}){
  const stock=historyLocationLabel(l);
  const move=String(l.moveType||l.type||'').toLowerCase();
  const dest=historyIssueDestinationLabel(l);
  if(isIssueReturnLog(l)){
    const from=String(l.returnFromDestination||l.issueDestination||l.destinationLocation||'').trim();
    return `${from?`<span class="history-entry-location">↩ คืนจาก ${escapeHtml(from)}</span>`:''}${stock?`<span class="history-entry-location">🏠 กลับเข้าที่ ${escapeHtml(stock)}</span>`:''}`;
  }
  if(move==='out'){
    return `${dest?`<span class="history-entry-location">📍 เบิกไปใช้ที่ ${escapeHtml(dest)}</span>`:''}${stock?`<span class="history-entry-location">🏠 เบิกจาก ${escapeHtml(stock)}</span>`:''}`;
  }
  return stock?`<span class="history-entry-location">📍 ${escapeHtml(stock)}</span>`:'';
}

function issueReturnStockLocation(log={},product={}){
  const base={stockGroupId:log.stockGroupId||product.stockGroupId||'',stockGroupName:log.stockGroupName||product.stockGroupName||'',stockAreaId:log.stockAreaId||product.stockAreaId||'',stockAreaName:log.stockAreaName||product.stockAreaName||'',stockAreaPath:log.stockAreaPath||log.stockLocation||log.location||product.stockAreaPath||''};
  if(base.stockGroupId || base.stockGroupName || base.stockAreaId || base.stockAreaName || base.stockAreaPath) return base;
  return productStockLocation(product||{});
}
function canOpenIssueReturn(log={}){
  if(!canReturnIssue()) return false;
  if(!isApprovedIssueLog(log)) return false;
  if(remainingReturnQtyForIssueLog(log)<=0) return false;
  const product=state.products.find(p=>String(p.id||'')===String(log.productId||''));
  return !!(product && canAccessProduct(product));
}
function issueReturnActionMarkup(log={}){
  if(!isApprovedIssueLog(log)) return '';
  const remaining=remainingReturnQtyForIssueLog(log);
  const returned=returnedQtyForIssueLog(log);
  const summary=returned>0 ? `<div class="history-detail-note return-summary-note">↩ คืนแล้ว ${Number(returned).toLocaleString('th-TH')} ${escapeHtml(log.unit||'')} • ยังคืนได้ ${Number(remaining).toLocaleString('th-TH')} ${escapeHtml(log.unit||'')}</div>` : '';
  const button=canOpenIssueReturn(log) ? `<button class="btn green full" onclick="window.openIssueReturn('${escapeHtml(log.id||'')}')">↩️ คืนของจากการเบิก</button>` : (returned>0 && remaining<=0 ? `<button class="btn light full" disabled>คืนครบแล้ว</button>` : '');
  return summary || button ? `<section class="history-detail-section issue-return-action"><h3>คืนของจากการเบิก</h3>${summary}${button}</section>` : '';
}
window.handleIssueReturnProof=async(event)=>{
  const file=event?.target?.files?.[0];
  if(!file) return;
  try{
    window.__issueReturnImage=await compressImage(file);
    toast('แนบรูปหลักฐานการคืนแล้ว');
  }catch(e){
    console.error(e);
    toast('แนบรูปไม่สำเร็จ');
  }
};
window.openIssueReturn=(logId)=>{
  if(!requireIssueReturnPermission()) return;
  const log=state.logs.find(item=>String(item.id||'')===String(logId||''));
  if(!log) return toast('ไม่พบรายการเบิกเดิม');
  if(!isApprovedIssueLog(log)) return toast('คืนของได้เฉพาะรายการเบิกออกที่อนุมัติแล้ว');
  const product=state.products.find(p=>String(p.id||'')===String(log.productId||''));
  if(!product) return toast('ไม่พบสินค้า');
  if(!canAccessProduct(product)) return toast('คุณไม่มีสิทธิ์เข้าถึงสินค้านี้');
  const remaining=remainingReturnQtyForIssueLog(log);
  if(remaining<=0) return toast('รายการนี้คืนครบแล้ว');
  window.__issueReturnImage='';
  const returned=returnedQtyForIssueLog(log);
  const destination=historyIssueDestinationLabel(log)||'ไม่ระบุสถานที่เบิกไปใช้';
  const stockLabel=historyLocationLabel(log)||scanProductLocationLabel(product);
  const productName=product.name||log.productName||log.name||log.detail||'สินค้า';
  openModal('คืนของจากการเบิก',`<div class="issue-return-modal">
    <div class="card note" style="box-shadow:none;margin:0 0 12px">
      <b>${escapeHtml(productName)}</b>
      <div class="muted" style="margin-top:6px">เบิกออกเดิม ${Number(log.qty)||0} ${escapeHtml(log.unit||product.unit||'')} • คืนแล้ว ${Number(returned).toLocaleString('th-TH')} • คืนได้สูงสุด ${Number(remaining).toLocaleString('th-TH')}</div>
      <div class="muted">คืนจาก: ${escapeHtml(destination)} → กลับเข้า: ${escapeHtml(stockLabel)}</div>
      ${log.lotNo?`<div class="muted">ล็อต: ${escapeHtml(log.lotNo)} • หมดอายุ ${escapeHtml(lotDateLabel(log.lotExpiryDate))}</div>`:''}
    </div>
    <label class="field-label">จำนวนที่คืน <span style="color:#dc2626">*</span></label>
    <input id="issueReturnQty" class="new-item-input" type="number" min="0.01" max="${Number(remaining)}" step="0.01" value="${Number(remaining)}">
    <label class="field-label">เหตุผลการคืน <span style="color:#dc2626">*</span></label>
    <textarea id="issueReturnReason" class="new-item-input" rows="3" placeholder="เช่น เบิกไปใช้แล้วเหลือ / ส่งคืนจาก ${escapeHtml(destination)}"></textarea>
    <label class="field-label">รูปหลักฐาน <span class="muted">(ไม่บังคับ)</span></label>
    <input id="issueReturnProofInput" class="new-item-input" type="file" accept="image/*" onchange="window.handleIssueReturnProof(event)">
    <button id="submitIssueReturnBtn" data-action-lock="issueReturn:${escapeHtml(log.id||'')}" class="btn green full" onclick="window.submitIssueReturn('${escapeHtml(log.id||'')}')">↩️ ยืนยันคืนของ</button>
    <p class="muted" style="font-size:12px;margin:10px 0 0">รายการคืนของจะไม่ถูกนับเป็นรับเข้าใหม่ แต่จะเพิ่มสต๊อกกลับและผูกกับรายการเบิกเดิม</p>
  </div>`);
};
window.submitIssueReturn=async(logId)=>{
  if(!requireIssueReturnPermission()) return;
  const cached=state.logs.find(item=>String(item.id||'')===String(logId||''));
  if(!cached) return toast('ไม่พบรายการเบิกเดิม');
  const qty=Number(document.getElementById('issueReturnQty')?.value)||0;
  const reason=String(document.getElementById('issueReturnReason')?.value||'').trim();
  const remaining=remainingReturnQtyForIssueLog(cached);
  if(qty<=0) return toast('กรุณากรอกจำนวนที่คืน');
  if(qty>remaining) return toast(`คืนได้สูงสุด ${remaining} ${cached.unit||''}`);
  if(!reason) return toast('กรุณาระบุเหตุผลการคืน');
  const lockKey=`issueReturn:${logId}`;
  if(!beginActionLock(lockKey,'submitIssueReturnBtn','กำลังคืนของ...')) return;
  try{
    const returnImage=String(window.__issueReturnImage||'');
    let productId=String(cached.productId||'');
    await runTransaction(fs,async tx=>{
      const issueRef=logDocRef(logId);
      const issueSnap=await tx.get(issueRef);
      if(!issueSnap.exists()) throw new Error('ไม่พบรายการเบิกเดิม');
      const issue={id:logId,...issueSnap.data()};
      if(!isApprovedIssueLog(issue)) throw new Error('คืนของได้เฉพาะรายการเบิกออกที่อนุมัติแล้ว');
      productId=String(issue.productId||cached.productId||'');
      const pRef=productRef(productId);
      const pSnap=await tx.get(pRef);
      if(!pSnap.exists()) throw new Error('ไม่พบสินค้า');
      const product={id:productId,...pSnap.data()};
      const originalQty=Number(issue.qty)||0;
      const previousReturn=Math.min(originalQty,Math.max(Number(issue.returnedQty||0)||0,returnedQtyForIssueLog({...cached,...issue,id:logId})));
      if(qty>Math.max(0,originalQty-previousReturn)) throw new Error(`คืนได้สูงสุด ${Math.max(0,originalQty-previousReturn)} ${issue.unit||product.unit||''}`);
      const newReturned=previousReturn+qty;
      const currentStock=Number(product.stock)||0;
      const newStock=currentStock+qty;
      const lots=normalizeProductLots(product);
      let lotIndex=lots.findIndex(l=>String(l.id||'')===String(issue.lotId||''));
      const actorName=state.profile?.displayName||state.profile?.username||'ไม่ทราบผู้ใช้';
      if(lotIndex>=0){
        lots[lotIndex]={...lots[lotIndex],qty:(Number(lots[lotIndex].qty)||0)+qty,status:lots[lotIndex].status||'active',note:lots[lotIndex].note||''};
      }else{
        lots.push({id:issue.lotId||makeEventId('LOTRET'),lotNo:issue.lotNo||generateLotNo(product,issue.lotExpiryDate||''),qty,expiryDate:issue.lotExpiryDate||'',receivedAt:new Date().toISOString(),receivedByUid:state.user?.uid||'',receivedByName:actorName,note:`คืนของจากการเบิก • ${reason}`,status:'active'});
      }
      const stockLoc=issueReturnStockLocation(issue,product);
      const stockLocation=issue.stockLocation||stockLocationPath(stockLoc)||scanProductLocationLabel(product);
      const destination=historyIssueDestinationLabel(issue)||issue.destinationLocation||issue.issueDestination||'ไม่ระบุสถานที่เบิกไปใช้';
      const eventId=makeEventId('RET');
      const returnDoc=doc(logRef()),auditDoc=doc(auditRef());
      const unit=issue.unit||product.unit||'';
      const productName=product.name||issue.productName||issue.name||issue.detail||'สินค้า';
      const detail=`คืน ${productName} ${qty} ${unit} จาก ${destination}`;
      const returnFields={action:'คืนของ',type:'issue_return',moveType:'return',status:'returned',detail,productId,qty,unit,photo:returnImage,location:stockLocation,stockLocation,returnFromDestination:destination,destinationLocation:destination,issueDestination:destination,originalLogId:logId,originalEventId:issue.eventId||'',originalQty,previousReturnQty:previousReturn,totalReturnedQty:newReturned,remainingReturnQty:Math.max(0,originalQty-newReturned),netUsedQty:Math.max(0,originalQty-newReturned),reason,note:reason,submittedByUid:issue.submittedByUid||'',submittedByName:issue.submittedByName||'',reviewerUid:issue.reviewerUid||'',reviewerName:issue.reviewerName||'',returnedByUid:state.user?.uid||'',returnedByName:actorName,previousStock:currentStock,newStock,lotId:issue.lotId||'',lotNo:issue.lotNo||'',lotExpiryDate:issue.lotExpiryDate||'',eventId,...stockLoc};
      tx.update(pRef,{stock:newStock,lots,expiryDate:(earliestProductLot({...product,lots})||{}).expiryDate||'',hasExpiry:lots.some(l=>!!l.expiryDate),updatedAt:serverTimestamp()});
      tx.update(issueRef,{returnedQty:newReturned,returnStatus:newReturned>=originalQty?'returned':'partial',lastReturnAt:serverTimestamp(),lastReturnLogId:returnDoc.id,remainingReturnQty:Math.max(0,originalQty-newReturned),updatedAt:serverTimestamp()});
      tx.set(returnDoc,logPayload('คืนของ',detail,returnFields));
      tx.set(auditDoc,auditPayload('คืนของ',detail,{...returnFields,logId:returnDoc.id}));
    });
    refreshPublicProductPreviewQuietly(productId);
    window.__issueReturnImage='';
    hideModal();
    toast('บันทึกคืนของและเพิ่มสต๊อกกลับแล้ว');
  }catch(e){
    console.error(e);
    toast(e?.message||'คืนของไม่สำเร็จ');
  }finally{
    endActionLock(lockKey,'submitIssueReturnBtn');
  }
};

function renderHistory(){
  const q=(state.historySearch||'').trim().toLowerCase();
  const filter=state.historyFilter||'all';
  const startDate=state.historyStart||toDateStr(new Date());
  const endDate=state.historyEnd||startDate;
  const startAt=new Date(`${startDate}T00:00:00`);
  const endAt=new Date(`${endDate}T23:59:59.999`);
  const locationCtx=historyLocationFilterContext();

  let logs=[...state.logs].filter(l=>canAccessLogEntry(l)).filter(l=>logMatchesHistoryLocation(l,locationCtx)).filter(l=>{
    const d=getLogDate(l);
    return d && d>=startAt && d<=endAt;
  });
  const destinationOptions=historyDestinationFilterOptions(logs);
  if(filter!=='all') logs=logs.filter(l=>historyMatchesFilter(l,filter));
  if(state.historyDestinationFilter && state.historyDestinationFilter!=='all') logs=logs.filter(l=>historyMatchesDestinationFilter(l,state.historyDestinationFilter));
  if(q){
    logs=logs.filter(l=>[
      l.action,l.detail,l.actorName,l.reviewerName,l.returnedByName,l.location,historyLocationLabel(l),historyIssueDestinationLabel(l),l.returnFromDestination,l.destinationLocation,l.issueDestination,l.stockGroupName,l.stockAreaName,l.stockAreaPath,l.unit,l.qty,l.reason,l.note,Array.isArray(l.changes)?l.changes.join(' '):''
    ].map(v=>String(v||'').toLowerCase()).join(' ').includes(q));
  }

  const grouped={};
  logs.forEach(l=>{
    const d=getLogDate(l);
    const key=d?toDateStr(d):'unknown';
    (grouped[key] ||= []).push(l);
  });
  Object.values(grouped).forEach(items=>items.sort((a,b)=>(getLogDate(b)?.getTime()||0)-(getLogDate(a)?.getTime()||0)));
  const dateKeys=Object.keys(grouped).sort((a,b)=>b.localeCompare(a));
  const thaiFullDate=(key)=>{
    if(key==='unknown') return 'ไม่ทราบวันที่';
    const [y,m,d]=key.split('-').map(Number);
    return new Date(y,m-1,d).toLocaleDateString('th-TH',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  };
  const thaiShortDate=(key)=>{
    const [y,m,d]=key.split('-').map(Number);
    return new Date(y,m-1,d).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'});
  };
  const renderLog=(l)=>{
    const {label,cls}=logPillInfo(l);
    const requester=l.submittedByName || l.actorName || 'ไม่ทราบผู้ใช้';
    const reviewer=l.reviewerName || '';
    const isAdjust=isAdjustmentLog(l);
    const qty=isAdjust && l.previousStock!==undefined && l.newStock!==undefined
      ? `<strong class="history-qty">${Number(l.previousStock)||0} → ${Number(l.newStock)||0} ${escapeHtml(l.unit||'')}</strong>`
      : (l.qty ? `<strong class="history-qty">${Number(l.qty)||0} ${escapeHtml(l.unit||'')}</strong>` : '');
    const reason=isAdjust && l.reason ? `<div class="history-adjust-reason">เหตุผล: ${escapeHtml(l.reason)}</div>` : '';
    const changesHtml=!isAdjust && Array.isArray(l.changes) && l.changes.length
      ? `<div class="history-change-list">${l.changes.map(change=>`<div>• ${escapeHtml(change)}</div>`).join('')}</div>`
      : '';
    const location=historyMovementLocationMarkup(l);
    const d=getLogDate(l);
    const timeText=d?d.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}):(l.time||'');
    const displayPhoto=historyLogDisplayPhoto(l);
    const returnInline=historyReturnInlineMarkup(l);
    const photoThumb=displayPhoto.url ? `<img class="history-entry-thumb" src="${escapeHtml(displayPhoto.url)}" alt="${escapeHtml(displayPhoto.label)} ${escapeHtml(l.detail||'รายการ')}" loading="lazy">` : '';
    return `<article class="history-entry history-entry-clickable ${isIssueReturnLog(l)?'history-entry-return':(isApprovedIssueLog(l)&&returnedQtyForIssueLog(l)>0?'history-entry-has-return':'')}" role="button" tabindex="0" onclick="window.viewHistoryEntry('${escapeHtml(l.id||'')}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.viewHistoryEntry('${escapeHtml(l.id||'')}')}">
      <div class="history-entry-content">
        <div class="history-entry-top">
          <span class="pill ${cls}">${escapeHtml(label)}</span>
          <time>${escapeHtml(timeText)}</time>
        </div>
        <div class="history-entry-title">${escapeHtml(l.detail||'-')}</div>
        ${qty}
        ${returnInline}
        ${reason}
        ${changesHtml}
        <div class="history-entry-meta">
          ${location}
          <span>👤 ${isIssueReturnLog(l)?'ผู้คืนของ':(l.moveType==='in'?'ผู้รับเข้า':l.moveType==='out'?'ผู้เบิก':'ผู้ดำเนินการ')}: ${escapeHtml(isIssueReturnLog(l)?(l.returnedByName||requester):requester)}</span>
          ${(l.action==='อนุมัติ'&&reviewer)?`<span>✅ ผู้อนุมัติ: ${escapeHtml(reviewer)}</span>`:''}
          ${(l.action==='ปฏิเสธ'&&reviewer)?`<span>⛔ ผู้ปฏิเสธ: ${escapeHtml(reviewer)}</span>`:''}
        </div>
        <div class="history-entry-open-hint">แตะเพื่อดูรายละเอียด${displayPhoto.url?'และรูปภาพ':''} ›</div>
      </div>
      ${photoThumb}
    </article>`;
  };

window.viewHistoryEntry=function(logId){
  const l=state.logs.find(item=>String(item.id||'')===String(logId||''));
  if(!l) return toast('ไม่พบรายละเอียดรายการนี้');
  const {label,cls}=logPillInfo(l);
  const d=getLogDate(l);
  const dateText=d?d.toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'}):'ไม่ทราบวันที่';
  const timeText=d?d.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):(l.time||'-');
  const requester=l.submittedByName||l.actorName||'ไม่ทราบผู้ใช้';
  const reviewer=l.reviewerName||'';
  const product=state.products.find(p=>p.id===l.productId);
  const productName=l.detail||product?.name||'รายการสินค้า';
  const qtyText=(isAdjustmentLog(l)&&l.previousStock!==undefined&&l.newStock!==undefined)
    ? `${Number(l.previousStock)||0} → ${Number(l.newStock)||0} ${l.unit||''}`
    : `${Number(l.qty)||0} ${l.unit||''}`;
  const stockRows=(l.previousStock!==undefined||l.newStock!==undefined)
    ? (isIssueReturnLog(l)
      ? `<div><span>สต๊อกก่อนคืน</span><b>${escapeHtml(String(l.previousStock??'-'))} ${escapeHtml(l.unit||'')}</b></div><div><span>สต๊อกหลังคืน</span><b>${escapeHtml(String(l.newStock??'-'))} ${escapeHtml(l.unit||'')}</b></div>`
      : `<div><span>ยอดก่อนรายการ</span><b>${escapeHtml(String(l.previousStock??'-'))} ${escapeHtml(l.unit||'')}</b></div><div><span>ยอดหลังรายการ</span><b>${escapeHtml(String(l.newStock??'-'))} ${escapeHtml(l.unit||'')}</b></div>`)
    :'';
  const lotRows=(l.lotNo||l.lotId||l.lotExpiryDate)
    ? `<div><span>ล็อตสินค้า</span><b>${escapeHtml(l.lotNo||'-')}</b></div><div><span>วันหมดอายุล็อต</span><b>${escapeHtml(lotDateLabel(l.lotExpiryDate)||'ไม่ระบุ')}</b></div>`:'';
  const changes=Array.isArray(l.changes)&&l.changes.length?`<section class="history-detail-section"><h3>รายละเอียดการเปลี่ยนแปลง</h3><div class="history-detail-changes">${l.changes.map(x=>`<div>• ${escapeHtml(x)}</div>`).join('')}</div></section>`:'';
  const note=l.note||l.reason||l.fefoOverrideReason||'';
  const displayPhoto=historyLogDisplayPhoto(l);
  const returnDetail=historyReturnDetailMarkup(l);
  const photo=displayPhoto.url?`<section class="history-detail-section"><h3>${escapeHtml(displayPhoto.label)}</h3><button class="history-detail-photo-button" type="button" onclick="window.openHistoryPhoto('${escapeHtml(l.id||'')}')"><img class="history-detail-photo" src="${escapeHtml(displayPhoto.url)}" alt="${escapeHtml(displayPhoto.label)} ${escapeHtml(productName)}"><span>แตะรูปเพื่อขยายเต็มหน้าจอ</span></button></section>`:`<section class="history-detail-section"><h3>รูปหลักฐาน</h3><div class="history-no-photo">📷 ไม่มีรูปภาพแนบในรายการนี้</div></section>`;
  openModal(`รายละเอียดรายการ`, `<div class="history-detail-modal">
    <div class="history-detail-head history-detail-head-clean"><div><span class="pill ${cls}">${escapeHtml(label)}</span><h2>${escapeHtml(productName)}</h2><p>${escapeHtml(dateText)} เวลา ${escapeHtml(timeText)} น.</p></div></div>
    ${photo}
    <section class="history-detail-section"><h3>ข้อมูลรายการ</h3><div class="history-detail-grid">
      <div><span>${isIssueReturnLog(l)?'ผู้คืนของ':(l.moveType==='in'?'ผู้รับสินค้า':l.moveType==='out'?'ผู้เบิกสินค้า':'ผู้ดำเนินการ')}</span><b>${escapeHtml(isIssueReturnLog(l)?(l.returnedByName||requester):requester)}</b></div>
      ${isIssueReturnLog(l)?`<div><span>คืนจาก</span><b>${escapeHtml(l.returnFromDestination||historyIssueDestinationLabel(l)||'-')}</b></div><div><span>กลับเข้าที่</span><b>${escapeHtml(historyLocationLabel(l)||'-')}</b></div>`:(isWithdrawLog(l)?`<div><span>เบิกไปใช้ที่</span><b>${escapeHtml(historyIssueDestinationLabel(l)||'-')}</b></div><div><span>เบิกจาก</span><b>${escapeHtml(historyLocationLabel(l)||'-')}</b></div>`:`<div><span>${l.moveType==='in'?'ตำแหน่งที่รับเข้า':'ตำแหน่งสต็อก'}</span><b>${escapeHtml(historyLocationLabel(l)||'-')}</b></div>`)}
      ${reviewer?`<div><span>${l.action==='ปฏิเสธ'?'ผู้ปฏิเสธ':'ผู้อนุมัติ'}</span><b>${escapeHtml(reviewer)}</b></div>`:''}
      ${lotRows}${stockRows}
    </div></section>
    ${returnDetail}
    ${note?`<section class="history-detail-section"><h3>หมายเหตุ / เหตุผล</h3><div class="history-detail-note">${escapeHtml(note)}</div></section>`:''}
    ${changes}
    ${issueReturnActionMarkup(l)}
    <button class="btn light full" onclick="hideModal()">ปิดรายละเอียด</button>
  </div>`);
};
window.openHistoryPhoto=function(logId){
  const l=state.logs.find(item=>String(item.id||'')===String(logId||''));
  const displayPhoto=historyLogDisplayPhoto(l||{});
  if(!displayPhoto.url) return toast('ไม่พบรูปภาพ');
  openModal(displayPhoto.label||'รูปภาพ',`<div class="history-photo-viewer"><img src="${escapeHtml(displayPhoto.url)}" alt="${escapeHtml(displayPhoto.label||'รูปภาพ')}"><button class="btn light full" onclick="hideModal()">ปิดรูปภาพ</button></div>`);
};

  const rows=dateKeys.map(key=>`<section class="history-day-group">
    <div class="history-day-heading">
      <div><span class="history-day-icon">📅</span><strong>${escapeHtml(thaiFullDate(key))}</strong></div>
      <span>${grouped[key].length} รายการ</span>
    </div>
    <div class="history-list">${grouped[key].map(renderLog).join('')}</div>
  </section>`).join('');

  const today=toDateStr(new Date());
  const yesterday=shiftDateStr(today,-1);
  const isToday=startDate===today&&endDate===today;
  const isYesterday=startDate===yesterday&&endDate===yesterday;
  const is7Days=startDate===shiftDateStr(today,-6)&&endDate===today;
  const periodText=startDate===endDate ? thaiFullDate(startDate) : `${thaiShortDate(startDate)} – ${thaiShortDate(endDate)}`;

  view.innerHTML=`<div class="history-page">
    <div class="history-page-head">
      <div>
        <div class="history-eyebrow">บันทึกการเคลื่อนไหว</div>
        <h1>📋 ประวัติการใช้งาน</h1>
      </div>
      <button class="btn small light" onclick="window.goToPage('home')">← กลับ</button>
    </div>

    <section class="history-control-card">
      <div class="history-quick-range">
        <button class="history-range-btn ${isToday?'active':''}" onclick="window.setHistoryToday()">วันนี้</button>
        <button class="history-range-btn ${isYesterday?'active':''}" onclick="window.setHistoryPreset('yesterday')">เมื่อวาน</button>
        <button class="history-range-btn ${is7Days?'active':''}" onclick="window.setHistoryPreset('7days')">7 วันล่าสุด</button>
      </div>

      <div class="history-date-box">
        <label><span>ตั้งแต่</span><input type="date" value="${escapeHtml(startDate)}" onchange="window.setHistoryDateRange(this.value,null)"></label>
        <span class="history-date-arrow">→</span>
        <label><span>ถึง</span><input type="date" value="${escapeHtml(endDate)}" onchange="window.setHistoryDateRange(null,this.value)"></label>
      </div>

      <div class="history-summary-strip">
        <div><span>ช่วงที่เลือก</span><strong>${escapeHtml(periodText)}</strong></div>
        <div><span>พบทั้งหมด</span><strong>${logs.length} รายการ</strong></div>
      </div>

      ${historyLocationFilterMarkup(locationCtx)}
      ${historyDestinationFilterMarkup(destinationOptions)}

      <div class="history-search-wrap">
        <span>🔍</span>
        <input id="historySearchInput" value="${escapeHtml(state.historySearch||'')}" placeholder="ค้นหาสินค้า ผู้ใช้งาน ตำแหน่งสต็อก หรือสถานที่เบิกไปใช้" oninput="window.setHistorySearch(this.value)">
      </div>

      <div class="history-filter-scroll">
        <button class="history-filter-btn ${filter==='all'?'active':''}" onclick="window.setHistoryFilter('all')">ทั้งหมด</button>
        <button class="history-filter-btn ${filter==='in'?'active':''}" onclick="window.setHistoryFilter('in')">📥 รับเข้า</button>
        <button class="history-filter-btn ${filter==='out'?'active':''}" onclick="window.setHistoryFilter('out')">📤 เบิกออก</button>
        <button class="history-filter-btn ${filter==='return'?'active':''}" onclick="window.setHistoryFilter('return')">↩️ คืนของ</button>
        <button class="history-filter-btn ${filter==='adjust'?'active':''}" onclick="window.setHistoryFilter('adjust')">⚖️ ปรับยอด</button>
        <button class="history-filter-btn ${filter==='approve'?'active':''}" onclick="window.setHistoryFilter('approve')">✅ อนุมัติ</button>
        <button class="history-filter-btn ${filter==='reject'?'active':''}" onclick="window.setHistoryFilter('reject')">⛔ ปฏิเสธ</button>
        <button class="history-filter-btn ${filter==='pending'?'active':''}" onclick="window.setHistoryFilter('pending')">⏳ รอตรวจ</button>
      </div>
    </section>

    <div class="history-results">${rows||`<div class="history-empty"><div>🗂️</div><strong>ไม่พบประวัติ</strong><span>ลองเปลี่ยนวันที่ คำค้นหา หรือตัวกรอง</span></div>`}</div>
    ${logsHasMore?`<div style="padding:16px 0 28px;text-align:center"><button class="btn light" onclick="window.loadMoreHistory()">โหลดประวัติเก่าเพิ่ม</button><div class="muted" style="margin-top:8px;font-size:12px">โหลดครั้งละ ${LOG_PAGE_SIZE} รายการ เพื่อลดการใช้หน่วยความจำและ Firestore Reads</div></div>`:`<div class="muted" style="padding:12px 0 24px;text-align:center">โหลดประวัติครบถึงข้อมูลเก่าสุดที่มีแล้ว</div>`}
  </div>`;
}

function rerenderHistoryKeepingScroll(){
  const y=window.scrollY||document.documentElement.scrollTop||0;
  renderHistory();
  requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo({top:y,behavior:'auto'})));
}

window.setHistorySearch=(value)=>{
  const y=window.scrollY||document.documentElement.scrollTop||0;
  state.historySearch=String(value||'');
  renderHistory();
  requestAnimationFrame(()=>{
    const input=$('historySearchInput');
    if(input){
      input.focus();
      input.setSelectionRange(input.value.length,input.value.length);
    }
    window.scrollTo({top:y,behavior:'auto'});
  });
};

window.setHistoryFilter=(value)=>{
  state.historyFilter=value||'all';
  saveUiState();
  rerenderHistoryKeepingScroll();
};
window.setHistoryDestinationFilter=(value)=>{
  state.historyDestinationFilter=value||'all';
  saveUiState();
  rerenderHistoryKeepingScroll();
};

window.setHistoryGroupFilter=(value)=>{
  state.historyGroupFilter=value||'all';
  state.historyAreaFilter='all';
  saveUiState();
  rerenderHistoryKeepingScroll();
};
window.setHistoryAreaFilter=(value)=>{
  state.historyAreaFilter=value||'all';
  saveUiState();
  rerenderHistoryKeepingScroll();
};
window.setHistoryDateRange=(start,end)=>{
  if(start) state.historyStart=start;
  if(end) state.historyEnd=end;
  if(state.historyStart>state.historyEnd){
    if(start) state.historyEnd=state.historyStart;
    else state.historyStart=state.historyEnd;
  }
  saveUiState();
  rerenderHistoryKeepingScroll();
};
window.setHistoryToday=()=>{
  const today=toDateStr(new Date());
  state.historyStart=today;
  state.historyEnd=today;
  saveUiState();
  rerenderHistoryKeepingScroll();
};
window.setHistoryPreset=(preset)=>{
  const today=toDateStr(new Date());
  if(preset==='yesterday'){
    const d=shiftDateStr(today,-1);
    state.historyStart=d; state.historyEnd=d;
  }else if(preset==='7days'){
    state.historyStart=shiftDateStr(today,-6); state.historyEnd=today;
  }
  saveUiState();
  rerenderHistoryKeepingScroll();
};
window.shiftHistoryDay=(delta)=>{
  const base=state.historyStart||toDateStr(new Date());
  const next=shiftDateStr(base,Number(delta)||0);
  state.historyStart=next;
  state.historyEnd=next;
  saveUiState();
  rerenderHistoryKeepingScroll();
};

function roleLabel(value='staff'){
  return ({admin:'ผู้ดูแลระบบ',director:'F&B Director',manager:'Manager',supervisor:'Supervisor',captain:'Captain',staff:'Staff'}[value]||value||'Staff');
}
function profileInitials(){
  const first=(state.profile?.firstName||state.profile?.displayName||state.profile?.username||'T').trim();
  const last=(state.profile?.lastName||'').trim();
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

let auditViewerRows=[];
let auditViewerCursor=null;
let auditViewerHasMore=true;
let auditViewerLoading=false;
const AUDIT_VIEW_PAGE_SIZE=200;

function auditViewerRowsMarkup(){
  return auditViewerRows.map(a=>{
    const d=getLogDate(a);
    return `<div class="card" style="box-shadow:none;border:1px solid var(--line);margin:10px 0"><div class="between"><b>${escapeHtml(a.action||'-')}</b><span class="muted">${d?d.toLocaleString('th-TH'):'-'}</span></div><div>${escapeHtml(a.detail||'')}</div><div class="muted">โดย ${escapeHtml(a.actorName||'-')} • ${escapeHtml(a.actorRole||'-')}</div>${a.previousStock!==undefined?`<div><b>${a.previousStock} → ${a.newStock}</b> ${escapeHtml(a.unit||'')}</div>`:''}${a.reason?`<div class="note">เหตุผล: ${escapeHtml(a.reason)}</div>`:''}</div>`;
  }).join('');
}
function renderAuditViewer(){
  const rows=auditViewerRowsMarkup();
  openModal('🛡️ Audit Log',`<p class="note">ประวัติการแก้ไขแบบอ่านอย่างเดียว โหลดจาก Firestore ครั้งละ ${AUDIT_VIEW_PAGE_SIZE} รายการ</p><div id="auditViewerRows">${rows||'<p class="muted">ยังไม่มี Audit Log</p>'}</div>${auditViewerHasMore?'<button id="loadMoreAuditBtn" class="btn secondary full" onclick="window.loadMoreAuditLogs()">โหลดประวัติเพิ่ม</button>':'<p class="muted" style="text-align:center">แสดงประวัติครบแล้ว</p>'}`);
}
async function fetchAuditViewerPage(reset=false){
  if(auditViewerLoading||(!reset&&!auditViewerHasMore)) return;
  auditViewerLoading=true;
  if(reset){
    auditViewerRows=[];
    auditViewerCursor=null;
    auditViewerHasMore=true;
  }
  try{
    const q=auditViewerCursor
      ? query(auditRef(),orderBy('createdAt','desc'),startAfter(auditViewerCursor),limit(AUDIT_VIEW_PAGE_SIZE))
      : query(auditRef(),orderBy('createdAt','desc'),limit(AUDIT_VIEW_PAGE_SIZE));
    const snap=await getDocsFromServer(q);
    const rows=snap.docs.map(d=>({id:d.id,...d.data()}));
    const existing=new Set(auditViewerRows.map(x=>x.id));
    auditViewerRows.push(...rows.filter(x=>!existing.has(x.id)));
    auditViewerCursor=snap.docs[snap.docs.length-1]||auditViewerCursor;
    auditViewerHasMore=snap.size===AUDIT_VIEW_PAGE_SIZE;
    renderAuditViewer();
  }catch(e){
    console.error('โหลด Audit Log เพิ่มไม่สำเร็จ',e);
    toast(humanizeAppError(e).title);
    if(!auditViewerRows.length) hideModal();
  }finally{
    auditViewerLoading=false;
  }
}
window.viewAuditLog=async()=>{
  if(!canManageProducts()) return toast('ไม่มีสิทธิ์ดู Audit Log');
  openModal('🛡️ Audit Log','<div class="reset-progress"><div class="reset-spinner"></div><h3>กำลังโหลด Audit Log...</h3></div>');
  await fetchAuditViewerPage(true);
};
window.loadMoreAuditLogs=async()=>{
  const btn=$('loadMoreAuditBtn');
  if(btn){ btn.disabled=true; btn.textContent='⏳ กำลังโหลด...'; }
  await fetchAuditViewerPage(false);
};



function renderManual(){
  view.innerHTML = `<div class="manual-page visual-manual v34202">
    <section class="manual-visual-hero v34202">
      <div class="manual-visual-copy">
        <span class="manual-kicker">คู่มือย่อในระบบ + คู่มือการใช้งานเต็มหน้า</span>
        <h1>${escapeHtml(appName())}</h1>
        <p>หน้านี้เป็นคู่มือย่อสำหรับเปิดดูเร็ว ส่วนคู่มือเต็มหน้าเป็นฉบับใช้งานจริง พร้อมขั้นตอนรับเข้า เบิกออก LOT/FEFO QR ประวัติ รายงาน และข้อควรระวังก่อนบันทึกข้อมูลจริง</p>
        <div class="manual-hero-actions">
          <button class="btn primary" onclick="window.goToPage('scan')">＋ เริ่มทำรายการ</button>
          <button class="btn" onclick="window.goToPage('stock')">📦 ไปหน้าสต๊อก</button>
          <button class="btn" onclick="window.open('manual.html','_blank')">🌐 เปิดคู่มือการใช้งานเต็มหน้า</button>
        </div>
      </div>
      <div class="manual-screen-stack">
        <div class="manual-demo-screen demo-dashboard">${manualScreenDashboard()}</div>
        <div class="manual-demo-screen demo-qr">${manualScreenQR()}</div>
      </div>
    </section>

    <section class="manual-command-center">
      <div class="manual-search-card manual-search-visual">
        <label for="manualSearch">ค้นหาหัวข้อคู่มือ</label>
        <div class="manual-search-row"><span>🔎</span><input id="manualSearch" placeholder="ค้นหา เช่น QR, FEFO, เบิกออก, รายงาน, ไม่มีสิทธิ์" oninput="window.filterManual(this.value)"></div>
        <div class="manual-tags">
          <button onclick="window.filterManual('รับเข้า')">รับเข้า</button>
          <button onclick="window.filterManual('เบิกออก')">เบิกออก</button>
          <button onclick="window.filterManual('QR')">QR</button>
          <button onclick="window.filterManual('FEFO')">LOT / FEFO</button>
          <button onclick="window.filterManual('รายงาน')">รายงาน</button>
          <button onclick="window.filterManual('Director')">Director</button>
          <button onclick="window.filterManual('ปัญหา')">ปัญหาที่พบบ่อย</button>
        </div>
      </div>
      <aside class="manual-side-links">
        <h3>ลัดไปยังหน้าที่เกี่ยวข้อง</h3>
        <button onclick="window.goToPage('stock')">📦 หน้าสต๊อกสินค้า <span>›</span></button>
        <button onclick="window.goToPage('scan')">＋ รายการใหม่ <span>›</span></button>
        <button onclick="window.goToPage('history')">📋 ประวัติรายการ <span>›</span></button>
        <button onclick="window.goToPage('report')">📊 รายงาน <span>›</span></button>
        <button onclick="window.goToPage('profile')">👤 โปรไฟล์ / สิทธิ์ <span>›</span></button>
      </aside>
    </section>

    <section class="manual-role-grid visual-roles director-visible">
      <article class="role-director"><div class="manual-role-icon">🏆</div><h3>F&amp;B Director / ไดเรคเตอร์</h3><span class="role-equal-badge">ผู้บริหาร F&amp;B</span><p>ดูภาพรวมระดับผู้บริหาร ตรวจรายงานยอดเบิก/คืน/ใช้จริงสุทธิ อนุมัติหรือตรวจสอบตามสิทธิ์ที่ระบบเปิดให้</p></article>
      <article class="role-lead"><div class="manual-role-icon">🧑‍💼</div><h3>Manager</h3><p>ดูภาพรวม อนุมัติ ตรวจรายงาน ตรวจประวัติ และตรวจรายการผิดปกติของแผนก</p></article>
      <article class="role-lead"><div class="manual-role-icon">👥</div><h3>Supervisor / Captain</h3><span class="role-equal-badge">สิทธิ์เท่ากัน</span><p>รับเข้า เบิกออก อนุมัติ ตรวจล็อต ดูประวัติ และตรวจความถูกต้องของรายการประจำวัน</p></article>
      <article class="role-staff"><div class="manual-role-icon">👤</div><h3>Staff</h3><p>เบิกสินค้า สแกน QR ดูข้อมูลสินค้า และดูรายการที่เกี่ยวข้องตามสิทธิ์ที่ได้รับ</p></article>
    </section>

    <section class="manual-process-board">
      <div class="manual-board-title"><h2>กระบวนการทำงานหลัก</h2><p>เพิ่มสินค้า → รับเข้า → เบิกออก → ตรวจ LOT/FEFO → สแกน QR → ดูประวัติ/รายงาน</p></div>
      <div class="manual-process-grid">
        ${manualProcessStep('1','📦','เพิ่มสินค้า','สร้างข้อมูลสินค้า รูป หมวดหมู่ และหน่วยนับ')}
        ${manualProcessStep('2','📥','รับเข้า / สร้างล็อต','บันทึกจำนวน วันรับเข้า วันหมดอายุ และผู้รับสินค้า')}
        ${manualProcessStep('3','📤','เบิกออก','เลือกสินค้า จำนวน สถานที่เบิกไปใช้ และแนบหลักฐาน')}
        ${manualProcessStep('4','🗓️','FEFO','ระบบแนะนำล็อตที่หมดอายุก่อนให้เบิกก่อน')}
        ${manualProcessStep('5','🔳','สแกน QR','ดูพรีวิวสินค้าและยอดคงเหลือรวมก่อนเข้าระบบ')}
        ${manualProcessStep('6','📊','รายงาน','ดูประวัติ ส่งออก Excel/CSV หรือ PDF/พิมพ์')}
      </div>
    </section>

    <section class="manual-section-list visual-section-list" id="manualSections">
      ${manualDetail('1. ระบบนี้สร้างมาเพื่ออะไร','overview purpose ประโยชน์ จัดการสินค้า','🎯',`
        <div class="manual-section-toolbar"><div><h2>เป้าหมายของระบบ</h2><p>ลดการจดมือ ลดข้อมูลตกหล่น และตรวจสอบย้อนหลังได้</p></div></div>
        <div class="manual-deep-grid">
          ${manualDeepCard('📦','รวมสินค้าในที่เดียว','เก็บชื่อสินค้า รูป หมวดหมู่ หน่วยนับ จำนวนคงเหลือ และสถานะสินค้าไว้ในระบบเดียว',manualScreenStock())}
          ${manualDeepCard('📥','รับเข้าเป็นหลักฐาน','บันทึกจำนวน ผู้รับสินค้า วันหมดอายุ ล็อต และแนบรูปหลักฐานเพื่อตรวจสอบย้อนหลัง',manualScreenReceive())}
          ${manualDeepCard('📤','เบิกออกตามสถานที่ใช้งาน','บันทึกว่าสินค้าออกไปใช้ที่ไหน ใครเบิก จำนวนเท่าไหร่ และเลือกล็อตที่ถูกต้อง',manualScreenIssue())}
          ${manualDeepCard('📊','ตรวจสอบและรายงาน','ดูประวัติ รูปหลักฐาน ยอดคงเหลือ ล็อตที่ต้องระวัง และส่งออก Excel/PDF',manualScreenReport())}
        </div>
        <p class="manual-callout-ok">สรุป: ระบบนี้ช่วยให้ฝ่าย Food & Beverage รู้ยอดจริง คุมล็อตและวันหมดอายุ ลดของเสีย และตรวจสอบย้อนหลังได้ง่าย</p>`)}

      ${manualDetail('2. สิทธิ์ผู้ใช้งาน','role director ไดเรคเตอร์ f&b director admin manager captain staff สิทธิ์ คืนของ อนุมัติ รายงาน','👥',`
        <div class="manual-role-task-grid director-visible">
          <div><b>Admin / ผู้ดูแลระบบ</b><ul><li>ตั้งค่าระบบและสิทธิ์</li><li>แก้ปัญหา Login</li><li>ดูแลข้อมูลหลังบ้าน</li><li>ช่วยตรวจเมื่อพบข้อมูลผิด</li></ul></div>
          <div><b>F&amp;B Director / ไดเรคเตอร์</b><ul><li>ดูภาพรวมระดับผู้บริหาร</li><li>ตรวจรายงานยอดเบิก / คืน / ใช้จริงสุทธิ</li><li>อนุมัติหรือตรวจสอบตามสิทธิ์ที่เปิดให้</li><li>ติดตามความถูกต้องของทั้งฝ่าย F&amp;B</li></ul></div>
          <div><b>Manager</b><ul><li>ดูภาพรวม</li><li>อนุมัติรายการ</li><li>ดูประวัติและรายงาน</li><li>ตรวจรายการผิดปกติ</li></ul></div>
          <div><b>Supervisor / Captain <span class="role-badge">สิทธิ์เท่ากัน</span></b><ul><li>รับเข้า / เบิกออก</li><li>อนุมัติรายการตามสิทธิ์</li><li>ตรวจล็อตและวันหมดอายุ</li><li>ดูประวัติและรายงาน</li></ul></div>
          <div><b>Staff</b><ul><li>เบิกสินค้าตามสิทธิ์</li><li>สแกน QR เพื่อดูสินค้า</li><li>ดูรายการที่เกี่ยวข้อง</li><li>ทำงานพื้นฐานตามที่ได้รับอนุญาต</li></ul></div>
        </div>
        <p class="manual-callout-ok"><b>F&amp;B Director เพิ่มเข้ามาแล้ว:</b> เป็นบทบาทผู้บริหารที่ดูภาพรวมและรายงานระดับสูงกว่า Manager ตามสิทธิ์ที่ Admin ตั้งค่าไว้</p>
        <p class="manual-callout-warn">สิทธิ์ทั้งหมดเป็นค่าเริ่มต้น/ตัวอย่าง และปรับได้ตามนโยบายของระบบ หากเข้าเมนูไม่ได้ หรือสิทธิ์ไม่ตรงกับหน้าที่ ให้แจ้งหัวหน้างานหรือผู้ดูแลระบบก่อนทำรายการจริง</p>` )}

      ${manualDetail('3. วิธีเข้าสู่ระบบ','login password chartered เข้าสู่ระบบ','🔐',`
        <div class="manual-deep-grid">
          ${manualDeepCard('1','เปิดเว็บไซต์','เข้าเว็บไซต์ '+escapeHtml(appName())+' จากมือถือ แท็บเล็ต หรือคอมพิวเตอร์',manualScreenLogin('open'))}
          ${manualDeepCard('2','กรอก Username / Password','ใส่ชื่อผู้ใช้และรหัสผ่าน หากเป็นสมาชิกใหม่ใช้รหัสเริ่มต้น chartered',manualScreenLogin('form'))}
        </div>
        <ol class="manual-step-list"><li>เปิดเว็บไซต์ ${escapeHtml(appName())}</li><li>กรอก Username เช่น jettaphonj</li><li>กรอกรหัสผ่าน</li><li>กดเข้าสู่ระบบ</li><li>ถ้าระบบให้เปลี่ยนรหัสผ่าน ให้ตั้งรหัสใหม่ก่อนใช้งาน</li></ol>
        <p class="manual-callout-warn">ถ้าเข้าระบบไม่ได้ ให้ตรวจตัวสะกด Username/Password ก่อน แล้วแจ้งหัวหน้างานหรือผู้ดูแลระบบเพื่อตรวจสิทธิ์</p>`)}

      ${manualDetail('4. หน้าแรก / Dashboard','dashboard home หน้าแรก','🏠',`
        <div class="manual-deep-grid">
          ${manualDeepCard('ภาพรวมวันนี้','ใช้ดูสถานะเร็ว ๆ','ดูรายการรออนุมัติ รับเข้าวันนี้ เบิกออกวันนี้ สินค้าใกล้หมด และสถานะออนไลน์',manualScreenDashboard())}
          ${manualDeepCard('สิ่งที่ควรเช็ก','เปิดมาแล้วดูอะไร','เช็กว่ามีรายการรออนุมัติไหม สินค้าใกล้หมดหรือไม่ และมีล็อตใกล้หมดอายุหรือเปล่า',manualScreenDashboardAlerts())}
        </div>
        <p class="manual-callout-ok">หน้าแรกคือหน้าดูภาพรวม ไม่ใช่หน้าทำรายงานทั้งหมด ถ้าต้องการข้อมูลละเอียดให้ไปที่ประวัติหรือรายงาน</p>`)}

      ${manualDetail('5. หน้าสต๊อกสินค้า','stock product สต๊อกสินค้า รายละเอียดสินค้า','📦',`
        <div class="manual-deep-grid">
          ${manualDeepCard('ค้นหาสินค้า','เปิดข้อมูลสินค้า','ค้นหาจากชื่อ หมวดหมู่ หรือสถานะ แล้วกดการ์ดสินค้าเพื่อดูรายละเอียด',manualScreenStock())}
          ${manualDeepCard('รายละเอียดสินค้า','ดูข้อมูลก่อนทำรายการ','ดูรูปสินค้า หน่วยนับ ยอดคงเหลือ ล็อต ประวัติ และปุ่ม QR Code สินค้า',manualScreenProductDetail())}
        </div>
        <ol class="manual-step-list"><li>เข้าเมนูสต๊อก</li><li>ค้นหาสินค้า</li><li>กดการ์ดสินค้า</li><li>เลือกดูล็อต ประวัติ หรือสร้าง QR Code</li></ol>`)}

      ${manualDetail('6. การเพิ่มสินค้าใหม่','add product เพิ่มสินค้าใหม่','➕',`
        <div class="manual-deep-grid">
          ${manualDeepCard('เริ่มเพิ่มสินค้า','กดรายการใหม่','ใช้เมนู + หรือรายการใหม่ แล้วเลือกเพิ่มสินค้า',manualScreenAddProduct('start'))}
          ${manualDeepCard('กรอกข้อมูลสินค้า','กรอกให้ครบ','ใส่ชื่อสินค้า หมวดหมู่ หน่วยนับ SKU ถ้ามี และรูปสินค้า',manualScreenAddProduct('form'))}
        </div>
        <ol class="manual-step-list"><li>กดรายการใหม่</li><li>เลือกเพิ่มสินค้า</li><li>เลือกโหมด 1 สินค้า หรือ หลายสินค้า</li><li>กรอกชื่อสินค้าและข้อมูลสต๊อก</li><li>โหมดหลายสินค้าเพิ่มได้สูงสุด 50 รายการและใช้พื้นที่สต๊อกร่วมกัน</li><li>ตรวจสรุปแล้วกดบันทึก</li></ol>
        <p class="manual-callout-ok">หลังเพิ่มสินค้าแล้ว ยอดสต๊อกจะเริ่มจากการรับเข้า หรือจำนวนเริ่มต้นที่กำหนดไว้</p>`)}

      ${manualDetail('7. การรับเข้าสินค้า','receive receiving รับเข้า ผู้รับสินค้า ล็อต วันหมดอายุ','📥',`
        <div class="manual-deep-grid">
          ${manualDeepCard('เลือกสินค้าและจำนวน','รับของเข้าระบบ','เลือกสินค้า ระบุจำนวน และเลือก/สร้างล็อต',manualScreenReceive())}
          ${manualDeepCard('วันหมดอายุและหลักฐาน','แนบรูปก่อนบันทึก','ใส่วันรับเข้า วันหมดอายุ และแนบรูปหลักฐาน เช่น ใบส่งของหรือรูปสินค้า',manualScreenReceiveProof())}
        </div>
        <ol class="manual-step-list"><li>กดรายการใหม่</li><li>เลือก รับเข้า</li><li>เลือกสินค้า</li><li>ระบุจำนวน</li><li>เลือกหรือสร้างล็อต</li><li>ระบุวันหมดอายุถ้ามี</li><li>แนบรูปหลักฐาน</li><li>ตรวจสอบแล้วกดบันทึก</li></ol>
        <p class="manual-callout-ok"><b>ผู้รับสินค้า</b> คือพนักงานที่บันทึกหรือรับของเข้าระบบ รายชื่อนี้จะไปแสดงในประวัติและรายละเอียดล็อต</p>`)}

      ${manualDetail('8. การเบิกออกสินค้า','issue withdraw เบิกออก FEFO เหตุผล','📤',`
        <div class="manual-deep-grid">
          ${manualDeepCard('เลือกสินค้าและล็อต','ระบบแนะนำ FEFO','เลือกสินค้าที่ต้องการเบิก ระบบจะแนะนำล็อตที่ควรเบิกก่อน',manualScreenIssue())}
          ${manualDeepCard('กรณีเลือกผิด FEFO','ต้องใส่เหตุผล','ถ้าเลือกล็อตใหม่กว่าทั้งที่มีล็อตเก่ากว่า ระบบจะเตือนและบังคับกรอกเหตุผล',manualScreenFefoWarn())}
        </div>
        <ol class="manual-step-list"><li>กดรายการใหม่</li><li>เลือก เบิกออก</li><li>เลือกสินค้า</li><li>เลือกล็อตที่ต้องการเบิก</li><li>ระบุจำนวนและตำแหน่งใช้งาน</li><li>แนบรูปหลักฐานถ้ามี</li><li>ตรวจสอบแล้วกดบันทึก</li></ol>
        <p class="manual-callout-warn">หลัก FEFO = ล็อตที่หมดอายุก่อน ควรถูกเบิกก่อน เพื่อลดของเสียและป้องกันของหมดอายุค้างสต๊อก</p>`)}

      ${manualDetail('9. ระบบล็อต / FEFO','lot lots FEFO ล็อต วันหมดอายุ ผู้รับสินค้า','🗓️',`
        <div class="manual-deep-grid">
          ${manualDeepCard('รายการล็อต','การ์ดสั้น ไม่รก','หน้ารายการล็อตโชว์เฉพาะชื่อล็อต จำนวนคงเหลือ วันหมดอายุ และป้ายควรเบิกก่อน',manualScreenLots())}
          ${manualDeepCard('รายละเอียดล็อต','กดการ์ดเพื่อดูเต็ม','ดูวันรับเข้า ผู้รับสินค้า ผู้ดำเนินการล่าสุด ประวัติ หมายเหตุ และรหัสล็อตภายใน',manualScreenLotDetail())}
        </div>
        <p class="manual-callout-ok">สินค้า 1 รายการมีได้หลายล็อต เช่น ข้าวผัด-001, ข้าวผัด-002 ระบบใช้ล็อตเพื่อคุมวันหมดอายุและตรวจสอบย้อนหลัง</p>`)}

      ${manualDetail('10. QR Code สินค้า','QR code สแกน พรีวิว preview ลบสินค้า','🔳',`
        <div class="manual-deep-grid">
          ${manualDeepCard('สร้างและพิมพ์ QR','ติดชั้นวางหรือกล่องสินค้า','สร้าง QR จากหน้ารายละเอียดสินค้า แล้วพิมพ์ติดจุดเก็บสินค้า',manualScreenQRPrint())}
          ${manualDeepCard('สแกน QR Preview','ดูข้อมูลเบื้องต้น','สแกนแล้วเห็นชื่อ หมวดหมู่ หน่วยนับ และยอดคงเหลือรวม ก่อนเข้าระบบพนักงาน',manualScreenQR())}
        </div>
        <ol class="manual-step-list"><li>เปิดรายละเอียดสินค้า</li><li>กด QR Code สินค้า</li><li>พิมพ์ป้าย QR</li><li>สแกนเพื่อดูพรีวิวสินค้า</li><li>กดเข้าสู่หน้าสินค้าสำหรับพนักงาน</li><li>ถ้ายังไม่ Login ระบบให้ Login ก่อนแล้วพากลับไปหน้าสินค้านั้น</li></ol>
        <p class="manual-callout-warn">หน้า Preview ไม่แสดงประวัติ ล็อต ราคา หรือข้อมูลภายในก่อนเข้าสู่ระบบ หากสินค้าถูกลบ QR เดิมต้องไม่แสดงข้อมูลสินค้าแล้ว</p>`)}

      ${manualDetail('11. ประวัติรายการ','history ประวัติ รูปหลักฐาน','📋',`
        <div class="manual-deep-grid">
          ${manualDeepCard('ประวัติทั้งหมด','ดูย้อนหลังทีละรายการ','ค้นหาและกรองรับเข้า เบิกออก ปรับยอด หรือรายการอนุมัติ',manualScreenHistory())}
          ${manualDeepCard('รายละเอียดพร้อมรูป','กดการ์ดเพื่อดูภาพใหญ่','ดูรูปหลักฐาน ผู้รับเข้า/ผู้เบิก สถานที่เบิกไปใช้/ตำแหน่งสต็อก ผู้อนุมัติ ล็อต วันเวลา และหมายเหตุ',manualScreenHistoryDetail())}
        </div>
        <p class="manual-callout-ok">ประวัติใช้ตอบคำถามว่า “ใครทำอะไร เมื่อไหร่ จำนวนเท่าไหร่ และมีหลักฐานอะไร”</p>`)}

      ${manualDetail('12. รายงาน','report รายงาน export excel pdf ล็อตที่ต้องระวัง','📊',`
        <div class="manual-deep-grid">
          ${manualDeepCard('รายงานการเคลื่อนไหว','กรองช่วงวันที่','ดูรับเข้า/เบิกออกตามวัน เดือน หรือช่วงวันที่ และส่งออก Excel/CSV หรือ PDF/พิมพ์',manualScreenReport())}
          ${manualDeepCard('ยอดคงเหลือและล็อตระวัง','ดูภาพรวมเพื่อจัดซื้อ','ดูยอดคงเหลือปัจจุบัน สินค้าใกล้หมด และล็อตที่ใกล้หมดอายุ/หมดอายุแล้ว',manualScreenReportStock())}
        </div>
        <p class="manual-callout-ok">รายงานเหมาะสำหรับหัวหน้างานและผู้จัดการ ใช้ตรวจสอบภาพรวม วางแผนจัดซื้อ และส่งเอกสารต่อได้</p>`)}


      ${manualDetail('13. ข้อควรระวังก่อนบันทึกข้อมูลจริง','ข้อควรระวัง ข้อมูลจริง บันทึก จำนวน หน่วยนับ ล็อต ตำแหน่งสต็อก รูปหลักฐาน','⚠️',`
        <ol class="manual-step-list"><li>ตรวจชื่อสินค้าให้ตรงกับสินค้าจริง</li><li>ตรวจจำนวนและหน่วยนับ เช่น จาน ขวด ชิ้น ลัง หรือแพ็ก</li><li>ตรวจล็อตและวันหมดอายุ หากสินค้านั้นมีล็อต</li><li>ตรวจตำแหน่งใช้งานให้ถูกต้อง</li><li>แนบรูปหลักฐานให้ชัดเจนเมื่อมีการรับเข้า เบิกออก หรือข้อมูลผิดปกติ</li><li>อ่านข้อมูลทั้งหมดอีกครั้งก่อนกดบันทึก</li></ol>
        <p class="manual-callout-warn">ระบบนี้ใช้กับข้อมูลจริงของแผนก Food & Beverage หากไม่แน่ใจ ให้สอบถามหัวหน้างานก่อนกดบันทึก</p>`)}

      ${manualDetail('14. หากบันทึกข้อมูลผิดต้องทำอย่างไร','บันทึกผิด แก้ไข แจ้งหัวหน้างาน ผู้ดูแลระบบ จำนวนผิด สินค้าผิด','🛠️',`
        <ol class="manual-step-list"><li>หยุดทำรายการซ้ำเพื่อแก้เองทันที</li><li>แจ้งหัวหน้างานหรือผู้ดูแลระบบ</li><li>ระบุชื่อสินค้า วันที่ เวลา และประเภทรายการที่ผิด</li><li>แจ้งจำนวนที่บันทึกผิด และจำนวนที่ถูกต้อง</li><li>แนบรูปหลักฐานหรือรายละเอียดประกอบ ถ้ามี</li><li>รอให้ผู้มีสิทธิ์ตรวจสอบและแก้ไขตามขั้นตอน</li></ol>
        <p class="manual-callout-warn">ไม่ควรสร้างรายการใหม่เพื่อกลบรายการเดิมโดยไม่แจ้งหัวหน้างาน เพราะอาจทำให้ยอดสต๊อกและประวัติผิดซ้ำ</p>`)}

      ${manualDetail('15. ปัญหาที่พบบ่อย','troubleshooting ปัญหา ไม่มีสิทธิ์ QR cache login fefo','❓',`
        <div class="manual-faq-grid v34202">
          <div><b>สแกน QR แล้วไม่เจอสินค้า</b><span>สินค้าอาจถูกลบแล้ว หรือ QR เป็นใบเก่า ให้แจ้งหัวหน้างานเพื่อสร้าง QR ใหม่จากหน้าสินค้า</span></div>
          <div><b>หน้าเว็บไม่อัปเดต</b><span>รีเฟรชหน้า ล้างแคช Safari/Chrome หรือเปิดเว็บใหม่อีกครั้ง</span></div>
          <div><b>ไม่มีสิทธิ์เข้าถึงข้อมูล</b><span>บัญชีอาจยังไม่ได้รับสิทธิ์ ให้แจ้งหัวหน้างานหรือผู้ดูแลระบบ</span></div>
          <div><b>เบิกสินค้าไม่ได้</b><span>ตรวจจำนวนคงเหลือและล็อตที่เลือก หากล็อตหมดต้องเลือกล็อตอื่น</span></div>
          <div><b>FEFO แจ้งเตือน</b><span>แปลว่ามีล็อตที่ควรเบิกก่อน หากยังเลือกล็อตใหม่ต้องใส่เหตุผล</span></div>
          <div><b>รูปไม่ขึ้นในประวัติ</b><span>ตรวจว่าแนบรูปตอนทำรายการ และอินเทอร์เน็ตยังออนไลน์อยู่</span></div>
        </div>`)}
    </section>

    <section class="manual-summary">
      <h2>ข้อควรจำ</h2>
      <p>ก่อนบันทึกข้อมูลจริงทุกครั้ง ควรตรวจชื่อสินค้า จำนวน หน่วยนับ ล็อต ตำแหน่งสต็อก และรูปหลักฐาน หากไม่แน่ใจให้แจ้งหัวหน้างานหรือผู้ดูแลระบบก่อนแก้ไขข้อมูลจริง</p>
    </section>
  </div>`;
}

function manualScreen(title, body){ return `<div class="manual-demo-screen small"><div class="manual-demo-top"><b>${escapeHtml(title)}</b><span>ตัวอย่าง</span></div><div class="manual-demo-body">${body}</div></div>`; }
function manualScreenDashboard(){return manualScreen('Dashboard',`<div class="manual-demo-kpi"><div>รับเข้า<b>5</b></div><div>เบิกออก<b>12</b></div><div>ใกล้หมด<b>3</b></div></div><div class="manual-demo-row"><em>✅</em><div><b>รายการรออนุมัติ</b><span>ไม่มีรายการรออนุมัติ</span></div></div><div class="manual-demo-row"><em>⚠️</em><div><b>ล็อตใกล้หมดอายุ</b><span>ตรวจสอบก่อนใช้งาน</span></div></div>`)}
function manualScreenDashboardAlerts(){return manualScreen('สิ่งที่ต้องดู',`<div class="manual-demo-row"><em>✅</em><div><b>รายการรออนุมัติ</b><span>กดเข้าไปตรวจรายการ</span></div></div><div class="manual-demo-row"><em>📦</em><div><b>สินค้าใกล้หมด</b><span>เตรียมวางแผนจัดซื้อ</span></div></div><div class="manual-demo-row"><em>🗓️</em><div><b>ล็อตใกล้หมด</b><span>รีบใช้ก่อนหมดอายุ</span></div></div>`)}
function manualScreenLogin(mode='form'){return manualScreen('เข้าสู่ระบบ',`<div class="manual-demo-photo">${mode==='open'?'🌐':'🔐'}</div><div class="manual-demo-input">Username เช่น jettaphonj</div><div class="manual-demo-input">รหัสผ่าน</div><button class="manual-demo-button">เข้าสู่ระบบ</button><span style="color:#64748b;font-weight:800;text-align:center">รหัสเริ่มต้น: chartered</span>`)}
function manualScreenStock(){return manualScreen('สต๊อกสินค้า',`<div class="manual-demo-input">🔎 ค้นหาสินค้า</div><div class="manual-demo-row"><em>🍚</em><div><b>ข้าวผัด</b><span>คงเหลือ 90 จาน</span></div></div><div class="manual-demo-row"><em>🥤</em><div><b>น้ำส้ม</b><span>คงเหลือ 24 ขวด</span></div></div>`)}
function manualScreenProductDetail(){return manualScreen('รายละเอียดสินค้า',`<div class="manual-demo-photo">🍚</div><div class="manual-demo-row"><em>📦</em><div><b>ข้าวผัด</b><span>หมวดหมู่ อาหาร • หน่วย จาน</span></div></div><div class="manual-demo-kpi"><div>คงเหลือ<b>90</b></div><div>ล็อต<b>2</b></div><div>สถานะ<b>OK</b></div></div><button class="manual-demo-button">QR Code สินค้า</button>`)}
function manualScreenAddProduct(mode='start'){return manualScreen('เพิ่มสินค้า',`<div class="manual-demo-photo">${mode==='start'?'＋':'📦'}</div><div class="manual-demo-input">ชื่อสินค้า</div><div class="manual-demo-input">หมวดหมู่</div><div class="manual-demo-input">หน่วยนับ</div><button class="manual-demo-button">บันทึกสินค้า</button>`)}
function manualScreenReceive(){return manualScreen('รับเข้าสินค้า',`<div class="manual-demo-row"><em>🍚</em><div><b>ข้าวผัด</b><span>เลือกสินค้า</span></div></div><div class="manual-demo-input">จำนวน 100 จาน</div><div class="manual-demo-input">ล็อต ข้าวผัด-001</div><div class="manual-demo-input">วันหมดอายุ 10 ส.ค. 2569</div>`)}
function manualScreenReceiveProof(){return manualScreen('หลักฐานรับเข้า',`<div class="manual-demo-photo">📷</div><div class="manual-demo-input">ผู้รับสินค้า: Jettaphon</div><div class="manual-demo-input">แนบรูปหลักฐาน</div><button class="manual-demo-button">ตรวจสอบและบันทึก</button>`)}
function manualScreenIssue(){return manualScreen('เบิกออกสินค้า',`<div class="manual-demo-row"><em>🍚</em><div><b>ข้าวผัด</b><span>คงเหลือ 90 จาน</span></div></div><div class="manual-demo-lot"><b>⭐ ข้าวผัด-001</b><span>ควรเบิกก่อน • เหลือ 90 จาน</span></div><div class="manual-demo-input">สถานที่เบิกไปใช้: TheView</div><button class="manual-demo-button">บันทึกเบิกออก</button>`)}
function manualScreenFefoWarn(){return manualScreen('แจ้งเตือน FEFO',`<div class="manual-demo-warning">คุณเลือกล็อตที่ไม่ใช่ล็อตตามหลัก FEFO กรุณาระบุเหตุผล</div><div class="manual-demo-input">เหตุผล เช่น ใช้งานเฉพาะจุด</div><button class="manual-demo-button">ยืนยันเหตุผล</button>`)}
function manualScreenLots(){return manualScreen('รายการล็อต',`<div class="manual-demo-lot"><b>⭐ ข้าวผัด-001</b><span>คงเหลือ 90 จาน • หมดอายุ 10 ส.ค.</span></div><div class="manual-demo-lot" style="border-left-color:#10b981;background:#fff"><b>ข้าวผัด-002</b><span>คงเหลือ 10 จาน • หมดอายุ 1 ก.ย.</span></div>`)}
function manualScreenLotDetail(){return manualScreen('รายละเอียดล็อต',`<div class="manual-demo-row"><em>🗓️</em><div><b>วันหมดอายุ</b><span>10 ส.ค. 2569</span></div></div><div class="manual-demo-row"><em>👤</em><div><b>ผู้รับสินค้า</b><span>Jettaphon Jaioun</span></div></div><div class="manual-demo-row"><em>📋</em><div><b>ประวัติที่เกี่ยวข้อง</b><span>2 รายการ</span></div></div>`)}
function manualScreenQRPrint(){return manualScreen('QR Code สินค้า',`<div class="manual-demo-qrbox"></div><b style="text-align:center;color:#073f31">ข้าวผัด</b><div class="manual-demo-row"><em>🖨️</em><div><b>พิมพ์ป้าย QR</b><span>ติดชั้นวางหรือกล่องสินค้า</span></div></div>`)}
function manualScreenQR(){return manualScreen('QR Preview',`<div class="manual-demo-qrbox"></div><b style="text-align:center;color:#073f31;font-size:22px">ข้าวผัด</b><div class="manual-demo-kpi"><div>หน่วย<b>จาน</b></div><div>คงเหลือ<b>90</b></div><div>สถานะ<b>พร้อม</b></div></div><button class="manual-demo-button">เข้าสู่หน้าสินค้าสำหรับพนักงาน</button>`)}
function manualScreenHistory(){return manualScreen('ประวัติรายการ',`<div class="manual-demo-input">🔎 ค้นหาสินค้า ผู้ใช้ หรือตำแหน่งสต็อก</div><div class="manual-demo-row"><em>📤</em><div><b>เบิก ข้าวผัด 10 จาน</b><span>รูปหลักฐาน • ผู้เบิก • ล็อต</span></div></div><div class="manual-demo-row"><em>📥</em><div><b>รับเข้า ข้าวผัด 100 จาน</b><span>ผู้รับสินค้า • วันหมดอายุ</span></div></div>`)}
function manualScreenHistoryDetail(){return manualScreen('รายละเอียดประวัติ',`<div class="manual-demo-photo">🖼️</div><div class="manual-demo-row"><em>👤</em><div><b>ผู้เบิกสินค้า</b><span>Jettaphon Jaioun</span></div></div><div class="manual-demo-row"><em>📦</em><div><b>ล็อตสินค้า</b><span>ข้าวผัด-001</span></div></div>`)}
function manualScreenReport(){return manualScreen('รายงาน',`<div class="manual-demo-row"><em>📅</em><div><b>ช่วงวันที่</b><span>รายวัน / รายเดือน / ช่วงวันที่</span></div></div><div class="manual-demo-report-buttons"><button>Excel/CSV</button><button>PDF/พิมพ์</button></div><div class="manual-demo-table"><span></span><span></span><span></span></div>`)}
function manualScreenReportStock(){return manualScreen('ยอดคงเหลือ',`<div class="manual-demo-kpi"><div>ทั้งหมด<b>248</b></div><div>ใกล้หมด<b>8</b></div><div>ล็อตระวัง<b>3</b></div></div><div class="manual-demo-row"><em>⏰</em><div><b>รายงานล็อตที่ต้องระวัง</b><span>ใกล้หมดอายุหรือหมดอายุแล้ว</span></div></div>`)}
function manualDeepCard(icon,title,desc,screen){return `<article class="manual-deep-card"><span class="manual-real-label">ภาพตัวอย่าง</span><h3>${escapeHtml(icon)} ${escapeHtml(title)}</h3><p>${escapeHtml(desc)}</p>${screen||''}</article>`;}

function manualProcessStep(no, icon, title, desc){
  return `<div class="manual-process-step"><span>${escapeHtml(no)}</span><div class="manual-process-icon">${icon}</div><b>${escapeHtml(title)}</b><small>${escapeHtml(desc)}</small></div>`;
}
function manualMiniScreen(icon,title,desc){
  return `<article class="manual-mini-screen"><div>${icon}</div><b>${escapeHtml(title)}</b><span>${escapeHtml(desc)}</span></article>`;
}
function manualStepCard(no,title,desc){
  return `<article class="manual-step-card"><span>${escapeHtml(no)}</span><b>${escapeHtml(title)}</b><small>${escapeHtml(desc)}</small></article>`;
}
function manualFakeDashboard(){
  return `<div class="manual-fake-screen"><div class="fake-top"><b>Dashboard</b><span></span></div><div class="fake-kpis"><i>รับเข้า<br><b>5</b></i><i>เบิกออก<br><b>12</b></i><i>ใกล้หมด<br><b>3</b></i></div><div class="fake-list"><span></span><span></span><span></span></div></div>`;
}
function manualFakeStock(){
  return `<div class="manual-fake-screen"><div class="fake-top"><b>Stock</b><span></span></div><div class="fake-product-row"><em>📦</em><div><b>ข้าวผัด</b><span>90 จาน</span></div></div><div class="fake-product-row"><em>🥤</em><div><b>น้ำส้ม</b><span>24 ขวด</span></div></div><div class="fake-product-row"><em>🔳</em><div><b>QR Code</b><span>พรีวิวสินค้า</span></div></div></div>`;
}
function manualFakeLots(){
  return `<div class="manual-fake-screen"><div class="fake-top"><b>LOT / FEFO</b><span></span></div><div class="fake-lot-card active"><b>ข้าวผัด-001</b><span>คงเหลือ 90 จาน • หมดอายุ 10 ส.ค.</span><small>⭐ ควรเบิกก่อน</small></div><div class="fake-lot-card"><b>ข้าวผัด-002</b><span>คงเหลือ 10 จาน • หมดอายุ 1 ก.ย.</span></div></div>`;
}
function manualFakeQR(){
  return `<div class="manual-fake-screen fake-qr-screen"><div class="manual-qr-big"></div><b>ข้าวผัด</b><span>คงเหลือรวม 90 จาน</span><button type="button">เข้าสู่หน้าสินค้าสำหรับพนักงาน</button></div>`;
}
function manualFakeHistory(){
  return `<div class="manual-fake-screen"><div class="fake-top"><b>History</b><span></span></div><div class="fake-history-row"><b>เบิก ข้าวผัด 10 จาน</b><span>รูปหลักฐาน • ผู้เบิก • ล็อต</span></div><div class="fake-history-row"><b>รับเข้า ข้าวผัด 100 จาน</b><span>ผู้รับสินค้า • วันหมดอายุ</span></div></div>`;
}
function manualFakeReport(){
  return `<div class="manual-fake-screen"><div class="fake-top"><b>Report</b><span></span></div><div class="fake-report-buttons"><button>Excel/CSV</button><button>PDF/พิมพ์</button></div><div class="fake-kpis"><i>คงเหลือ<br><b>248</b></i><i>ใกล้หมด<br><b>8</b></i></div></div>`;
}

function manualDetail(title, keywords, icon, body){
  return `<details class="manual-detail" data-keywords="${escapeHtml(`${title} ${keywords}`.toLowerCase())}" open>
    <summary><span class="manual-detail-icon">${icon}</span><b>${escapeHtml(title)}</b><em>แตะเพื่อเปิด/ปิด</em></summary>
    <div class="manual-detail-body">${body}</div>
  </details>`;
}

window.filterManual=(raw='')=>{
  const q=String(raw||'').trim().toLowerCase();
  const input=document.getElementById('manualSearch');
  if(input && input.value!==raw) input.value=raw;
  document.querySelectorAll('.manual-detail').forEach(el=>{
    const hit=!q || String(el.dataset.keywords||'').includes(q) || el.textContent.toLowerCase().includes(q);
    el.classList.toggle('hidden',!hit);
    if(hit && q) el.open=true;
  });
};

function renderProfile(){
  const p=state.profile||{};
  const trashCount=state.products.filter(x=>x.trashed).length;
  const auditRows = state.logs.slice(0,30).map(l=>{ const {label,cls}=logPillInfo(l); return `<div class="profile-log-row"><div><span class="pill ${cls}">${escapeHtml(label)}</span><div class="profile-log-detail">${escapeHtml(l.detail||'')}</div></div><div class="profile-log-meta">${escapeHtml(l.time||'')}<br>👤 ${escapeHtml(l.actorName||'ไม่ทราบผู้ใช้')}</div></div>`; }).join('') || '<p class="muted">ยังไม่มี Log</p>';
  view.innerHTML = `<div class="profile-page">
    <section class="profile-cover">
      <div class="profile-photo-wrap">
        <div class="profile-photo-avatar" onclick="window.chooseProfilePhoto()" role="button" tabindex="0">
          ${p.photoURL?`<img src="${p.photoURL}" alt="รูปโปรไฟล์">`:escapeHtml(profileInitials())}
        </div>
        <button type="button" class="profile-photo-change" onclick="window.chooseProfilePhoto()" aria-label="เปลี่ยนรูปโปรไฟล์">📷</button>
        <input id="profilePhotoInput" type="file" accept="image/*" class="hidden">
      </div>
      <div class="profile-identity">
        <h1>${escapeHtml(p.displayName||p.username||'สมาชิก')}</h1>
        <div class="profile-badges"><span class="profile-role">${escapeHtml(roleLabel(p.role))}</span><span class="profile-status">● ${p.status==='active'?'Active':'Disabled'}</span></div>
        <p>@${escapeHtml(p.username||'')}</p>
      </div>
    </section>

    <section class="profile-section manual-entry-section">
      <div class="profile-section-title"><span>📘</span><div><h2>คู่มือการใช้งาน</h2><p>รวมวิธีใช้ระบบ รับเข้า เบิกออก ล็อต FEFO QR ประวัติ และรายงาน</p></div></div>
      <button class="profile-action primary full" onclick="window.goToPage('manual')">📘 เปิดคู่มือการใช้งาน</button>
    </section>

    <section class="profile-section">
      <div class="profile-section-title"><span>📷</span><div><h2>รูปโปรไฟล์</h2><p>ใช้แสดงในหน้าโปรไฟล์และรายการที่คุณส่ง</p></div></div>
      <div class="profile-photo-actions">
        <button type="button" class="btn primary" onclick="window.chooseProfilePhoto()">เลือกรูปโปรไฟล์</button>
        <button type="button" class="btn red" onclick="window.removeProfilePhoto()" ${p.photoURL?'':'disabled'}>ลบรูป</button>
      </div>
    </section>

    <section class="profile-section">
      <div class="profile-section-title"><span>👤</span><div><h2>ข้อมูลส่วนตัว</h2><p>แก้ไขข้อมูลที่ใช้แสดงภายในทีม</p></div></div>
      <div class="profile-form-grid">
        <label>ชื่อ<input id="profileFirstName" value="${escapeHtml(p.firstName||'')}" placeholder="ชื่อ"></label>
        <label>นามสกุล<input id="profileLastName" value="${escapeHtml(p.lastName||'')}" placeholder="นามสกุล"></label>
        <label>ตำแหน่ง<input id="profilePosition" value="${escapeHtml(p.position||roleLabel(p.role))}" placeholder="เช่น Staff"></label>
        <label>แผนก / ฝ่าย<input id="profileDepartment" value="${escapeHtml(p.department||'')}" placeholder="เช่น Food & Beverage"></label>
        <label class="profile-wide">เบอร์โทรศัพท์ติดต่อ<input id="profilePhone" type="tel" value="${escapeHtml(p.phone||'')}" placeholder="เบอร์โทรหรือเบอร์ต่อภายใน"></label>
      </div>
      <button id="saveProfileBtn" class="profile-save-btn" onclick="window.saveProfileDetails()">💾 บันทึกการแก้ไขโปรไฟล์</button>
    </section>

    <section class="profile-section">
      <div class="profile-section-title"><span>🛡️</span><div><h2>เปลี่ยนรหัสผ่าน</h2><p>รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร</p></div></div>
      <label>รหัสผ่านปัจจุบัน<input id="currentPass" type="password" autocomplete="current-password"></label>
      <label>รหัสผ่านใหม่<input id="newPass" type="password" autocomplete="new-password"></label>
      <label>ยืนยันรหัสผ่านใหม่<input id="confirmPass" type="password" autocomplete="new-password"></label>
      <button id="savePasswordBtn" class="profile-password-btn" onclick="window.saveNewPassword(false)">🔒 เปลี่ยนรหัสผ่าน</button>
    </section>

    ${canAssignApprovers()?`<section class="profile-section">
      <div class="profile-section-title"><span>✅</span><div><h2>การอนุมัติ</h2><p>เปิด/ปิดสิทธิ์เพิ่มเติมให้พนักงานเป็นรายบุคคล</p></div></div>
      <button class="profile-action primary full" onclick="window.manageApprovalAssistants()">🔐 จัดการสิทธิ์พนักงาน</button>
      <p class="note">หากต้องการเพิ่มพนักงานใหม่ กรุณาแจ้งผู้ดูแลระบบ (Admin) เพื่อเพิ่มชื่อและกำหนดสิทธิ์การใช้งาน</p>
    </section>`:''}
    ${canManageProducts()?`<section class="profile-section"><div class="profile-section-title"><span>🛡️</span><div><h2>ตรวจสอบระบบ</h2><p>ดูประวัติการแก้ไขและปรับยอดย้อนหลัง</p></div></div><button class="profile-action primary full" onclick="window.viewAuditLog()">🛡️ เปิด Audit Log</button></section>`:''}
    ${isAdmin()?`<section class="profile-section">
      <div class="profile-section-title"><span>👥</span><div><h2>ผู้ดูแลระบบ</h2><p>จัดการสมาชิกและข้อมูลสำรอง</p></div></div>
      <div class="profile-action-grid">
        <button class="profile-action primary" onclick="window.manageMembers()">👥 จัดการสมาชิกและตำแหน่ง</button>
        <button class="profile-action" onclick="window.openBrandingSettings()">🎨 ตั้งค่าหน้าตาระบบ</button>
        <button class="profile-action" onclick="window.openStockCardUiSettings()">🃏 ตั้งค่าการ์ด Stock</button>
        <button class="profile-action" onclick="window.openStockStructureSettings()">🏠 จัดการกลุ่ม/พื้นที่สต๊อก</button>
        <button class="profile-action" onclick="window.exportBackup()">⬇️ Export Backup</button>
        <button class="profile-action" onclick="window.chooseBackupFile()">⬆️ Import Backup</button>
        <button class="profile-action" onclick="window.viewTrash()">🗑️ ถังขยะ${trashCount?` (${trashCount})`:''}</button>
      </div>
    </section>
    <section class="profile-section profile-danger">
      <div class="profile-section-title"><span>⚠️</span><div><h2>พื้นที่อันตราย</h2><p>คำสั่งรีเซ็ตจะลบข้อมูลถาวร กรุณา Export Backup ก่อนดำเนินการ</p></div></div>
      <div class="reset-option-list">
        <button class="reset-option reset-usage" onclick="window.openResetConfirm('usage')">
          <span class="reset-option-icon">🧹</span><span><b>1. รีเซ็ตข้อมูลการใช้งาน</b><small>ลบสินค้า สต๊อก รายการ ประวัติ Audit Log การแจ้งเตือน และรูปสินค้า แต่เก็บสมาชิก บทบาท และสิทธิ์ไว้</small></span>
        </button>
        <button class="reset-option reset-history" onclick="window.openResetConfirm('history')">
          <span class="reset-option-icon">🕘</span><span><b>2. รีเซ็ตเฉพาะ Audit Log และประวัติ</b><small>ลบ Audit Log ประวัติรับเข้า–เบิกออก–ปรับยอด และการแจ้งเตือนเก่า โดยเก็บสินค้าและยอดคงเหลือไว้</small></span>
        </button>
        <button class="reset-option reset-factory" onclick="window.openResetConfirm('factory')">
          <span class="reset-option-icon">⛔</span><span><b>3. รีเซ็ตทั้งหมด</b><small>ลบข้อมูลระบบ สมาชิก และสิทธิ์ทั้งหมด โดยเก็บบัญชี Admin ที่กำลังกดไว้ 1 บัญชี</small></span>
        </button>
      </div>
      <p class="reset-auth-note">หมายเหตุ: ระบบเว็บลบโปรไฟล์สมาชิกในฐานข้อมูลได้ แต่บัญชี Firebase Authentication ของสมาชิกคนอื่นต้องลบผ่าน Firebase Console</p>
    </section>`:(canManageProducts()?`<section class="profile-section"><button class="profile-action full" onclick="window.viewTrash()">🗑️ ถังขยะ${trashCount?` (${trashCount})`:''}</button></section>`:'')}
  </div>`;
  refreshPasswordEyes(view);
  const profilePhotoInput=$('profilePhotoInput');
  if(profilePhotoInput){
    profilePhotoInput.onchange=e=>window.saveProfilePhoto(e.target.files?.[0]);
  }
}

window.chooseProfilePhoto=()=>{
  const input=$('profilePhotoInput');
  if(!input) return;
  input.value='';
  input.click();
};

function compressProfilePhoto(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.onload=()=>{
      const img=new Image();
      img.onerror=()=>reject(new Error('เปิดรูปไม่สำเร็จ'));
      img.onload=()=>{
        const size=360;
        const canvas=document.createElement('canvas');
        canvas.width=size;
        canvas.height=size;
        const ctx=canvas.getContext('2d');
        const scale=Math.max(size/img.width,size/img.height);
        const w=img.width*scale;
        const h=img.height*scale;
        const x=(size-w)/2;
        const y=(size-h)/2;
        ctx.fillStyle='#ffffff';
        ctx.fillRect(0,0,size,size);
        ctx.drawImage(img,x,y,w,h);
        resolve(canvas.toDataURL('image/jpeg',0.76));
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}

window.saveProfilePhoto=async(file)=>{
  if(!file) return;
  if(!file.type?.startsWith('image/')) return toast('กรุณาเลือกไฟล์รูปภาพ');
  try{
    toast('กำลังบันทึกรูป...');
    const photoURL=await compressProfilePhoto(file);
    await updateDoc(memberRef(),{
      photoURL,
      profileUpdatedAt:serverTimestamp()
    });
    state.profile={...state.profile,photoURL};
    toast('บันทึกรูปโปรไฟล์แล้ว');
    renderProfile();
  }catch(error){
    console.error(error);
    toast(error?.code==='permission-denied'
      ? 'บันทึกรูปไม่ได้ กรุณา Publish Firestore Rules ชุดใหม่'
      : 'บันทึกรูปโปรไฟล์ไม่สำเร็จ');
  }
};

window.removeProfilePhoto=async()=>{
  if(!state.profile?.photoURL) return;
  if(!confirm('ต้องการลบรูปโปรไฟล์ใช่ไหม?')) return;
  try{
    await updateDoc(memberRef(),{
      photoURL:'',
      profileUpdatedAt:serverTimestamp()
    });
    state.profile={...state.profile,photoURL:''};
    toast('ลบรูปโปรไฟล์แล้ว');
    renderProfile();
  }catch(error){
    console.error(error);
    toast('ลบรูปโปรไฟล์ไม่สำเร็จ');
  }
};

window.saveProfileDetails=async()=>{
  const btn=$('saveProfileBtn');
  const firstName=($('profileFirstName')?.value||'').trim();
  const lastName=($('profileLastName')?.value||'').trim();
  const position=($('profilePosition')?.value||'').trim();
  const department=($('profileDepartment')?.value||'').trim();
  const phone=($('profilePhone')?.value||'').trim();
  if(!firstName) return toast('กรุณากรอกชื่อ');
  if(!lastName) return toast('กรุณากรอกนามสกุล');
  const displayName=`${firstName} ${lastName}`.trim();
  if(btn){btn.disabled=true;btn.textContent='กำลังบันทึก...';}
  try{
    await updateDoc(memberRef(),{firstName,lastName,displayName,position,department,phone,profileUpdatedAt:serverTimestamp()});
    Object.assign(state.profile,{firstName,lastName,displayName,position,department,phone});
    await addLog('แก้ไขโปรไฟล์',displayName);
    toast('บันทึกโปรไฟล์เรียบร้อย');
    renderProfile();
  }catch(e){
    console.error(e);
    toast(e?.code==='permission-denied'
      ? 'บันทึกโปรไฟล์ไม่ได้ กรุณา Publish Firestore Rules ชุดใหม่'
      : `บันทึกโปรไฟล์ไม่สำเร็จ (${e?.code||'unknown'})`);
  }finally{
    if(btn){btn.disabled=false;btn.textContent='💾 บันทึกการแก้ไขโปรไฟล์';}
  }
};
window.openChangePassword=()=>openModal('เปลี่ยนรหัสผ่าน',`<input id="currentPass" type="password" placeholder="รหัสผ่านปัจจุบัน"><input id="newPass" type="password" placeholder="รหัสผ่านใหม่ อย่างน้อย 6 ตัว"><input id="confirmPass" type="password" placeholder="ยืนยันรหัสผ่านใหม่"><button id="savePasswordBtn" class="btn primary full" onclick="window.saveNewPassword(false)">บันทึก</button>`);
window.openFirstPasswordChange=showFirstPasswordGate;
window.saveNewPassword=async(first)=>{
  const user=auth.currentUser;
  const a=(first ? $('firstNewPass') : $('newPass'))?.value||'';
  const b=(first ? $('firstConfirmPass') : $('confirmPass'))?.value||'';
  const current=first ? '' : ($('currentPass')?.value||'');

  if(!user) return toast('ไม่พบการเข้าสู่ระบบ กรุณาออกแล้วเข้าใหม่');
  if(!first && !current) return toast('กรอกรหัสผ่านปัจจุบัน');
  if(a.length<6) return toast('รหัสผ่านอย่างน้อย 6 ตัว');
  if(a.length>128) return toast('รหัสผ่านยาวเกิน 128 ตัว');
  if(a!==b) return toast('รหัสผ่านไม่ตรงกัน');
  if(a===DEFAULT_PASSWORD) return toast('กรุณาตั้งรหัสผ่านอื่น');

  const btn=first ? $('firstPasswordBtn') : $('savePasswordBtn');
  if(btn){ btn.disabled=true; btn.textContent='กำลังเปลี่ยนรหัสผ่าน...'; }

  try{
    if(first){
      // v34.21.1 SIMPLE ADMIN MEMBER CREATE:
      // เปลี่ยนรหัสผ่านครั้งแรกจากหน้าเว็บโดยตรง ไม่ต้อง Deploy Cloud Functions
      await updatePassword(user,a);
      await updateDoc(memberRef(user.uid),{
        mustChangePassword:false,
        passwordChangePending:false,
        passwordChangedAt:serverTimestamp(),
        profileUpdatedAt:serverTimestamp()
      });
      state.user=auth.currentUser;
      state.profile={
        ...(state.profile||{}),
        mustChangePassword:false,
        passwordChangePending:false
      };
      window.__CHEE_AUTH_PHASE__='entering-app';
    await enterMainApp();
    window.__CHEE_AUTH_PHASE__='app-ready';
      toast('ตั้งรหัสผ่านสำเร็จ เข้าสู่ระบบแล้ว');
      return;
    }

    const credential=EmailAuthProvider.credential(user.email,current);
    await reauthenticateWithCredential(user,credential);
    await updatePassword(user,a);
    $('modalCloseBtn')?.classList.remove('hidden');
    hideModal();
    toast('เปลี่ยนรหัสผ่านแล้ว');
  }catch(e){
    console.error('เปลี่ยนรหัสผ่านไม่สำเร็จ',e);
    const code=String(e?.code||'');
    const msg = code==='auth/wrong-password' || code==='auth/invalid-credential'
      ? 'รหัสผ่านปัจจุบันไม่ถูกต้อง'
      : code==='auth/weak-password' || code==='functions/invalid-argument'
        ? (e?.message?.includes('128') ? 'รหัสผ่านยาวเกิน 128 ตัว' : 'รหัสผ่านใหม่ยังไม่ปลอดภัยพอ')
        : code==='auth/requires-recent-login'
          ? 'กรุณาออกจากระบบ แล้วเข้าสู่ระบบใหม่ก่อนเปลี่ยนรหัสผ่าน'
          : code==='permission-denied'
            ? 'ไม่มีสิทธิ์อัปเดตสถานะรหัสผ่าน กรุณาติดต่อผู้ดูแลระบบ'
            : `เปลี่ยนรหัสผ่านไม่สำเร็จ (${code||'unknown'})`;
    toast(msg);
  }finally{
    if(btn){
      btn.disabled=false;
      btn.textContent=first?'ตั้งรหัสผ่านและเข้าระบบ':'บันทึก';
    }
  }
};


function themeOptionsMarkup(selected='green-gold'){
  return Object.entries(THEME_PRESETS).map(([key,item])=>`<option value="${escapeHtml(key)}" ${selected===key?'selected':''}>${escapeHtml(item.label||key)}</option>`).join('');
}
function applyThemeInputsFromPreset(themeName){
  const preset=THEME_PRESETS[themeName]||THEME_PRESETS['green-gold'];
  ['primaryColor','secondaryColor','accentColor','backgroundColor','cardColor','textColor'].forEach(key=>{
    const el=$(`branding_${key}`);
    if(el && preset[key]) el.value=preset[key];
  });
}
function compressBrandLogo(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('อ่านไฟล์โลโก้ไม่สำเร็จ'));
    reader.onload=()=>{
      const img=new Image();
      img.onerror=()=>reject(new Error('เปิดรูปโลโก้ไม่สำเร็จ'));
      img.onload=()=>{
        const maxW=900,maxH=520;
        const scale=Math.min(1,maxW/img.width,maxH/img.height);
        const w=Math.max(1,Math.round(img.width*scale));
        const h=Math.max(1,Math.round(img.height*scale));
        const canvas=document.createElement('canvas');
        canvas.width=w; canvas.height=h;
        const ctx=canvas.getContext('2d');
        ctx.clearRect(0,0,w,h);
        ctx.drawImage(img,0,0,w,h);
        let dataUrl=canvas.toDataURL('image/png');
        // Firestore document limit guard: if PNG is still large, fallback to JPEG white background.
        if(dataUrl.length>650000){
          ctx.globalCompositeOperation='destination-over';
          ctx.fillStyle='#ffffff';
          ctx.fillRect(0,0,w,h);
          dataUrl=canvas.toDataURL('image/jpeg',0.82);
        }
        if(dataUrl.length>900000) return reject(new Error('โลโก้ใหญ่เกินไป กรุณาใช้ไฟล์ขนาดเล็กลง'));
        resolve(dataUrl);
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}


function jsArg(value){ return JSON.stringify(String(value??'')).replace(/"/g,'&quot;'); }
function sampleChipsMarkup(targetId,samples){
  return `<div class="branding-example-block"><small>ตัวอย่างที่ใช้บ่อย</small><div class="branding-chip-row">${samples.map(text=>`<button type="button" class="branding-example-chip" onclick="window.applyBrandingSample(${jsArg(targetId)},${jsArg(text)})">${escapeHtml(text)}</button>`).join('')}</div></div>`;
}
function brandingPresetButtonsMarkup(){
  return `<section class="branding-subsection branding-preset-section"><div class="settings-section-head"><span class="settings-step-badge">1</span><div><h3>เลือกตัวอย่างสำเร็จรูป</h3><p>กด 1 ครั้ง ระบบจะเติมชื่อระบบ คำอธิบาย ธีม หน้า Login และลำดับ Dashboard ให้ก่อน แล้วค่อยแก้รายละเอียดต่อได้</p></div></div><div class="branding-preset-grid">${Object.entries(BRANDING_QUICK_PRESETS).map(([key,p])=>`<button type="button" class="branding-preset-btn" onclick="window.applyBrandingPreset(${jsArg(key)})"><b>${escapeHtml(p.label)}</b><span>${escapeHtml(p.hint)}</span></button>`).join('')}</div></section>`;
}
function settingsOptionsMarkup(options,selected){ return Object.entries(options).map(([value,label])=>`<option value="${escapeHtml(value)}" ${selected===value?'selected':''}>${escapeHtml(label)}</option>`).join(''); }
function cardOrderOptionsMarkup(allowed,selected){ return allowed.map(value=>`<option value="${escapeHtml(value)}" ${selected===value?'selected':''}>${escapeHtml(DASHBOARD_CARD_LABELS[value]||value)}</option>`).join(''); }
function loginDeviceCustomizationMarkup(b){
  return `<section class="branding-subsection device-settings-section"><div class="settings-section-head"><span class="settings-step-badge">4</span><div><h3>ปรับหน้า Login แยก PC / มือถือ</h3><p>ตั้งค่ากลางใช้ร่วมกัน ส่วนหน้า PC และหน้ามือถือปรับแยกกัน เพื่อไม่ให้แก้ PC แล้วมือถือเพี้ยน หรือแก้มือถือแล้ว PC เล็กเกินไป</p></div></div>
    <div class="device-settings-tabs"><span>ตั้งค่ากลาง</span><span>หน้า PC</span><span>หน้ามือถือ</span></div>
    <div class="device-settings-grid">
      <article class="device-setting-card"><h4>ตั้งค่ากลาง</h4><p>มีผลทั้ง PC และมือถือ</p>
        <div class="branding-field-group"><label>ข้อความหัว Login<input id="brandingLoginWelcome" maxlength="80" value="${escapeHtml(b.loginWelcomeText)}" placeholder="เข้าสู่ระบบ"></label>${sampleChipsMarkup('brandingLoginWelcome',BRANDING_SAMPLE_LIBRARY.loginWelcome)}</div>
        <div class="branding-field-group"><label>ข้อความสถานะระบบ<input id="brandingLoginStatus" maxlength="80" value="${escapeHtml(b.loginStatusText)}" placeholder="ระบบพร้อมใช้งาน"></label>${sampleChipsMarkup('brandingLoginStatus',BRANDING_SAMPLE_LIBRARY.loginStatus)}</div>
        <div class="branding-two-col"><label>รูปแบบ Login<select id="brandingLoginLayout">${settingsOptionsMarkup(LOGIN_LAYOUTS,b.loginLayout)}</select><span class="branding-field-note">เป็นโครงหลักของหน้า Login</span></label><label>พื้นหลัง Login<select id="brandingLoginPattern">${settingsOptionsMarkup(LOGIN_PATTERNS,b.loginPattern)}</select><span class="branding-field-note">เลือกพื้นหลังให้เข้ากับแผนก</span></label></div>
      </article>
      <article class="device-setting-card"><h4>หน้า PC</h4><p>ใช้ปรับจอคอมโดยเฉพาะ เช่น ตัวหนังสือฝั่งซ้าย โลโก้ และกล่อง Login</p>
        <div class="branding-two-col"><label>ชื่อระบบฝั่งซ้าย PC<select id="brandingDesktopTitleSize">${settingsOptionsMarkup(LOGIN_DESKTOP_TITLE_SIZES,b.desktopLoginTitleSize)}</select></label><label>คำอธิบายฝั่งซ้าย PC<select id="brandingDesktopSubtitleSize">${settingsOptionsMarkup(LOGIN_DESKTOP_SUBTITLE_SIZES,b.desktopLoginSubtitleSize)}</select></label></div>
        <div class="branding-two-col"><label>โลโก้ฝั่งซ้าย PC<select id="brandingDesktopLogoSize">${settingsOptionsMarkup(LOGIN_DESKTOP_LOGO_SIZES,b.desktopLoginLogoSize)}</select></label><label>ขนาดกล่อง Login PC<select id="brandingDesktopFormSize">${settingsOptionsMarkup(LOGIN_DESKTOP_FORM_SIZES,b.desktopLoginFormSize)}</select></label></div>
        <label>สัดส่วนหน้า PC<select id="brandingDesktopPanelWidth">${settingsOptionsMarkup(LOGIN_DESKTOP_PANEL_WIDTHS,b.desktopLoginPanelWidth)}</select><span class="branding-field-note">ถ้าอยากให้ข้อความซ้ายเด่นขึ้น เลือก “เน้นภาพ/ข้อความซ้าย”</span></label>
      </article>
      <article class="device-setting-card"><h4>หน้ามือถือ</h4><p>ใช้ปรับมือถือแยกจาก PC เพื่อรักษาหน้ามือถือที่ลงตัวแล้ว</p>
        <div class="branding-two-col"><label>ชื่อระบบมือถือ<select id="brandingMobileTitleSize">${settingsOptionsMarkup(LOGIN_MOBILE_TITLE_SIZES,b.mobileLoginTitleSize)}</select></label><label>คำอธิบายมือถือ<select id="brandingMobileSubtitleSize">${settingsOptionsMarkup(LOGIN_MOBILE_SUBTITLE_SIZES,b.mobileLoginSubtitleSize)}</select></label></div>
        <div class="branding-two-col"><label>โลโก้มือถือ<select id="brandingMobileLogoSize">${settingsOptionsMarkup(LOGIN_MOBILE_LOGO_SIZES,b.mobileLoginLogoSize)}</select></label><label>รูปภาพด้านล่างมือถือ<select id="brandingMobilePhotoHeight">${settingsOptionsMarkup(LOGIN_MOBILE_PHOTO_HEIGHTS,b.mobileLoginPhotoHeight)}</select></label></div>
      </article>
    </div>
  </section>`;
}
function dashboardCustomizationMarkup(b){
  const hidden=new Set(b.dashboardHiddenCards||[]);
  const sectionRows=DASHBOARD_SECTION_CARDS.map((id)=>`<div class="dashboard-setting-row"><label><input type="checkbox" class="dash-visible" data-card="${id}" ${hidden.has(id)?'':'checked'}> <span>${escapeHtml(DASHBOARD_CARD_LABELS[id]||id)}</span></label><select class="dash-section-order" data-card="${id}" aria-label="ลำดับ ${escapeHtml(DASHBOARD_CARD_LABELS[id]||id)}">${[1,2,3,4,5].map(n=>`<option value="${n}" ${b.dashboardCardOrder.indexOf(id)===n-1?'selected':''}>ลำดับ ${n}</option>`).join('')}</select></div>`).join('');
  const statRows=DASHBOARD_STAT_CARDS.map((id)=>`<div class="dashboard-setting-row"><label><input type="checkbox" class="dash-visible" data-card="${id}" ${hidden.has(id)?'':'checked'}> <span>${escapeHtml(DASHBOARD_CARD_LABELS[id]||id)}</span></label><select class="dash-stat-order" data-card="${id}" aria-label="ลำดับ ${escapeHtml(DASHBOARD_CARD_LABELS[id]||id)}">${[1,2,3,4,5].map(n=>`<option value="${n}" ${b.dashboardStatOrder.indexOf(id)===n-1?'selected':''}>ลำดับ ${n}</option>`).join('')}</select></div>`).join('');
  return `${loginDeviceCustomizationMarkup(b)}
  <section class="branding-subsection"><div class="settings-section-head"><span class="settings-step-badge">5</span><div><h3>ปรับหน้าแรก / Dashboard</h3><p>เปิด/ปิดการ์ด จัดลำดับ และเลือกขนาดตัวหนังสือ โดยใช้ตัวเลือกที่ปลอดภัยกับมือถือ</p></div></div><div class="branding-two-col"><label>ขนาดตัวหนังสือ<select id="brandingDashboardTextSize">${settingsOptionsMarkup(DASHBOARD_TEXT_SIZES,b.dashboardTextSize)}</select><span class="branding-field-note">ถ้าต้องอ่านบนมือถือบ่อย แนะนำ: ใหญ่</span></label><label>ขนาดการ์ด<select id="brandingDashboardCardSize">${settingsOptionsMarkup(DASHBOARD_CARD_SIZES,b.dashboardCardSize)}</select><span class="branding-field-note">ถ้าอยากให้แตะง่ายขึ้น แนะนำ: มาตรฐานหรือใหญ่</span></label></div><div class="dashboard-settings-list"><h4>การ์ดหลักหน้าแรก</h4>${sectionRows}<h4>การ์ดตัวเลขบน Dashboard</h4>${statRows}</div><p class="note">หมายเหตุ: ใช้ปุ่มลำดับแทนการลาก เพื่อให้ iPhone/iPad ไม่เพี้ยน</p></section>`;
}
function previewClass(value,prefix){
  const raw=String(value||'').trim();
  if(!raw) return '';
  const safe=raw.replace(/[^a-zA-Z0-9_-]/g,'');
  if(!safe) return '';
  // ค่า default ไม่ต้องใส่ class เพื่อให้ใช้ CSS พื้นฐานเดิม
  if(prefix==='layout' && safe==='modern') return '';
  if(prefix==='pattern' && safe==='curves') return '';
  if(prefix==='dpanel' && safe==='balanced') return '';
  if(prefix==='dform' && safe==='normal') return '';
  if(prefix==='text' && safe==='normal') return '';
  if(prefix==='card' && safe==='normal') return '';
  return `${prefix}-${safe}`;
}

function brandingPreviewMarkup(b){
  const logo=String(state.tempBrandLogo||b.logoUrl||DEFAULT_BRANDING.logoUrl).replace(/"/g,'&quot;');
  const hidden=new Set(b.dashboardHiddenCards||[]);
  const statCards={
    statIn:`<div class="preview-stat"><small>รับเข้าวันนี้</small><b>5</b><span>35 หน่วย</span></div>`,
    statOut:`<div class="preview-stat"><small>เบิกออกวันนี้</small><b>12</b><span>48 หน่วย</span></div>`,
    statProducts:`<div class="preview-stat"><small>สินค้าทั้งหมด</small><b>86</b><span>พร้อมใช้งาน</span></div>`,
    statLow:`<div class="preview-stat warn"><small>สต๊อกใกล้หมด</small><b>3</b><span>ควรตรวจสอบ</span></div>`,
    statExpiry:`<div class="preview-stat warn"><small>ใกล้หมดอายุ</small><b>2</b><span>ควรตรวจสอบ</span></div>`
  };
  const statsHtml=b.dashboardStatOrder.filter(id=>!hidden.has(id)).map(id=>statCards[id]||'').join('');
  const sectionCards={
    priority:`<div class="preview-priority"><span>✅</span><div><small>รายการรออนุมัติ</small><b>0</b><em>ไม่มีรายการรออนุมัติ</em></div></div>`,
    stats:statsHtml?`<div class="preview-stat-grid">${statsHtml}</div>`:`<div class="preview-empty">การ์ดตัวเลขถูกซ่อนไว้ทั้งหมด</div>`,
    chart:`<div class="preview-panel"><div class="preview-panel-head"><b>7 วันล่าสุด</b><small>รับเข้า / เบิกออก</small></div><div class="preview-bars"><i style="height:30%"></i><i style="height:55%"></i><i style="height:42%"></i><i style="height:80%"></i><i style="height:48%"></i></div></div>`,
    topUsed:`<div class="preview-panel"><div class="preview-panel-head"><b>เบิกมากที่สุด</b><small>ตัวอย่างรายการ</small></div><p>1. โซดา • 24 ขวด</p><p>2. น้ำแข็ง • 18 ถุง</p></div>`,
    alerts:`<div class="preview-panel alert"><div class="preview-panel-head"><b>แจ้งเตือนสินค้า</b><small>สต๊อก/วันหมดอายุ</small></div><p>⚠️ สต๊อกใกล้หมด 3 รายการ</p><p>⏰ ใกล้หมดอายุ 2 รายการ</p></div>`
  };
  const ordered=b.dashboardCardOrder.filter(id=>!hidden.has(id)).map(id=>sectionCards[id]||'').join('')||'<div class="preview-empty">Admin ปิดการ์ดหน้าแรกทั้งหมดไว้</div>';
  const loginPreview=(kind)=>`<div class="preview-login-screen preview-${kind} ${previewClass(b.loginLayout,'layout')} ${previewClass(b.loginPattern,'pattern')} ${kind==='desktop'?previewClass(b.desktopLoginTitleSize,'dtitle')+' '+previewClass(b.desktopLoginSubtitleSize,'dsubtitle')+' '+previewClass(b.desktopLoginLogoSize,'dlogo')+' '+previewClass(b.desktopLoginFormSize,'dform')+' '+previewClass(b.desktopLoginPanelWidth,'dpanel'):previewClass(b.mobileLoginTitleSize,'mtitle')+' '+previewClass(b.mobileLoginSubtitleSize,'msubtitle')+' '+previewClass(b.mobileLoginLogoSize,'mlogo')+' '+previewClass(b.mobileLoginPhotoHeight,'mphoto')}"><div class="preview-login-hero"><img src="${logo}" alt="${escapeHtml(b.systemName)}"><b>${escapeHtml(b.systemName)}</b><small>${escapeHtml(b.systemSubtitle)}</small></div><div class="preview-login-box"><h4>${escapeHtml(b.loginWelcomeText)}</h4><label>Username</label><div class="preview-input"></div><label>Password</label><div class="preview-input short"></div><button type="button">เข้าสู่ระบบ</button><p>● ${escapeHtml(b.loginStatusText)}</p></div><div class="preview-mobile-photo"></div></div>`;
  return `<section class="branding-preview-section" style="--preview-primary:${escapeHtml(b.primaryColor)};--preview-secondary:${escapeHtml(b.secondaryColor)};--preview-accent:${escapeHtml(b.accentColor)};--preview-bg:${escapeHtml(b.backgroundColor)};--preview-card:${escapeHtml(b.cardColor)};--preview-text:${escapeHtml(b.textColor)}"><div class="branding-preview-title"><div><h3>ตัวอย่างแสดงผลทันที</h3><p>แยกดู PC และมือถือ เพื่อปรับแต่ละอุปกรณ์ไม่ให้กระทบกัน</p></div><span>PC / Mobile</span></div><div class="branding-preview-grid device-preview-grid"><div class="branding-preview-device preview-wide"><div class="preview-device-label">ตัวอย่างหน้า Login — PC</div>${loginPreview('desktop')}</div><div class="branding-preview-device preview-narrow"><div class="preview-device-label">ตัวอย่างหน้า Login — มือถือ</div>${loginPreview('mobile')}</div><div class="branding-preview-device"><div class="preview-device-label">ตัวอย่าง Dashboard</div><div class="preview-dashboard-screen ${previewClass(b.dashboardTextSize,'text')} ${previewClass(b.dashboardCardSize,'card')}"><div class="preview-dashboard-top"><div><small>ภาพรวมคลังสินค้า</small><h4>หน้าแรก</h4></div><span>วันนี้</span></div>${ordered}</div></div></div></section>`;
}


window.applyBrandingSample=(targetId,value)=>{
  const el=$(targetId);
  if(!el) return;
  el.value=value;
  el.dispatchEvent(new Event('input',{bubbles:true}));
  window.refreshBrandingPreview?.();
};
window.applyBrandingPreset=(key)=>{
  const p=BRANDING_QUICK_PRESETS[key];
  if(!p) return;
  const assign={
    brandingName:p.systemName,
    brandingSubtitle:p.systemSubtitle,
    brandingLoginWelcome:p.loginWelcomeText,
    brandingLoginStatus:p.loginStatusText,
    brandingTheme:p.themeName,
    brandingLoginLayout:p.loginLayout,
    brandingLoginPattern:p.loginPattern,
    brandingDashboardTextSize:p.dashboardTextSize,
    brandingDashboardCardSize:p.dashboardCardSize,
    brandingDesktopTitleSize:p.desktopLoginTitleSize||DEFAULT_BRANDING.desktopLoginTitleSize,
    brandingDesktopSubtitleSize:p.desktopLoginSubtitleSize||DEFAULT_BRANDING.desktopLoginSubtitleSize,
    brandingDesktopLogoSize:p.desktopLoginLogoSize||DEFAULT_BRANDING.desktopLoginLogoSize,
    brandingDesktopFormSize:p.desktopLoginFormSize||DEFAULT_BRANDING.desktopLoginFormSize,
    brandingDesktopPanelWidth:p.desktopLoginPanelWidth||DEFAULT_BRANDING.desktopLoginPanelWidth,
    brandingMobileTitleSize:p.mobileLoginTitleSize||DEFAULT_BRANDING.mobileLoginTitleSize,
    brandingMobileSubtitleSize:p.mobileLoginSubtitleSize||DEFAULT_BRANDING.mobileLoginSubtitleSize,
    brandingMobileLogoSize:p.mobileLoginLogoSize||DEFAULT_BRANDING.mobileLoginLogoSize,
    brandingMobilePhotoHeight:p.mobileLoginPhotoHeight||DEFAULT_BRANDING.mobileLoginPhotoHeight
  };
  Object.entries(assign).forEach(([id,value])=>{ const el=$(id); if(el && value!==undefined) el.value=value; });
  if(p.themeName && p.themeName!=='custom') applyThemeInputsFromPreset(p.themeName);
  const hidden=new Set(p.dashboardHiddenCards||[]);
  document.querySelectorAll('.dash-visible').forEach(el=>{ el.checked=!hidden.has(el.dataset.card); });
  document.querySelectorAll('.dash-section-order').forEach(el=>{ const idx=(p.dashboardCardOrder||[]).indexOf(el.dataset.card); if(idx>=0) el.value=String(idx+1); });
  document.querySelectorAll('.dash-stat-order').forEach(el=>{ const idx=(p.dashboardStatOrder||[]).indexOf(el.dataset.card); if(idx>=0) el.value=String(idx+1); });
  window.refreshBrandingPreview?.();
  toast(`ใส่ตัวอย่าง ${p.label} แล้ว ดู Preview ก่อนกดบันทึก`);
};
window.openBrandingSettings=()=>{ if(!requireAdmin()) return;
  state.tempBrandLogo='';
  const b=normalizeBranding(state.branding||{});
  openModal('ตั้งค่าหน้าตาระบบ',`<div class="branding-settings-panel">
    <div class="branding-guide-card"><b>วิธีตั้งค่าแบบไม่งง</b><span>ไล่ทำจากบนลงล่าง: 1 เลือกตัวอย่างสำเร็จรูป → 2 ตั้งชื่อระบบ → 3 โลโก้/ธีมสี → 4 หน้า Login → 5 Dashboard → 6 ดู Preview แล้วค่อยบันทึก</span></div>
    ${brandingPresetButtonsMarkup()}
    <section class="branding-subsection"><div class="settings-section-head"><span class="settings-step-badge">2</span><div><h3>ชื่อระบบและคำอธิบาย</h3><p>ใช้แสดงบนหน้า Login, Header, QR Preview และเอกสารส่งออก</p></div></div>
      <div class="branding-field-group"><label>ชื่อระบบหลัก<input id="brandingName" maxlength="60" value="${escapeHtml(b.systemName)}" placeholder="เช่น CHEE CHAN STOCK"></label>${sampleChipsMarkup('brandingName',BRANDING_SAMPLE_LIBRARY.systemNames)}</div>
      <div class="branding-field-group"><label>คำอธิบายรอง<input id="brandingSubtitle" maxlength="120" value="${escapeHtml(b.systemSubtitle)}" placeholder="เช่น Food & Beverage Inventory Management"></label>${sampleChipsMarkup('brandingSubtitle',BRANDING_SAMPLE_LIBRARY.subtitles)}</div>
    </section>
    <section class="branding-subsection"><div class="settings-section-head"><span class="settings-step-badge">3</span><div><h3>โลโก้และธีมสี</h3><p>เปลี่ยนโลโก้ เลือกธีมสำเร็จรูป หรือปรับสีเองแบบจำกัดเพื่อไม่ให้หน้าเว็บพัง</p></div></div>
      <div class="branding-logo-box">
        <img id="brandingLogoPreview" src="${String(b.logoUrl||DEFAULT_BRANDING.logoUrl).replace(/"/g,'&quot;')}" alt="ตัวอย่างโลโก้">
        <div><b>โลโก้ระบบ</b><span>รองรับ PNG/JPG ระบบจะย่อรูปให้เหมาะกับเว็บ</span><div class="row"><button class="btn light" onclick="window.pickBrandLogo()">📷 เลือกโลโก้</button><button class="btn" onclick="window.clearBrandLogo()">ใช้โลโก้เดิม</button></div></div>
        <input id="brandingLogoInput" type="file" accept="image/*" class="hidden">
      </div>
      <label>ธีมสี<select id="brandingTheme" onchange="window.brandingThemeChanged()">${themeOptionsMarkup(b.themeName)}</select><span class="branding-field-note">ถ้าไม่มั่นใจ เลือกธีมสำเร็จรูปก่อน แล้วดู Preview</span></label>
      <div class="branding-color-grid">
        <label>สีหลัก<input id="branding_primaryColor" type="color" value="${escapeHtml(b.primaryColor)}"></label>
        <label>สีเข้ม<input id="branding_secondaryColor" type="color" value="${escapeHtml(b.secondaryColor)}"></label>
        <label>สีทอง/สีเน้น<input id="branding_accentColor" type="color" value="${escapeHtml(b.accentColor)}"></label>
        <label>สีพื้นหลัง<input id="branding_backgroundColor" type="color" value="${escapeHtml(b.backgroundColor)}"></label>
        <label>สีการ์ด<input id="branding_cardColor" type="color" value="${escapeHtml(b.cardColor)}"></label>
        <label>สีตัวอักษร<input id="branding_textColor" type="color" value="${escapeHtml(b.textColor)}"></label>
      </div>
    </section>
    ${dashboardCustomizationMarkup(b)}
    <section class="branding-subsection"><div class="settings-section-head"><span class="settings-step-badge">6</span><div><h3>ตรวจตัวอย่างก่อนบันทึก</h3><p>Preview ด้านล่างเป็นตัวอย่างบนมือถือ/เว็บ ถ้าโอเคแล้วค่อยกดบันทึก</p></div></div><div id="brandingPreview">${brandingPreviewMarkup(b)}</div></section>
    <div class="branding-actions"><button id="saveBrandingBtn" class="btn primary full" onclick="window.saveBrandingSettings()">💾 บันทึกหน้าตาระบบ</button><button class="btn light full" onclick="window.resetBrandingSettings()">↩️ คืนค่าเริ่มต้น</button></div>
  </div>`);
  const input=$('brandingLogoInput');
  if(input){
    input.onchange=async(e)=>{
      const file=e.target.files?.[0];
      if(!file) return;
      if(!file.type?.startsWith('image/')) return toast('กรุณาเลือกไฟล์รูปภาพ');
      try{
        toast('กำลังเตรียมโลโก้...');
        state.tempBrandLogo=await compressBrandLogo(file);
        const preview=$('brandingLogoPreview'); if(preview) preview.src=state.tempBrandLogo;
        window.refreshBrandingPreview();
      }catch(err){ console.error(err); toast(err?.message||'เตรียมโลโก้ไม่สำเร็จ'); }
    };
  }
  ['brandingName','brandingSubtitle','brandingLoginWelcome','brandingLoginStatus','branding_primaryColor','branding_secondaryColor','branding_accentColor','branding_backgroundColor','branding_cardColor','branding_textColor'].forEach(id=>{
    const el=$(id); if(el) el.addEventListener('input',window.refreshBrandingPreview);
  });
  ['brandingLoginLayout','brandingLoginPattern','brandingDesktopTitleSize','brandingDesktopSubtitleSize','brandingDesktopLogoSize','brandingDesktopFormSize','brandingDesktopPanelWidth','brandingMobileTitleSize','brandingMobileSubtitleSize','brandingMobileLogoSize','brandingMobilePhotoHeight','brandingDashboardTextSize','brandingDashboardCardSize','brandingTheme'].forEach(id=>{
    const el=$(id); if(el) el.addEventListener('change',window.refreshBrandingPreview);
  });
  document.querySelectorAll('.dash-visible,.dash-section-order,.dash-stat-order').forEach(el=>el.addEventListener('change',window.refreshBrandingPreview));
};
window.pickBrandLogo=()=>{ const input=$('brandingLogoInput'); if(input){ input.value=''; input.click(); } };
window.clearBrandLogo=()=>{ state.tempBrandLogo=DEFAULT_BRANDING.logoUrl; const img=$('brandingLogoPreview'); if(img) img.src=DEFAULT_BRANDING.logoUrl; window.refreshBrandingPreview(); };
window.brandingThemeChanged=()=>{
  const theme=$('brandingTheme')?.value||'green-gold';
  if(theme!=='custom') applyThemeInputsFromPreset(theme);
  window.refreshBrandingPreview();
};
function collectDashboardOrder(selector,allowed,defaults){
  try{
    const fallback=Array.isArray(defaults)?defaults:[...(allowed||[])];
    const rows=Array.from(document.querySelectorAll(selector||''));
    if(!rows.length) return normalizeOrder([],allowed||[],fallback);
    const rankMap=new Map();
    rows.forEach((el,index)=>{
      const card=String(el?.dataset?.card||'').trim();
      if(!(allowed||[]).includes(card)) return;
      const rawRank=Number.parseInt(el.value,10);
      const rank=Number.isFinite(rawRank)?rawRank:(index+1);
      if(!rankMap.has(card)) rankMap.set(card,rank);
    });
    const ordered=[...(allowed||[])].sort((a,b)=>{
      const ra=rankMap.has(a)?rankMap.get(a):Number.MAX_SAFE_INTEGER;
      const rb=rankMap.has(b)?rankMap.get(b):Number.MAX_SAFE_INTEGER;
      if(ra!==rb) return ra-rb;
      const fa=fallback.indexOf(a);
      const fb=fallback.indexOf(b);
      if(fa!==fb) return fa-fb;
      return String(a).localeCompare(String(b),'th');
    });
    return normalizeOrder(ordered,allowed||[],fallback);
  }catch(err){
    console.warn('collectDashboardOrder failed',err);
    return normalizeOrder(defaults,allowed||[],Array.isArray(defaults)?defaults:[...(allowed||[])]);
  }
}
function collectHiddenDashboardCards(){
  try{
    const allowed=[...DASHBOARD_SECTION_CARDS,...DASHBOARD_STAT_CARDS];
    const hidden=Array.from(document.querySelectorAll('.dash-visible')).filter(el=>!el.checked).map(el=>String(el?.dataset?.card||'').trim());
    return normalizeHiddenCards(hidden.filter(card=>allowed.includes(card)));
  }catch(err){
    console.warn('collectHiddenDashboardCards failed',err);
    return normalizeHiddenCards([]);
  }
}
window.collectBrandingForm=()=>normalizeBranding({
  systemName:($('brandingName')?.value||'').trim(),
  systemSubtitle:($('brandingSubtitle')?.value||'').trim(),
  logoUrl:state.tempBrandLogo || $('brandingLogoPreview')?.getAttribute('src') || appLogoUrl(),
  themeName:$('brandingTheme')?.value||'green-gold',
  primaryColor:$('branding_primaryColor')?.value||DEFAULT_BRANDING.primaryColor,
  secondaryColor:$('branding_secondaryColor')?.value||DEFAULT_BRANDING.secondaryColor,
  accentColor:$('branding_accentColor')?.value||DEFAULT_BRANDING.accentColor,
  backgroundColor:$('branding_backgroundColor')?.value||DEFAULT_BRANDING.backgroundColor,
  cardColor:$('branding_cardColor')?.value||DEFAULT_BRANDING.cardColor,
  textColor:$('branding_textColor')?.value||DEFAULT_BRANDING.textColor,
  loginWelcomeText:($('brandingLoginWelcome')?.value||DEFAULT_BRANDING.loginWelcomeText).trim(),
  loginStatusText:($('brandingLoginStatus')?.value||DEFAULT_BRANDING.loginStatusText).trim(),
  loginLayout:$('brandingLoginLayout')?.value||DEFAULT_BRANDING.loginLayout,
  loginPattern:$('brandingLoginPattern')?.value||DEFAULT_BRANDING.loginPattern,
  desktopLoginTitleSize:$('brandingDesktopTitleSize')?.value||DEFAULT_BRANDING.desktopLoginTitleSize,
  desktopLoginSubtitleSize:$('brandingDesktopSubtitleSize')?.value||DEFAULT_BRANDING.desktopLoginSubtitleSize,
  desktopLoginLogoSize:$('brandingDesktopLogoSize')?.value||DEFAULT_BRANDING.desktopLoginLogoSize,
  desktopLoginFormSize:$('brandingDesktopFormSize')?.value||DEFAULT_BRANDING.desktopLoginFormSize,
  desktopLoginPanelWidth:$('brandingDesktopPanelWidth')?.value||DEFAULT_BRANDING.desktopLoginPanelWidth,
  mobileLoginTitleSize:$('brandingMobileTitleSize')?.value||DEFAULT_BRANDING.mobileLoginTitleSize,
  mobileLoginSubtitleSize:$('brandingMobileSubtitleSize')?.value||DEFAULT_BRANDING.mobileLoginSubtitleSize,
  mobileLoginLogoSize:$('brandingMobileLogoSize')?.value||DEFAULT_BRANDING.mobileLoginLogoSize,
  mobileLoginPhotoHeight:$('brandingMobilePhotoHeight')?.value||DEFAULT_BRANDING.mobileLoginPhotoHeight,
  dashboardTextSize:$('brandingDashboardTextSize')?.value||DEFAULT_BRANDING.dashboardTextSize,
  dashboardCardSize:$('brandingDashboardCardSize')?.value||DEFAULT_BRANDING.dashboardCardSize,
  dashboardCardOrder:collectDashboardOrder('.dash-section-order',DASHBOARD_SECTION_CARDS,DEFAULT_BRANDING.dashboardCardOrder),
  dashboardStatOrder:collectDashboardOrder('.dash-stat-order',DASHBOARD_STAT_CARDS,DEFAULT_BRANDING.dashboardStatOrder),
  dashboardHiddenCards:collectHiddenDashboardCards()
});
window.refreshBrandingPreview=()=>{ const box=$('brandingPreview'); if(!box) return; try{ box.innerHTML=brandingPreviewMarkup(window.collectBrandingForm()); }catch(err){ console.error('refreshBrandingPreview failed',err); } };
window.saveBrandingSettings=async()=>{ if(!requireAdmin()) return;
  const btn=$('saveBrandingBtn');
  if(btn){btn.disabled=true;btn.textContent='กำลังบันทึก...';}
  try{
    const next=window.collectBrandingForm();
    if(!next.systemName) return toast('กรุณากรอกชื่อระบบ');
    if(!next.systemSubtitle) return toast('กรุณากรอกคำอธิบายระบบ');
    await setDoc(settingsDocRef(),{...next,updatedAt:serverTimestamp(),updatedByUid:state.user?.uid||'',updatedByName:state.profile?.displayName||state.profile?.username||''},{merge:true});
    state.branding=next;
    applySystemBranding(next,{cache:true});
    await addAudit('ตั้งค่าหน้าตาระบบ',`เปลี่ยนชื่อระบบเป็น ${next.systemName}`);
    toast('บันทึกหน้าตาระบบแล้ว');
    hideModal();
    if(state.page==='profile') renderProfile();
  }catch(err){
    console.error(err);
    toast(err?.code==='permission-denied'?'บันทึกไม่ได้ กรุณาตรวจ Firestore Rules':'บันทึกหน้าตาระบบไม่สำเร็จ');
  }finally{
    if(btn){btn.disabled=false;btn.textContent='💾 บันทึกหน้าตาระบบ';}
  }
};



function stockCardUiOptionsMarkup(key,selected){
  const labels=STOCK_CARD_UI_LABELS[key]||{};
  const allowed=STOCK_CARD_UI_ALLOWED[key]||[];
  return allowed.map(value=>`<option value="${escapeHtml(value)}" ${String(selected)===String(value)?'selected':''}>${escapeHtml(labels[value]||value)}</option>`).join('');
}
function stockCardUiSelectMarkup(key,label,help,selected){
  return `<label class="stock-card-ui-field"><span>${escapeHtml(label)}</span><select id="stockCardUi_${escapeHtml(key)}" onchange="window.refreshStockCardUiPreview()">${stockCardUiOptionsMarkup(key,selected)}</select><small>${escapeHtml(help)}</small></label>`;
}
function stockCardUiPreviewInlineStyle(uiInput={}){
  const ui=normalizeStockCardUi(uiInput);
  return Object.entries(stockCardUiVars(ui)).map(([k,v])=>`${k}:${v}`).join(';');
}
function stockCardUiPreviewMarkup(uiInput={}){
  const ui=normalizeStockCardUi(uiInput);
  const style=stockCardUiPreviewInlineStyle(ui);
  const card=(name,location,unit,photo='chee-chan-course-original.jpg')=>{ const statusBadge='<span class="stock-status-modern stock-status-ok">ปกติ</span>'; const above=ui.statusPosition==='aboveCount'; return `<article class="stock-card-modern stock-card-ui-preview ${above?'stock-status-above-count':'stock-status-with-name'}" style="--stock-accent:#10b981;--stock-count-color:#007f5f" role="presentation"><div class="stock-card-photo"><img src="${escapeHtml(photo)}" alt="ตัวอย่างสินค้า"></div><div class="stock-card-main"><div class="stock-card-heading"><h3 class="stock-card-name">${escapeHtml(name)}</h3>${above?'':statusBadge}</div><div class="stock-card-sku">รหัสสินค้า: -</div><div class="stock-area-badge stock-area-badge-slim">📍 ${escapeHtml(location)}</div><div class="stock-lot-summary">📦 1 ล็อต</div></div><div class="stock-card-side">${above?`<div class="stock-card-side-status">${statusBadge}</div>`:''}<div class="stock-card-qty"><span class="stock-card-number">10</span><span class="stock-card-unit">${escapeHtml(unit)}</span></div><span class="stock-card-arrow">›</span></div></article>`; };
  return `<div class="stock-card-ui-preview-wrap" style="${style}"><div class="stock-card-ui-preview-head"><b>ตัวอย่างขนาดจริงบนมือถือ</b><span>แสดงทั้งชื่อสั้นและชื่อยาว เพื่อดูผลก่อนบันทึกได้ชัดเจน</span></div><div class="stock-card-ui-preview-list">${card('แก้ว','F&B Stock / Bar','แพ็ค')}${card('น่องไก่สำหรับครัวเย็น','Kitchen Stock / Cold Kitchen','ชิ้น')}</div></div>`;
}
function collectStockCardUiForm(){
  return normalizeStockCardUi({
    nameSize:$('stockCardUi_nameSize')?.value,
    countSize:$('stockCardUi_countSize')?.value,
    metaSize:$('stockCardUi_metaSize')?.value,
    imageSize:$('stockCardUi_imageSize')?.value,
    density:$('stockCardUi_density')?.value,
    nameLines:$('stockCardUi_nameLines')?.value,
    locationLines:$('stockCardUi_locationLines')?.value,
    statusPosition:$('stockCardUi_statusPosition')?.value
  });
}
function stockCardUiSettingsMarkup(){
  const ui=normalizeStockCardUi(state.stockCardUi||state.branding?.stockCardUi||{});
  return `<div class="stock-card-ui-settings"><div class="branding-guide-card"><b>ปรับการ์ด Stock เองได้จากหน้านี้</b><span>Admin ปรับขนาดตัวหนังสือ รูป จำนวน และความโปร่งของการ์ดได้ โดยระบบจำกัดเป็น Preset เพื่อป้องกัน Layout พังบนมือถือ</span></div><section class="branding-subsection"><div class="settings-section-head"><span class="settings-step-badge">1</span><div><h3>ขนาดตัวหนังสือและจำนวน</h3><p>ใช้ลด/เพิ่มความเด่นของชื่อสินค้าและเลขคงเหลือ</p></div></div><div class="stock-card-ui-grid">${stockCardUiSelectMarkup('nameSize','ชื่อสินค้า','เช่น แก้ว / น่องไก่',ui.nameSize)}${stockCardUiSelectMarkup('countSize','จำนวนคงเหลือ','เลขด้านขวาของการ์ด',ui.countSize)}${stockCardUiSelectMarkup('metaSize','รายละเอียด/ตำแหน่ง','รหัสสินค้า Location และล็อต',ui.metaSize)}${stockCardUiSelectMarkup('imageSize','รูปสินค้า','ขนาดรูปด้านซ้าย',ui.imageSize)}</div></section><section class="branding-subsection"><div class="settings-section-head"><span class="settings-step-badge">2</span><div><h3>ความสูงและจำนวนบรรทัด</h3><p>เพิ่มพื้นที่หายใจเมื่อชื่อสินค้าหรือ Location ยาว</p></div></div><div class="stock-card-ui-grid">${stockCardUiSelectMarkup('density','ความโปร่งของการ์ด','กระชับ / ปกติ / โปร่ง',ui.density)}${stockCardUiSelectMarkup('nameLines','ชื่อสินค้า','จำนวนบรรทัดสูงสุด',ui.nameLines)}${stockCardUiSelectMarkup('locationLines','ตำแหน่ง Stock','จำนวนบรรทัดสูงสุด',ui.locationLines)}${stockCardUiSelectMarkup('statusPosition','ตำแหน่งสถานะ','ข้างชื่อสินค้า หรือ เหนือเลขคงเหลือ',ui.statusPosition)}</div></section><section class="branding-subsection"><div class="settings-section-head"><span class="settings-step-badge">3</span><div><h3>ตัวอย่างก่อนบันทึก</h3><p>ตัวอย่างนี้จำลองกรณีชื่อและ Location ยาว</p></div></div><div id="stockCardUiPreview">${stockCardUiPreviewMarkup(ui)}</div></section><div class="stock-card-ui-actions"><button id="saveStockCardUiBtn" class="btn green full" onclick="window.saveStockCardUiSettings()">💾 บันทึกการตั้งค่าการ์ด</button><button class="btn light full" onclick="window.resetStockCardUiSettings()">↩️ คืนค่าเริ่มต้น</button></div><p class="note">การตั้งค่านี้บันทึกลง Firebase ของเว็บที่ใช้งานอยู่เท่านั้น และแยกตามโปรเจกต์</p></div>`;
}
window.refreshStockCardUiPreview=()=>{ const box=$('stockCardUiPreview'); if(box) box.innerHTML=stockCardUiPreviewMarkup(collectStockCardUiForm()); };
window.openStockCardUiSettings=()=>{ if(!requireAdmin()) return; openModal('ตั้งค่าการ์ด Stock',stockCardUiSettingsMarkup()); };
window.saveStockCardUiSettings=async()=>{ if(!requireAdmin()) return;
  const btn=$('saveStockCardUiBtn');
  if(btn){ btn.disabled=true; btn.textContent='กำลังบันทึก...'; }
  try{
    const next=collectStockCardUiForm();
    await setDoc(settingsDocRef(),{stockCardUi:next,stockCardUiUpdatedAt:serverTimestamp(),stockCardUiUpdatedByUid:state.user?.uid||'',stockCardUiUpdatedByName:state.profile?.displayName||state.profile?.username||''},{merge:true});
    state.stockCardUi=next;
    applyStockCardUi(next);
    await addAudit('ตั้งค่าการ์ด Stock',`ปรับชื่อสินค้า ${STOCK_CARD_UI_LABELS.nameSize[next.nameSize]} / จำนวน ${STOCK_CARD_UI_LABELS.countSize[next.countSize]} / รายละเอียด ${STOCK_CARD_UI_LABELS.metaSize[next.metaSize]} / สถานะ ${STOCK_CARD_UI_LABELS.statusPosition[next.statusPosition]}`,{stockCardUi:next});
    toast('บันทึกตั้งค่าการ์ด Stock แล้ว');
    hideModal();
    if(state.page==='stock') renderStock();
    if(state.page==='profile') renderProfile();
  }catch(err){ console.error(err); toast(err?.code==='permission-denied'?'บันทึกไม่ได้ กรุณาตรวจ Firestore Rules':'บันทึกตั้งค่าการ์ดไม่สำเร็จ'); }
  finally{ if(btn){ btn.disabled=false; btn.textContent='💾 บันทึกการตั้งค่าการ์ด'; } }
};
window.resetStockCardUiSettings=async()=>{ if(!requireAdmin()) return;
  if(!confirm('ต้องการคืนค่าการ์ด Stock เป็นค่าเริ่มต้นใช่ไหม?')) return;
  try{
    const next=normalizeStockCardUi(STOCK_CARD_UI_DEFAULT);
    await setDoc(settingsDocRef(),{stockCardUi:next,stockCardUiUpdatedAt:serverTimestamp(),stockCardUiUpdatedByUid:state.user?.uid||'',stockCardUiUpdatedByName:state.profile?.displayName||state.profile?.username||''},{merge:true});
    state.stockCardUi=next;
    applyStockCardUi(next);
    toast('คืนค่าการ์ด Stock แล้ว');
    openModal('ตั้งค่าการ์ด Stock',stockCardUiSettingsMarkup());
    if(state.page==='stock') renderStock();
  }catch(err){ console.error(err); toast('คืนค่าการ์ดไม่สำเร็จ'); }
};


function stockStructureManagerMarkup(){
  const structure=currentStockStructure();
  const groups=structure.groups;
  const cards=groups.map(g=>{
    const displayAreas=visibleStockAreasForGroup(g,true);
    const groupUsage=state.products.filter(p=>String(p.stockGroupId||'')===String(g.id)).length;
    return `<article class="stock-structure-card ${g.status==='inactive'?'inactive':''}"><div class="stock-structure-head"><div><b>🏠 ${escapeHtml(g.name)}</b><small>ID: ${escapeHtml(g.id)} · สินค้า ${groupUsage} รายการ</small></div><span>${g.status==='inactive'?'ปิดใช้งาน':'ใช้งาน'}</span></div><div class="stock-area-list">${displayAreas.length?displayAreas.map(a=>{ const areaUsage=state.products.filter(p=>String(p.stockGroupId||'')===String(g.id)&&String(p.stockAreaId||'')===String(a.id)).length; return `<div class="stock-area-row ${a.status==='inactive'?'inactive':''}"><div class="stock-area-row-name"><span>↳ ${escapeHtml(a.name)}</span><small>${a.status==='inactive'?'ปิดใช้งาน':'ใช้งาน'} · สินค้า ${areaUsage} รายการ</small></div><div class="stock-structure-actions"><button class="btn tiny light" onclick="window.renameStockArea('${escapeHtml(g.id)}','${escapeHtml(a.id)}')">✏️ แก้ชื่อ</button><button class="btn tiny" onclick="window.toggleStockAreaStatus('${escapeHtml(g.id)}','${escapeHtml(a.id)}')">${a.status==='inactive'?'เปิด':'ปิด'}</button><button class="btn tiny stock-danger-btn" onclick="window.deleteStockArea('${escapeHtml(g.id)}','${escapeHtml(a.id)}')">🗑️ ลบ</button></div></div>`; }).join(''):'<p class="muted">ยังไม่มีพื้นที่ในกลุ่มนี้</p>'}</div><div class="row stock-group-actions"><button class="btn light small" onclick="window.prepareAddStockArea('${escapeHtml(g.id)}')">+ เพิ่มพื้นที่ในกลุ่มนี้</button><button class="btn light small" onclick="window.renameStockGroup('${escapeHtml(g.id)}')">✏️ แก้ชื่อกลุ่ม</button>${g.id!==DEFAULT_STOCK_GROUP_ID?`<button class="btn small" onclick="window.toggleStockGroupStatus('${escapeHtml(g.id)}')">${g.status==='inactive'?'เปิดกลุ่ม':'ปิดกลุ่ม'}</button><button class="btn small stock-danger-btn" onclick="window.deleteStockGroup('${escapeHtml(g.id)}')">🗑️ ลบกลุ่ม</button>`:''}</div></article>`;
  }).join('');
  const destinationCards=groups.map(g=>{
    const list=normalizeIssueDestinationList(g.issueDestinations||DEFAULT_ISSUE_DESTINATIONS);
    return `<article class="stock-structure-card"><div class="stock-structure-head"><div><b>📍 ${escapeHtml(g.name)}</b><small>สถานที่เบิกไปใช้ของบ้านนี้</small></div><span>${list.length} รายการ</span></div><textarea id="issueDest_${escapeHtml(g.id)}" class="settings-textarea" rows="5" placeholder="หนึ่งบรรทัดต่อหนึ่งสถานที่ เช่น TheView">${escapeHtml(list.join('\n'))}</textarea><p class="muted" style="font-size:12px;margin:6px 0 10px">ใส่ได้หนึ่งรายการต่อบรรทัด ระบบจะใช้รายการนี้ในหน้าเบิกของบ้าน ${escapeHtml(g.name)}</p><button class="btn primary full" onclick="window.saveIssueDestinationsForGroup('${escapeHtml(g.id)}')">บันทึกสถานที่เบิกของบ้านนี้</button></article>`;
  }).join('');
  return `<div class="stock-structure-manager"><div class="branding-guide-card"><b>ระบบบ้านหลังใหญ่ / ห้องย่อย</b><span>Admin สร้างกลุ่มสต๊อก พื้นที่สต๊อก และกำหนดสถานที่เบิกไปใช้แยกตามบ้านได้</span></div><section class="branding-subsection"><div class="settings-section-head"><span class="settings-step-badge">1</span><div><h3>สร้างกลุ่มสต๊อก</h3><p>บ้านหลังใหญ่ เช่น F&B Stock, Engineering Stock, Housekeeping Stock</p></div></div><div class="row"><input id="newStockGroupName" placeholder="เช่น F&B Stock หรือ Engineering Stock"><button class="btn primary" onclick="window.addStockGroup()">+ เพิ่มกลุ่ม</button></div></section><section class="branding-subsection"><div class="settings-section-head"><span class="settings-step-badge">2</span><div><h3>สร้างพื้นที่สต๊อก</h3><p>ห้องย่อยในกลุ่ม เช่น Beverage, Kitchen, Bar, Coffee, Store</p></div></div><div class="branding-two-col"><select id="newStockAreaGroup">${groups.map(g=>`<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join('')}</select><input id="newStockAreaName" placeholder="เช่น Beverage / Kitchen / Bar"></div><button class="btn primary full" onclick="window.addStockArea()">+ เพิ่มพื้นที่สต๊อก</button></section><section class="branding-subsection"><div class="settings-section-head"><span class="settings-step-badge">3</span><div><h3>สถานที่เบิกไปใช้ตามบ้าน</h3><p>กำหนดปลายทางเบิกแยกกัน เช่น F&B อาจเบิกไป TheView/Kiosk แต่ Kitchen อาจเบิกไป Cold Kitchen/ครัวไทย</p></div></div>${destinationCards}</section><section class="branding-subsection"><div class="settings-section-head"><span class="settings-step-badge">4</span><div><h3>โครงสร้างปัจจุบัน</h3><p>แก้ชื่อได้โดยไม่เปลี่ยน ID; ลบได้เฉพาะกลุ่ม/พื้นที่ที่ยังไม่มีสินค้าใช้งาน เพื่อป้องกันข้อมูลสต๊อกเสีย</p></div></div>${cards}</section><section class="branding-subsection"><div class="settings-section-head"><span class="settings-step-badge">5</span><div><h3>ใส่พื้นที่หลักให้สินค้าเดิม</h3><p>สินค้าที่ไม่มีข้อมูลกลุ่ม/พื้นที่ จะถูกใส่เข้าพื้นที่แรกที่ Admin สร้างไว้ในกลุ่มแรก</p></div></div><button class="btn light full" onclick="window.applyDefaultStockLocationToLegacyProducts()">เติมพื้นที่หลักให้สินค้าเดิม</button></section></div>`;
}
window.openStockStructureSettings=()=>{ if(!requireAdmin()) return; openModal('จัดการกลุ่มสต๊อก / พื้นที่สต๊อก',stockStructureManagerMarkup()); };
async function saveStockStructure(next,message='อัปเดตโครงสร้างสต๊อกแล้ว'){
  const normalized=normalizeStockStructure(next);
  await setDoc(settingsDocRef(),{[STOCK_STRUCTURE_FIELD]:normalized,stockStructureUpdatedAt:serverTimestamp(),stockStructureUpdatedByUid:state.user?.uid||'',stockStructureUpdatedByName:state.profile?.displayName||state.profile?.username||''},{merge:true});
  state.stockStructure=normalized;
  applySystemBranding({...state.branding,stockStructure:normalized},{cache:true});
  await addAudit('จัดการกลุ่ม/พื้นที่สต๊อก',message,{stockStructure:normalized});
  toast(message);
  openModal('จัดการกลุ่มสต๊อก / พื้นที่สต๊อก',stockStructureManagerMarkup());
}
window.saveIssueDestinationsForGroup=async(groupId)=>{ if(!requireAdmin()) return; const el=$(`issueDest_${groupId}`); const list=issueDestinationTextToList(el?.value||''); if(!list.length) return toast('กรุณาเพิ่มสถานที่เบิกอย่างน้อย 1 รายการ'); const structure=currentStockStructure(); const group=structure.groups.find(g=>g.id===groupId); if(!group) return toast('ไม่พบบ้าน/กลุ่มสต๊อก'); group.issueDestinations=list; await saveStockStructure(structure,`อัปเดตสถานที่เบิกไปใช้ของ ${group.name}`); };
window.addStockGroup=async()=>{ if(!requireAdmin()) return; const name=($('newStockGroupName')?.value||'').trim(); if(!name) return toast('กรุณากรอกชื่อกลุ่มสต๊อก'); const structure=currentStockStructure(); const id=makeStockStructureId(name,'group'); if(structure.groups.some(g=>normalizeProductNameKey(g.name)===normalizeProductNameKey(name))) return toast('มีกลุ่มชื่อนี้แล้ว'); structure.groups.push({id,name,status:'active',sort:structure.groups.length+1,issueDestinations:normalizeIssueDestinationList(DEFAULT_ISSUE_DESTINATIONS),areas:[]}); await saveStockStructure(structure,`เพิ่มกลุ่มสต๊อก ${name}`); };
window.prepareAddStockArea=(groupId)=>{ const sel=$('newStockAreaGroup'); if(sel) sel.value=groupId; $('newStockAreaName')?.focus(); };
window.addStockArea=async()=>{ if(!requireAdmin()) return; const groupId=$('newStockAreaGroup')?.value||''; const name=($('newStockAreaName')?.value||'').trim(); if(!groupId||!name) return toast('กรุณาเลือกกลุ่มและกรอกชื่อพื้นที่'); const structure=currentStockStructure(); const group=structure.groups.find(g=>g.id===groupId); if(!group) return toast('ไม่พบกลุ่มสต๊อก'); if((group.areas||[]).some(a=>normalizeProductNameKey(a.name)===normalizeProductNameKey(name))) return toast('มีพื้นที่ชื่อนี้แล้วในกลุ่มนี้'); group.areas=group.areas||[]; group.areas.push({id:makeStockStructureId(name,'area'),name,status:'active',sort:group.areas.length+1}); await saveStockStructure(structure,`เพิ่มพื้นที่สต๊อก ${group.name} / ${name}`); };
window.toggleStockGroupStatus=async(groupId)=>{ if(!requireAdmin()) return; const structure=currentStockStructure(); const group=structure.groups.find(g=>g.id===groupId); if(!group) return; group.status=group.status==='inactive'?'active':'inactive'; await saveStockStructure(structure,`${group.status==='inactive'?'ปิด':'เปิด'}กลุ่มสต๊อก ${group.name}`); };
window.toggleStockAreaStatus=async(groupId,areaId)=>{ if(!requireAdmin()) return; const structure=currentStockStructure(); const group=structure.groups.find(g=>g.id===groupId); const area=group?.areas?.find(a=>a.id===areaId); if(!area) return; area.status=area.status==='inactive'?'active':'inactive'; await saveStockStructure(structure,`${area.status==='inactive'?'ปิด':'เปิด'}พื้นที่สต๊อก ${group.name} / ${area.name}`); };

async function syncRenamedStockLocationProducts(groupId,areaId=''){
  const gid=String(groupId||'');
  const aid=String(areaId||'');
  const targets=state.products.filter(p=>String(p.stockGroupId||'')===gid && (!aid || String(p.stockAreaId||'')===aid));
  if(!targets.length) return 0;
  for(let i=0;i<targets.length;i+=400){
    const batch=writeBatch(fs);
    targets.slice(i,i+400).forEach(p=>{
      const loc=productStockLocation(p);
      batch.update(productRef(p.id),{stockGroupName:loc.stockGroupName,stockAreaName:loc.stockAreaName,stockAreaPath:loc.stockAreaPath,updatedAt:serverTimestamp()});
    });
    await batch.commit();
  }
  state.products=state.products.map(p=>{
    if(String(p.stockGroupId||'')!==gid || (aid && String(p.stockAreaId||'')!==aid)) return p;
    const loc=productStockLocation(p);
    return {...p,stockGroupName:loc.stockGroupName,stockAreaName:loc.stockAreaName,stockAreaPath:loc.stockAreaPath};
  });
  await writeProductCache(state.products,0,Date.now());
  return targets.length;
}
window.renameStockGroup=async(groupId)=>{ if(!requireAdmin()) return; const structure=currentStockStructure(); const group=structure.groups.find(g=>g.id===groupId); if(!group) return toast('ไม่พบกลุ่มสต๊อก'); const oldName=group.name; const nextName=String(prompt('แก้ชื่อกลุ่มสต๊อก',oldName)||'').trim(); if(!nextName || nextName===oldName) return; if(structure.groups.some(g=>g.id!==groupId && normalizeProductNameKey(g.name)===normalizeProductNameKey(nextName))) return toast('มีกลุ่มชื่อนี้แล้ว'); group.name=nextName; try{ await saveStockStructure(structure,`แก้ชื่อกลุ่มสต๊อก ${oldName} → ${nextName}`); const count=await syncRenamedStockLocationProducts(groupId); if(count) toast(`แก้ชื่อแล้ว และอัปเดตสินค้า ${count} รายการ`); }catch(err){ console.error(err); toast(err?.code==='permission-denied'?'แก้ชื่อไม่ได้ กรุณาตรวจ Firestore Rules':'แก้ชื่อกลุ่มไม่สำเร็จ'); } };
window.renameStockArea=async(groupId,areaId)=>{ if(!requireAdmin()) return; const structure=currentStockStructure(); const group=structure.groups.find(g=>g.id===groupId); const area=group?.areas?.find(a=>a.id===areaId); if(!group||!area) return toast('ไม่พบพื้นที่สต๊อก'); const oldName=area.name; const nextName=String(prompt(`แก้ชื่อพื้นที่ใน ${group.name}`,oldName)||'').trim(); if(!nextName || nextName===oldName) return; if((group.areas||[]).some(a=>a.id!==areaId && normalizeProductNameKey(a.name)===normalizeProductNameKey(nextName))) return toast('มีพื้นที่ชื่อนี้แล้วในกลุ่มนี้'); area.name=nextName; try{ await saveStockStructure(structure,`แก้ชื่อพื้นที่สต๊อก ${group.name} / ${oldName} → ${nextName}`); const count=await syncRenamedStockLocationProducts(groupId,areaId); if(count) toast(`แก้ชื่อแล้ว และอัปเดตสินค้า ${count} รายการ`); }catch(err){ console.error(err); toast(err?.code==='permission-denied'?'แก้ชื่อไม่ได้ กรุณาตรวจ Firestore Rules':'แก้ชื่อพื้นที่ไม่สำเร็จ'); } };
window.deleteStockArea=async(groupId,areaId)=>{ if(!requireAdmin()) return; const structure=currentStockStructure(); const group=structure.groups.find(g=>g.id===groupId); const area=group?.areas?.find(a=>a.id===areaId); if(!group||!area) return toast('ไม่พบพื้นที่สต๊อก'); const usage=state.products.filter(p=>String(p.stockGroupId||'')===String(groupId)&&String(p.stockAreaId||'')===String(areaId)).length; if(usage) return toast(`ลบไม่ได้: พื้นที่นี้มีสินค้าใช้งานอยู่ ${usage} รายการ กรุณาแก้ชื่อหรือย้ายสินค้าก่อน`); if(!confirm(`ลบพื้นที่ “${area.name}” ออกจาก ${group.name} ถาวรใช่ไหม?\n\nการลบนี้ย้อนกลับไม่ได้`)) return; group.areas=(group.areas||[]).filter(a=>a.id!==areaId); await saveStockStructure(structure,`ลบพื้นที่สต๊อก ${group.name} / ${area.name}`); };
window.deleteStockGroup=async(groupId)=>{ if(!requireAdmin()) return; if(groupId===DEFAULT_STOCK_GROUP_ID) return toast('กลุ่มหลัก F&B Stock ลบไม่ได้ แต่สามารถแก้ชื่อได้'); const structure=currentStockStructure(); const group=structure.groups.find(g=>g.id===groupId); if(!group) return toast('ไม่พบกลุ่มสต๊อก'); const usage=state.products.filter(p=>String(p.stockGroupId||'')===String(groupId)).length; if(usage) return toast(`ลบไม่ได้: กลุ่มนี้มีสินค้าใช้งานอยู่ ${usage} รายการ กรุณาแก้ชื่อหรือย้ายสินค้าก่อน`); if(!confirm(`ลบกลุ่ม “${group.name}” และพื้นที่ทั้งหมดในกลุ่มนี้ถาวรใช่ไหม?\n\nการลบนี้ย้อนกลับไม่ได้`)) return; structure.groups=structure.groups.filter(g=>g.id!==groupId); await saveStockStructure(structure,`ลบกลุ่มสต๊อก ${group.name}`); };
window.applyDefaultStockLocationToLegacyProducts=async()=>{ if(!requireAdmin()) return; const loc=defaultStockLocation(); const targets=state.products.filter(p=>!p.stockGroupId || !p.stockAreaId); if(!targets.length) return toast('สินค้าทุกตัวมีข้อมูลกลุ่ม/พื้นที่แล้ว'); if(!confirm(`จะเติมค่า ${loc.stockAreaPath} ให้สินค้าเดิม ${targets.length} รายการ ใช่ไหม?`)) return; try{ for(let i=0;i<targets.length;i+=400){ const batch=writeBatch(fs); targets.slice(i,i+400).forEach(p=>batch.update(productRef(p.id),{...loc,updatedAt:serverTimestamp()})); await batch.commit(); } state.products=state.products.map(p=>(!p.stockGroupId||!p.stockAreaId)?{...p,...loc}:p); await writeProductCache(state.products,0,Date.now()); await addAudit('เติมพื้นที่สินค้าเดิม',`เติม ${loc.stockAreaPath} ให้สินค้าเดิม ${targets.length} รายการ`,{count:targets.length,...loc}); toast(`เติมพื้นที่หลักให้สินค้าเดิม ${targets.length} รายการแล้ว`); openModal('จัดการกลุ่มสต๊อก / พื้นที่สต๊อก',stockStructureManagerMarkup()); }catch(err){ console.error(err); toast(err?.code==='permission-denied'?'เติมค่าไม่ได้ กรุณา Publish Firestore Rules v34.27.0':'เติมค่าเริ่มต้นไม่สำเร็จ'); } };

window.resetBrandingSettings=async()=>{ if(!requireAdmin()) return;
  if(!confirm('ต้องการคืนค่าชื่อ โลโก้ และธีมเป็นค่าเริ่มต้นใช่ไหม?')) return;
  try{
    const next=normalizeBranding(DEFAULT_BRANDING);
    await setDoc(settingsDocRef(),{...next,updatedAt:serverTimestamp(),updatedByUid:state.user?.uid||'',updatedByName:state.profile?.displayName||state.profile?.username||''},{merge:true});
    state.branding=next;
    applySystemBranding(next,{cache:true});
    toast('คืนค่าหน้าตาระบบแล้ว');
    hideModal();
    renderProfile();
  }catch(err){ console.error(err); toast('คืนค่าไม่สำเร็จ'); }
};


function memberAccessDomId(uid,groupId,suffix){
  return `memberAccess_${String(uid||'').replace(/[^a-zA-Z0-9_-]/g,'_')}_${String(groupId||'').replace(/[^a-zA-Z0-9_-]/g,'_')}_${suffix}`;
}
function memberStockAccessControlsMarkup(m={}){
  const uid=String(m.uid||'');
  const access=normalizeMemberStockAccess(m);
  const restricted=access.mode==='restricted';
  const groups=currentStockStructure().groups.filter(g=>g.status!=='inactive');
  const groupRows=groups.map(g=>{
    const groupChecked=access.groupIds.includes(g.id);
    const areas=visibleStockAreasForGroup(g,false);
    const selectedCount=areas.filter(a=>access.areaKeys.includes(stockAreaAccessKey(g.id,a.id))).length;
    const groupMode=groupChecked ? 'group' : (selectedCount ? 'areas' : 'none');
    const panelId=memberAccessDomId(uid,g.id,'areas');
    const searchId=memberAccessDomId(uid,g.id,'search');
    const summaryId=memberAccessDomId(uid,g.id,'summary');
    const areaRows=areas.map(a=>{
      const checked=!groupChecked && access.areaKeys.includes(stockAreaAccessKey(g.id,a.id));
      return `<label class="member-area-check" data-area-name="${escapeHtml(String(a.name||'').toLowerCase())}"><input type="checkbox" class="member-access-area" data-uid="${escapeHtml(uid)}" data-group="${escapeHtml(g.id)}" data-area="${escapeHtml(a.id)}" ${checked?'checked':''} onchange="window.updateMemberGroupSummary('${escapeHtml(uid)}','${escapeHtml(g.id)}')"> <span>${escapeHtml(a.name)}</span></label>`;
    }).join('') || '<div class="muted">ยังไม่มีพื้นที่ในกลุ่มนี้</div>';
    const summaryText=groupMode==='group'?'เห็นทั้งกลุ่ม':(groupMode==='areas'?`เลือก ${selectedCount} พื้นที่`:'ยังไม่เลือก');
    return `<article class="member-access-group-card member-access-card-compact" data-group="${escapeHtml(g.id)}">
      <div class="member-access-group-head">
        <div class="member-access-group-title"><b>🏠 ${escapeHtml(g.name)}</b><small id="${summaryId}">${escapeHtml(summaryText)}</small></div>
        <select class="member-access-group-mode" data-uid="${escapeHtml(uid)}" data-group="${escapeHtml(g.id)}" onchange="window.changeMemberStockGroupMode('${escapeHtml(uid)}','${escapeHtml(g.id)}')">
          <option value="none" ${groupMode==='none'?'selected':''}>ไม่เลือก</option>
          <option value="group" ${groupMode==='group'?'selected':''}>เห็นทั้งกลุ่ม</option>
          <option value="areas" ${groupMode==='areas'?'selected':''}>เลือกเฉพาะพื้นที่</option>
        </select>
      </div>
      <div id="${panelId}" class="member-access-area-panel ${groupMode==='areas'?'':'hidden'}">
        <div class="member-area-toolbar">
          <input id="${searchId}" class="member-area-search" placeholder="ค้นหาพื้นที่ใน ${escapeHtml(g.name)}" oninput="window.filterMemberAreaSearch('${escapeHtml(uid)}','${escapeHtml(g.id)}')">
          <div class="member-area-actions">
            <button type="button" class="mini-btn" onclick="window.memberAreaSelectAll('${escapeHtml(uid)}','${escapeHtml(g.id)}',true)">เลือกทั้งหมด</button>
            <button type="button" class="mini-btn" onclick="window.memberAreaSelectAll('${escapeHtml(uid)}','${escapeHtml(g.id)}',false)">ล้าง</button>
          </div>
        </div>
        <div class="member-access-areas">${areaRows}</div>
      </div>
    </article>`;
  }).join('') || '<div class="muted">ยังไม่มีกลุ่มสต๊อก</div>';
  return `<div class="member-stock-access-box"><label class="field-label">สิทธิ์กลุ่มสต๊อก / พื้นที่สต๊อก</label><select id="memberStockAccessMode_${escapeHtml(uid)}" onchange="window.toggleMemberStockAccessPanel('${escapeHtml(uid)}')"><option value="all" ${restricted?'':'selected'}>เห็นทุกกลุ่มสต๊อก</option><option value="restricted" ${restricted?'selected':''}>จำกัดตามกลุ่ม/พื้นที่</option></select><div class="member-access-summary">ปัจจุบัน: ${escapeHtml(memberStockAccessSummary(m))}</div><div id="memberStockAccessPanel_${escapeHtml(uid)}" class="member-access-panel ${restricted?'':'hidden'}"><p class="note">แนะนำ: ถ้าพนักงานอยู่ทั้งกลุ่ม ให้เลือก “เห็นทั้งกลุ่ม” จะไม่ต้องโชว์ห้องย่อยจำนวนมาก เฉพาะกรณีต้องจำกัดห้องจริง ๆ ค่อยเลือก “เลือกเฉพาะพื้นที่”</p>${groupRows}</div></div>`;
}
window.toggleMemberStockAccessPanel=(uid)=>{
  const mode=$(`memberStockAccessMode_${uid}`)?.value||'all';
  $(`memberStockAccessPanel_${uid}`)?.classList.toggle('hidden',mode!=='restricted');
};
window.changeMemberStockGroupMode=(uid,groupId)=>{
  const sel=[...document.querySelectorAll('.member-access-group-mode')].find(el=>el.dataset.uid===uid && el.dataset.group===groupId);
  const mode=sel?.value||'none';
  const panel=$(memberAccessDomId(uid,groupId,'areas'));
  if(panel) panel.classList.toggle('hidden',mode!=='areas');
  if(mode!=='areas'){
    document.querySelectorAll('.member-access-area').forEach(el=>{ if(el.dataset.uid===uid && el.dataset.group===groupId) el.checked=false; });
  }
  window.updateMemberGroupSummary(uid,groupId);
};
window.memberAreaSelectAll=(uid,groupId,checked)=>{
  document.querySelectorAll('.member-access-area').forEach(el=>{
    if(el.dataset.uid===uid && el.dataset.group===groupId && el.closest('.member-area-check')?.style.display!=='none') el.checked=!!checked;
  });
  window.updateMemberGroupSummary(uid,groupId);
};
window.filterMemberAreaSearch=(uid,groupId)=>{
  const q=String($(memberAccessDomId(uid,groupId,'search'))?.value||'').trim().toLowerCase();
  const panel=$(memberAccessDomId(uid,groupId,'areas'));
  if(!panel) return;
  panel.querySelectorAll('.member-area-check').forEach(row=>{
    const name=String(row.dataset.areaName||'').toLowerCase();
    row.style.display=!q || name.includes(q) ? '' : 'none';
  });
};
window.updateMemberGroupSummary=(uid,groupId)=>{
  const sel=[...document.querySelectorAll('.member-access-group-mode')].find(el=>el.dataset.uid===uid && el.dataset.group===groupId);
  const mode=sel?.value||'none';
  const summary=$(memberAccessDomId(uid,groupId,'summary'));
  if(!summary) return;
  if(mode==='group'){ summary.textContent='เห็นทั้งกลุ่ม'; return; }
  if(mode==='areas'){
    const count=[...document.querySelectorAll('.member-access-area')].filter(el=>el.dataset.uid===uid && el.dataset.group===groupId && el.checked).length;
    summary.textContent=count?`เลือก ${count} พื้นที่`:'ยังไม่ได้เลือกพื้นที่';
    return;
  }
  summary.textContent='ยังไม่เลือก';
};
function collectMemberStockAccess(uid){
  const mode=$(`memberStockAccessMode_${uid}`)?.value||'all';
  if(mode!=='restricted') return {mode:'all',groupIds:[],areaKeys:[]};
  const groupIds=[];
  const areaKeys=[];
  document.querySelectorAll('.member-access-group-mode').forEach(el=>{
    if(el.dataset.uid!==uid) return;
    const gid=el.dataset.group||'';
    if(!gid) return;
    if(el.value==='group'){
      if(!groupIds.includes(gid)) groupIds.push(gid);
    }else if(el.value==='areas'){
      document.querySelectorAll('.member-access-area').forEach(areaEl=>{
        const aid=areaEl.dataset.area||'';
        if(areaEl.dataset.uid===uid && areaEl.dataset.group===gid && areaEl.checked && aid){
          const key=stockAreaAccessKey(gid,aid);
          if(!areaKeys.includes(key)) areaKeys.push(key);
        }
      });
    }
  });
  return {mode:'restricted',groupIds,areaKeys};
}
function validateMemberStockAccessForSave(uid,roleValue,access){
  if(roleValue==='admin') return true;
  if(access.mode==='restricted' && !access.groupIds.length && !access.areaKeys.length){ toast('กรุณาเลือกกลุ่มหรือพื้นที่สต๊อกให้สมาชิก'); return false; }
  return true;
}

window.manageMembers=async()=>{ if(!requireAdmin()) return;
  const snap=await getDocs(collection(fs,'members'));
  state.members=snap.docs.map(d=>({uid:d.id,...d.data()}));
  const rows=state.members.map(m=>`<div class="card member-row-card" style="box-shadow:none;border:1px solid var(--line);margin:8px 0">
    <b>${escapeHtml(m.displayName||m.username)}</b>
    <div class="muted">@${escapeHtml(m.username||'')} • ${escapeHtml(roleLabel(m.role))}</div>
    <label class="field-label">ตำแหน่ง</label>
    <select id="memberRole_${m.uid}">
      <option value="staff" ${m.role==='staff'?'selected':''}>พนักงาน</option>
      <option value="captain" ${m.role==='captain'?'selected':''}>Captain</option>
      <option value="supervisor" ${m.role==='supervisor'?'selected':''}>Supervisor</option>
      <option value="manager" ${m.role==='manager'?'selected':''}>Manager</option>
      <option value="director" ${m.role==='director'?'selected':''}>F&B Director</option>
      <option value="admin" ${m.role==='admin'?'selected':''}>แอดมิน</option>
    </select>
    <label class="field-label">สถานะ</label>
    <select id="memberStatus_${m.uid}">
      <option value="active" ${m.status!=='disabled'?'selected':''}>ใช้งาน</option>
      <option value="disabled" ${m.status==='disabled'?'selected':''}>ปิดใช้งาน</option>
    </select>
    ${memberStockAccessControlsMarkup(m)}
    <button class="btn primary full" onclick="window.saveMemberRole('${m.uid}')">บันทึกสมาชิกคนนี้</button>
    ${m.uid===state.user?.uid?'':`<button class="btn red full member-delete-btn" onclick="window.deleteMemberProfile('${m.uid}')">🗑️ ลบออกจากระบบเว็บ</button>
    <div class="member-delete-note">ลบจาก ${escapeHtml(appName())} เท่านั้น ไม่ลบ Email ใน Firebase Authentication</div>`}
  </div>`).join('');
  openModal('จัดการสมาชิกและตำแหน่ง',`<div class="member-admin-tools">
    <p class="note">เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่เพิ่มพนักงานใหม่และกำหนดตำแหน่งหลักได้</p>
    <div class="member-admin-actions">
      <button class="btn primary" onclick="window.openCreateMemberModal()">➕ เพิ่มพนักงานใหม่</button>
      <button class="btn" onclick="window.openBulkMemberModal()">📥 เพิ่มหลายคน</button>
    </div>
    <p class="note">พนักงานใหม่จะใช้รหัสผ่านเริ่มต้น <b>chartered</b> และระบบจะบังคับเปลี่ยนรหัสผ่านเมื่อเข้าใช้งานครั้งแรก</p><p class="note member-auth-note"><b>หมายเหตุการลบ:</b> ปุ่ม “ลบออกจากระบบเว็บ” จะลบโปรไฟล์สมาชิกใน ${escapeHtml(appName())} และทำให้เข้าใช้งานไม่ได้ แต่จะไม่ลบ Email ใน Firebase Authentication หากต้องการลบถาวรต้องลบผ่าน Firebase Console แยกต่างหาก</p>
  </div>${rows||'<p class="muted">ยังไม่มีสมาชิก</p>'}`);
};

function memberRoleOptions(selected='staff'){
  return ['staff','captain','supervisor','manager','director'].map(r=>`<option value="${r}" ${selected===r?'selected':''}>${escapeHtml(roleLabel(r))}</option>`).join('');
}
function splitFullNameForMember(fullName=''){
  const parts=String(fullName||'').trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return {firstName:'',lastName:'',displayName:''};
  return {firstName:parts[0]||'',lastName:parts.slice(1).join(' '),displayName:parts.join(' ')};
}
function bulkRoleFromText(value=''){
  const v=String(value||'').trim().toLowerCase();
  if(['director','fb director','f&b director','fnb director','ผู้อำนวยการ','ผู้บริหาร'].includes(v)) return 'director';
  if(['manager','mgr','ผู้จัดการ'].includes(v)) return 'manager';
  if(['supervisor','sup','ซุป','ซุปเปอร์ไวเซอร์'].includes(v)) return 'supervisor';
  if(['captain','cap','กัปตัน'].includes(v)) return 'captain';
  if(['staff','พนักงาน'].includes(v)) return 'staff';
  return '';
}
function splitCsvLine(line=''){
  const out=[]; let cur='', quote=false;
  for(const ch of String(line)){
    if(ch==='"'){ quote=!quote; continue; }
    if(ch===',' && !quote){ out.push(cur.trim()); cur=''; continue; }
    cur+=ch;
  }
  out.push(cur.trim());
  return out;
}
function parseBulkMemberLines(text=''){
  return String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map((line,idx)=>{
    const cols=splitCsvLine(line);
    let displayName='', username='', role='staff', department='Food & Beverage';
    if(cols.length===1){
      displayName=cols[0];
    }else if(cols.length===2 && bulkRoleFromText(cols[1])){
      displayName=cols[0]; role=bulkRoleFromText(cols[1])||'staff';
    }else{
      displayName=cols[0]||'';
      username=cols[1]||'';
      role=bulkRoleFromText(cols[2]||'')||'staff';
      department=cols[3]||department;
    }
    return {line:idx+1,displayName,username,role,department};
  });
}

function usernameBaseFromName(displayName='', explicitUsername=''){
  const explicit=normalizeUsername(explicitUsername).replace(/[^a-z0-9._-]/g,'');
  if(explicit.length>=3) return explicit;
  const cleaned=String(displayName||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s._-]/g,' ').trim();
  const parts=cleaned.split(/\s+/).filter(Boolean).map(p=>p.replace(/[^a-z0-9._-]/g,''));
  let base='';
  if(parts.length>=2) base=`${parts[0]}.${parts[1].charAt(0)}`;
  else if(parts.length===1) base=parts[0];
  if(base.length<3) base=`emp${Date.now().toString().slice(-6)}`;
  return base.slice(0,28);
}
function candidateUsername(base='',index=0){
  const clean=normalizeUsername(base).replace(/[^a-z0-9._-]/g,'')||`emp${Date.now().toString().slice(-6)}`;
  return index===0 ? clean : `${clean}${index+1}`;
}
async function usernameExistsInMembers(username){
  const snap=await getDocs(query(collection(fs,'members'),where('username','==',username),limit(1)));
  return !snap.empty;
}
function memberCreateErrorMessage(e){
  const code=String(e?.code||'');
  if(code==='auth/email-already-in-use') return 'Username นี้ถูกใช้งานแล้ว';
  if(code==='auth/invalid-email') return 'Username ไม่ถูกต้อง';
  if(code==='auth/weak-password') return 'รหัสผ่านเริ่มต้นไม่ผ่านเงื่อนไข';
  if(code==='permission-denied') return 'บัญชี Admin ไม่มีสิทธิ์สร้างข้อมูลสมาชิกใน Firestore โปรดตรวจ Rules';
  return e?.message||'สร้างพนักงานไม่สำเร็จ';
}
async function createMemberViaClient(payload){
  if(!state.user || state.profile?.role!=='admin') throw new Error('เฉพาะ Admin เท่านั้นที่เพิ่มพนักงานใหม่ได้');
  const firstName=String(payload.firstName||'').trim();
  const lastName=String(payload.lastName||'').trim();
  const displayName=String(payload.displayName||`${firstName} ${lastName}`).trim();
  if(!displayName) throw new Error('กรุณาระบุชื่อพนักงาน');
  const role=['staff','captain','supervisor','manager','director'].includes(payload.role) ? payload.role : 'staff';
  const department=String(payload.department||'Food & Beverage').trim()||'Food & Beverage';
  const stockAccess=normalizeMemberStockAccess({stockAccess:payload.stockAccess||{mode:'all'}});
  const base=usernameBaseFromName(displayName,payload.username);
  let lastError=null;
  for(let i=0;i<30;i++){
    const username=candidateUsername(base,i);
    if(await usernameExistsInMembers(username)) continue;
    const email=usernameToEmail(username);
    let createdUser=null;
    try{
      const credential=await createUserWithEmailAndPassword(memberCreateAuth,email,DEFAULT_PASSWORD);
      createdUser=credential.user;
      await setDoc(memberRef(createdUser.uid),{
        uid:createdUser.uid,
        username,
        email,
        firstName,
        lastName,
        displayName,
        role,
        position:roleLabel(role),
        department,
        stockAccess,
        stockAccessCreatedAt:serverTimestamp(),
        stockAccessCreatedBy:state.user.uid,
        status:'active',
        mustChangePassword:true,
        passwordChangePending:false,
        createdAt:serverTimestamp(),
        createdByUid:state.user.uid,
        createdByName:state.profile?.displayName||state.profile?.username||state.user.email||'Admin',
        updatedAt:serverTimestamp()
      });
      await addLog('เพิ่มพนักงานใหม่',`${displayName} • ${username} • ${roleLabel(role)} • ${memberStockAccessSummary({stockAccess})}`);
      await signOut(memberCreateAuth).catch(()=>{});
      return {uid:createdUser.uid,displayName,username,role,stockAccess,initialPassword:DEFAULT_PASSWORD};
    }catch(e){
      lastError=e;
      if(createdUser){ await deleteUser(createdUser).catch(()=>{}); }
      await signOut(memberCreateAuth).catch(()=>{});
      if(String(e?.code||'')==='auth/email-already-in-use') continue;
      throw new Error(memberCreateErrorMessage(e));
    }
  }
  throw new Error(lastError ? memberCreateErrorMessage(lastError) : 'ไม่สามารถสร้าง Username อัตโนมัติได้ กรุณาระบุ Username เอง');
}
async function createMemberViaFunction(payload){
  return await createMemberViaClient(payload);
}
function memberCreateResultMarkup(results=[]){
  return `<div class="member-create-results">${results.map(r=>`<div class="card" style="box-shadow:none;border:1px solid var(--line);margin:8px 0">
    <b>${r.ok?'✅':'❌'} ${escapeHtml(r.displayName||r.inputName||'รายการ')}</b>
    ${r.ok?`<div>Username: <b>${escapeHtml(r.username||'-')}</b></div><div>รหัสเริ่มต้น: <b>${escapeHtml(r.password||DEFAULT_PASSWORD)}</b></div><div class="muted">ตำแหน่ง: ${escapeHtml(roleLabel(r.role||'staff'))}</div><div class="muted">สิทธิ์สต๊อก: ${escapeHtml(memberStockAccessSummary({stockAccess:r.stockAccess||{mode:'all'}}))}</div>`:`<div class="muted">${escapeHtml(r.error||'สร้างไม่สำเร็จ')}</div>`}
  </div>`).join('')}</div>`;
}
window.openCreateMemberModal=()=>{ if(!requireAdmin()) return;
  openModal('เพิ่มพนักงานใหม่',`<div class="member-create-form">
    <p class="note">ใช้สำหรับ Admin เพิ่มบัญชีพนักงานโดยตรง ไม่มีปุ่มสมัครหน้า Login</p>
    <label>ชื่อ-นามสกุล<input id="newMemberName" placeholder="เช่น สมชาย ใจดี" autocomplete="off"></label>
    <label>Username <small class="muted">เว้นว่างได้ ระบบจะสร้างให้อัตโนมัติ</small><input id="newMemberUsername" placeholder="เช่น somchai หรือเว้นว่าง" autocomplete="off"></label>
    <label>ตำแหน่ง<select id="newMemberRole">${memberRoleOptions('staff')}</select></label>
    <label>แผนก<input id="newMemberDepartment" value="Food & Beverage" autocomplete="off"></label>
    <section class="member-create-access-section">
      <h3>สิทธิ์การมองเห็นสินค้า</h3>
      <p class="note">เลือกตั้งแต่ตอนสร้างสมาชิกได้เลย ถ้าเลือก “จำกัดตามกลุ่ม/พื้นที่” สมาชิกจะเห็นเฉพาะสินค้าของส่วนงานนั้น</p>
      ${memberStockAccessControlsMarkup({uid:'newMember',displayName:'พนักงานใหม่',role:'staff',stockAccess:{mode:'all',groupIds:[],areaKeys:[]}})}
    </section>
    <p class="note">รหัสผ่านเริ่มต้นคือ <b>chartered</b> และจะถูกบังคับให้เปลี่ยนเมื่อเข้าใช้งานครั้งแรก</p>
    <button id="createMemberBtn" class="btn primary full" onclick="window.createMemberNow()">สร้างพนักงาน</button>
    <button class="btn full" onclick="window.manageMembers()">กลับไปจัดการสมาชิก</button>
  </div>`);
  setTimeout(()=>$('newMemberName')?.focus(),80);
};
window.createMemberNow=async()=>{ if(!requireAdmin()) return;
  const name=($('newMemberName')?.value||'').trim();
  if(!name) return toast('กรุณากรอกชื่อ-นามสกุล');
  const nameParts=splitFullNameForMember(name);
  const payload={
    ...nameParts,
    username:($('newMemberUsername')?.value||'').trim(),
    role:$('newMemberRole')?.value||'staff',
    department:($('newMemberDepartment')?.value||'Food & Beverage').trim()||'Food & Beverage',
    stockAccess:collectMemberStockAccess('newMember')
  };
  if(!validateMemberStockAccessForSave('newMember',payload.role,payload.stockAccess)) return;
  if(!beginActionLock('create-member','createMemberBtn','กำลังสร้างพนักงาน...')) return;
  try{
    const data=await createMemberViaFunction(payload);
    const result={ok:true,displayName:data.displayName||payload.displayName,username:data.username,password:data.initialPassword||DEFAULT_PASSWORD,role:data.role||payload.role,stockAccess:data.stockAccess||payload.stockAccess};
    toast(`สร้างพนักงาน ${result.username} แล้ว`);
    openModal('สร้างพนักงานสำเร็จ',`${memberCreateResultMarkup([result])}<button class="btn primary full" onclick="window.openCreateMemberModal()">เพิ่มคนถัดไป</button><button class="btn full" onclick="window.manageMembers()">กลับไปจัดการสมาชิก</button>`);
  }catch(e){
    console.error(e);
    toast(e?.message||'สร้างพนักงานไม่สำเร็จ');
  }finally{ endActionLock('create-member','createMemberBtn'); }
};
window.openBulkMemberModal=()=>{ if(!requireAdmin()) return;
  openModal('เพิ่มพนักงานหลายคน',`<div class="member-create-form">
    <p class="note">วางรายชื่อหลายบรรทัด ระบบจะสร้าง Username ให้อัตโนมัติถ้าเว้นว่าง</p>
    <div class="note"><b>ตัวอย่างแบบง่าย</b><br>สมชาย ใจดี, staff<br>วิชัย แก้วดี, captain<br>นันทวัฒน์ ทองดี, supervisor</div>
    <div class="note"><b>ตัวอย่างแบบละเอียด</b><br>ชื่อ-นามสกุล, username, role, แผนก</div>
    <textarea id="bulkMemberText" rows="9" placeholder="สมชาย ใจดี, staff\nวิชัย แก้วดี, captain\nนันทวัฒน์ ทองดี, supervisor"></textarea>
    <button id="bulkMemberBtn" class="btn primary full" onclick="window.createBulkMembersNow()">สร้างพนักงานทั้งหมด</button>
    <button class="btn full" onclick="window.manageMembers()">กลับไปจัดการสมาชิก</button>
  </div>`);
  setTimeout(()=>$('bulkMemberText')?.focus(),80);
};
window.createBulkMembersNow=async()=>{ if(!requireAdmin()) return;
  const rows=parseBulkMemberLines($('bulkMemberText')?.value||'');
  if(!rows.length) return toast('กรุณาวางรายชื่อพนักงานอย่างน้อย 1 รายการ');
  if(rows.length>50) return toast('เพิ่มได้ครั้งละไม่เกิน 50 คน');
  if(!confirm(`ต้องการสร้างพนักงาน ${rows.length} คนใช่หรือไม่?`)) return;
  if(!beginActionLock('bulk-member','bulkMemberBtn','กำลังสร้าง...')) return;
  const results=[];
  try{
    for(const row of rows){
      if(!row.displayName){ results.push({ok:false,inputName:`บรรทัด ${row.line}`,error:'ไม่มีชื่อพนักงาน'}); continue; }
      const nameParts=splitFullNameForMember(row.displayName);
      try{
        const data=await createMemberViaFunction({...nameParts,username:row.username,role:row.role,department:row.department});
        results.push({ok:true,displayName:data.displayName||row.displayName,username:data.username,password:data.initialPassword||DEFAULT_PASSWORD,role:data.role||row.role});
      }catch(e){
        results.push({ok:false,inputName:row.displayName,error:e?.message||String(e)});
      }
    }
    const okCount=results.filter(r=>r.ok).length;
    toast(`สร้างสำเร็จ ${okCount}/${rows.length} คน`);
    openModal('ผลการเพิ่มพนักงาน',`${memberCreateResultMarkup(results)}<button class="btn primary full" onclick="window.manageMembers()">กลับไปจัดการสมาชิก</button>`);
  }finally{ endActionLock('bulk-member','bulkMemberBtn'); }
};

window.deleteMemberProfile=async(uid)=>{ if(!requireAdmin()) return;
  const member=state.members.find(m=>m.uid===uid);
  if(!member) return toast('ไม่พบสมาชิกที่ต้องการลบ');
  if(uid===state.user?.uid) return toast('ไม่สามารถลบบัญชี Admin ที่กำลังใช้งานอยู่');
  const label=member.displayName||member.username||uid;
  const username=member.username||'-';
  const memberRole=roleLabel(member.role||'staff');
  const authEmail=member.email||usernameToEmail(member.username||'');
  const confirmText=`ยืนยันลบสมาชิกออกจากระบบเว็บ?

สมาชิก: ${label}
Username: @${username}
ตำแหน่ง: ${memberRole}

ผลลัพธ์:
- สมาชิกจะหายจากรายชื่อใน ${appName()}
- สมาชิกจะเข้าใช้งานระบบไม่ได้ เพราะไม่มีโปรไฟล์สิทธิ์ในระบบเว็บ
- ประวัติรายการเก่าจะยังเก็บไว้เพื่อการตรวจสอบย้อนหลัง
- Email ใน Firebase Authentication จะยังไม่ถูกลบ

หากต้องการลบ Email ถาวร ต้องลบผ่าน Firebase Console แยกต่างหาก`;
  if(!confirm(confirmText)) return;
  try{
    const eventId=makeEventId('MEMDEL');
    const detail=`${label} • @${username} • ${memberRole} • ลบจากระบบเว็บเท่านั้น`;
    const extra={
      eventType:'member_delete_web_only',
      deleteScope:'firestore_members_only',
      authEmailDeleted:false,
      deletedMemberUid:uid,
      deletedMemberName:label,
      deletedMemberUsername:username,
      deletedMemberRole:member.role||'staff',
      deletedMemberRoleLabel:memberRole,
      deletedMemberEmail:authEmail,
      deletedByUid:state.user?.uid||'',
      deletedByName:state.profile?.displayName||state.profile?.username||state.user?.email||'Admin'
    };
    const logDoc=doc(logRef()), auditDoc=doc(auditRef());
    const batch=writeBatch(fs);
    batch.set(logDoc,logPayload('ลบสมาชิกออกจากระบบเว็บ',detail,{...extra,eventId}));
    batch.set(auditDoc,auditPayload('ลบสมาชิกออกจากระบบเว็บ',detail,{...extra,eventId,logId:logDoc.id}));
    batch.delete(memberRef(uid));
    await batch.commit();
    toast('ลบสมาชิกออกจากระบบเว็บแล้ว • Email ใน Firebase Authentication ยังไม่ถูกลบ');
    await window.manageMembers();
  }catch(e){ console.error(e); toast(`ลบสมาชิกไม่สำเร็จ (${e?.code||'unknown'})`); }
};
window.saveMemberRole=async(uid)=>{ if(!requireAdmin()) return;
  const newRole=$(`memberRole_${uid}`)?.value||'staff';
  const status=$(`memberStatus_${uid}`)?.value||'active';
  const stockAccess=collectMemberStockAccess(uid);
  if(uid===state.user?.uid && (newRole!=='admin' || status!=='active')) return toast('ไม่สามารถลดสิทธิ์หรือปิดบัญชีแอดมินที่กำลังใช้งานอยู่');
  if(!validateMemberStockAccessForSave(uid,newRole,stockAccess)) return;
  try{
    await updateDoc(memberRef(uid),{role:newRole,status,stockAccess,roleUpdatedAt:serverTimestamp(),roleUpdatedBy:state.user.uid,stockAccessUpdatedAt:serverTimestamp(),stockAccessUpdatedBy:state.user.uid});
    await addLog('แก้ไขตำแหน่ง/สิทธิ์พื้นที่สมาชิก',`${state.members.find(m=>m.uid===uid)?.displayName||uid} → ${roleLabel(newRole)} • ${memberStockAccessSummary({stockAccess})}`);
    toast('บันทึกตำแหน่งแล้ว');
    await window.manageMembers();
  }catch(e){ console.error(e); toast(`บันทึกไม่สำเร็จ (${e?.code||'unknown'})`); }
};
window.manageApprovalAssistants=async()=>{ if(!canAssignApprovers()) return toast('เฉพาะ Manager / Supervisor / Captain หรือผู้ดูแลระบบเท่านั้น');
  const snap=await getDocs(collection(fs,'members'));
  state.members=snap.docs.map(d=>({uid:d.id,...d.data()}));
  const staff=state.members.filter(m=>m.role==='staff' && m.status!=='disabled');
  const permissionRow=(id,checked,title,desc,icon)=>`<label class="permission-row" for="${id}">
      <input class="permission-checkbox" type="checkbox" id="${id}" ${checked?'checked':''}>
      <span class="permission-icon" aria-hidden="true">${icon}</span>
      <span class="permission-copy"><span class="permission-title">${title}</span><span class="permission-desc">${desc}</span></span>
    </label>`;
  const rows=staff.map(m=>`<section class="permission-card">
    <div class="permission-person">
      <div class="permission-avatar">${escapeHtml((m.displayName||m.username||'?').trim().charAt(0).toUpperCase())}</div>
      <div class="permission-person-copy"><b>${escapeHtml(m.displayName||m.username)}</b><div class="muted permission-username">@${escapeHtml(m.username||'')} • พนักงาน</div></div>
    </div>
    <div class="permission-list">
      ${permissionRow(`permApprove_${m.uid}`,m.permissions?.canApprove,'อนุมัติ / ปฏิเสธรายการ','ตรวจสอบและตัดสินใจรายการรับเข้า–เบิกออก','✅')}
      ${permissionRow(`permAdjust_${m.uid}`,m.permissions?.canAdjustStock,'ปรับยอดสต๊อก','แก้ยอดคงเหลือพร้อมเหตุผลและบันทึกประวัติ','⚖️')}
      ${permissionRow(`permProducts_${m.uid}`,m.permissions?.canManageProducts,'จัดการสินค้า','เพิ่ม แก้ไข และลบข้อมูลสินค้า','📦')}
      ${permissionRow(`permLots_${m.uid}`,m.permissions?.canManageLots,'แก้ไขข้อมูลล็อต','แก้วันที่รับเข้าและวันหมดอายุ พร้อมบันทึกประวัติ','🏷️')}
      ${permissionRow(`permReports_${m.uid}`,m.permissions?.canViewReports,'ดูรายงานทั้งหมด','เข้าดูรายงานและส่งออกข้อมูล','📊')}
    </div>
  </section>`).join('');
  openModal('จัดการสิทธิ์พนักงาน',`<div class="permission-manager"><p class="note permission-note">มอบสิทธิ์เพิ่มเติมเป็นรายบุคคล โดยไม่ต้องเปลี่ยนตำแหน่งจากพนักงาน ระบบจะบันทึกผู้ที่แก้ไขสิทธิ์และเวลาไว้</p>${rows||'<p class="muted">ยังไม่มีพนักงานที่พร้อมกำหนดสิทธิ์</p>'}<div class="permission-save-wrap"><button class="btn primary full permission-save" onclick="window.saveApprovalAssistants()">บันทึกสิทธิ์</button></div></div>`);
};
window.saveApprovalAssistants=async()=>{ if(!canAssignApprovers()) return;
  const staff=state.members.filter(m=>m.role==='staff'&&m.status!=='disabled');
  const LABELS={canApprove:'อนุมัติ / ปฏิเสธรายการ',canAdjustStock:'ปรับยอดสต๊อก',canManageProducts:'จัดการสินค้า',canManageLots:'แก้ไขข้อมูลล็อต',canViewReports:'ดูรายงานทั้งหมด'};
  const changed=[];
  staff.forEach(m=>{
    const before={canApprove:!!m.permissions?.canApprove,canAdjustStock:!!m.permissions?.canAdjustStock,canManageProducts:!!m.permissions?.canManageProducts,canManageLots:!!m.permissions?.canManageLots,canViewReports:!!m.permissions?.canViewReports};
    const after={canApprove:!!$(`permApprove_${m.uid}`)?.checked,canAdjustStock:!!$(`permAdjust_${m.uid}`)?.checked,canManageProducts:!!$(`permProducts_${m.uid}`)?.checked,canManageLots:!!$(`permLots_${m.uid}`)?.checked,canViewReports:!!$(`permReports_${m.uid}`)?.checked};
    const keys=Object.keys(after).filter(k=>before[k]!==after[k]);
    if(keys.length) changed.push({m,after,keys});
  });
  if(!changed.length) return toast('ไม่มีการเปลี่ยนแปลงสิทธิ์');
  try{
    const batch=writeBatch(fs),eventId=makeEventId('PERM'),summary=[];
    changed.forEach(({m,after,keys})=>{
      batch.update(memberRef(m.uid),{permissions:after,approvalAssignedBy:state.user.uid,approvalAssignedAt:serverTimestamp()});
      const granted=keys.filter(k=>after[k]).map(k=>`✅ ${LABELS[k]}`);
      const revoked=keys.filter(k=>!after[k]).map(k=>`❌ ${LABELS[k]}`);
      summary.push(`${m.displayName||m.username}: ${[...granted,...revoked].join(', ')}`);
    });
    const detail=summary.join(' | '),logDoc=doc(logRef()),auditDoc=doc(auditRef());
    batch.set(logDoc,logPayload('แก้ไขสิทธิ์พนักงาน',detail,{eventId,changes:summary}));
    batch.set(auditDoc,auditPayload('แก้ไขสิทธิ์พนักงาน',detail,{eventId,changes:summary,logId:logDoc.id}));
    await batch.commit();
    hideModal(); toast(`บันทึกสิทธิ์แล้ว ${changed.length} คน`);
  }catch(e){ console.error(e); toast(`บันทึกไม่สำเร็จ (${e?.code||'unknown'})`); }
};
function backupDocRows(snap){
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}
function reviveBackupValue(value){
  if(Array.isArray(value)) return value.map(reviveBackupValue);
  if(value&&typeof value==='object'){
    if(Number.isFinite(value.seconds)&&Number.isFinite(value.nanoseconds)){
      try{ return new Timestamp(Number(value.seconds),Number(value.nanoseconds)); }catch(_){ }
    }
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,reviveBackupValue(v)]));
  }
  return value;
}
function downloadBackupJson(data){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  const url=URL.createObjectURL(blob);
  a.href=url;
  a.download=`theview-backup-${toDateStr(new Date())}-v${String(BUILD_VERSION).replace(/[^a-z0-9.-]+/gi,'-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
window.exportBackup=async()=>{
  if(!requireAdmin()) return;
  const lockKey='exportBackup';
  if(!beginActionLock(lockKey,'headerBackupBtn','กำลังสำรองข้อมูล...')) return;
  const groups=['products','approvals','logs','auditLogs','skuRegistry','notifications','settings'];
  showResetProgress('⬇️ Export Backup','กำลังดึงข้อมูลล่าสุดจาก Firestore...');
  try{
    const data={
      schemaVersion:2,
      version:BUILD_VERSION,
      workspace:'main',
      exportedAt:new Date().toISOString(),
      exportedBy:state.profile?.displayName||state.profile?.username||'',
      exportedByUid:state.user?.uid||'',
      firebaseProject:firebaseConfig.projectId,
      counts:{}
    };
    for(let i=0;i<groups.length;i++){
      const group=groups[i];
      updateResetProgress(`กำลังสำรอง ${group}...`,Math.round(((i+1)/(groups.length+1))*90));
      const snap=await getDocsFromServer(userPath(group));
      data[group]=backupDocRows(snap);
      data.counts[group]=snap.size;
    }
    updateResetProgress('กำลังสำรองข้อมูลสมาชิก...',95);
    const membersSnap=await getDocsFromServer(collection(fs,'members'));
    data.members=backupDocRows(membersSnap);
    data.counts.members=membersSnap.size;
    data.totalDocuments=Object.values(data.counts).reduce((sum,n)=>sum+(Number(n)||0),0);
    updateResetProgress('กำลังสร้างไฟล์ Backup...',100);
    downloadBackupJson(data);
    $('modal')?.classList.remove('reset-running');
    hideModal();
    toast(`สำรองข้อมูลครบ ${data.totalDocuments.toLocaleString('th-TH')} รายการแล้ว`);
  }catch(e){
    console.error('Export Backup ไม่สำเร็จ',e);
    $('modal')?.classList.remove('reset-running');
    hideModal();
    const friendly=humanizeAppError(e);
    toast(`${friendly.title}: ${friendly.detail}`);
  }finally{
    endActionLock(lockKey,'headerBackupBtn');
  }
};
window.chooseBackupFile=()=>{ if(!requireAdmin()) return; $('backupInput').value=''; $('backupInput').click(); };
async function commitInChunks(ops){
  for(let i=0;i<ops.length;i+=400){
    const batch=writeBatch(fs);
    ops.slice(i,i+400).forEach(op=>batch.set(op.ref,op.data,{merge:op.merge!==false}));
    await batch.commit();
  }
}
function normalizeImportedRecord(group,item){
  const {id,...raw}=item||{};
  if(!id) return null;
  const data=reviveBackupValue(raw);
  const importedAt=serverTimestamp();
  if(!data.createdAt) data.createdAt=serverTimestamp();
  data.importedAt=importedAt;
  data.importedBy=state.user?.uid||'';
  data.backupSourceId=id;
  if(group==='logs'||group==='auditLogs'){
    data.importedOriginalActorUid=data.actorUid||'';
    data.actorUid=state.user?.uid||'';
    data.immutable=group==='auditLogs'?true:data.immutable;
  }
  return {id,data};
}
async function existingIdsForGroup(group){
  const snap=await getDocsFromServer(userPath(group));
  return new Set(snap.docs.map(d=>d.id));
}
$('backupInput')?.addEventListener('change',async e=>{
  const file=e.target.files?.[0];
  if(!file||!requireAdmin()) return;
  if(!confirm('นำเข้าข้อมูล Backup และรวมกับข้อมูลปัจจุบันใช่หรือไม่? ระบบจะข้ามประวัติที่มี ID ซ้ำ และอัปเดตข้อมูลระบบที่รองรับ')) return;
  const lockKey='importBackup';
  if(!beginActionLock(lockKey)) return;
  showResetProgress('⬆️ Import Backup','กำลังตรวจสอบไฟล์ Backup...');
  try{
    const data=JSON.parse(await file.text());
    if(data.workspace&&data.workspace!=='main') throw new Error('ไฟล์ Backup ไม่ใช่ Workspace main');
    const supported=['products','approvals','logs','auditLogs','skuRegistry','notifications','settings'];
    const ops=[];
    let skipped=0;
    for(let i=0;i<supported.length;i++){
      const group=supported[i];
      const items=Array.isArray(data[group])?data[group]:[];
      updateResetProgress(`กำลังเตรียม ${group}...`,Math.round(((i+1)/(supported.length+1))*80));
      if(!items.length) continue;
      const existing=(group==='logs'||group==='auditLogs')?await existingIdsForGroup(group):new Set();
      for(const item of items){
        const normalized=normalizeImportedRecord(group,item);
        if(!normalized) continue;
        if(existing.has(normalized.id)){ skipped++; continue; }
        ops.push({ref:doc(fs,'theviewWorkspaces','main',group,normalized.id),data:normalized.data,merge:true});
      }
    }
    // รองรับ Backup รุ่นเก่าที่ไม่มี skuRegistry โดยสร้างทะเบียนจากสินค้าให้อัตโนมัติ
    if(!Array.isArray(data.skuRegistry)&&Array.isArray(data.products)){
      for(const item of data.products){
        const sku=String(item?.sku||'').trim();
        if(!sku||!item?.id) continue;
        ops.push({ref:skuRegistryDocRef(sku),data:{sku,skuKey:normalizeSkuKey(sku),productId:item.id,updatedAt:serverTimestamp(),importedAt:serverTimestamp(),importedBy:state.user?.uid||''},merge:true});
      }
    }
    if(!ops.length&&skipped===0) throw new Error('ไม่พบข้อมูลที่รองรับในไฟล์');
    updateResetProgress(`กำลังนำเข้า ${ops.length.toLocaleString('th-TH')} รายการ...`,90);
    await commitInChunks(ops);
    await addLog('นำเข้า Backup',`${ops.length} รายการ${skipped?` • ข้าม ID ซ้ำ ${skipped} รายการ`:''}`,{backupVersion:data.version||'',backupSchemaVersion:data.schemaVersion||1});
    updateResetProgress('นำเข้าข้อมูลเรียบร้อย',100);
    $('modal')?.classList.remove('reset-running');
    hideModal();
    toast(`นำเข้าสำเร็จ ${ops.length.toLocaleString('th-TH')} รายการ${skipped?` ข้ามซ้ำ ${skipped.toLocaleString('th-TH')}`:''}`);
  }catch(err){
    console.error('Import Backup ไม่สำเร็จ',err);
    $('modal')?.classList.remove('reset-running');
    hideModal();
    toast(err?.message||'นำเข้า Backup ไม่สำเร็จ');
  }finally{
    endActionLock(lockKey);
    e.target.value='';
  }
});
const RESET_PLANS={
  usage:{
    title:'รีเซ็ตข้อมูลการใช้งาน', phrase:'รีเซ็ตข้อมูลการใช้งาน',
    collections:['products','publicProducts','approvals','logs','auditLogs','skuRegistry','notifications'],
    detail:'ลบสินค้า ยอดสต๊อก รายการรับเข้า–เบิกออก–ปรับยอด ประวัติ Audit Log การแจ้งเตือน และรูปสินค้า โดยคงสมาชิก บทบาท และสิทธิ์ไว้'
  },
  history:{
    title:'รีเซ็ตเฉพาะ Audit Log และประวัติ', phrase:'รีเซ็ตประวัติ',
    collections:['approvals','logs','auditLogs','notifications'],
    detail:'ลบ Audit Log ประวัติรับเข้า–เบิกออก–ปรับยอด และการแจ้งเตือนเก่า โดยคงสินค้า ยอดคงเหลือ สมาชิก และการตั้งค่าไว้'
  },
  factory:{
    title:'รีเซ็ตทั้งหมด', phrase:'รีเซ็ตทั้งหมด',
    collections:['products','publicProducts','approvals','logs','auditLogs','skuRegistry','notifications','settings'],
    detail:'ลบสินค้า ยอดสต๊อก ประวัติ Audit Log รูปสินค้า โปรไฟล์สมาชิกและสิทธิ์ทั้งหมด โดยคง Admin ที่กำลังกดไว้ 1 บัญชี'
  }
};
let resetSystemRunning=false;

async function deleteCollectionInChunks(name,onProgress){
  const snap=await getDocsFromServer(userPath(name));
  const docs=snap.docs;
  for(let i=0;i<docs.length;i+=400){
    const batch=writeBatch(fs);
    docs.slice(i,i+400).forEach(d=>batch.delete(d.ref));
    await batch.commit();
    onProgress?.(Math.min(i+400,docs.length),docs.length,name);
  }
  return docs.length;
}
async function deleteProductStorageFiles(){
  const snap=await getDocsFromServer(userPath('products'));
  const paths=[...new Set(snap.docs.flatMap(d=>[d.data()?.photoPath,d.data()?.imagePath]).filter(Boolean))];
  let deleted=0;
  for(const path of paths){
    try{ await deleteObject(storageRef(storage,path)); deleted++; }
    catch(e){ if(e?.code!=='storage/object-not-found') console.warn('ลบไฟล์ไม่สำเร็จ',path,e); }
  }
  return {found:paths.length,deleted};
}
async function deleteOtherMemberProfiles(){
  const snap=await getDocs(collection(fs,'members'));
  const targets=snap.docs.filter(d=>d.id!==state.user?.uid);
  for(let i=0;i<targets.length;i+=400){
    const batch=writeBatch(fs);
    targets.slice(i,i+400).forEach(d=>batch.delete(d.ref));
    await batch.commit();
  }
  if(state.user?.uid){
    await setDoc(memberRef(state.user.uid),{
      role:'admin',status:'active',permissions:{canApprove:true,canAdjustStock:true,canManageProducts:true,canManageLots:true,canViewReports:true},
      resetPreservedAt:serverTimestamp(),resetPreservedReason:'factory-reset'
    },{merge:true});
  }
  return targets.length;
}
async function writeResetStartAudit(type,plan,summary={}){
  const labels={usage:'เริ่มต้นข้อมูลการใช้งานใหม่',history:'เริ่มต้นประวัติใหม่',factory:'เริ่มต้นระบบใหม่'};
  await addAudit(labels[type]||'รีเซ็ตระบบ',plan.title,{
    resetType:type,
    resetSummary:summary,
    resetCompletedAt:new Date().toISOString()
  });
}
function showResetProgress(title,text='กำลังเตรียมข้อมูล...'){
  openModal(title,`<div class="reset-progress"><div class="reset-spinner"></div><h3 id="resetProgressTitle">${escapeHtml(text)}</h3><p id="resetProgressDetail">ห้ามปิดหน้าเว็บหรือกดย้อนกลับระหว่างดำเนินการ</p><div class="reset-progress-track"><span id="resetProgressBar"></span></div></div>`);
  $('modal')?.classList.add('reset-running');
}
function updateResetProgress(text,percent){
  if($('resetProgressTitle')) $('resetProgressTitle').textContent=text;
  if($('resetProgressBar')) $('resetProgressBar').style.width=`${Math.max(4,Math.min(100,percent||4))}%`;
}
window.openResetConfirm=(type)=>{
  if(!requireAdmin()||resetSystemRunning) return;
  const plan=RESET_PLANS[type]; if(!plan) return;
  openModal(plan.title,`<div class="reset-confirm-box"><div class="reset-warning-icon">⚠️</div><p>${escapeHtml(plan.detail)}</p><div class="reset-confirm-list"><b>ก่อนดำเนินการ</b><span>• ควร Export Backup เก็บไว้ก่อน</span><span>• ข้อมูลที่ถูกลบไม่สามารถย้อนกลับได้</span>${type==='factory'?'<span>• บัญชี Firebase Authentication ของสมาชิกคนอื่นจะยังอยู่ ต้องลบผ่าน Firebase Console</span>':''}</div><label>พิมพ์คำว่า <strong>${escapeHtml(plan.phrase)}</strong> เพื่อยืนยัน</label><input id="resetConfirmText" autocomplete="off" placeholder="${escapeHtml(plan.phrase)}"><button id="resetConfirmBtn" class="profile-danger-btn" onclick="window.executeReset('${type}')">ยืนยันและเริ่มรีเซ็ต</button><button class="profile-action full" onclick="window.hideModal()">ยกเลิก</button></div>`);
  setTimeout(()=>$('resetConfirmText')?.focus(),80);
};
window.executeReset=async(type)=>{
  if(!requireAdmin()||resetSystemRunning) return;
  const plan=RESET_PLANS[type]; if(!plan) return;
  const typed=($('resetConfirmText')?.value||'').trim();
  if(typed!==plan.phrase){ toast('ข้อความยืนยันไม่ตรง'); $('resetConfirmText')?.focus(); return; }
  if(!navigator.onLine){ toast('ต้องเชื่อมต่ออินเทอร์เน็ตก่อนรีเซ็ต'); return; }
  resetSystemRunning=true;
  const summary={collections:{},storage:{found:0,deleted:0},membersDeleted:0};
  let currentStep='เตรียมข้อมูล';
  try{
    showResetProgress(plan.title);
    let step=0;
    const total=plan.collections.length+(type!=='history'?1:0)+(type==='factory'?2:0)+1;
    if(type!=='history'){
      currentStep='รูปสินค้า';
      updateResetProgress('กำลังลบรูปสินค้า...',Math.round(step/total*100));
      summary.storage=await deleteProductStorageFiles(); step++;
    }
    for(const name of plan.collections){
      currentStep=name;
      updateResetProgress(`กำลังลบ ${name}...`,Math.round(step/total*100));
      summary.collections[name]=await deleteCollectionInChunks(name); step++;
    }
    if(type==='factory'){
      currentStep='members';
      updateResetProgress('กำลังลบโปรไฟล์สมาชิกและสิทธิ์...',Math.round(step/total*100));
      summary.membersDeleted=await deleteOtherMemberProfiles(); step++;
      currentStep='workspace';
      try{ await deleteDoc(doc(fs,'theviewWorkspaces','main')); }catch(e){
        if(e?.code!=='not-found') throw e;
      }
      step++;
    }
    currentStep='reset-audit';
    updateResetProgress('กำลังบันทึกจุดเริ่มต้นใหม่...',Math.round(step/total*100));
    await writeResetStartAudit(type,plan,summary); step++;

    updateResetProgress('กำลังล้างข้อมูลค้างในเครื่อง...',96);
    await clearProductCache();
    state.products=[]; state.approvals=[]; state.logs=[]; state.auditLogs=[];
    localStorage.removeItem(PRODUCT_DETAIL_KEY);
    state.viewProductId=null;
    if(type!=='history') await bindProductsOptimized({forceFullSync:true});
    updateResetProgress('รีเซ็ตสำเร็จ',100);
    state.page='home';
    setTimeout(()=>{
      $('modal')?.classList.remove('reset-running'); hideModal();
      window.goToPage('home',{resetScroll:true});
      toast(`${plan.title}เรียบร้อยแล้ว`);
    },700);
  }catch(e){
    console.error('รีเซ็ตระบบไม่สำเร็จ',currentStep,e);
    $('modal')?.classList.remove('reset-running');
    hideModal();
    const denied=e?.code==='permission-denied';
    toast(denied?`รีเซ็ตไม่ได้ที่ ${currentStep}: สิทธิ์ Firebase ไม่อนุญาต`:`รีเซ็ตไม่สำเร็จที่ ${currentStep}`);
  }finally{ resetSystemRunning=false; }
};
window.resetAccount=()=>window.openResetConfirm('usage');
let modalScrollY=0;
let modalTouchLastY=0;

function isAppModalOpen(){
  const modal=$('modal');
  return !!(modal && !modal.classList.contains('hidden') && document.body.classList.contains('modal-open'));
}

function lockModalPageScroll(){
  const html=document.documentElement;
  const body=document.body;
  if(!html || !body) return;
  if(!body.classList.contains('modal-scroll-locked')){
    modalScrollY=window.scrollY||html.scrollTop||0;
  }
  html.classList.add('modal-scroll-locked');
  body.classList.add('modal-open','modal-scroll-locked');

  // iOS/Safari-safe background lock: freeze only the page behind the modal.
  // The modal content itself scrolls via #modalBody/.sheet.
  html.style.setProperty('overflow','hidden','important');
  html.style.setProperty('overscroll-behavior','none','important');
  body.style.setProperty('position','fixed','important');
  body.style.setProperty('top',`-${modalScrollY}px`,'important');
  body.style.setProperty('left','0','important');
  body.style.setProperty('right','0','important');
  body.style.setProperty('width','100%','important');
  body.style.setProperty('overflow','hidden','important');
  body.style.setProperty('overscroll-behavior','none','important');
}

function unlockModalPageScroll(){
  const html=document.documentElement;
  const body=document.body;
  const y=Number(modalScrollY)||0;
  html.classList.remove('modal-scroll-locked');
  body.classList.remove('modal-open','modal-scroll-locked');
  html.style.removeProperty('overflow');
  html.style.removeProperty('height');
  html.style.removeProperty('overscroll-behavior');
  body.style.removeProperty('position');
  body.style.removeProperty('top');
  body.style.removeProperty('left');
  body.style.removeProperty('right');
  body.style.removeProperty('width');
  body.style.removeProperty('overflow');
  body.style.removeProperty('touch-action');
  body.style.removeProperty('overscroll-behavior');
  requestAnimationFrame(()=>window.scrollTo({top:y,behavior:'auto'}));
}

function getModalScrollableFromTarget(target){
  const modal=$('modal');
  const sheet=modal?.querySelector('.sheet');
  const modalBody=$('modalBody');
  if(!modal || !sheet || !(target instanceof Element) || !modal.contains(target)) return null;
  if(!sheet.contains(target)) return null;

  // v34.29.31: Bulk QR บน iPhone/Safari ต้องให้ตัว overlay (#modal) เป็น scroller หลัก
  // เพราะรายการสินค้าเป็นแถวยาวและ Safari มักกิน gesture ถ้า scroll อยู่ใน body ของ popup
  if(modal.classList.contains('bulk-qr-modal') && sheet.contains(target)){
    if(modal.scrollHeight>modal.clientHeight+1) return modal;
    if(modalBody && modalBody.contains(target) && modalBody.scrollHeight>modalBody.clientHeight+1) return modalBody;
  }

  // v34.29.28: ใช้ #modalBody เป็น scroll container หลักของ popup ทั่วไป รวมถึง QR Code รายตัว
  // เพื่อไม่ให้ iPhone/Safari กัน touchmove แล้วทำให้เลื่อนไม่ได้
  if(modalBody && modalBody.contains(target) && modalBody.scrollHeight>modalBody.clientHeight+1){
    return modalBody;
  }

  // Prefer the nearest real scroll container. This supports report lists,
  // history details, QR sheets, form sheets and any nested modal content.
  let node=target;
  while(node && node!==modal){
    if(node instanceof HTMLElement){
      const style=window.getComputedStyle(node);
      const canOverflow=/(auto|scroll|overlay)/.test(style.overflowY||'');
      if(canOverflow && node.scrollHeight>node.clientHeight+1) return node;
    }
    if(node===sheet) break;
    node=node.parentElement;
  }
  if(sheet.scrollHeight>sheet.clientHeight+1) return sheet;
  return null;
}

function modalScrollerCanMove(scroller,deltaY){
  if(!scroller || scroller.scrollHeight<=scroller.clientHeight+1) return false;
  const atTop=scroller.scrollTop<=0;
  const atBottom=scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-1;
  // deltaY > 0 = finger moves down, content wants to move down, scrollTop decreases.
  // deltaY < 0 = finger moves up, content wants to move up, scrollTop increases.
  if(deltaY>0 && atTop) return false;
  if(deltaY<0 && atBottom) return false;
  return true;
}

function installModalScrollGuardV34239(){
  if(window.__theviewModalScrollGuardV34239) return;
  window.__theviewModalScrollGuardV34239=true;

  document.addEventListener('touchstart',event=>{
    if(!isAppModalOpen()) return;
    modalTouchLastY=event.touches?.[0]?.clientY||0;
  },{passive:true,capture:true});

  document.addEventListener('touchmove',event=>{
    if(!isAppModalOpen()) return;
    const target=event.target instanceof Element ? event.target : null;
    const scroller=getModalScrollableFromTarget(target);
    const y=event.touches?.[0]?.clientY||modalTouchLastY;
    const deltaY=y-modalTouchLastY;
    modalTouchLastY=y;

    // Outside the sheet = always lock the background.
    if(!scroller){
      event.preventDefault();
      return;
    }

    // Inside the sheet: allow native momentum scrolling while the content can move.
    // Prevent only at the top/bottom edge so the gesture cannot bleed to the page behind.
    if(!modalScrollerCanMove(scroller,deltaY)){
      event.preventDefault();
    }
  },{passive:false,capture:true});

  document.addEventListener('wheel',event=>{
    if(!isAppModalOpen()) return;
    const target=event.target instanceof Element ? event.target : null;
    const scroller=getModalScrollableFromTarget(target);
    if(!scroller){ event.preventDefault(); return; }
    const atTop=scroller.scrollTop<=0;
    const atBottom=scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-1;
    if((event.deltaY<0 && atTop) || (event.deltaY>0 && atBottom)){
      event.preventDefault();
    }
  },{passive:false,capture:true});
}
installModalScrollGuardV34239();

function openModal(t,b){
  const modal=$('modal');
  const wasOpen=modal && !modal.classList.contains('hidden') && document.body.classList.contains('modal-open');
  if(!wasOpen) lockModalPageScroll();
  $('modalTitle').textContent=t;
  $('modalBody').innerHTML=b;
  const modalBody=$('modalBody');
  const titleText=String(t||'');
  const isQrModal=!!modalBody?.querySelector('.product-qr-sheet');
  const isBulkQrModal=!!modalBody?.querySelector('.qr-bulk-sheet');
  const compactTitleKeywords=['ล็อตสินค้า','รายละเอียด','ปรับยอดสต็อก','ปรับยอดสต๊อก','เลือกสินค้าที่ต้องการปรับยอด'];
  const isCompactCardModal=!isQrModal && (
    compactTitleKeywords.some(keyword=>titleText.includes(keyword)) ||
    !!modalBody?.querySelector('.lot-compact-list,.lot-detail-sheet,.stock-adjust-modal-card')
  );
  // v34.29.28: popup ล็อตสินค้า/ปรับยอดเป็น compact centered modal
  // ไม่ให้ดูเหมือนการ์ดลอยไม่กลางหรือมีพื้นที่ขาวท้าย popup เกินจำเป็นบน iPhone/Safari
  modal.classList.toggle('qr-modal',isQrModal);
  modal.classList.toggle('bulk-qr-modal',isBulkQrModal);
  modal.classList.toggle('compact-card-modal',isCompactCardModal);
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  const sheet=modal.querySelector('.sheet');
  if(sheet){ sheet.scrollTop=0; sheet.style.pointerEvents='auto'; }
  if(modalBody) modalBody.scrollTop=0;
  if(isQrModal || isBulkQrModal){ modal.scrollTop=0; }
  // ให้ Safari คำนวณตำแหน่ง hitbox ใหม่หลัง modal แสดงจริง
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    modal.style.pointerEvents='auto';
    const first=modalBody?.querySelector('select,input,textarea,button');
    if(first) first.style.pointerEvents='auto';
    if(isBulkQrModal && modalBody){
      modal.style.overflowY='auto';
      modal.style.webkitOverflowScrolling='touch';
      modalBody.style.overflowY='visible';
      modalBody.style.webkitOverflowScrolling='auto';
    }
  }));
  refreshPasswordEyes(modalBody);
}
function hideModal(){
  if(state.profile?.mustChangePassword) return;
  const modal=$('modal');
  modal.classList.add('hidden');
  modal.classList.remove('qr-modal','bulk-qr-modal','compact-card-modal');
  unlockModalPageScroll();
  normalizeMobilePageScrollV329();
}
window.hideModal=hideModal;


// ---------- Modal controls: หลีกเลี่ยงชื่อชนกับ element id บน Safari ----------
$('modal').addEventListener('click',e=>{ if(e.target===$('modal')) hideModal(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && !$('modal').classList.contains('hidden')) hideModal(); });

// ---------- จำตำแหน่งหน้าและ scroll หลังรีเฟรช ----------
let scrollSaveTimer=null;
['touchstart','wheel','pointerdown'].forEach(type=>window.addEventListener(type,()=>{ if(scrollRestoreJob.active) cancelScrollRestore(); },{passive:true,capture:true}));
window.addEventListener('scroll',()=>{
  if($('app').classList.contains('hidden') || isAppModalOpen()) return;
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer=setTimeout(saveCurrentPageScroll,80);
},{passive:true});
window.addEventListener('pagehide',()=>{ saveCurrentPageScroll(); saveUiState(); if(state.page==='scan') saveNewItemDraft(); });
window.addEventListener('beforeunload',()=>{ saveCurrentPageScroll(); saveUiState(); if(state.page==='scan') saveNewItemDraft(); });
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden'){ saveCurrentPageScroll(); saveUiState(); if(state.page==='scan') saveNewItemDraft(); } });

window.addEventListener('error', (event) => {
  if(state.user && view) showLoadError('เกิดข้อผิดพลาดในหน้าเว็บ', event.error || new Error(event.message));
});
window.addEventListener('unhandledrejection', (event) => {
  if(state.user && view) showLoadError('คำสั่งทำงานไม่สำเร็จ', event.reason || new Error('Unhandled promise rejection'));
});


document.addEventListener('click',e=>{
  const wrap=e.target.closest?.('.scan-product-search-wrap');
  if(!wrap){ const box=$('scanProductResults'); if(box) box.classList.add('hidden'); }
});


// ---------- v34.14.2: Verified Network Online / Offline Indicator ----------
let __networkStatusInitialized=false;
let __verifiedOnline=navigator.onLine!==false;
let __networkProbeTimer=null;
let __networkProbeRunning=false;

function isAuthSurfaceActiveForNetworkBadge(){
  const appEl=document.getElementById('app');
  const loginEl=document.getElementById('loginPage');
  const bootEl=document.getElementById('bootPage');
  const gateEl=document.getElementById('passwordGate');
  return document.body.classList.contains('auth-screen-active')
    || document.body.classList.contains('password-gate-active')
    || !state.user
    || !appEl
    || appEl.classList.contains('hidden')
    || (!!loginEl && !loginEl.classList.contains('hidden'))
    || (!!bootEl && !bootEl.classList.contains('hidden'))
    || (!!gateEl && !gateEl.classList.contains('hidden'));
}
function hideNetworkStatusIndicator(){
  const el=document.getElementById('networkStatusIndicator');
  if(el) el.remove();
}
function ensureNetworkStatusIndicator(){
  if(isAuthSurfaceActiveForNetworkBadge()){
    hideNetworkStatusIndicator();
    return null;
  }
  let el=document.getElementById('networkStatusIndicator');
  if(el) return el;
  const hero=document.querySelector('#app:not(.hidden) .hero');
  if(!hero) return null;
  el=document.createElement('div');
  el.id='networkStatusIndicator';
  el.className='network-status-pill';
  el.setAttribute('role','status');
  el.setAttribute('aria-live','polite');
  hero.appendChild(el);
  return el;
}

function paintNetworkStatus(showMessage=false,status='auto'){
  if(isAuthSurfaceActiveForNetworkBadge()){ hideNetworkStatusIndicator(); return; }
  const syncing=status==='syncing';
  const online=syncing ? true : __verifiedOnline;
  const el=ensureNetworkStatusIndicator();
  if(el){
    el.classList.toggle('is-online',online && !syncing);
    el.classList.toggle('is-offline',!online && !syncing);
    el.classList.toggle('is-syncing',syncing);
    el.innerHTML=syncing
      ? '<span class="network-dot" aria-hidden="true"></span><span>กำลังซิงค์</span>'
      : online
        ? '<span class="network-dot" aria-hidden="true"></span><span>ออนไลน์</span>'
        : '<span class="network-dot" aria-hidden="true"></span><span>ออฟไลน์</span>';
    el.title=syncing?'กำลังส่งรายการที่บันทึกตอนออฟไลน์':online?'เชื่อมต่ออินเทอร์เน็ตแล้ว':'ไม่มีการเชื่อมต่ออินเทอร์เน็ต';
  }
  if(showMessage && __networkStatusInitialized){
    toast(online?'✅ กลับมาออนไลน์แล้ว ระบบพร้อมซิงก์ข้อมูล':'⚠️ ออฟไลน์อยู่ ระบบจะแสดงข้อมูลที่เคยบันทึกไว้ในเครื่อง');
  }
  __networkStatusInitialized=true;
}

async function verifyInternetConnection({showMessage=false,timeout=4500}={}){
  if(__networkProbeRunning) return __verifiedOnline;
  __networkProbeRunning=true;
  const previous=__verifiedOnline;
  try{
    if(navigator.onLine===false){
      __verifiedOnline=false;
    }else{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),timeout);
      try{
        // Cross-origin no-cors request is not served by this site's Service Worker cache.
        await fetch('https://www.gstatic.com/generate_204?cc_probe='+Date.now(),{
          method:'GET',mode:'no-cors',cache:'no-store',signal:controller.signal
        });
        __verifiedOnline=true;
      }finally{
        clearTimeout(timer);
      }
    }
  }catch(_){
    __verifiedOnline=false;
  }finally{
    __networkProbeRunning=false;
  }
  paintNetworkStatus(showMessage && previous!==__verifiedOnline);
  return __verifiedOnline;
}

// Backward-compatible name used elsewhere in the project.
function updateNetworkStatusIndicator(showMessage=false,status='auto'){
  if(status==='syncing'){
    paintNetworkStatus(false,'syncing');
    return;
  }
  paintNetworkStatus(false);
  verifyInternetConnection({showMessage});
}

window.addEventListener('online',async()=>{
  paintNetworkStatus(false,'syncing');
  const online=await verifyInternetConnection({showMessage:true});
  if(!online) return;
  try{
    await waitForPendingWrites(fs);
    paintNetworkStatus(false);
    toast('✅ ออนไลน์และซิงค์รายการที่รอเรียบร้อยแล้ว');
  }catch(_){
    paintNetworkStatus(false);
  }
  if(__lastLoadError && document.getElementById('appRetryButton')) setTimeout(()=>retryLastLoad(),350);
});
window.addEventListener('offline',()=>{
  __verifiedOnline=false;
  paintNetworkStatus(true);
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible') verifyInternetConnection({showMessage:false});
});
window.addEventListener('pageshow',()=>verifyInternetConnection({showMessage:false}));
setTimeout(()=>verifyInternetConnection({showMessage:false}),0);
__networkProbeTimer=setInterval(()=>{
  if(document.visibilityState==='visible') verifyInternetConnection({showMessage:true});
},12000);

// ลงทะเบียน Service Worker เพื่อให้ใช้งาน offline ได้ (ฟรี ไม่มีค่าใช้จ่าย)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  });
}

/* v34.28.15 TEXT BREATHING ROOM */
(function(){
  const old=document.getElementById('theviewStockCardMultilineTextPolishStyles');
  if(old) old.remove();
  const style=document.createElement('style');
  style.id='theviewStockCardTextBreathingRoomStyles';
  style.textContent=`
.stock-card-list{gap:13px!important}
.stock-card-modern{
  grid-template-columns:92px minmax(0,1fr) 112px!important;
  align-items:center!important;
  min-height:164px!important;
  padding:16px 15px 16px 20px!important;
  gap:14px!important;
  border-radius:24px!important;
  border:1px solid rgba(218,205,181,.86)!important;
  background:linear-gradient(135deg,#ffffff 0%,#fffdf7 100%)!important;
  box-shadow:0 13px 32px rgba(67,52,34,.105)!important;
}
.stock-card-modern:hover{box-shadow:0 16px 38px rgba(67,52,34,.14)!important}
.stock-card-modern::before{width:7px!important;border-radius:24px 0 0 24px!important;background:var(--stock-accent,#22c55e)!important}
.stock-card-photo{
  width:88px!important;
  height:96px!important;
  border-radius:18px!important;
  background:#f8fafc!important;
  box-shadow:inset 0 0 0 1px rgba(226,232,240,.95)!important;
}
.stock-card-photo img{object-fit:contain!important}
.stock-card-main{min-width:0!important;align-self:center!important}
.stock-card-heading{display:flex!important;align-items:flex-start!important;justify-content:space-between!important;gap:8px!important;min-width:0!important;margin:0 0 6px!important}
.stock-card-heading .stock-card-name{
  min-width:0!important;
  flex:1 1 auto!important;
  margin:0!important;
  font-size:24px!important;
  line-height:1.24!important;
  font-weight:900!important;
  letter-spacing:-.35px!important;
  color:#07182f!important;
  display:-webkit-box!important;
  -webkit-box-orient:vertical!important;
  -webkit-line-clamp:2!important;
  white-space:normal!important;
  overflow:hidden!important;
  text-overflow:ellipsis!important;
  overflow-wrap:break-word!important;
  word-break:break-word!important;
  max-height:none!important;
  padding:2px 0 3px!important;
}
.stock-card-heading .stock-status-modern{
  flex:0 0 auto!important;
  padding:6px 9px!important;
  border-radius:999px!important;
  font-size:12px!important;
  line-height:1!important;
  font-weight:900!important;
  box-shadow:0 6px 14px rgba(22,163,74,.10)!important;
}
.stock-card-heading .stock-status-modern::before{width:9px!important;height:9px!important;box-shadow:0 0 0 4px rgba(255,255,255,.65)!important}
.stock-card-sku{
  margin:0 0 8px!important;
  font-size:13px!important;
  line-height:1.25!important;
  color:#6b7280!important;
  font-weight:700!important;
}
.stock-card-main .stock-area-badge,.stock-card-main .stock-lot-summary,.stock-card-main .stock-card-expiry-row{font-size:13px!important;line-height:1.34!important}
.stock-card-main .stock-area-badge{
  display:-webkit-box!important;
  -webkit-box-orient:vertical!important;
  -webkit-line-clamp:2!important;
  white-space:normal!important;
  overflow:hidden!important;
  text-overflow:ellipsis!important;
  overflow-wrap:break-word!important;
  word-break:break-word!important;
  max-height:2.76em!important;
  padding:1px 0 2px!important;
  font-weight:800!important;
  color:#334155!important;
  margin:0 0 4px!important;
  padding:0!important;
  border:0!important;
  background:transparent!important;
}
.stock-card-main .stock-area-badge span{display:inline!important}
.stock-card-main .stock-lot-summary{color:#5f574b!important;font-weight:800!important;margin-top:3px!important}
.stock-card-side{
  min-width:112px!important;
  align-self:stretch!important;
  display:grid!important;
  grid-template-columns:minmax(0,1fr) 20px!important;
  grid-template-rows:1fr auto 1fr!important;
  align-items:center!important;
  justify-items:end!important;
  column-gap:2px!important;
}
.stock-card-side .stock-card-qty{
  grid-column:1/2!important;
  grid-row:2/3!important;
  display:flex!important;
  flex-direction:column!important;
  align-items:flex-end!important;
  justify-content:center!important;
  gap:2px!important;
  margin:0!important;
  width:100%!important;
}
.stock-card-side .stock-card-number{
  font-size:58px!important;
  line-height:1!important;
  font-weight:950!important;
  letter-spacing:-2.2px!important;
  color:var(--stock-count-color,var(--stock-accent,#004c39))!important;
  font-variant-numeric:tabular-nums!important;
  display:block!important;
  padding:2px 0 3px!important;
  overflow:visible!important;
  text-align:right!important;
  max-width:100%!important;
}
.stock-card-side .stock-card-unit{
  font-size:15px!important;
  line-height:1!important;
  font-weight:900!important;
  color:#102033!important;
  text-align:right!important;
}
.stock-card-side .stock-card-arrow{
  grid-column:2/3!important;
  grid-row:2/3!important;
  align-self:end!important;
  justify-self:end!important;
  margin:0 0 2px!important;
  font-size:32px!important;
  line-height:1!important;
  color:#064233!important;
  opacity:.95!important;
}

.stock-card-modern.stock-status-above-count .stock-card-heading{justify-content:flex-start!important}
.stock-card-modern.stock-status-above-count .stock-card-heading .stock-card-name{max-width:100%!important}
.stock-card-side-status{
  grid-column:1/3!important;
  grid-row:1/2!important;
  justify-self:end!important;
  align-self:end!important;
  display:flex!important;
  margin:0 1px 2px 0!important;
}
.stock-card-side-status .stock-status-modern{
  padding:6px 9px!important;
  border-radius:999px!important;
  font-size:12px!important;
  line-height:1!important;
  font-weight:900!important;
  box-shadow:0 6px 14px rgba(22,163,74,.10)!important;
}
.stock-card-side-status .stock-status-modern::before{width:9px!important;height:9px!important;box-shadow:0 0 0 4px rgba(255,255,255,.65)!important}
.stock-card-modern.stock-status-above-count .stock-card-side{
  grid-template-rows:auto auto auto!important;
  align-content:center!important;
  row-gap:3px!important;
}
.stock-card-modern.stock-status-above-count .stock-card-side .stock-card-qty{grid-row:2/3!important}
.stock-card-modern.stock-status-above-count .stock-card-side .stock-card-arrow{grid-row:2/3!important}

.stock-status-ok{background:#dcfce7!important;color:#16a34a!important}
.stock-status-low{background:#fef3c7!important;color:#d97706!important}
.stock-status-out{background:#fee2e2!important;color:#ef4444!important}
@media(max-width:640px){
  .stock-card-modern{
    grid-template-columns:82px minmax(0,1fr) 104px!important;
    min-height:156px!important;
    padding:13px 12px 13px 17px!important;
    gap:11px!important;
    border-radius:22px!important;
  }
  .stock-card-photo{width:80px!important;height:88px!important;border-radius:17px!important}
  .stock-card-heading{gap:6px!important;margin-bottom:6px!important}
  .stock-card-heading .stock-card-name{font-size:23px!important;line-height:1.22!important;letter-spacing:-.4px!important;max-height:none!important;padding:2px 0 3px!important}
  .stock-card-heading .stock-status-modern{padding:6px 8px!important;font-size:11px!important}
  .stock-card-sku{font-size:12px!important;margin-bottom:7px!important}
  .stock-card-main .stock-area-badge,.stock-card-main .stock-lot-summary,.stock-card-main .stock-card-expiry-row{font-size:12px!important;line-height:1.32!important}
  .stock-card-side{min-width:104px!important;grid-template-columns:minmax(0,1fr) 18px!important}
  .stock-card-side .stock-card-number{font-size:54px!important;letter-spacing:-2px!important}
  .stock-card-side .stock-card-unit{font-size:14px!important}
  .stock-card-side .stock-card-arrow{font-size:30px!important;display:block!important;margin-bottom:2px!important}
  .stock-card-main .stock-card-label,.stock-card-main>.stock-card-qty{display:none!important}
}
@media(max-width:390px){
  .stock-card-modern{grid-template-columns:74px minmax(0,1fr) 88px!important;gap:9px!important;padding:12px 10px 12px 16px!important;min-height:148px!important}
  .stock-card-photo{width:72px!important;height:80px!important}
  .stock-card-heading .stock-card-name{font-size:21px!important;line-height:1.22!important;max-height:none!important;padding:2px 0 3px!important}
  .stock-card-heading .stock-status-modern{padding:5px 7px!important;font-size:10.5px!important}
  .stock-card-sku{font-size:11px!important;margin-bottom:6px!important}
  .stock-card-main .stock-area-badge,.stock-card-main .stock-lot-summary,.stock-card-main .stock-card-expiry-row{font-size:11px!important;line-height:1.28!important}
  .stock-card-side{min-width:88px!important;grid-template-columns:minmax(0,1fr) 14px!important}
  .stock-card-side .stock-card-number{font-size:46px!important;letter-spacing:-1.7px!important}
  .stock-card-side .stock-card-unit{font-size:12px!important}
  .stock-card-side .stock-card-arrow{font-size:24px!important;display:block!important}
}
@media(min-width:900px){
  .stock-card-modern{grid-template-columns:96px minmax(0,1fr) 120px!important}
  .stock-card-heading .stock-card-name{font-size:25px!important}
  .stock-card-side .stock-card-number{font-size:60px!important}
}
`;
  document.head.appendChild(style);
})();

/* v34.28.15 ADMIN STOCK CARD UI SETTINGS - PREVIEW POLISH */
(function(){
  const old=document.getElementById('theviewStockCardAdminUiSettingsStyles');
  if(old) old.remove();
  const style=document.createElement('style');
  style.id='theviewStockCardAdminUiSettingsStyles';
  style.textContent=`
.stock-card-modern{
  grid-template-columns:var(--stock-card-photo-col,92px) minmax(0,1fr) var(--stock-card-side-col,112px)!important;
  min-height:var(--stock-card-min-height,164px)!important;
  padding:var(--stock-card-padding,16px 15px 16px 20px)!important;
  gap:var(--stock-card-gap,14px)!important;
}
.stock-card-photo{width:var(--stock-card-photo-w,88px)!important;height:var(--stock-card-photo-h,96px)!important}
.stock-card-heading .stock-card-name{font-size:var(--stock-card-name-font,24px)!important;-webkit-line-clamp:var(--stock-card-name-lines,2)!important}
.stock-card-main .stock-area-badge{font-size:var(--stock-card-meta-font,13px)!important;-webkit-line-clamp:var(--stock-card-location-lines,2)!important;max-height:calc(var(--stock-card-location-lines,2) * 1.42em)!important}
.stock-card-main .stock-lot-summary,.stock-card-main .stock-card-expiry-row,.stock-card-sku{font-size:var(--stock-card-meta-font,13px)!important}
.stock-card-side{min-width:var(--stock-card-side-col,112px)!important}
.stock-card-side .stock-card-number{font-size:var(--stock-card-count-font,58px)!important}
@media(max-width:640px){
  .stock-card-modern{grid-template-columns:var(--stock-card-photo-col-mobile,82px) minmax(0,1fr) var(--stock-card-side-col-mobile,104px)!important;min-height:var(--stock-card-min-height-mobile,156px)!important;padding:var(--stock-card-padding-mobile,13px 12px 13px 17px)!important;gap:var(--stock-card-gap-mobile,11px)!important}
  .stock-card-photo{width:var(--stock-card-photo-w-mobile,80px)!important;height:var(--stock-card-photo-h-mobile,88px)!important}
  .stock-card-heading .stock-card-name{font-size:var(--stock-card-name-font-mobile,23px)!important}
  .stock-card-main .stock-area-badge,.stock-card-main .stock-lot-summary,.stock-card-main .stock-card-expiry-row,.stock-card-sku{font-size:var(--stock-card-meta-font-mobile,12px)!important}
  .stock-card-side{min-width:var(--stock-card-side-col-mobile,104px)!important}
  .stock-card-side .stock-card-number{font-size:var(--stock-card-count-font-mobile,54px)!important}
}
@media(max-width:390px){
  .stock-card-modern{grid-template-columns:var(--stock-card-photo-col-small,74px) minmax(0,1fr) var(--stock-card-side-col-small,88px)!important;min-height:var(--stock-card-min-height-small,148px)!important;padding:var(--stock-card-padding-small,12px 10px 12px 16px)!important;gap:var(--stock-card-gap-small,9px)!important}
  .stock-card-photo{width:var(--stock-card-photo-w-small,72px)!important;height:var(--stock-card-photo-h-small,80px)!important}
  .stock-card-heading .stock-card-name{font-size:var(--stock-card-name-font-small,21px)!important}
  .stock-card-main .stock-area-badge,.stock-card-main .stock-lot-summary,.stock-card-main .stock-card-expiry-row,.stock-card-sku{font-size:var(--stock-card-meta-font-small,11px)!important}
  .stock-card-side{min-width:var(--stock-card-side-col-small,88px)!important}
  .stock-card-side .stock-card-number{font-size:var(--stock-card-count-font-small,46px)!important}
}
.stock-card-ui-settings{display:grid;gap:14px}
.stock-card-ui-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.stock-card-ui-field{display:grid;gap:5px}.stock-card-ui-field span{font-weight:900;color:#17342b}.stock-card-ui-field small{font-size:12px;color:#64748b;line-height:1.35}.stock-card-ui-actions{display:grid;gap:8px}
.stock-card-ui-preview-wrap{max-width:none;width:100%;margin:0 auto;overflow:visible!important}
.stock-card-ui-preview-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin:0 0 10px;padding:10px 12px;border-radius:16px;background:#f0faf5;border:1px solid rgba(0,107,79,.12)}
.stock-card-ui-preview-head b{display:block;color:#073f31;font-size:15px;line-height:1.25}.stock-card-ui-preview-head span{color:#64748b;font-size:12px;line-height:1.35;text-align:right;max-width:230px;font-weight:700}
.stock-card-ui-preview-list{display:grid;gap:12px;width:100%;overflow:visible!important}
.stock-card-ui-preview-wrap .stock-card-modern{width:100%!important;margin:0!important;cursor:default!important;box-sizing:border-box!important;overflow:visible!important;transform:none!important;opacity:1!important;grid-template-columns:var(--stock-card-photo-col-mobile,82px) minmax(0,1fr) var(--stock-card-side-col-mobile,104px)!important;min-height:var(--stock-card-min-height-mobile,156px)!important;padding:var(--stock-card-padding-mobile,13px 12px 13px 17px)!important;gap:var(--stock-card-gap-mobile,11px)!important;align-items:center!important}
.stock-card-ui-preview-wrap .stock-card-modern:active{transform:none!important;opacity:1!important}
.stock-card-ui-preview-wrap .stock-card-photo{width:var(--stock-card-photo-w-mobile,80px)!important;height:var(--stock-card-photo-h-mobile,88px)!important}
.stock-card-ui-preview-wrap .stock-card-main{min-width:0!important;overflow:visible!important}
.stock-card-ui-preview-wrap .stock-card-heading{align-items:flex-start!important;gap:8px!important;overflow:visible!important}
.stock-card-ui-preview-wrap .stock-card-heading .stock-card-name{font-size:var(--stock-card-name-font-mobile,23px)!important;line-height:1.22!important;-webkit-line-clamp:var(--stock-card-name-lines,2)!important;overflow:hidden!important;text-overflow:ellipsis!important;padding:2px 0 3px!important;max-height:none!important}
.stock-card-ui-preview-wrap .stock-card-sku,.stock-card-ui-preview-wrap .stock-card-main .stock-lot-summary,.stock-card-ui-preview-wrap .stock-card-main .stock-card-expiry-row{font-size:var(--stock-card-meta-font-mobile,12px)!important;line-height:1.28!important}
.stock-card-ui-preview-wrap .stock-card-main .stock-area-badge{font-size:var(--stock-card-meta-font-mobile,12px)!important;line-height:1.32!important;-webkit-line-clamp:var(--stock-card-location-lines,2)!important;max-height:calc(var(--stock-card-location-lines,2) * 1.38em)!important;overflow:hidden!important;text-overflow:ellipsis!important;padding:1px 0 2px!important}
.stock-card-ui-preview-wrap .stock-card-side{min-width:var(--stock-card-side-col-mobile,104px)!important;overflow:visible!important}
.stock-card-ui-preview-wrap .stock-card-side .stock-card-number{font-size:var(--stock-card-count-font-mobile,54px)!important;line-height:1!important;overflow:visible!important;padding:2px 0 3px!important}
.stock-card-ui-preview-wrap .stock-card-unit{font-size:16px!important;line-height:1.1!important}.stock-card-ui-preview-wrap .stock-card-arrow{display:inline-grid!important}
@media(max-width:520px){.stock-card-ui-grid{grid-template-columns:1fr}.stock-card-ui-preview-head{display:block}.stock-card-ui-preview-head span{display:block;text-align:left;max-width:none;margin-top:4px}.stock-card-ui-preview-wrap .stock-card-modern{grid-template-columns:var(--stock-card-photo-col-small,74px) minmax(0,1fr) var(--stock-card-side-col-small,88px)!important;min-height:var(--stock-card-min-height-small,148px)!important;padding:var(--stock-card-padding-small,12px 10px 12px 16px)!important;gap:var(--stock-card-gap-small,9px)!important}.stock-card-ui-preview-wrap .stock-card-photo{width:var(--stock-card-photo-w-small,72px)!important;height:var(--stock-card-photo-h-small,80px)!important}.stock-card-ui-preview-wrap .stock-card-heading .stock-card-name{font-size:var(--stock-card-name-font-small,21px)!important}.stock-card-ui-preview-wrap .stock-card-sku,.stock-card-ui-preview-wrap .stock-card-main .stock-area-badge,.stock-card-ui-preview-wrap .stock-card-main .stock-lot-summary,.stock-card-ui-preview-wrap .stock-card-main .stock-card-expiry-row{font-size:var(--stock-card-meta-font-small,11px)!important}.stock-card-ui-preview-wrap .stock-card-side{min-width:var(--stock-card-side-col-small,88px)!important}.stock-card-ui-preview-wrap .stock-card-side .stock-card-number{font-size:var(--stock-card-count-font-small,46px)!important}.stock-card-ui-preview-wrap .stock-card-arrow{display:none!important}}
`;
  document.head.appendChild(style);
  try{ applyStockCardUi(state.stockCardUi||state.branding?.stockCardUi||{}); }catch(_){ }
})();

