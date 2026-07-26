CHEE CHAN STOCK v34.15.0 — RESET SYSTEM

แก้ไขจริง:
- app.js: เพิ่มระบบรีเซ็ต 3 ระดับ พร้อมยืนยันข้อความ แถบความคืบหน้า ป้องกันกดซ้ำ ลบรูปสินค้า และกลับ Dashboard
- main.css: เพิ่มหน้าตาเมนูพื้นที่อันตรายและหน้าต่างรีเซ็ต
- index.html: อัปเดต build/cache query
- service-worker.js: อัปเดต cache version

หมายเหตุ: Factory Reset ลบโปรไฟล์สมาชิก Firestore ยกเว้น Admin ปัจจุบัน แต่ไม่สามารถลบบัญชี Firebase Authentication ของผู้ใช้อื่นจากเว็บฝั่ง Client ได้
