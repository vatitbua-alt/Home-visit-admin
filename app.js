/* ============================================================
   APP.JS — Home Visit System (Full Teacher Features)
   ============================================================ */

// ==================== CONFIG ====================
const CONFIG = {
  MASTER_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbz2v8fY1sEWH6WcpVAyOrvSCxoJfIVscj_s2kms56vErfoSowkkGJpbzGXa_CI9qVEhQQ/exec', // <-- ตั้งค่า Master URL เรียบร้อยแล้ว
  ACTIVE_SCHOOL_CODE: '' // จะถูกตั้งค่าอัตโนมัติตามโรงเรียนที่เลือก
};

// ==================== STATE ====================
let publicSchools    = [];
let selectedPin      = null;
let map              = null;
let marker           = null;
let pinCurrentValue  = '';
let allRecords       = [];
let teacherLocation  = null;
let teacherMap       = null;
let teacherMarkers   = {};
let activePopupId    = null;

// ==================== TEACHER LOCAL DATA ====================
// เก็บ visitStatus และ markerColor ใน localStorage
const TD_KEY = 'teacherLocalData';
let teacherData = (() => {
  try { return JSON.parse(localStorage.getItem(TD_KEY)) || {}; } catch (e) { return {}; }
})();
// structure: teacherData[recordId] = { visited: bool, visitDate: string, colorId: string }

function saveTD() { localStorage.setItem(TD_KEY, JSON.stringify(teacherData)); }

function getTD(id) {
  return teacherData[id] || { visited: false, visitDate: '', colorId: 'blue' };
}

function setTD(id, patch) {
  teacherData[id] = { ...getTD(id), ...patch };
  saveTD();
}

// ==================== MARKER COLOR SYSTEM ====================
const MARKER_COLORS = [
  { id: 'blue',   hex: '#4f46e5', label: 'ปกติ',        icon: '🔵' },
  { id: 'red',    hex: '#ef4444', label: 'ยังไม่ได้ไป', icon: '🔴' },
  { id: 'green',  hex: '#10b981', label: 'ไปแล้ว',      icon: '🟢' },
  { id: 'yellow', hex: '#f59e0b', label: 'นัดไว้',      icon: '🟡' },
  { id: 'purple', hex: '#8b5cf6', label: 'ด่วน',         icon: '🟣' },
  { id: 'gray',   hex: '#9ca3af', label: 'หมายเหตุ',     icon: '⚪' },
];

function getColor(id) {
  const td = getTD(id);
  // ถ้าเยี่ยมแล้วและยังไม่ตั้งสีเอง → แสดงสีเขียวอัตโนมัติ
  if (td.visited && td.colorId === 'blue') {
    return MARKER_COLORS.find(c => c.id === 'green');
  }
  return MARKER_COLORS.find(c => c.id === (td.colorId || 'blue')) || MARKER_COLORS[0];
}

function makeSvgMarker(hexColor, small = false) {
  const w = small ? 28 : 36, h = small ? 34 : 44;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 36 44" style="display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3))">
    <path d="M18 0C8.6 0 1 7.6 1 17c0 12 17 27 17 27S35 29 35 17C35 7.6 27.4 0 18 0z"
          fill="${hexColor}" stroke="white" stroke-width="2.5"/>
    <circle cx="18" cy="17" r="6" fill="white" opacity="0.9"/>
  </svg>`;
}

function leafletIcon(hexColor) {
  return L.divIcon({
    html: makeSvgMarker(hexColor),
    className: '',
    iconSize: [36, 44],
    iconAnchor: [18, 44],
    popupAnchor: [0, -44]
  });
}

// ==================== DISTANCE ====================
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2
    + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatDist(km) {
  if (km < 1) return `${Math.round(km * 1000)} ม.`;
  return `${km.toFixed(1)} กม.`;
}

// ==================== TOAST ====================
function showToast(msg, type = 'info') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ==================== MAP (LEAFLET - Parent Form) & INIT ====================
document.addEventListener('DOMContentLoaded', function() {
  initMap();
  fetchSchools();
});

async function fetchSchools() {
  const select = document.getElementById('schoolSelect');
  if (!select || !CONFIG.MASTER_APPS_SCRIPT_URL) return;
  try {
    const res = await fetch(CONFIG.MASTER_APPS_SCRIPT_URL + '?action=getSchoolsPublic');
    const data = await res.json();
    if (data.error) throw new Error(data.message);
    publicSchools = data;
    select.innerHTML = '<option value="">-- เลือกโรงเรียน --</option>' + 
      publicSchools.map(function(s) { return '<option value="' + s.code + '">' + s.name + '</option>'; }).join('');
  } catch(err) {
    console.error('Fetch schools error:', err);
    select.innerHTML = '<option value="">(ไม่สามารถโหลดข้อมูลโรงเรียนได้)</option>';
  }
}

function initMap() {
  try {
    map = L.map('map', { center: [13.7563, 100.5018], zoom: 10, tap: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    map.on('click', e => placeMarker(e.latlng.lat, e.latlng.lng));
  } catch (err) {
    console.error('Map init error:', err);
  }
}

function placeMarker(lat, lng) {
  if (!map) return;
  if (marker) map.removeLayer(marker);
  marker = L.marker([lat, lng], { icon: leafletIcon('#4f46e5') }).addTo(map);
  selectedPin = { lat, lng };
  document.getElementById('pinInfo').style.display = 'flex';
  document.getElementById('pinCoords').textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  document.getElementById('mapLink').href = `https://www.google.com/maps?q=${lat},${lng}`;
  document.getElementById('mapContainer').classList.add('has-pin');
  document.getElementById('clearPin').style.display = 'flex';
}

const useMyLocationBtn = document.getElementById('useMyLocation');
if (useMyLocationBtn) {
  useMyLocationBtn.addEventListener('click', () => {
    if (!navigator.geolocation) { showToast('เบราว์เซอร์ไม่รองรับ GPS', 'error'); return; }
    const btn = document.getElementById('useMyLocation');
    btn.disabled = true;
    btn.querySelector('span').textContent = 'กำลังหา...';
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const lat = coords.latitude;
        const lng = coords.longitude;
        if (map) map.setView([lat, lng], 16);
        placeMarker(lat, lng);
        btn.disabled = false;
        btn.querySelector('span').textContent = 'ตำแหน่งฉัน';
      },
      function(err) {
        showToast('ไม่สามารถดึงตำแหน่งได้', 'error');
        btn.disabled = false;
        btn.querySelector('span').textContent = 'ตำแหน่งฉัน';
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

const clearPinEl = document.getElementById('clearPin');
if (clearPinEl) clearPinEl.addEventListener('click', function() {
  if (marker && map) { map.removeLayer(marker); marker = null; }
  selectedPin = null;
  document.getElementById('pinInfo').style.display = 'none';
  document.getElementById('clearPin').style.display = 'none';
  document.getElementById('mapContainer').classList.remove('has-pin');
});

// ==================== FORM SUBMIT ====================
const visitFormEl = document.getElementById('visitForm');
if (visitFormEl) visitFormEl.addEventListener('submit', function(e) {
  e.preventDefault();
  if (!validateForm()) return;
  
  const schoolCode = document.getElementById('schoolSelect').value;
  const school = publicSchools.find(function(s) { return String(s.code) === String(schoolCode); });
  if (!school) {
    showToast('กรุณาเลือกโรงเรียนที่ถูกต้อง', 'error');
    return;
  }
  // ตั้งค่ารหัสโรงเรียนสำหรับบันทึกข้อมูล
  CONFIG.ACTIVE_SCHOOL_CODE = school.code;

  const record = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    parentName: document.getElementById('parentName').value.trim(),
    parentPhone: document.getElementById('parentPhone').value.trim(),
    studentName: document.getElementById('studentName').value.trim(),
    studentNumber: document.getElementById('studentNumber').value,
    studentLevel: document.getElementById('studentLevel').value,
    studentRoom: document.getElementById('studentRoom').value,
    note: document.getElementById('visitNote').value.trim(),
    address: document.getElementById('addressText').value.trim(),
    pin: selectedPin ? { lat: selectedPin.lat, lng: selectedPin.lng } : null,
  };
  setSubmitLoading(true);
  saveToSheets(record).then(function() {
    showSuccessModal(record);
    resetForm();
  }).catch(function(err) {
    console.error(err);
    showToast('❌ บันทึกไม่สำเร็จ', 'error');
  }).finally(function() {
    setSubmitLoading(false);
  });
});

function setSubmitLoading(on) {
  document.querySelector('.btn-submit-text').style.display = on ? 'none' : 'flex';
  document.querySelector('.btn-submit-loading').style.display = on ? 'flex' : 'none';
  document.getElementById('submitBtn').disabled = on;
}

function validateForm() {
  const fields = ['schoolSelect','parentName','parentPhone','studentName','studentNumber','studentLevel','studentRoom','addressText'];
  let ok = true;
  fields.forEach(function(id) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('error');
      if (!el.value.trim()) { el.classList.add('error'); ok = false; }
    }
  });
  if (!ok) {
    const errorEl = document.querySelector('.error');
    if (errorEl) errorEl.scrollIntoView({ behavior:'smooth', block:'center' });
    showToast('กรุณากรอกข้อมูลให้ครบถ้วน', 'error');
  }
  return ok;
}

function resetForm() {
  document.getElementById('visitForm').reset();
  if (marker && map) { map.removeLayer(marker); marker = null; }
  selectedPin = null;
  document.getElementById('pinInfo').style.display = 'none';
  document.getElementById('clearPin').style.display = 'none';
  document.getElementById('mapContainer').classList.remove('has-pin');
}

// ==================== SHEETS API ====================
async function saveToSheets(record) {
  const res = await fetch(CONFIG.MASTER_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'save', schoolCode: CONFIG.ACTIVE_SCHOOL_CODE, record: record })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function loadFromSheets() {
  const res = await fetch(CONFIG.MASTER_APPS_SCRIPT_URL + '?action=getAll&schoolCode=' + encodeURIComponent(CONFIG.ACTIVE_SCHOOL_CODE));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function deleteFromSheets(id) {
  await fetch(CONFIG.MASTER_APPS_SCRIPT_URL + '?action=delete&schoolCode=' + encodeURIComponent(CONFIG.ACTIVE_SCHOOL_CODE) + '&id=' + encodeURIComponent(id));
}

// ==================== SUCCESS MODAL ====================
function showSuccessModal(r) {
  document.getElementById('successDetail').innerHTML = 
    '<div class="detail-row"><span class="detail-label">นักเรียน</span><span class="detail-value">' + r.studentName + '</span></div>' +
    '<div class="detail-row"><span class="detail-label">ชั้น/ห้อง</span><span class="detail-value">' + r.studentLevel + '/' + r.studentRoom + ' เลขที่ ' + r.studentNumber + '</span></div>' +
    '<div class="detail-row"><span class="detail-label">ผู้ปกครอง</span><span class="detail-value">' + r.parentName + ' (' + r.parentPhone + ')</span></div>' +
    '<div class="detail-row"><span class="detail-label">ที่อยู่</span><span class="detail-value">' + r.address + '</span></div>' +
    (r.pin ? '<div class="detail-row"><span class="detail-label">พิกัด</span><span class="detail-value">' + r.pin.lat.toFixed(5) + ', ' + r.pin.lng.toFixed(5) + '</span></div>' : '');
  document.getElementById('successModal').classList.add('active');
}
const closeSuccess = document.getElementById('closeSuccess');
if (closeSuccess) closeSuccess.addEventListener('click', function() { document.getElementById('successModal').classList.remove('active'); });

const successModal = document.getElementById('successModal');
if (successModal) successModal.addEventListener('click', function(e) { if (e.target===e.currentTarget) e.currentTarget.classList.remove('active'); });

// ==================== TEACHER SHIELD ====================
const teacherShieldBtn = document.getElementById('teacherShieldBtn');
if (teacherShieldBtn) teacherShieldBtn.addEventListener('click', function() {
  document.getElementById('teacherLoginError').textContent = '';
  document.getElementById('loginSchoolCode').value = '';
  document.getElementById('loginTeacherPassword').value = '';
  document.getElementById('teacherLoginModal').classList.add('active');
});

const closeTeacherLogin = document.getElementById('closeTeacherLogin');
if (closeTeacherLogin) closeTeacherLogin.addEventListener('click', function() { document.getElementById('teacherLoginModal').classList.remove('active'); });

const teacherLoginModal = document.getElementById('teacherLoginModal');
if (teacherLoginModal) teacherLoginModal.addEventListener('click', function(e) { if(e.target===e.currentTarget) e.currentTarget.classList.remove('active'); });

const teacherLoginForm = document.getElementById('teacherLoginForm');
if (teacherLoginForm) {
  teacherLoginForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    const code = document.getElementById('loginSchoolCode').value.trim();
    const pwd = document.getElementById('loginTeacherPassword').value.trim();
    const btnText = document.querySelector('#btnTeacherLoginSubmit .btn-submit-text');
    const btnLoad = document.querySelector('#btnTeacherLoginSubmit .btn-submit-loading');
    
    btnText.style.display = 'none';
    btnLoad.style.display = 'inline-flex';
    document.getElementById('teacherLoginError').textContent = '';
    
    try {
      const res = await fetch(CONFIG.MASTER_APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'verifyTeacher', code: code, password: pwd })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.message);
      
      // ล็อกอินสำเร็จ เปลี่ยนรหัสโรงเรียนที่กำลังใช้งาน
      CONFIG.ACTIVE_SCHOOL_CODE = data.code;
      document.getElementById('teacherLoginModal').classList.remove('active');
      openDashboard();
    } catch(err) {
      let msg = err.message || 'รหัสไม่ถูกต้อง';
      if (msg.includes('fetch') || msg.includes('Unexpected')) msg = 'กรุณาตรวจสอบลิงก์ Master URL ในไฟล์ app.js';
      document.getElementById('teacherLoginError').textContent = msg;
    } finally {
      btnText.style.display = 'inline-flex';
      btnLoad.style.display = 'none';
    }
  });
}

// ==================== ADMIN LOGIC ====================
const adminShieldBtn = document.getElementById('adminShieldBtn');
if (adminShieldBtn) adminShieldBtn.addEventListener('click', function() {
  document.getElementById('adminLoginError').textContent = '';
  document.getElementById('loginAdminPassword').value = '';
  document.getElementById('adminLoginModal').classList.add('active');
});

const closeAdminLogin = document.getElementById('closeAdminLogin');
if (closeAdminLogin) closeAdminLogin.addEventListener('click', function() { document.getElementById('adminLoginModal').classList.remove('active'); });

const closeAdminDashboard = document.getElementById('closeAdminDashboard');
if (closeAdminDashboard) closeAdminDashboard.addEventListener('click', function() { document.getElementById('adminDashboard').classList.remove('active'); });

const adminLoginModal = document.getElementById('adminLoginModal');
if (adminLoginModal) adminLoginModal.addEventListener('click', function(e) { if(e.target===e.currentTarget) e.currentTarget.classList.remove('active'); });

let currentAdminPwd = '';

const adminLoginForm = document.getElementById('adminLoginForm');
if (adminLoginForm) {
  adminLoginForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    currentAdminPwd = document.getElementById('loginAdminPassword').value.trim();
    const btnText = document.querySelector('#btnAdminLoginSubmit .btn-submit-text');
    const btnLoad = document.querySelector('#btnAdminLoginSubmit .btn-submit-loading');
    
    btnText.style.display = 'none'; btnLoad.style.display = 'inline-flex';
    document.getElementById('adminLoginError').textContent = '';
    
    try {
      const res = await fetch(CONFIG.MASTER_APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'adminGetSchools', adminPassword: currentAdminPwd })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.message);
      
      document.getElementById('adminLoginModal').classList.remove('active');
      document.getElementById('adminDashboard').classList.add('active');
      renderAdminSchools(data);
    } catch(err) {
      let msg = err.message || 'รหัสผ่านไม่ถูกต้อง';
      if (msg.includes('fetch') || msg.includes('Unexpected')) msg = 'กรุณาตรวจสอบลิงก์ Master URL ในไฟล์ app.js';
      document.getElementById('adminLoginError').textContent = msg;
      currentAdminPwd = '';
    } finally {
      btnText.style.display = 'inline-flex'; btnLoad.style.display = 'none';
    }
  });
}

const refreshAdminBtn = document.getElementById('refreshAdminBtn');
if (refreshAdminBtn) refreshAdminBtn.addEventListener('click', refreshAdminSchools);

async function refreshAdminSchools() {
  const c = document.getElementById('adminSchoolsContainer');
  c.innerHTML = '<div class="loading-state"><svg class="spin" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><p>กำลังโหลด...</p></div>';
  try {
    const res = await fetch(CONFIG.MASTER_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'adminGetSchools', adminPassword: currentAdminPwd })
    });
    const data = await res.json();
    renderAdminSchools(data);
  } catch(err) {
    c.innerHTML = '<div class="empty-state">โหลดล้มเหลว</div>';
  }
}

function renderAdminSchools(schools) {
  const c = document.getElementById('adminSchoolsContainer');
  if (!schools || !schools.length) {
    c.innerHTML = '<div class="empty-state"><p>ยังไม่มีโรงเรียนในระบบ</p></div>';
    return;
  }
  c.innerHTML = schools.map(function(s) {
    return '<div class="admin-school-card" style="background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">' +
      '<div class="admin-school-info">' +
        '<h3 style="margin-bottom: 8px; font-size: 1.1rem; color: #1e293b;"><span class="admin-school-code" style="background: #e0f2fe; color: #0284c7; padding: 4px 8px; border-radius: 6px; font-size: 0.85rem; margin-right: 10px;">' + s.code + '</span> ' + s.name + '</h3>' +
        '<p style="color: #64748b; font-size: 0.9rem;"><span style="display:inline-block; width:90px;">รหัสผ่านครู:</span> <strong style="color: #334155; font-family: monospace; font-size: 1.05rem; background: #f1f5f9; padding: 2px 8px; border-radius: 4px;">' + s.teacherPassword + '</strong></p>' +
      '</div>' +
      '<button class="btn-delete-record" onclick="window.deleteSchool(\'' + s.code + '\')" style="background: #fee2e2; color: #ef4444; border: none; border-radius: 8px; padding: 8px 16px; font-weight: 600; cursor: pointer; transition: 0.2s;">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg> ลบ' +
      '</button>' +
    '</div>';
  }).join('');
}

const addSchoolForm = document.getElementById('addSchoolForm');
if (addSchoolForm) {
  addSchoolForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    const school = {
      code: document.getElementById('addSchoolCode').value.trim(),
      name: document.getElementById('addSchoolName').value.trim(),
      teacherPassword: document.getElementById('addSchoolTeacherPassword').value.trim(),
    };
    const btnText = document.querySelector('#btnAddSchool .btn-submit-text');
    const btnLoad = document.querySelector('#btnAddSchool .btn-submit-loading');
    btnText.style.display = 'none'; btnLoad.style.display = 'inline-flex';
    
    try {
      const res = await fetch(CONFIG.MASTER_APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'adminAddSchool', adminPassword: currentAdminPwd, school: school })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.message);
      
      showToast('เพิ่มโรงเรียนสำเร็จ', 'success');
      addSchoolForm.reset();
      refreshAdminSchools();
      fetchSchools();
    } catch(err) {
      showToast(err.message || 'เพิ่มล้มเหลว', 'error');
    } finally {
      btnText.style.display = 'inline-flex'; btnLoad.style.display = 'none';
    }
  });
}

window.deleteSchool = async function(code) {
  if(!confirm('ลบโรงเรียนนี้ออกจากระบบ?')) return;
  try {
    await fetch(CONFIG.MASTER_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'adminDeleteSchool', adminPassword: currentAdminPwd, code: code })
    });
    showToast('ลบสำเร็จ', 'success');
    refreshAdminSchools();
    fetchSchools();
  } catch(err) {
    showToast('ลบล้มเหลว', 'error');
  }
};

// ==================== TEACHER DASHBOARD ====================
async function openDashboard() {
  document.getElementById('teacherDashboard').classList.add('active');
  await loadDashboard();
}

async function loadDashboard() {
  const c = document.getElementById('recordsContainer');
  c.innerHTML = '<div class="loading-state"><svg class="spin" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg><p>กำลังโหลดข้อมูล...</p></div>';
  try {
    allRecords = await loadFromSheets();
    renderRecords(allRecords);
  } catch (err) {
    c.innerHTML = '<div class="empty-state"><p>⚠️ โหลดไม่สำเร็จ — ตรวจสอบ Apps Script URL</p></div>';
    showToast('โหลดข้อมูลไม่สำเร็จ', 'error');
  }
}

const closeDashboard = document.getElementById('closeDashboard');
if (closeDashboard) closeDashboard.addEventListener('click', function() { document.getElementById('teacherDashboard').classList.remove('active'); });

const refreshBtn = document.getElementById('refreshBtn');
if (refreshBtn) refreshBtn.addEventListener('click', loadDashboard);

// Get teacher location from dashboard
const getTeacherLocBtn = document.getElementById('getTeacherLocBtn');
if (getTeacherLocBtn) getTeacherLocBtn.addEventListener('click', function() {
  if (!navigator.geolocation) { showToast('ไม่รองรับ GPS', 'error'); return; }
  const btn = document.getElementById('getTeacherLocBtn');
  btn.disabled = true;
  btn.textContent = '⏳ กำลังหา...';
  navigator.geolocation.getCurrentPosition(
    function(pos) {
      teacherLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      btn.textContent = '✅ ได้ตำแหน่งแล้ว';
      btn.disabled = false;
      showToast('ได้ตำแหน่งครูแล้ว — ระยะทางจะแสดงในรายการ', 'success');
      const searchInput = document.getElementById('searchInput');
      const levelFilter = document.getElementById('filterLevel');
      const search = searchInput ? searchInput.value : '';
      const level = levelFilter ? levelFilter.value : '';
      renderRecords(getFiltered(search, level));
    },
    function() { showToast('ดึงตำแหน่งไม่ได้', 'error'); btn.disabled = false; btn.textContent = '📍 ตำแหน่งครู'; }
  );
});

// Sort by distance
const sortByDistBtn = document.getElementById('sortByDist');
if (sortByDistBtn) sortByDistBtn.addEventListener('change', function() {
  const searchInput = document.getElementById('searchInput');
  const levelFilter = document.getElementById('filterLevel');
  const search = searchInput ? searchInput.value : '';
  const level = levelFilter ? levelFilter.value : '';
  renderRecords(getFiltered(search, level));
});

// ==================== RENDER RECORDS ====================
function renderRecords(records) {
  const sortByDistEl = document.getElementById('sortByDist');
  const sortByDist = sortByDistEl && sortByDistEl.checked && teacherLocation;
  const visitedFilterEl = document.getElementById('filterVisited');
  const visitedFilter = visitedFilterEl ? visitedFilterEl.value : '';

  let list = [].concat(records);

  // Filter visited status
  if (visitedFilter === 'visited')   list = list.filter(function(r) { return getTD(r.id).visited; });
  if (visitedFilter === 'notVisited') list = list.filter(function(r) { return !getTD(r.id).visited; });

  // Sort by distance
  if (sortByDist) {
    list.sort(function(a, b) {
      const aLat = (a.pin && a.pin.lat) ? a.pin.lat : a.lat;
      const aLng = (a.pin && a.pin.lng) ? a.pin.lng : a.lng;
      const bLat = (b.pin && b.pin.lat) ? b.pin.lat : b.lat;
      const bLng = (b.pin && b.pin.lng) ? b.pin.lng : b.lng;
      const distA = aLat ? haversine(teacherLocation.lat, teacherLocation.lng, +aLat, +aLng) : 99999;
      const distB = bLat ? haversine(teacherLocation.lat, teacherLocation.lng, +bLat, +bLng) : 99999;
      return distA - distB;
    });
  }

  const withPin  = records.filter(function(r) { return (r.pin && r.pin.lat) || r.lat; }).length;
  const visited  = records.filter(function(r) { return getTD(r.id).visited; }).length;
  document.getElementById('statTotal').textContent    = records.length;
  document.getElementById('statWithPin').textContent  = withPin;
  document.getElementById('statVisited').textContent  = visited;
  document.getElementById('statNoPin').textContent    = records.length - withPin;

  const container = document.getElementById('recordsContainer');
  if (!list.length) {
    container.innerHTML = '<div class="empty-state"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>ไม่พบข้อมูล</p></div>';
    return;
  }

  container.innerHTML = list.map(function(r) { return renderCard(r); }).join('');
}

function renderCard(r) {
  const lat = +( (r.pin && r.pin.lat) ? r.pin.lat : (r.lat || 0));
  const lng = +( (r.pin && r.pin.lng) ? r.pin.lng : (r.lng || 0));
  const hasPin = lat && lng;
  const td = getTD(r.id);
  const color = getColor(r.id);

  const dt = new Date(r.timestamp);
  const dateStr = isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('th-TH', { day:'2-digit', month:'short', year:'numeric' });
  const timeStr = isNaN(dt.getTime()) ? '' : dt.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' });

  // Distance
  let distBadge = '';
  if (hasPin && teacherLocation) {
    const km = haversine(teacherLocation.lat, teacherLocation.lng, lat, lng);
    distBadge = '<span class="dist-badge">📏 ' + formatDist(km) + '</span>';
  }

  // Color pills
  const colorPills = MARKER_COLORS.map(function(c) {
    return '<button class="color-pill ' + (c.id === (td.colorId||'blue') ? 'active' : '') + '"' +
      ' style="background:' + c.hex + '" title="' + c.label + '"' +
      ' onclick="changeColor(\'' + r.id + '\',\'' + c.id + '\')"></button>';
  }).join('');

  // Navigation url (Google Maps Directions)
  const navUrl = hasPin
    ? 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng + '&travelmode=driving'
    : '';

  return (
    '<div class="record-card ' + (td.visited ? 'visited' : '') + '" data-id="' + r.id + '">' +
      '<div class="record-left">' +
        '<div class="record-color-dot" style="background:' + color.hex + '" title="' + color.label + '"></div>' +
        '<div class="record-badge">' + (r.studentLevel||'?') + '/' + (r.studentRoom||'?') + '</div>' +
      '</div>' +
      '<div class="record-body">' +
        '<div class="record-header">' +
          '<span class="record-name">' + (r.studentName||'—') + '</span>' +
          '<span class="record-class">เลขที่ ' + (r.studentNumber||'—') + '</span>' +
          (hasPin ? '<span class="has-pin-badge">📍</span>' : '<span class="no-pin-badge">📋</span>') +
          distBadge +
        '</div>' +
        '<div class="record-info">' +
          '<span>👤 ' + (r.parentName||'—') + '</span>' +
          '<span>📞 <a href="tel:' + (r.parentPhone||'') + '" class="phone-link">' + (r.parentPhone||'—') + '</a></span>' +
        '</div>' +
        '<div class="record-address">🏠 ' + (r.address||'—') + '</div>' +
        (r.note ? '<div class="record-note">📝 ' + r.note + '</div>' : '') +
        '<div class="record-time">🕐 ' + dateStr + (timeStr ? ' เวลา ' + timeStr + ' น.' : '') + '</div>' +
        '<div class="record-teacher-controls">' +
          '<button class="btn-visit-toggle ' + (td.visited ? 'visited' : '') + '"' +
            ' onclick="toggleVisited(\'' + r.id + '\')">' +
            (td.visited ? '✅ เยี่ยมแล้ว' : '☐ ทำเครื่องหมายว่าเยี่ยมแล้ว') +
          '</button>' +
          '<div class="color-picker-wrap">' +
            '<span class="color-picker-label">สัญลักษณ์:</span>' +
            '<div class="color-pills">' + colorPills + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="record-actions">' +
        (hasPin ? 
          '<a href="' + navUrl + '" target="_blank" rel="noopener" class="btn-navigate" title="นำทางไปบ้านนักเรียน">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>' +
            ' นำทาง' +
          '</a>' +
          '<a href="https://www.google.com/maps?q=' + lat + ',' + lng + '" target="_blank" rel="noopener" class="btn-open-map" title="ดูแผนที่">' +
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
            ' Maps' +
          '</a>' : '') +
        '<button class="btn-delete-record" onclick="handleDelete(\'' + r.id + '\')">' +
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>' +
          ' ลบ' +
        '</button>' +
      '</div>' +
    '</div>'
  );
}

// ==================== TEACHER ACTIONS ====================
function toggleVisited(id) {
  const td = getTD(id);
  setTD(id, {
    visited: !td.visited,
    visitDate: !td.visited ? new Date().toLocaleDateString('th-TH', { day:'2-digit', month:'short', year:'numeric' }) : ''
  });
  const searchInput = document.getElementById('searchInput');
  const filterLevel = document.getElementById('filterLevel');
  const search = searchInput ? searchInput.value : '';
  const level  = filterLevel ? filterLevel.value : '';
  renderRecords(getFiltered(search, level));
  updateTeacherMapMarker(id);
}

function changeColor(id, colorId) {
  setTD(id, { colorId: colorId });
  const searchInput = document.getElementById('searchInput');
  const filterLevel = document.getElementById('filterLevel');
  const search = searchInput ? searchInput.value : '';
  const level  = filterLevel ? filterLevel.value : '';
  renderRecords(getFiltered(search, level));
  updateTeacherMapMarker(id);
}

function updateTeacherMapMarker(id) {
  if (!teacherMap || !teacherMarkers[id]) return;
  const record = allRecords.find(function(r) { return r.id === id; });
  if (!record) return;
  const color = getColor(id);
  teacherMarkers[id].setIcon(leafletIcon(color.hex));
}

// ==================== SEARCH & FILTER ====================
function getFiltered(search, level) {
  return allRecords.filter(function(r) {
    const s = (search || '').toLowerCase();
    const matchSearch = !s
      || (r.studentName||'').toLowerCase().includes(s)
      || (r.parentName||'').toLowerCase().includes(s)
      || (r.address||'').toLowerCase().includes(s)
      || (r.studentLevel||'').includes(s)
      || (r.studentRoom||'').includes(s);
    const matchLevel = !level || r.studentLevel === level;
    return matchSearch && matchLevel;
  });
}

const searchInputEl = document.getElementById('searchInput');
if (searchInputEl) searchInputEl.addEventListener('input', function(e) {
  const filterLevelEl = document.getElementById('filterLevel');
  renderRecords(getFiltered(e.target.value, filterLevelEl ? filterLevelEl.value : ''));
});
const filterLevelEl = document.getElementById('filterLevel');
if (filterLevelEl) filterLevelEl.addEventListener('change', function(e) {
  const searchInputEl = document.getElementById('searchInput');
  renderRecords(getFiltered(searchInputEl ? searchInputEl.value : '', e.target.value));
});
const filterVisitedEl = document.getElementById('filterVisited');
if (filterVisitedEl) filterVisitedEl.addEventListener('change', function() {
  const searchInputEl = document.getElementById('searchInput');
  const filterLevelEl = document.getElementById('filterLevel');
  renderRecords(getFiltered(searchInputEl ? searchInputEl.value : '', filterLevelEl ? filterLevelEl.value : ''));
});
const sortByDistEl = document.getElementById('sortByDist');
if (sortByDistEl) sortByDistEl.addEventListener('change', function() {
  const searchInputEl = document.getElementById('searchInput');
  const filterLevelEl = document.getElementById('filterLevel');
  renderRecords(getFiltered(searchInputEl ? searchInputEl.value : '', filterLevelEl ? filterLevelEl.value : ''));
});

async function handleDelete(id) {
  if (!confirm('ต้องการลบข้อมูลนี้?')) return;
  try {
    await deleteFromSheets(id);
    delete teacherData[id];
    saveTD();
    allRecords = allRecords.filter(function(r) { return r.id !== id; });
    const searchEl = document.getElementById('searchInput');
    const levelEl = document.getElementById('filterLevel');
    const search = searchEl ? searchEl.value : '';
    const level  = levelEl ? levelEl.value : '';
    renderRecords(getFiltered(search, level));
    showToast('ลบสำเร็จ', 'success');
  } catch (e) { showToast('ลบไม่สำเร็จ', 'error'); }
}

// ==================== TEACHER MAP (All students) ====================
const openTeacherMapBtn = document.getElementById('openTeacherMapBtn');
if (openTeacherMapBtn) {
  openTeacherMapBtn.addEventListener('click', function() {
    document.getElementById('teacherMapModal').classList.add('active');
    setTimeout(function() {
      initTeacherMap();
      if (teacherMap) teacherMap.invalidateSize();
    }, 350);
  });
}

const closeTeacherMap = document.getElementById('closeTeacherMap');
if (closeTeacherMap) {
  closeTeacherMap.addEventListener('click', function() {
    document.getElementById('teacherMapModal').classList.remove('active');
  });
}

function initTeacherMap() {
  if (!teacherMap) {
    teacherMap = L.map('teacherMapView', { center: [13.7563, 100.5018], zoom: 10, tap: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(teacherMap);
  } else {
    teacherMap.invalidateSize();
  }

  Object.keys(teacherMarkers).forEach(function(k) { teacherMap.removeLayer(teacherMarkers[k]); });
  teacherMarkers = {};

  if (teacherLocation) {
    const teacherIcon = L.divIcon({
      html: '<div class="teacher-location-dot"></div>',
      className: '', iconSize: [20,20], iconAnchor: [10,10]
    });
    L.marker([teacherLocation.lat, teacherLocation.lng], { icon: teacherIcon })
      .bindPopup('<b>📍 ตำแหน่งครู</b>')
      .addTo(teacherMap);
  }

  const bounds = [];
  allRecords.forEach(function(r) {
    const lat = (r.pin && r.pin.lat) ? +r.pin.lat : (r.lat ? +r.lat : 0);
    const lng = (r.pin && r.pin.lng) ? +r.pin.lng : (r.lng ? +r.lng : 0);
    if (!lat || !lng) return;

    const color = getColor(r.id);
    const td = getTD(r.id);
    const dist = teacherLocation ? haversine(teacherLocation.lat, teacherLocation.lng, lat, lng) : null;
    const distStr = dist !== null ? '<br>📏 ห่าง ' + formatDist(dist) : '';
    const navUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng + '&travelmode=driving';
    const visitStatus = td.visited
      ? '<span style="color:#10b981;font-weight:700">✅ เยี่ยมแล้ว' + (td.visitDate ? ' (' + td.visitDate + ')' : '') + '</span>'
      : '<span style="color:#ef4444;font-weight:700">🔲 ยังไม่ได้ไป</span>';

    const popupHtml = '<div style="font-family:\'Sarabun\',sans-serif;min-width:200px;font-size:14px;">' +
        '<div style="font-size:16px;font-weight:800;margin-bottom:6px;">' + (r.studentName||'—') + '</div>' +
        '<div style="color:#6b7280;margin-bottom:4px;">ชั้น ' + (r.studentLevel||'?') + '/' + (r.studentRoom||'?') + ' เลขที่ ' + (r.studentNumber||'?') + '</div>' +
        '<div style="margin-bottom:2px;">👤 ' + (r.parentName||'—') + '</div>' +
        '<div style="margin-bottom:2px;">📞 <a href="tel:' + (r.parentPhone||'') + '">' + (r.parentPhone||'—') + '</a></div>' +
        '<div style="margin-bottom:4px;">🏠 ' + (r.address||'—') + '</div>' +
        '<div style="margin-bottom:8px;">' + visitStatus + distStr + '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
          '<a href="' + navUrl + '" target="_blank" style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;background:#4f46e5;color:white;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;">▶ นำทาง Google Maps</a>' +
          '<button onclick="toggleVisitedFromMap(\'' + r.id + '\')" style="padding:6px 12px;background:' + (td.visited?'#d1fae5':'#fef3c7') + ';color:' + (td.visited?'#065f46':'#92400e') + ';border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px;font-family:\'Sarabun\',sans-serif;">' + (td.visited ? '✅ เยี่ยมแล้ว' : '☐ ทำเครื่องหมาย') + '</button>' +
        '</div>' +
      '</div>';

    const m = L.marker([lat, lng], { icon: leafletIcon(color.hex) })
      .bindPopup(popupHtml, { maxWidth: 280 })
      .addTo(teacherMap);

    teacherMarkers[r.id] = m;
    bounds.push([lat, lng]);
  });

  if (bounds.length > 0) {
    teacherMap.fitBounds(bounds, { padding: [40, 40] });
  }
}

function toggleVisitedFromMap(id) {
  toggleVisited(id);
  if (teacherMarkers[id]) {
    teacherMarkers[id].closePopup();
    initTeacherMap();
  }
}

const mapStudentSearchEl = document.getElementById('mapStudentSearch');
if (mapStudentSearchEl) mapStudentSearchEl.addEventListener('input', function(e) {
  const q = e.target.value.toLowerCase().trim();
  if (!q) return;
  const record = allRecords.find(function(r) {
    return (r.studentName||'').toLowerCase().includes(q) || (r.studentLevel||'').toLowerCase().includes(q);
  });
  if (record) {
    const lat = +((record.pin && record.pin.lat) ? record.pin.lat : (record.lat || 0));
    const lng = +((record.pin && record.pin.lng) ? record.pin.lng : (record.lng || 0));
    if (lat && lng && teacherMap) {
      teacherMap.setView([lat, lng], 16);
      if (teacherMarkers[record.id]) teacherMarkers[record.id].openPopup();
    } else {
      showToast('นักเรียนคนนี้ไม่มีพิกัด', 'info');
    }
  } else {
    showToast('ไม่พบนักเรียน', 'info');
  }
});

// ==================== EXPORT CSV ====================
const exportBtnEl = document.getElementById('exportBtn');
if (exportBtnEl) exportBtnEl.addEventListener('click', function() {
  if (!allRecords.length) { showToast('ไม่มีข้อมูลให้ส่งออก', 'info'); return; }
  const headers = ['ลำดับ','วันที่','เวลา','ชื่อนักเรียน','ชั้น','ห้อง','เลขที่','ชื่อผู้ปกครอง','โทรศัพท์','ที่อยู่','ละติจูด','ลองจิจูด','Google Maps','หมายเหตุ','สถานะเยี่ยม','วันที่เยี่ยม'];
  const rows = allRecords.map((r, i) => {
    const dt = new Date(r.timestamp);
    const td = getTD(r.id);
    const lat = r.pin?.lat ?? r.lat ?? '';
    const lng = r.pin?.lng ?? r.lng ?? '';
    return [
      i+1,
      isNaN(dt) ? '' : dt.toLocaleDateString('th-TH'),
      isNaN(dt) ? '' : dt.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}),
      r.studentName, r.studentLevel, r.studentRoom, r.studentNumber,
      r.parentName, r.parentPhone, r.address, lat, lng,
      (lat&&lng) ? `https://www.google.com/maps?q=${lat},${lng}` : '',
      r.note||'',
      td.visited ? 'เยี่ยมแล้ว' : 'ยังไม่ได้ไป',
      td.visitDate || ''
    ].map(v => `"${String(v??'').replace(/"/g,'""')}"`).join(',');
  });
  const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'})),
    download: `home_visit_${new Date().toISOString().slice(0,10)}.csv`
  });
  a.click();
  showToast('ส่งออก CSV สำเร็จ ✅', 'success');
});

// ==================== MISC ====================
document.getElementById('heroScrollBtn')?.addEventListener('click', e => {
  e.preventDefault();
  document.getElementById('register-section')?.scrollIntoView({ behavior: 'smooth' });
});

document.querySelectorAll('input, select, textarea').forEach(el => {
  el.addEventListener('input',  () => el.classList.remove('error'));
  el.addEventListener('change', () => el.classList.remove('error'));
});

// Extra CSS
const extraStyle = document.createElement('style');
extraStyle.textContent = `
@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}
.teacher-location-dot{width:20px;height:20px;border-radius:50%;background:#4f46e5;border:3px solid white;box-shadow:0 0 0 4px rgba(79,70,229,0.3);animation:teacherPulse 2s ease-in-out infinite;}
@keyframes teacherPulse{0%,100%{box-shadow:0 0 0 4px rgba(79,70,229,0.3)}50%{box-shadow:0 0 0 10px rgba(79,70,229,0)}}
`;
document.head.appendChild(extraStyle);

console.log('✅ Home Visit System — Teacher Features Active');
