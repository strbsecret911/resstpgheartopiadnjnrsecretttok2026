// app.js (ESM module) - HEARTOPIA VERSION

// =======================
// FIREBASE (CDN)
// =======================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  doc,
  collection,
  onSnapshot,
  setDoc,
  serverTimestamp,
  writeBatch,
  deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDDQeZpHp5bFay6gRigg0pddEUqOL3cytQ",
  authDomain: "rbxvilogress.firebaseapp.com",
  projectId: "rbxvilogress",
  storageBucket: "rbxvilogress.firebasestorage.app",
  messagingSenderId: "907657980689",
  appId: "1:907657980689:web:3282ce42765c3643e47ab0",
  measurementId: "G-ZQ6EP4D1DD"
};

const ADMIN_EMAIL = "dinijanuari23@gmail.com";

// ✅ OPEN/CLOSE TETAP SAMA (global)
const STORE_DOC_PATH = ["settings", "store"]; // settings/store -> { open: true/false }

// ✅ DIPISAH KHUSUS HEARTOPIA
const PRICE_COL = "pricelist_heartopia"; // collection khusus heartopia
const ANNOUNCE_DOC_PATH = ["settings", "announcement_heartopia"]; // doc khusus heartopia

// ✅ Kategori dropdown fixed (Heartopia)
const CATEGORY_OPTIONS = [
  "Heart Diamond",
  "Membership"
];

// panel admin hanya tampil kalau URL ada ?admin=1
const wantAdminPanel = new URLSearchParams(window.location.search).get("admin") === "1";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

let storeOpen = true;
let isAdmin = false;

// cache items
let pricelistCache = []; // [{id, category, type, label, price, sort}]
let adminDraft = [];     // editable copy for admin

// announcement cache
let announcementText = "";

// =======================
// POPUP iOS (OK only)
// =======================
function showPopup(title, message, submessage){
  const existing = document.getElementById('validationCenterPopup');
  if(existing) existing.remove();

  const container = document.getElementById('validationContainer') || document.body;

  const popup = document.createElement('div');
  popup.id = 'validationCenterPopup';
  popup.className = 'validation-center';
  popup.tabIndex = -1;

  const safeTitle = title || 'Notification';
  const safeMsg = message || '';
  const safeSub = submessage || '';

  popup.innerHTML = `
    <div class="hdr">${safeTitle}</div>
    <div class="divider"></div>
    <div class="txt">${safeMsg}</div>
    ${safeSub ? `<div class="subtxt">${safeSub}</div>` : ``}
    <div class="btnRow">
      <button type="button" class="okbtn">OK</button>
    </div>
  `;

  container.appendChild(popup);

  const okBtn = popup.querySelector('.okbtn');

  function removePopup(){
    popup.style.transition = 'opacity 160ms ease, transform 160ms ease';
    popup.style.opacity = '0';
    popup.style.transform = 'translate(-50%,-50%) scale(.98)';
    setTimeout(()=> popup.remove(), 170);
  }

  okBtn.addEventListener('click', removePopup);
  popup.focus({preventScroll:true});

  const t = setTimeout(removePopup, 7000);
  window.addEventListener('pagehide', ()=>{ clearTimeout(t); if(popup) popup.remove(); }, { once:true });
}

// =======================
// UTILS
// =======================
function escapeHtml(str){
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function rupiah(num){
  const n = Number(num || 0);
  return "Rp" + new Intl.NumberFormat('id-ID').format(n);
}

function groupByCategory(items){
  const map = new Map();
  for(const it of items){
    const cat = it.category || 'Lainnya';
    if(!map.has(cat)) map.set(cat, []);
    map.get(cat).push(it);
  }
  return map;
}

function normalizeAndSort(items){
  const cleaned = items.map(it => ({
    ...it,
    category: String(it.category || 'Lainnya'),
    type: String(it.type || ''),
    label: String(it.label || ''),
    price: Number(it.price || 0),
    sort: Number(it.sort || 0),
  }));

  cleaned.sort((a,b)=>{
    const c = a.category.localeCompare(b.category);
    if(c !== 0) return c;
    return (a.sort - b.sort);
  });

  return cleaned;
}

// =======================
// STORE STATUS UI (OPEN/CLOSE)
// =======================
function applyStoreStatusUI(){
  const badge = document.getElementById('adminBadge');
  if(badge){
    badge.textContent = storeOpen ? 'OPEN' : 'CLOSED';
    badge.style.borderColor = storeOpen ? '#bbf7d0' : '#fecaca';
    badge.style.background = storeOpen ? '#ecfdf5' : '#fef2f2';
    badge.style.color = storeOpen ? '#14532d' : '#7f1d1d';
  }

  const btn = document.getElementById('btnTg') || document.getElementById('btnWa');
  if(btn) btn.disabled = false;
}

// =======================
// ANNOUNCEMENT BOARD UI
// =======================
function ensureAnnouncementRoot(){
  let root = document.getElementById('announcementRoot');

  if(!root){
    const body = document.body;
    root = document.createElement('div');
    root.id = 'announcementRoot';
    body.insertBefore(root, body.firstChild);
  }

  return root;
}

function renderAnnouncementToPage(){
  const root = ensureAnnouncementRoot();
  if(!root) return;

  const txt = String(announcementText || '').trim();

  root.innerHTML = `
    <div class="category">
      <h3>Board Announcement</h3>
      <div class="pricelist-container">
        <div class="price-box" style="width:100%; cursor:default;">
          <div style="font-size:13px; line-height:1.5; white-space:pre-wrap;">
            ${txt ? escapeHtml(txt) : `<span style="color:#9ca3af;">Belum ada pengumuman.</span>`}
          </div>
        </div>
      </div>
    </div>
  `;
}

// =======================
// ADMIN UI
// =======================
function applyAdminUI(user){
  const panel = document.getElementById('adminPanel');
  const btnLogin = document.getElementById('btnAdminLogin');
  const btnLogout = document.getElementById('btnAdminLogout');
  const emailEl = document.getElementById('adminEmail');
  const btnSetOpen = document.getElementById('btnSetOpen');
  const btnSetClose = document.getElementById('btnSetClose');

  if(!panel) return;
  panel.style.display = wantAdminPanel ? 'block' : 'none';

  if(!btnLogin || !btnLogout || !emailEl || !btnSetOpen || !btnSetClose) return;

  if(user){
    btnLogin.style.display = 'none';
    btnLogout.style.display = 'inline-block';
    emailEl.textContent = user.email || '';
  } else {
    btnLogin.style.display = 'inline-block';
    btnLogout.style.display = 'none';
    emailEl.textContent = '';
  }

  btnSetOpen.disabled = !isAdmin;
  btnSetClose.disabled = !isAdmin;

  const btnAdd = document.getElementById('btnAddItem');
  const btnSave = document.getElementById('btnSaveAll');
  if(btnAdd) btnAdd.disabled = !isAdmin;
  if(btnSave) btnSave.disabled = !isAdmin;

  const announceArea = document.getElementById('adminAnnouncementText');
  const btnSaveAnn = document.getElementById('btnSaveAnnouncement');
  if(announceArea) announceArea.disabled = !isAdmin;
  if(btnSaveAnn) btnSaveAnn.disabled = !isAdmin;

  renderAdminList();
}

async function setStoreOpen(flag){
  if(!isAdmin){
    showPopup('Notification', 'Akses ditolak', 'Hanya admin yang bisa mengubah status.');
    return;
  }
  const ref = doc(db, STORE_DOC_PATH[0], STORE_DOC_PATH[1]);
  await setDoc(ref, { open: !!flag, updatedAt: serverTimestamp() }, { merge: true });
}

// =======================
// ANNOUNCEMENT: REALTIME LISTENER
// =======================
function startAnnouncementListener(){
  const ref = doc(db, ANNOUNCE_DOC_PATH[0], ANNOUNCE_DOC_PATH[1]);

  onSnapshot(ref, (snap) => {
    if(snap.exists()){
      const data = snap.data() || {};
      announcementText = String(data.text || '');
    } else {
      announcementText = '';
    }
    renderAnnouncementToPage();

    const ta = document.getElementById('adminAnnouncementText');
    if(ta && document.activeElement !== ta){
      ta.value = announcementText;
    }
  }, (err) => {
    console.error(err);
    announcementText = '';
    renderAnnouncementToPage();
  });
}

async function adminSaveAnnouncement(){
  if(!isAdmin){
    showPopup('Notification', 'Akses ditolak', 'Login admin dulu ya.');
    return;
  }

  const ta = document.getElementById('adminAnnouncementText');
  if(!ta) return;

  const text = String(ta.value || '');

  const ref = doc(db, ANNOUNCE_DOC_PATH[0], ANNOUNCE_DOC_PATH[1]);
  await setDoc(ref, { text, updatedAt: serverTimestamp() }, { merge: true });

  showPopup('Notification', 'Tersimpan', 'Announcement berhasil diupdate.');
}

// =======================
// PRICELIST: REALTIME LISTENER
// =======================
let unsubPricelist = null;

function startPricelistListener(){
  let root = document.getElementById('pricelistRoot');

  if(!root){
    const form = document.querySelector('.form-container');
    root = document.createElement('div');
    root.id = 'pricelistRoot';

    if(form && form.parentNode){
      form.parentNode.insertBefore(root, form);
    } else {
      document.body.insertBefore(root, document.body.firstChild);
    }
  }

  const colRef = collection(db, PRICE_COL);

  unsubPricelist = onSnapshot(colRef, (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    pricelistCache = normalizeAndSort(items);

    adminDraft = pricelistCache.map(x => ({ ...x }));

    renderPricelistToPage();
    renderAdminList();
  }, (err) => {
    console.error(err);
    showPopup(
      'Notification',
      'Pricelist gagal dimuat',
      err?.message?.includes('permission')
        ? 'Firestore Rules kemungkinan belum allow read.'
        : (err?.message || 'Error')
    );
  });
}

function renderPricelistToPage(){
  const root = document.getElementById('pricelistRoot');
  if(!root) return;

  if(!pricelistCache.length){
    root.innerHTML = `
      <div class="category">
        <h3>Pricelist</h3>
        <div style="color:#9ca3af;font-size:13px;padding:10px;">
          Belum ada item pricelist. Admin bisa tambah dari panel.
        </div>
      </div>
    `;
    return;
  }

  const grouped = groupByCategory(pricelistCache);

  let html = '';
  for(const [cat, arr] of grouped.entries()){
    html += `
      <div class="category">
        <h3>${escapeHtml(cat)}</h3>
        <div class="pricelist-container">
          ${arr.map(it => `
            <div class="price-box" data-id="${escapeHtml(it.id)}">
              ${escapeHtml(it.label || '')}
              <span>${escapeHtml(rupiah(it.price))}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  root.innerHTML = html;

  root.querySelectorAll('.price-box').forEach(box => {
    box.addEventListener('click', () => {
      const id = box.getAttribute('data-id');
      const it = pricelistCache.find(x => x.id === id);
      if(!it) return;
      window.isiForm(String(it.label || ''), String(it.price || 0), String(it.type || ''), String(it.category || ''));
    });
  });
}

// =======================
// ADMIN CRUD PRICELIST
// =======================
function renderAdminList(){
  const wrap = document.getElementById('adminList');
  if(!wrap) return;

  if(!wantAdminPanel){
    wrap.innerHTML = '';
    return;
  }

  if(!isAdmin){
    wrap.innerHTML = `<div class="admin-savemsg">Login admin dulu untuk edit pricelist.</div>`;
    return;
  }

  if(!adminDraft.length){
    wrap.innerHTML = `<div class="admin-savemsg">Belum ada item.</div>`;
    return;
  }

  wrap.innerHTML = adminDraft.map((it, idx) => {
    return `
      <div class="admin-row" data-idx="${idx}">
        <div class="admin-row-top">
          <div class="admin-row-id">ID: ${escapeHtml(it.id || '(baru)')}</div>
          <button type="button" class="admin-del" data-act="del">Hapus</button>
        </div>

        <div class="admin-grid">
          <div>
            <label>Kategori (judul section)</label>
            <select data-k="category">
              ${CATEGORY_OPTIONS.map(opt => `
                <option value="${escapeHtml(opt)}" ${String(it.category||'') === opt ? 'selected' : ''}>
                  ${escapeHtml(opt)}
                </option>
              `).join('')}
            </select>
          </div>

          <div>
            <label>Tipe</label>
            <input type="text" data-k="type" value="${escapeHtml(it.type || '')}" readonly>
          </div>

          <div class="full">
            <label>Label</label>
            <input type="text" data-k="label" value="${escapeHtml(it.label || '')}">
          </div>

          <div>
            <label>Harga (angka)</label>
            <input type="number" min="0" step="1" data-k="price" value="${Number(it.price || 0)}">
          </div>

          <div>
            <label>Sort</label>
            <input type="number" step="1" data-k="sort" value="${Number(it.sort || 0)}">
          </div>
        </div>
      </div>
    `;
  }).join('');

  wrap.querySelectorAll('.admin-row').forEach(row => {
    const idx = Number(row.getAttribute('data-idx'));

    row.querySelectorAll('input, select').forEach(el => {
      const evt = (el.tagName === 'SELECT') ? 'change' : 'input';
      el.addEventListener(evt, () => {
        const k = el.getAttribute('data-k');
        let v = el.value;
        if(k === 'price' || k === 'sort') v = Number(v || 0);

        // auto set type by category
        if(k === 'category'){
          const cat = String(v || '');
          adminDraft[idx].category = cat;
          adminDraft[idx].type = (cat === 'Membership') ? 'Membership' : 'Hearts Dm';

          // refresh row type field
          const typeInput = row.querySelector('input[data-k="type"]');
          if(typeInput) typeInput.value = adminDraft[idx].type;
          return;
        }

        adminDraft[idx][k] = v;
      });
    });

    row.querySelector('[data-act="del"]').addEventListener('click', async () => {
      if(!isAdmin) return;

      const item = adminDraft[idx];
      if(!confirm('Hapus item ini?')) return;

      if(item.id){
        await deleteDoc(doc(db, PRICE_COL, item.id));
      }
    });
  });
}

function adminAddItem(){
  if(!isAdmin){
    showPopup('Notification', 'Akses ditolak', 'Login admin dulu ya.');
    return;
  }

  const defaultCat = CATEGORY_OPTIONS[0];

  adminDraft.unshift({
    id: '',
    category: defaultCat,
    type: 'Hearts Dm', // auto sesuai default category
    label: 'Item Baru',
    price: 0,
    sort: 0
  });
  renderAdminList();
}

async function adminSaveAll(){
  if(!isAdmin){
    showPopup('Notification', 'Akses ditolak', 'Login admin dulu ya.');
    return;
  }

  const msg = document.getElementById('adminSaveMsg');
  if(msg) msg.textContent = 'Menyimpan...';

  for(const it of adminDraft){
    if(!String(it.category||'').trim() || !String(it.label||'').trim()){
      if(msg) msg.textContent = 'Gagal: kategori & label wajib diisi.';
      showPopup('Notification', 'Oops', 'Kategori dan label wajib diisi.');
      return;
    }
    if(Number(it.price) < 0){
      if(msg) msg.textContent = 'Gagal: harga tidak boleh minus.';
      showPopup('Notification', 'Oops', 'Harga tidak boleh minus.');
      return;
    }
  }

  const batch = writeBatch(db);
  const colRef = collection(db, PRICE_COL);

  for(const it of adminDraft){
    // auto type by category (final enforce)
    const finalType = (String(it.category) === 'Membership') ? 'Membership' : 'Hearts Dm';

    const data = {
      category: String(it.category).trim(),
      type: finalType,
      label: String(it.label).trim(),
      price: Number(it.price || 0),
      sort: Number(it.sort || 0),
      updatedAt: serverTimestamp()
    };

    if(it.id){
      batch.set(doc(db, PRICE_COL, it.id), data, { merge: true });
    }else{
      const newRef = doc(colRef);
      it.id = newRef.id;
      batch.set(newRef, { ...data, createdAt: serverTimestamp() });
    }
  }

  await batch.commit();
  if(msg) msg.textContent = '✅ Tersimpan';
}

// =======================
// FORM LOGIC (Heartopia VILOG)
// =======================
function formatHarga(harga){
  const hargaNumber = typeof harga === 'number' ? harga : Number(String(harga).replace(/[^\d]/g,''));
  return { hargaNumber, hargaText: "Rp" + new Intl.NumberFormat('id-ID').format(hargaNumber) };
}

window.isiForm = function isiForm(orderLabel, harga, type, category) {
  const kt = document.getElementById("kt");
  if(kt) kt.value = String(category || '');

  const nm = document.getElementById("nm");
  if(nm) nm.value = String(orderLabel || '');

  const { hargaText } = formatHarga(harga);
  const hg = document.getElementById("hg");
  if(hg) hg.value = hargaText;

  document.getElementById("frm")?.scrollIntoView({ behavior: 'smooth' });
};

// =======================
// DOM READY
// =======================
document.addEventListener('DOMContentLoaded', function(){

  // realtime listeners
  startAnnouncementListener();
  startPricelistListener();

  // =======================
  // FIRESTORE: LISTEN STORE STATUS (GLOBAL)
  // =======================
  const storeRef = doc(db, STORE_DOC_PATH[0], STORE_DOC_PATH[1]);
  onSnapshot(storeRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      storeOpen = (data.open !== false);
    } else {
      storeOpen = true;
    }
    applyStoreStatusUI();
  }, () => {
    storeOpen = true;
    applyStoreStatusUI();
  });

  // =======================
  // AUTH: ADMIN ONLY
  // =======================
  onAuthStateChanged(auth, (user) => {
    isAdmin = !!(user && (user.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase());
    applyAdminUI(user);

    if (user && !isAdmin) {
      signOut(auth).catch(()=>{});
      showPopup('Notification', 'Akses ditolak', 'Email ini bukan admin.');
    }
  });

  applyAdminUI(null);

  document.getElementById('btnAdminLogin')?.addEventListener('click', async ()=>{
    try { await signInWithPopup(auth, provider); }
    catch(e){ showPopup('Notification', 'Login gagal', 'Login dibatalkan / gagal.'); }
  });

  document.getElementById('btnAdminLogout')?.addEventListener('click', async ()=>{
    try { await signOut(auth); } catch(e){}
  });

  document.getElementById('btnSetOpen')?.addEventListener('click', ()=> setStoreOpen(true));
  document.getElementById('btnSetClose')?.addEventListener('click', ()=> setStoreOpen(false));

  document.getElementById('btnAddItem')?.addEventListener('click', adminAddItem);
  document.getElementById('btnSaveAll')?.addEventListener('click', adminSaveAll);

  document.getElementById('btnSaveAnnouncement')?.addEventListener('click', adminSaveAnnouncement);
});

  // =======================
  // KIRIM TELEGRAM
  // =======================
  document.getElementById("btnTg")?.addEventListener("click", function() {

    if (!storeOpen) {
      showPopup('Notification','CLOSE','Mohon maaf, saat ini kamu belum bisa melakukan pemesanan. Silahkan kembali lagi nanti.');
      return;
    }

    const form = document.getElementById("frm");
    if(!form) return;

    const inputs = form.querySelectorAll("input[required], select[required]");
    for (const input of inputs) {
      if (input.type === 'checkbox') {
        if (!input.checked) {
          showPopup('Notification', 'Oops', 'Harap centang persetujuan OTP/standby.');
          try{ input.focus(); }catch(e){}
          return;
        }
      } else {
        if (!String(input.value || '').trim()) {
          showPopup('Notification', 'Oops', 'Harap isi semua kolom yang wajib diisi!');
          try{ input.focus(); }catch(e){}
          return;
        }
      }
    }

    const loginMethod = document.getElementById("loginMethod")?.value || '';
    const email = document.getElementById("email")?.value.trim() || '';
    const pwd = document.getElementById("pwd")?.value.trim() || '';
    const v2 = document.getElementById("v2")?.value || '';
    const agreeOtp = document.getElementById("agreeOtp")?.checked ? 'YES' : 'NO';

    const kt = document.getElementById("kt")?.value || '';
    const nm = document.getElementById("nm")?.value || '';
    const hg = document.getElementById("hg")?.value || '';

    const botToken = "8039852277:AAEqbfQUF37cjDlEposj2rzHm28_Pxzv-mw";
    const chatId = "-1003049680083";

    const text =
      "Pesanan Baru Masuk! (Heartopia VILOG)\n\n" +
      "Metode Login: " + loginMethod + "\n" +
      "Email: " + email + "\n" +
      "Password: " + pwd + "\n" +
      "Server: " + v2 + "\n" +
      "Standby OTP: " + agreeOtp + "\n\n" +
      "Kategori: " + kt + "\n" +
      "Order: " + nm + "\n" +
      "Harga: " + hg;

    fetch("https://api.telegram.org/bot" + botToken + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text })
    })
    .then(res => {
      if (res.ok) {
        showPopup('Notification', 'Terkirim', 'Pesanan berhasil dikirim ke Telegram.');
        form.reset();
      } else {
        showPopup('Notification', 'Gagal', 'Gagal mengirim ke Telegram. Coba lagi.');
      }
    })
    .catch((error) => {
      console.error(error);
      showPopup('Notification', 'Error', 'Terjadi kesalahan saat mengirim ke Telegram.');
    });
  });
});
