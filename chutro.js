(() => {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const qs = new URLSearchParams(location.search);
    const emailQS = (qs.get('email') || '').trim();

    const btnOpen = document.getElementById('menu-profile');
    const form = document.getElementById('frm-profile');
    const panelProfile = document.getElementById('panel-profile');

    const btnVerify = document.getElementById('menu-verify');
    const panelVerify = document.getElementById('panel-verify');
    const verifyText = document.getElementById('verify-status-text');
    const frmVerify = document.getElementById('frm-verify');
    const loaiGiayTo = document.getElementById('loaiGiayTo');
    const fileInput = document.getElementById('fileMinhChung');
    const previewImg = document.getElementById('verify-preview');

    const btnPost = document.getElementById('menu-post');
    const panelPost = document.getElementById('panel-post');
    const postGuard = document.getElementById('post-guard');

    // New: create room + utilities
    const frmRoom = document.getElementById('frm-room');
    const roomTitle = document.getElementById('room-title');
    const roomDesc = document.getElementById('room-desc');
    const roomDiaChi = document.getElementById('room-diachi');
    const roomPhuongXa = document.getElementById('room-phuongxa');
    const roomQuanHuyen = document.getElementById('room-quanhuyen');
    const roomThanhPho = document.getElementById('room-thanhpho');
    const roomDienTich = document.getElementById('room-dientich');
    const roomGia = document.getElementById('room-gia');
    const roomSoNguoiToiDa = document.getElementById('room-songuoitoida');
    const roomMapUrl = document.getElementById('room-mapurl');
    const tienIchList = document.getElementById('tienich-list');
    const roomSelect = document.getElementById('post-room-select');

    // Existing: image upload
    const frmPost = document.getElementById('frm-post');
    const postPhongId = document.getElementById('post-phongId');
    const postFiles = document.getElementById('post-files');
    const postGallery = document.getElementById('post-gallery');

    if (!btnOpen || !form || !panelProfile) return;

    const el = {
      email: document.getElementById('email'),
      hoTen: document.getElementById('hoTen'),
      soDienThoai: document.getElementById('soDienThoai'),
      diaChiLienHe: document.getElementById('diaChiLienHe'),
    };

    const overlay = document.getElementById('hop-thong-bao-nen');
    const overlayMsg = document.getElementById('hop-thong-bao-noi-dung');
    const overlayClose = document.getElementById('hop-thong-bao-dong');
    if (overlayClose) overlayClose.addEventListener('click', () => (overlay.style.display = 'none'));
    function showMsg(msg) {
      if (!overlay || !overlayMsg) return alert(msg);
      overlayMsg.textContent = msg;
      overlay.style.display = 'flex';
    }
    async function readJsonOrThrow(resp) {
      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      const text = await resp.text();
      let json;
      if (!ct.includes('application/json')) throw new Error(text.slice(0, 200));
      try { json = JSON.parse(text); } catch { throw new Error(text.slice(0, 200)); }
      if (!resp.ok || !json.success) throw new Error(json.message || 'Lỗi máy chủ');
      return json;
    }
    function showPanel(which) {
      panelProfile.style.display = (which === 'profile') ? 'block' : 'none';
      if (panelVerify) panelVerify.style.display = (which === 'verify') ? 'block' : 'none';
      if (panelPost) panelPost.style.display = (which === 'post') ? 'block' : 'none';
      document.querySelectorAll('.menu .menu-item').forEach(b => b.classList.remove('active'));
      const map = { profile: 'menu-profile', verify: 'menu-verify', post: 'menu-post' };
      document.getElementById(map[which])?.classList.add('active');
    }

    async function loadProfile() {
      if (!emailQS) { showMsg('Thiếu email. Vui lòng đăng nhập lại.'); return; }
      try {
        const resp = await fetch(`/api/chutro/profile?email=${encodeURIComponent(emailQS)}`, { headers: { Accept: 'application/json' } });
        const json = await readJsonOrThrow(resp);
        const d = json.data || {};
        el.email.value = d.Email || emailQS;
        el.hoTen.value = d.HoTen || '';
        el.soDienThoai.value = d.SoDienThoai || '';
        el.diaChiLienHe.value = d.DiaChiLienHe || '';
        showPanel('profile');
      } catch (e) { console.error(e); showMsg(e.message || 'Lỗi tải hồ sơ'); }
    }

    async function saveProfile(e) {
      e.preventDefault();
      const payload = {
        email: el.email.value.trim(),
        hoTen: el.hoTen.value.trim(),
        soDienThoai: el.soDienThoai.value.trim(),
        diaChiLienHe: el.diaChiLienHe.value.trim(),
      };
      if (!payload.email) return showMsg('Thiếu email');
      try {
        const resp = await fetch('/api/chutro/profile', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload)
        });
        await readJsonOrThrow(resp);
        showMsg('Cập nhật hồ sơ thành công');
      } catch (e2) { console.error(e2); showMsg(e2.message || 'Lỗi lưu hồ sơ'); }
    }

    // New: track verified state
    let isVerified = false;

    // Xác thực: tải trạng thái
    async function loadVerifyStatus() {
      if (!emailQS || !verifyText) return;
      try {
        const json = await fetch(`/api/chutro/verify-status?email=${encodeURIComponent(emailQS)}`).then(readJsonOrThrow);
        const st = json.data || {};
        const mapSt = { 0: 'Chờ duyệt', 1: 'Đã duyệt', 2: 'Đã từ chối' };
        const lr = st.lastRequest;

        let text = st.verified ? 'ĐÃ XÁC THỰC' : (lr ? mapSt[lr.TrangThai] : 'Chưa gửi yêu cầu');
        if (st.verified && st.verifiedAt) {
          const at = new Date(st.verifiedAt);
          if (!isNaN(at.getTime())) {
            text += ` (${at.toLocaleString('vi-VN')})`;
          }
        }
        // New: set verified flag if system marks verified or last request approved
        isVerified = !!st.verified || (lr && lr.TrangThai === 1);

        // Update UI text
        verifyText.textContent = isVerified
          ? `Trạng thái: ${text}. Bạn đã được xác thực, không cần gửi lại yêu cầu.`
          : `Trạng thái: ${text}`;

        // New: enable/disable form based on verified state
        if (frmVerify) {
          const ctrls = frmVerify.querySelectorAll('input, select, button[type="submit"]');
          ctrls.forEach(el => { el.disabled = isVerified; });
          // Hide preview image if disabled
          if (isVerified && previewImg) previewImg.style.display = 'none';
        }

        if (postGuard) postGuard.style.display = st.verified ? 'none' : 'block';
      } catch (e) {
        verifyText.textContent = 'Trạng thái: lỗi tải';
      }
    }

    // Gửi yêu cầu xác thực
    frmVerify?.addEventListener('submit', async (e) => {
      e.preventDefault();
      // New: block resubmission if already verified
      if (isVerified) {
        showMsg('Bạn đã được xác thực. Không cần gửi lại yêu cầu.');
        return;
      }
      if (!emailQS) return showMsg('Thiếu email');
      const f = fileInput?.files?.[0];
      if (!f) return showMsg('Vui lòng chọn tệp minh chứng');
      try {
        const base64 = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(new Error('Không đọc được tệp'));
          r.readAsDataURL(f);
        });
        const payload = { email: emailQS, loaiGiayTo: loaiGiayTo.value, fileBase64: base64 };
        await fetch('/api/chutro/verify-request', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload)
        }).then(readJsonOrThrow);
        showMsg('Đã gửi yêu cầu xác thực. Vui lòng chờ duyệt.');
        loadVerifyStatus();
      } catch (err) {
        showMsg(err.message || 'Lỗi gửi yêu cầu');
      }
    });

    // Preview selected verification image
    fileInput?.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (!f) { if (previewImg) previewImg.style.display = 'none'; return; }
      const r = new FileReader();
      r.onload = () => {
        if (previewImg) {
          previewImg.src = String(r.result);
          previewImg.style.display = 'block';
        }
      };
      r.readAsDataURL(f);
    });

    // Helpers for image upload
    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(new Error('Không đọc được tệp'));
        r.readAsDataURL(file);
      });
    }

    async function loadGallery() {
      if (!postGallery) return;
      postGallery.innerHTML = '';
      const id = Number(postPhongId?.value || 0);
      if (!id) return;
      try {
        const json = await fetch(`/api/rooms/${id}/images`).then(resp => resp.json());
        if (!json?.success) throw new Error(json?.message || 'Lỗi tải ảnh');
        (json.data || []).forEach(img => {
          const el = document.createElement('img');
          el.src = img.url;
          el.alt = `Anh ${img.id}`;
          el.style.cssText = 'width:160px;height:120px;object-fit:cover;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.15)';
          postGallery.appendChild(el);
        });
      } catch (e) {
        postGallery.innerHTML = `<div>${e.message || 'Không tải được ảnh'}</div>`;
      }
    }

    // Upload multiple images for a room
    frmPost?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!postFiles?.files?.length) return showMsg('Hãy chọn ít nhất 1 ảnh');
      const pid = Number(postPhongId?.value || 0);
      if (!pid) return showMsg('Thiếu PhongId');

      try {
        const files = Array.from(postFiles.files);
        const arr = await Promise.all(files.map(fileToBase64));
        const resp = await fetch(`/api/rooms/${pid}/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ filesBase64: arr })
        });
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Tải ảnh thất bại');
        showMsg(`Đã tải ${json.data.length} ảnh`);
        postFiles.value = '';
        loadGallery();
      } catch (err) {
        showMsg(err.message || 'Lỗi tải ảnh');
      }
    });

    // Reload gallery when PhongId changes
    postPhongId?.addEventListener('change', loadGallery);

    // New: load tiện ích into checklist
    async function loadTienIch() {
      if (!tienIchList) return;
      try {
        const resp = await fetch('/api/tienich', { headers: { Accept: 'application/json' } });
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Lỗi tải tiện ích');
        tienIchList.innerHTML = '';
        (json.data || []).forEach(ti => {
          const id = `ti-${ti.TienIchId}`;
          const wrap = document.createElement('label');
          wrap.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid #e5e7eb;border-radius:8px;';
          wrap.innerHTML = `<input type="checkbox" value="${ti.TienIchId}" id="${id}"><span>${ti.TenTienIch}</span>`;
          tienIchList.appendChild(wrap);
        });
      } catch (e) {
        tienIchList.innerHTML = `<em>${e.message || 'Không tải được tiện ích'}</em>`;
      }
    }

    // New: load my rooms to selector
    async function loadMyRooms() {
      if (!roomSelect) return;
      roomSelect.innerHTML = '<option value="">Đang tải...</option>';
      try {
        const resp = await fetch(`/api/chutro/rooms?email=${encodeURIComponent(emailQS)}`);
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Lỗi tải phòng');
        const arr = json.data || [];
        roomSelect.innerHTML = '<option value="">-- Chọn phòng --</option>';
        arr.forEach(r => {
          const opt = document.createElement('option');
          opt.value = r.PhongId;
          // Thêm tên tiện ích vào option nếu có
          const ti = r.TienIch ? ` [${r.TienIch}]` : '';
          opt.textContent = `#${r.PhongId} - ${r.TieuDe}${ti}`;
          roomSelect.appendChild(opt);
        });
        // Auto-select first room
        if (arr.length > 0) {
          roomSelect.value = String(arr[0].PhongId);
          if (postPhongId) postPhongId.value = String(arr[0].PhongId);
          loadGallery();
        }
      } catch (e) {
        roomSelect.innerHTML = `<option value="">${e.message || 'Không tải được danh sách phòng'}</option>`;
      }
    }

    // Sync select -> input + gallery
    roomSelect?.addEventListener('change', () => {
      if (!postPhongId) return;
      postPhongId.value = roomSelect.value || '';
      loadGallery();
    });

    // New: create room submit
    frmRoom?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!emailQS) return showMsg('Thiếu email');

      // BỎ CHẶN: cho phép tạo phòng dù chưa xác thực
      // if (postGuard && postGuard.style.display !== 'none') {
      //   showMsg('Bạn chưa được xác thực. Không thể đăng phòng.');
      //   return;
      // }

      const payload = {
        email: emailQS,
        tieuDe: roomTitle?.value?.trim(),
        moTa: roomDesc?.value?.trim(),
        diaChi: roomDiaChi?.value?.trim(),
        phuongXa: roomPhuongXa?.value?.trim(),
        quanHuyen: roomQuanHuyen?.value?.trim(),
        thanhPho: roomThanhPho?.value?.trim(),
        dienTichM2: roomDienTich?.value ? Number(roomDienTich.value) : null,
        giaCoBan: roomGia?.value ? Number(roomGia.value) : null,
        soNguoiToiDa: roomSoNguoiToiDa?.value ? Number(roomSoNguoiToiDa.value) : null,
        mapUrl: roomMapUrl?.value?.trim(),
        tienIchIds: Array.from(tienIchList?.querySelectorAll('input[type=checkbox]:checked') || []).map(i => Number(i.value))
      };
      if (!payload.tieuDe || !payload.diaChi || payload.giaCoBan == null) {
        showMsg('Vui lòng nhập đủ Tiêu đề, Địa chỉ, Giá cơ bản'); return;
      }
      try {
        const resp = await fetch('/api/chutro/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload)
        });
        const json = await resp.json();
        if (!json?.success) throw new Error(json?.message || 'Lỗi tạo phòng');
        const id = json.data?.PhongId;
        const names = (json.data?.TienIch || []).join(', ');
        showMsg(`Tạo phòng thành công. PhongId: ${id}${names ? ` | Tiện ích: ${names}` : ''}`);
        if (postPhongId) postPhongId.value = String(id);
        // refresh selector and select this room
        await loadMyRooms();
        if (roomSelect) roomSelect.value = String(id);
        loadGallery();
      } catch (err) {
        showMsg(err.message || 'Lỗi tạo phòng');
      }
    });

    // Đăng bài: chỉ cho xem panel nếu đã xác thực (guard text hiển thị nếu chưa)
    async function openPostPanel() {
      await loadVerifyStatus();
      showPanel('post');
      if (postGuard && postGuard.style.display === 'none') {
        await Promise.all([loadTienIch(), loadMyRooms()]);
      }
    }

    // Bind menu
    btnOpen.addEventListener('click', loadProfile);
    form.addEventListener('submit', saveProfile);
    btnVerify?.addEventListener('click', async () => {
      await loadVerifyStatus();
      // Optional: remind when opening the tab
      // if (isVerified) showMsg('Bạn đã được xác thực. Không cần gửi lại yêu cầu.');
      showPanel('verify');
    });
    btnPost?.addEventListener('click', openPostPanel);

    // Đăng xuất
    const btnLogout = document.getElementById('menu-logout');
    if (btnLogout) btnLogout.addEventListener('click', () => { window.location.href = '/'; });

    // Link quay lại (giữ nguyên)
    const backLink = document.querySelector('.switch a');
    if (backLink) backLink.href = emailQS ? `/chutro?email=${encodeURIComponent(emailQS)}` : '/chutro';
  });
})();
