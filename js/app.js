const STORAGE_KEY='psm-analytics-state-v1';
const PROJECT_FORMAT='PSM_ANALYTICS_PROJECT';
const PROJECT_VERSION=1;
const fmtBRL=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0});
const fmtNum=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1});
const $=s=>document.querySelector(s);
function emptyFilterState(){return{search:'',qpp:[],tipoOrdem:[],area:[],oficina:[],crit:[],obs:[]};}
function cloneFilterState(filters={}){
  const clean=emptyFilterState();
  clean.search=normalize(filters.search);
  ['qpp','tipoOrdem','area','oficina','crit','obs'].forEach(key=>clean[key]=Array.isArray(filters[key])?[...filters[key]]:[]);
  return clean;
}
const state={orders:[],systematicCatalog:[],systematicCatalogMeta:{fileName:'',importedAt:'',total:0},capacity:[],capacityChartAreas:[],capacityConsumptionOffice:'',dailySelectedWeek:0,dailySelectedDay:'',dailySelectedPromanPlants:[],dailySelectedOffices:[],dailyObservations:{},history:[],qppBoard:[],meetings:{},qppBoardFilter:'all',qppSelectedWeeks:[],qppShowHidden:false,qppCurrentWeek:1,sharedPresentationSettings:null,lastFilterChanged:'',activeView:'dashboard',activeFilterView:'dashboard',filters:emptyFilterState(),filtersByView:{dashboard:emptyFilterState(),ordens:emptyFilterState()},sort:{key:'',direction:'desc'},page:1,pageSize:25,charts:{}};
let appMode='';
const ACCESS_USERS_KEY='psm-access-users-v1';
const ACCESS_FILTERS_KEY='psm-access-filters-v1';
const PRESENTATION_SESSION_KEY='psm-presentation-session-v1';
const PRESENTATION_SESSION_DURATION=24*60*60*1000;
let activeAdminUserId='';
const VIEWER_ALLOWED_VIEWS=new Set(['dashboard','ordens','programacao','quadro','ataFab','ataBrit','proman','promanBacklog','promanAtaFabrica','promanAtaBritagem']);

// Impede que uma atualização, fechamento ou saída acidental interrompa a reunião.
window.addEventListener('beforeunload',event=>{
  if(!appMode||document.body?.dataset.allowUnload==='true')return;
  const message='A reunião está em andamento. Deseja realmente sair ou atualizar a página?';
  event.preventDefault();
  event.returnValue=true;
  return message;
});

function normalize(v){return String(v??'').trim();}
function parseSearchTerms(value){
  const raw=String(value??'').trim();
  if(!raw)return[];
  let parts;
  if(/[\r\n,;\t]/.test(raw))parts=raw.split(/[\r\n,;\t]+/);
  else{
    const spaced=raw.split(/\s+/).filter(Boolean);
    parts=spaced.length>1&&spaced.every(term=>/^\d{5,}$/.test(term))?spaced:[raw];
  }
  return[...new Set(parts.map(term=>normalize(term).toLocaleLowerCase('pt-BR')).filter(Boolean))];
}
function updateGlobalSearchCount(){
  const badge=$('#globalSearchCount');
  if(!badge)return;
  const count=parseSearchTerms($('#globalSearch')?.value).length;
  badge.hidden=count<2;
  badge.textContent=`${count} pesquisas`;
}
let globalSearchRenderTimer=0;
function cancelGlobalSearchRender(){
  if(!globalSearchRenderTimer)return;
  window.clearTimeout(globalSearchRenderTimer);
  globalSearchRenderTimer=0;
}
function scheduleGlobalSearchRender(delay=360){
  cancelGlobalSearchRender();
  globalSearchRenderTimer=window.setTimeout(()=>{
    globalSearchRenderTimer=0;
    render();
  },delay);
}
function flushGlobalSearchRender(){
  cancelGlobalSearchRender();
  render();
}
function num(v){
  if(typeof v==='number')return Number.isFinite(v)?v:0;
  let text=normalize(v).replace(/\s/g,'');
  if(!text)return 0;
  if(text.includes(',')&&text.includes('.')){
    text=text.lastIndexOf(',')>text.lastIndexOf('.')?text.replace(/\./g,'').replace(',','.'):text.replace(/,/g,'');
  }else if(text.includes(','))text=text.replace(',','.');
  const value=Number(text);
  return Number.isFinite(value)?value:0;
}
function upper(v){return normalize(v).toLocaleUpperCase('pt-BR');}

function isViewerMode(){return appMode==='viewer';}
function isViewAllowedInCurrentMode(view){return !isViewerMode()||VIEWER_ALLOWED_VIEWS.has(view);}
function viewerOrderAllowed(order){return !isViewerMode()||state.activeFilterView!=='ordens'||['Rotina','QPP'].includes(qppValue(order));}
function enforceViewerControls(root=document){
  if(!isViewerMode())return;
  root.querySelectorAll?.('#ordersBody select,#ordersBody input').forEach(control=>{control.disabled=true;control.tabIndex=-1;});
  root.querySelectorAll?.('#quadroView textarea[data-qpp-field]').forEach(control=>{control.readOnly=true;control.tabIndex=-1;});
  root.querySelectorAll?.('#quadroView input[data-qpp-field]').forEach(control=>{control.disabled=true;control.tabIndex=-1;});
  root.querySelectorAll?.('#ataFabView input,#ataFabView textarea,#ataBritView input,#ataBritView textarea,#promanAtaFabricaView input,#promanAtaFabricaView textarea,#promanAtaBritagemView input,#promanAtaBritagemView textarea').forEach(control=>{control.readOnly=true;control.tabIndex=-1;});
  root.querySelectorAll?.('#ataFabView select,#ataBritView select,#promanAtaFabricaView select,#promanAtaBritagemView select').forEach(control=>{
    control.disabled=false;
    control.tabIndex=-1;
    control.setAttribute('aria-readonly','true');
    control.classList.add('viewer-locked-control');
  });
}
function applyAccessModeUI(){
  const viewer=isViewerMode();
  document.body.dataset.appMode=appMode;
  document.querySelectorAll('[data-presentation-only]').forEach(element=>{element.hidden=viewer;});
  const badge=$('#accessModeBadge');
  if(badge)badge.textContent=viewer?'Visualizar':'Apresentação';
  enforceViewerControls();
}
function readAccessFilters(){try{return JSON.parse(localStorage.getItem(ACCESS_FILTERS_KEY))||{};}catch{return{};}}
function saveAccessFiltersForMode(mode=appMode){
  if(!['viewer','presentation'].includes(mode))return;
  syncActiveFilterBank();
  const banks=readAccessFilters();
  banks[mode]={dashboard:cloneFilterState(state.filtersByView.dashboard),ordens:cloneFilterState(state.filtersByView.ordens)};
  localStorage.setItem(ACCESS_FILTERS_KEY,JSON.stringify(banks));
}
function loadAccessFiltersForMode(mode){
  const saved=readAccessFilters()[mode];
  state.filtersByView={dashboard:cloneFilterState(saved?.dashboard),ordens:cloneFilterState(saved?.ordens)};
  state.filters=cloneFilterState(state.filtersByView[state.activeFilterView]||state.filtersByView.dashboard);
  state.page=1;
  const search=$('#globalSearch');if(search)search.value=state.filters.search;
}
function activateAppMode(mode){
  if(!['viewer','presentation'].includes(mode))return;
  appMode=mode;
  loadAccessFiltersForMode(mode);
  window.PSMProMan?.setAccessMode?.(mode);
  document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close?.());
  $('#modeGate').hidden=true;
  $('#appShell').hidden=false;
  applyAccessModeUI();
  $('#btnWorkspacePsm')?.click();
  document.querySelector('[data-view="dashboard"]')?.click();
  render();
  window.PSMProMan?.render?.();
  if(mode==='presentation'){
    state.sharedPresentationSettings=captureSharedPresentationSettings();
    save();
    window.PSMServerSync?.flush?.().catch(error=>console.error('Falha ao publicar as configurações da apresentação.',error));
  }
  requestAnimationFrame(()=>enforceViewerControls());
}
function showModeGate(){
  if(document.fullscreenElement)document.exitFullscreen?.();
  saveAccessFiltersForMode();
  window.PSMProMan?.setAccessMode?.('');
  appMode='';
  delete document.body.dataset.appMode;
  $('#appShell').hidden=true;
  $('#modeGate').hidden=false;
}
async function hashAccessPassword(password){
  const data=new TextEncoder().encode(String(password));
  const digest=await crypto.subtle.digest('SHA-256',data);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function readAccessUsers(){
  try{const users=JSON.parse(localStorage.getItem(ACCESS_USERS_KEY));return Array.isArray(users)?users:[];}catch{return[];}
}
function writeAccessUsers(users){localStorage.setItem(ACCESS_USERS_KEY,JSON.stringify(users));}
async function ensureAccessUsers(){
  const users=readAccessUsers();
  if(users.length)return users;
  const initial=[{id:uid(),username:'admin',passwordHash:await hashAccessPassword('admin123'),role:'admin',createdAt:new Date().toISOString()}];
  writeAccessUsers(initial);
  return initial;
}
async function authenticateAccess(username,password,adminOnly=false){
  const users=await ensureAccessUsers();
  const normalized=normalize(username).toLocaleLowerCase('pt-BR');
  const passwordHash=await hashAccessPassword(password);
  return users.find(user=>normalize(user.username).toLocaleLowerCase('pt-BR')===normalized&&user.passwordHash===passwordHash&&(!adminOnly||user.role==='admin'))||null;
}
function setAccessMessage(selector,message=''){
  const target=$(selector);if(!target)return;
  target.textContent=message;target.hidden=!message;
}
function readPresentationSession(){
  try{
    const session=JSON.parse(localStorage.getItem(PRESENTATION_SESSION_KEY));
    if(!Number.isFinite(Number(session?.expiresAt))||Number(session.expiresAt)<=Date.now()){
      localStorage.removeItem(PRESENTATION_SESSION_KEY);return null;
    }
    if(session.kind==='corporate'&&!/^[^\s@]+@vcimentos\.com$/i.test(normalize(session.identity))){localStorage.removeItem(PRESENTATION_SESSION_KEY);return null;}
    if(session.kind==='common'&&!readAccessUsers().some(user=>user.id===session.userId&&user.role==='user')){localStorage.removeItem(PRESENTATION_SESSION_KEY);return null;}
    if(!['corporate','common'].includes(session.kind)){localStorage.removeItem(PRESENTATION_SESSION_KEY);return null;}
    return session;
  }catch{localStorage.removeItem(PRESENTATION_SESSION_KEY);return null;}
}
function savePresentationSession(identity,kind='corporate',userId=''){
  localStorage.setItem(PRESENTATION_SESSION_KEY,JSON.stringify({identity:normalize(identity).toLocaleLowerCase('pt-BR'),kind,userId,authenticatedAt:Date.now(),expiresAt:Date.now()+PRESENTATION_SESSION_DURATION}));
}
function openPresentationAccessChoice(){
  if(readPresentationSession()){activateAppMode('presentation');return;}
  $('#presentationAccessChoiceDialog')?.showModal();
}
function openPresentationLogin(){
  const dialog=$('#presentationLoginDialog');
  $('#presentationLoginForm')?.reset();setAccessMessage('#presentationLoginError');
  dialog?.showModal();setTimeout(()=>$('#presentationEmail')?.focus(),0);
}
function resetAdminUserForm(){
  $('#adminUserForm')?.reset();
  if($('#adminEditingUserId'))$('#adminEditingUserId').value='';
  if($('#btnCancelUserEdit'))$('#btnCancelUserEdit').hidden=true;
}
function renderAdminUsers(){
  const body=$('#adminUserListBody');if(!body)return;
  const users=readAccessUsers();
  body.innerHTML=users.map(user=>`<tr><td><strong>${escapeHtml(user.username)}</strong></td><td>${user.role==='admin'?'ADMINISTRADOR':'USUÁRIO'}</td><td><button type="button" class="ghost" data-access-edit="${escapeHtml(user.id)}">EDITAR</button><button type="button" class="danger ghost" data-access-delete="${escapeHtml(user.id)}">EXCLUIR</button></td></tr>`).join('');
}
function showAdminPanel(){
  $('#adminLoginSection').hidden=true;$('#adminPanelSection').hidden=false;
  resetAdminUserForm();setAccessMessage('#adminUserMessage');renderAdminUsers();
}
function openUserAdmin(){
  activeAdminUserId='';
  $('#adminLoginForm')?.reset();$('#adminLoginSection').hidden=false;$('#adminPanelSection').hidden=true;
  setAccessMessage('#adminLoginError');$('#userAdminDialog')?.showModal();
  setTimeout(()=>$('#adminLoginUsername')?.focus(),0);
}
function wireAccessModes(){
  $('#btnModeViewer')?.addEventListener('click',()=>activateAppMode('viewer'));
  $('#btnModePresentation')?.addEventListener('click',openPresentationAccessChoice);
  $('#btnCorporateAccess')?.addEventListener('click',()=>{$('#presentationAccessChoiceDialog')?.close();openPresentationLogin();});
  $('#btnCommonUserAccess')?.addEventListener('click',()=>{$('#presentationAccessChoiceDialog')?.close();$('#commonUserLoginForm')?.reset();setAccessMessage('#commonLoginError');$('#commonUserLoginDialog')?.showModal();setTimeout(()=>$('#commonLoginUsername')?.focus(),0);});
  $('#btnChangeMode')?.addEventListener('click',showModeGate);
  $('#btnChangeModeTop')?.addEventListener('click',showModeGate);
  $('#btnOpenUserAdmin')?.addEventListener('click',openUserAdmin);
  document.querySelectorAll('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>document.getElementById(button.dataset.closeDialog)?.close()));
  $('#presentationLoginForm')?.addEventListener('submit',async event=>{
    event.preventDefault();setAccessMessage('#presentationLoginError');
    const email=normalize($('#presentationEmail').value).toLocaleLowerCase('pt-BR');
    if(!/^[^\s@]+@vcimentos\.com$/i.test(email)){setAccessMessage('#presentationLoginError','Digite um email corporativo válido terminado em @vcimentos.com.');return;}
    savePresentationSession(email,'corporate');
    $('#presentationLoginDialog').close();activateAppMode('presentation');
  });
  $('#commonUserLoginForm')?.addEventListener('submit',async event=>{
    event.preventDefault();setAccessMessage('#commonLoginError');
    const user=await authenticateAccess($('#commonLoginUsername').value,$('#commonLoginPassword').value);
    if(!user||user.role!=='user'){setAccessMessage('#commonLoginError','Usuário ou senha inválidos.');return;}
    savePresentationSession(user.username,'common',user.id);$('#commonUserLoginDialog').close();activateAppMode('presentation');
  });
  $('#adminLoginForm')?.addEventListener('submit',async event=>{
    event.preventDefault();setAccessMessage('#adminLoginError');
    const user=await authenticateAccess($('#adminLoginUsername').value,$('#adminLoginPassword').value,true);
    if(!user){setAccessMessage('#adminLoginError','Credenciais administrativas inválidas.');return;}
    activeAdminUserId=user.id;showAdminPanel();
  });
  $('#clearHistoryForm')?.addEventListener('submit',async event=>{
    event.preventDefault();setAccessMessage('#clearHistoryError');
    const admin=await authenticateAccess($('#clearHistoryUsername').value,$('#clearHistoryPassword').value,true);
    if(!admin){setAccessMessage('#clearHistoryError','Credenciais administrativas inválidas.');return;}
    if(!confirm('Limpar definitivamente todo o histórico de alterações?'))return;
    state.history=[];save();renderHistory();$('#clearHistoryDialog').close();toast(`Histórico limpo pelo administrador ${admin.username}`);
  });
  $('#adminUserForm')?.addEventListener('submit',async event=>{
    event.preventDefault();setAccessMessage('#adminUserMessage');
    const users=readAccessUsers(),editingId=normalize($('#adminEditingUserId').value),username=normalize($('#adminUserName').value),password=$('#adminUserPassword').value,role=$('#adminUserRole').value==='admin'?'admin':'user';
    if(!username){setAccessMessage('#adminUserMessage','Informe o usuário.');return;}
    if(users.some(user=>user.id!==editingId&&normalize(user.username).toLocaleLowerCase('pt-BR')===username.toLocaleLowerCase('pt-BR'))){setAccessMessage('#adminUserMessage','Este usuário já existe.');return;}
    if(!editingId&&!password){setAccessMessage('#adminUserMessage','Informe uma senha para o novo usuário.');return;}
    if(password&&password.length<6){setAccessMessage('#adminUserMessage','A senha deve ter pelo menos 6 caracteres.');return;}
    const existing=users.find(user=>user.id===editingId);
    if(existing){
      const removingLastAdmin=existing.role==='admin'&&role!=='admin'&&users.filter(user=>user.role==='admin').length===1;
      if(removingLastAdmin){setAccessMessage('#adminUserMessage','É necessário manter pelo menos um administrador.');return;}
      existing.username=username;existing.role=role;if(password)existing.passwordHash=await hashAccessPassword(password);existing.updatedAt=new Date().toISOString();
    }else users.push({id:uid(),username,passwordHash:await hashAccessPassword(password),role,createdAt:new Date().toISOString()});
    writeAccessUsers(users);
    const session=readPresentationSession();if(existing&&session?.kind==='common'&&session.userId===existing.id&&password)localStorage.removeItem(PRESENTATION_SESSION_KEY);
    resetAdminUserForm();renderAdminUsers();setAccessMessage('#adminUserMessage',existing?'Usuário atualizado.':'Usuário cadastrado.');
  });
  $('#btnCancelUserEdit')?.addEventListener('click',()=>{resetAdminUserForm();setAccessMessage('#adminUserMessage');});
  $('#adminUserListBody')?.addEventListener('click',event=>{
    const editId=event.target.closest('[data-access-edit]')?.dataset.accessEdit;
    if(editId){const user=readAccessUsers().find(item=>item.id===editId);if(!user)return;$('#adminEditingUserId').value=user.id;$('#adminUserName').value=user.username;$('#adminUserPassword').value='';$('#adminUserRole').value=user.role;$('#btnCancelUserEdit').hidden=false;setAccessMessage('#adminUserMessage','Deixe a senha vazia para manter a atual.');return;}
    const deleteId=event.target.closest('[data-access-delete]')?.dataset.accessDelete;if(!deleteId)return;
    const users=readAccessUsers(),user=users.find(item=>item.id===deleteId);if(!user)return;
    if(user.role==='admin'&&users.filter(item=>item.role==='admin').length===1){setAccessMessage('#adminUserMessage','Não é possível excluir o último administrador.');return;}
    if(!confirm(`Excluir o usuário ${user.username}?`))return;
    writeAccessUsers(users.filter(item=>item.id!==deleteId));
    if(readPresentationSession()?.userId===deleteId)localStorage.removeItem(PRESENTATION_SESSION_KEY);
    renderAdminUsers();resetAdminUserForm();setAccessMessage('#adminUserMessage','Usuário excluído.');
  });
  $('#btnAdminLogout')?.addEventListener('click',()=>{activeAdminUserId='';$('#adminPanelSection').hidden=true;$('#adminLoginSection').hidden=false;$('#adminLoginForm').reset();});
  ensureAccessUsers();
}

function formatDateBR(date){
  return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}).format(date);
}
function getISOWeek(date){
  const utc=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
  const day=utc.getUTCDay()||7;
  utc.setUTCDate(utc.getUTCDate()+4-day);
  const yearStart=new Date(Date.UTC(utc.getUTCFullYear(),0,1));
  return Math.ceil((((utc-yearStart)/86400000)+1)/7);
}
function updatePlanningWeek(){
  const today=new Date();
  today.setHours(12,0,0,0);
  const day=today.getDay()||7;
  const monday=new Date(today);
  monday.setDate(today.getDate()+(1-day));
  const friday=new Date(monday);
  friday.setDate(monday.getDate()+4);
  // O mapa corporativo utiliza 52 posições; uma eventual semana ISO 53 é exibida como semana 52.
  const week=Math.min(52,getISOWeek(monday));
  const weekEl=$('#planningWeek');
  const periodEl=$('#planningPeriod');
  if(weekEl)weekEl.textContent=`Semana ${String(week).padStart(2,'0')}`;
  if(periodEl)periodEl.textContent=`${formatDateBR(monday)} a ${formatDateBR(friday)}`;
}
// Retorna a semana usada no nome e nos metadados do arquivo .psm.
// Prioriza a semana selecionada no QUADRO QPP; quando nenhuma estiver selecionada,
// utiliza a próxima semana de planejamento sem alterar o cabeçalho da semana atual.
function getPlanningWeekData(){
  let week=Number(state.qppCurrentWeek);
  if(state.qppSelectedWeeks.length)week=Number(state.qppSelectedWeeks[0]);
  else if(state.qppBoardFilter!=='all')week=Number(state.qppBoardFilter);

  if(!Number.isInteger(week)||week<1||week>52){
    const today=new Date();
    today.setHours(12,0,0,0);
    const day=today.getDay()||7;
    const nextMonday=new Date(today);
    nextMonday.setDate(today.getDate()+(8-day));
    week=Math.min(52,getISOWeek(nextMonday));
  }

  const boardWeek=state.qppBoard.find(item=>Number(item.week)===week);
  return {
    week,
    startDate:boardWeek?.days?.[0]?.date||null,
    endDate:boardWeek?.days?.[4]?.date||null
  };
}
function uid(){return crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`;}
function qppValue(row){const value=normalize(row?.qpp).toUpperCase();if(value==='SIM'||value==='QPP')return 'QPP';if(value==='ROTINA')return 'Rotina';if(value==='PRIOR')return 'PRIOR';if(value==='EXEC')return 'EXEC';if(value==='REPR')return 'REPR';return 'Não';}
function orderTypeValue(row){return upper(row?.tipoOrdem)==='SISTEMÁTICA'?'SISTEMÁTICA':'NÃO SISTEMÁTICA';}
function normalizeOrderRecord(order={}){return{...order,criticidade:normalize(order.criticidade||order.abc),tipoOrdem:orderTypeValue(order)};}
function isDailyCompleted(order){return order?.realizado===true||['SIM','TRUE','1','REALIZADO'].includes(upper(order?.realizado));}
function isDailyPlanOrder(order){
  const classification=qppValue(order);
  return classification==='QPP'||(classification==='Rotina'&&orderTypeValue(order)==='NÃO SISTEMÁTICA');
}
function normalizeDailyObservations(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return{};
  return Object.fromEntries(Object.entries(value).map(([key,text])=>[String(key),String(text??'')]));
}
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2200);}
function currentAuditUser(){
  if(appMode==='viewer')return{userId:'viewer',username:'Visualização'};
  const session=readPresentationSession();
  return session?{userId:session.userId||session.identity,username:session.identity}:{userId:'unknown',username:'Não identificado'};
}
function log(action,details){const audit=currentAuditUser();state.history.unshift({id:uid(),date:new Date().toISOString(),action,details,...audit});state.history=state.history.slice(0,500);save();if(state.activeView==='historico')renderHistory();}
function syncActiveFilterBank(){
  if(state.activeFilterView==='dashboard'||state.activeFilterView==='ordens')state.filtersByView[state.activeFilterView]=cloneFilterState(state.filters);
}
function getProjectData(options={}){
  syncActiveFilterBank();
  const project={orders:state.orders,systematicCatalog:state.systematicCatalog,systematicCatalogMeta:state.systematicCatalogMeta,capacity:state.capacity,capacityChartAreas:state.capacityChartAreas,capacityConsumptionOffice:state.capacityConsumptionOffice,dailySelectedWeek:state.dailySelectedWeek,dailySelectedDay:state.dailySelectedDay,dailySelectedPromanPlants:state.dailySelectedPromanPlants,dailySelectedOffices:state.dailySelectedOffices,dailyObservations:state.dailyObservations,history:state.history,qppBoard:state.qppBoard,qppSelectedWeeks:state.qppSelectedWeeks,meetings:state.meetings,filtersByView:state.filtersByView};
  if(options.includeProman!==false)project.proman=window.PSMProMan?.getProjectData?.()||null;
  return project;
}
function captureSharedPresentationSettings(){
  return{
    capacityChartAreas:[...state.capacityChartAreas],
    capacityConsumptionOffice:state.capacityConsumptionOffice,
    qppSelectedWeeks:[...state.qppSelectedWeeks],
    qppCurrentWeek:state.qppCurrentWeek,
    qppShowHidden:state.qppShowHidden
  };
}
function normalizeSharedPresentationSettings(value={}){
  const currentWeek=Number(value.qppCurrentWeek);
  return{
    capacityChartAreas:Array.isArray(value.capacityChartAreas)?value.capacityChartAreas.map(upper).filter(Boolean):[],
    capacityConsumptionOffice:upper(value.capacityConsumptionOffice),
    qppSelectedWeeks:normalizeQppWeekSelection(value.qppSelectedWeeks),
    qppCurrentWeek:Number.isInteger(currentWeek)&&currentWeek>=1&&currentWeek<=52?currentWeek:1,
    qppShowHidden:value.qppShowHidden===true
  };
}
function applySharedPresentationSettings(value){
  const settings=normalizeSharedPresentationSettings(value);
  state.sharedPresentationSettings=settings;
  state.capacityChartAreas=[...settings.capacityChartAreas];
  state.capacityConsumptionOffice=settings.capacityConsumptionOffice;
  state.qppSelectedWeeks=[...settings.qppSelectedWeeks];
  state.qppCurrentWeek=settings.qppCurrentWeek;
  state.qppShowHidden=settings.qppShowHidden;
}
function getSharedProjectData(){
  if(appMode==='presentation')state.sharedPresentationSettings=captureSharedPresentationSettings();
  return{
    schemaVersion:2,
    orders:state.orders,
    systematicCatalog:state.systematicCatalog,
    systematicCatalogMeta:state.systematicCatalogMeta,
    capacity:state.capacity,
    dailyObservations:state.dailyObservations,
    history:state.history,
    qppBoard:state.qppBoard,
    meetings:state.meetings,
    presentationSettings:state.sharedPresentationSettings||captureSharedPresentationSettings(),
    proman:window.PSMProMan?.getSharedData?.()||window.PSMProMan?.getProjectData?.()||null
  };
}
function applySharedProjectData(payload,metadata={}){
  if(!payload||typeof payload!=='object')return;
  state.orders=Array.isArray(payload.orders)?payload.orders.map(normalizeOrderRecord):[];
  state.systematicCatalog=Array.isArray(payload.systematicCatalog)?payload.systematicCatalog.map(item=>({...item,tipoOrdem:'SISTEMÁTICA'})):[];
  state.systematicCatalogMeta=payload.systematicCatalogMeta||{fileName:'',importedAt:'',total:state.systematicCatalog.length};
  state.capacity=Array.isArray(payload.capacity)?payload.capacity:[];
  state.dailyObservations=normalizeDailyObservations(payload.dailyObservations);
  state.history=Array.isArray(payload.history)?payload.history:[];
  state.qppBoard=Array.isArray(payload.qppBoard)?payload.qppBoard:[];
  state.meetings=payload.meetings&&typeof payload.meetings==='object'?payload.meetings:{};
  if(payload.presentationSettings&&typeof payload.presentationSettings==='object')applySharedPresentationSettings(payload.presentationSettings);
  if(window.PSMProMan?.restoreSharedData)window.PSMProMan.restoreSharedData(payload.proman,false);
  else window.PSMProMan?.restoreProjectData?.(payload.proman,false);
  ensureQppBoard();
  ensureMeetings();
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(getProjectData({includeProman:false})));}catch(error){console.warn('Não foi possível atualizar a cópia local.',error);}
  render();
  if(state.activeView.startsWith('proman'))window.PSMProMan?.render?.();
  if(!metadata.initial&&appMode)toast(metadata.updatedBy?`Dados atualizados por ${metadata.updatedBy}`:'Dados atualizados por outro usuário');
}
function save(){
  let localSaved=true;
  try{
    // O PROMAN já mantém sua própria cópia local. Evitar a duplicação reduz
    // bastante o tempo de bloqueio do navegador ao salvar bases grandes.
    localStorage.setItem(STORAGE_KEY,JSON.stringify(getProjectData({includeProman:false})));
    saveAccessFiltersForMode();
  }
  catch(error){
    localSaved=false;
    console.warn('A cópia local está cheia; o envio ao servidor continuará.',error);
  }
  let serverQueued=false;
  try{
    if(!window.PSMServerSync?.isApplyingRemote?.())serverQueued=Boolean(window.PSMServerSync?.queueSave?.(getSharedProjectData(),currentAuditUser().username));
  }catch(error){
    console.error('Falha ao preparar o envio ao servidor:',error);
  }
  if(!localSaved&&serverQueued)toast('Cópia local cheia · alterações enviadas ao servidor');
  else if(!localSaved)toast('Não foi possível salvar no navegador. Verifique a conexão.');
  return localSaved||serverQueued;
}
function projectFileName(){const week=String(getPlanningWeekData().week).padStart(2,'0');const date=new Date().toISOString().slice(0,10);return`PSM_Semana_${week}_${date}.psm`;}
async function exportProject(){
  try{
    if(!window.PSMProject?.save)throw new Error('O módulo de salvamento do PSM não foi carregado.');
    save();
    const planningWeek=getPlanningWeekData();
    await window.PSMProject.save(getProjectData(),projectFileName(),{planningWeek:planningWeek.week,startDate:planningWeek.startDate,endDate:planningWeek.endDate});
    log('PSM salvo','Backup completo exportado em arquivo .psm.');
    toast('PSM salvo com sucesso');
  }catch(error){
    console.error(error);
    if(error?.name!=='AbortError')toast(error?.message||'Não foi possível salvar o PSM.');
  }
}
async function importProject(file){
  const result=await window.PSMProject.open(file);
  const payload=result.payload;
  if(!confirm('Abrir este PSM substituirá os dados atualmente salvos neste navegador. Deseja continuar?'))return;
  state.orders=(payload.orders||[]).map(normalizeOrderRecord);
  state.systematicCatalog=(payload.systematicCatalog||[]).map(item=>({...item,tipoOrdem:'SISTEMÁTICA'}));
  state.systematicCatalogMeta=payload.systematicCatalogMeta||{fileName:'',importedAt:'',total:state.systematicCatalog.length};
  state.capacity=payload.capacity||[];
  state.capacityChartAreas=Array.isArray(payload.capacityChartAreas)?payload.capacityChartAreas.map(upper):[];
  state.capacityConsumptionOffice=upper(payload.capacityConsumptionOffice);
  state.dailySelectedWeek=Number(payload.dailySelectedWeek)||0;
  state.dailySelectedDay=['0','1','2','3','4'].includes(String(payload.dailySelectedDay))?String(payload.dailySelectedDay):'';
  state.dailySelectedPromanPlants=Array.isArray(payload.dailySelectedPromanPlants)?payload.dailySelectedPromanPlants.filter(value=>['britagem','fabrica'].includes(value)):[];
  state.dailySelectedOffices=Array.isArray(payload.dailySelectedOffices)?payload.dailySelectedOffices.map(upper).filter(Boolean):[];
  state.dailyObservations=normalizeDailyObservations(payload.dailyObservations);
  state.history=payload.history||[];
  state.qppBoard=payload.qppBoard||[];
  state.qppSelectedWeeks=normalizeQppWeekSelection(payload.qppSelectedWeeks);
  state.meetings=payload.meetings||{};
  state.filtersByView={
    dashboard:cloneFilterState(payload.filtersByView?.dashboard),
    ordens:cloneFilterState(payload.filtersByView?.ordens)
  };
  state.activeFilterView=state.activeView==='ordens'?'ordens':'dashboard';
  state.filters=cloneFilterState(state.filtersByView[state.activeFilterView]);
  state.sort={key:'',direction:'desc'};
  state.page=1;
  window.PSMProMan?.restoreProjectData?.(payload.proman,false);
  ensureQppBoard();ensureMeetings();
  log('PSM aberto',`Arquivo ${file.name} restaurado.`);
  save();render();
  toast('PSM aberto com sucesso');
}
function load(){try{const s=JSON.parse(localStorage.getItem(STORAGE_KEY));if(s){state.orders=(s.orders||[]).map(normalizeOrderRecord);state.systematicCatalog=(s.systematicCatalog||[]).map(item=>({...item,tipoOrdem:'SISTEMÁTICA'}));state.systematicCatalogMeta=s.systematicCatalogMeta||{fileName:'',importedAt:'',total:state.systematicCatalog.length};state.capacity=s.capacity||[];state.capacityChartAreas=Array.isArray(s.capacityChartAreas)?s.capacityChartAreas.map(upper):[];state.capacityConsumptionOffice=upper(s.capacityConsumptionOffice);state.dailySelectedWeek=Number(s.dailySelectedWeek)||0;state.dailySelectedDay=['0','1','2','3','4'].includes(String(s.dailySelectedDay))?String(s.dailySelectedDay):'';state.dailySelectedPromanPlants=Array.isArray(s.dailySelectedPromanPlants)?s.dailySelectedPromanPlants.filter(value=>['britagem','fabrica'].includes(value)):[];state.dailySelectedOffices=Array.isArray(s.dailySelectedOffices)?s.dailySelectedOffices.map(upper).filter(Boolean):[];state.dailyObservations=normalizeDailyObservations(s.dailyObservations);state.history=s.history||[];state.qppBoard=s.qppBoard||[];state.qppSelectedWeeks=normalizeQppWeekSelection(s.qppSelectedWeeks);state.meetings=s.meetings||{};state.filtersByView={dashboard:cloneFilterState(s.filtersByView?.dashboard),ordens:cloneFilterState(s.filtersByView?.ordens)};state.filters=cloneFilterState(state.filtersByView.dashboard);}}catch{} }

const QPP_BOARD_MODEL=[{"week":1,"hidden":false,"days":[{"name":"Segunda-feira","date":"2025-12-29","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2025-12-30","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quarta-feira","date":"2025-12-31","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"ESPAÇO CONFINADO","notes":""},{"name":"Quinta-feira","date":"2026-01-01","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Sexta-feira","date":"2026-01-02","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"LIMPEZA E ORGANIZAÇÃO","notes":""}]},{"week":2,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-01-05","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2026-01-06","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"Z2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quarta-feira","date":"2026-01-07","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"BP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quinta-feira","date":"2026-01-08","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"E1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Sexta-feira","date":"2026-01-09","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""}]},{"week":3,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-01-12","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPZ1_26","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2026-01-13","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"BP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPZ1_26","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quarta-feira","date":"2026-01-14","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPZ1_26","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quinta-feira","date":"2026-01-15","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"R1/1GPZ1_26","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPZ1_26","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Sexta-feira","date":"2026-01-16","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"1GPZ1_26","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"G1/1GPZ1_26","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""}]},{"week":4,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-01-19","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPZ1_26","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2026-01-20","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"1GPZ1_26","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPZ1_26","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quarta-feira","date":"2026-01-21","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quinta-feira","date":"2026-01-22","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Sexta-feira","date":"2026-01-23","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""}]},{"week":5,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-01-26","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2026-01-27","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPA1_26","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quarta-feira","date":"2026-01-28","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"K1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPA1_26","safetyTheme":"ESPAÇO CONFINADO","notes":""},{"name":"Quinta-feira","date":"2026-01-29","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPA1_26","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Sexta-feira","date":"2026-01-30","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"1GPA1_26","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"1GPA1_26","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""}]},{"week":6,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-02-02","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPA1","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2026-02-03","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"Z1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPA1","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quarta-feira","date":"2026-02-04","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"E1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPA1","safetyTheme":"ESPAÇO CONFINADO","notes":""},{"name":"Quinta-feira","date":"2026-02-05","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"1GPM1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPA2","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Sexta-feira","date":"2026-02-06","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"1GPM1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"1GPA2","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""}]},{"week":7,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-02-09","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPM1","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2026-02-10","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPM1","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quarta-feira","date":"2026-02-11","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"1GPM1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"K1","safetyTheme":"ESPAÇO CONFINADO","notes":""},{"name":"Quinta-feira","date":"2026-02-12","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"1GPM1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"G1","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Sexta-feira","date":"2026-02-13","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""}]},{"week":8,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-02-16","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPZ2","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2026-02-17","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"1GPZ2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPZ2","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quarta-feira","date":"2026-02-18","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"1GPZ2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPZ2","safetyTheme":"ESPAÇO CONFINADO","notes":""},{"name":"Quinta-feira","date":"2026-02-19","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"1GPZ2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPZ2","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Sexta-feira","date":"2026-02-20","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"1GPZ2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"1GPZ2","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""}]},{"week":9,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-02-23","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPZ2","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2026-02-24","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"1GPZ2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPZ2","safetyTheme":"ESPAÇO CONFINADO","notes":""},{"name":"Quarta-feira","date":"2026-02-25","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"BP","sazonalLabel":"ADM","sazonalSchedule":"08:00 - 18:00","sazonalActivity":"E1","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quinta-feira","date":"2026-02-26","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPZ2","safetyTheme":"LIMPEZA E ORGANIZAÇÃO","notes":""},{"name":"Sexta-feira","date":"2026-02-27","admLabel":"ADM","admSchedule":"08:00 - 18:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"LIMPEZA E ORGANIZAÇÃO","notes":""}]},{"week":10,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-03-02","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"ADM","sazonalSchedule":"08:00 - 17:00","sazonalActivity":"BS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2026-03-03","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"K1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Quarta-feira","date":"2026-03-04","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"GRANEL","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"ESPAÇO CONFINADO","notes":""},{"name":"Quinta-feira","date":"2026-03-05","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"Z1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"LIMPEZA E ORGANIZAÇÃO","notes":""},{"name":"Sexta-feira","date":"2026-03-06","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"LIMPEZA E ORGANIZAÇÃO","notes":""}]},{"week":11,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-03-09","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Terça-feira","date":"2026-03-10","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"Z2","sazonalLabel":"ADM","sazonalSchedule":"08:00 - 17:00","sazonalActivity":"BP","safetyTheme":"ESPAÇO CONFINADO","notes":""},{"name":"Quarta-feira","date":"2026-03-11","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"E1","sazonalLabel":"ADM","sazonalSchedule":"08:00 - 17:00","sazonalActivity":"","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quinta-feira","date":"2026-03-12","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"16:00 - 21:00","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"ESPAÇO CONFINADO","notes":""},{"name":"Sexta-feira","date":"2026-03-13","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"IÇAMENTO DE CARGAS","notes":""}]},{"week":12,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-03-16","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"12MC","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2026-03-17","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quarta-feira","date":"2026-03-18","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"ADM","sazonalSchedule":"08:00 - 17:00","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"PROTEÇÃO DE MAQUINAS","notes":""},{"name":"Quinta-feira","date":"2026-03-19","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"NR-35","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Sexta-feira","date":"2026-03-20","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"G1","safetyTheme":"LIMPEZA E ORGANIZAÇÃO","notes":""}]},{"week":13,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-03-23","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2026-03-24","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"MUNCK","notes":""},{"name":"Quarta-feira","date":"2026-03-25","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"PROTEÇÃO DE MAQUINAS","notes":""},{"name":"Quinta-feira","date":"2026-03-26","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"ESPAÇO CONFINADO","notes":""},{"name":"Sexta-feira","date":"2026-03-27","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"PROTEÇÃO DE MAQUINAS","notes":""}]},{"week":14,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-03-30","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS/5S","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS/5S","safetyTheme":"LIMPEZA E ORGANIZAÇÃO","notes":""},{"name":"Terça-feira","date":"2026-03-31","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS/5S","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS/5S","safetyTheme":"LIMPEZA E ORGANIZAÇÃO","notes":""},{"name":"Quarta-feira","date":"2026-04-01","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"GRANEL/5S","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"LIMPEZA E ORGANIZAÇÃO","notes":""},{"name":"Quinta-feira","date":"2026-04-02","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BE/5S","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"LIMPEZA E ORGANIZAÇÃO","notes":""},{"name":"Sexta-feira","date":"2026-04-03","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"FERIADO","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"FERIADO","safetyTheme":"PROTEÇÃO DE MAQUINAS","notes":""}]},{"week":15,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-04-06","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"TREINAMENTO","notes":""},{"name":"Terça-feira","date":"2026-04-07","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1","sazonalLabel":"ADM","sazonalSchedule":"08:00 - 17:00","sazonalActivity":"PRÉ-GP","safetyTheme":"","notes":""},{"name":"Quarta-feira","date":"2026-04-08","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BP","sazonalLabel":"ADM","sazonalSchedule":"08:00 - 17:00","sazonalActivity":"Z2","safetyTheme":"GUINDASTE","notes":""},{"name":"Quinta-feira","date":"2026-04-09","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"PRÉ-GP","sazonalLabel":"ADM","sazonalSchedule":"08:00 - 17:00","sazonalActivity":"G1","safetyTheme":"","notes":""},{"name":"Sexta-feira","date":"2026-04-10","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"PRÉ-GP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"GUINDASTE","notes":""}]},{"week":16,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-04-13","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"PRÉ-GP","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Terça-feira","date":"2026-04-14","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"PRÉ-GP","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Quarta-feira","date":"2026-04-15","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"PRÉ-GP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"PRÉ-GP","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Quinta-feira","date":"2026-04-16","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"1GPW1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPW1","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Sexta-feira","date":"2026-04-17","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"1GPW1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"1GPW1","safetyTheme":"","notes":""}]},{"week":17,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-04-20","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPW1","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Terça-feira","date":"2026-04-21","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"FERIADO","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"FERIADO","safetyTheme":"Dia de Tiradentes","notes":""},{"name":"Quarta-feira","date":"2026-04-22","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPW1","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Quinta-feira","date":"2026-04-23","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"1GPW1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPW1","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Sexta-feira","date":"2026-04-24","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"1GPW1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"1GPW1","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""}]},{"week":18,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-04-27","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPW1","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2026-04-28","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPW1","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quarta-feira","date":"2026-04-29","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPW1","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quinta-feira","date":"2026-04-30","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"1GPW1","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Sexta-feira","date":"2026-05-01","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"1GPW1","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""}]},{"week":19,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-05-04","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"BP","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2026-05-05","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"Z2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Quarta-feira","date":"2026-05-06","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"GRANEL","sazonalLabel":"ADM","sazonalSchedule":"08:00 - 17:00","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Quinta-feira","date":"2026-05-07","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Sexta-feira","date":"2026-05-08","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"LIMPEZA E ORGANIZAÇÃO","notes":""}]},{"week":20,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-05-11","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2026-05-12","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quarta-feira","date":"2026-05-13","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"08:00 - 17:00","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Quinta-feira","date":"2026-05-14","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"Z1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"LIMPEZA E ORGANIZAÇÃO","notes":""},{"name":"Sexta-feira","date":"2026-05-15","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""}]},{"week":21,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-05-18","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Terça-feira","date":"2026-05-19","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quarta-feira","date":"2026-05-20","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"K1","safetyTheme":"","notes":""},{"name":"Quinta-feira","date":"2026-05-21","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"G1","safetyTheme":"","notes":""},{"name":"Sexta-feira","date":"2026-05-22","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""}]},{"week":22,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-05-25","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Terça-feira","date":"2026-05-26","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quarta-feira","date":"2026-05-27","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quinta-feira","date":"2026-05-28","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"E1 / 12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Sexta-feira","date":"2026-05-29","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""}]},{"week":23,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-06-01","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Terça-feira","date":"2026-06-02","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"Z1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quarta-feira","date":"2026-06-03","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"GRANEL","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quinta-feira","date":"2026-06-04","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"K1/BP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Sexta-feira","date":"2026-06-05","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""}]},{"week":24,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-06-08","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2026-06-09","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"E1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Quarta-feira","date":"2026-06-10","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1/12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Quinta-feira","date":"2026-06-11","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"G1","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Sexta-feira","date":"2026-06-12","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""}]},{"week":25,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-06-15","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Terça-feira","date":"2026-06-16","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quarta-feira","date":"2026-06-17","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quinta-feira","date":"2026-06-18","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"Z2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Sexta-feira","date":"2026-06-19","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""}]},{"week":26,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-06-22","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Terça-feira","date":"2026-06-23","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quarta-feira","date":"2026-06-24","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quinta-feira","date":"2026-06-25","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Sexta-feira","date":"2026-06-26","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""}]},{"week":27,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-06-29","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Terça-feira","date":"2026-06-30","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quarta-feira","date":"2026-07-01","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"GRANEL","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quinta-feira","date":"2026-07-02","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Sexta-feira","date":"2026-07-03","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"R1-OPORT.","safetyTheme":"","notes":""}]},{"week":28,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-07-06","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2026-07-07","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quarta-feira","date":"2026-07-08","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"GRANEL","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Quinta-feira","date":"2026-07-09","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"Z1/BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Sexta-feira","date":"2026-07-10","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""}]},{"week":29,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-07-13","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"PROTEÇÃO DE MÁQUINAS","notes":""},{"name":"Terça-feira","date":"2026-07-14","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"Z2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quarta-feira","date":"2026-07-15","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"K1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quinta-feira","date":"2026-07-16","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BP/E1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Sexta-feira","date":"2026-07-17","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"LIMPEZA E ORGANIZAÇÃO","notes":""}]},{"week":30,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-07-20","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2026-07-21","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quarta-feira","date":"2026-07-22","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quinta-feira","date":"2026-07-23","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Sexta-feira","date":"2026-07-24","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""}]},{"week":31,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-07-27","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Terça-feira","date":"2026-07-28","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quarta-feira","date":"2026-07-29","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"G1","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Quinta-feira","date":"2026-07-30","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""},{"name":"Sexta-feira","date":"2026-07-31","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"BLOQUEIO DE ENERGIAS","notes":""}]},{"week":32,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-08-03","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Içamento de carga","notes":""},{"name":"Terça-feira","date":"2026-08-04","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"Z1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Içamento de carga","notes":""},{"name":"Quarta-feira","date":"2026-08-05","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"K1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Içamento de carga","notes":""},{"name":"Quinta-feira","date":"2026-08-06","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"BS","safetyTheme":"Içamento de carga","notes":""},{"name":"Sexta-feira","date":"2026-08-07","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio","notes":""}]},{"week":33,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-08-10","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Terça-feira","date":"2026-08-11","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"E1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quarta-feira","date":"2026-08-12","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quinta-feira","date":"2026-08-13","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Sexta-feira","date":"2026-08-14","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"G1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""}]},{"week":34,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-08-17","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Terça-feira","date":"2026-08-18","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"Z2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quarta-feira","date":"2026-08-19","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quinta-feira","date":"2026-08-20","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Sexta-feira","date":"2026-08-21","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Içamento de carga","notes":""}]},{"week":35,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-08-24","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Terça-feira","date":"2026-08-25","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quarta-feira","date":"2026-08-26","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quinta-feira","date":"2026-08-27","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Sexta-feira","date":"2026-08-28","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""}]},{"week":36,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-08-31","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Terça-feira","date":"2026-09-01","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quarta-feira","date":"2026-09-02","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"GRANEL","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quinta-feira","date":"2026-09-03","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"Z1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Sexta-feira","date":"2026-09-04","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""}]},{"week":37,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-09-07","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"FERIADO","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"FERIADO","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Terça-feira","date":"2026-09-08","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Quarta-feira","date":"2026-09-09","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"12MC","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Quinta-feira","date":"2026-09-10","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"K1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"E1","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Sexta-feira","date":"2026-09-11","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"G1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""}]},{"week":38,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-09-14","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Terça-feira","date":"2026-09-15","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"Z2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Quarta-feira","date":"2026-09-16","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Quinta-feira","date":"2026-09-17","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"","notes":""},{"name":"Sexta-feira","date":"2026-09-18","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""}]},{"week":39,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-09-21","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Terça-feira","date":"2026-09-22","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Quarta-feira","date":"2026-09-23","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Quinta-feira","date":"2026-09-24","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Sexta-feira","date":"2026-09-25","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""}]},{"week":40,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-09-28","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Terça-feira","date":"2026-09-29","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"Z1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Quarta-feira","date":"2026-09-30","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Quinta-feira","date":"2026-10-01","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"K1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Sexta-feira","date":"2026-10-02","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"E1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""}]},{"week":41,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-10-05","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Terça-feira","date":"2026-10-06","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Quarta-feira","date":"2026-10-07","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Quinta-feira","date":"2026-10-08","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Sexta-feira","date":"2026-10-09","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""}]},{"week":42,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-10-12","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Terça-feira","date":"2026-10-13","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"Z2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Quarta-feira","date":"2026-10-14","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Quinta-feira","date":"2026-10-15","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Sexta-feira","date":"2026-10-16","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""}]},{"week":43,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-10-19","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Terça-feira","date":"2026-10-20","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Quarta-feira","date":"2026-10-21","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Quinta-feira","date":"2026-10-22","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Sexta-feira","date":"2026-10-23","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""}]},{"week":44,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-10-26","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Terça-feira","date":"2026-10-27","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Quarta-feira","date":"2026-10-28","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Quinta-feira","date":"2026-10-29","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""},{"name":"Sexta-feira","date":"2026-10-30","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia","notes":""}]},{"week":45,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-11-02","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Terça-feira","date":"2026-11-03","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"Z1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Quarta-feira","date":"2026-11-04","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BP/GRANEL","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Quinta-feira","date":"2026-11-05","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"E1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Sexta-feira","date":"2026-11-06","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""}]},{"week":46,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-11-09","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Terça-feira","date":"2026-11-10","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"K1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Quarta-feira","date":"2026-11-11","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Quinta-feira","date":"2026-11-12","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"G1","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Sexta-feira","date":"2026-11-13","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""}]},{"week":47,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-11-16","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Terça-feira","date":"2026-11-17","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"Z2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Quarta-feira","date":"2026-11-18","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Quinta-feira","date":"2026-11-19","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Sexta-feira","date":"2026-11-20","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""}]},{"week":48,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-11-23","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Terça-feira","date":"2026-11-24","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Quarta-feira","date":"2026-11-25","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Quinta-feira","date":"2026-11-26","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Sexta-feira","date":"2026-11-27","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""}]},{"week":49,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-11-30","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Terça-feira","date":"2026-12-01","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"Z1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Quarta-feira","date":"2026-12-02","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Quinta-feira","date":"2026-12-03","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"E1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Sexta-feira","date":"2026-12-04","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""}]},{"week":50,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-12-07","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Terça-feira","date":"2026-12-08","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Quarta-feira","date":"2026-12-09","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"K1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Quinta-feira","date":"2026-12-10","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Sexta-feira","date":"2026-12-11","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"G1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""}]},{"week":51,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-12-14","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Terça-feira","date":"2026-12-15","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"Z2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Quarta-feira","date":"2026-12-16","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BP","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Quinta-feira","date":"2026-12-17","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"12MC","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Sexta-feira","date":"2026-12-18","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""}]},{"week":52,"hidden":false,"days":[{"name":"Segunda-feira","date":"2026-12-21","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"P2","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Terça-feira","date":"2026-12-22","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"R1","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Quarta-feira","date":"2026-12-23","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"BS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Quinta-feira","date":"2026-12-24","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"ROTINA CÉLULAS","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 22:30","sazonalActivity":"ROTINA CÉLULAS","safetyTheme":"Bloqueio de energia ","notes":""},{"name":"Sexta-feira","date":"2026-12-25","admLabel":"ADM","admSchedule":"08:00 - 17:00","admActivity":"FERIADO","sazonalLabel":"Sazonal","sazonalSchedule":"14:30 - 21:30","sazonalActivity":"FERIADO","safetyTheme":"Bloqueio de energia ","notes":""}]}];

function updateServerSyncStatus(event){
  const detail=event?.detail||{};
  const dot=$('#saveStatus'),text=$('#saveStatusText');
  if(dot){dot.dataset.syncState=detail.state||'local';dot.title=detail.error||detail.text||'';}
  if(text)text.textContent=detail.text||'Cópia local ativa';
  const syncBar=$('#syncBar'),mobileText=$('#mobileSyncText');
  if(syncBar)syncBar.dataset.state=detail.state||'local';
  if(mobileText)mobileText.textContent=detail.text||'Cópia local ativa';
  const startupText=$('#syncStartupText');
  if(startupText&&!$('#syncStartupOverlay')?.hidden&&detail.text)startupText.textContent=detail.text;
}
async function startServerSync(){
  const startupOverlay=$('#syncStartupOverlay');
  if(startupOverlay)startupOverlay.hidden=false;
  if(!window.PSMServerSync){
    updateServerSyncStatus({detail:{state:'error',text:'Sincronização não carregada'}});
    if(startupOverlay)startupOverlay.hidden=true;
    return;
  }
  try{
    await window.PSMServerSync.start({
      getSnapshot:getSharedProjectData,
      onSnapshot:applySharedProjectData,
      getUser:()=>currentAuditUser().username
    });
  }finally{
    if(startupOverlay)startupOverlay.hidden=true;
  }
}

const sampleOrders=[
{ordem:'156494663',descricao:'TEC PRO SUBSTITUIR ITENS DE DESGASTE',oficina:'MM-MEC',grupo:'CLK',area:'05W1',equipamento:'W1X30',criticidade:'20',prioridade:'3',hh:2,custo:6591.4,qpp:'Não',source:'exemplo'},
{ordem:'158946470',descricao:'UTI - REVISÃO SISTEMA DE LIMPEZA',oficina:'MM-MEC',grupo:'CRU',area:'03R1',equipamento:'R1P31',criticidade:'15',prioridade:'4',hh:20,custo:0,qpp:'Sim',source:'exemplo'},
{ordem:'153484903',descricao:'NORMALIZAÇÃO DE FERRAMENTAS ELÉTRICAS',oficina:'ME-ELE',grupo:'AUX',area:'13OE',equipamento:'13OE',criticidade:'1',prioridade:'6',hh:1,custo:233.5,qpp:'Sim',source:'exemplo'},
{ordem:'157147247',descricao:'SUBSTITUIR FREIO MOTOR ELEVADOR',oficina:'ME-ELE',grupo:'CLK',area:'05W1',equipamento:'W1J10M2',criticidade:'25',prioridade:'2',hh:10,custo:4995.52,qpp:'Não',source:'exemplo'},
{ordem:'158430706',descricao:'FABRICAR E INSTALAR PROTEÇÃO',oficina:'MM-MEC',grupo:'CRU',area:'03R1',equipamento:'R1J02',criticidade:'7',prioridade:'+',hh:12,custo:322.15,qpp:'Sim',source:'exemplo'}];
const sampleCapacity=[{oficina:'MM-MEC',area:'03R1',pessoas:7,hhNormal:6.75,hh:47.25},{oficina:'ME-ELE',area:'05W1',pessoas:6,hhNormal:6.75,hh:40.5},{oficina:'ME-ELE',area:'07P2',pessoas:3,hhNormal:6.75,hh:20.25},{oficina:'MM-MEC',area:'02BS',pessoas:8,hhNormal:6.75,hh:54}];

function filterValue(key,order){if(key==='qpp')return qppValue(order);if(key==='tipoOrdem')return orderTypeValue(order);if(key==='obs')return normalize(order.observacoes);if(key==='crit')return normalize(order.criticidade);return normalize(order[key]);}
function orderMatchesFilters(order,excludedKey=''){
  const f=state.filters,searchTerms=parseSearchTerms(f.search);
  if(searchTerms.length){
    const searchable=Object.values(order).map(value=>normalize(value).toLocaleLowerCase('pt-BR')).join(' ');
    if(!searchTerms.some(term=>searchable.includes(term)))return false;
  }
  return ['qpp','tipoOrdem','area','oficina','crit','obs'].every(key=>key===excludedKey||!f[key].length||f[key].includes(filterValue(key,order)));
}
function getFiltered(){return sortRows(state.orders.filter(order=>viewerOrderAllowed(order)&&orderMatchesFilters(order)));}
function sortRows(rows){const {key,direction}=state.sort;if(!key)return rows;const factor=direction==='asc'?1:-1;const numericKeys=new Set(['ordem','criticidade','prioridade','duracao','maoObra','hh','custo']);const qppRank={'Não':0,'Rotina':1,'QPP':2,'PRIOR':3,'EXEC':4,'REPR':5};return [...rows].sort((a,b)=>{let av=key==='qpp'?qppValue(a):key==='tipoOrdem'?orderTypeValue(a):a[key],bv=key==='qpp'?qppValue(b):key==='tipoOrdem'?orderTypeValue(b):b[key];let comparison;if(key==='qpp')comparison=(qppRank[av]??-1)-(qppRank[bv]??-1);else if(numericKeys.has(key)){const an=Number(String(av??'').replace(/[^0-9,.-]/g,'').replace(',','.'));const bn=Number(String(bv??'').replace(/[^0-9,.-]/g,'').replace(',','.'));if(Number.isFinite(an)&&Number.isFinite(bn))comparison=an-bn;else comparison=normalize(av).localeCompare(normalize(bv),'pt-BR',{numeric:true,sensitivity:'base'});}else comparison=normalize(av).localeCompare(normalize(bv),'pt-BR',{numeric:true,sensitivity:'base'});return comparison===0?normalize(a.ordem).localeCompare(normalize(b.ordem),'pt-BR',{numeric:true}):comparison*factor;});}
function setSort(key){if(state.sort.key===key)state.sort.direction=state.sort.direction==='desc'?'asc':'desc';else{state.sort.key=key;state.sort.direction=['descricao','area','oficina','equipamento'].includes(key)?'asc':'desc';}state.page=1;updateSortHeaders();renderTable();}
function updateSortHeaders(){document.querySelectorAll('[data-sort]').forEach(button=>{const active=button.dataset.sort===state.sort.key;button.classList.toggle('active',active);button.setAttribute('aria-sort',active?(state.sort.direction==='asc'?'ascending':'descending'):'none');const icon=button.querySelector('.sort-icon');if(icon)icon.textContent=active?(state.sort.direction==='asc'?'▲':'▼'):'↕';});}
function groupSum(rows,key,value='hh'){return rows.reduce((a,r)=>{const k=normalize(r[key])||'Não informado';a[k]=(a[k]||0)+num(r[value]);return a;},{});}
function uppercaseChartConfig(config){
  if(config?.data?.labels)config.data.labels=config.data.labels.map(label=>upper(label));
  (config?.data?.datasets||[]).forEach(dataset=>{if(dataset.label)dataset.label=upper(dataset.label);});
  return config;
}
function formatChartValue(value,dataset){
  const number=Number(value),label=upper(dataset?.label);
  if(!Number.isFinite(number))return upper(value);
  if(label.includes('CUSTO'))return fmtBRL.format(number);
  if(label.includes('%'))return `${fmtNum.format(number)}%`;
  return fmtNum.format(number);
}
const chartValueLabelsPlugin={
  id:'psmValueLabels',
  afterDatasetsDraw(chartInstance,args,options){
    if(options?.display===false)return;
    const {ctx,chartArea}=chartInstance;
    ctx.save();ctx.font='800 11px Inter, Segoe UI, Arial, sans-serif';ctx.lineWidth=3;ctx.strokeStyle=document.documentElement.classList.contains('light')?'rgba(255,255,255,.9)':'rgba(0,28,60,.92)';ctx.fillStyle=document.documentElement.classList.contains('light')?'#063568':'#fcfeff';
    chartInstance.data.datasets.forEach((dataset,datasetIndex)=>{
      const meta=chartInstance.getDatasetMeta(datasetIndex);if(meta.hidden)return;
      meta.data.forEach((element,index)=>{
        const raw=dataset.data[index],number=Number(raw);if(raw===null||raw===undefined||!Number.isFinite(number)||number===0)return;
        const position=element.tooltipPosition(),type=meta.type||chartInstance.config.type,horizontal=chartInstance.options.indexAxis==='y',circular=['doughnut','pie','polarArea'].includes(type);
        let x=position.x,y=position.y;
        if(circular){ctx.textAlign='center';ctx.textBaseline='middle';}
        else if(horizontal){x=position.x+6;ctx.textAlign='left';ctx.textBaseline='middle';if(x>chartArea.right-4){x=chartArea.right-4;ctx.textAlign='right';}}
        else if(dataset.psmLabelPosition==='inside'){y=Math.min(position.y+26,chartArea.bottom-4);ctx.textAlign='center';ctx.textBaseline='top';}
        else if(dataset.psmLabelPosition==='below'){y=Math.min(position.y+7,chartArea.bottom-4);ctx.textAlign='center';ctx.textBaseline='top';}
        else{y=position.y-5;ctx.textAlign='center';ctx.textBaseline='bottom';if(y<chartArea.top+4){y=position.y+14;ctx.textBaseline='top';}}
        const text=formatChartValue(raw,dataset);ctx.strokeText(text,x,y);ctx.fillText(text,x,y);
      });
    });
    ctx.restore();
  }
};
function destroyChart(name){state.charts[name]?.destroy();}
function chart(name,canvas,config){destroyChart(name);if(!window.Chart||!$(canvas))return;const normalized=uppercaseChartConfig(config);normalized.plugins=[...(normalized.plugins||[]),chartValueLabelsPlugin];state.charts[name]=new Chart($(canvas),normalized);}
function vcTheme(){const css=getComputedStyle(document.documentElement);return{blue:'#004ea2',blue2:'#007fc4',green:'#98ca3d',green2:'#6fae2c',cyan:'#37b7e8',yellow:'#f6b93b',orange:'#ef7d32',white:'#fcfeff',muted:css.getPropertyValue('--muted').trim()||'#b6cce1',grid:'rgba(112,159,199,.18)',palette:['#004ea2','#98ca3d','#37b7e8','#f6b93b','#6fae2c','#007fc4','#ef7d32','#75aadb','#c4df76','#0b609f']};}
function chartOpts(horizontal=false){const c=vcTheme();return{responsive:true,maintainAspectRatio:false,indexAxis:horizontal?'y':'x',layout:{padding:{top:18,right:horizontal?82:18}},plugins:{legend:{labels:{color:c.muted,usePointStyle:true,pointStyle:'circle'}},tooltip:{mode:'index',intersect:false,backgroundColor:'rgba(0,38,80,.96)',titleColor:c.white,bodyColor:c.white,borderColor:c.green,borderWidth:1}},scales:{x:{ticks:{color:c.muted},grid:{color:c.grid},border:{color:c.grid}},y:{ticks:{color:c.muted},grid:{color:c.grid},border:{color:c.grid}}}};}

function render(){
  const view=state.activeView;
  renderLists();
  renderSystematicStatus();
  if($('#capacityDialog')?.open)renderCapacity();
  if(view==='dashboard'){
    renderFilters();renderKPIs();renderCharts();
  }else if(view==='ordens'){
    renderFilters();renderCapacityConsumption();renderTable();
  }else if(view==='historico')renderHistory();
  else if(view==='programacao')renderDailyPlan();
  else if(view==='quadro')renderQppBoard();
  else if(view==='ataFab')renderMeeting('fab');
  else if(view==='ataBrit')renderMeeting('brit');
  else if(view==='promanAtaFabrica')renderMeeting('promanFab');
  else if(view==='promanAtaBritagem')renderMeeting('promanBrit');
  applyAccessModeUI();
}
const multiFilterConfig={
  qpp:{allLabel:'Classificação: Todas',singular:'classificação',plural:'classificações'},
  tipoOrdem:{allLabel:'Todos os tipos',singular:'tipo',plural:'tipos'},
  area:{allLabel:'Todas as áreas',singular:'área',plural:'áreas'},
  oficina:{allLabel:'Todas as oficinas',singular:'oficina',plural:'oficinas'},
  crit:{allLabel:'Todas as criticidades',singular:'criticidade',plural:'criticidades'},
  obs:{allLabel:'Todas as observações',singular:'observação',plural:'observações'}
};
function facetValues(key){
  const qppOrder=['Não','Rotina','QPP','PRIOR','EXEC','REPR'];
  const values=[...new Set(state.orders.filter(order=>viewerOrderAllowed(order)&&orderMatchesFilters(order,key)).map(order=>filterValue(key,order)).filter(Boolean))];
  return values.sort((a,b)=>key==='qpp'?(qppOrder.indexOf(a)-qppOrder.indexOf(b)):String(a).localeCompare(String(b),'pt-BR',{numeric:true}));
}
function renderFilters(){
  const keys=Object.keys(multiFilterConfig),last=keys.includes(state.lastFilterChanged)?state.lastFilterChanged:'',preserveAll=state.lastFilterChanged==='search';
  const ordered=last?[...keys.filter(key=>key!==last),last]:keys;
  ordered.forEach(key=>renderMultiFilter(key,preserveAll||key===last));
  keys.forEach(key=>renderMultiFilter(key,true));
  updateGlobalSearchCount();
  syncActiveFilterBank();
}
function renderMultiFilter(key,preserveSelection=false){const cfg=multiFilterConfig[key];const values=facetValues(key);if(!preserveSelection)state.filters[key]=Array.isArray(state.filters[key])?state.filters[key].filter(v=>values.includes(v)):[];const visibleValues=[...new Set([...values,...state.filters[key]])];$(`#filter${cap(key)}Options`).innerHTML=visibleValues.map(v=>`<label class="multi-option"><input type="checkbox" value="${escapeHtml(v)}" ${state.filters[key].includes(v)?'checked':''}/> <span>${escapeHtml(v)}</span></label>`).join('')||'<div class="multi-option-empty">Nenhuma opção disponível</div>';$(`#filter${cap(key)}All`).checked=!state.filters[key].length;updateMultiFilterLabel(key);}
function cap(value){return value.charAt(0).toUpperCase()+value.slice(1);}
function updateMultiFilterLabel(key){const cfg=multiFilterConfig[key],selected=state.filters[key],button=$(`#filter${cap(key)}Button`);button.textContent=!selected.length?cfg.allLabel:selected.length===1?selected[0]:`${selected.length} ${cfg.plural} selecionadas`;button.title=!selected.length?cfg.allLabel:selected.join(', ');}
function setMultiMenu(key,open){Object.keys(multiFilterConfig).forEach(k=>{const shouldOpen=k===key&&open;$(`#filter${cap(k)}Menu`).hidden=!shouldOpen;$(`#filter${cap(k)}Button`).setAttribute('aria-expanded',String(shouldOpen));$(`#filter${cap(k)}`).classList.toggle('open',shouldOpen);});}
function renderKPIs(){const rows=getFiltered(),qpp=rows.filter(o=>qppValue(o)==='QPP'),hhQpp=qpp.reduce((s,o)=>s+num(o.hh),0),cost=rows.reduce((s,o)=>s+num(o.custo),0);const cap=capacityForFilters();const util=cap?hhQpp/cap*100:0;$('#kpiOrders').textContent=rows.length;$('#kpiQpp').textContent=qpp.length;$('#kpiQppPct').textContent=`${rows.length?Math.round(qpp.length/rows.length*100):0}% do total`;$('#kpiHH').textContent=fmtNum.format(hhQpp);$('#kpiAvailable').textContent=fmtNum.format(cap);$('#kpiBalance').textContent=fmtNum.format(cap-hhQpp);$('#kpiBalance').style.color=cap-hhQpp<0?'var(--danger)':'var(--accent2)';$('#kpiUtilization').textContent=`${fmtNum.format(util)}%`;$('#kpiCost').textContent=fmtBRL.format(cost);$('#kpiAvgCost').textContent=fmtBRL.format(rows.length?cost/rows.length:0);}
function capacityForFilters(){return state.capacity.filter(c=>(!state.filters.area.length||state.filters.area.includes(c.area))&&(!state.filters.oficina.length||state.filters.oficina.includes(c.oficina))).reduce((s,c)=>s+num(c.hh),0);}
function renderCapacityConsumption(){
  const officeSelect=$('#capacityConsumptionOffice'),head=$('#capacityConsumptionHead'),body=$('#capacityConsumptionBody'),costBox=$('#capacityConsumptionCost');
  if(!officeSelect||!head||!body||!costBox)return;
  const qppOrders=state.orders.filter(order=>qppValue(order)==='QPP');
  const costOrders=state.orders.filter(order=>['QPP','Rotina'].includes(qppValue(order)));
  const offices=[...new Set([...state.capacity.map(item=>upper(item.oficina)),...costOrders.map(item=>upper(item.oficina))].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true}));
  if(state.capacityConsumptionOffice&&!offices.includes(state.capacityConsumptionOffice))state.capacityConsumptionOffice='';
  officeSelect.innerHTML=`<option value="">Todas as oficinas</option>${offices.map(office=>`<option value="${escapeHtml(office)}" ${office===state.capacityConsumptionOffice?'selected':''}>${escapeHtml(office)}</option>`).join('')}`;

  const office=state.capacityConsumptionOffice;
  const selectedAreas=state.capacityChartAreas.map(upper);
  const areaAllowed=area=>!selectedAreas.length||selectedAreas.includes(upper(area));
  const capacityRows=state.capacity.filter(item=>(!office||upper(item.oficina)===office)&&areaAllowed(item.area));
  const plannedRows=qppOrders.filter(item=>(!office||upper(item.oficina)===office)&&areaAllowed(item.area));
  // O custo por área é consolidado: não acompanha o filtro de oficina.
  const areaCostRows=costOrders.filter(item=>areaAllowed(item.area));
  // As colunas também permanecem estáveis para permitir comparar o custo global entre oficinas.
  const globalCapacityAreas=state.capacity.filter(item=>areaAllowed(item.area)).map(item=>upper(item.area));
  const globalQppAreas=qppOrders.filter(item=>areaAllowed(item.area)).map(item=>upper(item.area));
  const areas=[...new Set([...globalCapacityAreas,...globalQppAreas,...areaCostRows.map(item=>upper(item.area))].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true}));
  const available=groupSum(capacityRows.map(item=>({...item,area:upper(item.area)})),'area');
  const consumed=groupSum(plannedRows.map(item=>({...item,area:upper(item.area)})),'area');
  const costByArea=groupSum(areaCostRows.map(item=>({...item,area:upper(item.area)})),'area','custo');
  // O custo é sempre consolidado e não acompanha o filtro de oficina/área do miniquadro.
  const totalCost=costOrders.reduce((sum,item)=>sum+num(item.custo),0);
  const visibleAreas=areas.length?areas:['SEM DADOS'];
  const officeTitle=office||'TODAS AS OFICINAS';
  const cells=(values,kind='')=>visibleAreas.map(area=>{
    const value=values[area]||0;
    return`<td class="${kind}">${fmtNum.format(value)}</td>`;
  }).join('');
  const costCells=visibleAreas.map(area=>`<td class="hh-mini-area-cost">${fmtBRL.format(costByArea[area]||0)}</td>`).join('');
  head.innerHTML=`<tr><th class="hh-mini-office" colspan="${visibleAreas.length+1}">${escapeHtml(officeTitle)}</th></tr><tr><th>ÁREA</th>${visibleAreas.map(area=>`<th>${escapeHtml(area)}</th>`).join('')}</tr>`;
  body.innerHTML=`<tr><th>HH DISP</th>${cells(available)}</tr><tr><th>HH QPP</th>${cells(consumed)}</tr><tr><th>SALDO</th>${visibleAreas.map(area=>{const balance=(available[area]||0)-(consumed[area]||0);return`<td class="${balance<0?'hh-mini-negative':'hh-mini-positive'}">${fmtNum.format(balance)}</td>`;}).join('')}</tr><tr class="hh-mini-area-cost-row"><th>CUSTO</th>${costCells}</tr>`;
  costBox.textContent=fmtBRL.format(totalCost);
}
function renderCharts(){const rows=getFiltered(),qpp=rows.filter(o=>qppValue(o)==='QPP'),c=vcTheme();const areaHH=groupSum(qpp,'area'),areaCost=groupSum(rows,'area','custo'),workshopHH=groupSum(qpp,'oficina');const selectedAreas=state.capacityChartAreas.map(upper);const areaAllowed=value=>!selectedAreas.length||selectedAreas.includes(upper(value));const capacityQpp=qpp.filter(order=>areaAllowed(order.area));const capacity=groupSum(state.capacity.filter(item=>areaAllowed(item.area)&&(!state.filters.area.length||state.filters.area.includes(item.area))&&(!state.filters.oficina.length||state.filters.oficina.includes(item.oficina))),'area');const capacityQppByArea=groupSum(capacityQpp,'area');const allAreas=[...new Set([...Object.keys(capacity),...Object.keys(capacityQppByArea)])];const capacityLabel=$('#capacityChartFilterLabel');if(capacityLabel)capacityLabel.textContent=selectedAreas.length?`Áreas: ${selectedAreas.join(', ')}`:'Todas as áreas';
chart('capacity','#capacityChart',{type:'bar',data:{labels:allAreas,datasets:[{label:'HH disponível',data:allAreas.map(a=>capacity[a]||0),backgroundColor:c.blue2,borderColor:c.cyan,borderWidth:1,borderRadius:6},{label:'HH QPP',data:allAreas.map(a=>capacityQppByArea[a]||0),backgroundColor:c.green,borderColor:c.green2,borderWidth:1,borderRadius:6}]},options:chartOpts(false)});
chart('qpp','#qppChart',{type:'doughnut',data:{labels:['QPP','Rotina','Não'],datasets:[{data:[qpp.length,rows.filter(o=>qppValue(o)==='Rotina').length,rows.filter(o=>qppValue(o)==='Não').length],backgroundColor:[c.green,c.blue2,'#7892aa'],borderColor:c.white,borderWidth:2,hoverOffset:8}]},options:{responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{legend:{position:'bottom',labels:{color:c.muted,usePointStyle:true,pointStyle:'circle'}},tooltip:{backgroundColor:'rgba(0,38,80,.96)',borderColor:c.green,borderWidth:1}}}});
const topObj=(obj,n=10)=>Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,n);
let data=topObj(areaHH);chart('area','#areaChart',{type:'bar',data:{labels:data.map(x=>x[0]),datasets:[{label:'HH QPP',data:data.map(x=>x[1]),backgroundColor:data.map((_,i)=>c.palette[i%c.palette.length]),borderRadius:6}]},options:chartOpts(true)});
data=topObj(workshopHH);chart('workshop','#workshopChart',{type:'bar',data:{labels:data.map(x=>x[0]),datasets:[{label:'HH QPP',data:data.map(x=>x[1]),backgroundColor:data.map((_,i)=>c.palette[(i+1)%c.palette.length]),borderRadius:6}]},options:chartOpts(true)});
let top=[...qpp].sort((a,b)=>num(b.hh)-num(a.hh)).slice(0,10);chart('topHH','#topHHChart',{type:'bar',data:{labels:top.map(o=>o.ordem),datasets:[{label:'HH QPP',data:top.map(o=>o.hh),backgroundColor:top.map((_,i)=>i===0?c.green:c.blue2),borderRadius:6}]},options:chartOpts(true)});
top=[...rows].sort((a,b)=>num(b.custo)-num(a.custo)).slice(0,10);chart('topCost','#topCostChart',{type:'bar',data:{labels:top.map(o=>o.ordem),datasets:[{label:'Custo',data:top.map(o=>o.custo),backgroundColor:top.map((_,i)=>i===0?c.green:c.blue),borderRadius:6}]},options:chartOpts(true)});
const sorted=Object.entries(areaCost).sort((a,b)=>b[1]-a[1]);const total=sorted.reduce((s,x)=>s+x[1],0);let acc=0;chart('pareto','#paretoChart',{data:{labels:sorted.map(x=>x[0]),datasets:[{type:'bar',label:'Custo',data:sorted.map(x=>x[1]),yAxisID:'y',backgroundColor:c.blue2,borderRadius:5,psmLabelPosition:'inside'},{type:'line',label:'% acumulado',data:sorted.map(x=>total?((acc+=x[1])/total*100):0),yAxisID:'y1',borderColor:c.green,backgroundColor:c.green,pointBackgroundColor:c.white,pointBorderColor:c.green,borderWidth:3,tension:.25,psmLabelPosition:'below'}]},options:{...chartOpts(false),scales:{x:{ticks:{color:c.muted},grid:{color:c.grid}},y:{beginAtZero:true,ticks:{color:c.muted},grid:{color:c.grid}},y1:{position:'right',min:0,max:100,ticks:{color:c.green,callback:v=>v+'%'},grid:{drawOnChartArea:false}}}}});renderInsights(rows,qpp,capacityForFilters());}
function renderInsights(rows,qpp,cap){const list=[];const areaHH=Object.entries(groupSum(qpp,'area')).sort((a,b)=>b[1]-a[1]);const workshopHH=Object.entries(groupSum(qpp,'oficina')).sort((a,b)=>b[1]-a[1]);const hhQpp=qpp.reduce((s,o)=>s+num(o.hh),0);if(cap&&hhQpp>cap)list.push(`A programação QPP excede a capacidade em ${fmtNum.format(hhQpp-cap)} HH.`);else if(cap)list.push(`A utilização do HH está em ${fmtNum.format(hhQpp/cap*100)}%.`);if(areaHH[0])list.push(`${areaHH[0][0]} concentra ${fmtNum.format(areaHH[0][1])} HH QPP.`);if(workshopHH[0])list.push(`${workshopHH[0][0]} é a oficina com maior carga QPP (${fmtNum.format(workshopHH[0][1])} HH).`);const expensive=[...rows].sort((a,b)=>num(b.custo)-num(a.custo))[0];if(expensive)list.push(`A ordem ${expensive.ordem} tem o maior custo: ${fmtBRL.format(expensive.custo)}.`);if(!list.length)list.push('Importe a planilha para gerar análises automáticas.');$('#insights').innerHTML=list.map(x=>`<li>${escapeHtml(x)}</li>`).join('');}

let qppFillState=null;
function clearQppFillPreview(){
  document.querySelectorAll('#ordersBody tr.qpp-fill-source,#ordersBody tr.qpp-fill-range').forEach(row=>row.classList.remove('qpp-fill-source','qpp-fill-range','qpp-fill-start','qpp-fill-end'));
  document.body.classList.remove('qpp-fill-dragging');
}
function visibleOrderIds(){return[...document.querySelectorAll('#ordersBody tr[data-order-id]')].map(row=>row.dataset.orderId);}
function previewQppFill(targetId){
  if(!qppFillState)return;
  const ids=visibleOrderIds(),sourceIndex=ids.indexOf(qppFillState.sourceId),targetIndex=ids.indexOf(targetId);
  document.querySelectorAll('#ordersBody tr[data-order-id]').forEach(row=>row.classList.remove('qpp-fill-source','qpp-fill-range','qpp-fill-start','qpp-fill-end'));
  if(sourceIndex<0||targetIndex<0)return;
  const start=Math.min(sourceIndex,targetIndex),end=Math.max(sourceIndex,targetIndex);
  ids.slice(start,end+1).forEach(id=>document.querySelector(`#ordersBody tr[data-order-id="${CSS.escape(id)}"]`)?.classList.add('qpp-fill-range'));
  document.querySelector(`#ordersBody tr[data-order-id="${CSS.escape(ids[start])}"]`)?.classList.add('qpp-fill-start');
  document.querySelector(`#ordersBody tr[data-order-id="${CSS.escape(ids[end])}"]`)?.classList.add('qpp-fill-end');
  document.querySelector(`#ordersBody tr[data-order-id="${CSS.escape(qppFillState.sourceId)}"]`)?.classList.add('qpp-fill-source');
  qppFillState.targetId=targetId;
}
function applyQppFill(targetId){
  if(!qppFillState)return;
  const ids=visibleOrderIds(),sourceIndex=ids.indexOf(qppFillState.sourceId),targetIndex=ids.indexOf(targetId);
  if(sourceIndex<0||targetIndex<0){clearQppFillPreview();qppFillState=null;return;}
  const start=Math.min(sourceIndex,targetIndex),end=Math.max(sourceIndex,targetIndex),rangeIds=ids.slice(start,end+1);
  const changed=[];
  rangeIds.forEach(id=>{const order=state.orders.find(item=>item.id===id);if(order&&qppValue(order)!==qppFillState.value){order.qpp=qppFillState.value;changed.push(order);}});
  const value=qppFillState.value;
  clearQppFillPreview();qppFillState=null;
  if(!changed.length){toast('As ordens selecionadas já possuem esta classificação');return;}
  log('Classificação aplicada por arraste',`${changed.length} ordens atualizadas para ${value}.`);
  render();
  toast(`${changed.length} ${changed.length===1?'ordem classificada':'ordens classificadas'} como ${value}`);
}

let observationFillState=null;
function clearObservationFillPreview(){
  document.querySelectorAll('#ordersBody tr.observation-fill-source,#ordersBody tr.observation-fill-range').forEach(row=>row.classList.remove('observation-fill-source','observation-fill-range','observation-fill-start','observation-fill-end'));
  document.body.classList.remove('observation-fill-dragging');
}
function previewObservationFill(targetId){
  if(!observationFillState)return;
  const ids=visibleOrderIds(),sourceIndex=ids.indexOf(observationFillState.sourceId),targetIndex=ids.indexOf(targetId);
  document.querySelectorAll('#ordersBody tr[data-order-id]').forEach(row=>row.classList.remove('observation-fill-source','observation-fill-range','observation-fill-start','observation-fill-end'));
  if(sourceIndex<0||targetIndex<0)return;
  const start=Math.min(sourceIndex,targetIndex),end=Math.max(sourceIndex,targetIndex);
  ids.slice(start,end+1).forEach(id=>document.querySelector(`#ordersBody tr[data-order-id="${CSS.escape(id)}"]`)?.classList.add('observation-fill-range'));
  document.querySelector(`#ordersBody tr[data-order-id="${CSS.escape(ids[start])}"]`)?.classList.add('observation-fill-start');
  document.querySelector(`#ordersBody tr[data-order-id="${CSS.escape(ids[end])}"]`)?.classList.add('observation-fill-end');
  document.querySelector(`#ordersBody tr[data-order-id="${CSS.escape(observationFillState.sourceId)}"]`)?.classList.add('observation-fill-source');
  observationFillState.targetId=targetId;
}
function applyObservationFill(targetId){
  if(!observationFillState)return;
  const ids=visibleOrderIds(),sourceIndex=ids.indexOf(observationFillState.sourceId),targetIndex=ids.indexOf(targetId);
  if(sourceIndex<0||targetIndex<0){clearObservationFillPreview();observationFillState=null;return;}
  const start=Math.min(sourceIndex,targetIndex),end=Math.max(sourceIndex,targetIndex),rangeIds=ids.slice(start,end+1);
  const value=observationFillState.value,changed=[];
  rangeIds.forEach(id=>{const order=state.orders.find(item=>item.id===id);if(order&&normalize(order.observacoes)!==value){order.observacoes=value;changed.push(order);}});
  clearObservationFillPreview();observationFillState=null;
  if(!changed.length){toast('As ordens selecionadas já possuem esta observação');return;}
  log('Observação aplicada por arraste',`${changed.length} ordens atualizadas com a mesma observação.`);
  render();
  toast(`${changed.length} ${changed.length===1?'observação copiada':'observações copiadas'}`);
}
function renderTable(){
  const rows=getFiltered(),pages=Math.max(1,Math.ceil(rows.length/state.pageSize));
  state.page=Math.min(state.page,pages);
  const slice=rows.slice((state.page-1)*state.pageSize,state.page*state.pageSize);
  const viewer=isViewerMode();
  const inlineText=(o,field,value,label)=>viewer?escapeHtml(value):`<span class="order-inline-value" contenteditable="true" data-order-inline-id="${escapeHtml(o.id)}" data-order-inline-field="${field}" data-order-inline-before="${escapeHtml(value)}" role="textbox" aria-label="${label} da ordem ${escapeHtml(o.ordem)}">${escapeHtml(value)}</span>`;
  $('#ordersBody').innerHTML=slice.map((o,index)=>`<tr data-order-id="${o.id}">
    <td class="row-number-cell" aria-label="Linha ${(state.page-1)*state.pageSize+index+1}">${(state.page-1)*state.pageSize+index+1}</td>
    <td>${inlineText(o,'ordem',normalize(o.ordem),'OS')}</td>
    <td title="${escapeHtml(o.descricao)}">${inlineText(o,'descricao',normalize(o.descricao),'Descrição')}</td>
    <td>${inlineText(o,'area',normalize(o.area),'Área')}</td>
    <td>${inlineText(o,'oficina',normalize(o.oficina),'Oficina')}</td>
    <td>${inlineText(o,'equipamento',normalize(o.equipamento),'Equipamento')}</td>
    <td class="orders-labor-cell">${viewer?fmtNum.format(num(o.maoObra)):`<span class="order-inline-value" contenteditable="true" inputmode="numeric" data-order-number-id="${escapeHtml(o.id)}" data-order-number-field="maoObra" data-order-number-before="${num(o.maoObra)}" role="textbox" aria-label="Mão de obra da ordem ${escapeHtml(o.ordem)}">${fmtNum.format(num(o.maoObra))}</span>`}</td>
    <td class="orders-duration-cell">${viewer?fmtNum.format(num(o.duracao)):`<span class="order-inline-value" contenteditable="true" inputmode="decimal" data-order-number-id="${escapeHtml(o.id)}" data-order-number-field="duracao" data-order-number-before="${num(o.duracao)}" role="textbox" aria-label="Duração da ordem ${escapeHtml(o.ordem)}">${fmtNum.format(num(o.duracao))}</span>`}</td>
    <td>${fmtNum.format(o.hh)}</td>
    <td>${viewer?fmtBRL.format(o.custo):`<span class="order-inline-value" contenteditable="true" inputmode="decimal" data-order-number-id="${escapeHtml(o.id)}" data-order-number-field="custo" data-order-number-before="${num(o.custo)}" role="textbox" aria-label="Custo da ordem ${escapeHtml(o.ordem)}">${fmtNum.format(num(o.custo))}</span>`}</td>
    <td class="qpp-fill-cell">${viewer?`<span class="viewer-order-classification is-${qppValue(o)==='QPP'?'qpp':'routine'}">${escapeHtml(qppValue(o))}</span>`:`<div class="qpp-fill-control"><select class="qpp-select" data-qpp-id="${o.id}" aria-label="Classificação da ordem ${escapeHtml(o.ordem)}"><option value="Não" ${qppValue(o)==='Não'?'selected':''}>Não</option><option value="Rotina" ${qppValue(o)==='Rotina'?'selected':''}>Rotina</option><option value="QPP" ${qppValue(o)==='QPP'?'selected':''}>QPP</option><option value="PRIOR" ${qppValue(o)==='PRIOR'?'selected':''}>PRIOR</option><option value="EXEC" ${qppValue(o)==='EXEC'?'selected':''}>EXEC</option><option value="REPR" ${qppValue(o)==='REPR'?'selected':''}>REPR</option></select><span class="qpp-fill-handle" data-qpp-fill-id="${o.id}" role="button" tabindex="0" aria-label="Arrastar classificação da ordem ${escapeHtml(o.ordem)}" title="Arraste para copiar esta classificação"></span></div>`}</td>
    <td class="order-type-column"><span class="order-type-badge ${orderTypeValue(o)==='SISTEMÁTICA'?'is-systematic':'is-non-systematic'}">${escapeHtml(orderTypeValue(o))}</span></td>
    <td class="observation-fill-cell">${viewer?`<span class="viewer-order-observation">${escapeHtml(o.observacoes||'—')}</span>`:`<div class="observation-fill-control"><input class="observation-input" data-observation-id="${o.id}" value="${escapeHtml(o.observacoes||'')}" placeholder="Escreva uma observação..." aria-label="Observação da ordem ${escapeHtml(o.ordem)}"><span class="observation-fill-handle" data-observation-fill-id="${o.id}" role="button" tabindex="0" aria-label="Arrastar observação da ordem ${escapeHtml(o.ordem)}" title="Arraste para copiar esta observação"></span></div>`}</td>
    <td class="order-actions-cell">${viewer?'':`<div class="row-actions"><button data-edit="${o.id}">Editar</button><button data-delete="${o.id}">Excluir</button></div>`}</td>
  </tr>`).join('')||'<tr><td colspan="14">Nenhuma ordem encontrada.</td></tr>';
  $('#pageInfo').textContent=`Página ${state.page} de ${pages} · ${rows.length} registros`;
}
function renderHistory(){$('#historyList').innerHTML=state.history.map(h=>`<div class="history-item"><strong>${escapeHtml(h.action)}</strong><div>${escapeHtml(h.details)}</div><small>${new Date(h.date).toLocaleString('pt-BR')} · Usuário: ${escapeHtml(h.username||'Não identificado')}</small></div>`).join('')||'<p>Nenhuma alteração registrada.</p>';}
function renderLists(){const options=vals=>[...new Set(vals.filter(Boolean))].sort().map(v=>`<option value="${escapeHtml(v)}"></option>`).join('');const sources=[...state.orders,...state.systematicCatalog];$('#areasList').innerHTML=options(sources.map(o=>o.area));$('#oficinasList').innerHTML=options(sources.map(o=>o.oficina));}
function renderSystematicStatus(){
  const total=state.systematicCatalog.length,status=$('#systematicCatalogStatus'),bulk=$('#bulkCatalogStatus');
  const text=total?`${fmtNum.format(total)} sistemáticas disponíveis`:'SISTEMÁTICAS não carregada';
  if(status){status.textContent=text;status.classList.toggle('is-loaded',Boolean(total));status.title=total?`${state.systematicCatalogMeta.fileName||'SISTEMÁTICAS'} · carregada em ${state.systematicCatalogMeta.importedAt?new Date(state.systematicCatalogMeta.importedAt).toLocaleString('pt-BR'):'data não informada'}`:'Carregue o arquivo SISTEMÁTICAS.xlsb para habilitar a inclusão em massa';}
  if(bulk)bulk.textContent=total?`${fmtNum.format(total)} ordens disponíveis no catálogo ${state.systematicCatalogMeta.fileName||'SISTEMÁTICAS'}`:'Catálogo SISTEMÁTICAS não carregado';
}
function escapeHtml(v){return normalize(v).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}

function normalizeCapacityItem(item){
  const pessoas=item.pessoas!==undefined?num(item.pessoas):1;
  const hhNormal=item.hhNormal!==undefined?num(item.hhNormal):num(item.hh);
  return {...item,pessoas,hhNormal,hh:pessoas*hhNormal};
}
function sortedCapacity(){return state.capacity.map(normalizeCapacityItem).sort((a,b)=>normalize(a.area).localeCompare(normalize(b.area))||normalize(a.oficina).localeCompare(normalize(b.oficina)));}
function calculateCapacityPreview(){
  const hh=num($('#cPeople').value)*num($('#cNormalHH').value);
  $('#cHH').value=`${fmtNum.format(hh)} HH`;
  return hh;
}
function resetCapacityForm(){
  $('#capacityForm').reset();$('#cEditIndex').value='';$('#cHH').value='0 HH';
  $('#btnSubmitCapacity').textContent='Adicionar HH';$('#btnCancelCapacityEdit').hidden=true;
  $('#cArea').disabled=false;$('#cOficina').disabled=false;
}
function openCapacityDialog(){resetCapacityForm();renderCapacity();$('#capacityDialog').showModal();}
function renderCapacity(){
  state.capacity=state.capacity.map(normalizeCapacityItem);
  const rows=sortedCapacity();
  const total=rows.reduce((sum,item)=>sum+num(item.hh),0);
  const totalEl=$('#capacityTotal');if(totalEl)totalEl.textContent=`${fmtNum.format(total)} HH`;
  const body=$('#capacityBody');if(!body)return;
  const selectedAreas=state.capacityChartAreas.map(upper);
  body.innerHTML=rows.map((item,index)=>`<tr><td><label class="capacity-area-selector" title="Exibir ou ocultar esta área no gráfico"><input type="checkbox" data-capacity-area="${escapeHtml(upper(item.area))}" ${selectedAreas.includes(upper(item.area))?'checked':''}><span>${escapeHtml(item.area)}</span></label></td><td>${escapeHtml(item.oficina)}</td><td>${fmtNum.format(item.pessoas)}</td><td>${fmtNum.format(item.hhNormal)} h</td><td><strong>${fmtNum.format(item.hh)} HH</strong></td><td><div class="row-actions"><button type="button" data-capacity-edit="${index}">Editar</button><button type="button" class="capacity-delete" data-capacity-delete="${index}">Excluir</button></div></td></tr>`).join('')||'<tr><td colspan="6">Nenhum HH disponível cadastrado.</td></tr>';
}
function submitCapacity(e){
  e.preventDefault();
  const area=normalize($('#cArea').value),oficina=normalize($('#cOficina').value),pessoas=num($('#cPeople').value),hhNormal=num($('#cNormalHH').value),hh=pessoas*hhNormal;
  if(!area||!oficina){toast('Informe a área e a oficina');return;}
  if(pessoas<=0||hhNormal<=0){toast('Informe a quantidade de pessoas e o HH normal');return;}
  const editIndex=$('#cEditIndex').value;
  if(editIndex!==''){
    const target=sortedCapacity()[Number(editIndex)];if(!target)return;
    const original=state.capacity.find(c=>normalize(c.area)===normalize(target.area)&&normalize(c.oficina)===normalize(target.oficina));
    Object.assign(original,{area,oficina,pessoas,hhNormal,hh,source:'manual'});
    log('HH disponível alterado',`${area} · ${oficina}: ${fmtNum.format(pessoas)} pessoa(s) × ${fmtNum.format(hhNormal)} h = ${fmtNum.format(hh)} HH.`);
  }else{
    const existing=state.capacity.find(c=>normalize(c.area)===area&&normalize(c.oficina)===oficina);
    if(existing){toast('Esse registro já existe. Use o botão Editar.');return;}
    state.capacity.push({area,oficina,pessoas,hhNormal,hh,source:'manual'});
    log('HH disponível cadastrado',`${area} · ${oficina}: ${fmtNum.format(pessoas)} pessoa(s) × ${fmtNum.format(hhNormal)} h = ${fmtNum.format(hh)} HH.`);
  }
  save();resetCapacityForm();render();toast('HH disponível atualizado');
}
function editCapacityAt(index){
  const target=sortedCapacity()[index];if(!target)return;
  $('#cEditIndex').value=String(index);$('#cArea').value=target.area;$('#cOficina').value=target.oficina;
  $('#cPeople').value=target.pessoas;$('#cNormalHH').value=target.hhNormal;calculateCapacityPreview();
  $('#btnSubmitCapacity').textContent='Salvar alteração';$('#btnCancelCapacityEdit').hidden=false;
  $('#cArea').focus();
}
function deleteCapacityAt(index){
  const target=sortedCapacity()[index];if(!target)return;
  state.capacity=state.capacity.filter(c=>!(normalize(c.area)===normalize(target.area)&&normalize(c.oficina)===normalize(target.oficina)));
  log('HH disponível excluído',`${target.area} · ${target.oficina} removido.`);save();resetCapacityForm();render();
}

function parsePanelCompSheet(ws){
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:null,raw:true});
  const cleanHeader=v=>normalize(v).replace(/\s+/g,' ').toUpperCase();
  const headerIndex=rows.findIndex(r=>r.some(v=>cleanHeader(v)==='ORDEM')&&r.some(v=>cleanHeader(v)==='TEXTO BREVE'));
  if(headerIndex<0)throw new Error('Não foi possível localizar os cabeçalhos da aba PAINEL COMP.');

  const headers=rows[headerIndex].map(cleanHeader);
  const index=(...names)=>headers.findIndex(h=>names.some(n=>h===cleanHeader(n)));
  const ix={
    statusUsuario:index('Status usuário'),
    statusSistema:index('Status do sistema'),
    ordem:index('Ordem'),
    descricao:index('Texto breve'),
    oficina:index('Centro trab.respons.'),
    grupo:index('Grp.plnj.PM'),
    tipo:index('Tp.atvd.manut.'),
    prioridade:index('Prioridade'),
    criticidade:index('Criticidade','Crit.'),
    abc:index('Código ABC'),
    instalacao:index('Local de instalação'),
    area:index('Localização'),
    dataFim:index('Data-base do fim'),
    duracao:index('Dur. Norm'),
    pessoas:index('Número'),
    custo:index('Valor')
  };

  if(ix.ordem<0||ix.descricao<0)throw new Error('As colunas Ordem e Texto breve não foram encontradas na aba PAINEL COMP.');

  const previousByOrder=new Map(state.orders.map(o=>[normalize(o.ordem),o]));
  return rows.slice(headerIndex+1)
    .filter(r=>normalize(r[ix.ordem]))
    .map(r=>{
      const ordem=normalize(r[ix.ordem]);
      const duracao=num(r[ix.duracao]);
      const maoObra=num(r[ix.pessoas]);
      const previous=previousByOrder.get(ordem);
      return {
        id:previous?.id||uid(),
        tipo:normalize(r[ix.tipo]),
        solicitante:'',
        data:r[ix.dataFim]||'',
        ordem,
        descricao:normalize(r[ix.descricao]),
        oficina:normalize(r[ix.oficina]),
        grupo:normalize(r[ix.grupo]),
        criticidade:previous?.criticidade||normalize(ix.criticidade>=0?r[ix.criticidade]:r[ix.abc]),
        prioridade:normalize(r[ix.prioridade]),
        abc:normalize(r[ix.abc]),
        equipamento:normalize(r[ix.instalacao]),
        area:normalize(r[ix.area]),
        duracao,
        maoObra,
        hh:duracao*maoObra,
        custo:num(r[ix.custo]),
        qpp:previous?qppValue(previous):'Não',
        statusUsuario:normalize(r[ix.statusUsuario]),
         statusSistema:normalize(r[ix.statusSistema]),
         status:[normalize(r[ix.statusUsuario]),normalize(r[ix.statusSistema])].filter(Boolean).join(' · '),
         observacoes:previous?.observacoes||'',
         realizado:previous?isDailyCompleted(previous):false,
         tipoOrdem:previous?orderTypeValue(previous):'NÃO SISTEMÁTICA',
         source:'complementares'
      };
    });
}

async function importWorkbook(file){
  const data=await file.arrayBuffer();
  const wb=XLSX.read(data,{type:'array',cellDates:true});
  const panelName=wb.SheetNames.find(n=>normalize(n).toUpperCase()==='PAINEL COMP');
  if(!panelName)throw new Error('Aba PAINEL COMP não encontrada. Selecione o arquivo COMPLEMENTARES.xlsb.');
  const imported=parsePanelCompSheet(wb.Sheets[panelName]);
  const preserved=state.orders.filter(o=>!['PLANILHA','COMPLEMENTARES'].includes(upper(o.source)));
  const preservedOrders=new Set(preserved.map(o=>normalize(o.ordem)));
  state.orders=[...imported.filter(o=>!preservedOrders.has(normalize(o.ordem))),...preserved];
  state.page=1;
  log('Base COMPLEMENTARES importada',`${imported.length} ordens carregadas da aba PAINEL COMP de ${file.name}. O HH disponível manual foi mantido.`);
  save();
  render();
  toast('PAINEL COMP importado com sucesso');
}

function parseSystematicCatalogSheet(ws){
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:null,raw:true});
  const cleanHeader=v=>normalize(v).replace(/\s+/g,' ').toUpperCase();
  const headerIndex=rows.findIndex(r=>r.some(v=>cleanHeader(v)==='ORDEM')&&r.some(v=>cleanHeader(v)==='TEXTO BREVE')&&r.some(v=>cleanHeader(v)==='DUR. NORMAL'));
  if(headerIndex<0)throw new Error('Não foi possível localizar os cabeçalhos da aba BASE SIST.');
  const headers=rows[headerIndex].map(cleanHeader);
  const index=(...names)=>headers.findIndex(h=>names.some(n=>h===cleanHeader(n)));
  const ix={
    ordem:index('Ordem'),descricao:index('Texto breve'),oficina:index('Centro trab.respons.'),
    grupo:index('Grp.plnj.PM'),tipo:index('Tp.atvd.manut.'),prioridade:index('Prioridade'),
    statusUsuario:index('Status usuário'),statusSistema:index('Status do sistema'),
    equipamento:index('Local de instalação'),area:index('Localização'),abc:index('Código ABC'),
    dataFim:index('Data-base do fim'),duracao:index('Dur. Normal'),pessoas:index('Pessoas'),
    custo:index('Custos totais plan.'),solicitante:index('Solicitante')
  };
  if(ix.ordem<0||ix.descricao<0)throw new Error('As colunas Ordem e Texto breve não foram encontradas na aba BASE SIST.');
  const catalog=new Map();
  rows.slice(headerIndex+1).forEach(row=>{
    const ordem=normalize(row[ix.ordem]);
    if(!ordem)return;
    const duracao=num(row[ix.duracao]),maoObra=num(row[ix.pessoas]);
    catalog.set(ordem,{
      ordem,descricao:normalize(row[ix.descricao]),oficina:upper(row[ix.oficina]),grupo:normalize(row[ix.grupo]),
      tipo:normalize(row[ix.tipo]),solicitante:normalize(row[ix.solicitante]),data:row[ix.dataFim]||'',
      criticidade:normalize(row[ix.abc]),abc:normalize(row[ix.abc]),prioridade:normalize(row[ix.prioridade]),
      equipamento:normalize(row[ix.equipamento]),area:normalize(row[ix.area]),duracao,maoObra,
      hh:duracao*maoObra,custo:num(row[ix.custo]),qpp:'Rotina',
      statusUsuario:normalize(row[ix.statusUsuario]),statusSistema:normalize(row[ix.statusSistema]),
      status:[normalize(row[ix.statusUsuario]),normalize(row[ix.statusSistema])].filter(Boolean).join(' · '),
      observacoes:'',realizado:false,tipoOrdem:'SISTEMÁTICA',source:'sistematica'
    });
  });
  return [...catalog.values()];
}

async function importSystematicWorkbook(file){
  const data=await file.arrayBuffer();
  const wb=XLSX.read(data,{type:'array',cellDates:true});
  const sheetName=wb.SheetNames.find(name=>upper(name)==='BASE SIST');
  if(!sheetName)throw new Error('Aba BASE SIST não encontrada. Selecione o arquivo SISTEMÁTICAS.xlsb.');
  state.systematicCatalog=parseSystematicCatalogSheet(wb.Sheets[sheetName]);
  state.systematicCatalogMeta={fileName:file.name,importedAt:new Date().toISOString(),total:state.systematicCatalog.length};
  const updated=synchronizeSystematicBacklog(state.systematicCatalog);
  log('Catálogo SISTEMÁTICAS carregado',`${state.systematicCatalog.length} ordens disponíveis. ${updated} ordem(ns) sistemática(s) que já estavam no backlog foram atualizadas com a nova base.`);
  render();
  toast(`${state.systematicCatalog.length} disponíveis · ${updated} no backlog atualizada(s)`);
}

function parseBulkOrderNumbers(value){
  const matches=normalize(value).match(/\d{6,}/g)||[];
  return [...new Set(matches.map(normalize).filter(Boolean))];
}
function systematicOrderFromCatalog(item){
  return normalizeOrderRecord({...item,id:uid(),qpp:'Rotina',observacoes:'',realizado:false,tipoOrdem:'SISTEMÁTICA',source:'sistematica'});
}
function mergeSystematicOrder(existing,item){
  return normalizeOrderRecord({
    ...existing,
    ...item,
    id:existing.id||uid(),
    qpp:normalize(existing.qpp)||'Rotina',
    observacoes:existing.observacoes||'',
    realizado:existing.realizado??false,
    tipoOrdem:'SISTEMÁTICA',
    source:'sistematica'
  });
}
function synchronizeSystematicBacklog(catalogItems){
  const catalog=new Map((catalogItems||[]).map(item=>[normalize(item.ordem),item]));
  let updated=0;
  state.orders=state.orders.map(order=>{
    if(orderTypeValue(order)!=='SISTEMÁTICA')return order;
    const item=catalog.get(normalize(order.ordem));
    if(!item)return order;
    updated++;
    return mergeSystematicOrder(order,item);
  });
  return updated;
}
function clearSystematicData(){
  const catalogTotal=state.systematicCatalog.length;
  const backlogIds=new Set(state.orders.filter(order=>orderTypeValue(order)==='SISTEMÁTICA').map(order=>order.id));
  state.systematicCatalog=[];
  state.systematicCatalogMeta={fileName:'',importedAt:'',total:0};
  state.orders=state.orders.filter(order=>!backlogIds.has(order.id));
  state.dailyObservations=Object.fromEntries(Object.entries(state.dailyObservations).filter(([key])=>!backlogIds.has(key.slice(key.lastIndexOf(':')+1))));
  state.page=1;
  return{catalogTotal,backlogTotal:backlogIds.size};
}
function renderBulkOrderResult(result=null){
  const target=$('#bulkOrdersResult');if(!target)return;
  if(!result){target.innerHTML='<p class="bulk-result-empty">Cole as ordens acima para consultar o catálogo SISTEMÁTICAS.</p>';return;}
  const section=(title,className,items,renderer)=>`<section class="bulk-result-section ${className}"><h3>${title} <span>${items.length}</span></h3>${items.length?`<div class="bulk-result-items">${items.map(renderer).join('')}</div>`:'<p>Nenhuma.</p>'}</section>`;
  target.innerHTML=
    section('Adicionadas','is-added',result.added,item=>`<span>${escapeHtml(item.ordem)}</span>`)+
    section('Já estavam no backlog','is-existing',result.existing,item=>`<span>${escapeHtml(item)}</span>`)+
    section('Não encontradas','is-missing',result.missing,item=>`<div class="bulk-missing-item"><strong>${escapeHtml(item)}</strong><button type="button" data-register-missing="${escapeHtml(item)}">Cadastrar manualmente</button></div>`);
}
function processBulkSystematicOrders(){
  if(!state.systematicCatalog.length){renderBulkOrderResult({added:[],existing:[],missing:parseBulkOrderNumbers($('#bulkOrdersInput').value)});toast('Carregue primeiro o arquivo SISTEMÁTICAS.xlsb');return;}
  const requested=parseBulkOrderNumbers($('#bulkOrdersInput').value);
  if(!requested.length){renderBulkOrderResult(null);toast('Informe ao menos um número de ordem');return;}
  const catalog=new Map(state.systematicCatalog.map(item=>[normalize(item.ordem),item]));
  const existingSet=new Set(state.orders.map(item=>normalize(item.ordem)));
  const result={added:[],existing:[],missing:[]};
  requested.forEach(ordem=>{
    if(existingSet.has(ordem)){result.existing.push(ordem);return;}
    const item=catalog.get(ordem);
    if(!item){result.missing.push(ordem);return;}
    const order=systematicOrderFromCatalog(item);
    result.added.push(order);existingSet.add(ordem);
  });
  if(result.added.length){
    state.orders.unshift(...result.added);
    state.page=1;
    log('Ordens sistemáticas adicionadas',`${result.added.length} ordem(ns) incluída(s) no backlog como Rotina.`);
    save();render();
  }
  renderBulkOrderResult(result);
  toast(`${result.added.length} adicionada(s) · ${result.missing.length} não encontrada(s)`);
}

function exportExcel(){
  const rows=getFiltered().map(o=>({
    Ordem:o.ordem,Descrição:o.descricao,Tipo:orderTypeValue(o),Área:o.area,Oficina:o.oficina,
    Equipamento:o.equipamento,Grupo:o.grupo,Duração:num(o.duracao),'Mão de Obra':num(o.maoObra),
    HH:num(o.hh),Custo:num(o.custo),QPP:qppValue(o),Realizado:isDailyCompleted(o)?'Sim':'Não',
    Status:o.status||'',Observações:o.observacoes||'','Origem técnica':o.source
  }));
  const wb=XLSX.utils.book_new(),ws=XLSX.utils.json_to_sheet(rows);
  ws['!cols']=[{wch:13},{wch:48},{wch:19},{wch:10},{wch:13},{wch:28},{wch:12},{wch:12},{wch:15},{wch:10},{wch:14},{wch:12},{wch:12},{wch:24},{wch:36},{wch:18}];
  XLSX.utils.book_append_sheet(wb,ws,'ORDENS');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(state.capacity),'HH DISPONIVEL');
  XLSX.writeFile(wb,`PSM_Analytics_${new Date().toISOString().slice(0,10)}.xlsx`);
  log('Exportação','Base filtrada exportada para Excel com Tipo, Duração, Mão de Obra e status Realizado.');
}

function activityLaborValue(){return Math.max(0,Math.round(num($('#fMO').value)));}
function normalizeActivityLabor(){const labor=activityLaborValue();$('#fMO').value=String(labor);calculateActivityHHPreview();}
function calculateActivityHHPreview(){const hh=num($('#fDuracao').value)*activityLaborValue();$('#fHH').value=`${fmtNum.format(hh)} HH`;return hh;}
function enforceOfficeUppercase(event){const input=event.target;const start=input.selectionStart,end=input.selectionEnd;input.value=upper(input.value);if(start!==null)input.setSelectionRange(start,end);}
function openDialog(order=null,defaults={}){
  $('#activityForm').reset();
  $('#activityId').value=order?.id||'';
  $('#activitySource').value=order?.source||defaults.source||'manual';
  $('#dialogTitle').textContent=order?'Editar atividade':'Nova atividade';
  const data=order||defaults,set=(id,v)=>$(id).value=v??'';
  if(data){
    set('#fOrdem',data.ordem);set('#fDescricao',data.descricao);set('#fArea',data.area);set('#fOficina',upper(data.oficina));
    set('#fEquipamento',data.equipamento);set('#fGrupo',data.grupo);set('#fCriticidade',data.criticidade);set('#fPrioridade',data.prioridade);
    set('#fDuracao',data.duracao??0);set('#fMO',data.maoObra??1);set('#fCusto',data.custo??0);
    set('#fQpp',data.qpp?qppValue(data):'Não');set('#fTipoOrdem',data.tipoOrdem?orderTypeValue(data):'NÃO SISTEMÁTICA');
    set('#fStatus',data.status||'Planejada');set('#fObs',data.observacoes);
  }
  calculateActivityHHPreview();$('#activityDialog').showModal();
}
function submitActivity(e){
  e.preventDefault();
  const id=$('#activityId').value,duracao=num($('#fDuracao').value),maoObra=activityLaborValue();
  const order={
    id:id||uid(),ordem:normalize($('#fOrdem').value),descricao:normalize($('#fDescricao').value),
    area:normalize($('#fArea').value),oficina:upper($('#fOficina').value),equipamento:normalize($('#fEquipamento').value),
    grupo:normalize($('#fGrupo').value),criticidade:normalize($('#fCriticidade').value),prioridade:normalize($('#fPrioridade').value),
    duracao,maoObra,hh:duracao*maoObra,custo:num($('#fCusto').value),qpp:$('#fQpp').value,
    tipoOrdem:$('#fTipoOrdem').value,status:normalize($('#fStatus').value),observacoes:normalize($('#fObs').value),
    source:normalize($('#activitySource').value)||'manual'
  };
  if(id){
    const i=state.orders.findIndex(o=>o.id===id);
    state.orders[i]={...state.orders[i],...order};
    log('Atividade editada',`OS ${order.ordem} atualizada manualmente.`);
  }else{
    state.orders.unshift(order);
    log('Atividade criada',`OS ${order.ordem} adicionada durante a reunião como ${orderTypeValue(order)}.`);
  }
  save();$('#activityDialog').close();render();toast('Atividade salva');
}


function formatIsoDateBR(value){if(!value)return 'Sem data';const [y,m,d]=value.split('-');return `${d}/${m}/${y}`;}
function boardWeekLabel(item){const first=item.days?.[0]?.date,last=item.days?.[4]?.date;return `Semana ${String(item.week).padStart(2,'0')} · ${formatIsoDateBR(first)} a ${formatIsoDateBR(last)}`;}
function ensureQppBoard(){if(!Array.isArray(state.qppBoard)||!state.qppBoard.length)state.qppBoard=JSON.parse(JSON.stringify(QPP_BOARD_MODEL));}
function automaticPlanningWeek(){
  const today=new Date();today.setHours(12,0,0,0);const day=today.getDay()||7;
  const nextMonday=new Date(today);nextMonday.setDate(today.getDate()+(8-day));
  return Math.min(52,getISOWeek(nextMonday));
}
function folded(value){return upper(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function dayMapAreas(day){
  const raw=[day.admActivity,day.sazonalActivity].map(normalize).filter(Boolean);
  return [...new Set(raw.flatMap(value=>value.split(/[\n,;]+/)).flatMap(value=>value.split('/')).map(normalize).filter(Boolean))];
}
function orderMatchesMapArea(order,mapArea){
  const token=folded(mapArea),area=folded(order.area);
  if(!token)return false;
  if(token.includes('ROTINA CELULA'))return qppValue(order)==='Rotina';
  return Boolean(area)&&(area===token||area.includes(token)||token.includes(area));
}
function dailyOrdersForDay(day,eligible){
  const areas=dayMapAreas(day);
  const psmOrders=eligible.filter(order=>areas.some(area=>orderMatchesMapArea(order,area)));
  const promanOrders=window.PSMProMan?.getDailyActivities?.()||[];
  return [...psmOrders,...promanOrders];
}
function renderDailyPromanPlantFilter(){
  const button=$('#dailyPromanPlantFilterButton'),all=$('#dailyPromanPlantFilterAll'),options=$('#dailyPromanPlantFilterOptions');
  if(!button||!all||!options)return;
  const allowed=['britagem','fabrica'];
  state.dailySelectedPromanPlants=[...new Set((state.dailySelectedPromanPlants||[]).filter(value=>allowed.includes(value)))];
  all.checked=!state.dailySelectedPromanPlants.length;
  options.querySelectorAll('input[type=checkbox]').forEach(input=>{input.checked=state.dailySelectedPromanPlants.includes(input.value);});
  button.textContent=!state.dailySelectedPromanPlants.length
    ?'Todas'
    :state.dailySelectedPromanPlants.length===1
      ?state.dailySelectedPromanPlants[0]==='britagem'?'Britagem':'Fábrica'
      :'Britagem e Fábrica';
  button.title=!state.dailySelectedPromanPlants.length?'Todas as unidades PROMAN':button.textContent;
}
function updateDailyOfficeFilter(offices){
  const button=$('#dailyOfficeFilterButton'),all=$('#dailyOfficeFilterAll'),options=$('#dailyOfficeFilterOptions');
  if(!button||!all||!options)return;
  const available=new Set(offices);
  state.dailySelectedOffices=[...new Set((state.dailySelectedOffices||[]).map(upper).filter(office=>available.has(office)))];
  all.checked=!state.dailySelectedOffices.length;
  options.innerHTML=offices.length
    ?offices.map(office=>`<label class="multi-option"><input type="checkbox" value="${escapeHtml(office)}" ${state.dailySelectedOffices.includes(office)?'checked':''}> <span>${escapeHtml(office)}</span></label>`).join('')
    :'<p class="daily-office-empty">Nenhuma oficina disponível</p>';
  button.textContent=!state.dailySelectedOffices.length
    ?'Todas as oficinas'
    :state.dailySelectedOffices.length===1
      ?state.dailySelectedOffices[0]
      :`${state.dailySelectedOffices.length} oficinas selecionadas`;
  button.title=!state.dailySelectedOffices.length?'Todas as oficinas':state.dailySelectedOffices.join(', ');
}
function dailyLaborValue(order){
  const informed=num(order.maoObra);
  if(informed>0)return Math.max(1,Math.round(informed));
  const duration=num(order.duracao),hh=num(order.hh);
  return duration>0&&hh>0?Math.max(1,Math.round(hh/duration)):0;
}
function dailyObservationKey(order,day){
  return `${Number(state.dailySelectedWeek)||0}:${normalize(day?.date)||'sem-data'}:${order.id}`;
}
function dailyOrderCard(order,day){
  const labor=dailyLaborValue(order);
  const laborText=labor?`${labor} ${labor===1?'pessoa':'pessoas'}`:'Não informada';
  const completed=isDailyCompleted(order);
  const observationKey=dailyObservationKey(order,day);
  const dailyObservation=state.dailyObservations[observationKey]||'';
  const promanType=upper(order.promanType);
  const badges=order.isProman
    ?`<span class="daily-badge is-proman">PROMAN</span>${promanType==='SEGURANÇA'?'<span class="daily-badge is-safety">SEGURANÇA</span>':promanType==='OPORTUNIDADE'?'<span class="daily-badge is-opportunity">OPORTUNIDADE</span>':''}`
    :`<span class="daily-badge ${qppValue(order)==='QPP'?'is-qpp':'is-routine'}">${qppValue(order)}</span>`;
  const meta=order.isProman
    ?`${order.area||'PROMAN'} · ${order.equipamento||'Sem TAG'} · ${order.responsavel||'Sem responsável'}`
    :`${order.area||'Sem área'} · ${order.oficina||'Sem oficina'} · ${fmtNum.format(order.hh)} HH`;
  const detail=order.isProman
    ?`<small class="daily-order-labor"><b>Tipo:</b> ${escapeHtml(promanType||'NÃO')}</small>`
    :`<small class="daily-order-labor"><b>Mão de obra:</b> ${escapeHtml(laborText)}</small>`;
  return `<article class="daily-order">
    <div class="daily-order-heading"><strong>${escapeHtml(order.ordem)}</strong><span class="daily-order-controls">${badges}<label class="daily-checkin ${completed?'is-checked':''}" title="${completed?'Remover check-in':'Marcar atividade como realizada'}"><input type="checkbox" data-daily-checkin-id="${escapeHtml(order.id)}" ${order.isProman?`data-proman-record-id="${escapeHtml(order.promanRecordId)}" data-proman-plant="${escapeHtml(order.promanPlant)}" data-proman-os="${escapeHtml(order.ordem)}" data-proman-what="${escapeHtml(order.descricao)}"`:''} ${completed?'checked':''} aria-label="${completed?'Remover check-in da':'Marcar como realizada a'} ordem ${escapeHtml(order.ordem)}"></label></span></div>
    <p>${escapeHtml(order.descricao||'Sem descrição')}</p>
    <small class="daily-order-meta">${escapeHtml(meta)}</small>
    ${detail}
    <label class="daily-observation"><span>Observação do dia</span><textarea rows="2" data-daily-observation-key="${escapeHtml(observationKey)}" data-daily-observation-order-id="${escapeHtml(order.id)}" placeholder="Escreva uma observação..." aria-label="Observação diária da ordem ${escapeHtml(order.ordem)}">${escapeHtml(dailyObservation)}</textarea></label>
  </article>`;
}
function dailyOrderColumn(title,kind,orders,day){
  const emptyText=kind==='done'?'Nenhuma atividade realizada neste dia.':`Nenhuma atividade ${title} neste dia.`;
  return `<section class="daily-order-column is-${kind}">
    <header class="daily-column-title"><strong>${title}</strong><span>${orders.length}</span></header>
    <div class="daily-order-list">${orders.length?orders.map(order=>dailyOrderCard(order,day)).join(''):`<p class="daily-empty">${emptyText}</p>`}</div>
  </section>`;
}
const dailyObservationTimers=new Map();
function persistDailyObservation(target){
  const observationKey=target.dataset.dailyObservationKey;
  if(!observationKey)return;
  const order=state.orders.find(item=>item.id===target.dataset.dailyObservationOrderId);
  const before=String(state.dailyObservations[observationKey]??''),after=String(target.value??'');
  if(before===after)return;
  if(after)state.dailyObservations[observationKey]=after;
  else delete state.dailyObservations[observationKey];
  save();
  if(order)log('Observação diária alterada',`OS ${order.ordem}: observação exclusiva da programação diária atualizada.`);
}
function setDailyTvMode(active){
  document.body.classList.toggle('daily-tv-mode',Boolean(active));
  const button=$('#btnDailyTv');
  if(button)button.setAttribute('aria-pressed',String(Boolean(active)));
}
async function toggleDailyTvMode(){
  const active=document.body.classList.contains('daily-tv-mode');
  if(active){
    setDailyTvMode(false);
    if(document.fullscreenElement){
      try{await document.exitFullscreen();}catch(error){console.warn('Não foi possível sair da tela cheia.',error);}
    }
    return;
  }
  setDailyTvMode(true);
  try{
    if(!document.fullscreenElement)await document.documentElement.requestFullscreen();
  }catch(error){
    console.warn('Tela cheia bloqueada pelo navegador; mantendo o modo TV na janela.',error);
    toast('Modo TV ativado. Use F11 para preencher também a moldura do navegador.');
  }
}
function renderDailyPlan(){
  ensureQppBoard();const select=$('#dailyWeekFilter'),daySelect=$('#dailyDayFilter'),grid=$('#dailyPlanGrid');if(!select||!daySelect||!grid)return;
  const previous=Number(state.dailySelectedWeek)||Number(select.value)||automaticPlanningWeek();
  select.innerHTML=state.qppBoard.map(week=>`<option value="${week.week}">${boardWeekLabel(week)}</option>`).join('');
  select.value=String(state.qppBoard.some(w=>Number(w.week)===previous)?previous:automaticPlanningWeek());
  state.dailySelectedWeek=Number(select.value);
  daySelect.value=state.dailySelectedDay;
  const week=state.qppBoard.find(w=>Number(w.week)===Number(select.value));
  if(!week){grid.innerHTML='<p>Semana não encontrada.</p>';return;}
  const eligible=state.orders.filter(isDailyPlanOrder);
  const indexedDays=week.days.map((day,index)=>({day,index}));
  const visibleDays=state.dailySelectedDay===''?indexedDays:indexedDays.filter(item=>String(item.index)===state.dailySelectedDay);
  renderDailyPromanPlantFilter();
  const selectedPromanPlants=new Set(state.dailySelectedPromanPlants);
  const matchesPromanPlant=order=>!order.isProman||!selectedPromanPlants.size||selectedPromanPlants.has(order.promanPlant);
  const visibleOrders=visibleDays.flatMap(item=>dailyOrdersForDay(item.day,eligible)).filter(matchesPromanPlant);
  const offices=[...new Set(visibleOrders.map(order=>upper(order.oficina)).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true,sensitivity:'base'}));
  updateDailyOfficeFilter(offices);
  const selectedOffices=new Set(state.dailySelectedOffices);
  grid.classList.toggle('single-day',visibleDays.length===1);
  grid.innerHTML=visibleDays.map(({day})=>{
    const areas=dayMapAreas(day);
    const orders=dailyOrdersForDay(day,eligible).filter(matchesPromanPlant).filter(order=>!selectedOffices.size||selectedOffices.has(upper(order.oficina)));
    const qppOrders=orders.filter(order=>qppValue(order)==='QPP'&&!isDailyCompleted(order));
    const routineOrders=orders.filter(order=>qppValue(order)==='Rotina'&&!isDailyCompleted(order));
    const completedOrders=orders.filter(isDailyCompleted);
    return `<article class="daily-day-card"><header><div><strong>${escapeHtml(day.name)}</strong><span>${formatIsoDateBR(day.date)}</span></div><span class="daily-count">${orders.length}</span></header><div class="daily-areas"><b>Área(s)</b>${areas.length?areas.map(area=>`<span>${escapeHtml(area)}</span>`).join(''):'<em>Não informada no mapa</em>'}</div><div class="daily-orders daily-orders-columns">${dailyOrderColumn('QPP','qpp',qppOrders,day)}${dailyOrderColumn('Rotina','routine',routineOrders,day)}${dailyOrderColumn('Realizado','done',completedOrders,day)}</div></article>`;
  }).join('');
}
function normalizeQppWeekSelection(values){
  if(!Array.isArray(values))return[];
  return[...new Set(values.map(Number).filter(week=>Number.isInteger(week)&&week>=1&&week<=52))].sort((a,b)=>a-b);
}
function updateQppWeekFilterLabel(){
  const button=$('#qppWeekFilterButton');if(!button)return;
  const selected=state.qppSelectedWeeks;
  const singleWeek=selected.length===1?state.qppBoard.find(w=>w.week===selected[0]):null;
  button.textContent=!selected.length?'Todas as semanas':singleWeek?boardWeekLabel(singleWeek):`${selected.length} semanas selecionadas`;
  button.title=!selected.length?'Todas as semanas':selected.map(week=>`Semana ${String(week).padStart(2,'0')}`).join(', ');
}
function renderQppWeekFilter(){
  const options=$('#qppWeekOptions'),all=$('#qppWeekAll');if(!options||!all)return;
  state.qppSelectedWeeks=normalizeQppWeekSelection(state.qppSelectedWeeks);
  all.checked=!state.qppSelectedWeeks.length;
  options.innerHTML=state.qppBoard.map(week=>`<label class="qpp-week-option"><input type="checkbox" value="${week.week}" ${state.qppSelectedWeeks.includes(week.week)?'checked':''}> <span>${escapeHtml(boardWeekLabel(week))}${week.hidden?' · oculta':''}</span></label>`).join('');
  updateQppWeekFilterLabel();
}
function visibleQppWeeks(){const selected=state.qppSelectedWeeks;return state.qppBoard.filter(w=>(!selected.length||selected.includes(Number(w.week)))&&(state.qppShowHidden||!w.hidden));}
function formatBoardDate(value){if(!value)return '';const [y,m,d]=value.split('-');const months=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];return `${d}/${months[Number(m)-1]||m}`;}
function qppField(label,key,value,type='text',extra=''){const escaped=escapeHtml(value);if(type==='date')return `<label class="qpp-edit-field qpp-date-field ${extra}"><span>${label}</span><input type="date" data-qpp-field="${key}" value="${escaped}"><b>${formatBoardDate(value)}</b></label>`;return `<label class="qpp-edit-field ${extra}"><span>${label}</span><textarea rows="2" data-qpp-field="${key}">${escaped}</textarea></label>`;}
function qppTextarea(key,value,className=''){
  return `<textarea class="${className}" rows="2" data-qpp-field="${key}">${escapeHtml(value)}</textarea>`;
}
function qppDateInput(key,value){
  return `<label class="qpp-date-cell"><input type="date" data-qpp-field="${key}" value="${escapeHtml(value)}"><b>${formatBoardDate(value)}</b></label>`;
}
function renderQppBoard(){ensureQppBoard();const scroller=$('#qppBoardScroller');if(!scroller)return;renderQppWeekFilter();const rows=visibleQppWeeks();scroller.classList.toggle('multi-week-mode',state.qppSelectedWeeks.length>1);$('#qppBoardSummary').textContent=`${rows.length} semana(s) visível(is) · ${state.qppBoard.filter(w=>w.hidden).length} oculta(s) · ${isViewerMode()?'modo visualização':'salvamento automático'}`;
  scroller.innerHTML=rows.map(week=>`<section class="qpp-week qpp-sheet qpp-font-large" data-week="${week.week}">
    <header class="qpp-sheet-banner"><img class="qpp-logo" src="assets/logo-votorantim-cimentos.png" alt="Votorantim Cimentos"><h3>Quadro de Programação Semanal</h3><button type="button" class="qpp-hide-inline" data-hide-week="${week.week}">${week.hidden?'Reexibir':'Ocultar'}</button></header>
    <div class="qpp-green-line"></div>
    <div class="qpp-map-label"><strong>MAPA</strong><span>52</span></div>
    <div class="qpp-board-grid">
      <aside class="qpp-week-number"><span>${String(week.week).padStart(2,'0')}</span></aside>
      ${week.days.map((day,dayIndex)=>`<article class="qpp-day qpp-standard-day" data-day="${dayIndex}">
        <div class="qpp-day-name">${escapeHtml(day.name)}</div>
        ${qppDateInput('date',day.date)}
        <div class="qpp-shift-labels"><div>${qppTextarea('admLabel',day.admLabel,'qpp-compact-input')}</div><div>${qppTextarea('sazonalLabel',day.sazonalLabel,'qpp-compact-input')}</div></div>
        <div class="qpp-shift-times"><div>${qppTextarea('admSchedule',day.admSchedule,'qpp-compact-input')}</div><div>${qppTextarea('sazonalSchedule',day.sazonalSchedule,'qpp-compact-input')}</div></div>
        <div class="qpp-shift-activities"><div>${qppTextarea('admActivity',day.admActivity,'qpp-activity-input')}</div><div>${qppTextarea('sazonalActivity',day.sazonalActivity,'qpp-activity-input')}</div></div>
        <div class="qpp-day-safety">${qppTextarea('safetyTheme',day.safetyTheme,'qpp-safety-input')}</div>
        <div class="qpp-day-notes">${qppTextarea('notes',day.notes,'qpp-notes-input')}</div>
      </article>`).join('')}
    </div>
  </section>`).join('')||'<div class="qpp-empty">Nenhuma semana visível. Ative “Mostrar ocultas” ou escolha outra semana.</div>';
  enforceViewerControls(scroller);
}
let qppSaveTimer;
function updateQppBoardField(target){if(isViewerMode())return;const weekEl=target.closest('.qpp-week'),dayEl=target.closest('.qpp-day');if(!weekEl||!dayEl)return;const week=state.qppBoard.find(w=>String(w.week)===weekEl.dataset.week);const day=week?.days?.[Number(dayEl.dataset.day)];if(!day)return;day[target.dataset.qppField]=target.value;clearTimeout(qppSaveTimer);qppSaveTimer=setTimeout(()=>{save();$('#saveStatus')?.classList.add('saved-pulse');setTimeout(()=>$('#saveStatus')?.classList.remove('saved-pulse'),500);},350);}
function setQppWeekHidden(weekNumber,hidden){if(isViewerMode())return;const week=state.qppBoard.find(w=>String(w.week)===String(weekNumber));if(!week)return;week.hidden=hidden;save();renderQppBoard();toast(hidden?`Semana ${week.week} ocultada`:`Semana ${week.week} reexibida`);}
function currentVisibleQppWeek(){const scroller=$('#qppBoardScroller');const weeks=[...scroller.querySelectorAll('.qpp-week')];if(!weeks.length)return null;const center=scroller.classList.contains('multi-week-mode')?window.innerHeight/2:scroller.getBoundingClientRect().top+scroller.clientHeight/2;return weeks.reduce((best,el)=>Math.abs((el.getBoundingClientRect().top+el.getBoundingClientRect().height/2)-center)<Math.abs((best.getBoundingClientRect().top+best.getBoundingClientRect().height/2)-center)?el:best,weeks[0]);}
function wireQppBoard(){
  const scroller=$('#qppBoardScroller'),filterButton=$('#qppWeekFilterButton'),filterMenu=$('#qppWeekFilterMenu'),weekOptions=$('#qppWeekOptions');
  if(!scroller)return;
  const closeWeekMenu=()=>{if(filterMenu)filterMenu.hidden=true;if(filterButton)filterButton.setAttribute('aria-expanded','false');};
  const goWeek=step=>{
    let current=state.qppSelectedWeeks.length===1?state.qppSelectedWeeks[0]:(state.qppCurrentWeek||1);
    current=Math.min(52,Math.max(1,current+step));
    state.qppSelectedWeeks=[current];
    state.qppCurrentWeek=current;
    save();renderQppBoard();
  };
  $('#btnPrevQppWeek').onclick=()=>goWeek(-1);
  $('#btnNextQppWeek').onclick=()=>goWeek(1);
  $('#btnPrintQpp').onclick=()=>printDocument('qpp');
  filterButton.onclick=event=>{event.stopPropagation();filterMenu.hidden=!filterMenu.hidden;filterButton.setAttribute('aria-expanded',String(!filterMenu.hidden));};
  filterMenu.onclick=event=>event.stopPropagation();
  $('#qppWeekAll').onchange=event=>{if(!event.target.checked)return;state.qppSelectedWeeks=[];save();renderQppBoard();};
  weekOptions.onchange=event=>{
    if(!event.target.matches('input[type="checkbox"]'))return;
    state.qppSelectedWeeks=normalizeQppWeekSelection([...weekOptions.querySelectorAll('input:checked')].map(input=>input.value));
    if(event.target.checked)state.qppCurrentWeek=Number(event.target.value);
    save();renderQppBoard();
  };
  document.addEventListener('click',closeWeekMenu);
  $('#btnShowHiddenWeeks').onclick=()=>{state.qppShowHidden=!state.qppShowHidden;$('#btnShowHiddenWeeks').textContent=state.qppShowHidden?'Ocultar semanas marcadas':'Mostrar ocultas';save();renderQppBoard();};
  $('#btnHideQppWeek').onclick=()=>{const el=currentVisibleQppWeek();if(!el){toast('Nenhuma semana visível');return;}setQppWeekHidden(el.dataset.week,true);};
  $('#btnResetQppBoard').onclick=()=>{if(confirm('Restaurar o modelo original das 52 semanas? Todas as edições do QUADRO QPP serão perdidas.')){state.qppBoard=JSON.parse(JSON.stringify(QPP_BOARD_MODEL));state.qppBoardFilter='all';state.qppSelectedWeeks=[];state.qppShowHidden=false;save();renderQppBoard();log('QUADRO QPP restaurado','O mapa de 52 semanas voltou ao modelo original.');}};
  scroller.addEventListener('input',event=>{if(event.target.dataset.qppField)updateQppBoardField(event.target);});
  scroller.addEventListener('click',event=>{if(event.target.dataset.hideWeek!==undefined){const week=state.qppBoard.find(item=>String(item.week)===String(event.target.dataset.hideWeek));setQppWeekHidden(event.target.dataset.hideWeek,!week.hidden);}});
  scroller.addEventListener('scroll',()=>{const el=currentVisibleQppWeek();if(el)state.qppCurrentWeek=Number(el.dataset.week);},{passive:true});
}


const MEETING_STATUS_OPTIONS=['OK','NOK','FÉRIAS','ATRASADO','N/A'];
const MEETING_STATUS_CLASS={'OK':'meeting-ok','NOK':'meeting-nok','FÉRIAS':'meeting-vacation','ATRASADO':'meeting-late','N/A':'meeting-na'};
const MEETING_DEVELOPMENT=`- Follow-up das ações da reunião anterior;
- Análise da programação da semana corrente;
- Analisar a necessidade de reprogramação dos serviços atrasados da semana anterior;
- Elaboração da programação da semana seguinte com os recursos disponíveis (S+1);
- Avaliação dos riscos e impactos;
- Ações contingência para cumprimento;`;
const MEETING_MODELS={
fab:{title:'Ata de Reunião de Programação Fábrica',regional:'Votorantim Cimentos  - Unidade Xambioá',responsible:'Carlos Brito',date:'2026-07-16',
mandatory:[['Programador','OK'],['Planejador Forno','N/A'],['Planejador Ensacadeira / Cimento','OK'],['Liderança PCM - Victor','OK'],['Liderança Produção Forno - Antonio Francisco','OK'],['Liderança Produção Ensacadeira - Alexsandro Costa','OK'],['Liderança Produção Cimento - Weles','N/A'],['Liderança Mecânica Preventiva - Gustavo','OK'],['Liderança Elétrica - Adailton','OK'],['Liderança Confiabilidade - Matheus','OK']],
recommended:[['Gerente Manutenção','NOK'],['Gerente Produção','NOK'],['Engenheiro de Confiabilidade','OK'],['Inspetor Seletiva','NOK'],['Inspetor Utilidades','NOK'],['Rotineira Elétrica','NOK'],['Inspetor Preditiva','NOK'],['Inspetor Lubrificação','NOK'],['Rotineira Mecânica','NOK'],['Segurança','NOK']]},
brit:{title:'Ata de Reunião de Programação Britagem',regional:'Votorantim Cimentos  - Unidade Xambioá',responsible:'Carlos Brito',date:'2026-07-16',
mandatory:[['Programador','OK'],['Planejador Britagens','OK'],['Liderança PCM - Victor','OK'],['Liderança Mecânica Preventiva - Gustavo','OK'],['Produção Viter - Eduardo Luiz','OK'],['Mecânica Britagem - Gustavo','OK'],['Liderança Elétrica - Adailton','OK'],['Liderança Produção - Eduardo Luiz','OK'],['Liderança Confiabilidade - Matheus','OK']],
recommended:[['Gerente Manutenção','NOK'],['Gerente Produção','NOK'],['Engenheiro de Confiabilidade','OK'],['Inspetor Seletiva','NOK'],['Inspetor Utilidades','NOK'],['Rotineira Elétrica','NOK'],['Inspetor Preditiva','NOK'],['Inspetor Lubrificação','NOK'],['Rotineira Mecânica','NOK'],['Segurança','NOK']]}
};
MEETING_MODELS.promanFab={...MEETING_MODELS.fab,promanSchema:2,title:'Ata de Reunião PROMAN Fábrica',
mandatory:[['Alexsandro Costa - Supervisor de Produção','OK'],['Antonio Francisco - Supervisor de Produção','OK'],['Adailton Moreira - Técnico Especialista','OK'],['Weles de Almeida - Supervisor de Produção','OK'],['Elton Moreira - Supervisor Eletricista','FÉRIAS'],['Felipe Jonathan - Engenheiro de Confiabilidade','OK'],['Matheus Mendes - Supervisor Confiabilidade','OK'],['Gustavo Fernandes - Supervisor de Manutenção','FÉRIAS'],['Lucas Vinicius - Engenheiro de Processos','FÉRIAS'],['Victor Emmanuel - Supervisor de PCM','FÉRIAS'],['Victoria Vital - Engenheira de Processos','OK']],
recommended:[['Josue Stellari','NOK'],['Fabio Sousa','NOK']]};
MEETING_MODELS.promanBrit={...MEETING_MODELS.brit,promanSchema:2,title:'Ata de Reunião PROMAN Britagem',
mandatory:[['Samuel Felicio - Coordenador de Produção','OK'],['Eduardo Gimenes - Supervisor de Produção','FÉRIAS'],['Matuzzael Silva - Técnico Manutenção','NOK'],['Gustavo Fernandes - Supervisor de Manutenção','FÉRIAS'],['Elton Moreira - Supervisor Eletricista','FÉRIAS'],['Matheus Mendes - Supervisor Confiabilidade','NOK'],['Victor Emmanuel - Supervisor de PCM','FÉRIAS'],['Erasmo Roterdan - Técnico Mantenedor','ATRASADO'],['Alex Costa - Técnico em Mineração','OK'],['Algusto Cesar - Técnico de Manutenção','OK']],
recommended:[['Patrick Silva','NOK'],['Josue Stellari','NOK']]};
const MEETING_TARGETS={fab:'#ataFabContent',brit:'#ataBritContent',promanFab:'#promanAtaFabricaContent',promanBrit:'#promanAtaBritagemContent'};
function blankMeetingRows(count,fields){return Array.from({length:count},()=>Object.fromEntries(fields.map(f=>[f,''])));}
function buildMeetingModel(key){const source=MEETING_MODELS[key],proman=key.startsWith('proman');return {...JSON.parse(JSON.stringify(source)),mandatory:source.mandatory.map(([name,status])=>({name,status})),recommended:source.recommended.map(([name,status])=>({name,status})),development:MEETING_DEVELOPMENT,pendingActions:blankMeetingRows(6,['what','who','when','conclusion','status','comments']),newActions:blankMeetingRows(6,['what','who','when','comments']),risks:blankMeetingRows(5,['description','tag','order','contingency']),...(proman?{promanSchema:2,safetyActions:blankMeetingRows(3,['tag','what','who','when','status','comments']),resolvedActions:blankMeetingRows(3,['tag','what','who','when','status','comments']),promanPendingActions:blankMeetingRows(3,['tag','what','who','when','status','comments'])}:{})};}
function ensureMeetings(){
  if(!state.meetings||typeof state.meetings!=='object')state.meetings={};
  let changed=false;
  Object.keys(MEETING_TARGETS).forEach(key=>{
    const defaults=buildMeetingModel(key);
    if(!state.meetings[key]){state.meetings[key]=defaults;changed=true;return;}
    if(key.startsWith('proman')&&state.meetings[key].promanSchema!==2){
      const current=state.meetings[key];
      state.meetings[key]={...defaults,...current,promanSchema:2,mandatory:defaults.mandatory,recommended:defaults.recommended,safetyActions:Array.isArray(current.safetyActions)?current.safetyActions:defaults.safetyActions,resolvedActions:Array.isArray(current.resolvedActions)?current.resolvedActions:defaults.resolvedActions,promanPendingActions:Array.isArray(current.promanPendingActions)?current.promanPendingActions:defaults.promanPendingActions};
      changed=true;
    }
  });
  if(changed)save();
}
function meetingParticipation(participants){const valid=participants.filter(p=>!['N/A','FÉRIAS'].includes(p.status));const ok=valid.filter(p=>p.status==='OK').length;return valid.length?Math.round(ok/valid.length*100):0;}
function meetingStatusOptions(value){return MEETING_STATUS_OPTIONS.map(v=>`<option value="${v}" ${v===value?'selected':''}>${v}</option>`).join('');}
function meetingParticipantsTable(key,type,title){const rows=state.meetings[key][type],pct=meetingParticipation(rows);return `<section class="meeting-participant-block"><div class="meeting-participant-title"><span>${escapeHtml(title)}</span><strong class="${pct>=100?'pct-good':pct>=50?'pct-warn':'pct-bad'}">${pct}%</strong></div><div class="meeting-participant-head"><span>Participantes</span><span>Visto</span></div><div class="meeting-participant-list">${rows.map((p,i)=>`<div class="meeting-participant-row"><input data-meeting-field="participant-name" data-type="${type}" data-index="${i}" value="${escapeHtml(p.name)}"><select class="meeting-status ${MEETING_STATUS_CLASS[p.status]||''}" data-meeting-field="participant-status" data-type="${type}" data-index="${i}">${meetingStatusOptions(p.status)}</select></div>`).join('')}</div></section>`;}
function meetingEditableTable(kind,headers,fields,rows){return `<div class="meeting-table-wrap"><table class="meeting-edit-table"><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row,i)=>`<tr>${fields.map(field=>`<td>${field==='status'?`<select data-meeting-table="${kind}" data-index="${i}" data-field="${field}"><option value=""></option><option>CONCLUÍDO</option><option>NO PRAZO</option><option>ATRASADO</option><option>CANCELADO</option></select>`:`<textarea data-meeting-table="${kind}" data-index="${i}" data-field="${field}">${escapeHtml(row[field]||'')}</textarea>`}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
const PROMAN_ACTION_STATUS_OPTIONS=['','S','N','CONCLUÍDA','PENDENTE','EM ANDAMENTO'];
function promanActionStatusClass(value){const status=upper(value);if(status==='S'||status==='CONCLUÍDA')return'is-positive';if(status==='N')return'is-negative';if(status==='PENDENTE'||status==='EM ANDAMENTO')return'is-pending';return'';}
function promanActionStatusOptions(value){return PROMAN_ACTION_STATUS_OPTIONS.map(status=>`<option value="${status}" ${status===value?'selected':''}>${status}</option>`).join('');}
function meetingPromanActionCell(kind,row,index,field){const value=row[field]||'',attributes=`data-meeting-table="${kind}" data-index="${index}" data-field="${field}"`;if(field==='status')return`<select class="meeting-action-status ${promanActionStatusClass(value)}" ${attributes}>${promanActionStatusOptions(value)}</select>`;if(field==='when')return`<input type="date" value="${escapeHtml(value)}" ${attributes}>`;if(field==='what'||field==='comments')return`<textarea ${attributes}>${escapeHtml(value)}</textarea>`;return`<input value="${escapeHtml(value)}" ${attributes}>`;}
function meetingPromanActionTable(kind,title,rows){const fields=['tag','what','who','when','status','comments'];return`<section class="meeting-proman-action-block"><div class="meeting-action-heading"><h4>${escapeHtml(title)}</h4><button type="button" data-add-meeting-row="${kind}">＋ ADICIONAR LINHA</button></div><div class="meeting-table-wrap"><table class="meeting-edit-table meeting-proman-action-table"><thead><tr><th>TAG</th><th>O QUE?</th><th>QUEM?</th><th>QUANDO?</th><th>S/N</th><th>COMENTÁRIO</th><th class="meeting-row-action-column">AÇÃO</th></tr></thead><tbody>${rows.map((row,index)=>`<tr>${fields.map(field=>`<td>${meetingPromanActionCell(kind,row,index,field)}</td>`).join('')}<td class="meeting-row-action-column meeting-row-action-cell"><button type="button" class="meeting-row-remove" data-remove-meeting-row="${kind}" data-index="${index}" aria-label="Remover linha ${index+1}" title="Remover esta linha">− REMOVER</button></td></tr>`).join('')}</tbody></table></div></section>`;}
function meetingActionsContent(key,m){if(key.startsWith('proman'))return`<section class="meeting-section meeting-proman-actions">${meetingPromanActionTable('safetyActions','AÇÕES DE SEGURANÇA E MEIO AMBIENTE',m.safetyActions)}${meetingPromanActionTable('resolvedActions','AÇÕES RESOLVIDAS DAS REUNIÕES ANTERIORES',m.resolvedActions)}${meetingPromanActionTable('promanPendingActions','AÇÕES PENDENTES DAS REUNIÕES ANTERIORES',m.promanPendingActions)}</section>`;return`<section class="meeting-section"><h3>GERENCIAMENTO DE AÇÕES E RISCOS</h3><h4>AÇÕES PENDENTES DAS REUNIÕES ANTERIORES</h4>${meetingEditableTable('pendingActions',['O QUE?','QUEM?','QUANDO?','DT. CONCLUSÃO','STATUS','COMENTÁRIOS'],['what','who','when','conclusion','status','comments'],m.pendingActions)}<h4>NOVAS AÇÕES</h4>${meetingEditableTable('newActions',['O QUE?','QUEM?','QUANDO?','COMENTÁRIOS'],['what','who','when','comments'],m.newActions)}<h4>RISCOS E IMPACTOS</h4>${meetingEditableTable('risks',['DESCRIÇÃO RISCO / IMPACTO','TAG','ORDEM','CONTINGÊNCIA'],['description','tag','order','contingency'],m.risks)}</section>`;}
function renderMeeting(key){ensureMeetings();const m=state.meetings[key],target=$(MEETING_TARGETS[key]);if(!target)return;target.innerHTML=`<div class="meeting-sheet" data-meeting="${key}"><header class="meeting-header"><img class="meeting-brand-logo" src="assets/logo-votorantim-cimentos.png" alt="Votorantim Cimentos"><textarea class="meeting-title-input" data-meeting-field="title" rows="2" aria-label="Título da ata">${escapeHtml(m.title)}</textarea><button type="button" class="meeting-print" data-print-meeting="${key}">🖨 Imprimir</button></header><div class="meeting-meta"><label><strong>Regional:</strong><input data-meeting-field="regional" value="${escapeHtml(m.regional)}"></label><label class="meeting-date"><strong>Data de realização:</strong><input type="date" data-meeting-field="date" value="${escapeHtml(m.date)}"></label><label><strong>Responsável:</strong><input data-meeting-field="responsible" value="${escapeHtml(m.responsible)}"></label></div><div class="meeting-participants-grid">${meetingParticipantsTable(key,'mandatory','Percentual de Participação - Obrigatório')}${meetingParticipantsTable(key,'recommended','Percentual de Participação - Recomendado')}</div><section class="meeting-section"><h3>DESENVOLVIMENTO</h3><textarea class="meeting-development" data-meeting-field="development">${escapeHtml(m.development)}</textarea></section>${meetingActionsContent(key,m)}</div>`;target.querySelectorAll('select[data-meeting-table]').forEach(el=>{el.value=m[el.dataset.meetingTable][Number(el.dataset.index)][el.dataset.field]||'';});}
function renderMeetings(){ensureMeetings();Object.keys(MEETING_TARGETS).forEach(renderMeeting);}
let meetingSaveTimer;
function updateMeetingField(target){if(isViewerMode())return;const sheet=target.closest('.meeting-sheet');if(!sheet)return;const key=sheet.dataset.meeting,m=state.meetings[key];if(!m)return;if(target.dataset.meetingField==='participant-name'||target.dataset.meetingField==='participant-status'){const item=m[target.dataset.type][Number(target.dataset.index)];if(target.dataset.meetingField==='participant-name')item.name=target.value;else item.status=target.value;renderMeeting(key);}else if(target.dataset.meetingTable){m[target.dataset.meetingTable][Number(target.dataset.index)][target.dataset.field]=target.value;if(target.dataset.field==='status')renderMeeting(key);}else if(target.dataset.meetingField){m[target.dataset.meetingField]=target.value;}clearTimeout(meetingSaveTimer);meetingSaveTimer=setTimeout(save,250);}
function printDocument(kind){
  document.activeElement?.blur?.();
  document.querySelectorAll('.meeting-title-input').forEach(field=>{field.scrollTop=0;field.scrollLeft=0;});
  delete document.body.dataset.printMeeting;
  delete document.body.dataset.printQpp;
  if(kind==='qpp')document.body.dataset.printQpp='true';else document.body.dataset.printMeeting=kind;
  let fallbackTimer;
  const cleanup=()=>{
    clearTimeout(fallbackTimer);
    delete document.body.dataset.printMeeting;
    delete document.body.dataset.printQpp;
  };
  window.addEventListener('afterprint',cleanup,{once:true});
  fallbackTimer=setTimeout(cleanup,180000);
  requestAnimationFrame(()=>setTimeout(()=>window.print(),80));
}
function wireMeetings(){Object.values(MEETING_TARGETS).forEach(sel=>{const root=$(sel);if(!root)return;root.addEventListener('change',e=>updateMeetingField(e.target));root.addEventListener('input',e=>{if(e.target.matches('input,textarea')&&!e.target.matches('[data-meeting-field="participant-name"]'))updateMeetingField(e.target);});root.addEventListener('click',e=>{const addKind=e.target.dataset.addMeetingRow;if(addKind){if(isViewerMode())return;const sheet=e.target.closest('.meeting-sheet'),key=sheet?.dataset.meeting,meeting=state.meetings?.[key];if(meeting&&Array.isArray(meeting[addKind])){meeting[addKind].push({tag:'',what:'',who:'',when:'',status:'',comments:''});renderMeeting(key);save();toast('Nova linha adicionada à ata');}return;}const removeButton=e.target.closest?.('[data-remove-meeting-row]');if(removeButton){if(isViewerMode())return;const sheet=removeButton.closest('.meeting-sheet'),key=sheet?.dataset.meeting,meeting=state.meetings?.[key],kind=removeButton.dataset.removeMeetingRow,index=Number(removeButton.dataset.index),rows=meeting?.[kind];if(!Array.isArray(rows)||!Number.isInteger(index)||!rows[index])return;const label=rows[index].tag||rows[index].what||`linha ${index+1}`;if(confirm(`Remover ${label} desta ata?`)){rows.splice(index,1);renderMeeting(key);save();toast('Linha removida da ata');}return;}if(e.target.dataset.printMeeting)printDocument(e.target.dataset.printMeeting);});});}

async function emailCompleteReport(){
  const button=$('#btnEmailReport');
  if(!window.PSMReport?.shareByEmail){toast('O módulo de relatório não foi carregado.');return;}
  const originalFilters=cloneFilterState(state.filters);
  const wasLight=document.documentElement.classList.contains('light');
  const selectedWeeks=state.qppSelectedWeeks.length
    ?[...state.qppSelectedWeeks]
    :[state.activeView==='quadro'?Number(currentVisibleQppWeek()?.dataset.week)||automaticPlanningWeek():automaticPlanningWeek()];
  const primaryWeek=selectedWeeks[0]||automaticPlanningWeek();
  const period=`${$('#planningWeek')?.textContent||''} | ${$('#planningPeriod')?.textContent||''}`;
  let result;
  button.disabled=true;
  button.classList.add('is-busy');
  button.textContent='⏳ Gerando PDF...';
  toast('Preparando o relatório completo...');
  try{
    document.body.classList.add('report-capture-mode');
    state.filters=cloneFilterState(state.filtersByView.dashboard);
    document.documentElement.classList.add('light');
    renderKPIs();renderCharts();renderDailyPlan();renderQppBoard();renderMeetings();
    await new Promise(resolve=>setTimeout(resolve,80));
    Object.values(state.charts).forEach(instance=>{
      try{instance.resize();instance.stop();instance.update('none');}catch(error){console.warn('Não foi possível estabilizar um gráfico para o PDF.',error);}
    });
    await new Promise(resolve=>setTimeout(resolve,180));
    result=await window.PSMReport.shareByEmail({weekNumbers:selectedWeeks,primaryWeek,period});
  }catch(error){
    console.error('Falha ao gerar ou compartilhar o relatório:',error);
    if(error?.name!=='AbortError')toast(error?.message||'Não foi possível gerar o relatório.');
  }finally{
    document.body.classList.remove('report-capture-mode');
    state.filters=originalFilters;
    if(!wasLight)document.documentElement.classList.remove('light');
    renderKPIs();
    if(state.activeView==='dashboard')renderCharts();
    renderDailyPlan();renderQppBoard();renderMeetings();
    button.disabled=false;
    button.classList.remove('is-busy');
    button.textContent='✉ Enviar por e-mail';
  }
  if(!result)return;
  if(result.method==='share'){
    log('Relatório compartilhado',`${result.fileName} enviado ao aplicativo escolhido.`);
    toast('Relatório PDF compartilhado');
  }else{
    log('Rascunho de e-mail gerado',`${result.draftName} contém o relatório PDF anexado.`);
    alert(`O navegador baixou o rascunho ${result.draftName}. Abra esse arquivo no Outlook e clique em Enviar. O relatório PDF já está anexado.`);
  }
}

function switchViewContext(view){
  if(!isViewAllowedInCurrentMode(view))return;
  syncActiveFilterBank();
  state.activeView=view;
  document.body.dataset.activeView=view;
  const hasGeneralFilters=view==='dashboard'||view==='ordens';
  const toolbar=$('#generalFilters');
  if(toolbar)toolbar.hidden=!hasGeneralFilters;
  window.PSMProMan?.handleViewChange?.(view);
  const mainTitle=$('#mainPageTitle');
  if(mainTitle&&view==='dashboard')mainTitle.textContent='DASHBOARD PSM';
  if(mainTitle&&view==='ordens')mainTitle.textContent='BACKLOG';
  setMultiMenu('',false);
  if(hasGeneralFilters){
    state.activeFilterView=view;
    state.filters=cloneFilterState(state.filtersByView[view]);
    if(isViewerMode()&&view==='ordens')state.filters.qpp=state.filters.qpp.filter(value=>['Rotina','QPP'].includes(value));
    state.lastFilterChanged='';
    state.page=1;
    const search=$('#globalSearch');
    if(search)search.value=state.filters.search;
  }
  render();
}

function wireRequestedImprovements(){
  const shell=$('.app-shell'),sidebar=$('.sidebar');
  let sidebarPinned=localStorage.getItem('psm-sidebar-pinned')==='true';
  const pinButton=$('#btnPinSidebar');
  const updatePinButton=()=>{
    if(!pinButton)return;
    pinButton.classList.toggle('is-pinned',sidebarPinned);
    pinButton.setAttribute('aria-pressed',String(sidebarPinned));
    pinButton.title=sidebarPinned?'Desafixar barra lateral':'Fixar barra lateral';
  };
  const setSidebarExpanded=expanded=>shell?.classList.toggle('sidebar-expanded',sidebarPinned||expanded);
  pinButton?.addEventListener('click',event=>{
    event.stopPropagation();
    sidebarPinned=!sidebarPinned;
    localStorage.setItem('psm-sidebar-pinned',String(sidebarPinned));
    updatePinButton();
    setSidebarExpanded(sidebarPinned);
    toast(sidebarPinned?'Barra lateral fixada':'Barra lateral liberada');
  });
  updatePinButton();
  setSidebarExpanded(sidebarPinned);
  sidebar?.addEventListener('mouseenter',()=>setSidebarExpanded(true));
  sidebar?.addEventListener('mouseleave',()=>setSidebarExpanded(false));
  sidebar?.addEventListener('focusin',()=>setSidebarExpanded(true));
  sidebar?.addEventListener('focusout',event=>{if(!sidebar.contains(event.relatedTarget))setSidebarExpanded(false);});
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{if(isViewAllowedInCurrentMode(button.dataset.view))switchViewContext(button.dataset.view);}));
  document.addEventListener('change',event=>{const filter=event.target.closest?.('.multi-select')?.dataset.filter;if(filter)state.lastFilterChanged=filter;},true);
  document.addEventListener('input',event=>{if(event.target.id==='globalSearch')state.lastFilterChanged='';},true);
  $('#btnClearFilters')?.addEventListener('click',()=>{state.lastFilterChanged='';},true);
  $('#fOficina')?.addEventListener('input',enforceOfficeUppercase);
  $('#fDuracao')?.addEventListener('input',calculateActivityHHPreview);
  $('#fMO')?.addEventListener('input',calculateActivityHHPreview);
  $('#fMO')?.addEventListener('change',normalizeActivityLabor);
  $('#dailyWeekFilter')?.addEventListener('change',event=>{
    state.dailySelectedWeek=Number(event.target.value)||automaticPlanningWeek();
    save();
    renderDailyPlan();
  });
  $('#dailyDayFilter')?.addEventListener('change',event=>{
    state.dailySelectedDay=event.target.value;
    save();
    renderDailyPlan();
  });
  $('#btnDailyTv')?.addEventListener('click',toggleDailyTvMode);
  $('#btnExitDailyTv')?.addEventListener('click',toggleDailyTvMode);
  document.addEventListener('fullscreenchange',()=>{
    if(!document.fullscreenElement&&document.body.classList.contains('daily-tv-mode'))setDailyTvMode(false);
  });
  $('#dailyPromanPlantFilterButton')?.addEventListener('click',event=>{
    event.stopPropagation();
    const filter=$('#dailyPromanPlantFilter'),menu=$('#dailyPromanPlantFilterMenu'),open=menu.hidden;
    const officeMenu=$('#dailyOfficeFilterMenu'),officeFilter=$('#dailyOfficeFilter'),officeButton=$('#dailyOfficeFilterButton');
    if(officeMenu)officeMenu.hidden=true;
    if(officeFilter)officeFilter.classList.remove('open');
    if(officeButton)officeButton.setAttribute('aria-expanded','false');
    menu.hidden=!open;
    filter.classList.toggle('open',open);
    event.currentTarget.setAttribute('aria-expanded',String(open));
  });
  $('#dailyPromanPlantFilterMenu')?.addEventListener('click',event=>event.stopPropagation());
  $('#dailyPromanPlantFilterAll')?.addEventListener('change',event=>{
    if(!event.target.checked)return;
    state.dailySelectedPromanPlants=[];
    save();
    renderDailyPlan();
    $('#dailyPromanPlantFilterMenu').hidden=false;
    $('#dailyPromanPlantFilter').classList.add('open');
    $('#dailyPromanPlantFilterButton').setAttribute('aria-expanded','true');
  });
  $('#dailyPromanPlantFilterOptions')?.addEventListener('change',event=>{
    if(!event.target.matches('input[type=checkbox]'))return;
    state.dailySelectedPromanPlants=[...$('#dailyPromanPlantFilterOptions').querySelectorAll('input:checked')].map(input=>input.value);
    save();
    renderDailyPlan();
    $('#dailyPromanPlantFilterMenu').hidden=false;
    $('#dailyPromanPlantFilter').classList.add('open');
    $('#dailyPromanPlantFilterButton').setAttribute('aria-expanded','true');
  });
  $('#dailyOfficeFilterButton')?.addEventListener('click',event=>{
    event.stopPropagation();
    const filter=$('#dailyOfficeFilter'),menu=$('#dailyOfficeFilterMenu'),open=menu.hidden;
    const promanMenu=$('#dailyPromanPlantFilterMenu'),promanFilter=$('#dailyPromanPlantFilter'),promanButton=$('#dailyPromanPlantFilterButton');
    if(promanMenu)promanMenu.hidden=true;
    if(promanFilter)promanFilter.classList.remove('open');
    if(promanButton)promanButton.setAttribute('aria-expanded','false');
    menu.hidden=!open;
    filter.classList.toggle('open',open);
    event.currentTarget.setAttribute('aria-expanded',String(open));
  });
  $('#dailyOfficeFilterMenu')?.addEventListener('click',event=>event.stopPropagation());
  $('#dailyOfficeFilterAll')?.addEventListener('change',event=>{
    if(!event.target.checked)return;
    state.dailySelectedOffices=[];
    save();
    renderDailyPlan();
    $('#dailyOfficeFilterMenu').hidden=false;
    $('#dailyOfficeFilter').classList.add('open');
    $('#dailyOfficeFilterButton').setAttribute('aria-expanded','true');
  });
  $('#dailyOfficeFilterOptions')?.addEventListener('change',event=>{
    if(!event.target.matches('input[type=checkbox]'))return;
    state.dailySelectedOffices=[...$('#dailyOfficeFilterOptions').querySelectorAll('input:checked')].map(input=>upper(input.value));
    save();
    renderDailyPlan();
    $('#dailyOfficeFilterMenu').hidden=false;
    $('#dailyOfficeFilter').classList.add('open');
    $('#dailyOfficeFilterButton').setAttribute('aria-expanded','true');
  });
  $('#dailyPlanGrid')?.addEventListener('input',event=>{
    const observationKey=event.target.dataset.dailyObservationKey;
    if(!observationKey)return;
    clearTimeout(dailyObservationTimers.get(observationKey));
    dailyObservationTimers.set(observationKey,setTimeout(()=>{
      dailyObservationTimers.delete(observationKey);
      persistDailyObservation(event.target);
    },600));
  });
  $('#dailyPlanGrid')?.addEventListener('change',event=>{
    const checkinId=event.target.dataset.dailyCheckinId;
    if(checkinId){
      const order=state.orders.find(item=>item.id===checkinId);
      if(!order){
        let changed=false;
        try{changed=window.PSMProMan?.setDailyCompleted?.(checkinId,Boolean(event.target.checked),event.target.dataset.promanRecordId||'',event.target.dataset.promanPlant||'',event.target.dataset.promanOs||'',event.target.dataset.promanWhat||'')===true;}
        catch(error){console.error('Falha ao concluir atividade PROMAN.',error);}
        if(changed){
          log(event.target.checked?'Atividade PROMAN realizada':'Atividade PROMAN reaberta',`${checkinId} ${event.target.checked?'marcada como concluída':'devolvida para o planejamento'}.`);
          renderDailyPlan();
          toast(event.target.checked?'Atividade PROMAN movida para Realizado':'Atividade PROMAN devolvida para Rotina');
        }else{event.target.checked=!event.target.checked;toast('Não foi possível localizar esta atividade na PROMAN.');renderDailyPlan();}
        return;
      }
      order.realizado=Boolean(event.target.checked);
      log(order.realizado?'Check-in realizado':'Check-in removido',`OS ${order.ordem} ${order.realizado?'movida para Realizado':'devolvida para sua coluna de origem'}.`);
      renderDailyPlan();
      toast(order.realizado?'Atividade marcada como realizada':'Atividade devolvida para o planejamento');
      return;
    }
    const observationKey=event.target.dataset.dailyObservationKey;
    if(!observationKey)return;
    clearTimeout(dailyObservationTimers.get(observationKey));
    dailyObservationTimers.delete(observationKey);
    persistDailyObservation(event.target);
  });
  document.addEventListener('click',()=>{
    [
      ['#dailyPromanPlantFilterMenu','#dailyPromanPlantFilter','#dailyPromanPlantFilterButton'],
      ['#dailyOfficeFilterMenu','#dailyOfficeFilter','#dailyOfficeFilterButton']
    ].forEach(([menuSelector,filterSelector,buttonSelector])=>{
      const menu=$(menuSelector),filter=$(filterSelector),button=$(buttonSelector);
      if(menu)menu.hidden=true;
      if(filter)filter.classList.remove('open');
      if(button)button.setAttribute('aria-expanded','false');
    });
  });
  $('#capacityConsumptionOffice')?.addEventListener('change',event=>{
    state.capacityConsumptionOffice=upper(event.target.value);
    save();
    renderCapacityConsumption();
  });
  $('#capacityBody')?.addEventListener('change',event=>{
    const area=event.target.dataset.capacityArea;if(!area)return;
    const selected=new Set(state.capacityChartAreas.map(upper));
    if(event.target.checked)selected.add(upper(area));else selected.delete(upper(area));
    state.capacityChartAreas=[...selected];save();renderCapacity();renderCharts();renderCapacityConsumption();
    toast(state.capacityChartAreas.length?'Áreas do gráfico atualizadas':'O gráfico voltou a exibir todas as áreas');
  });
  window.addEventListener('psm:proman-changed',()=>{if(state.activeView==='programacao')renderDailyPlan();save();});
}

function wire(){
  $('#btnSyncNow')?.addEventListener('click',async event=>{
    const button=event.currentTarget;
    const original=button.textContent;
    button.disabled=true;
    button.textContent='Atualizando…';
    try{
      const result=await window.PSMServerSync?.refresh?.();
      if(!result)throw new Error('Sincronização indisponível.');
      toast(`Dados atualizados · revisão ${result.revision}`);
    }catch(error){
      console.error(error);
      toast('Não foi possível atualizar. Verifique a conexão do celular.');
    }finally{
      button.disabled=false;
      button.textContent=original;
    }
  });
  document.querySelectorAll('[data-sort]').forEach(button=>button.addEventListener('click',()=>setSort(button.dataset.sort)));
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{
    if(!isViewAllowedInCurrentMode(b.dataset.view))return;
    document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));b.classList.add('active');
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));$(`#${b.dataset.view}View`).classList.add('active');
    document.body.dataset.activeView=b.dataset.view;
  }));
  $('#fileInput').addEventListener('change',e=>{const file=e.target.files[0];if(file)importWorkbook(file).catch(err=>{console.error(err);toast(err.message);});e.target.value='';});
  $('#systematicFileInput').addEventListener('change',e=>{const file=e.target.files[0];if(file)importSystematicWorkbook(file).catch(err=>{console.error(err);toast(err.message);});e.target.value='';});
  $('#btnClearSystematics').onclick=()=>{
    const total=state.systematicCatalog.length;
    const backlogTotal=state.orders.filter(order=>orderTypeValue(order)==='SISTEMÁTICA').length;
    if(!total&&!backlogTotal){toast('O banco de SISTEMÁTICAS e o backlog já estão vazios');return;}
    if(confirm(`Tem certeza que deseja apagar ${total} ordem(ns) do catálogo e ${backlogTotal} ordem(ns) sistemática(s) do backlog?`)){
      const removed=clearSystematicData();
      log('Banco de SISTEMÁTICAS limpo',`${removed.catalogTotal} ordens foram removidas do catálogo e ${removed.backlogTotal} ordem(ns) sistemática(s) foram removidas do backlog.`);
      render();renderBulkOrderResult(null);toast(`SISTEMÁTICAS limpas · ${removed.backlogTotal} removida(s) do backlog`);
    }
  };
  $('#btnSaveProject').onclick=exportProject;
  $('#btnPromanBacklogSaveProject').onclick=exportProject;
  $('#btnPromanBacklogOpenProject').onclick=()=>$('#projectFileInput').click();
  $('#btnDailyOpenProject').onclick=()=>$('#projectFileInput').click();
  $('#btnPromanBacklogTheme').onclick=()=>$('#btnTheme').click();
  $('#btnPromanBacklogFullscreen').onclick=()=>$('#btnFullscreen').click();
  $('#projectFileInput').addEventListener('change',e=>{const file=e.target.files[0];if(file)importProject(file).catch(err=>{console.error(err);toast(err.message);});e.target.value='';});
  $('#btnExport').onclick=exportExcel;
  $('#btnEmailReport').onclick=emailCompleteReport;
  ['#btnOpenActivity','#btnOpenActivity2'].forEach(id=>$(id).onclick=()=>openDialog());
  $('#btnOpenBulkOrders').onclick=()=>{renderSystematicStatus();renderBulkOrderResult(null);$('#bulkOrdersDialog').showModal();$('#bulkOrdersInput').focus();};
  $('#btnCloseBulkOrders').onclick=()=>$('#bulkOrdersDialog').close();
  $('#btnClearBulkOrders').onclick=()=>{$('#bulkOrdersInput').value='';renderBulkOrderResult(null);$('#bulkOrdersInput').focus();};
  $('#btnProcessBulkOrders').onclick=processBulkSystematicOrders;
  $('#bulkOrdersResult').onclick=e=>{const ordem=e.target.dataset.registerMissing;if(!ordem)return;$('#bulkOrdersDialog').close();openDialog(null,{ordem,qpp:'Rotina',tipoOrdem:'SISTEMÁTICA',source:'manual-sistematica',status:'Planejada'});};
  $('#btnOpenCapacity').onclick=openCapacityDialog;
  $('#btnCloseCapacity').onclick=$('#btnDoneCapacity').onclick=()=>$('#capacityDialog').close();
  $('#capacityForm').addEventListener('submit',submitCapacity);
  $('#cPeople').addEventListener('input',calculateCapacityPreview);
  $('#cNormalHH').addEventListener('input',calculateCapacityPreview);
  $('#btnCancelCapacityEdit').onclick=resetCapacityForm;
  $('#capacityBody').addEventListener('click',e=>{if(e.target.dataset.capacityEdit!==undefined)editCapacityAt(Number(e.target.dataset.capacityEdit));if(e.target.dataset.capacityDelete!==undefined&&confirm('Excluir este HH disponível?'))deleteCapacityAt(Number(e.target.dataset.capacityDelete));});
  $('#btnClearCapacity').onclick=()=>{if(confirm('Limpar todos os valores de HH disponível?')){state.capacity=[];resetCapacityForm();log('HH disponível limpo','Todos os registros de capacidade foram removidos.');save();render();}};
  $('#btnCloseDialog').onclick=$('#btnCancelDialog').onclick=()=>$('#activityDialog').close();
  $('#activityForm').addEventListener('submit',submitActivity);
  const globalSearch=$('#globalSearch');
  globalSearch.oninput=e=>{
    state.filters.search=e.target.value;
    state.lastFilterChanged='search';
    state.page=1;
    updateGlobalSearchCount();
    scheduleGlobalSearchRender();
  };
  globalSearch.addEventListener('keydown',event=>{
    if(event.key!=='Enter')return;
    event.preventDefault();
    flushGlobalSearchRender();
  });
  globalSearch.addEventListener('paste',event=>{
    const pasted=event.clipboardData?.getData('text')||'';
    const pastedTerms=parseSearchTerms(pasted);
    if(pastedTerms.length<2)return;
    event.preventDefault();
    const start=globalSearch.selectionStart??globalSearch.value.length;
    const end=globalSearch.selectionEnd??start;
    const retained=`${globalSearch.value.slice(0,start)} ${globalSearch.value.slice(end)}`;
    const currentTerms=parseSearchTerms(retained);
    const combined=[...new Set([...currentTerms,...pastedTerms])];
    globalSearch.value=combined.join(', ');
    state.filters.search=globalSearch.value;
    state.lastFilterChanged='search';
    state.page=1;
    updateGlobalSearchCount();
    flushGlobalSearchRender();
    toast(`${combined.length} pesquisas aplicadas`);
  });
  Object.keys(multiFilterConfig).forEach(key=>{
    const suffix=cap(key);
    $(`#filter${suffix}Button`).onclick=e=>{e.stopPropagation();setMultiMenu(key,$(`#filter${suffix}Menu`).hidden);};
    $(`#filter${suffix}Menu`).onclick=e=>e.stopPropagation();
    $(`#filter${suffix}All`).onchange=e=>{if(e.target.checked){state.lastFilterChanged=key;state.filters[key]=[];state.page=1;render();setMultiMenu(key,true);}};
    $(`#filter${suffix}Options`).onchange=e=>{if(!e.target.matches('input[type=checkbox]'))return;state.lastFilterChanged=key;state.filters[key]=[...$(`#filter${suffix}Options`).querySelectorAll('input:checked')].map(input=>input.value);state.page=1;render();setMultiMenu(key,true);};
  });
  document.addEventListener('click',()=>setMultiMenu('',false));
  $('#btnClearFilters').onclick=()=>{
    cancelGlobalSearchRender();
    state.filters=emptyFilterState();
    state.lastFilterChanged='';
    state.capacityConsumptionOffice='';
    state.capacityChartAreas=[];
    $('#globalSearch').value='';
    updateGlobalSearchCount();
    save();
    render();
    toast('Todos os filtros foram limpos');
  };
  $('#ordersBody').onclick=e=>{
    if(isViewerMode())return;
    const edit=e.target.dataset.edit,del=e.target.dataset.delete;
    if(edit)openDialog(state.orders.find(o=>o.id===edit));
    if(del&&confirm('Excluir esta atividade?')){const o=state.orders.find(x=>x.id===del);state.orders=state.orders.filter(x=>x.id!==del);log('Atividade excluída',`OS ${o?.ordem||''} removida.`);save();render();}
  };
  $('#ordersBody').onchange=e=>{
    if(isViewerMode())return;
    const numberId=e.target.dataset.orderNumberId,numberField=e.target.dataset.orderNumberField;
    if(numberId&&['maoObra','duracao','custo'].includes(numberField)){
      const order=state.orders.find(o=>o.id===numberId);if(!order)return;
      const before=num(order[numberField]),after=Math.max(0,num(e.target.value));
      order[numberField]=numberField==='maoObra'?Math.round(after):after;
      if(numberField!=='custo')order.hh=num(order.duracao)*num(order.maoObra);
      const label=numberField==='maoObra'?'Mão de obra':numberField==='duracao'?'Duração':'Custo';
      log(`${label} alterado`,numberField==='custo'?`OS ${order.ordem}: ${fmtBRL.format(before)} → ${fmtBRL.format(order.custo)}.`:`OS ${order.ordem}: ${fmtNum.format(before)} → ${fmtNum.format(order[numberField])}. HH recalculado para ${fmtNum.format(order.hh)}.`);
      save();render();toast(`${label} atualizado`);return;
    }
    const qppId=e.target.dataset.qppId,observationId=e.target.dataset.observationId;
    if(qppId){const order=state.orders.find(o=>o.id===qppId);if(!order)return;const before=qppValue(order);order.qpp=e.target.value;log('Classificação alterada',`OS ${order.ordem}: ${before} → ${order.qpp}.`);save();render();toast('Classificação atualizada');return;}
    if(observationId){const order=state.orders.find(o=>o.id===observationId);if(!order)return;const before=normalize(order.observacoes);order.observacoes=normalize(e.target.value);log('Observação alterada',`OS ${order.ordem}: ${before||'sem observação'} → ${order.observacoes||'sem observação'}.`);save();renderFilters();toast('Observação salva');}
  };
  $('#ordersBody').addEventListener('focusout',e=>{
    if(isViewerMode())return;
    const target=e.target.closest?.('[data-order-number-id][contenteditable="true"]');if(!target)return;
    const order=state.orders.find(o=>o.id===target.dataset.orderNumberId),field=target.dataset.orderNumberField;if(!order||!['maoObra','duracao','custo'].includes(field))return;
    const before=num(target.dataset.orderNumberBefore),after=Math.max(0,num(target.textContent));
    order[field]=field==='maoObra'?Math.round(after):after;if(field!=='custo')order.hh=num(order.duracao)*num(order.maoObra);
    const label=field==='maoObra'?'Mão de obra':field==='duracao'?'Duração':'Custo';
    if(before!==order[field])log(`${label} alterado`,field==='custo'?`OS ${order.ordem}: ${fmtBRL.format(before)} → ${fmtBRL.format(order.custo)}.`:`OS ${order.ordem}: ${fmtNum.format(before)} → ${fmtNum.format(order[field])}. HH recalculado para ${fmtNum.format(order.hh)}.`);
    save();render();if(before!==order[field])toast(`${label} atualizado`);
  });
  $('#ordersBody').addEventListener('focusout',e=>{
    if(isViewerMode())return;
    const target=e.target.closest?.('[data-order-inline-id][contenteditable="true"]');if(!target)return;
    const order=state.orders.find(o=>o.id===target.dataset.orderInlineId),field=target.dataset.orderInlineField;if(!order||!['ordem','descricao','area','oficina','equipamento'].includes(field))return;
    const before=normalize(target.dataset.orderInlineBefore),after=normalize(target.textContent);
    if(!after&&['ordem','descricao'].includes(field)){target.textContent=before;toast('Este campo não pode ficar vazio');return;}
    order[field]=after;if(before!==after)log('Dados da ordem alterados',`OS ${field==='ordem'?after:order.ordem}: ${field} alterado de ${before||'vazio'} para ${after||'vazio'}.`);
    save();render();if(before!==after)toast('Ordem atualizada');
  });
  $('#ordersBody').addEventListener('keydown',e=>{
    if(!e.target.matches?.('[contenteditable="true"][data-order-number-id],[contenteditable="true"][data-order-inline-id]'))return;
    if(e.key==='Enter'){e.preventDefault();e.target.blur();}
    if(e.key==='Escape'){e.preventDefault();e.target.textContent=e.target.dataset.orderNumberId?fmtNum.format(num(e.target.dataset.orderNumberBefore)):e.target.dataset.orderInlineBefore;e.target.blur();}
  });
  $('#ordersBody').addEventListener('pointerdown',event=>{
    if(isViewerMode())return;
    const handle=event.target.closest?.('[data-qpp-fill-id]');if(!handle||event.button!==0)return;
    const order=state.orders.find(item=>item.id===handle.dataset.qppFillId);if(!order)return;
    event.preventDefault();
    qppFillState={sourceId:order.id,targetId:order.id,value:qppValue(order),pointerId:event.pointerId};
    document.body.classList.add('qpp-fill-dragging');previewQppFill(order.id);
  });
  document.addEventListener('pointermove',event=>{
    if(!qppFillState||event.pointerId!==qppFillState.pointerId)return;
    event.preventDefault();
    const row=document.elementFromPoint(event.clientX,event.clientY)?.closest?.('#ordersBody tr[data-order-id]');
    if(row)previewQppFill(row.dataset.orderId);
    const wrap=$('#ordersBody').closest('.table-wrap'),bounds=wrap?.getBoundingClientRect();
    if(bounds&&event.clientY>bounds.bottom-34)wrap.scrollTop+=18;else if(bounds&&event.clientY<bounds.top+34)wrap.scrollTop-=18;
  },{passive:false});
  document.addEventListener('pointerup',event=>{
    if(!qppFillState||event.pointerId!==qppFillState.pointerId)return;
    const row=document.elementFromPoint(event.clientX,event.clientY)?.closest?.('#ordersBody tr[data-order-id]');
    applyQppFill(row?.dataset.orderId||qppFillState.targetId);
  });
  document.addEventListener('pointercancel',event=>{
    if(!qppFillState||event.pointerId!==qppFillState.pointerId)return;
    clearQppFillPreview();qppFillState=null;
  });
  $('#ordersBody').addEventListener('pointerdown',event=>{
    if(isViewerMode())return;
    const handle=event.target.closest?.('[data-observation-fill-id]');if(!handle||event.button!==0)return;
    const order=state.orders.find(item=>item.id===handle.dataset.observationFillId);if(!order)return;
    const sourceInput=handle.closest('.observation-fill-control')?.querySelector('.observation-input');
    event.preventDefault();
    observationFillState={sourceId:order.id,targetId:order.id,value:normalize(sourceInput?.value),pointerId:event.pointerId};
    document.body.classList.add('observation-fill-dragging');previewObservationFill(order.id);
  });
  document.addEventListener('pointermove',event=>{
    if(!observationFillState||event.pointerId!==observationFillState.pointerId)return;
    event.preventDefault();
    const row=document.elementFromPoint(event.clientX,event.clientY)?.closest?.('#ordersBody tr[data-order-id]');
    if(row)previewObservationFill(row.dataset.orderId);
    const wrap=$('#ordersBody').closest('.table-wrap'),bounds=wrap?.getBoundingClientRect();
    if(bounds&&event.clientY>bounds.bottom-34)wrap.scrollTop+=18;else if(bounds&&event.clientY<bounds.top+34)wrap.scrollTop-=18;
  },{passive:false});
  document.addEventListener('pointerup',event=>{
    if(!observationFillState||event.pointerId!==observationFillState.pointerId)return;
    const row=document.elementFromPoint(event.clientX,event.clientY)?.closest?.('#ordersBody tr[data-order-id]');
    applyObservationFill(row?.dataset.orderId||observationFillState.targetId);
  });
  document.addEventListener('pointercancel',event=>{
    if(!observationFillState||event.pointerId!==observationFillState.pointerId)return;
    clearObservationFillPreview();observationFillState=null;
  });
  $('#prevPage').onclick=()=>{state.page=Math.max(1,state.page-1);renderTable();};
  $('#nextPage').onclick=()=>{state.page++;renderTable();};
  $('#btnClearOrders').onclick=()=>{
    if(!state.orders.length){toast('O banco de ordens já está vazio');return;}
    const total=state.orders.length;
    if(confirm(`Tem certeza que deseja apagar todas as ${total} ordens? Esta ação não apaga o catálogo SISTEMÁTICAS, HH disponível, Quadro QPP nem atas.`)){
      state.orders=[];state.dailyObservations={};state.page=1;state.filters=emptyFilterState();$('#globalSearch').value='';
      log('Banco de ordens limpo',`${total} ordens foram removidas. O catálogo SISTEMÁTICAS foi preservado.`);
      save();render();toast('Banco de ordens limpo');
    }
  };
  $('#btnClearHistory').onclick=()=>{$('#clearHistoryForm')?.reset();setAccessMessage('#clearHistoryError');$('#clearHistoryDialog')?.showModal();};
  $('#btnTheme').onclick=()=>{document.documentElement.classList.toggle('light');localStorage.setItem('psm-theme',document.documentElement.classList.contains('light')?'light':'dark');renderCharts();window.PSMProMan?.render?.();};
  $('#btnFullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();
  wireQppBoard();wireMeetings();
}

function initializeApp(){
  window.addEventListener('psm:sync-status',updateServerSyncStatus);
  updatePlanningWeek();
  load();
  ensureQppBoard();
  ensureMeetings();
  if(!state.orders.length){
    state.orders=sampleOrders.map(o=>normalizeOrderRecord({...o,id:uid()}));
    state.capacity=sampleCapacity;
    log('Dados de demonstração','Amostra inicial carregada. Importe sua planilha para substituir a base.');
  }
  if(localStorage.getItem('psm-theme')==='light')document.documentElement.classList.add('light');
  wire();
  wireRequestedImprovements();
  wireAccessModes();
  render();
  // Inicializa a barra geral e o conjunto de filtros exclusivos do Dashboard.
  switchViewContext('dashboard');
  startServerSync().catch(error=>{
    console.error(error);
    updateServerSyncStatus({detail:{state:'error',text:'Servidor indisponível — usando cópia local',error:error?.message}});
  });
}
initializeApp();
