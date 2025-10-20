(() => {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const qs = new URLSearchParams(location.search);
    const emailQS = (qs.get('email') || '').trim();

    const btnOpen = document.getElementById('menu-profile');
    const form = document.getElementById('frm-profile');
    const panel = document.getElementById('panel-profile');

    if (!btnOpen || !form || !panel) return;

    const el = {
      email: document.getElementById('email'),
      hoTen: document.getElementById('hoTen'),
      soDienThoai: document.getElementById('soDienThoai'),
      truong: document.getElementById('truong'),
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
      if (!ct.includes('application/json')) {
        const match = text.match(/<pre>(.*?)<\/pre>/);
        throw new Error(match ? match[1] : text.slice(0, 200));
      }
      let json;
      try { json = JSON.parse(text); } catch { throw new Error(text.slice(0, 200)); }
      if (!resp.ok) throw new Error(json.message || 'Lỗi máy chủ');
      return json;
    }

    async function loadProfile() {
      if (!emailQS) {
        showMsg('Thiếu email. Vui lòng đăng nhập lại.');
        return;
      }
      try {
        const resp = await fetch(`/api/sinhvien/profile?email=${encodeURIComponent(emailQS)}`, {
          headers: { Accept: 'application/json' }
        });
        const json = await readJsonOrThrow(resp);
        if (!json.success) throw new Error(json.message || 'Lỗi tải hồ sơ');

        const d = json.data || {};
        el.email.value = d.Email || emailQS;
        el.hoTen.value = d.HoTen || '';
        el.soDienThoai.value = d.SoDienThoai || '';
        el.truong.value = d.Truong || '';

        panel.style.display = 'block';
      } catch (e) {
        console.error('Lỗi load profile:', e);
        showMsg(e.message || 'Lỗi tải hồ sơ. Kiểm tra kết nối server.');
      }
    }

    async function saveProfile(e) {
      e.preventDefault();
      const payload = {
        email: el.email.value.trim(),
        hoTen: el.hoTen.value.trim(),
        soDienThoai: el.soDienThoai.value.trim(),
        truong: el.truong.value.trim(),
      };
      try {
        const resp = await fetch('/api/sinhvien/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload)
        });
        const json = await readJsonOrThrow(resp);
        if (!json.success) throw new Error(json.message || 'Lỗi lưu hồ sơ');

        showMsg('Cập nhật hồ sơ thành công');
      } catch (e2) {
        console.error('Lỗi save profile:', e2);
        showMsg(e2.message || 'Lỗi lưu hồ sơ');
      }
    }

    btnOpen.addEventListener('click', loadProfile);
    form.addEventListener('submit', saveProfile);

    // Link quay lại trang chính của sinh viên
    const backLink = document.querySelector('.switch a');
    if (backLink) {
      backLink.href = emailQS ? `/sinhvien?email=${encodeURIComponent(emailQS)}` : '/sinhvien';
    }

    // Đăng xuất
    const btnLogout = document.getElementById('menu-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', () => { window.location.href = '/'; });
    }
  });
})();
