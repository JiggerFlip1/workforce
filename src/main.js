import './style.css'
import './auth.css'
import { supabase, isCloudConfigured } from './lib/supabase.js'

const defaultEmployees = [
  { name: '陳嘉欣', role: '店舖主管', initials: '陳', tone: 'mint', status: '在職', shift: '09:00 – 18:00', check: '08:57', state: '準時' },
  { name: '梁志強', role: '高級顧問', initials: '梁', tone: 'blue', status: '在職', shift: '09:30 – 18:30', check: '09:42', state: '遲到 12 分鐘' },
  { name: '黃樂兒', role: '客戶服務', initials: '黃', tone: 'peach', status: '在職', shift: '10:00 – 19:00', check: '—', state: '未打卡' },
  { name: '李家豪', role: '倉務主任', initials: '李', tone: 'lavender', status: '在職', shift: '08:30 – 17:30', check: '08:25', state: '準時' },
  { name: '鄭雅雯', role: '人力資源', initials: '鄭', tone: 'rose', status: '休假中', shift: '09:00 – 18:00', check: '—', state: '年假' },
]

function readStore(key, fallback) { try { const value = JSON.parse(localStorage.getItem(key)); return Array.isArray(value) && value.length ? value : structuredClone(fallback) } catch { return structuredClone(fallback) } }
const employees = readStore('workforce.employees', defaultEmployees)
const shiftTemplates = readStore('workforce.shiftTemplates', [{name:'班次 A',start:'16:00',end:'01:30',location:'香港門市'},{name:'早更',start:'09:00',end:'18:00',location:'香港門市'},{name:'晚更',start:'13:00',end:'22:00',location:'香港門市'}])
const attendanceLogs = readStore('workforce.attendanceLogs', [])
const state = { page: '概覽', modal: false, editingIndex: null, shiftModal: false, templateModal: false, clockModal: false, shiftDate: '2026-09-28', shiftEmployee: '', scheduleStatus: '草稿', clockEmployee: '' }
let authSession = null
let authStep = 'email'
let authMessage = ''
const shifts = readStore('workforce.shifts', [])
const nav = ['概覽', '班表', '員工', '打卡紀錄', '假期與申請']
const worksite = { name: '4C 工作室', address: '大角嘴合桃街 2 號福星工廠大廈 4C 室', latitude: 22.3225694, longitude: 114.1629615, radiusMeters: 50 }

async function cloudInsert(table, payload) {
  if (!supabase) return null
  const { data, error } = await supabase.from(table).insert(payload).select().single()
  if (error) throw error
  return data
}

async function cloudUpdate(table, key, value, payload) {
  if (!supabase) return null
  const { data, error } = await supabase.from(table).update(payload).eq(key, value).select().single()
  if (error) throw error
  return data
}

function reportCloudError(error, fallbackMessage) {
  console.warn('Cloud sync unavailable:', error)
  showToast(`${fallbackMessage}（本機資料已保留）`)
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function icon(name) {
  const icons = { grid:'▦', calendar:'▣', users:'♙', clock:'◷', leave:'□', search:'⌕', bell:'♧', plus:'＋', more:'···', pin:'⌖', download:'⇩', check:'✓', warning:'!' }
  return icons[name] || '•'
}

function layout() {
  if (isCloudConfigured && !authSession) {
    document.querySelector('#app').innerHTML = loginPage()
    bindAuth()
    return
  }
  document.querySelector('#app').innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">班</div><div><strong>班咭</strong><span>WORKFORCE</span></div></div>
        <div class="workspace"><span class="workspace-dot"></span><div><small>目前工作空間</small><b>香港門市</b></div><span class="chevron">⌄</span></div>
        <nav>${nav.map((item, i) => `<button class="nav-item ${state.page===item?'active':''}" data-page="${item}"><span class="nav-icon">${icon(['grid','calendar','users','clock','leave'][i])}</span>${item}${item==='打卡紀錄'?'<em>3</em>':''}</button>`).join('')}</nav>
        <div class="sidebar-bottom"><div class="support"><span>?</span><div><b>需要協助？</b><small>查看使用指南</small></div></div><div class="profile"><div class="avatar avatar-dark">林</div><div><b>林經理</b><small>管理員</small></div><span class="more">···</span></div></div>
      </aside>
      <main class="main"><header><div class="mobile-brand"><div class="brand-mark">班</div><strong>班咭</strong></div><div class="breadcrumb"><span>香港門市</span><b>/</b><strong>${state.page}</strong></div><div class="header-actions"><button class="icon-btn search-btn">${icon('search')}</button><button class="icon-btn notification">${icon('bell')}<i></i></button><div class="avatar avatar-dark">林</div></div></header>${content()}</main>${state.modal ? employeeModal() : ''}
    </div>${state.shiftModal ? shiftEditor() : ''}${state.templateModal ? templateEditor() : ''}${state.clockModal ? clockEditor() : ''}`
  document.querySelectorAll('[data-page]').forEach(b => b.onclick=()=>{state.page=b.dataset.page;layout()})
  document.querySelectorAll('[data-action="new-employee"]').forEach(b => b.onclick=()=>{state.modal=true;state.editingIndex=null;layout()})
  document.querySelectorAll('[data-action="new-shift"]').forEach(b => b.onclick=()=>openNewShift())
  document.querySelectorAll('[data-action="open-clock"]').forEach(b => b.onclick=()=>{state.clockModal=true;state.clockEmployee=employees[0]?.name||'';layout()})
  document.querySelectorAll('[data-action="manage-templates"]').forEach(b => b.onclick=()=>{state.templateModal=true;layout()})
  document.querySelectorAll('[data-edit-employee]').forEach(b => b.onclick=()=>{state.editingIndex=Number(b.dataset.editEmployee);state.modal=true;layout()})
  document.querySelector('[data-action="close-modal"]')?.addEventListener('click',()=>{state.modal=false;layout()})
  document.querySelector('[data-action="save-employee"]')?.addEventListener('click', saveEmployee)
  document.querySelectorAll('[data-shift-date]').forEach(b=>b.onclick=()=>{state.shiftDate=b.dataset.shiftDate;state.shiftEmployee=b.dataset.shiftEmployee||employees[0]?.name;state.shiftModal=true;layout()})
  document.querySelectorAll('[data-action="close-shift"]').forEach(b=>b.onclick=()=>{state.shiftModal=false;layout()})
  document.querySelector('[data-action="save-shift"]')?.addEventListener('click',saveShift)
  document.querySelector('#shift-template')?.addEventListener('change',e=>{const t=shiftTemplates[Number(e.target.value)];if(!t)return;document.querySelector('#shift-start').value=t.start;document.querySelector('#shift-end').value=t.end;document.querySelector('#shift-location').value=t.location;})
  document.querySelector('[data-action="save-template"]')?.addEventListener('click',saveTemplate)
  document.querySelector('[data-action="close-clock"]')?.addEventListener('click',()=>{state.clockModal=false;layout()})
  document.querySelector('[data-action="clock-in"]')?.addEventListener('click',()=>recordClock('上班打卡'))
  document.querySelector('[data-action="clock-out"]')?.addEventListener('click',()=>recordClock('下班打卡'))
  document.querySelector('[data-action="close-template"]')?.addEventListener('click',()=>{state.templateModal=false;layout()})
  document.querySelectorAll('[data-delete-template]').forEach(b=>b.onclick=()=>deleteTemplate(Number(b.dataset.deleteTemplate)))
  document.querySelector('[data-action="delete-shift"]')?.addEventListener('click',deleteShift)
  document.querySelectorAll('[data-week-offset]').forEach(b=>b.onclick=()=>{const d=new Date(`${state.shiftDate}T12:00:00`);d.setDate(d.getDate()+Number(b.dataset.weekOffset));state.shiftDate=dateKey(d);layout()})
  document.querySelector('[data-action="today-week"]')?.addEventListener('click',()=>{state.shiftDate='2026-09-28';layout()})
  document.querySelector('[data-action="publish-schedule"]')?.addEventListener('click',()=>{state.scheduleStatus='已發布';layout();showToast('班表已發布，員工將收到通知')})
  document.querySelector('[data-action="copy-week"]')?.addEventListener('click',copyPreviousWeek)
  document.querySelector('[data-action="export-schedule"]')?.addEventListener('click',exportSchedule)
  document.querySelector('[data-action="export-report"]')?.addEventListener('click',exportReport)
  document.querySelector('[data-action="export-employees"]')?.addEventListener('click',exportEmployees)
  document.querySelector('[data-action="export-records"]')?.addEventListener('click',exportRecords)
  document.querySelectorAll('[data-action="quick-new-shift"]').forEach(b=>b.onclick=()=>{state.page='班表';openNewShift()})
  document.querySelectorAll('[data-action="quick-new-employee"]').forEach(b=>b.onclick=()=>{state.modal=true;state.editingIndex=null;layout()})
}

function loginPage() {
  return `<main class="auth-shell"><section class="auth-card"><div class="brand auth-brand"><div class="brand-mark">班</div><div><strong>班咭</strong><span>WORKFORCE</span></div></div><p class="eyebrow">香港人力資源管理系統</p><h1>安全登入</h1><p class="auth-copy">首次使用請輸入公司登記電郵，我們會寄出登入連結。登入後狀態會保留，不需要每天重新登入。</p><label>公司電郵<input id="auth-email" type="email" inputmode="email" autocomplete="email" placeholder="例如：name@jiggerflip.com"></label><button class="btn btn-primary auth-submit" data-auth-action="send">發送登入連結</button><p class="auth-message">${authMessage}</p><small class="auth-note">請只使用管理員分配的員工電郵帳號。</small></section></main>`
}

function bindAuth() {
  document.querySelector('[data-auth-action="send"]')?.addEventListener('click', sendOtp)
  
}

async function sendOtp() {
  const email = document.querySelector('#auth-email')?.value.trim()
  if (!email) { authMessage = '請輸入公司電郵'; layout(); return }
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })
  if (error) { authMessage = `發送失敗：${error.message}`; layout(); return }
  authMessage = '登入連結已發送，請查看電郵並按下連結。'
  layout()
}

function showToast(message){const old=document.querySelector('.toast');old?.remove();const el=document.createElement('div');el.className='toast';el.textContent=message;document.body.append(el);setTimeout(()=>el.remove(),2600)}
function openNewShift(date=dateKey(new Date())){state.shiftDate=date;state.shiftEmployee=employees[0]?.name||'';state.shiftModal=true;layout()}
function downloadCsv(filename, rows){const csv=rows.map(row=>row.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast(`已下載 ${filename}`)}
function exportReport(){downloadCsv('出勤報表.csv',[['員工','職位','班次','打卡時間','狀態'],...employees.map(e=>[e.name,e.role,e.shift,e.check,e.state])])}
function exportEmployees(){downloadCsv('員工名單.csv',[['員工編號','姓名','職位','工作地點','狀態'],...employees.map((e,i)=>[e.id||`EMP-${String(i+1).padStart(3,'0')}`,e.name,e.role,e.location||'香港門市',e.status])])}
function exportRecords(){downloadCsv('打卡紀錄.csv',[['員工','類型','時間','位置','驗證','狀態'],...employees.slice(0,4).map((e,i)=>[e.name,i%2?'下班打卡':'上班打卡',i===1?'09:42':e.check,'香港門市','GPS 已驗證',e.state])])}
function exportSchedule(){downloadCsv('班表.csv',[['日期','員工','開始','結束','工作地點'],...shifts.map(s=>[s.date,s.employee,s.start,s.end,s.location||'香港門市'])])}
function clockEditor(){return `<div class="modal-backdrop"><div class="modal clock-modal"><div class="modal-head"><div><p class="eyebrow">員工手機打卡測試</p><h2>上班／下班打卡</h2><p>請允許瀏覽器使用定位，以記錄打卡地點。</p></div><button class="modal-close" data-action="close-clock">×</button></div><label>測試員工<select id="clock-employee">${employees.map(e=>`<option ${e.name===state.clockEmployee?'selected':''}>${e.name}</option>`).join('')}</select></label><div class="clock-status"><b>定位狀態</b><span id="clock-location-status">按下打卡後取得定位</span></div><div class="modal-foot"><button class="btn btn-light" data-action="close-clock">取消</button><button class="btn btn-primary" data-action="clock-in">上班打卡</button><button class="btn btn-dark" data-action="clock-out">下班打卡</button></div></div></div>`}
function distanceMeters(lat1,lon1,lat2,lon2){const earth=6371000;const rad=Math.PI/180;const dLat=(lat2-lat1)*rad;const dLon=(lon2-lon1)*rad;const a=Math.sin(dLat/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLon/2)**2;return earth*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))}
function recordClock(type){const employee=document.querySelector('#clock-employee')?.value;const status=document.querySelector('#clock-location-status');if(!employee)return;if(!navigator.geolocation){status.textContent='此裝置不支援定位';showToast('無法取得定位');return}status.textContent='正在取得 GPS／Wi-Fi 定位…';navigator.geolocation.getCurrentPosition(async position=>{const now=new Date();const latitude=Number(position.coords.latitude.toFixed(6));const longitude=Number(position.coords.longitude.toFixed(6));const accuracy=Math.round(position.coords.accuracy);const distance=Math.round(distanceMeters(latitude,longitude,worksite.latitude,worksite.longitude));const verified=distance<=worksite.radiusMeters;const entry={id:crypto.randomUUID(),employee,type,time:now.toISOString(),displayTime:now.toLocaleString('zh-HK',{hour12:false}),latitude,longitude,accuracy,distanceMeters:distance,location:worksite.name,verified,verification:verified?'verified':'manual_review'};attendanceLogs.unshift(entry);localStorage.setItem('workforce.attendanceLogs',JSON.stringify(attendanceLogs));if(supabase){try{const profile=await supabase.from('profiles').select('id').eq('full_name',employee).maybeSingle();if(profile.data?.id){await cloudInsert('attendance_logs',{employee_id:profile.data.id,attendance_type:type==='上班打卡'?'clock_in':'clock_out',recorded_at:now.toISOString(),latitude,longitude,accuracy_meters:accuracy,distance_from_worksite_meters:distance,verification:entry.verification,device_label:navigator.userAgent.slice(0,120)})}}catch(error){reportCloudError(error,'打卡已完成')}}state.clockModal=false;layout();showToast(verified?`${employee} ${type}成功，位置已驗證`:`${employee} ${type}成功，距離工作地點 ${distance} 米，需主管核實`)},error=>{status.textContent='定位失敗：'+(error.code===1?'請允許定位權限':'請檢查手機定位及 Wi-Fi');showToast('打卡未完成，未能確認位置')},{enableHighAccuracy:true,timeout:12000,maximumAge:0})}
function copyPreviousWeek(){const anchor=new Date(`${state.shiftDate||'2026-09-28'}T12:00:00`);anchor.setDate(anchor.getDate()-((anchor.getDay()+6)%7));const sourceStart=new Date(anchor);sourceStart.setDate(sourceStart.getDate()-7);const copied=[];shifts.filter(s=>{const d=new Date(`${s.date}T12:00:00`);return d>=sourceStart&&d<anchor}).forEach(s=>{const d=new Date(`${s.date}T12:00:00`);d.setDate(d.getDate()+7);const item={...s,date:dateKey(d)};const idx=shifts.findIndex(x=>x.employee===item.employee&&x.date===item.date);if(idx<0){shifts.push(item);copied.push(item)}else shifts[idx]=item});localStorage.setItem('workforce.shifts',JSON.stringify(shifts));layout();showToast(`已複製 ${copied.length} 個班次到本週`)}
function saveTemplate(){const name=document.querySelector('#template-name')?.value.trim();const start=document.querySelector('#template-start')?.value;const end=document.querySelector('#template-end')?.value;const location=document.querySelector('#template-location')?.value||'香港門市';if(!name||!start||!end){showToast('請填寫班次名稱及時間');return}if(start===end){showToast('開始及結束時間不能相同');return}shiftTemplates.push({name,start,end,location});localStorage.setItem('workforce.shiftTemplates',JSON.stringify(shiftTemplates));state.templateModal=false;layout();showToast(`已新增預設班次「${name}」`)}
function deleteTemplate(index){const item=shiftTemplates[index];if(!item)return;shiftTemplates.splice(index,1);localStorage.setItem('workforce.shiftTemplates',JSON.stringify(shiftTemplates));layout();showToast(`已刪除預設班次「${item.name}」`)}

function employeeModal(){const e=state.editingIndex===null?{}:employees[state.editingIndex];const location=e.location||'香港門市';return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div><p class="eyebrow">團隊管理</p><h2>${state.editingIndex===null?'新增員工':'編輯員工資料'}</h2><p>管理員工基本資料及工作地點。</p></div><button class="modal-close" data-action="close-modal">×</button></div><div class="form-grid"><label>姓名<input id="employee-name" value="${e.name||''}" placeholder="例如：王小明" /></label><label>職位<input id="employee-role" value="${e.role||''}" placeholder="例如：店舖主管" /></label><label>員工編號<input id="employee-id" value="${e.id||''}" placeholder="自動產生" /></label><label>工作地點<select id="employee-location"><option ${location==='香港門市'?'selected':''}>香港門市</option><option ${location==='九龍門市'?'selected':''}>九龍門市</option><option ${location==='新界門市'?'selected':''}>新界門市</option></select></label></div><div class="modal-foot"><button class="btn btn-light" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="save-employee">${icon('check')} 儲存員工</button></div></div></div>` }

function saveEmployee(){
  const name=document.querySelector('#employee-name')?.value.trim(); const role=document.querySelector('#employee-role')?.value.trim();
  if(!name || !role){ document.querySelector('.modal')?.classList.add('shake'); return }
  const existing=state.editingIndex===null?{}:employees[state.editingIndex]
  const data={...existing,name,role,id:document.querySelector('#employee-id')?.value.trim()||`EMP-${String(employees.length+1).padStart(3,'0')}`,location:document.querySelector('#employee-location')?.value||'香港門市',initials:name.slice(0,1),tone:state.editingIndex===null?['mint','blue','peach','lavender','rose'][employees.length%5]:existing.tone,status:existing.status||'在職',shift:existing.shift||'09:00 – 18:00',check:existing.check||'—',state:existing.state||'未打卡'}
  if(state.editingIndex===null) employees.push(data); else employees[state.editingIndex]=data
  localStorage.setItem('workforce.employees',JSON.stringify(employees))
  if (supabase) {
    const payload = { phone: data.phone || data.id, full_name: data.name, role: data.role.includes('主管') ? 'manager' : 'employee', status: data.status === '在職' ? 'active' : 'inactive' }
    const sync = state.editingIndex===null ? cloudInsert('profiles', { id: crypto.randomUUID(), ...payload }) : cloudUpdate('profiles', 'phone', employees[state.editingIndex].phone || data.id, payload)
    sync.catch(error => reportCloudError(error, '員工已儲存'))
  }
  state.modal=false; state.page='員工'; layout()
}

function content() {
  if (state.page === '概覽') return dashboard()
  if (state.page === '班表') return scheduleFull()
  if (state.page === '員工') return employeesPage()
  return records()
}

function dashboard() { return `<section class="content"><div class="title-row"><div><p class="eyebrow">星期三・2026年10月1日</p><h1>早安，林經理 <span>✦</span></h1><p class="sub">這是香港門市今天的出勤概況。</p></div><div class="actions"><button class="btn btn-light" data-action="open-clock">手機打卡測試</button><button class="btn btn-light" data-action="export-report">${icon('download')} 匯出報表</button><button class="btn btn-primary" data-action="new-employee">${icon('plus')} 新增員工</button></div></div>
  <div class="stats"><div class="stat-card"><div class="stat-head"><span>今日出勤率</span><span class="stat-icon green">✓</span></div><strong>86.7<span>%</span></strong><div class="stat-foot"><span class="trend up">↑ 4.2%</span><span>較上週平均</span></div></div><div class="stat-card"><div class="stat-head"><span>已打卡</span><span class="stat-icon blue">◷</span></div><strong>26<span class="unit"> / 30 人</span></strong><div class="progress"><i style="width:86.7%"></i></div><div class="stat-foot"><span>尚有 4 人未打卡</span></div></div><div class="stat-card"><div class="stat-head"><span>遲到人數</span><span class="stat-icon orange">!</span></div><strong>3<span class="unit"> 人</span></strong><div class="stat-foot"><span class="trend down">↑ 1 人</span><span>較昨日</span></div></div><div class="stat-card"><div class="stat-head"><span>待處理申請</span><span class="stat-icon purple">□</span></div><strong>5<span class="unit"> 項</span></strong><div class="stat-foot"><span class="link">查看全部 →</span></div></div></div>
  <div class="grid-main"><div class="panel attendance"><div class="panel-title"><div><h2>今日出勤</h2><span>即時更新於 09:45</span></div><button class="text-btn">查看全部 →</button></div><div class="attendance-bar"><div><strong>26</strong><span>已打卡</span></div><div><strong class="orange-text">3</strong><span>遲到</span></div><div><strong class="muted-text">1</strong><span>未打卡</span></div><div><strong class="purple-text">0</strong><span>休假</span></div><div class="bar-visual"><i></i><i></i><i></i><i></i></div></div><div class="table-wrap"><table><thead><tr><th>員工</th><th>職位</th><th>班次</th><th>打卡時間</th><th>狀態</th><th></th></tr></thead><tbody>${employees.map(e=>row(e)).join('')}</tbody></table></div></div><div class="side-stack"><div class="panel reminders"><div class="panel-title"><div><h2>提醒</h2><span>需要你處理的事項</span></div><button class="dots">···</button></div><div class="reminder-item warning-item"><div class="rem-icon orange-bg">!</div><div><b>有人遲到</b><p>梁志強遲到 12 分鐘</p><small>10 分鐘前</small></div><button class="arrow">→</button></div><div class="reminder-item"><div class="rem-icon blue-bg">◷</div><div><b>即將開始的班次</b><p>黃樂兒的班次將於 15 分鐘後開始</p><small>提醒已發送</small></div><button class="arrow">→</button></div><div class="reminder-item"><div class="rem-icon purple-bg">□</div><div><b>待審批申請</b><p>有 5 項假期及補卡申請待處理</p><small>今天</small></div><button class="arrow">→</button></div></div><div class="panel quick"><div class="panel-title"><div><h2>快速操作</h2><span>常用功能</span></div></div><div class="quick-grid"><button data-action="quick-new-shift"><span class="qicon green">＋</span>新增班次</button><button data-action="quick-new-employee"><span class="qicon blue">♙</span>新增員工</button><button><span class="qicon purple">□</span>審批申請</button><button data-action="export-report"><span class="qicon orange">⇩</span>匯出報表</button></div></div></div></div></section>` }

function row(e){return `<tr><td><div class="person"><div class="avatar avatar-${e.tone}">${e.initials}</div><b>${e.name}</b></div></td><td>${e.role}</td><td>${e.shift}</td><td class="check-time">${e.check}</td><td><span class="pill ${e.state.includes('遲到')?'late':e.state==='未打卡'?'missing':e.state==='年假'?'leave':'on'}">${e.state}</span></td><td><button class="dots" data-edit-employee="${employees.indexOf(e)}" title="編輯員工">···</button></td></tr>`}

function schedule(){const monday=new Date(`${state.shiftDate||'2026-09-28'}T12:00:00`);monday.setDate(monday.getDate()-((monday.getDay()+6)%7));const days=Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setDate(monday.getDate()+i);return d});const label=`${monday.getFullYear()}年${monday.getMonth()+1}月${monday.getDate()}日 – ${days[6].getMonth()+1}月${days[6].getDate()}日`;return `<section class="content"><div class="title-row"><div><p class="eyebrow">排班管理</p><h1>班表</h1><p class="sub">點擊班次編輯，點擊空白格新增班次。</p></div><div class="actions"><button class="btn btn-primary" data-shift-date="${dateKey(new Date())}">${icon('plus')} 新增班次</button></div></div><div class="panel schedule-panel"><div class="schedule-toolbar"><button data-week-offset="-7">‹</button><h2>${label}</h2><button data-week-offset="7">›</button><button class="today" data-action="today-week">本週</button><div class="toolbar-right"><button class="view-active">週</button></div></div><div class="week-head"><span>員工</span>${days.map(d=>`<b class="${dateKey(d)===dateKey(new Date())?'current':''}">${'日一二三四五六'[d.getDay()]} ${d.getDate()}</b>`).join('')}</div>${employees.map((e,i)=>`<div class="schedule-row"><div class="schedule-person"><div class="avatar avatar-${e.tone}">${e.initials}</div><b>${e.name}</b></div>${days.map(d=>{const key=dateKey(d);const s=shifts.find(x=>x.employee===e.name&&x.date===key);return `<div class="shift-cell" data-shift-date="${key}" data-shift-employee="${e.name}">${s?`<button class="shift-block ${d.getDay()===0||d.getDay()===6?'highlight':''}" data-shift-date="${key}" data-shift-employee="${e.name}">${s.start}<small>${s.end}</small></button>`:'<button class="shift-empty" data-shift-date="'+key+'" data-shift-employee="'+e.name+'">＋</button>'}</div>`}).join('')}</div>`).join('')}</div></section>`}

function scheduleFull(){
  const anchor=new Date(`${state.shiftDate||'2026-09-28'}T12:00:00`); anchor.setDate(anchor.getDate()-((anchor.getDay()+6)%7));
  const days=Array.from({length:7},(_,i)=>{const d=new Date(anchor);d.setDate(anchor.getDate()+i);return d});
  const total=employees.length*7; const planned=shifts.filter(s=>days.some(d=>dateKey(d)===s.date)).length; const unplanned=Math.max(0,total-planned);
  return `<section class="content schedule-workspace"><div class="title-row"><div><p class="eyebrow">排班管理 / 2026年10月</p><h1>班表工作台</h1><p class="sub">集中編排、檢查及發布團隊班次。</p></div><div class="actions"><button class="btn btn-light" data-action="manage-templates">管理預設班次</button><button class="btn btn-light" data-action="copy-week">複製上一週</button><button class="btn btn-light" data-action="export-schedule">${icon('download')} 匯出</button><button class="btn btn-primary" data-action="new-shift">${icon('plus')} 新增班次</button></div></div>
  <div class="schedule-summary"><div><span>本週已排班</span><b>${planned}</b><small>/ ${total} 個班次</small></div><div><span>未排班</span><b class="orange-text">${unplanned}</b><small>需要跟進</small></div><div><span>員工數</span><b>${employees.length}</b><small>位員工</small></div><div class="publish-state"><span>班表狀態</span><b><i></i> ${state.scheduleStatus}</b><button class="btn btn-primary" data-action="publish-schedule">發布班表</button></div></div>
  <div class="panel schedule-board"><div class="board-tools"><button class="round-btn" data-week-offset="-7">‹</button><button class="round-btn" data-week-offset="7">›</button><button class="today" data-action="today-week">今天</button><h2>${anchor.getFullYear()}年${anchor.getMonth()+1}月${anchor.getDate()}日 – ${days[6].getMonth()+1}月${days[6].getDate()}日</h2><div class="board-filters"><select><option>所有部門</option><option>門市</option><option>倉務</option></select><select><option>所有員工</option>${employees.map(e=>`<option>${e.name}</option>`).join('')}</select><button class="view-toggle active">週</button><button class="view-toggle">月</button></div></div><div class="legend"><span><i class="legend-dot scheduled"></i>已排班</span><span><i class="legend-dot leave-dot"></i>休假</span><span><i class="legend-dot empty-dot"></i>未排班</span><span class="legend-tip">點擊空白格新增班次</span></div><div class="week-head full"><span>員工 / 職位</span>${days.map(d=>`<b class="${dateKey(d)===dateKey(new Date())?'current':''}">${'日一二三四五六'[d.getDay()]}<small>${d.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}</small></b>`).join('')}</div>${employees.map(e=>`<div class="schedule-row full"><div class="schedule-person"><div class="avatar avatar-${e.tone}">${e.initials}</div><div><b>${e.name}</b><small>${e.role}</small></div></div>${days.map(d=>{const key=dateKey(d);const s=shifts.find(x=>x.employee===e.name&&x.date===key);return `<div class="shift-cell ${d.getDay()===0||d.getDay()===6?'weekend':''}">${s?`<button class="shift-block detailed ${s.start==='休息'?'rest':''}" data-shift-date="${key}" data-shift-employee="${e.name}"><strong>${s.start==='休息'?'休息':s.start+' – '+s.end}</strong><small>${s.start==='休息'?'休息日':s.location||'香港門市'}</small></button>`:`<button class="shift-empty" data-shift-date="${key}" data-shift-employee="${e.name}">＋<small>新增</small></button>`}</div>`}).join('')}</div>`).join('')}</div></section>`
}

function shiftEditor(){const s=shifts.find(x=>x.employee===state.shiftEmployee&&x.date===state.shiftDate);return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div><p class="eyebrow">班表管理</p><h2>${s?'編輯班次':'新增班次'}</h2><p>${state.shiftDate} · ${state.shiftEmployee||'選擇員工'}</p></div><button class="modal-close" data-action="close-shift">×</button></div><div class="form-grid"><label>員工<select id="shift-employee">${employees.map(e=>`<option ${e.name===state.shiftEmployee?'selected':''}>${e.name}</option>`).join('')}</select></label><label>套用預設班次<select id="shift-template"><option value="">自訂時間（不套用）</option>${shiftTemplates.map((t,i)=>`<option value="${i}">${t.name} · ${t.start}–${t.end}</option>`).join('')}</select></label><label>工作地點<select id="shift-location"><option>${s?.location||'香港門市'}</option><option>九龍門市</option><option>新界門市</option></select></label><label>開始時間<input id="shift-start" type="time" value="${s?.start||'09:00'}"></label><label>結束時間<input id="shift-end" type="time" value="${s?.end||'18:00'}"></label></div><div class="modal-foot">${s?'<button class="btn btn-danger" data-action="delete-shift">刪除班次</button>':''}<button class="btn btn-light" data-action="close-shift">取消</button><button class="btn btn-primary" data-action="save-shift">${icon('check')} 儲存班次</button></div></div></div>`}

function templateEditor(){return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div><p class="eyebrow">班表設定</p><h2>預設班次</h2><p>建立常用班次，新增排班時可直接套用。</p></div><button class="modal-close" data-action="close-template">×</button></div><div class="template-list">${shiftTemplates.map((t,i)=>`<div class="template-row"><div><b>${t.name}</b><span>${t.start} – ${t.end} · ${t.location}</span></div><button class="btn btn-danger" data-delete-template="${i}">刪除</button></div>`).join('')||'<p class="empty-note">尚未建立預設班次</p>'}</div><div class="form-grid"><label>班次名稱<input id="template-name" placeholder="例如：班次 A"></label><label>工作地點<select id="template-location"><option>香港門市</option><option>九龍門市</option><option>新界門市</option></select></label><label>開始時間<input id="template-start" type="time" value="09:00"></label><label>結束時間<input id="template-end" type="time" value="18:00"></label></div><div class="modal-foot"><button class="btn btn-light" data-action="close-template">取消</button><button class="btn btn-primary" data-action="save-template">${icon('plus')} 新增預設班次</button></div></div></div>`}

function saveShift(){const employee=document.querySelector('#shift-employee')?.value;const start=document.querySelector('#shift-start')?.value;const end=document.querySelector('#shift-end')?.value;if(!employee||!start||!end||start===end){showToast('請輸入有效的開始及結束時間');return}const idx=shifts.findIndex(s=>s.employee===employee&&s.date===state.shiftDate);const item={employee,date:state.shiftDate,start,end,location:document.querySelector('#shift-location')?.value||'香港門市'};if(idx<0)shifts.push(item);else shifts[idx]=item;localStorage.setItem('workforce.shifts',JSON.stringify(shifts));state.shiftEmployee=employee;state.shiftModal=false;layout();showToast('班次已儲存')}
function deleteShift(){const i=shifts.findIndex(s=>s.employee===state.shiftEmployee&&s.date===state.shiftDate);if(i>=0)shifts.splice(i,1);localStorage.setItem('workforce.shifts',JSON.stringify(shifts));state.shiftModal=false;layout()}

function employeesPage(){return `<section class="content"><div class="title-row"><div><p class="eyebrow">團隊管理</p><h1>員工</h1><p class="sub">管理員工資料、職位及工作地點。</p></div><div class="actions"><button class="btn btn-light" data-action="export-employees">${icon('download')} 匯出名單</button><button class="btn btn-primary" data-action="new-employee">${icon('plus')} 新增員工</button></div></div><div class="panel"><div class="list-toolbar"><div class="search-field">⌕ <input placeholder="搜尋姓名、職位或員工編號" /></div><button class="filter">篩選　⌄</button></div><div class="table-wrap"><table><thead><tr><th>員工</th><th>職位</th><th>工作地點</th><th>入職日期</th><th>狀態</th><th></th></tr></thead><tbody>${employees.map((e,i)=>`<tr><td><div class="person"><div class="avatar avatar-${e.tone}">${e.initials}</div><div><b>${e.name}</b><small class="id">${e.id||`EMP-${String(i+1).padStart(3,'0')}`}</small></div></div></td><td>${e.role}</td><td><span class="location">⌖ ${e.location||'香港門市'}</span></td><td>202${i+1} / 0${(i%8)+1} / 1${i}</td><td><span class="pill ${e.status==='在職'?'on':'leave'}">${e.status}</span></td><td><button class="dots" data-edit-employee="${i}" title="編輯員工">···</button></td></tr>`).join('')}</tbody></table></div></div></section>`}

function records(){const live=attendanceLogs.map(log=>`<tr><td>${log.employee}</td><td>${log.type}</td><td><b>${log.displayTime}</b></td><td><span class="location">⌖ ${log.latitude}, ${log.longitude}</span></td><td><span class="verified">${log.verified?'✓ GPS 已驗證':'! 需核實'}</span></td><td><span class="pill ${log.verified?'on':'late'}">${log.verified?'正常':'需核實'}</span></td></tr>`).join('');const demo=employees.slice(0,4).map((e,i)=>`<tr><td><div class="person"><div class="avatar avatar-${e.tone}">${e.initials}</div><b>${e.name}</b></div></td><td>${i%2?'下班打卡':'上班打卡'}</td><td><b>${i===1?'09:42':e.check}</b></td><td><span class="location">⌖ 香港門市</span></td><td><span class="verified">✓ GPS 已驗證</span></td><td><span class="pill ${e.state.includes('遲到')?'late':'on'}">${e.state.includes('遲到')?'遲到':'正常'}</span></td></tr>`).join('');return `<section class="content"><div class="title-row"><div><p class="eyebrow">考勤管理</p><h1>打卡紀錄</h1><p class="sub">查看所有上下班打卡及異常紀錄。</p></div><div class="actions"><button class="btn btn-primary" data-action="open-clock">手機打卡測試</button><button class="btn btn-light" data-action="export-records">${icon('download')} 匯出紀錄</button><button class="btn btn-primary">${icon('plus')} 補卡申請</button></div></div><div class="stats mini-stats"><div class="stat-card"><span>今日總打卡</span><strong>52<span class="unit"> 次</span></strong></div><div class="stat-card"><span>GPS 驗證成功</span><strong>98.1<span>%</span></strong></div><div class="stat-card"><span>待核實紀錄</span><strong class="orange-text">3<span class="unit"> 項</span></strong></div></div><div class="panel"><div class="list-toolbar"><div class="date-chip">2026年10月1日　⌄</div><button class="filter">所有狀態　⌄</button></div><div class="table-wrap"><table><thead><tr><th>員工</th><th>類型</th><th>時間</th><th>位置</th><th>驗證</th><th>狀態</th></tr></thead><tbody>${live||demo}</tbody></table></div></div></section>`}

if (supabase) {
  supabase.auth.getSession().then(({ data }) => { authSession = data.session; layout() })
  supabase.auth.onAuthStateChange((_event, session) => { authSession = session; layout() })
}
layout()
