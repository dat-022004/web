(() => {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    // Toggle forms
    function showLogin() {
      document.getElementById('login-container')?.classList.add('active');
      document.getElementById('register-container')?.classList.remove('active');
    }
    function showRegister() {
      document.getElementById('register-container')?.classList.add('active');
      document.getElementById('login-container')?.classList.remove('active');
    }
    // Expose to anchors
    window.showLogin = showLogin;
    window.showRegister = showRegister;

    // Overlay helpers
    const nen = document.getElementById('hop-thong-bao-nen');
    const hop = document.getElementById('hop-thong-bao');
    const nd = document.getElementById('hop-thong-bao-noi-dung');
    const nut = document.getElementById('hop-thong-bao-dong');
    if (nut) nut.onclick = () => (nen.style.display = 'none');
    if (nen) nen.onclick = (e) => { if (e.target === nen) nen.style.display = 'none'; };

    function hienThongBao(noiDung, loai = 'info', tuDongTatMs = 1800) {
      if (!nen || !hop || !nd) return alert(noiDung || '');
      hop.classList.remove('tbao-thanhcong', 'tbao-loi');
      if (loai === 'success') hop.classList.add('tbao-thanhcong');
      if (loai === 'error') hop.classList.add('tbao-loi');
      nd.textContent = noiDung || '';
      nen.style.display = 'flex';
      if (tuDongTatMs && Number.isFinite(tuDongTatMs)) {
        setTimeout(() => { nen.style.display = 'none'; }, tuDongTatMs);
      }
    }

    // Load roles
    async function loadVaiTro() {
      try {
        const res = await fetch('/api/vaitro');
        const json = await res.json();
        const sel = document.getElementById('register-vai_tro');
        if (!json.success) throw new Error(json.error || 'Không lấy được vai trò');
        sel.innerHTML = '';
        json.data.forEach(v => {
          const opt = document.createElement('option');
          opt.value = v.VaiTroId;
          opt.textContent = v.TenVaiTro;
          sel.appendChild(opt);
        });
      } catch (e) {
        console.error('Lỗi load VaiTro:', e);
        const sel = document.getElementById('register-vai_tro');
        if (sel) sel.innerHTML = '<option value="2">Người dùng</option>';
        hienThongBao('Không tải được danh sách vai trò. Dùng mặc định "Người dùng".', 'error', 2200);
      }
    }
    loadVaiTro();

    // Login submit
    const loginForm = document.getElementById('login-form');
    loginForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const gmail = document.getElementById('login-gmail')?.value || '';
      const matkhau = document.getElementById('login-matkhau')?.value || '';
      try {
        const response = await fetch('/api/dangnhap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gmail, matkhau })
        });
        const result = await response.json().catch(() => ({}));
        const msg = result.message || result.error || 'Có lỗi xảy ra khi đăng nhập';
        hienThongBao(msg, response.ok && result.success ? 'success' : 'error');
        if (response.ok && result.success && result.redirect) {
          setTimeout(() => { window.location.href = result.redirect; }, 900);
        }
      } catch {
        hienThongBao('Không thể kết nối máy chủ.', 'error', 2200);
      }
    });

    // Register submit
    const registerForm = document.getElementById('register-form');
    registerForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const gmail = document.getElementById('register-gmail')?.value || '';
      const matkhau = document.getElementById('register-matkhau')?.value || '';
      const vai_tro_id = document.getElementById('register-vai_tro')?.value || '';
      if (!vai_tro_id) {
        hienThongBao('Vui lòng chọn vai trò', 'error', 1800);
        return;
      }
      try {
        const response = await fetch('/api/dangki', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gmail, matkhau, vai_tro_id })
        });
        const result = await response.json().catch(() => ({}));
        const msg = result.message || result.error || 'Có lỗi xảy ra khi đăng ký';
        hienThongBao(msg, response.ok && result.success ? 'success' : 'error');
        if (response.ok && result.success) {
          setTimeout(() => { showLogin(); }, 900);
        }
      } catch {
        hienThongBao('Không thể kết nối máy chủ.', 'error', 2200);
      }
    });
  });
})();
