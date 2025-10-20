let express, sql, cors;
try {
    express = require('express');
    sql = require('mssql');
    cors = require('cors');
} catch (err) {
    console.error('Thiếu các module cần thiết. Cài đặt bằng: npm install express mssql cors dotenv --save');
    console.error('Chi tiết lỗi:', err.stack || err.message || err);
    process.exit(1);
}

const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Cấu hình phục vụ file tĩnh từ thư mục gốc và /public
// Thêm static riêng cho uploads (cache 7 ngày)
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    maxAge: '7d',
    setHeaders: (res, filePath) => {
        if (/\.(png|jpe?g)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        }
    }
}));
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));
// Thêm route rõ ràng cho trang chủ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html')); // Trang đăng nhập
});
app.get('/home', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'home.html')); // Trang chính mới
});
app.use(cors());
// Tăng giới hạn kích thước body lên 100MB cho JSON và form
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Trang theo vai trò
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/sinhvien', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'sinhvien.html'));
});
app.get('/chutro', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chutro.html'));
});

// ------------------ Cấu hình kết nối SQL Server ------------------
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    port: parseInt(process.env.DB_PORT || '1433'),
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

let pool = null;

sql.connect(dbConfig).then(poolInstance => {
    pool = poolInstance;
    console.log('✅ Kết nối SQL Server thành công');
    // Seed default admin
    seedAdminDefault().catch(err => console.error('❌ Seed admin lỗi:', err.message || err));
    // Ensure schemas ready (tránh lỗi cột thiếu)
    ensureChuTroSchema().catch(err => console.error('❌ Ensure ChuTro schema lỗi:', err.message || err));
    ensureXacThucSchema().catch(err => console.error('❌ Ensure XacThuc schema lỗi:', err.message || err));
    pool.on('error', err => {
        console.error('⚠️  Lỗi pool SQL:', err.message || err);
        pool = null;
    });
}).catch(err => {
    console.error('❌ Lỗi kết nối SQL Server:', err.message || err);
});

// ------------------ Hàm kiểm tra kết nối ------------------
function checkPool(res) {
    if (!pool || !pool.connected) {
        res.status(500).json({ success: false, message: 'Chưa kết nối đến cơ sở dữ liệu' });
        return false;
    }
    return true;
}

// ------------------ API kiểm tra trạng thái ------------------
app.get('/api/status', (req, res) => {
    res.json({ connected: !!(pool && pool.connected) });
});

// ------------------ Map vai trò ------------------
function mapVaiTroTextToId(vai_tro) {
    if (!vai_tro) return 2; // mặc định người dùng
    const key = String(vai_tro).trim().toLowerCase();
    if (key === 'admin') return 1;
    if (key === 'Chủ Trọ' || key === 'nguoi dung' || key === 'user') return 2;
    if (key === 'Sinh Viên' || key === 'sinh vien' || key === 'student') return 3;
    return 2;
}
// Chuẩn hóa chuỗi để so khớp không dấu
function norm(s) {
    return (s || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}
// Xác định đường dẫn trang chủ theo vai trò
function getRedirectByRole(vaiTroId, tenVaiTro) {
    const n = norm(tenVaiTro);
    if (n.includes('admin')) return '/admin';
    if (n.includes('sinh vien') || n === 'sinhvien') return '/sinhvien';
    if (n.includes('chu tro') || n === 'chutro' || n.includes('chu nha')) return '/chutro';
    switch (Number(vaiTroId)) {
        case 1: return '/admin';
        case 3: return '/sinhvien';
        case 4: return '/chutro';
        default: return '/home'; // Mặc định quay về trang home
    }
}

// ------------------ API lấy vai trò ------------------
app.get('/api/vaitro', async (req, res) => {
    if (!checkPool(res)) return;
    try {
        const result = await pool.request()
            .query('SELECT VaiTroId, TenVaiTro FROM VaiTro ORDER BY VaiTroId');
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error('❌ Lỗi lấy VaiTro:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ------------------ API đăng nhập ------------------
app.post('/api/dangnhap', async (req, res) => {
    if (!checkPool(res)) return;
    const { gmail, matkhau } = req.body;
    const email = (gmail || '').trim();
    const pwd = (matkhau || '').trim();

    if (!email || !pwd) {
        return res.status(400).json({ success: false, message: 'Vui lòng nhập gmail và mật khẩu' });
    }
    if (email.length > 255) {
        return res.status(400).json({ success: false, message: 'Email quá dài (tối đa 255 ký tự)' });
    }
    if (pwd.length < 6 || pwd.length > 50) {
        return res.status(400).json({ success: false, message: 'Mật khẩu phải từ 6 đến 50 ký tự' });
    }

    try {
        const result = await pool.request()
            .input('Email', sql.NVarChar, email)
            .input('MatKhau', sql.VarChar, pwd)
            .query(`
                SELECT tk.TaiKhoanId, tk.Email, tk.VaiTroId, tk.TrangThai, vt.TenVaiTro
                FROM TaiKhoan tk
                JOIN VaiTro vt ON vt.VaiTroId = tk.VaiTroId
                WHERE tk.Email = @Email AND tk.MatKhau = @MatKhau
            `);

        if (result.recordset.length > 0) {
            const row = result.recordset[0];
            const redirect = getRedirectByRole(row.VaiTroId, row.TenVaiTro);
            res.status(200).json({
                success: true,
                message: 'Đăng nhập thành công',
                redirect: `${redirect}?email=${encodeURIComponent(row.Email)}`,
                role: { id: row.VaiTroId, name: row.TenVaiTro }
            });
        } else {
            res.status(401).json({ success: false, message: 'Gmail hoặc mật khẩu không đúng' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message, error: err.message });
    }
});

// ------------------ API đăng ký ------------------
app.post('/api/dangki', async (req, res) => {
    if (!checkPool(res)) return;
    const { gmail, matkhau, vai_tro, vai_tro_id } = req.body;
    const email = (gmail || '').trim();
    const pwd = (matkhau || '').trim();
    let vaiTroId = Number.parseInt(vai_tro_id, 10);
    if (Number.isNaN(vaiTroId)) vaiTroId = mapVaiTroTextToId(vai_tro);

    const trangThai = 1; // kích hoạt

    if (!email || !pwd) {
        return res.status(400).json({ success: false, message: 'Vui lòng nhập gmail và mật khẩu' });
    }
    if (email.length > 255) {
        return res.status(400).json({ success: false, message: 'Email quá dài (tối đa 255 ký tự)' });
    }
    if (pwd.length < 6 || pwd.length > 50) {
        return res.status(400).json({ success: false, message: 'Mật khẩu phải từ 6 đến 50 ký tự' });
    }

    try {
        const checkResult = await pool.request()
            .input('Email', sql.NVarChar, email)
            .query('SELECT 1 AS existsFlag FROM TaiKhoan WHERE Email = @Email');

        if (checkResult.recordset.length > 0) {
            return res.status(409).json({ success: false, message: 'Email đã tồn tại' });
        }

        await pool.request()
            .input('Email', sql.NVarChar, email)
            .input('MatKhau', sql.VarChar, pwd)
            .input('VaiTroId', sql.Int, vaiTroId)
            .input('TrangThai', sql.Int, trangThai)
            .query(`
                INSERT INTO TaiKhoan (Email, MatKhau, VaiTroId, TrangThai)
                VALUES (@Email, @MatKhau, @VaiTroId, @TrangThai)
            `);

        res.status(201).json({ success: true, message: 'Đăng ký thành công', redirect: '/' });
    } catch (err) {
        console.error('❌ Lỗi khi đăng ký:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server', error: err.message });
    }
});

// ------------------ API xem hồ sơ từ TaiKhoan ------------------
app.get('/api/profile/:email', async (req, res) => {
    if (!checkPool(res)) return;
    const email = req.params.email;

    try {
        const result = await pool.request()
            .input('Email', sql.NVarChar, email)
            .query(`
                SELECT TaiKhoanId, Email, VaiTroId, TrangThai
                FROM TaiKhoan
                WHERE Email = @Email
            `);

        if (result.recordset.length > 0) {
            res.json({ success: true, data: result.recordset[0] });
        } else {
            res.json({ success: false, message: 'Không tìm thấy người dùng' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message, error: err.message });
    }
});

// ------------------ API hồ sơ sinh viên ------------------
app.get('/api/sinhvien/profile', async (req, res) => {
    if (!checkPool(res)) return;
    const email = req.query.email;
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });

    try {
        // Lấy metadata cột của bảng SinhVien (nếu có)
        const meta = await pool.request().query(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'SinhVien'
        `);
        const cols = new Set(meta.recordset.map(r => r.COLUMN_NAME));
        const hasTable = meta.recordset.length > 0;

        const hasHoTen = cols.has('HoTen');
        const sdtCol = cols.has('SoDienThoai') ? 'SoDienThoai' : (cols.has('SDT') ? 'SDT' : null);
        const truongCol = cols.has('Truong') ? 'Truong' : (cols.has('TruongHoc') ? 'TruongHoc' : null);
        const diaChiCol = cols.has('DiaChi') ? 'DiaChi' : (cols.has('DiaChiLienHe') ? 'DiaChiLienHe' : null);

        const selectParts = [
            'tk.Email',
            hasTable ? 'sv.SinhVienId' : 'CAST(NULL AS BIGINT) AS SinhVienId',
            hasHoTen ? 'sv.HoTen AS HoTen' : 'CAST(NULL AS NVARCHAR(150)) AS HoTen',
            sdtCol ? `sv.${sdtCol} AS SoDienThoai` : 'CAST(NULL AS NVARCHAR(20)) AS SoDienThoai',
            truongCol ? `sv.${truongCol} AS Truong` : 'CAST(NULL AS NVARCHAR(150)) AS Truong',
            diaChiCol ? `sv.${diaChiCol} AS DiaChi` : 'CAST(NULL AS NVARCHAR(255)) AS DiaChi'
        ].join(', ');

        const fromJoin = hasTable
            ? 'FROM TaiKhoan tk LEFT JOIN SinhVien sv ON sv.SinhVienId = tk.TaiKhoanId'
            : 'FROM TaiKhoan tk';

        const sqlText = `
            SELECT ${selectParts}
            ${fromJoin}
            WHERE tk.Email = @Email
        `;

        const result = await pool.request()
            .input('Email', sql.NVarChar, email)
            .query(sqlText);

        if (result.recordset.length > 0) {
            const data = result.recordset[0];
            return res.json({ success: true, data });
        } else {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        }
    } catch (err) {
        console.error('❌ Lỗi lấy hồ sơ sinh viên:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ------------------ API cập nhật hồ sơ sinh viên ------------------
app.post('/api/sinhvien/profile', async (req, res) => {
    if (!checkPool(res)) return;
    const { email, hoTen = '', soDienThoai, truong, diaChi } = req.body;

    try {
        // Lấy TaiKhoanId theo email
        const tk = await pool.request()
            .input('Email', sql.NVarChar, email)
            .query(`SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email`);
        if (tk.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        }
        const taiKhoanId = tk.recordset[0].TaiKhoanId;

        // Tạo bảng nếu chưa có (đúng schema: HoTen NOT NULL, có DiaChi)
        await pool.request().query(`
IF OBJECT_ID(N'dbo.SinhVien', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SinhVien (
        SinhVienId BIGINT NOT NULL PRIMARY KEY,
        HoTen NVARCHAR(150) NOT NULL,
        SoDienThoai NVARCHAR(20) NULL,
        Truong NVARCHAR(150) NULL,
        DiaChi NVARCHAR(255) NULL
    );
END
IF COL_LENGTH('dbo.SinhVien','DiaChi') IS NULL
BEGIN
    ALTER TABLE dbo.SinhVien ADD DiaChi NVARCHAR(255) NULL;
END
        `);

        // Đọc metadata để cập nhật theo cột hiện có
        const meta = await pool.request().query(`
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'SinhVien'
        `);
        const cols = new Set(meta.recordset.map(r => r.COLUMN_NAME));
        const hasHoTen = cols.has('HoTen');
        const sdtCol = cols.has('SoDienThoai') ? 'SoDienThoai' : (cols.has('SDT') ? 'SDT' : null);
        const truongCol = cols.has('Truong') ? 'Truong' : (cols.has('TruongHoc') ? 'TruongHoc' : null);
        const diaChiCol = cols.has('DiaChi') ? 'DiaChi' : (cols.has('DiaChiLienHe') ? 'DiaChiLienHe' : null);

        const sets = [];
        if (hasHoTen && hoTen !== undefined && hoTen !== null && hoTen !== '') sets.push('HoTen = @HoTen');
        if (sdtCol && soDienThoai) sets.push(`${sdtCol} = @SoDienThoai`);
        if (truongCol && truong) sets.push(`${truongCol} = @Truong`);
        if (diaChiCol && diaChi) sets.push(`${diaChiCol} = @DiaChi`);

        // Luôn chèn HoTen (non-null) khi INSERT để thỏa NOT NULL
        const insertCols = ['SinhVienId'];
        const insertVals = ['@SinhVienId'];
        if (hasHoTen) { insertCols.push('HoTen'); insertVals.push('@HoTenInsert'); }
        if (sdtCol && soDienThoai) { insertCols.push(sdtCol); insertVals.push('@SoDienThoai'); }
        if (truongCol && truong) { insertCols.push(truongCol); insertVals.push('@Truong'); }
        if (diaChiCol && diaChi) { insertCols.push(diaChiCol); insertVals.push('@DiaChi'); }

        const upsertSql = `
IF EXISTS (SELECT 1 FROM dbo.SinhVien WHERE SinhVienId = @SinhVienId)
BEGIN
    ${sets.length ? `UPDATE dbo.SinhVien SET ${sets.join(', ')} WHERE SinhVienId = @SinhVienId;` : '/* Không có cột để cập nhật */'}
END
ELSE
BEGIN
    INSERT INTO dbo.SinhVien (${insertCols.join(', ')})
    VALUES (${insertVals.join(', ')});
END
        `;

        await pool.request()
            .input('SinhVienId', sql.BigInt, taiKhoanId)
            .input('HoTen', sql.NVarChar, hoTen || null)   // dùng cho UPDATE nếu có
            .input('HoTenInsert', sql.NVarChar, (hoTen || '').toString()) // luôn non-null khi INSERT
            .input('SoDienThoai', sql.NVarChar, soDienThoai || null)
            .input('Truong', sql.NVarChar, truong || null)
            .input('DiaChi', sql.NVarChar, diaChi || null)
            .query(upsertSql);

        res.json({ success: true, message: 'Cập nhật hồ sơ thành công' });
    } catch (err) {
        console.error('❌ Lỗi cập nhật hồ sơ sinh viên:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ------------------ API cập nhật hồ sơ chủ trọ ------------------
app.post('/api/chutro/profile', async (req, res) => {
    if (!checkPool(res)) return;
    await ensureChuTroSchema(); // đảm bảo cột tồn tại
    const b = req.body || {};
    const email = (b.email || '').trim();
    const hoTen = (b.hoTen || '').trim();
    const soDienThoai = (b.soDienThoai || '').trim();
    const diaChiLienHe = (b.diaChiLienHe || '').trim();
    // DaXacThuc là BIT: nhận true/false/'1'/'0'/'on'...
    const daXacThucRaw = b.daXacThuc;
    const daXacThuc =
        daXacThucRaw === true ||
        daXacThucRaw === 1 ||
        daXacThucRaw === '1' ||
        (typeof daXacThucRaw === 'string' && daXacThucRaw.toLowerCase() === 'true') ||
        (typeof daXacThucRaw === 'string' && daXacThucRaw.toLowerCase() === 'on');
    const ngayXacThucStr = (b.ngayXacThuc || '').trim();
    const ngayXacThuc = ngayXacThucStr ? new Date(ngayXacThucStr) : null;
    const setVerifiedAtNow = daXacThuc && !ngayXacThuc; // nếu xác thực mà chưa có ngày -> dùng thời gian thực

    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });
    if (hoTen.length > 150) return res.status(400).json({ success: false, message: 'Họ tên quá dài' });
    if (soDienThoai.length > 20) return res.status(400).json({ success: false, message: 'Số điện thoại quá dài' });
    if (diaChiLienHe.length > 255) return res.status(400).json({ success: false, message: 'Địa chỉ liên hệ quá dài' });
    if (ngayXacThuc && isNaN(ngayXacThuc.getTime())) return res.status(400).json({ success: false, message: 'Ngày xác thực không hợp lệ' });

    try {
        // Lấy TaiKhoanId theo email
        const tk = await pool.request()
            .input('Email', sql.NVarChar, email)
            .query(`SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email`);
        if (tk.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        }
        const taiKhoanId = tk.recordset[0].TaiKhoanId;

        // Tạo bảng ChuTro đúng schema nếu chưa tồn tại (BIT + DATETIME2(3))
        await pool.request().query(`
IF OBJECT_ID(N'dbo.ChuTro', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ChuTro (
        ChuTroId BIGINT NOT NULL PRIMARY KEY,
        HoTen NVARCHAR(150) NOT NULL,
        SoDienThoai NVARCHAR(20) NULL,
        DiaChiLienHe NVARCHAR(255) NULL,
        DaXacThuc BIT NULL CONSTRAINT DF_ChuTro_DaXacThuc DEFAULT (0),
        NgayXacThuc DATETIME2(3) NULL
    );
END
        `);

        await pool.request()
            .input('ChuTroId', sql.BigInt, taiKhoanId)
            .input('HoTen', sql.NVarChar, (hoTen || '').toString()) // luôn non-null
            .input('SoDienThoai', sql.NVarChar, soDienThoai || null)
            .input('DiaChiLienHe', sql.NVarChar, diaChiLienHe || null)
            .input('DaXacThuc', sql.Bit, !!daXacThuc)
            .input('NgayXacThuc', sql.DateTime2, ngayXacThuc || null)
            .input('SetVerifiedAtNow', sql.Bit, setVerifiedAtNow ? 1 : 0)
            .query(`
MERGE dbo.ChuTro AS target
USING (SELECT @ChuTroId AS ChuTroId) AS src
ON (target.ChuTroId = src.ChuTroId)
WHEN MATCHED THEN
    UPDATE SET HoTen = @HoTen,
               SoDienThoai = @SoDienThoai,
               DiaChiLienHe = @DiaChiLienHe,
               DaXacThuc = @DaXacThuc,
               NgayXacThuc = CASE WHEN @SetVerifiedAtNow = 1 THEN SYSDATETIME() ELSE @NgayXacThuc END
WHEN NOT MATCHED THEN
    INSERT (ChuTroId, HoTen, SoDienThoai, DiaChiLienHe, DaXacThuc, NgayXacThuc)
    VALUES (@ChuTroId, @HoTen, @SoDienThoai, @DiaChiLienHe, @DaXacThuc,
            CASE WHEN @SetVerifiedAtNow = 1 THEN SYSDATETIME() ELSE @NgayXacThuc END);
            `);

        res.json({ success: true, message: 'Cập nhật hồ sơ chủ trọ thành công' });
    } catch (err) {
        console.error('❌ Lỗi cập nhật hồ sơ chủ trọ:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ------------------ API hồ sơ chủ trọ (GET) ------------------
app.get('/api/chutro/profile', async (req, res) => {
    if (!checkPool(res)) return;
    await ensureChuTroSchema(); // đảm bảo cột tồn tại
    const email = (req.query.email || '').trim();
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });

    try {
        const rs = await pool.request()
            .input('Email', sql.NVarChar, email)
            .query(`
                SELECT tk.TaiKhoanId, tk.Email,
                       ct.ChuTroId, ct.HoTen, ct.SoDienThoai, ct.DiaChiLienHe, ct.DaXacThuc, ct.NgayXacThuc
                FROM dbo.TaiKhoan tk
                LEFT JOIN dbo.ChuTro ct ON ct.ChuTroId = tk.TaiKhoanId
                WHERE tk.Email = @Email
            `);

        if (rs.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        }

        const r = rs.recordset[0];
        // DaXacThuc (bit) sẽ được mssql map về boolean
        res.json({
            success: true,
            data: {
                Email: r.Email,
                HoTen: r.HoTen || '',
                SoDienThoai: r.SoDienThoai || '',
                DiaChiLienHe: r.DiaChiLienHe || '',
                DaXacThuc: r.DaXacThuc ?? false,
                NgayXacThuc: r.NgayXacThuc || null
            }
        });
    } catch (err) {
        console.error('❌ Lỗi lấy hồ sơ chủ trọ:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ------------------ Chủ trọ - kiểm tra trạng thái xác thực ------------------
app.get('/api/chutro/verify-status', async (req, res) => {
    if (!checkPool(res)) return;
    await ensureChuTroSchema?.();
    await ensureXacThucSchema();
    const email = (req.query.email || '').trim();
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });
    try {
        const tk = await pool.request().input('Email', sql.NVarChar, email)
            .query(`SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email`);
        if (tk.recordset.length === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        const taiKhoanId = tk.recordset[0].TaiKhoanId;

        const ct = await pool.request().input('Id', sql.BigInt, taiKhoanId)
            .query(`SELECT DaXacThuc, NgayXacThuc FROM dbo.ChuTro WHERE ChuTroId = @Id`);
        const verified = ct.recordset.length ? !!ct.recordset[0].DaXacThuc : false;
        const verifiedAt = ct.recordset.length ? ct.recordset[0].NgayXacThuc : null;

        const lastReq = await pool.request().input('Id', sql.BigInt, taiKhoanId).query(`
            SELECT TOP (1) XacThucId, LoaiGiayTo, TrangThai, NgayNop, DuongDanTep
            FROM dbo.YeuCauXacThucChuTro
            WHERE ChuTroId = @Id
            ORDER BY XacThucId DESC
        `);

        const last = lastReq.recordset[0] || null;
        if (last) {
            last.ImageUrl = last.DuongDanTep || `/api/admin/verify-requests/${last.XacThucId}/image`;
        }

        res.json({
            success: true,
            data: {
                verified,
                verifiedAt,
                lastRequest: last
            }
        });
    } catch (err) {
        console.error('❌ verify-status:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ------------------ Chủ trọ - gửi yêu cầu xác thực ------------------
app.post('/api/chutro/verify-request', async (req, res) => {
    if (!checkPool(res)) return;
    await ensureChuTroSchema?.();
    await ensureXacThucSchema();
    const { email, loaiGiayTo, fileBase64 } = req.body || {};
    if (!email || !loaiGiayTo || !fileBase64) {
        return res.status(400).json({ success: false, message: 'Thiếu email/loại giấy tờ/tệp' });
    }
    try {
        const tk = await pool.request().input('Email', sql.NVarChar, email)
            .query(`SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email`);
        if (tk.recordset.length === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        const taiKhoanId = tk.recordset[0].TaiKhoanId;

        // Chuẩn hóa base64, lấy mime/đuôi tệp
        const raw64 = String(fileBase64);
        const headerMatch = raw64.match(/^data:([^;,]+).*;base64,/i);
        const mimeHeader = (headerMatch?.[1] || '').toLowerCase();
        const clean64 = raw64.replace(/^data:.*;base64,/, '');
        let buf;
        try { buf = Buffer.from(clean64, 'base64'); } catch { return res.status(400).json({ success: false, message: 'Tệp không hợp lệ' }); }
        if (!buf || buf.length === 0) return res.status(400).json({ success: false, message: 'Tệp rỗng' });
        if (buf.length > 100 * 1024 * 1024) return res.status(400).json({ success: false, message: 'Ảnh quá lớn (tối đa 100MB)' });

        // Chỉ chấp nhận ảnh JPG/PNG. Kiểm tra MIME header và magic bytes.
        const isJpegMagic = buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
        const isPngMagic = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A;
        const extFromHeader = /image\/jpeg/.test(mimeHeader) ? 'jpg' : (/image\/png/.test(mimeHeader) ? 'png' : null);
        const extFromMagic = isJpegMagic ? 'jpg' : (isPngMagic ? 'png' : null);
        const finalExt = extFromHeader || extFromMagic;
        if (!finalExt) {
            return res.status(400).json({ success: false, message: 'Chỉ chấp nhận ảnh JPG/PNG' });
        }

        // Ghi file ra đĩa và lưu đường dẫn
        const dir = path.join(__dirname, 'uploads', 'verify');
        await fs.promises.mkdir(dir, { recursive: true });
        const filename = `${taiKhoanId}-${Date.now()}.${finalExt}`;
        const absPath = path.join(dir, filename);
        await fs.promises.writeFile(absPath, buf);
        const relPath = `/uploads/verify/${filename}`;

        // Đảm bảo bản ghi ChuTro tồn tại
        await pool.request()
            .input('Id', sql.BigInt, taiKhoanId)
            .query(`
IF NOT EXISTS (SELECT 1 FROM dbo.ChuTro WHERE ChuTroId = @Id)
BEGIN
    INSERT INTO dbo.ChuTro (ChuTroId, HoTen, DaXacThuc) VALUES (@Id, N'', 0);
END
        `);

        // Lưu yêu cầu + đường dẫn file + ngày nộp, cập nhật trạng thái chủ trọ
        const req1 = pool.request();
        req1.input('Id', sql.BigInt, taiKhoanId);
        req1.input('Loai', sql.NVarChar, loaiGiayTo.toString().slice(0, 100));
        req1.input('Anh', sql.VarBinary(sql.MAX), buf);
        req1.input('Path', sql.NVarChar, relPath);
        await req1.query(`
INSERT INTO dbo.YeuCauXacThucChuTro (ChuTroId, LoaiGiayTo, AnhMinhChung, TrangThai, DuyetBoi, NgayNop, DuongDanTep)
VALUES (@Id, @Loai, @Anh, 0, NULL, SYSDATETIME(), @Path);

UPDATE dbo.ChuTro
SET DaXacThuc = 0,
    NgayXacThuc = NULL
WHERE ChuTroId = @Id;
        `);

        res.json({ success: true, message: 'Đã gửi yêu cầu xác thực. Vui lòng chờ Admin duyệt.' });
    } catch (err) {
        console.error('❌ verify-request:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ------------------ ADMIN APIs ------------------

// List landlord verification requests (status: 0=pending, 1=approved, 2=rejected)
app.get('/api/admin/verify-requests', async (req, res) => {
    if (!checkPool(res)) return;
    await ensureChuTroSchema?.();
    await ensureXacThucSchema();
    const status = Number.parseInt(req.query.status ?? '0', 10);
    try {
        const rs = await pool.request()
            .input('Status', sql.TinyInt, Number.isNaN(status) ? 0 : status)
            .query(`
                SELECT 
                    x.XacThucId,
                    x.ChuTroId,
                    x.LoaiGiayTo,
                    x.TrangThai,
                    x.DuyetBoi,
                    x.NgayNop,
                    x.DuongDanTep,
                    COALESCE(x.DuongDanTep, CONCAT('/api/admin/verify-requests/', x.XacThucId, '/image')) AS ImageUrl,
                    ct.HoTen,
                    ct.DiaChiLienHe,
                    ct.DaXacThuc,
                    ct.NgayXacThuc,
                    tk.Email AS ChuTroEmail
                FROM dbo.YeuCauXacThucChuTro AS x
                JOIN dbo.ChuTro AS ct ON ct.ChuTroId = x.ChuTroId
                JOIN dbo.TaiKhoan AS tk ON tk.TaiKhoanId = x.ChuTroId
                WHERE x.TrangThai = @Status
                ORDER BY x.XacThucId DESC
            `);
        res.json({ success: true, data: rs.recordset });
    } catch (err) {
        console.error('❌ Lỗi list verify-requests:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// Helper: resolve admin id by email or fallback to first Admin role
async function getAdminId(adminEmail) {
    const q = adminEmail
        ? `
            SELECT TaiKhoanId FROM dbo.TaiKhoan
            WHERE Email = @Email
          `
        : `
            SELECT TOP (1) tk.TaiKhoanId
            FROM dbo.TaiKhoan tk
            JOIN dbo.VaiTro vt ON vt.VaiTroId = tk.VaiTroId
            WHERE vt.TenVaiTro = N'Admin'
            ORDER BY tk.TaiKhoanId
          `;
    const req = pool.request();
    if (adminEmail) req.input('Email', sql.NVarChar, adminEmail);
    const rs = await req.query(q);
    return rs.recordset[0]?.TaiKhoanId || null;
}

// Approve landlord verification
app.post('/api/admin/verify-requests/:id/approve', async (req, res) => {
    if (!checkPool(res)) return;
    await ensureChuTroSchema(); // đảm bảo cột tồn tại
    const id = Number.parseInt(req.params.id, 10);
    const adminEmail = (req.body?.adminEmail || 'admin@gmail.com').trim();
    if (!id) return res.status(400).json({ success: false, message: 'Thiếu id' });
    try {
        const adminId = await getAdminId(adminEmail);
        if (!adminId) return res.status(400).json({ success: false, message: 'Không xác định được admin' });

        const getReq = await pool.request()
            .input('Id', sql.BigInt, id)
            .query(`SELECT XacThucId, ChuTroId, TrangThai FROM dbo.YeuCauXacThucChuTro WHERE XacThucId = @Id`);
        if (getReq.recordset.length === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu' });

        const chuTroId = getReq.recordset[0].ChuTroId;

        await pool.request()
            .input('Id', sql.BigInt, id)
            .input('AdminId', sql.BigInt, adminId)
            .query(`
                UPDATE dbo.YeuCauXacThucChuTro
                SET TrangThai = 1, DuyetBoi = @AdminId
                WHERE XacThucId = @Id;

                UPDATE dbo.ChuTro
                SET DaXacThuc = 1, NgayXacThuc = SYSDATETIME()
                WHERE ChuTroId = (SELECT ChuTroId FROM dbo.YeuCauXacThucChuTro WHERE XacThucId = @Id);
            `);

        // Gửi thông báo tới chủ trọ
        await pool.request()
            .input('ChuTroId', sql.BigInt, chuTroId)
            .query(`
                INSERT INTO dbo.ThongBao (TaiKhoanId, Loai, TieuDe, NoiDung, DaDoc)
                VALUES (@ChuTroId, N'XacThuc', N'Kết quả xác thực', N'Yêu cầu xác thực đã được phê duyệt.', 0);
            `);

        res.json({ success: true, message: 'Đã phê duyệt' });
    } catch (err) {
        console.error('❌ Approve verify error:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// Reject landlord verification
app.post('/api/admin/verify-requests/:id/reject', async (req, res) => {
    if (!checkPool(res)) return;
    await ensureChuTroSchema(); // đảm bảo cột tồn tại
    const id = Number.parseInt(req.params.id, 10);
    const adminEmail = (req.body?.adminEmail || 'admin@gmail.com').trim();
    const reason = (req.body?.reason || 'Hồ sơ chưa hợp lệ.').toString().slice(0, 500);
    if (!id) return res.status(400).json({ success: false, message: 'Thiếu id' });
    try {
        const adminId = await getAdminId(adminEmail);
        if (!adminId) return res.status(400).json({ success: false, message: 'Không xác định được admin' });

        const getReq = await pool.request()
            .input('Id', sql.BigInt, id)
            .query(`SELECT XacThucId, ChuTroId, TrangThai FROM dbo.YeuCauXacThucChuTro WHERE XacThucId = @Id`);
        if (getReq.recordset.length === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy yêu cầu' });

        const chuTroId = getReq.recordset[0].ChuTroId;

        await pool.request()
            .input('Id', sql.BigInt, id)
            .input('AdminId', sql.BigInt, adminId)
            .query(`
                UPDATE dbo.YeuCauXacThucChuTro
                SET TrangThai = 2, DuyetBoi = @AdminId
                WHERE XacThucId = @Id;

                UPDATE dbo.ChuTro
                SET DaXacThuc = 0, NgayXacThuc = NULL
                WHERE ChuTroId = (SELECT ChuTroId FROM dbo.YeuCauXacThucChuTro WHERE XacThucId = @Id);
            `);

        // Gửi thông báo tới chủ trọ
        await pool.request()
            .input('ChuTroId', sql.BigInt, chuTroId)
            .input('Msg', sql.NVarChar, reason)
            .query(`
                INSERT INTO dbo.ThongBao (TaiKhoanId, Loai, TieuDe, NoiDung, DaDoc)
                VALUES (@ChuTroId, N'XacThuc', N'Kết quả xác thực', @Msg, 0);
            `);

        res.json({ success: true, message: 'Đã từ chối' });
    } catch (err) {
        console.error('❌ Reject verify error:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// List accounts (role: all|student|landlord)
app.get('/api/admin/accounts', async (req, res) => {
    if (!checkPool(res)) return;
    const role = (req.query.role || 'all').toLowerCase();
    try {
        let where = '';
        if (role === 'student') where = 'WHERE vt.TenVaiTro = N\'Sinh Viên\'';
        else if (role === 'landlord') where = 'WHERE vt.TenVaiTro = N\'Chủ Trọ\'';

        const rs = await pool.request().query(`
            SELECT tk.TaiKhoanId, tk.Email, tk.TrangThai, vt.TenVaiTro,
                   sv.HoTen AS SV_HoTen, sv.Truong, sv.SoDienThoai AS SV_SDT,
                   ct.HoTen AS CT_HoTen, ct.DaXacThuc, ct.SoDienThoai AS CT_SDT
            FROM dbo.TaiKhoan tk
            JOIN dbo.VaiTro vt ON vt.VaiTroId = tk.VaiTroId
            LEFT JOIN dbo.SinhVien sv ON sv.SinhVienId = tk.TaiKhoanId
            LEFT JOIN dbo.ChuTro ct ON ct.ChuTroId = tk.TaiKhoanId
            ${where}
            ORDER BY tk.TaiKhoanId DESC
        `);
        res.json({ success: true, data: rs.recordset });
    } catch (err) {
        console.error('❌ Lỗi list accounts:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// Ban account
app.post('/api/admin/accounts/:id/ban', async (req, res) => {
    if (!checkPool(res)) return;
    const id = Number.parseInt(req.params.id, 10);
    const reason = (req.body?.reason || 'Tài khoản vi phạm.').toString().slice(0, 500);
    try {
        await pool.request()
            .input('Id', sql.BigInt, id)
            .query(`UPDATE dbo.TaiKhoan SET TrangThai = 2 WHERE TaiKhoanId = @Id`);
        await pool.request()
            .input('Id', sql.BigInt, id)
            .input('Msg', sql.NVarChar, reason)
            .query(`
                INSERT INTO dbo.ThongBao (TaiKhoanId, Loai, TieuDe, NoiDung, DaDoc)
                VALUES (@Id, N'Ban', N'Tài khoản bị khóa', @Msg, 0);
            `);
        res.json({ success: true, message: 'Đã khóa tài khoản' });
    } catch (err) {
        console.error('❌ Ban account error:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// Unban account
app.post('/api/admin/accounts/:id/unban', async (req, res) => {
    if (!checkPool(res)) return;
    const id = Number.parseInt(req.params.id, 10);
    try {
        await pool.request()
            .input('Id', sql.BigInt, id)
            .query(`UPDATE dbo.TaiKhoan SET TrangThai = 1 WHERE TaiKhoanId = @Id`);
        res.json({ success: true, message: 'Đã mở khóa tài khoản' });
    } catch (err) {
        console.error('❌ Unban account error:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// ------------------ Tiện ích: danh sách ------------------
app.get('/api/tienich', async (req, res) => {
    if (!checkPool(res)) return;
    try {
        const rs = await pool.request().query(`
            SELECT TienIchId, TenTienIch, MoTa
            FROM dbo.TienIch
            ORDER BY TenTienIch
        `);
        res.json({ success: true, data: rs.recordset });
    } catch (err) {
        console.error('❌ GET /api/tienich:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ------------------ Phòng: danh sách theo chủ trọ ------------------
app.get('/api/chutro/rooms', async (req, res) => {
    if (!checkPool(res)) return;
    const email = (req.query.email || '').trim();
    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });
    try {
        const tk = await pool.request().input('Email', sql.NVarChar, email)
            .query(`SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email`);
        if (!tk.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        const chuTroId = tk.recordset[0].TaiKhoanId;

        const rs = await pool.request().input('Id', sql.BigInt, chuTroId).query(`
            SELECT 
                p.PhongId, p.TieuDe, p.TrangThai, p.GiaCoBan, p.DiaChi,
                /* Ghép tên tiện ích cho từng phòng */
                STUFF((
                    SELECT N', ' + ti.TenTienIch
                    FROM dbo.Phong_TienIch pti
                    JOIN dbo.TienIch ti ON ti.TienIchId = pti.TienIchId
                    WHERE pti.PhongId = p.PhongId
                    FOR XML PATH(N''), TYPE
                ).value('.', 'NVARCHAR(MAX)'), 1, 2, N'') AS TienIch
            FROM dbo.Phong AS p
            WHERE p.ChuTroId = @Id
            ORDER BY p.PhongId DESC
        `);
        res.json({ success: true, data: rs.recordset });
    } catch (err) {
        console.error('❌ GET /api/chutro/rooms:', err.message || err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ------------------ Phòng: tạo mới ------------------
app.post('/api/chutro/rooms', async (req, res) => {
    if (!checkPool(res)) return;

    const b = req.body || {};
    const email = (b.email || '').trim();
    const tieuDe = (b.tieuDe || '').toString().slice(0, 150);
    const moTa = (b.moTa ?? '').toString(); // NVARCHAR(MAX)
    const diaChi = (b.diaChi || '').toString().slice(0, 255);
    const phuongXa = (b.phuongXa || '').toString().slice(0, 100) || null;
    const quanHuyen = (b.quanHuyen || '').toString().slice(0, 100) || null;
    const thanhPho = (b.thanhPho || '').toString().slice(0, 100) || null; // có DEFAULT ở DB
    const dienTichM2 = (b.dienTichM2 == null || b.dienTichM2 === '') ? null : Number(b.dienTichM2);
    const giaCoBan = (b.giaCoBan == null || b.giaCoBan === '') ? null : Number(b.giaCoBan);
    const soNguoiToiDa = (b.soNguoiToiDa == null || b.soNguoiToiDa === '') ? null : Number(b.soNguoiToiDa);
    const tienIchIds = Array.isArray(b.tienIchIds) ? b.tienIchIds.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];

    if (!email) return res.status(400).json({ success: false, message: 'Thiếu email' });
    if (!tieuDe || !diaChi || giaCoBan == null) {
        return res.status(400).json({ success: false, message: 'Thiếu Tiêu đề/Địa chỉ/Giá cơ bản' });
    }

    try {
        // Lấy chủ trọ id
        const tk = await pool.request().input('Email', sql.NVarChar, email)
            .query(`SELECT TaiKhoanId FROM dbo.TaiKhoan WHERE Email = @Email`);
        if (!tk.recordset.length) return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản' });
        const chuTroId = tk.recordset[0].TaiKhoanId;

        // NEW: đảm bảo có bản ghi ChuTro để thỏa FK của bảng Phong
        await pool.request()
            .input('Id', sql.BigInt, chuTroId)
            .query(`
IF NOT EXISTS (SELECT 1 FROM dbo.ChuTro WHERE ChuTroId = @Id)
BEGIN
    INSERT INTO dbo.ChuTro (ChuTroId, HoTen, DaXacThuc) VALUES (@Id, N'', 0);
END
            `);

        // Chèn phòng mới bằng INSERT ... SELECT để tránh lỗi gần từ khóa VALUES
        const reqIns = pool.request();
        reqIns.input('ChuTroId', sql.BigInt, chuTroId);
        reqIns.input('TieuDe', sql.NVarChar, tieuDe);
        reqIns.input('MoTa', sql.NVarChar(sql.MAX), moTa || null);
        reqIns.input('DiaChi', sql.NVarChar, diaChi);
        reqIns.input('PhuongXa', sql.NVarChar, phuongXa);
        reqIns.input('QuanHuyen', sql.NVarChar, quanHuyen);
        reqIns.input('ThanhPho', sql.NVarChar, thanhPho);
        reqIns.input('DienTichM2', sql.Decimal(8, 2), dienTichM2 == null ? null : dienTichM2);
        reqIns.input('GiaCoBan', sql.Decimal(12, 2), giaCoBan);
        reqIns.input('SoNguoiToiDa', sql.Int, soNguoiToiDa == null ? null : soNguoiToiDa);

        const ins = await reqIns.query(`
INSERT INTO dbo.Phong
    (ChuTroId, TieuDe, MoTa, DiaChi, PhuongXa, QuanHuyen, ThanhPho, DienTichM2, GiaCoBan, SoNguoiToiDa, TrangThai)
SELECT
    @ChuTroId, @TieuDe, @MoTa, @DiaChi, @PhuongXa, @QuanHuyen,
    COALESCE(NULLIF(@ThanhPho, N''), N'Thai Nguyen'),
    @DienTichM2, @GiaCoBan, @SoNguoiToiDa, 0;

SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS PhongId;
        `);
        const phongId = ins.recordset[0].PhongId;

        // Gán tiện ích (tham số hóa + chống trùng)
        if (tienIchIds.length) {
            const vIds = [...new Set(tienIchIds)];
            const reqMap = pool.request();
            reqMap.input('PhongId', sql.BigInt, phongId);
            const names = vIds.map((id, i) => {
                const p = 'ti' + i;
                reqMap.input(p, sql.Int, id);
                return '@' + p;
            });
            if (names.length) {
                await reqMap.query(`
INSERT INTO dbo.Phong_TienIch (PhongId, TienIchId)
SELECT @PhongId, t.TienIchId
FROM dbo.TienIch t
WHERE t.TienIchId IN (${names.join(',')})
  AND NOT EXISTS (
      SELECT 1 FROM dbo.Phong_TienIch x
      WHERE x.PhongId = @PhongId AND x.TienIchId = t.TienIchId
  );
                `);
            }
        }

        // Lấy danh sách tên tiện ích của phòng vừa tạo để trả về
        const tiNamesRs = await pool.request()
            .input('PhongId', sql.BigInt, phongId)
            .query(`
                SELECT ti.TenTienIch
                FROM dbo.Phong_TienIch pti
                JOIN dbo.TienIch ti ON ti.TienIchId = pti.TienIchId
                WHERE pti.PhongId = @PhongId
                ORDER BY ti.TenTienIch
            `);
        const tiNames = tiNamesRs.recordset.map(r => r.TenTienIch);

        res.status(201).json({
            success: true,
            message: 'Tạo phòng thành công',
            data: { PhongId: phongId, TienIch: tiNames }
        });
    } catch (err) {
        console.error('❌ POST /api/chutro/rooms:', err.message || err);
        res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
});

// JSON 404 for any unknown /api route
app.use('/api', (req, res) => {
    res.status(404).json({ success: false, message: 'API không tồn tại' });
});

// Global error handler: always JSON for /api
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (req.path && req.path.startsWith('/api/')) {
        return res.status(500).json({ success: false, message: err.message || 'Lỗi server' });
    }
    res.status(500).send('Internal Server Error');
});

// Tạo tài khoản admin mặc định nếu chưa có
async function seedAdminDefault() {
    if (!pool || !pool.connected) return;
    const email = 'admin@gmail.com';
    const pwd = '06022004';
    try {
        await pool.request()
            .input('Email', sql.NVarChar, email)
            .input('MatKhau', sql.VarChar, pwd)
            .query(`
DECLARE @AdminId TINYINT;

IF NOT EXISTS (SELECT 1 FROM dbo.VaiTro WHERE TenVaiTro = N'Admin')
BEGIN
    INSERT INTO dbo.VaiTro (TenVaiTro) VALUES (N'Admin');
END

SELECT @AdminId = VaiTroId FROM dbo.VaiTro WHERE TenVaiTro = N'Admin';

IF EXISTS (SELECT 1 FROM dbo.TaiKhoan WHERE Email = @Email)
BEGIN
    UPDATE dbo.TaiKhoan
    SET MatKhau = @MatKhau, VaiTroId = @AdminId, TrangThai = 1
    WHERE Email = @Email;
END
ELSE
BEGIN
    INSERT INTO dbo.TaiKhoan (Email, MatKhau, VaiTroId, TrangThai)
    VALUES (@Email, @MatKhau, @AdminId, 1);
END
            `);
        console.log('✅ Seed admin: admin@gmail.com/06022004');
    } catch (e) {
        console.error('❌ Seed admin thất bại:', e.message || e);
    }
}

// ------------------ Helpers: ensure schemas ------------------
async function ensureChuTroSchema() {
    if (!pool || !pool.connected) return;
    await pool.request().query(`
IF OBJECT_ID(N'dbo.ChuTro', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.ChuTro', N'DaXacThuc') IS NULL
        ALTER TABLE dbo.ChuTro ADD DaXacThuc BIT NULL CONSTRAINT DF_ChuTro_DaXacThuc DEFAULT (0);
    IF COL_LENGTH(N'dbo.ChuTro', N'NgayXacThuc') IS NULL
        ALTER TABLE dbo.ChuTro ADD NgayXacThuc DATETIME2(3) NULL;
END
    `);
}

async function ensureXacThucSchema() {
    if (!pool || !pool.connected) return;
    await pool.request().query(`
IF OBJECT_ID(N'dbo.YeuCauXacThucChuTro', N'U') IS NOT NULL
BEGIN
    IF COL_LENGTH(N'dbo.YeuCauXacThucChuTro', N'NgayNop') IS NULL
        ALTER TABLE dbo.YeuCauXacThucChuTro ADD NgayNop DATETIME2(3) NULL;
    IF COL_LENGTH(N'dbo.YeuCauXacThucChuTro', N'DuongDanTep') IS NULL
        ALTER TABLE dbo.YeuCauXacThucChuTro ADD DuongDanTep NVARCHAR(400) NULL;
END
    `);
}

// ------------------ Khởi động server ------------------
app.listen(port, () => {
    console.log(`🚀 Server chạy tại http://localhost:${port}`);
});

